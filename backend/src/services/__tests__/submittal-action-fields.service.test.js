/**
 * Review findings R3 and R10 on submittals:
 *   R3  /submit, /resubmit and /review take only their own fields — the body
 *       is not spread into the update (a response code, a package, a status or
 *       any other field rode in past the checks PATCH makes);
 *   R10 a party member files a submittal (create or update) only into a
 *       package they can open; internal callers into any.
 * The update's collaborators are stubbed so the test sees exactly what is
 * written to the submittal row.
 */
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async () => ({ id: "project-1", orgId: "org-1" })) },
  submittal: { findFirst: jest.fn(), update: jest.fn(async ({ data }) => ({ id: "sub-1", projectId: "project-1", ...data })), create: jest.fn(async ({ data }) => ({ id: "sub-new", ...data })) },
  submittalPackage: { findMany: jest.fn(async ({ where }) => (where.id.in || []).map((id) => ({ id }))) },
  documentRevision: { count: jest.fn(async () => 1) },
  workflowInstance: { findFirst: jest.fn(async () => null) },
};
const mockAudit = { ENTITY_TYPES: { SUBMITTAL: "submittal" }, ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed" }, recordEvent: jest.fn() };
const mockApproval = { RECORD_TYPES: { SUBMITTAL: "submittal" }, recordTransition: jest.fn(async () => null) };
const mockSupport = {
  RECORD_TYPES: { SUBMITTAL: "submittal" },
  attachWorkflowDetailsToRecords: jest.fn(async ({ records }) => records),
  primaryActivityIdFromPayload: jest.fn((payload, existing = null) => (payload.activityId !== undefined ? payload.activityId : existing)),
  recordDocumentRevisions: jest.fn(async () => ({ revisionCount: 0 })),
  recordWorkflowHistory: jest.fn(async () => null),
  syncWorkflowReferences: jest.fn(async () => ({})),
  workflowPartyAssignmentData: jest.fn(async () => ({})),
};
const mockWorkflow = {
  onStatusChange: jest.fn(async () => ({})),
  afterStatusChange: jest.fn(async () => null),
  reviewDaysFor: jest.fn(() => 0),
  computeSubmitBy: jest.fn(() => null),
  getPackage: jest.fn(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../approval-workflow.service", () => mockApproval);
jest.mock("../workflow-support.service", () => mockSupport);
jest.mock("../submittal-workflow.service", () => mockWorkflow);
jest.mock("../../utils/reference-number", () => ({ nextRef: jest.fn(async () => "SUB-900") }));

const service = require("../submittal.service");

const row = (overrides = {}) => ({ id: "sub-1", projectId: "project-1", ref: "SUB-001", title: "Anchors", status: "pending", revision: "A", responseCode: null, responseCodeLabel: null, currentStepId: null, packageId: null, activityId: null, ownerPartyId: "party-x", reviewerPartyId: null, approverPartyId: null, archivedAt: null, ...overrides });
const partyX = { scope: "party", role: "external_party", assignmentRole: null, partyAccess: [{ projectPartyId: "party-x", role: "subcontractor" }] };
const written = () => mockPrisma.submittal.update.mock.calls[0][0].data;
const FORGED = { responseCode: "approved", responseCodeLabel: "Approved", currentStepId: "step-forged", packageId: "pkg-y", workflowTemplateId: "tpl-forged", managerUserId: "user-forged", title: "Renamed through the action", status: "approved" };

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkflow.getPackage.mockReset();
});

describe("the action routes take only their own fields (review finding R3)", () => {
  it("/submit keeps the revision evidence and the submitter's words, and nothing else", async () => {
    mockPrisma.submittal.findFirst.mockResolvedValue(row());
    await service.submitSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { revision: "B", comment: "for review", attachmentRefs: [{ storageKey: "k" }], ...FORGED }, userId: "user-x", userRole: "external_party", projectAccess: partyX });
    const data = written();
    expect(data).toMatchObject({ status: "under_review", revision: "B", title: "Anchors" });
    for (const field of ["responseCode", "responseCodeLabel", "currentStepId", "packageId", "workflowTemplateId", "managerUserId"]) expect(data).not.toHaveProperty(field);
    expect(mockSupport.syncWorkflowReferences).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ attachmentRefs: [{ storageKey: "k" }], comment: "for review" }) }));
    expect(mockSupport.syncWorkflowReferences.mock.calls[0][0].payload).not.toHaveProperty("responseCode");
    expect(mockWorkflow.getPackage).not.toHaveBeenCalled();
  });

  it("/review keeps the reviewer's comment and date, and nothing else", async () => {
    mockPrisma.submittal.findFirst.mockResolvedValue(row({ status: "under_review" }));
    await service.reviewSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { comment: "Check the edge distance", reviewedOn: "2026-10-02T00:00:00Z", ...FORGED }, userId: "user-planner", userRole: "planning_eng" });
    const data = written();
    expect(data).toMatchObject({ status: "under_review", remarks: "Check the edge distance", title: "Anchors" });
    expect(data.reviewedOn).toEqual(new Date("2026-10-02T00:00:00Z"));
    for (const field of ["responseCode", "responseCodeLabel", "currentStepId", "packageId", "workflowTemplateId", "managerUserId"]) expect(data).not.toHaveProperty(field);
  });

  it("/resubmit keeps the submitter's evidence on a returned submittal, and the PM's reason when requiring one", async () => {
    mockPrisma.submittal.findFirst.mockResolvedValue(row({ status: "rejected", responseCode: "rejected" }));
    await service.resubmitSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { revision: "C", reason: "revised", ...FORGED }, userId: "user-x", userRole: "external_party", projectAccess: partyX });
    let data = written();
    expect(data).toMatchObject({ status: "under_review", revision: "C" });
    for (const field of ["responseCode", "responseCodeLabel", "currentStepId", "packageId", "workflowTemplateId", "managerUserId"]) expect(data).not.toHaveProperty(field);

    jest.clearAllMocks();
    mockPrisma.submittal.findFirst.mockResolvedValue(row({ status: "under_review" }));
    await service.resubmitSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { reason: "Anchors undersized", ...FORGED }, userId: "user-pm", userRole: "pm" });
    data = written();
    expect(data).toMatchObject({ status: "resubmit", remarks: "Anchors undersized", title: "Anchors" });
    for (const field of ["responseCode", "packageId", "workflowTemplateId"]) expect(data).not.toHaveProperty(field);
  });
});

