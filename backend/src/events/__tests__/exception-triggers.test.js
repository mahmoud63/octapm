/**
 * PC-7b trigger 1: which domain events ask for an evaluation of their project,
 * and the switch that turns the subscriber off.
 */
jest.mock("../../config/db", () => ({ prisma: {} }));

const bus = require("../bus");
const { isRelevantEvent, registerExceptionTriggers } = require("../exception-triggers");

const record = (entityType, action, newStatus = null) => ({ type: bus.EVENT_TYPES.RECORD_CHANGED, orgId: "org-1", projectId: "p-1", entityType, action, payload: { newStatus } });
const decided = (entityType, toStatus, action = "status_changed") => ({ type: bus.EVENT_TYPES.APPROVAL_DECIDED, orgId: "org-1", projectId: "p-1", entityType, action, payload: { toStatus } });

describe("isRelevantEvent", () => {
  it.each([
    ["allocation approved", decided("activity_boq_allocation", "approved", "approved"), true],
    ["allocation rejected (coverage moved)", decided("activity_boq_allocation", "rejected", "rejected"), true],
    ["progress approved", record("progress_submission", "approved", "approved"), true],
    ["quantity entry approved", record("quantity_progress_entry", "approved", "approved"), true],
    ["change order approved (audit)", record("change_order", "approved", "approved"), true],
    ["change order approved (workflow)", decided("change_order", "approved"), true],
    ["commitment executed", record("commitment", "status_changed", "executed"), true],
    ["commitment change order approved", record("commitment_change_order", "approved", "approved"), true],
    ["IPC certified", record("ipc_certificate", "certified", "certified"), true],
    ["pay application approved (ledger posted)", record("sub_pay_app", "approved"), true],
    ["direct cost approved (ledger posted)", record("direct_cost", "approved"), true],
    ["BOQ item edited", record("boq_item", "updated"), true],
    ["budget line revised", record("budget_line", "created"), true],
    ["schedule revision activated", record("schedule_revision", "status_changed", "active"), true],
    ["progress submitted (not official)", record("progress_submission", "created", "submitted"), false],
    ["change order drafted", record("change_order", "created", "draft"), false],
    ["commitment approved but not executed", record("commitment", "approved", "approved"), false],
    ["RFI answered", record("rfi", "status_changed", "answered"), false],
    ["background job completed (no loop)", record("background_job", "completed", "succeeded"), false],
    ["no project", { ...record("boq_item", "updated"), projectId: null }, false],
    ["notification", { type: bus.EVENT_TYPES.NOTIFICATION_CREATED, orgId: "org-1", projectId: "p-1", entityType: "boq_item" }, false],
  ])("%s", (_label, event, expected) => {
    expect(isRelevantEvent(event)).toBe(expected);
  });
});

describe("registerExceptionTriggers", () => {
  const logger = { log: jest.fn(), error: jest.fn() };

  it("subscribes nothing when EXCEPTIONS_ENGINE_ENABLED=false", () => {
    const before = bus.listenerCount();
    expect(registerExceptionTriggers({ env: { EXCEPTIONS_ENGINE_ENABLED: "false" }, enqueue: jest.fn(), logger })).toBeNull();
    expect(bus.listenerCount()).toBe(before);
  });

  it("enqueues for the event's own organisation and project, only for a relevant event", async () => {
    const enqueue = jest.fn(async () => ({ enqueued: true }));
    const before = bus.listenerCount();
    const off = registerExceptionTriggers({ env: {}, enqueue, logger });
    expect(bus.listenerCount()).toBe(before + 1);
    // A second registration is the same subscription.
    expect(registerExceptionTriggers({ env: {}, enqueue, logger })).toBe(off);
    bus.publish(record("rfi", "updated"), { delayMs: 0 });
    bus.publish(record("change_order", "approved", "approved"), { delayMs: 0 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({ orgId: "org-1", projectId: "p-1", trigger: "event", reason: "record.changed:change_order:approved" });
    off();
    expect(bus.listenerCount()).toBe(before);
  });
});
