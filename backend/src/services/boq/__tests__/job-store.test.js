const {
  getBoqJob,
  pruneBoqJobs,
  resetBoqJobs,
  setBoqJob,
} = require("../job-store");

describe("BOQ job store", () => {
  beforeEach(() => {
    resetBoqJobs();
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    resetBoqJobs();
    jest.useRealTimers();
  });

  it("merges job state and refreshes updatedAt", () => {
    setBoqJob("job-1", { status: "running", progress: 10 });
    jest.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
    setBoqJob("job-1", { progress: 40 });

    expect(getBoqJob("job-1")).toMatchObject({
      status: "running",
      progress: 40,
      updatedAt: new Date("2026-01-01T00:01:00.000Z").getTime(),
    });
  });

  it("prunes stale jobs after the configured TTL", () => {
    setBoqJob("old-job", { status: "running" });
    jest.setSystemTime(new Date("2026-01-01T02:01:00.000Z"));
    setBoqJob("fresh-job", { status: "running" });

    expect(pruneBoqJobs()).toBe(1);
    expect(getBoqJob("old-job")).toBeNull();
    expect(getBoqJob("fresh-job")).toMatchObject({ status: "running" });
  });
});
