const mockPrisma = {
  project: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  company: { findMany: jest.fn() },
  projectParty: { findMany: jest.fn() },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../approval-workflow.service", () => ({
  listEventsForRecords: jest.fn(async () => new Map()),
}));
// who may link a document is decided in document-text.service (certification R29, R32)
const mockDocumentText = {
  assertDocumentsLinkable: jest.fn(async () => undefined),
  documentWriterViewer: jest.fn(async () => null),
  documentViewer: jest.fn(({ userId, canRead }) => ({ id: userId, userId, canRead, partyIds: null, companyIds: null })),
};
jest.mock("../document-text.service", () => mockDocumentText);

const service = require("../workflow-support.service");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const COMPANY = "33333333-3333-4333-8333-333333333333";

describe("the body's primary activity (certification CERT-2)", () => {
  const OWN = "44444444-4444-4444-8444-444444444444";
  const OTHER = "55555555-5555-4555-8555-555555555555";
  const tx = { activity: { findMany: jest.fn(async ({ where }) => (where.id.in.includes(OWN) && where.projectId === "project-1" ? [{ id: OWN }] : [])) } };

  it("answers another company's activity, and one that exists nowhere, with the links' 400", async () => {
    await expect(service.assertPayloadActivity({ tx, projectId: "project-1", payload: { activityId: OTHER } })).rejects.toMatchObject({ status: 400, code: "WORKFLOW_ACTIVITY_NOT_FOUND" });
    expect(tx.activity.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { projectId: "project-1", id: { in: [OTHER] } } }));
  });

  it("checks it beside activity links too, and passes the project's own or none", async () => {
    await expect(service.assertPayloadActivity({ tx, projectId: "project-1", payload: { activityId: OTHER, activityLinks: [{ activityId: OWN }] } })).rejects.toMatchObject({ code: "WORKFLOW_ACTIVITY_NOT_FOUND" });
    await expect(service.assertPayloadActivity({ tx, projectId: "project-1", payload: { activityId: OWN } })).resolves.toBeUndefined();
    tx.activity.findMany.mockClear();
    await expect(service.assertPayloadActivity({ tx, projectId: "project-1", payload: { activityId: null } })).resolves.toBeUndefined();
    expect(tx.activity.findMany).not.toHaveBeenCalled();
  });

  // The row carries the first link, so a link outside the project reached the
  // row's foreign key before the links' check: 400 for another company's
  // activity, 500 for one that exists nowhere (CERT-2 existence oracle).
  it("checks every activity the links name too, as normalizeActivityLinks reads them", async () => {
    for (const payload of [{ activityIds: [OTHER] }, { activityLinks: [{ activityId: OTHER }] }, { activityLinks: [{ activityId: OWN }, { id: OTHER }] }, { activityIds: [OWN, OTHER] }, { activityId: OWN, activityLinks: [{ activityId: OTHER }] }]) {
      await expect(service.assertPayloadActivity({ tx, projectId: "project-1", payload })).rejects.toMatchObject({ status: 400, code: "WORKFLOW_ACTIVITY_NOT_FOUND" });
    }
    expect(tx.activity.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { projectId: "project-1", id: { in: [OWN, OTHER] } } }));
    await expect(service.assertPayloadActivity({ tx, projectId: "project-1", payload: { activityIds: [OWN], activityLinks: [{ activityId: OWN, relationType: "primary" }, ""] } })).resolves.toBeUndefined();
    // activityLinks wins over activityIds, which is then neither stored nor checked.
    await expect(service.assertPayloadActivity({ tx, projectId: "project-1", payload: { activityLinks: [{ activityId: OWN }], activityIds: [OTHER] } })).resolves.toBeUndefined();
  });

  // A blank / whitespace-only activityId is a record whose route lacks an
  // activityId validator (transmittals): it must be treated as absent, not
  // carried to Prisma as { activityId: null } / id in [null] — a 500.
  it("treats a blank or whitespace activityId as absent, consistently, and never queries for it", async () => {
    for (const blank of ["", "   ", "\t", "\n"]) {
      expect(service.normalizeActivityLinks({ activityId: blank })).toEqual([]);
      tx.activity.findMany.mockClear();
      await expect(service.assertPayloadActivity({ tx, projectId: "project-1", payload: { activityId: blank } })).resolves.toBeUndefined();
      expect(tx.activity.findMany).not.toHaveBeenCalled();
    }
    // A real id still becomes one primary link and is checked.
    expect(service.normalizeActivityLinks({ activityId: OWN })).toEqual([{ activityId: OWN, relationType: "primary", scheduleImpactDays: 0, notes: null }]);
  });

  it("refuses a value that is not one string exactly like a missing activity, without a query", async () => {
    for (const payload of [{ activityId: [OWN] }, { activityId: { id: OWN } }, { activityId: 12345 }, { activityLinks: [{ activityId: [OWN] }] }, { activityLinks: [{ activityId: { not: "x" } }] }, { activityLinks: [{ activityId: 12345 }] }, { activityIds: [{ id: [OWN] }] }]) {
      tx.activity.findMany.mockClear();
      await expect(service.assertPayloadActivity({ tx, projectId: "project-1", payload })).rejects.toMatchObject({ status: 400, code: "WORKFLOW_ACTIVITY_NOT_FOUND", message: "One or more linked activities were not found in this project" });
      expect(tx.activity.findMany).not.toHaveBeenCalled();
    }
  });
});

