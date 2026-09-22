/**
 * The worker process as ECS runs it: scheduler leadership across processes,
 * staying up with an empty queue, failing loudly when it cannot start, and
 * draining (or giving up at the deadline) on SIGTERM. Real src/worker.js
 * processes against the real local Postgres; every lock key and job type is
 * unique to this run.
 *
 *   npm run test:live -- src/jobs/__live__/worker-lifecycle.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, freePort, liveDescribe, sleep, spawnNode, uniqueTag } = require("../../__live__/helpers");

const withPool = (url, limit) => {
  const parsed = new URL(url);
  parsed.searchParams.set("connection_limit", String(limit));
  return parsed.toString();
};

const SCHEDULERS_OFF = {
  BILLING_SCHEDULER_ENABLED: "false",
  NOTIFICATION_SCHEDULER_ENABLED: "false",
  DAILY_LOG_SCHEDULER_ENABLED: "false",
  REPORT_SCHEDULER_ENABLED: "false",
  WORKFLOW_SCHEDULER_ENABLED: "false",
  ACCOUNTING_SCHEDULER_ENABLED: "false",
};

const LIVE_WORKER = "src/jobs/__live__/fixtures/worker-with-live-handler.js";

const count = (text, pattern) => (text.match(pattern) || []).length;
const elections = (proc) => count(proc.output(), /\[scheduler-leader\] elected/g);
const demotions = (proc) => count(proc.output(), /\[scheduler-leader\] demoted/g);
/** Whether a process's last leadership line says it leads. */
const leads = (proc) => {
  const lines = proc.output().match(/\[scheduler-leader\] (elected|demoted|released)/g) || [];
  return proc.child.exitCode === null && lines.length > 0 && lines[lines.length - 1].endsWith("elected");
};

const waitFor = async (check, { timeoutMs = 10_000, intervalMs = 50, label = "condition" } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`${label} not met within ${timeoutMs} ms`);
};

