/**
 * With several worker processes on one queue, a job's outcome is written only
 * by the worker that holds it, and stale-job recovery only takes a job that
 * is still exactly as it found it. Real job.service against the real local
 * Postgres (whose TimeZone is not UTC — the claim must not care).
 *
 *   npm run test:live -- src/jobs/__live__/job-ownership.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const jobService = require("../job.service");
const { createLiveOrg, dropLiveOrg, liveDescribe, sleep } = require("../../__live__/helpers");

liveDescribe("job ownership across workers", () => {
  let live;
  const type = `live.job.${crypto.randomUUID().slice(0, 8)}`;

  const runningJob = (data = {}) =>
    prisma.backgroundJob.create({
      data: {
        orgId: live.org.id,
        type,
        status: "running",
        attempts: 1,
        lockedBy: "worker-a",
        lockedAt: new Date(Date.now() - 10 * 60_000),
        heartbeatAt: new Date(Date.now() - 10 * 60_000),
        expiresAt: new Date(Date.now() + 3_600_000),
        ...data,
      },
    });
  const read = (id) => prisma.backgroundJob.findUnique({ where: { id } });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
  });

  afterAll(async () => {
    if (live) {
      await prisma.backgroundJob.deleteMany({ where: { orgId: live.org.id } });
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("claims a job queued a moment ago, and stamps the claim in UTC", async () => {
    const queued = await prisma.backgroundJob.create({
      data: { orgId: live.org.id, type, status: "queued", expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const claimed = await jobService.claimNextJob({ workerId: "worker-claim", types: [type] });
    expect(claimed?.id).toBe(queued.id);
    const row = await read(queued.id);
    expect(Math.abs(row.heartbeatAt.getTime() - Date.now())).toBeLessThan(60_000);
    expect(Math.abs(row.lockedAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("does not let another worker complete or fail a job it does not hold", async () => {
    const job = await runningJob();
    expect(await jobService.completeJob({ jobId: job.id, result: { by: "b" }, workerId: "worker-b" })).toBeNull();
    expect(await jobService.failJob({ jobId: job.id, error: { code: "X" }, retryable: false, workerId: "worker-b" })).toBeNull();
    expect(await read(job.id)).toMatchObject({ status: "running", lockedBy: "worker-a", resultJson: null, errorCode: null });

    const done = await jobService.completeJob({ jobId: job.id, result: { by: "a" }, workerId: "worker-a" });
    expect(done).toMatchObject({ status: "succeeded", result: { by: "a" } });
  });

  it("recovers a stale job only if nobody touched it since it was found", async () => {
    const job = await runningJob();
    const foundStale = await read(job.id);
    // The owner heartbeats between the scan and the write.
    await sleep(5);
    await jobService.heartbeatJob({ jobId: job.id, workerId: "worker-a" });

    expect(await jobService.recoverJob({ job: foundStale })).toBeNull();
    expect(await read(job.id)).toMatchObject({ status: "running", lockedBy: "worker-a" });

    // Found again, untouched this time: it goes back to the queue, once.
    const foundAgain = await read(job.id);
    const recovered = await jobService.recoverJob({ job: foundAgain });
    expect(recovered).toMatchObject({ willRetry: true, job: { status: "queued", lockedBy: null } });
    expect(await jobService.recoverJob({ job: foundAgain })).toBeNull();

    // The worker that lost it finishes late; its outcome is not recorded.
    expect(await jobService.completeJob({ jobId: job.id, result: { late: true }, workerId: "worker-a" })).toBeNull();
    expect(await read(job.id)).toMatchObject({ status: "queued", resultJson: null, errorCode: "JOB_WORKER_LOST" });
  });
});