describe("ball in court", () => {
  it("routes to the reviewer while open and back to the originator after a decision", () => {
    const refs = { ownerUserId: USER_A, reviewerUserId: USER_B };
    expect(service.deriveBallInCourt({ status: "open", refs })).toBe(USER_B);
    expect(service.deriveBallInCourt({ status: "under_review", refs })).toBe(USER_B);
    expect(service.deriveBallInCourt({ status: "answered", refs })).toBe(USER_A);
    expect(service.deriveBallInCourt({ status: "resubmit", refs })).toBe(USER_A);
    expect(service.deriveBallInCourt({ status: "closed", refs })).toBeNull();
    expect(service.deriveBallInCourt({ status: "approved", refs })).toBeNull();
  });

  it("falls back through approver, assignee and owner", () => {
    expect(
      service.deriveBallInCourt({ status: "open", refs: { approverUserId: USER_B } }),
    ).toBe(USER_B);
    expect(
      service.deriveBallInCourt({ status: "pending", refs: { assigneeUserId: USER_A } }),
    ).toBe(USER_A);
    expect(service.deriveBallInCourt({ status: "open", refs: {} })).toBeNull();
  });
});

describe("workflowAssignmentData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findMany.mockResolvedValue([
      { id: USER_A, name: "Amira Owner", email: "amira@example.com" },
      { id: USER_B, name: "Bilal Reviewer", email: "bilal@example.com" },
    ]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: COMPANY }]);
  });

  it("keeps the legacy text fields when only text is provided", async () => {
    const data = await service.workflowAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: { owner: "Someone", reviewer: " R ", approver: null },
      status: "open",
    });
    expect(data).toMatchObject({ owner: "Someone", reviewer: "R", approver: null });
    expect(data.ballInCourtUserId).toBeNull();
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("validates ids against the organisation and mirrors names into text columns", async () => {
    const data = await service.workflowAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: {
        ownerUserId: USER_A,
        reviewerUserId: USER_B,
        assigneeUserId: USER_A,
        assigneeCompanyId: COMPANY,
      },
      status: "open",
      assigneeTextField: "responsible",
    });

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1", id: { in: [USER_A, USER_B] } }),
      }),
    );
    expect(data).toMatchObject({
      ownerUserId: USER_A,
      reviewerUserId: USER_B,
      assigneeUserId: USER_A,
      assigneeCompanyId: COMPANY,
      owner: "Amira Owner",
      reviewer: "Bilal Reviewer",
      responsible: "Amira Owner",
      ballInCourtUserId: USER_B,
    });
  });

  it("does not overwrite explicit text with the mirrored name", async () => {
    const data = await service.workflowAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: { ownerUserId: USER_A, owner: "Custom label" },
      status: "open",
    });
    expect(data.owner).toBe("Custom label");
    expect(data.ownerUserId).toBe(USER_A);
  });

  it("rejects users and companies outside the organisation", async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    await expect(
      service.workflowAssignmentData({
        orgId: "org-1",
        projectId: "project-1",
        payload: { ownerUserId: USER_A },
        status: "open",
      }),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_USER_NOT_FOUND" });

    mockPrisma.user.findMany.mockResolvedValue([{ id: USER_A, name: "A" }]);
    mockPrisma.company.findMany.mockResolvedValue([]);
    await expect(
      service.workflowAssignmentData({
        orgId: "org-1",
        projectId: "project-1",
        payload: { assigneeCompanyId: COMPANY },
        status: "open",
      }),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_COMPANY_NOT_FOUND" });
  });

  it("recomputes ball in court from existing references on a status change", async () => {
    const data = await service.workflowAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: { status: "answered" },
      existing: { ownerUserId: USER_A, reviewerUserId: USER_B, owner: "Amira Owner" },
      status: "answered",
    });
    expect(data.ballInCourtUserId).toBe(USER_A);
    expect(data.owner).toBe("Amira Owner");
    expect(data.ownerUserId).toBeUndefined();
  });

  it("honours an explicit ball-in-court override", async () => {
    const data = await service.workflowAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: { ballInCourtUserId: USER_B },
      existing: { ownerUserId: USER_A },
      status: "closed",
    });
    expect(data.ballInCourtUserId).toBe(USER_B);
  });

  it("resolves the org from the project when the caller omits it", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ orgId: "org-9" });
    await service.workflowAssignmentData({
      projectId: "project-1",
      payload: { ownerUserId: USER_A },
      status: "open",
    });
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: "org-9" }) }),
    );
  });
});