liveDescribe("worker process lifecycle", () => {
  const spawned = [];
  let live;
  const liveJobType = `live.job.${crypto.randomUUID().slice(0, 8)}`;

  const start = (entry, env) => {
    const proc = spawnNode(entry, { env: { DATABASE_URL: withPool(process.env.DATABASE_URL, 3), ...env } });
    spawned.push(proc);
    return proc;
  };

  const lockHolders = async (key) =>
    (
      await prisma.$queryRaw`
        SELECT pid FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND objsubid = 2
          AND classid = 918273::int4::oid AND objid = hashtext(${key})::oid`
    ).map((row) => row.pid);

  const createJob = (data) =>
    prisma.backgroundJob.create({
      data: { orgId: live.org.id, type: liveJobType, status: "queued", expiresAt: new Date(Date.now() + 3_600_000), ...data },
    });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
  });

  afterAll(async () => {
    await Promise.all(spawned.map((proc) => proc.kill()));
    if (live) {
      await prisma.backgroundJob.deleteMany({ where: { orgId: live.org.id } });
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  }, 30_000);

  describe("scheduler leadership", () => {
    const key = uniqueTag("lock");
    const leaderEnv = { ...SCHEDULERS_OFF, SCHEDULERS_ENABLED: "true", SCHEDULER_LOCK_KEY: key, SCHEDULER_LEADER_HEARTBEAT_MS: "300" };
    let first;
    let second;

    it("elects exactly one of two workers, and one Postgres session holds the lock", async () => {
      first = start("src/worker.js", leaderEnv);
      second = start("src/worker.js", leaderEnv);
      await waitFor(() => elections(first) + elections(second) >= 1, { label: "an election" });
      await sleep(1_500); // five heartbeats each

      expect(elections(first) + elections(second)).toBe(1);
      expect(await lockHolders(key)).toHaveLength(1);
    }, 30_000);

    it("demotes a leader whose lock session is cut, and one leader remains", async () => {
      const leader = leads(first) ? first : second;
      const [holder] = await lockHolders(key);
      await prisma.$queryRaw`SELECT pg_terminate_backend(${holder}::int)`;

      await waitFor(() => demotions(leader) >= 1, { timeoutMs: 3_000, label: "the old leader's demotion" });
      await waitFor(async () => [first, second].filter(leads).length === 1 && (await lockHolders(key)).length === 1, {
        timeoutMs: 3_000,
        label: "exactly one leader again",
      });
      await sleep(1_000);
      expect([first, second].filter(leads)).toHaveLength(1);
      expect(await lockHolders(key)).toHaveLength(1);
    }, 30_000);

    it("hands over within two seconds when the leader is killed outright", async () => {
      const leader = leads(first) ? first : second;
      const follower = leader === first ? second : first;
      const before = elections(follower);
      const killedAt = Date.now();
      await leader.kill();

      await waitFor(() => elections(follower) > before, { timeoutMs: 2_000, label: "the follower's election" });
      expect(Date.now() - killedAt).toBeLessThan(2_000);
      expect(await lockHolders(key)).toHaveLength(1);
      await follower.signal("SIGTERM");
      expect((await follower.exited).code).toBe(0);
    }, 30_000);

    it("gives the lock up at the start of a graceful shutdown, before its jobs finish", async () => {
      const handoverKey = uniqueTag("lock");
      const env = { ...leaderEnv, SCHEDULER_LOCK_KEY: handoverKey };
      const leader = start(LIVE_WORKER, {
        ...env,
        JOB_WORKER_ENABLED: "true",
        JOB_WORKER_TYPES: liveJobType,
        LIVE_JOB_TYPE: liveJobType,
        JOB_POLL_INTERVAL_MS: "200",
        JOB_STALE_MS: "315360000000",
      });
      await leader.waitForOutput(/\[scheduler-leader\] elected/);
      const follower = start("src/worker.js", env);
      await follower.waitForOutput(/\[schedulers\]|\[job-worker\]/);
      await sleep(600);
      expect(elections(follower)).toBe(0);

      const job = await createJob({ payloadJson: { sleepMs: 2_000 } });
      await leader.waitForOutput(new RegExp(`\\[live-job\\] ${job.id} started`));
      await leader.signal("SIGTERM");

      // The follower takes over while the old leader is still draining its job.
      await waitFor(() => elections(follower) === 1, { timeoutMs: 1_500, label: "the follower's election during the drain" });
      expect(leader.child.exitCode).toBeNull();

      expect((await leader.exited).code).toBe(0);
      expect((await prisma.backgroundJob.findUnique({ where: { id: job.id } })).status).toBe("succeeded");
      await follower.signal("SIGTERM");
      expect((await follower.exited).code).toBe(0);
    }, 30_000);
  });

  it("stays up with an empty queue, and stops cleanly on SIGTERM", async () => {
    const worker = start("src/worker.js", {
      JOB_WORKER_ENABLED: "true",
      JOB_WORKER_TYPES: `live.none.${crypto.randomUUID().slice(0, 8)}`,
      JOB_STALE_MS: "315360000000",
      JOB_POLL_INTERVAL_MS: "200",
    });
    await worker.waitForOutput(/\[job-worker\] .* started/);
    await sleep(5_000);
    expect(worker.child.exitCode).toBeNull();

    const signalledAt = Date.now();
    await worker.signal("SIGTERM");
    expect((await worker.exited).code).toBe(0);
    expect(Date.now() - signalledAt).toBeLessThan(3_000);
  }, 30_000);

  it("exits 1 when the job worker cannot reach its queue at start", async () => {
    const deadPort = await freePort();
    const worker = start("src/worker.js", {
      JOB_WORKER_ENABLED: "true",
      DATABASE_URL: `postgresql://postgres:nothing@127.0.0.1:${deadPort}/nothing?connect_timeout=2`,
    });
    const { code, output } = await Promise.race([worker.exited, sleep(20_000).then(() => ({ code: "still running after 20 s", output: worker.output() }))]);
    expect(code).toBe(1);
    expect(output).toMatch(/\[worker\] the job worker could not start/);
  }, 30_000);

  describe("draining on SIGTERM", () => {
    const workerEnv = (extra = {}) => ({
      JOB_WORKER_ENABLED: "true",
      JOB_WORKER_TYPES: liveJobType,
      LIVE_JOB_TYPE: liveJobType,
      JOB_POLL_INTERVAL_MS: "200",
      JOB_STALE_MS: "315360000000",
      ...extra,
    });

    it("lets a job in hand finish, then exits 0", async () => {
      const worker = start(LIVE_WORKER, workerEnv());
      await worker.waitForOutput(/\[job-worker\] .* started/);
      const job = await createJob({ payloadJson: { sleepMs: 1_500 } });
      await worker.waitForOutput(new RegExp(`\\[live-job\\] ${job.id} started`));

      const signalledAt = Date.now();
      await worker.signal("SIGTERM");
      const { code } = await worker.exited;
      expect(code).toBe(0);
      expect(Date.now() - signalledAt).toBeGreaterThan(900);
      expect((await prisma.backgroundJob.findUnique({ where: { id: job.id } })).status).toBe("succeeded");
    }, 30_000);

    it("gives up at SHUTDOWN_TIMEOUT_MS with exit 1, leaving the job for recovery", async () => {
      const worker = start(LIVE_WORKER, workerEnv({ SHUTDOWN_TIMEOUT_MS: "1500" }));
      await worker.waitForOutput(/\[job-worker\] .* started/);
      const job = await createJob({ payloadJson: { sleepMs: 60_000 } });
      await worker.waitForOutput(new RegExp(`\\[live-job\\] ${job.id} started`));

      const signalledAt = Date.now();
      await worker.signal("SIGTERM");
      const { code } = await Promise.race([worker.exited, sleep(10_000).then(() => ({ code: "still running after 10 s" }))]);
      expect(code).toBe(1);
      expect(Date.now() - signalledAt).toBeLessThan(2_500);
      // Still claimed by the worker that died; stale-job recovery re-queues it.
      expect(await prisma.backgroundJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: "running", attempts: 1 });
    }, 30_000);
  });
});
