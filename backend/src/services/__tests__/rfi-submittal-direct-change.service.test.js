/**
 * Certification finding L40: a status (or an answer / review outcome) sent
 * straight to the RFI and submittal create / update routes needs the
 * transition the matching action route needs, and a submittal status sent
 * that way respects a running workflow. Also the party check on archive.
 */
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async () => ({ id: "project-1", orgId: "org-1" })) },
  rfi: { findFirst: jest.fn(), update: jest.fn() },
  rfiResponse: { findFirst: jest.fn() },
  submittal: { findFirst: jest.fn(), update: jest.fn() },
  workflowInstance: { findFirst: jest.fn(async () => null) },
  activity: { findMany: jest.fn(async () => []) },
};
const mockAuditService = { ENTITY_TYPES: { RFI: "rfi", SUBMITTAL: "submittal" }, ACTIONS: { ARCHIVED: "archived", UPDATED: "updated" }, recordEvent: jest.fn() };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAuditService);

const rfiService = require("../rfi.service");
const submittalService = require("../submittal.service");

const holds = (...transitions) => jest.fn((action, transition) => transitions.includes(transition));
const rfiRow = (overrides = {}) => ({ id: "rfi-1", projectId: "project-1", status: "open", response: null, answeredBy: null, answeredDate: null, officialResponseId: null, ownerPartyId: "party-x", reviewerPartyId: null, approverPartyId: null, archivedAt: null, ...overrides });
const submittalRow = (overrides = {}) => ({ id: "sub-1", projectId: "project-1", status: "under_review", responseCode: null, responseCodeLabel: null, currentStepId: null, ownerPartyId: "party-x", reviewerPartyId: null, approverPartyId: null, archivedAt: null, ...overrides });
const partyY = { scope: "party", role: "external_party", assignmentRole: null, partyAccess: [{ projectPartyId: "party-y", role: "subcontractor" }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.workflowInstance.findFirst.mockResolvedValue(null);
});