describe("workflowPartyAssignmentData", () => {
  it("copies the routed party's company into assigneeCompanyId", async () => {
    mockPrisma.projectParty.findMany.mockResolvedValue([
      { id: "party-1", companyId: COMPANY, company: { id: COMPANY, name: "Consult Co" } },
    ]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: COMPANY }]);
    const data = await service.workflowPartyAssignmentData({
      orgId: "org-1",
      projectId: "project-1",
      payload: { reviewerPartyId: "party-1" },
      status: "open",
    });
    expect(data.reviewerPartyId).toBe("party-1");
    expect(data.reviewer).toBe("Consult Co");
    expect(data.assigneeCompanyId).toBe(COMPANY);
  });
});

describe("assignmentUserIds and reference serialization", () => {
  it("collects unique user ids from the reference columns only", () => {
    expect(
      service.assignmentUserIds({
        ownerUserId: USER_A,
        reviewerUserId: USER_A,
        approverUserId: "not-a-uuid",
        assigneeUserId: USER_B,
        owner: "Free text",
      }),
    ).toEqual([USER_A, USER_B]);
  });

  it("attaches user and company objects to rows", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: USER_A, name: "Amira", email: "a@x" }]);
    mockPrisma.company.findMany.mockResolvedValue([{ id: COMPANY, name: "Consult Co" }]);
    const [row] = await service.attachAssignmentReferences({
      rows: [{ id: "r1", ownerUserId: USER_A, assigneeCompanyId: COMPANY, ballInCourtUserId: USER_B }],
    });
    expect(row.ownerUser).toEqual({ id: USER_A, name: "Amira", email: "a@x" });
    expect(row.assigneeCompany).toEqual({ id: COMPANY, name: "Consult Co" });
    expect(row.ballInCourtUser).toEqual({ id: USER_B, name: null, email: null });
    expect(row.reviewerUser).toBeNull();
  });
});

describe("certification R29 — a record's references name only documents its writer may read", () => {
  const DOC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const KEPT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const txFor = (over = {}) => ({
    workflowAttachment: {
      findMany: jest.fn(async () => [{ storageKey: KEPT }]),
      deleteMany: jest.fn(async () => ({})),
      createMany: jest.fn(async () => ({})),
    },
    workflowActivityLink: { deleteMany: jest.fn(), createMany: jest.fn() },
    ...over,
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockDocumentText.assertDocumentsLinkable.mockImplementation(async () => undefined);
  });

  it("asks the guard about every referenced key before any reference is replaced, with the record's own references kept", async () => {
    const tx = txFor();
    await service.syncWorkflowReferences({
      tx,
      projectId: "project-1",
      recordType: "punch_item",
      recordId: "punch-1",
      payload: { attachmentRefs: [{ storageKey: DOC, fileName: "a.pdf" }, { storageKey: KEPT, fileName: "b.pdf" }] },
      userId: USER_A,
    });
    const call = mockDocumentText.assertDocumentsLinkable.mock.calls[0][0];
    expect(call).toMatchObject({ projectId: "project-1", keys: [DOC, KEPT] });
    expect(await call.unchanged()).toEqual([KEPT]);
    expect(await call.userId()).toBe(USER_A);
    expect(call.refuse()).toMatchObject({ status: 404, code: "FILE_NOT_FOUND" });
    expect(tx.workflowAttachment.createMany).toHaveBeenCalled();
  });

  it("a refused reference writes nothing", async () => {
    const tx = txFor();
    mockDocumentText.assertDocumentsLinkable.mockImplementation(async ({ refuse }) => { throw refuse(); });
    await expect(service.syncWorkflowReferences({
      tx, projectId: "project-1", recordType: "rfi", recordId: "rfi-1", payload: { attachmentRefs: [{ storageKey: DOC }] }, userId: USER_A,
    })).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    expect(tx.workflowAttachment.deleteMany).not.toHaveBeenCalled();
    expect(tx.workflowAttachment.createMany).not.toHaveBeenCalled();
  });

  it("on a create whose caller passes no user, the record's author is the writer", async () => {
    const tx = txFor({ rfi: { findUnique: jest.fn(async () => ({ createdBy: USER_B })) } });
    await service.syncWorkflowReferences({ tx, projectId: "project-1", recordType: "rfi", recordId: "rfi-1", payload: { attachmentRefs: [{ storageKey: DOC }] } });
    expect(await mockDocumentText.assertDocumentsLinkable.mock.calls[0][0].userId()).toBe(USER_B);
    const drawingTx = txFor();
    await service.syncWorkflowReferences({ tx: drawingTx, projectId: "project-1", recordType: "drawing", recordId: "dwg-1", payload: { attachmentRefs: [{ storageKey: DOC }] } });
    expect(await mockDocumentText.assertDocumentsLinkable.mock.calls[1][0].userId()).toBeNull();
  });
});

