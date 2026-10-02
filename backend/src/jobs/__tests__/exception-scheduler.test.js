/**
 * PC-7b trigger 2: the nightly tick — one evaluation per active project, a
 * project already queued or running skipped, never at start-up, and limited
 * to the organisations named when a test names them.
 */
jest.mock("../../config/db", () => ({
  prisma: { project: { findMany: jest.fn() }, backgroundJob: { findFirst: jest.fn() } },
}));
jest.mock("../job.service", () => ({
  JOB_TYPES: { EXCEPTIONS_EVALUATE: "exceptions.evaluate" },
  JOB_STATUSES: { QUEUED: "queued", RUNNING: "running" },
  enqueueJob: jest.fn(async () => ({ id: "job" })),
}));

const { prisma } = require("../../config/db");
const jobService = require("../job.service");
const scheduler = require("../exception-scheduler");

const NOW = new Date("2026-10-02T07:10:00.000Z");

beforeEach(() => {
  jest.clearAllMocks();
  scheduler.resetForTests();
  prisma.project.findMany.mockResolvedValue([
    { id: "p-1", orgId: "org-a" },
    { id: "p-2", orgId: "org-a" },
    { id: "p-3", orgId: "org-b" },
  ]);
  prisma.backgroundJob.findFirst.mockImplementation(async ({ where }) => (where.projectId === "p-2" ? { id: "running" } : null));
});

describe("runExceptionTick", () => {
  it("queues a nightly evaluation per active project and skips one already queued or running", async () => {
    expect(await scheduler.runExceptionTick({ now: NOW })).toEqual({ orgs: 2, projects: 3, queued: 2, skipped: 1 });
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "active", archivedAt: null } }));
    expect(prisma.backgroundJob.findFirst).toHaveBeenCalledWith({ where: { orgId: "org-a", projectId: "p-2", type: "exceptions.evaluate", status: { in: ["queued", "running"] } }, select: { id: true } });
    expect(jobService.enqueueJob.mock.calls.map(([job]) => [job.orgId, job.projectId, job.type, job.payload.trigger])).toEqual([
      ["org-a", "p-1", "exceptions.evaluate", "scheduled"],
      ["org-b", "p-3", "exceptions.evaluate", "scheduled"],
    ]);
  });

  it("limited to the organisations named (an empty list touches nothing)", async () => {
    await scheduler.runExceptionTick({ now: NOW, orgIds: ["org-b"] });
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "active", archivedAt: null, orgId: { in: ["org-b"] } } }));
    jest.clearAllMocks();
    expect(await scheduler.runExceptionTick({ now: NOW, orgIds: [] })).toEqual({ orgs: 0, projects: 0, queued: 0, skipped: 0 });
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });
});

describe("checkNightly", () => {
  it("runs once in the nightly hour of a UTC day, never outside it", async () => {
    expect(await scheduler.checkNightly({ now: new Date("2026-10-02T06:59:00.000Z"), env: {} })).toBeNull();
    expect(await scheduler.checkNightly({ now: NOW, env: {} })).toMatchObject({ queued: 2 });
    expect(await scheduler.checkNightly({ now: new Date("2026-10-02T07:40:00.000Z"), env: {} })).toBeNull();
    expect(await scheduler.checkNightly({ now: new Date("2026-10-03T07:05:00.000Z"), env: {} })).toMatchObject({ queued: 2 });
    expect(await scheduler.checkNightly({ now: new Date("2026-10-04T03:05:00.000Z"), env: { EXCEPTIONS_NIGHTLY_HOUR_UTC: "3" } })).toMatchObject({ queued: 2 });
  });

  it("does not start when the engine is disabled", () => {
    expect(scheduler.startExceptionScheduler({ env: { EXCEPTIONS_ENGINE_ENABLED: "false" } })).toBeNull();
  });

  // C0-1: the engine is off by default, so a deployment that sets nothing starts no tick —
  // whatever the tick's own switch says.
  it.each([
    ["nothing is set", {}],
    ["only the tick's own switch is on", { EXCEPTIONS_SCHEDULER_ENABLED: "true" }],
    ["the engine switch is empty", { EXCEPTIONS_ENGINE_ENABLED: "", EXCEPTIONS_SCHEDULER_ENABLED: "true" }],
    ["the engine switch is unrecognised", { EXCEPTIONS_ENGINE_ENABLED: "yes", EXCEPTIONS_SCHEDULER_ENABLED: "true" }],
  ])("does not start when %s", (_label, env) => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(scheduler.startExceptionScheduler({ env })).toBeNull();
      expect(log).toHaveBeenCalledWith("[exception-scheduler] disabled: EXCEPTIONS_ENGINE_ENABLED is not true");
    } finally {
      log.mockRestore();
    }
  });

  it("has its own switch, EXCEPTIONS_SCHEDULER_ENABLED (default true, as its siblings): false starts no tick though the engine is on", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect([scheduler.schedulerEnabled({}), scheduler.schedulerEnabled({ EXCEPTIONS_SCHEDULER_ENABLED: "true" }), scheduler.schedulerEnabled({ EXCEPTIONS_SCHEDULER_ENABLED: " FALSE " })]).toEqual([true, true, false]);
      expect(scheduler.startExceptionScheduler({ env: { EXCEPTIONS_ENGINE_ENABLED: "true", EXCEPTIONS_SCHEDULER_ENABLED: "false" } })).toBeNull();
      expect(log).toHaveBeenCalledWith("[exception-scheduler] disabled by EXCEPTIONS_SCHEDULER_ENABLED=false");
      // The engine switched on and the tick's own switch left at its default: the timer starts — and is stopped again.
      const timer = scheduler.startExceptionScheduler({ env: { EXCEPTIONS_ENGINE_ENABLED: "true" } });
      expect(timer).not.toBeNull();
      scheduler.stopExceptionScheduler();
    } finally {
      log.mockRestore();
    }
  });

  it("the backend env example documents the three switches", () => {
    const text = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "..", ".env.example"), "utf8");
    for (const name of ["EXCEPTIONS_ENGINE_ENABLED", "EXCEPTIONS_SCHEDULER_ENABLED", "EXCEPTIONS_NIGHTLY_HOUR_UTC"]) expect([name, new RegExp(`^# ${name}=`, "m").test(text)]).toEqual([name, true]);
  });
});
