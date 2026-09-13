const { referenceCounterMock } = require("./helpers/reference-counter-mock");
const mockPrisma = {
  ...referenceCounterMock(),
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async () => ({ id: "project-1", name: "Tower", currency: "USD", defaultRetentionRate: 10 })) },
  company: { findFirst: jest.fn(async () => ({ id: "vendor-1", isVendor: true })), update: jest.fn(async () => ({})) },
  projectParty: { findFirst: jest.fn(async () => ({ id: "party-1" })) },
  projectPartyMember: { findMany: jest.fn(async () => [{ userId: "sub-user" }]) },
  procurementSupplier: { findFirst: jest.fn(async () => null) },
  costCode: { findMany: jest.fn(async ({ where }) => (where.id?.in || []).map((id) => ({ id }))) },
  budgetLine: { findMany: jest.fn(async () => []), update: jest.fn(async () => ({})) },
  boqItem: { findMany: jest.fn(async ({ where }) => (where.id?.in || []).map((id) => ({ id }))) },
  activity: { findMany: jest.fn(async ({ where }) => (where.id?.in || []).map((id) => ({ id }))) },
  costRecord: { findMany: jest.fn(async () => []), update: jest.fn(async () => ({})), create: jest.fn(async () => ({})) },
  commitment: { aggregate: jest.fn(async () => ({ _max: { number: 2 } })), create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(async () => []), update: jest.fn() },
  commitmentSovLine: { deleteMany: jest.fn(async () => ({ count: 0 })), create: jest.fn(async ({ data }) => ({ id: "line", ...data })) },
  commitmentChangeOrder: { aggregate: jest.fn(async () => ({ _max: { number: 0 } })), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  changeOrder: { findFirst: jest.fn(async () => ({ id: "co-1", ref: "VO-01", value: 5000, description: "Extra excavation" })) },
  projectDocument: { findFirst: jest.fn(async () => ({ id: "doc-1" })) },
};
const mockAudit = { ENTITY_TYPES: { COMMITMENT: "commitment", COMMITMENT_CHANGE_ORDER: "commitment_change_order" }, ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", APPROVED: "approved", REJECTED: "rejected" }, recordEvent: jest.fn(async () => ({})) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { APPROVAL: "approval", COMMERCIAL: "commercial" }, createNotifications: jest.fn(async () => ({ created: 1 })) };
const mockFiles = { DOCUMENT_TYPES: { WORKFLOW_ATTACHMENT: "workflow_attachment" }, uploadProjectDocument: jest.fn(async () => ({ id: "doc-uploaded" })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../file-storage.service", () => mockFiles);
jest.mock("../company-party.service", () => ({ isPartyScopedAccess: (access) => Boolean(access?.partyScoped) }));

const service = require("../commitment.service");

const line = (overrides = {}) => ({ id: "l1", lineNumber: 1, description: "Formwork", costCodeId: "code-1", budgetLineId: null, boqItemId: null, activityId: "act-1", unit: "m2", qty: 100, rate: 50, amount: 5000, sortOrder: 0, costCode: { id: "code-1", code: "03-100", name: "Formwork" }, ...overrides });
const commitment = (overrides = {}) => ({
  id: "cm-1",
  projectId: "project-1",
  number: 1,
  ref: "SC-001",
  type: "subcontract",
  title: "Concrete package",
  status: "draft",
  currency: "USD",
  vendorCompanyId: "vendor-1",
  projectPartyId: "party-1",
  retentionRate: 10,
  insuranceJson: [],
  lines: [line(), line({ id: "l2", lineNumber: 2, description: "Rebar", activityId: "act-2", amount: 7000, qty: 1, rate: 7000 })],
  changeOrders: [],
  procurementOrders: [],
  vendorCompany: { id: "vendor-1", name: "ACME Concrete" },
  createdBy: "user-qs",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("commitments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.commitment.create.mockImplementation(async ({ data }) => commitment({ ...data, id: "cm-new", lines: (data.lines?.create || []).map((row, index) => ({ id: `nl${index}`, ...row })) }));
    mockPrisma.commitment.update.mockImplementation(async ({ data }) => commitment({ ...data }));
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment());
  });

  it("validates schedule-of-values lines and computes amounts", () => {
    expect(() => service.normalizeLines([{ qty: 1 }])).toThrow(expect.objectContaining({ code: "COMMITMENT_LINE_DESCRIPTION_REQUIRED" }));
    const lines = service.normalizeLines([{ description: "Formwork", qty: "100", rate: "50.005" }, { description: "Lump sum", amount: 12000 }]);
    expect(lines[0]).toMatchObject({ lineNumber: 1, qty: 100, rate: 50.01, amount: 5000.5 });
    expect(lines[1]).toMatchObject({ lineNumber: 2, qty: 1, rate: 12000, amount: 12000 });
  });

  it("derives totals and insurance status", () => {
    const row = commitment({ changeOrders: [{ status: "approved", value: 1000 }, { status: "pending", value: 500 }, { status: "rejected", value: 999 }], insuranceJson: [{ type: "general_liability", required: true }, { type: "auto", required: true, documentId: "d", expiresAt: "2020-01-01" }, { type: "bond", required: false }] });
    const data = service.serialize(row);
    expect(data).toMatchObject({ original: 12000, approvedChanges: 1000, pendingChanges: 500, revised: 13000, retentionOnRevised: 1300, insuranceReady: false });
    expect(data.insurance.map((entry) => entry.status)).toEqual(["missing", "expired", "optional"]);
  });

  it("creates a numbered draft with the project's retention and the vendor's party", async () => {
    const created = await service.createCommitment({ orgId: "org-1", projectId: "project-1", payload: { type: "subcontract", title: "Concrete package", vendorCompanyId: "vendor-1", lines: [{ description: "Formwork", qty: 100, rate: 50, costCodeId: "code-1", activityId: "act-1" }] }, actor: { id: "user-qs", role: "qs" } });
    expect(mockPrisma.commitment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ number: 3, ref: "SC-003", retentionRate: 10, vendorCompanyId: "vendor-1", projectPartyId: "party-1", status: "draft" }) }));
    expect(created.ref).toBe("SC-003");
    expect(created.original).toBe(5000);
  });

  it("party users only see their own commitments", () => {
    expect(service.visibilityWhere({ id: "u", projectAccess: {} })).toBeNull();
    expect(service.visibilityWhere({ id: "sub-user", projectAccess: { partyScoped: true, partyAccess: [{ companyId: "vendor-1" }] } })).toEqual({ OR: [{ vendorCompanyId: { in: ["vendor-1"] } }, { createdBy: "sub-user" }] });
  });

  it("walks draft → pending → approved → executed and posts committed cost", async () => {
    await expect(service.approveCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", actor: { id: "pm" } })).rejects.toMatchObject({ code: "COMMITMENT_TRANSITION_INVALID" });
    await service.submitCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", actor: { id: "user-qs" } });
    expect(mockPrisma.commitment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "pending", submittedBy: "user-qs" }) }));
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "commitment.submitted", recipientRoles: ["pm"] }));

    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "approved", insuranceJson: [{ type: "general_liability", required: true }] }));
    await expect(service.executeCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", actor: { id: "pm" }, documentId: "doc-1" })).rejects.toMatchObject({ code: "COMMITMENT_INSURANCE_MISSING" });
    await expect(service.executeCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", actor: { id: "pm" }, documentId: "doc-1", override: true, canOverride: true })).rejects.toMatchObject({ code: "COMMITMENT_OVERRIDE_REASON_REQUIRED" });

    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "approved", insuranceJson: [{ type: "general_liability", required: true, documentId: "cert" }] }));
    mockPrisma.commitment.findMany.mockResolvedValue([{ id: "cm-1", type: "subcontract", lines: [{ amount: 5000, budgetLineId: null, costCodeId: "code-1", activityId: "act-1" }, { amount: 7000, budgetLineId: "bl-x", costCodeId: null, activityId: "act-2" }], changeOrders: [{ value: 1000, linesJson: [] }] }]);
    mockPrisma.budgetLine.findMany.mockResolvedValue([{ id: "bl-1", costCodeId: "code-1", costType: "subcontract", status: "active" }, { id: "bl-x", costCodeId: "code-9", costType: "material", status: "active" }, { id: "bl-mat", costCodeId: "code-1", costType: "material", status: "active" }]);
    mockPrisma.costRecord.findMany.mockResolvedValue([{ id: "cr-1", activityId: "act-1" }]);
    const executed = await service.executeCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", actor: { id: "pm" }, file: { path: "/tmp/x.pdf", originalname: "agreement.pdf", mimetype: "application/pdf", size: 10 } });
    expect(mockFiles.uploadProjectDocument).toHaveBeenCalledWith(expect.objectContaining({ linkedEntityType: "commitment", linkedEntityId: "cm-1" }));
    expect(mockPrisma.commitment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "executed", executedDocumentId: "doc-uploaded" }) }));
    expect(executed.status).toBe("executed");
    // subcontract lines land on the cost code's subcontract line; explicit budget lines win; CO without lines posts nowhere by line
    expect(mockPrisma.budgetLine.update).toHaveBeenCalledWith({ where: { id: "bl-1" }, data: { committedFromCommitments: 5000 } });
    expect(mockPrisma.budgetLine.update).toHaveBeenCalledWith({ where: { id: "bl-x" }, data: { committedFromCommitments: 7000 } });
    expect(mockPrisma.budgetLine.update).toHaveBeenCalledWith({ where: { id: "bl-mat" }, data: { committedFromCommitments: 0 } });
    expect(mockPrisma.costRecord.update).toHaveBeenCalledWith({ where: { id: "cr-1" }, data: { committed: 5000 } });
    expect(mockPrisma.costRecord.create).toHaveBeenCalledWith({ data: { projectId: "project-1", activityId: "act-2", committed: 7000 } });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "commitment.executed", recipientUserIds: expect.arrayContaining(["sub-user"]) }));
  });

  it("locks the schedule of values after approval", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "approved" }));
    await expect(service.replaceLines({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", payload: { lines: [{ description: "x", amount: 1 }] } })).rejects.toMatchObject({ code: "COMMITMENT_LOCKED" });
    await expect(service.updateCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", payload: { retentionRate: 3 } })).rejects.toMatchObject({ code: "COMMITMENT_LOCKED" });
  });

  it("change orders: prime spawns drafts, approval on an executed commitment posts committed cost", async () => {
    mockPrisma.commitmentChangeOrder.create.mockImplementation(async ({ data }) => ({ id: "cco-1", ...data, primeChangeOrder: { id: "co-1", ref: "VO-01", status: "approved" } }));
    const spawned = await service.spawnFromPrimeChangeOrder({ orgId: "org-1", projectId: "project-1", payload: { primeChangeOrderId: "co-1", items: [{ commitmentId: "cm-1", value: 2500 }] }, actor: { id: "user-qs" } });
    expect(spawned.items).toHaveLength(1);
    expect(mockPrisma.commitmentChangeOrder.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ref: "SC-001-CO01", value: 2500, primeChangeOrderId: "co-1", title: expect.stringContaining("VO-01") }) }));

    mockPrisma.commitmentChangeOrder.findFirst.mockResolvedValue({ id: "cco-1", ref: "SC-001-CO01", status: "pending", value: 2500, createdBy: "user-qs", commitment: { id: "cm-1", ref: "SC-001", status: "executed", projectPartyId: "party-1", createdBy: "user-qs", title: "Concrete package", type: "subcontract" } });
    mockPrisma.commitmentChangeOrder.update.mockImplementation(async ({ data }) => ({ id: "cco-1", ref: "SC-001-CO01", value: 2500, linesJson: [], ...data }));
    mockPrisma.commitment.findMany.mockResolvedValue([{ id: "cm-1", type: "subcontract", lines: [], changeOrders: [{ value: 2500, linesJson: [{ amount: 2500, costCodeId: "code-1", activityId: "act-1" }] }] }]);
    mockPrisma.budgetLine.findMany.mockResolvedValue([{ id: "bl-1", costCodeId: "code-1", costType: "subcontract", status: "active" }]);
    await service.transitionChangeOrder({ orgId: "org-1", projectId: "project-1", changeOrderId: "cco-1", to: "approved", actor: { id: "pm" } });
    expect(mockPrisma.budgetLine.update).toHaveBeenCalledWith({ where: { id: "bl-1" }, data: { committedFromCommitments: 2500 } });
    await expect(service.transitionChangeOrder({ orgId: "org-1", projectId: "project-1", changeOrderId: "cco-1", to: "rejected", actor: { id: "pm" } })).rejects.toMatchObject({ code: "COMMITMENT_CO_REASON_REQUIRED" });
  });

  it("renders a statement PDF", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "executed", executedAt: new Date(), changeOrders: [{ id: "c", number: 1, ref: "SC-001-CO01", title: "Extra", status: "approved", value: 100, linesJson: [] }], insuranceJson: [{ type: "bond", required: true, documentId: "d" }] }));
    const pdf = await service.exportStatementPdf({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1" });
    expect(pdf.fileName).toMatch(/^SC-001-Concrete-package\.pdf$/);
    expect(pdf.buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("Phase 21D — integrity (release challenge, second pass)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("CX21-427: replacing the schedule of values refuses once the commitment was approved under the lock", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "draft", lines: [line()] }));
    mockPrisma.commitmentSovLine.deleteMany.mockClear();
    const lock = jest.spyOn(mockPrisma, "$queryRaw").mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes('FROM "Commitment"') ? [{ status: "approved" }] : []));
    await expect(service.replaceLines({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", payload: { lines: [{ lineNumber: 1, description: "Formwork", amount: 200000 }] }, actor: { id: "qs" } })).rejects.toMatchObject({ code: "COMMITMENT_LOCKED" });
    expect(lock).toHaveBeenCalled();
    expect(mockPrisma.commitmentSovLine.deleteMany).not.toHaveBeenCalled();
  });
});

describe("Phase 21D — integrity (release challenge, third pass)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("CX21-433: an approval that started on a pending commitment refuses once the commitment moved under the lock", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "pending" }));
    mockPrisma.commitment.update.mockClear();
    const lock = jest.spyOn(mockPrisma, "$queryRaw").mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes('FROM "Commitment"') ? [{ status: "executed" }] : []));
    await expect(service.approveCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", actor: { id: "pm" } })).rejects.toMatchObject({ code: "COMMITMENT_STATE_CHANGED", status: 409 });
    expect(lock).toHaveBeenCalled();
    expect(mockPrisma.commitment.update).not.toHaveBeenCalled();
  });
});