describe("RFI decisions through create / update", () => {
  const assert = rfiService.assertDirectRfiChange;

  it("needs the action's transition for a status the caller sets directly", () => {
    const sub = holds("rfi.submit");
    expect(() => assert({ existing: rfiRow(), payload: { status: "closed" }, canTransition: sub })).toThrow(expect.objectContaining({ code: "FORBIDDEN", status: 403, details: expect.objectContaining({ transition: "rfi.close" }) }));
    expect(() => assert({ existing: rfiRow(), payload: { status: "answered" }, canTransition: sub })).toThrow(expect.objectContaining({ details: expect.objectContaining({ transition: "rfi.answer" }) }));
    expect(() => assert({ existing: rfiRow({ status: "answered" }), payload: { status: "open" }, canTransition: sub })).toThrow(expect.objectContaining({ details: expect.objectContaining({ transition: "rfi.reject" }) }));
    expect(() => assert({ existing: rfiRow({ status: "closed" }), payload: { status: "open" }, canTransition: sub })).toThrow(expect.objectContaining({ details: expect.objectContaining({ transition: "rfi.reopen" }) }));
    expect(() => assert({ payload: { status: "closed" }, canTransition: sub })).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    // allowed: what the caller holds, no change of status, a new RFI raised open or draft
    expect(() => assert({ existing: rfiRow({ status: "draft" }), payload: { status: "open" }, canTransition: sub })).not.toThrow();
    expect(() => assert({ existing: rfiRow(), payload: { status: "open", discipline: "Civil" }, canTransition: sub })).not.toThrow();
    expect(() => assert({ payload: { status: "open" }, canTransition: sub })).not.toThrow();
    expect(() => assert({ payload: {}, canTransition: sub })).not.toThrow();
    expect(() => assert({ existing: rfiRow(), payload: { status: "closed" }, canTransition: holds("rfi.close") })).not.toThrow();
  });

  it("needs rfi.answer to write the answer fields, but not to send them unchanged", () => {
    const sub = holds("rfi.submit");
    expect(() => assert({ existing: rfiRow(), payload: { response: "Use 450 mm" }, canTransition: sub })).toThrow(expect.objectContaining({ details: expect.objectContaining({ transition: "rfi.answer", fields: ["response"] }) }));
    expect(() => assert({ existing: rfiRow(), payload: { answeredBy: "The Engineer" }, canTransition: sub })).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => assert({ payload: { status: "open", response: "pre-answered" }, canTransition: sub })).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => assert({ existing: rfiRow({ response: "Use 450 mm" }), payload: { response: " Use 450 mm " }, canTransition: sub })).not.toThrow();
    expect(() => assert({ existing: rfiRow(), payload: { response: null, answeredBy: "" }, canTransition: sub })).not.toThrow();
    expect(() => assert({ existing: rfiRow(), payload: { response: "PM wording" }, canTransition: holds("rfi.answer") })).not.toThrow();
  });

  it("applies only when the route gives the caller's check (internal callers already passed an action guard)", () => {
    expect(() => assert({ existing: rfiRow(), payload: { status: "closed", response: "x" }, canTransition: null })).not.toThrow();
  });

  it("refuses the update before anything is written", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue(rfiRow());
    await expect(rfiService.updateRfi({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", payload: { status: "closed" }, userId: "user-x", userRole: "external_party", canTransition: holds("rfi.submit") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(rfiService.createRfi({ orgId: "org-1", projectId: "project-1", payload: { subject: "s", status: "closed" }, userId: "user-x", canTransition: holds("rfi.submit") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockPrisma.rfi.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an activityId beside activityLinks that is not this project's, as the links' check refuses one (CERT-2)", async () => {
    const payload = { subject: "Founding level", question: "Which?", activityId: "foreign-activity", activityLinks: [{ activityId: "own-activity" }] };
    await expect(rfiService.createRfi({ orgId: "org-1", projectId: "project-1", payload, userId: "user-x" })).rejects.toMatchObject({
      status: 400,
      code: "WORKFLOW_ACTIVITY_NOT_FOUND",
    });
    expect(mockPrisma.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["foreign-activity"] }, projectId: "project-1" } }));
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses another company's activityId on update before anything is written (CERT-2)", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue(rfiRow());
    await expect(rfiService.updateRfi({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", payload: { activityId: "foreign-activity" }, userId: "user-x", userRole: "pm" })).rejects.toMatchObject({
      status: 400,
      code: "WORKFLOW_ACTIVITY_NOT_FOUND",
    });
    expect(mockPrisma.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["foreign-activity"] }, projectId: "project-1" } }));
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.rfi.update).not.toHaveBeenCalled();
  });

  it("archives an RFI only for a caller it is routed to", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue(rfiRow());
    await expect(rfiService.deleteRfi({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", userId: "user-y", projectAccess: partyY })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED" });
    expect(mockPrisma.rfi.update).not.toHaveBeenCalled();
  });

  it("starts a new revision through PATCH only for rfi.reopen (review finding R9)", () => {
    const sub = holds("rfi.submit");
    expect(() => assert({ existing: rfiRow({ status: "answered", officialResponseId: "resp-1" }), payload: { bumpRevision: true }, canTransition: sub })).toThrow(expect.objectContaining({ code: "FORBIDDEN", status: 403, details: expect.objectContaining({ transition: "rfi.reopen", fields: ["bumpRevision"] }) }));
    expect(() => assert({ payload: { subject: "s", bumpRevision: true }, canTransition: sub })).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => assert({ existing: rfiRow(), payload: { bumpRevision: false, discipline: "Civil" }, canTransition: sub })).not.toThrow();
    expect(() => assert({ existing: rfiRow({ status: "answered" }), payload: { bumpRevision: true }, canTransition: holds("rfi.reopen") })).not.toThrow();
  });

  it("keeps a closed RFI's impact figures to whoever closes RFIs (review finding R8)", () => {
    const sub = holds("rfi.submit", "rfi.answer");
    // the stored amount comes back from the database as a Decimal (a string here)
    const closed = rfiRow({ status: "closed", costImpact: true, costImpactAmount: "1100", scheduleImpact: 3, scheduleImpactFlag: true });
    for (const payload of [{ costImpactAmount: 999999 }, { scheduleImpact: 40 }, { costImpact: false }, { scheduleImpactFlag: false }, { costImpactAmount: null }]) {
      expect(() => assert({ existing: closed, payload, canTransition: sub })).toThrow(expect.objectContaining({ code: "FORBIDDEN", details: expect.objectContaining({ transition: "rfi.close", fields: Object.keys(payload) }) }));
    }
    expect(() => assert({ existing: closed, payload: { discipline: "Civil", costImpact: true, costImpactAmount: 1100, scheduleImpact: "3", scheduleImpactFlag: true }, canTransition: sub })).not.toThrow();
    expect(() => assert({ existing: closed, payload: { costImpactAmount: 1200 }, canTransition: holds("rfi.close") })).not.toThrow();
    expect(() => assert({ existing: rfiRow({ costImpact: true, costImpactAmount: "1100" }), payload: { costImpactAmount: 1500 }, canTransition: sub })).not.toThrow();
    // reopened in the same request (rfi.reopen), the figures are open again
    expect(() => assert({ existing: closed, payload: { status: "open", costImpactAmount: 1500 }, canTransition: holds("rfi.reopen") })).not.toThrow();
  });

  it("leaves no edge into draft, nor from closed to answered: the transition table refuses them before anything is kept (review findings R1, R6 — refuted)", async () => {
    const everything = holds("rfi.submit", "rfi.answer", "rfi.reopen", "rfi.reject", "rfi.close");
    for (const [from, payload] of [["closed", { status: "draft" }], ["answered", { status: "draft" }], ["open", { status: "draft" }], ["closed", { status: "answered", response: "rewritten" }]]) {
      mockPrisma.rfi.findFirst.mockResolvedValue(rfiRow({ status: from }));
      mockPrisma.rfi.update.mockImplementation(async ({ data }) => ({ ...rfiRow({ status: from }), ...data }));
      await expect(rfiService.updateRfi({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", payload, userId: "user-x", userRole: "pm", canTransition: everything })).rejects.toMatchObject({ code: "APPROVAL_WORKFLOW_INVALID_TRANSITION", status: 409, details: expect.objectContaining({ fromStatus: from, toStatus: payload.status }) });
    }
  });
});

describe("submittal decisions through create / update", () => {
  const assert = submittalService.assertDirectSubmittalChange;

  it("needs the action's transition for a status the caller sets directly", () => {
    const sub = holds("submittal.submit", "submittal.resubmit");
    expect(() => assert({ existing: submittalRow(), payload: { status: "approved" }, canTransition: sub })).toThrow(expect.objectContaining({ code: "FORBIDDEN", details: expect.objectContaining({ transition: "submittal.approve" }) }));
    expect(() => assert({ existing: submittalRow(), payload: { status: "rejected" }, canTransition: sub })).toThrow(expect.objectContaining({ details: expect.objectContaining({ transition: "submittal.reject" }) }));
    expect(() => assert({ existing: submittalRow(), payload: { status: "resubmit" }, canTransition: sub })).toThrow(expect.objectContaining({ details: expect.objectContaining({ transition: "submittal.reject" }) }));
    expect(() => assert({ payload: { status: "approved" }, canTransition: sub })).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => assert({ existing: submittalRow({ status: "pending" }), payload: { status: "under_review" }, canTransition: sub })).not.toThrow();
    expect(() => assert({ payload: {}, canTransition: sub })).not.toThrow();
    expect(() => assert({ existing: submittalRow(), payload: { status: "approved" }, canTransition: holds("submittal.approve") })).not.toThrow();
  });

  it("keeps the review outcome to those who approve", () => {
    const sub = holds("submittal.submit");
    expect(() => assert({ existing: submittalRow(), payload: { responseCode: "approved" }, canTransition: sub })).toThrow(expect.objectContaining({ details: expect.objectContaining({ fields: ["responseCode"] }) }));
    expect(() => assert({ existing: submittalRow({ responseCode: "approved" }), payload: { responseCode: "approved" }, canTransition: sub })).not.toThrow();
    expect(() => assert({ existing: submittalRow(), payload: { responseCode: "approved_as_noted" }, canTransition: holds("submittal.approve") })).not.toThrow();
  });

  it("answers 409 WORKFLOW_RUNNING to a status sent while a workflow decides the record, and not to internal callers", async () => {
    mockPrisma.submittal.findFirst.mockResolvedValue(submittalRow());
    mockPrisma.workflowInstance.findFirst.mockResolvedValue({ id: "inst-1", templateId: "wt-1", currentStepKey: "review", template: { name: "Second review" } });
    await expect(submittalService.updateSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { status: "approved" }, userId: "user-pm", userRole: "pm", canTransition: holds("submittal.approve") })).rejects.toMatchObject({ code: "WORKFLOW_RUNNING", status: 409 });
    expect(mockPrisma.workflowInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tool: "submittal", recordId: "sub-1", projectId: "project-1" }) }));
    expect(mockPrisma.submittal.update).not.toHaveBeenCalled();
  });

  it("archives a submittal only for a caller it is routed to", async () => {
    mockPrisma.submittal.findFirst.mockResolvedValue(submittalRow());
    await expect(submittalService.deleteSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", userId: "user-y", projectAccess: partyY })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED" });
    expect(mockPrisma.submittal.update).not.toHaveBeenCalled();
  });

  it("keeps a decided submittal's review stamp to submittal.approve (review finding R8)", () => {
    const sub = holds("submittal.submit", "submittal.resubmit");
    const reviewedOn = new Date("2026-10-01T00:00:00Z");
    const approvedRow = submittalRow({ status: "approved", responseCode: "approved", reviewedOn, remarks: "Approved as drawn" });
    expect(() => assert({ existing: approvedRow, payload: { reviewedOn: "2020-01-01T00:00:00Z" }, canTransition: sub })).toThrow(expect.objectContaining({ code: "FORBIDDEN", details: expect.objectContaining({ transition: "submittal.approve", fields: ["reviewedOn"] }) }));
    expect(() => assert({ existing: approvedRow, payload: { remarks: "Approved without comment" }, canTransition: sub })).toThrow(expect.objectContaining({ details: expect.objectContaining({ fields: ["remarks"] }) }));
    for (const status of ["rejected", "resubmit"]) {
      expect(() => assert({ existing: submittalRow({ status, reviewedOn }), payload: { reviewedOn: null }, canTransition: sub })).toThrow(expect.objectContaining({ details: expect.objectContaining({ fields: ["reviewedOn"] }) }));
      // a returned submittal's notes are the submitter's until it is sent again
      expect(() => assert({ existing: submittalRow({ status, reviewedOn, remarks: "Wrong glass" }), payload: { remarks: "Glass changed to spec" }, canTransition: sub })).not.toThrow();
    }
    expect(() => assert({ existing: approvedRow, payload: { reviewedOn: reviewedOn.toISOString(), remarks: " Approved as drawn ", discipline: "Civil" }, canTransition: sub })).not.toThrow();
    expect(() => assert({ existing: approvedRow, payload: { remarks: "PM note" }, canTransition: holds("submittal.approve") })).not.toThrow();
    expect(() => assert({ existing: submittalRow(), payload: { reviewedOn: "2026-10-02T00:00:00Z" }, canTransition: sub })).not.toThrow();
  });

  it("leaves no edge out of a decision or out of review to pending: the transition table refuses them (review finding R2 — refuted)", async () => {
    const everything = holds("submittal.submit", "submittal.resubmit", "submittal.approve", "submittal.reject");
    for (const [from, to] of [["approved", "pending"], ["approved", "under_review"], ["under_review", "pending"], ["rejected", "pending"], ["resubmit", "pending"]]) {
      const row = submittalRow({ status: from, activityId: null, revision: null });
      mockPrisma.submittal.findFirst.mockResolvedValue(row);
      mockPrisma.submittal.update.mockImplementation(async ({ data }) => ({ ...row, ...data }));
      await expect(submittalService.updateSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { status: to }, userId: "user-x", userRole: "pm", canTransition: everything })).rejects.toMatchObject({ code: "APPROVAL_WORKFLOW_INVALID_TRANSITION", status: 409, details: expect.objectContaining({ fromStatus: from, toStatus: to }) });
    }
  });
});
