/**
 * PC-7b third fixer, item 4 — the change-event withholding fails CLOSED: a
 * caller whose access is missing (undefined / null) is treated as a reader
 * without boq:read, never given the event as built. Each function that
 * decides it has its own case: exception.service changeEventAnswerFor (every
 * change-event answer), change-event.service withheldForCaller (the write
 * guards: save, RFQ send, convert, accept, delete) and utils/boq-figures
 * withheldExceptionEvent (an exception's audit event).
 */
const mockPrisma = {
  projectException: { findMany: jest.fn() },
  auditEvent: { findMany: jest.fn() },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const exceptionService = require("../exception.service");
const changeEventService = require("../change-event.service");
const { withheldExceptionEvent } = require("../../utils/boq-figures");

const EVENT = Object.freeze({
  id: "ce-1",
  exceptionId: "ex-1",
  origin: "exception",
  activityId: "act-1",
  sourceLinks: [{ type: "project_exception", id: "ex-1" }],
  sourceRecordType: "project_exception",
  sourceRecordId: "ex-1",
  sourcePath: "/projects/p1/controls/exceptions/ex-1",
  lines: [{ id: "line-1", description: "Raised from a project controls exception", activityId: "act-1", costCodeId: "cc-1", quantity: 5, unit: "m", unitCost: 0, romAmount: 0 }],
});
const PROVENANCE = { activityId: "act-1", lines: [{ id: "line-1", activityId: "act-1", costCodeId: "cc-1", quantity: 5, unit: "m" }] };
const NO_BOQ = Object.freeze({ boq: false, budget: true });
const BOQ = Object.freeze({ boq: true, budget: true });
const scope = { orgId: "org-1", projectId: "p1" };

beforeEach(() => {
  mockPrisma.projectException.findMany.mockReset().mockResolvedValue([{ id: "ex-1", kind: "quantity_over_allocation", subjectType: "allocation", secondarySubjectType: null }]);
  mockPrisma.auditEvent.findMany.mockReset().mockResolvedValue([{ entityId: "ce-1", metadataJson: { sourceBoqDerived: true, prefillProvenance: PROVENANCE } }]);
});

describe("exception.service changeEventAnswerFor", () => {
  it.each([["undefined", undefined], ["null", null], ["without boq:read", NO_BOQ]])("withholds the event from a caller whose access is %s", async (_label, access) => {
    const out = await exceptionService.changeEventAnswerFor({ ...scope, access, answer: EVENT });
    expect(out).not.toBe(EVENT);
    expect(out).not.toHaveProperty("activityId");
    expect(out.sourceLinks).toEqual([]);
    expect(out.lines[0]).not.toHaveProperty("costCodeId");
    expect(out.lines[0]).not.toHaveProperty("quantity");
    expect(out.sourceWithheld.keys).toEqual(expect.arrayContaining(["activityId", "lines[line-1].costCodeId", "lines[line-1].quantity"]));
  });

  it("gives a BOQ reader the event as built", async () => {
    expect(await exceptionService.changeEventAnswerFor({ ...scope, access: BOQ, answer: EVENT })).toBe(EVENT);
  });
});

describe("change-event.service withheldForCaller", () => {
  it.each([["undefined", undefined], ["null", null], ["without boq:read", NO_BOQ]])("names the withheld fields for a caller whose access is %s", async (_label, access) => {
    const withheld = await changeEventService._withheldForCaller({ ...scope, event: EVENT, access });
    expect(withheld).not.toBeNull();
    expect(withheld.event).toEqual(["activityId"]);
    expect(withheld.lines.get("line-1")).toEqual(expect.arrayContaining(["activityId", "costCodeId", "quantity", "unit", "unitCost"]));
  });

  it("withholds nothing from a BOQ reader", async () => {
    expect(await changeEventService._withheldForCaller({ ...scope, event: EVENT, access: BOQ })).toBeNull();
  });
});

describe("boq-figures withheldExceptionEvent", () => {
  const event = { entityType: "project_exception", metadata: { boqDerived: false, module: "schedule" } };
  it.each([["undefined", undefined], ["null", null]])("withholds an exception's audit event from a caller whose access is %s", (_label, access) => {
    expect(withheldExceptionEvent(event, access)).toBe(true);
  });
  it("gives it to a caller who reads its module", () => {
    expect(withheldExceptionEvent(event, { boq: false, budget: true, modules: { boq: false, cost: true, schedule: true, progress: true, change_order: true } })).toBe(false);
  });
});
