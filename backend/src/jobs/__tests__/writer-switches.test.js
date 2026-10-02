/**
 * Certification finding C0-2: nothing that writes on its own starts because a
 * variable is missing. Every scheduler, scheduler leadership, the job worker,
 * the weather feed and the Expo push sender are OFF unless their variable is
 * exactly "true".
 *
 * For each writer and each value: OFF means the start function returns null,
 * says why, and touches nothing (no query, no service call, no timer); ON
 * means it starts and does its first piece of work.
 */

const mockDbCalls = [];
const mockModel = () =>
  new Proxy(
    {},
    {
      get: (_target, method) => (...args) => {
        mockDbCalls.push(String(method));
        if (method === "count") return Promise.resolve(0);
        if (method === "updateMany" || method === "deleteMany") return Promise.resolve({ count: 0 });
        if (String(method).startsWith("find") && method !== "findMany") return Promise.resolve(null);
        void args;
        return Promise.resolve([]);
      },
    },
  );
const mockPrisma = new Proxy(
  {},
  {
    get: (_target, name) => {
      if (name === "$queryRaw" || name === "$executeRaw" || name === "$queryRawUnsafe" || name === "$executeRawUnsafe") {
        return (...args) => {
          mockDbCalls.push(String(name));
          void args;
          return Promise.resolve([]);
        };
      }
      if (name === "$transaction") return (work) => (typeof work === "function" ? work(mockPrisma) : Promise.all(work));
      if (typeof name === "symbol" || name === "then") return undefined;
      return mockModel();
    },
  },
);
const mockService = jest.fn(() => Promise.resolve({ queued: 0, scanned: 0, escalated: 0, sent: 0 }));
const mockLeader = { start: jest.fn(), stop: jest.fn(() => Promise.resolve()) };
const mockJobService = {
  JOB_TYPES: { PORTFOLIO_REFRESH: "portfolio.refresh", DAILY_LOG_WEATHER: "daily_log.weather", DAILY_LOG_DISTRIBUTE: "daily_log.distribute", REPORT_RENDER: "report.render" },
  claimNextJob: jest.fn(() => Promise.resolve(null)),
  recoverStaleJobs: jest.fn(() => Promise.resolve({ requeued: 0, failed: 0 })),
  pruneExpiredJobs: jest.fn(() => Promise.resolve(0)),
  enqueueJob: jest.fn(() => Promise.resolve({ id: "job" })),
  completeJob: jest.fn(),
  failJob: jest.fn(),
  heartbeatJob: jest.fn(),
  updateJobProgress: jest.fn(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../job.service", () => mockJobService);
jest.mock("../handlers", () => ({ registerAllHandlers: jest.fn() }));
jest.mock("../scheduler-leader", () => ({ createSchedulerLeader: jest.fn(() => mockLeader), leaderOptionsFromEnv: () => ({}) }));
jest.mock("../../services/email.service", () => ({ sendEmail: jest.fn(() => Promise.resolve()), templates: {} }));
jest.mock("../../services/notification.service", () => ({
  processPendingEmailDeliveries: (...args) => mockService("notification.email", ...args),
  runDueNotificationScan: (...args) => mockService("notification.due", ...args),
  createNotifications: jest.fn(),
}));
jest.mock("../../services/push.service", () => ({ processPendingPushDeliveries: (...args) => mockService("push", ...args) }));
jest.mock("../../services/accounting.service", () => ({ queuePollJobs: (...args) => mockService("accounting", ...args) }));
jest.mock("../../services/workflow-engine.service", () => ({ runEscalationScan: (...args) => mockService("workflow", ...args) }));
jest.mock("../../services/audit.service", () => ({ ENTITY_TYPES: { BACKGROUND_JOB: "background_job" }, recordEvent: jest.fn() }));

const { WRITER_SWITCHES, describeSwitches, isSwitchOn, offMessage } = require("../../config/switches");

/** Values that must leave a writer OFF. */
const OFF = [
  ["missing", undefined],
  ["empty", ""],
  ["blank", "   "],
  ["false", "false"],
  ["FALSE", "FALSE"],
  ["0", "0"],
  ["1", "1"],
  ["yes", "yes"],
  ["on", "on"],
  ["enabled", "enabled"],
  ["malformed (true;)", "true;"],
  ["malformed (truee)", "truee"],
  ["a quoted true", '"true"'],
];
/** Values that turn a writer ON. */
const ON = [
  ["true", "true"],
  ["TRUE with spaces", "  TRUE "],
  ["True", "True"],
];

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

/** Each writer: its variable, its start and stop, and the label of its stand-down line. */
const WRITERS = [
  { name: "BILLING_SCHEDULER_ENABLED", label: "billing-scheduler", mod: () => require("../billing-scheduler"), start: "startBillingScheduler", stop: "stopBillingScheduler" },
  { name: "NOTIFICATION_SCHEDULER_ENABLED", label: "notification-scheduler", mod: () => require("../notification-scheduler"), start: "startNotificationScheduler", stop: "stopNotificationScheduler" },
  { name: "DAILY_LOG_SCHEDULER_ENABLED", label: "daily-log-scheduler", mod: () => require("../daily-log-scheduler"), start: "startDailyLogScheduler", stop: "stopDailyLogScheduler" },
  { name: "REPORT_SCHEDULER_ENABLED", label: "report-scheduler", mod: () => require("../report-scheduler"), start: "startReportScheduler", stop: "stopReportScheduler" },
  { name: "WORKFLOW_SCHEDULER_ENABLED", label: "workflow-scheduler", mod: () => require("../workflow-scheduler"), start: "startWorkflowScheduler", stop: "stopWorkflowScheduler" },
  // The accounting poll never runs under NODE_ENV=test, so its switch is tested as a development process.
  { name: "ACCOUNTING_SCHEDULER_ENABLED", label: "accounting-scheduler", mod: () => require("../accounting-scheduler"), start: "startAccountingScheduler", stop: "stopAccountingScheduler", nodeEnv: "development", firstWorkIsDelayed: true },
  { name: "JOB_WORKER_ENABLED", label: "job-worker", mod: () => require("../worker"), start: "startJobWorker", stop: "stopJobWorker" },
];

describe("the switch rule", () => {
  it.each(OFF)("%s is off", (_label, value) => {
    expect(isSwitchOn("ANY", { ANY: value })).toBe(false);
  });
  it.each(ON)("%s is on", (_label, value) => {
    expect(isSwitchOn("ANY", { ANY: value })).toBe(true);
  });
  it("is off with no environment at all", () => {
    expect([isSwitchOn("ANY", null), isSwitchOn("ANY", {})]).toEqual([false, false]);
  });
  it("names every writer, and reports them all off for an empty environment", () => {
    const names = WRITER_SWITCHES.map((s) => s.name);
    for (const writer of WRITERS) expect(names).toContain(writer.name);
    for (const name of ["SCHEDULERS_ENABLED", "EXCEPTIONS_ENGINE_ENABLED", "EXCEPTIONS_SCHEDULER_ENABLED", "WEATHER_FEED_ENABLED", "EXPO_PUSH_ENABLED"]) expect(names).toContain(name);
    expect(describeSwitches({})).toBe(`on: (none) | off: ${names.join(", ")}`);
    expect(describeSwitches({ JOB_WORKER_ENABLED: "true", SCHEDULERS_ENABLED: "yes" })).toMatch(/^on: JOB_WORKER_ENABLED \| off: SCHEDULERS_ENABLED, /);
  });
});

describe.each(WRITERS)("$name", (writer) => {
  const savedValue = process.env[writer.name];
  const savedNodeEnv = process.env.NODE_ENV;
  let log;

  beforeEach(() => {
    jest.useFakeTimers();
    mockDbCalls.length = 0;
    mockService.mockClear();
    Object.values(mockJobService).forEach((fn) => typeof fn?.mockClear === "function" && fn.mockClear());
    log = jest.spyOn(console, "log").mockImplementation(() => {});
    if (writer.nodeEnv) process.env.NODE_ENV = writer.nodeEnv;
  });
  afterEach(async () => {
    await writer.mod()[writer.stop]();
    if (savedValue === undefined) delete process.env[writer.name];
    else process.env[writer.name] = savedValue;
    process.env.NODE_ENV = savedNodeEnv;
    log.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it.each(OFF)("stays off when the variable is %s: starts nothing, touches nothing, says why", async (_label, value) => {
    if (value === undefined) delete process.env[writer.name];
    else process.env[writer.name] = value;
    const started = writer.mod()[writer.start]();
    await flush();
    expect(started).toBeNull();
    expect(log).toHaveBeenCalledWith(offMessage(writer.label, writer.name));
    expect(mockDbCalls).toEqual([]);
    expect(mockService).not.toHaveBeenCalled();
    expect(mockJobService.claimNextJob).not.toHaveBeenCalled();
    expect(mockJobService.recoverStaleJobs).not.toHaveBeenCalled();
    expect(mockJobService.enqueueJob).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(ON)("runs when the variable is %s", async (_label, value) => {
    process.env[writer.name] = value;
    const started = writer.mod()[writer.start]();
    // The job worker's first start is asynchronous: it recovers stale jobs, then sets its timers.
    if (started?.ready) await started.ready;
    await flush();
    expect(started).not.toBeNull();
    expect(log).not.toHaveBeenCalledWith(offMessage(writer.label, writer.name));
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    if (!writer.firstWorkIsDelayed) {
      const worked = mockDbCalls.length + mockService.mock.calls.length + mockJobService.claimNextJob.mock.calls.length + mockJobService.recoverStaleJobs.mock.calls.length;
      expect(worked).toBeGreaterThan(0);
    }
  });
});

describe("SCHEDULERS_ENABLED (scheduler leadership)", () => {
  const { startSchedulerLeadership, stopSchedulerLeadership, schedulersEnabled } = require("../schedulers");
  const { createSchedulerLeader } = require("../scheduler-leader");
  afterEach(async () => {
    await stopSchedulerLeadership();
    createSchedulerLeader.mockClear();
    mockLeader.start.mockClear();
  });

  it.each(OFF)("does not compete for leadership when the variable is %s", (_label, value) => {
    const logger = { log: jest.fn() };
    expect(startSchedulerLeadership({ env: { SCHEDULERS_ENABLED: value, NODE_ENV: "production" }, logger })).toBeNull();
    expect(createSchedulerLeader).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith("[schedulers] disabled in this process: SCHEDULERS_ENABLED is not true");
  });
  it.each(ON)("competes for leadership when the variable is %s", (_label, value) => {
    const leader = startSchedulerLeadership({ env: { SCHEDULERS_ENABLED: value, NODE_ENV: "production" }, logger: { log: jest.fn() } });
    expect(leader).toBe(mockLeader);
    expect(mockLeader.start).toHaveBeenCalledTimes(1);
  });
  it("never under test, whatever the variable says", () => {
    expect(schedulersEnabled({ SCHEDULERS_ENABLED: "true", NODE_ENV: "test" })).toBe(false);
  });
});

describe("EXCEPTIONS_SCHEDULER_ENABLED, WEATHER_FEED_ENABLED, EXPO_PUSH_ENABLED", () => {
  const readers = [
    ["EXCEPTIONS_SCHEDULER_ENABLED", (value) => require("../exception-scheduler").schedulerEnabled({ EXCEPTIONS_SCHEDULER_ENABLED: value })],
    ["WEATHER_FEED_ENABLED", (value) => withEnv("WEATHER_FEED_ENABLED", value, () => jest.requireActual("../../services/weather-feed.service").isEnabled())],
    ["EXPO_PUSH_ENABLED", (value) => withEnv("EXPO_PUSH_ENABLED", value, () => jest.requireActual("../../services/push.service").expoEnabled())],
  ];
  const withEnv = (name, value, fn) => {
    const saved = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    try {
      return fn();
    } finally {
      if (saved === undefined) delete process.env[name];
      else process.env[name] = saved;
    }
  };
  it.each(readers)("%s is off for every value that is not true, and on for true", (_name, read) => {
    expect(OFF.map(([, value]) => read(value))).toEqual(OFF.map(() => false));
    expect(ON.map(([, value]) => read(value))).toEqual(ON.map(() => true));
  });
});