describe("certification R32 — revisions filed through a record's payload", () => {
  const DOC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const txFor = (filed = []) => ({
    documentRevision: {
      findMany: jest.fn(async () => filed.map((revision) => ({ revision }))),
      createMany: jest.fn(async () => ({})),
    },
  });
  const record = { id: "dwg-1", status: "active", revision: null, title: "Plan" };
  const write = (tx, payload, extra = {}) =>
    service.recordDocumentRevisions({ tx, projectId: "project-1", recordType: "drawing", record, payload, userId: USER_A, ...extra });
  const rowsOf = (tx) => tx.documentRevision.createMany.mock.calls[0][0].data;
  beforeEach(() => {
    jest.clearAllMocks();
    mockDocumentText.assertDocumentsLinkable.mockImplementation(async () => undefined);
  });

  it("clamps an approved, latest or attributed revision to a plain uploaded one — approval is the doc-control route's", async () => {
    const tx = txFor();
    await write(tx, { revisions: [{ revision: "C", status: "approved", isLatest: true, approvedBy: USER_B, approvedAt: "2020-01-01", supersededBy: USER_B, projectDocumentId: DOC }] });
    const row = rowsOf(tx).find((r) => r.revision === "C");
    expect(row).toMatchObject({ status: "uploaded", isLatest: false, approvedBy: null, approvedAt: null, supersededBy: null, supersededAt: null });
    expect(row).not.toHaveProperty("source");
    expect(mockDocumentText.documentWriterViewer).not.toHaveBeenCalled(); // no writer identity needed to clamp
  });

  it("clamps the top-level revision fields too, and never files a latest revision", async () => {
    const tx = txFor();
    await write(tx, { revision: "E", status: "approved", isLatest: true, approvedBy: USER_B });
    const row = rowsOf(tx).find((r) => r.revision === "E");
    expect(row).toMatchObject({ status: "uploaded", isLatest: false, approvedBy: null, supersededBy: null });
  });

  it("the file each new revision names is put to the guard as the writer; a revision the record already has is neither judged nor written again", async () => {
    const tx = txFor(["A"]);
    await write(tx, { revisions: [{ revision: "A", status: "approved", projectDocumentId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }, { revision: "B", projectDocumentId: DOC }] });
    const call = mockDocumentText.assertDocumentsLinkable.mock.calls[0][0];
    // revision B's id and storage key; "A" is already filed; the first revision "1" names no file
    expect(call.keys.filter(Boolean)).toEqual([DOC, DOC]);
    expect(call.userId).toBe(USER_A);
    expect(call.refuse()).toMatchObject({ status: 404, code: "FILE_NOT_FOUND" });
    mockDocumentText.assertDocumentsLinkable.mockImplementation(async ({ refuse }) => { throw refuse(); });
    const refused = txFor();
    await expect(write(refused, { revisions: [{ revision: "B", projectDocumentId: DOC }] })).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    expect(refused.documentRevision.createMany).not.toHaveBeenCalled();
  });

  it("on a create with no user, the record's author is the writer put to the file guard", async () => {
    const tx = { ...txFor(), rfi: { findUnique: jest.fn(async () => ({ createdBy: USER_B })) } };
    await service.recordDocumentRevisions({ tx, projectId: "project-1", recordType: "rfi", record: { id: "rfi-1", status: "open" }, payload: { revisions: [{ revision: "B", projectDocumentId: DOC }] } });
    expect(mockDocumentText.assertDocumentsLinkable.mock.calls[0][0].userId).toBe(USER_B);
  });
});
