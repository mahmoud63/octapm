const mockPrisma = {
  backgroundJob: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../../events/bus", () => ({
  EVENT_TYPES: { JOB_PROGRESS: "job.progress" },
  publish: jest.fn(),
}));

const jobService = require("../job.service");
const bus = require("../../events/bus");

const row = (overrides = {}) => ({
  id: "job-1",
  orgId: "org-1",
  projectId: "project-1",
  type: "schedule.generate",
  status: "queued",
  priority: 0,
  attempts: 0,
  maxAttempts: 3,
  payloadJson: { rawText: "x" },
  progressJson: { step: "Pass 1", progress: 5 },
  resultJson: null,
  errorCode: null,
  errorMessage: null,
  errorJson: null,
  requestedBy: "user-1",
  lockedBy: null,
  lockedAt: null,
  heartbeatAt: null,
  runAfter: new Date("2026-09-05T10:00:00.000Z"),
  startedAt: null,
  finishedAt: null,
  expiresAt: new Date("2026-09-12T10:00:00.000Z"),
  createdAt: new Date("2026-09-05T10:00:00.000Z"),
  updatedAt: new Date("2026-09-05T10:00:00.000Z"),
  ...overrides,
});

describe("job service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.backgroundJob.create.mockImplementation(({ data }) =>
      Promise.resolve(row({ ...data })),
    );
    mockPrisma.backgroundJob.update.mockImplementation(({ where, data }) =>
      Promise.resolve(row({ id: where.id, ...data })),
    );
  });

  it("enqueues a queued job with payload, progress and TTL", async () => {
    const job = await jobService.enqueueJob({
      orgId: "org-1",
      projectId: "project-1",
      type: "boq.parse",
      payload: { items: [1, 2] },
      progress: { step: "Preparing" },
      requestedBy: "user-1",
      maxAttempts: 2,
      ttlMs: 1000,
    });

    expect(mockPrisma.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "boq.parse",
          status: "queued",
          maxAttempts: 2,
          payloadJson: { items: [1, 2] },
          progressJson: { progress: 0, step: "Preparing" },
          requestedBy: "user-1",
          expiresAt: expect.any(Date),
        }),
      }),
    );
    expect(job.status).toBe("queued");
    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "job.progress", entityId: "job-1" }),
    );
  });

  it("rejects unknown job types and missing org", async () => {
    await expect(
      jobService.enqueueJob({ orgId: "org-1", type: "mystery" }),
    ).rejects.toMatchObject({ code: "JOB_TYPE_INVALID" });
    await expect(
      jobService.enqueueJob({ type: "boq.parse" }),
    ).rejects.toMatchObject({ code: "JOB_ORG_REQUIRED" });
  });

  it("maps statuses and spreads result fields in the legacy view", () => {
    const view = jobService.toLegacyJobView(
      row({
        status: "failed",
        errorCode: "AI_PARSE_FAILED",
        errorMessage: "No BOQ items",
        resultJson: { mode: "imported", comparison: { added: 2 } },
        progressJson: { step: "Pass 2", currentStep: 1, totalSteps: 3, progress: 45 },
      }),
    );

    expect(view).toMatchObject({
      jobId: "job-1",
      status: "error",
      jobStatus: "failed",
      step: "Pass 2",
      currentStep: 1,
      progress: 45,
      error: "No BOQ items",
      errorCode: "AI_PARSE_FAILED",
      mode: "imported",
      comparison: { added: 2 },
      canRetry: true,
    });
    expect(jobService.toLegacyJobView(row({ status: "succeeded" })).status).toBe(
      "done",
    );
    expect(jobService.toLegacyJobView(row({ status: "queued" })).status).toBe(
      "processing",
    );
  });

  it("claims the next job with SKIP LOCKED and returns the serialized row", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      row({ status: "running", attempts: 1, lockedBy: "worker-a" }),
    ]);

    const job = await jobService.claimNextJob({
      workerId: "worker-a",
      types: ["schedule.generate"],
    });

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sqlText = mockPrisma.$queryRaw.mock.calls[0][0].join("?");
    expect(sqlText).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sqlText).toMatch(/"attempts" = "attempts" \+ 1/);
    expect(job).toMatchObject({ id: "job-1", status: "running", attempts: 1 });

    mockPrisma.$queryRaw.mockResolvedValue([]);
    await expect(jobService.claimNextJob({ workerId: "w" })).resolves.toBeNull();
  });

  it("requeues retryable failures with exponential backoff until maxAttempts", async () => {
    const now = new Date("2026-09-05T10:00:00.000Z");
    mockPrisma.backgroundJob.findUnique.mockResolvedValue(
      row({ status: "running", attempts: 1, maxAttempts: 3 }),
    );

    const first = await jobService.failJob({
      jobId: "job-1",
      error: { code: "ECONNRESET", message: "socket hang up" },
      retryable: true,
      now,
    });

    expect(first.willRetry).toBe(true);
    expect(first.retryInMs).toBe(30_000);
    expect(mockPrisma.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "queued",
          runAfter: new Date(now.getTime() + 30_000),
          errorCode: "ECONNRESET",
        }),
      }),
    );

    mockPrisma.backgroundJob.findUnique.mockResolvedValue(
      row({ status: "running", attempts: 3, maxAttempts: 3 }),
    );
    const last = await jobService.failJob({
      jobId: "job-1",
      error: { code: "ECONNRESET", message: "socket hang up" },
      retryable: true,
      now,
    });
    expect(last.willRetry).toBe(false);
    expect(last.job.status).toBe("failed");
  });

  it("fails immediately when the error is not retryable", async () => {
    mockPrisma.backgroundJob.findUnique.mockResolvedValue(
      row({ status: "running", attempts: 1, maxAttempts: 3 }),
    );

    const result = await jobService.failJob({
      jobId: "job-1",
      error: { code: "EMPTY_FILE", message: "No content" },
      retryable: false,
    });

    expect(result.willRetry).toBe(false);
    expect(result.job).toMatchObject({
      status: "failed",
      error: { code: "EMPTY_FILE", message: "No content" },
      canRetry: true,
    });
  });

  it("merges results and marks progress complete on success", async () => {
    mockPrisma.backgroundJob.findUnique.mockResolvedValue(
      row({
        status: "running",
        resultJson: { mode: "imported" },
        progressJson: { step: "Pass 3", progress: 88 },
      }),
    );

    const job = await jobService.completeJob({
      jobId: "job-1",
      result: { revisionId: "rev-1" },
      progress: { step: "Complete" },
    });

    expect(mockPrisma.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "succeeded",
          resultJson: { mode: "imported", revisionId: "rev-1" },
          progressJson: { step: "Complete", progress: 100 },
          finishedAt: expect.any(Date),
        }),
      }),
    );
    expect(job.status).toBe("succeeded");
  });

  it("retries only failed or cancelled jobs and grants one more attempt", async () => {
    mockPrisma.backgroundJob.findFirst.mockResolvedValue(
      row({ status: "failed", attempts: 3, maxAttempts: 3 }),
    );

    const job = await jobService.retryJob({
      orgId: "org-1",
      projectId: "project-1",
      jobId: "job-1",
      userId: "pm-1",
    });

    expect(mockPrisma.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "queued",
          maxAttempts: 4,
          errorCode: null,
          finishedAt: null,
        }),
      }),
    );
    expect(job.status).toBe("queued");

    mockPrisma.backgroundJob.findFirst.mockResolvedValue(row({ status: "running" }));
    await expect(
      jobService.retryJob({ orgId: "org-1", projectId: "project-1", jobId: "job-1" }),
    ).rejects.toMatchObject({ code: "JOB_NOT_RETRYABLE" });

    mockPrisma.backgroundJob.findFirst.mockResolvedValue(null);
    await expect(
      jobService.retryJob({ orgId: "org-1", projectId: "other", jobId: "job-1" }),
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  });

  it("scopes job lookups to the org and project", async () => {
    mockPrisma.backgroundJob.findFirst.mockResolvedValue(null);

    await jobService.getLegacyJob({
      orgId: "org-1",
      projectId: "project-1",
      jobId: "job-1",
    });

    expect(mockPrisma.backgroundJob.findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", orgId: "org-1", projectId: "project-1" },
    });
  });

  it("recovers stale running jobs and prunes expired terminal jobs", async () => {
    mockPrisma.backgroundJob.findMany.mockResolvedValue([
      row({ id: "stale-1", status: "running", attempts: 1, lockedBy: "dead" }),
      row({ id: "stale-2", status: "running", attempts: 3, lockedBy: "dead" }),
    ]);
    mockPrisma.backgroundJob.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        where.id === "stale-1"
          ? row({ id: "stale-1", status: "running", attempts: 1 })
          : row({ id: "stale-2", status: "running", attempts: 3 }),
      ),
    );

    const recovered = await jobService.recoverStaleJobs({ staleMs: 60_000 });
    expect(recovered).toEqual({ scanned: 2, requeued: 1, failed: 1 });

    mockPrisma.backgroundJob.deleteMany.mockResolvedValue({ count: 4 });
    await expect(jobService.pruneExpiredJobs()).resolves.toEqual({ deleted: 4 });
    expect(mockPrisma.backgroundJob.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["succeeded", "failed", "cancelled"] },
        }),
      }),
    );
  });

  it("computes capped exponential backoff", () => {
    expect(jobService.backoffMs(1)).toBe(30_000);
    expect(jobService.backoffMs(2)).toBe(60_000);
    expect(jobService.backoffMs(3)).toBe(120_000);
    expect(jobService.backoffMs(20)).toBe(600_000);
  });
});