describe("a party member files a submittal only into a package they can open (review finding R10)", () => {
  const refusal = Object.assign(new Error("This package holds no submittal routed to your company"), { status: 403, code: "PROJECT_PARTY_RECORD_ACCESS_DENIED" });

  it("refuses a party member's PATCH into a package of another company, before anything is written", async () => {
    mockPrisma.submittal.findFirst.mockResolvedValue(row());
    mockWorkflow.getPackage.mockRejectedValue(refusal);
    await expect(service.updateSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { packageId: "pkg-y" }, userId: "user-x", userRole: "external_party", projectAccess: partyX })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED", status: 403 });
    expect(mockWorkflow.getPackage).toHaveBeenCalledWith({ orgId: "org-1", projectId: "project-1", packageId: "pkg-y", projectAccess: partyX, viewerId: "user-x" });
    expect(mockPrisma.submittal.update).not.toHaveBeenCalled();
  });

  it("refuses a party member raising a submittal inside another company's package", async () => {
    mockWorkflow.getPackage.mockRejectedValue(refusal);
    await expect(service.createSubmittal({ orgId: "org-1", projectId: "project-1", payload: { title: "Born in Y", packageId: "pkg-y" }, userId: "user-x", userRole: "external_party", projectAccess: partyX })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED" });
    expect(mockPrisma.submittal.create).not.toHaveBeenCalled();
  });

  it("lets the party member file into a package it opens, keep the one it is in, and internal callers file anywhere", async () => {
    mockPrisma.submittal.findFirst.mockResolvedValue(row());
    mockWorkflow.getPackage.mockResolvedValue({ id: "pkg-x" });
    await expect(service.updateSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { packageId: "pkg-x" }, userId: "user-x", userRole: "external_party", projectAccess: partyX })).resolves.toMatchObject({ packageId: "pkg-x" });
    expect(mockWorkflow.getPackage).toHaveBeenCalledTimes(1);

    mockWorkflow.getPackage.mockReset();
    mockPrisma.submittal.findFirst.mockResolvedValue(row({ packageId: "pkg-y" }));
    await service.updateSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { packageId: "pkg-y", discipline: "Civil" }, userId: "user-x", userRole: "external_party", projectAccess: partyX });
    await service.updateSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { packageId: "pkg-z" }, userId: "user-pm", userRole: "pm", projectAccess: { scope: "assignment", assignmentRole: "pm", partyAccess: [] } });
    await service.createSubmittal({ orgId: "org-1", projectId: "project-1", payload: { title: "PM item", packageId: "pkg-y" }, userId: "user-pm", userRole: "pm", projectAccess: null });
    expect(mockWorkflow.getPackage).not.toHaveBeenCalled();
    expect(mockPrisma.submittal.create).toHaveBeenCalled();
  });
});
