/**
 * Stopping the job worker while a tick is inside claimNextJob: the job that
 * claim returns must be awaited by stop(), not missed by its snapshot of the
 * jobs in hand. Real worker and real job.service against the real local
 * Postgres; the only stand-in is a gate held between the real claim
 * returning and the worker seeing it, so stop() can land in that window
 * every time instead of by luck.
 *
 *   npm run test:live -- src/jobs/__live__/worker-shutdown.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const jobService = require("../job.service");
const { createJobWorker, registerJobHandler } = require("../worker");
const { createLiveOrg, dropLiveOrg, liveDescribe, sleep } = require("../../__live__/helpers");

const realClaimNextJob = jobService.claimNextJob;

const quietLogger = { log: () => {}, warn: () => {}, error: (...args) => console.error(...args) };

liveDescribe("job worker shutdown during a claim", () => {
  let live;
  const type = `live.stop.${crypto.randomUUID().slice(0, 8)}`;
  const finished = new Set();
  let unregister;
  let claimSpy;

  const read = (id) => prisma.backgroundJob.findUnique({ where: { id } });

  /** The real claim runs; its result is held until release() is called. */
  const gateClaims = () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let claimed;
    const hasClaimed = new Promise((resolve) => {
      claimed = resolve;
    });
    claimSpy.mockImplementationOnce(async (args) => {
      const job = await realClaimNextJob(args);
      claimed(job);
      await gate;
      return job;
    });
    return { hasClaimed, release };
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    unregister = registerJobHandler(type, async ({ job, payload }) => {
      await sleep(payload.sleepMs || 0);
      finished.add(job.id);
      return { ok: true };
    });
  });

  beforeEach(() => {
    claimSpy = jest.spyOn(jobService, "claimNextJob");
  });

  afterEach(() => {
    claimSpy.mockRestore();
  });

  afterAll(async () => {
    unregister?.();
    if (live) {
      await prisma.backgroundJob.deleteMany({ where: { orgId: live.org.id } });
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  const queue = (payloadJson) =>
    prisma.backgroundJob.create({
      data: { orgId: live.org.id, type, status: "queued", payloadJson, expiresAt: new Date(Date.now() + 3_600_000) },
    });

  it("waits for a job claimed while it was stopping, and only then reports drained", async () => {
    const job = await queue({ sleepMs: 400 });
    const { hasClaimed, release } = gateClaims();
    const worker = createJobWorker({ workerId: `stop-a-${type}`, types: [type], pollIntervalMs: 60_000, logger: quietLogger });

    const started = worker.start();
    expect((await hasClaimed)?.id).toBe(job.id);
    // The claim is in the database, the worker has not seen it yet.
    expect(await read(job.id)).toMatchObject({ status: "running", lockedBy: worker.workerId });

    const stopping = worker.stop({ deadline: Date.now() + 10_000 });
    await sleep(200);
    release();

    const outcome = await stopping;
    await started;
    expect(outcome).toEqual({ drained: true, pending: 0 });
    // Drained means the job is done, not merely that nothing was in hand.
    expect(finished.has(job.id)).toBe(true);
    expect(await read(job.id)).toMatchObject({ status: "succeeded" });
  }, 30_000);

  it("reports not drained when that job outlives the deadline", async () => {
    const job = await queue({ sleepMs: 3_000 });
    const { hasClaimed, release } = gateClaims();
    const worker = createJobWorker({ workerId: `stop-b-${type}`, types: [type], pollIntervalMs: 60_000, logger: quietLogger });

    const started = worker.start();
    expect((await hasClaimed)?.id).toBe(job.id);
    const stopping = worker.stop({ deadline: Date.now() + 800 });
    release();

    const outcome = await stopping;
    expect(outcome).toEqual({ drained: false, pending: 1 });
    expect(finished.has(job.id)).toBe(false);
    // Let the job finish so it does not outlive the test.
    await started;
    await worker.stop();
    expect(await read(job.id)).toMatchObject({ status: "succeeded" });
  }, 30_000);
});
