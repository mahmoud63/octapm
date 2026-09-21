const mockJobService = {
  JOB_TYPES: { SCHEDULE_GENERATE: "schedule.generate", BOQ_PARSE: "boq.parse" },
  claimNextJob: jest.fn(),
  completeJob: jest.fn(),
  failJob: jest.fn(),
  heartbeatJob: jest.fn(),
  updateJobProgress: jest.fn(),
  recoverStaleJobs: jest.fn(),
  pruneExpiredJobs: jest.fn(),
};
const mockCreateNotifications = jest.fn();
const mockRecordEvent = jest.fn();

jest.mock("../job.service", () => mockJobService);
jest.mock("../../services/notification.service", () => ({
  createNotifications: mockCreateNotifications,
}));
jest.mock("../../services/audit.service", () => ({
  ENTITY_TYPES: { BACKGROUND_JOB: "background_job" },
  recordEvent: mockRecordEvent,
}));

const {
  createJobWorker,
  isTransientError,
  registerJobHandler,
  resetJobHandlers,
} = require("../worker");

const silentLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

const job = (overrides = {}) => ({
  id: "job-1",
  orgId: "org-1",
  projectId: "project-1",
  type: "schedule.generate",
  status: "running",
  attempts: 1,
  maxAttempts: 3,
  payload: { rawText: "boq" },
  requestedBy: "user-1",
  ...overrides,
});

describe("job worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetJobHandlers();
    mockJobService.heartbeatJob.mockResolvedValue({ count: 1 });
    mockJobService.updateJobProgress.mockResolvedValue(null);
    mockJobService.recoverStaleJobs.mockResolvedValue({ scanned: 0 });
    mockJobService.pruneExpiredJobs.mockResolvedValue({ deleted: 0 });
    mockCreateNotifications.mockResolvedValue({ created: 1 });
    mockRecordEvent.mockResolvedValue({});
  });

  it("runs the registered handler, passes progress updates and completes the job", async () => {
    const handler = jest.fn(async ({ payload, updateProgress }) => {
      await updateProgress({ step: "Pass 2", progress: 50 });
      return { revisionId: "rev-1", echoed: payload.rawText };
    });
    registerJobHandler("schedule.generate", handler);
    mockJobService.claimNextJob
      .mockResolvedValueOnce(job())
      .mockResolvedValue(null);
    mockJobService.completeJob.mockResolvedValue(job({ status: "succeeded" }));

    const worker = createJobWorker({
      workerId: "worker-test",
      logger: silentLogger,
      pollIntervalMs: 10,
    });
    await worker.runOnce();

    expect(mockJobService.claimNextJob).toHaveBeenCalledWith({
      workerId: "worker-test",
      types: ["schedule.generate"],
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { rawText: "boq" } }),
    );
    expect(mockJobService.updateJobProgress).toHaveBeenCalledWith({
      jobId: "job-1",
      progress: { step: "Pass 2", progress: 50 },
    });
    // The outcome is written only while this worker still holds the job.
    expect(mockJobService.completeJob).toHaveBeenCalledWith({
      jobId: "job-1",
      result: { revisionId: "rev-1", echoed: "boq" },
      workerId: "worker-test",
    });
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "completed", entityType: "background_job" }),
    );
    expect(mockJobService.failJob).not.toHaveBeenCalled();
  });

  it("marks transient failures retryable and does not notify while retries remain", async () => {
    registerJobHandler("schedule.generate", async () => {
      const error = new Error("socket hang up");
      error.code = "ECONNRESET";
      throw error;
    });
    mockJobService.claimNextJob.mockResolvedValueOnce(job()).mockResolvedValue(null);
    mockJobService.failJob.mockResolvedValue({
      job: job({ status: "queued" }),
      willRetry: true,
      retryInMs: 30_000,
    });

    const worker = createJobWorker({ workerId: "w", logger: silentLogger });
    await worker.runOnce();

    expect(mockJobService.failJob).toHaveBeenCalledWith({
      jobId: "job-1",
      error: { code: "ECONNRESET", message: "socket hang up", details: null },
      retryable: true,
      workerId: "w",
    });
    expect(mockCreateNotifications).not.toHaveBeenCalled();
  });

  it("notifies the requester and audits when a job fails for good", async () => {
    registerJobHandler("schedule.generate", async () => {
      const error = new Error("No BOQ items found in file");
      error.code = "EMPTY_FILE";
      error.retryable = false;
      throw error;
    });
    mockJobService.claimNextJob.mockResolvedValueOnce(job()).mockResolvedValue(null);
    mockJobService.failJob.mockResolvedValue({
      job: job({ status: "failed" }),
      willRetry: false,
      retryInMs: null,
    });

    const worker = createJobWorker({ workerId: "w", logger: silentLogger });
    await worker.runOnce();

    expect(mockJobService.failJob).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: false }),
    );
    expect(mockCreateNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: ["user-1"],
        event: "job.failed",
        entityId: "job-1",
      }),
    );
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "failed" }),
    );
  });

  it("fails jobs without a handler as non-retryable", async () => {
    mockJobService.claimNextJob
      .mockResolvedValueOnce(job({ type: "boq.parse" }))
      .mockResolvedValue(null);
    mockJobService.failJob.mockResolvedValue({
      job: job({ type: "boq.parse", status: "failed" }),
      willRetry: false,
    });
    registerJobHandler("schedule.generate", async () => ({}));

    const worker = createJobWorker({
      workerId: "w",
      types: ["boq.parse"],
      logger: silentLogger,
    });
    await worker.runOnce();

    expect(mockJobService.failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "JOB_HANDLER_MISSING" }),
        retryable: false,
      }),
    );
  });

  it("respects the concurrency limit when claiming", async () => {
    let resolveFirst;
    registerJobHandler(
      "schedule.generate",
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    mockJobService.claimNextJob
      .mockResolvedValueOnce(job({ id: "a" }))
      .mockResolvedValueOnce(job({ id: "b" }))
      .mockResolvedValue(null);
    mockJobService.completeJob.mockResolvedValue(job({ status: "succeeded" }));

    const worker = createJobWorker({
      workerId: "w",
      concurrency: 1,
      logger: silentLogger,
    });
    const run = worker.runOnce();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockJobService.claimNextJob).toHaveBeenCalledTimes(1);
    expect(worker.activeCount()).toBe(1);
    resolveFirst({});
    await run;
    expect(mockJobService.completeJob).toHaveBeenCalledTimes(1);
  });

  it("classifies transient errors by explicit flag, status or code", () => {
    expect(isTransientError({ retryable: false, status: 503 })).toBe(false);
    expect(isTransientError({ status: 529 })).toBe(true);
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isTransientError(new Error("Request timeout after 120s"))).toBe(true);
    expect(isTransientError(new Error("Validation failed"))).toBe(false);
  });
});
