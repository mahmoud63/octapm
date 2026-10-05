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
  // The approved allocation a created record's default forecast is worked from (R5-2).
  activityBoqAllocation: { findMany: jest.fn(async ({ where }) => (where.activityId?.in || []).filter((id) => id === "act-2").map((activityId) => ({ activityId, quantity: 1, amount: 9000, weight: 0 }))) },
  commitment: { aggregate: jest.fn(async () => ({ _max: { number: 2 } })), create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(async () => []), update: jest.fn() },
  commitmentSovLine: { findMany: jest.fn(async () => []), deleteMany: jest.fn(async () => ({ count: 0 })), create: jest.fn(async ({ data }) => ({ id: "line", ...data })) },
  commitmentChangeOrder: { aggregate: jest.fn(async () => ({ _max: { number: 0 } })), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  changeOrder: { findFirst: jest.fn(async () => ({ id: "co-1", ref: "VO-01", value: 5000, description: "Extra excavation" })) },
  projectDocument: { findFirst: jest.fn(async () => ({ id: "doc-1" })), findMany: jest.fn(async ({ where }) => (where.id?.in || []).map((id) => ({ id }))) },
};
const mockAudit = { ENTITY_TYPES: { COMMITMENT: "commitment", COMMITMENT_CHANGE_ORDER: "commitment_change_order" }, ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", APPROVED: "approved", REJECTED: "rejected" }, recordEvent: jest.fn(async () => ({})) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { APPROVAL: "approval", COMMERCIAL: "commercial" }, createNotifications: jest.fn(async () => ({ created: 1 })) };
const mockFiles = { DOCUMENT_TYPES: { WORKFLOW_ATTACHMENT: "workflow_attachment" }, uploadProjectDocument: jest.fn(async () => ({ id: "doc-uploaded" })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../file-storage.service", () => mockFiles);
jest.mock("../company-party.service", () => ({ isPartyScopedAccess: (access) => Boolean(access?.partyScoped) }));
// who may name an existing document as the executed agreement is decided in document-text.service (certification R29)
const mockLinkable = jest.fn(async () => undefined);
jest.mock("../document-text.service", () => ({ assertDocumentsLinkable: (...args) => mockLinkable(...args) }));

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

  // Certification CERT-2: an insurance certificate is a document of the
  // commitment's own project; another company's, or one that exists nowhere,
  // is refused as a missing document before anything is written.
  it("names only the project's own documents as insurance certificates", async () => {
    const OWN = "doc-own";
    const byDefault = mockPrisma.projectDocument.findMany.getMockImplementation();
    mockPrisma.projectDocument.findMany.mockImplementation(async ({ where }) => (where.id.in || []).filter((id) => id === OWN && where.projectId === "project-1").map((id) => ({ id })));
    const scope = { orgId: "org-1", projectId: "project-1", actor: { id: "user-qs", role: "qs" } };
    const insured = (documentId) => ({ insurance: [{ type: "general_liability", required: true, documentId }, { type: "auto", required: false }] });
    try {
      for (const other of ["doc-of-another-company", "doc-nowhere"]) {
        await expect(service.setInsurance({ ...scope, commitmentId: "cm-1", payload: insured(other) })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
        await expect(service.createCommitment({ ...scope, payload: { title: "Insured package", ...insured(other) } })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
        await expect(service.updateCommitment({ ...scope, commitmentId: "cm-1", payload: insured(other) })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
      }
      expect(mockPrisma.projectDocument.findMany).toHaveBeenCalledWith({ where: { id: { in: ["doc-of-another-company"] }, projectId: "project-1" }, select: { id: true } });
      expect(mockPrisma.commitment.update).not.toHaveBeenCalled();
      expect(mockPrisma.commitment.create).not.toHaveBeenCalled();
      expect(mockAudit.recordEvent).not.toHaveBeenCalled();

      const set = await service.setInsurance({ ...scope, commitmentId: "cm-1", payload: insured(OWN) });
      expect(set.insurance.map((entry) => [entry.documentId, entry.status])).toEqual([[OWN, "ok"], [null, "optional"]]);
      await service.createCommitment({ ...scope, payload: { title: "Insured package", ...insured(OWN) } });
      await service.updateCommitment({ ...scope, commitmentId: "cm-1", payload: insured(OWN) });
      expect(mockPrisma.commitment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ insuranceJson: [expect.objectContaining({ documentId: OWN }), expect.objectContaining({ documentId: null })] }) }));
      expect(mockPrisma.commitment.update).toHaveBeenCalledTimes(2);
      // a list with no certificate asks nothing
      mockPrisma.projectDocument.findMany.mockClear();
      await service.setInsurance({ ...scope, commitmentId: "cm-1", payload: { insurance: [{ type: "bond", required: true }] } });
      expect(mockPrisma.projectDocument.findMany).not.toHaveBeenCalled();
    } finally {
      mockPrisma.projectDocument.findMany.mockImplementation(byDefault);
    }
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
    // Written as exact decimals (CERT-2, round 6): the same figures.
    expect(mockPrisma.budgetLine.update).toHaveBeenCalledWith({ where: { id: "bl-1" }, data: { committedFromCommitments: { asymmetricMatch: (value) => value !== null && value !== undefined && Number(String(value)) === 5000, toAsymmetricMatcher: () => "the decimal 5000" } } });
    expect(mockPrisma.budgetLine.update).toHaveBeenCalledWith({ where: { id: "bl-x" }, data: { committedFromCommitments: { asymmetricMatch: (value) => value !== null && value !== undefined && Number(String(value)) === 7000, toAsymmetricMatcher: () => "the decimal 7000" } } });
    expect(mockPrisma.budgetLine.update).toHaveBeenCalledWith({ where: { id: "bl-mat" }, data: { committedFromCommitments: { asymmetricMatch: (value) => value !== null && value !== undefined && Number(String(value)) === 0, toAsymmetricMatcher: () => "the decimal 0" } } });
    expect(mockPrisma.costRecord.update).toHaveBeenCalledWith({ where: { id: "cr-1" }, data: { committed: { asymmetricMatch: (value) => value !== null && value !== undefined && Number(String(value)) === 5000, toAsymmetricMatcher: () => "the decimal 5000" } } });
    // R5-2: created with no forecast supplied → the initial default, marked
    // default: the activity's approved allocation (9,000), not a budget of 0
    expect(mockPrisma.costRecord.create).toHaveBeenCalledWith({ data: { projectId: "project-1", activityId: "act-2", committed: { asymmetricMatch: (value) => value !== null && value !== undefined && Number(String(value)) === 7000, toAsymmetricMatcher: () => "the decimal 7000" }, forecast: 9000, forecastSource: "default" } });
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
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "executed" })); // the parent as held (CX21-524)
    await service.transitionChangeOrder({ orgId: "org-1", projectId: "project-1", changeOrderId: "cco-1", to: "approved", actor: { id: "pm" } });
    expect(mockPrisma.budgetLine.update).toHaveBeenCalledWith({ where: { id: "bl-1" }, data: { committedFromCommitments: { asymmetricMatch: (value) => value !== null && value !== undefined && Number(String(value)) === 2500, toAsymmetricMatcher: () => "the decimal 2500" } } });
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

describe("Phase 21D — integrity (release challenge, fifth pass)", () => {
  afterEach(() => jest.restoreAllMocks());
  const pendingCo = () => ({ id: "cco-1", ref: "SC-001-CO01", status: "pending", value: 2500, linesJson: [], createdBy: "user-qs", commitmentId: "cm-1", commitment: { id: "cm-1", ref: "SC-001", status: "executed", projectId: "project-1", projectPartyId: "party-1", createdBy: "user-qs" } });

  it("CX21-454: an edit that started on a pending change order refuses once it was approved under the lock, and a transition refuses once the order moved", async () => {
    mockPrisma.commitmentChangeOrder.findFirst.mockResolvedValue(pendingCo());
    mockPrisma.commitmentChangeOrder.update.mockClear();
    const lock = jest.spyOn(mockPrisma, "$queryRaw").mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes('FROM "CommitmentChangeOrder"') ? [{ status: "approved" }] : []));
    await expect(service.updateChangeOrder({ orgId: "org-1", projectId: "project-1", changeOrderId: "cco-1", payload: { title: "Bigger" }, actor: { id: "qs" } })).rejects.toMatchObject({ code: "COMMITMENT_CO_LOCKED", status: 409 });
    await expect(service.transitionChangeOrder({ orgId: "org-1", projectId: "project-1", changeOrderId: "cco-1", to: "approved", actor: { id: "pm" } })).rejects.toMatchObject({ code: "COMMITMENT_CO_STATE_CHANGED", status: 409 });
    expect(lock).toHaveBeenCalled();
    expect(mockPrisma.commitmentChangeOrder.update).not.toHaveBeenCalled();
  });
});

describe("Phase 21D — integrity (release challenge, sixth pass)", () => {
  afterEach(() => jest.restoreAllMocks());
  const pendingCo = () => ({ id: "cco-1", ref: "SC-001-CO01", status: "pending", value: 2500, linesJson: [], createdBy: "user-qs", commitmentId: "cm-1", primeChangeOrderId: null, commitment: { id: "cm-1", ref: "SC-001", status: "executed", projectId: "project-1", projectPartyId: "party-1", createdBy: "user-qs" } });

  it("CX21-465: recomputing committed cost holds the project before it reads the commitments, so two approvals cannot each write a total that omits the other", async () => {
    mockPrisma.$executeRaw = jest.fn(async () => 0);
    mockPrisma.commitmentChangeOrder.findFirst.mockResolvedValue(pendingCo());
    mockPrisma.commitmentChangeOrder.update.mockImplementation(async ({ data }) => ({ ...pendingCo(), ...data }));
    mockPrisma.commitment.findMany.mockResolvedValue([]);
    mockPrisma.budgetLine.findMany.mockResolvedValue([]);
    mockPrisma.commitment.findFirst.mockResolvedValue({ status: "executed" }); // the parent as held (CX21-524)
    mockPrisma.commitment.findMany.mockClear();
    await service.transitionChangeOrder({ orgId: "org-1", projectId: "project-1", changeOrderId: "cco-1", to: "approved", actor: { id: "pm" } });
    const held = mockPrisma.$executeRaw.mock.calls.find(([strings, ...values]) => Array.isArray(strings) && strings.join("?").includes("pg_advisory_xact_lock") && values.includes("committed:project-1"));
    expect(held).toBeDefined();
    expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mockPrisma.commitment.findMany.mock.invocationCallOrder[0]);
  });

  it("CX21-466: an edit cannot link a change order to a prime change order of another project", async () => {
    mockPrisma.commitmentChangeOrder.findFirst.mockResolvedValue(pendingCo());
    mockPrisma.commitmentChangeOrder.update.mockClear();
    mockPrisma.changeOrder.findFirst.mockResolvedValueOnce(null); // not on this project
    await expect(service.updateChangeOrder({ orgId: "org-1", projectId: "project-1", changeOrderId: "cco-1", payload: { primeChangeOrderId: "co-of-project-2" }, actor: { id: "qs" } })).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.commitmentChangeOrder.update).not.toHaveBeenCalled();
    expect(mockPrisma.changeOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "co-of-project-2", projectId: "project-1" }) }));
  });
});

describe("Phase 21D — integrity (release challenge, tenth pass)", () => {
  it("CX21-511: the recompute holds the (project, activity) pair before it writes an existing cost record's committed", async () => {
    mockPrisma.$executeRaw = jest.fn(async () => 0);
    mockPrisma.commitment.findMany.mockResolvedValue([{ id: "c-1", type: "subcontract", lines: [{ amount: 5000, budgetLineId: null, costCodeId: null, activityId: "act-1" }], changeOrders: [] }]);
    mockPrisma.budgetLine.findMany.mockResolvedValue([]);
    mockPrisma.costRecord.findMany.mockResolvedValue([{ id: "cr-1", activityId: "act-1" }]);
    mockPrisma.costRecord.update.mockClear();
    await service.recomputeCommitted({ orgId: "org-1", projectId: "project-1" });
    const pair = mockPrisma.$executeRaw.mock.calls.findIndex(([strings, ...values]) => Array.isArray(strings) && strings.join("?").includes("pg_advisory_xact_lock") && values.includes("cost-record:project-1:act-1"));
    expect(pair).toBeGreaterThanOrEqual(0);
    expect(mockPrisma.$executeRaw.mock.invocationCallOrder[pair]).toBeLessThan(mockPrisma.costRecord.update.mock.invocationCallOrder[0]);
    expect(mockPrisma.costRecord.update).toHaveBeenCalledWith({ where: { id: "cr-1" }, data: { committed: { asymmetricMatch: (value) => value !== null && value !== undefined && Number(String(value)) === 5000, toAsymmetricMatcher: () => "the decimal 5000" } } });
  });
});

/**
 * CERT-2 (alerts-6): what each activity and budget line is committed to is
 * added up, checked and written as one exact decimal. Two executed
 * commitments of 6e15 on one activity failed the second execution with a 500
 * at the write (numeric field overflow).
 */
describe("CERT-2 — committed totals fit their columns", () => {
  it("commitments that together pass 10^16 on one activity or budget line are a 400 COMMITTED_TOTAL_TOO_LARGE before anything is written", async () => {
    mockPrisma.$executeRaw = jest.fn(async () => 0);
    for (const [where, projection] of [[{ budgetLineId: null, costCodeId: null, activityId: "act-1" }, "activity"], [{ budgetLineId: "bl-1", costCodeId: null, activityId: null }, "budget_line"]]) {
      mockPrisma.commitment.findMany.mockResolvedValue([
        { id: "c-1", type: "subcontract", lines: [{ amount: "6000000000000000", ...where }], changeOrders: [] },
        { id: "c-2", type: "subcontract", lines: [{ amount: "6000000000000000", ...where }], changeOrders: [] },
      ]);
      mockPrisma.budgetLine.findMany.mockResolvedValue([{ id: "bl-1", costCodeId: "code-1", costType: "subcontract", status: "active" }]);
      mockPrisma.costRecord.findMany.mockResolvedValue([{ id: "cr-1", activityId: "act-1" }]);
      mockPrisma.budgetLine.update.mockClear();
      mockPrisma.costRecord.update.mockClear();
      mockPrisma.costRecord.create.mockClear();
      await expect(service.recomputeCommitted({ orgId: "org-1", projectId: "project-1" })).rejects.toMatchObject({ status: 400, code: "COMMITTED_TOTAL_TOO_LARGE", details: { projection } });
      expect(mockPrisma.budgetLine.update).not.toHaveBeenCalled();
      expect(mockPrisma.costRecord.update).not.toHaveBeenCalled();
      expect(mockPrisma.costRecord.create).not.toHaveBeenCalled();
    }
  });

  it("5e15 + 4,999,999,999,999,999 fits, and is written exactly — the float sum was 10^16", async () => {
    mockPrisma.$executeRaw = jest.fn(async () => 0);
    mockPrisma.commitment.findMany.mockResolvedValue([
      { id: "c-1", type: "subcontract", lines: [{ amount: "5000000000000000", budgetLineId: "bl-1", costCodeId: null, activityId: "act-1" }], changeOrders: [] },
      { id: "c-2", type: "subcontract", lines: [{ amount: "4999999999999999", budgetLineId: "bl-1", costCodeId: null, activityId: "act-1" }], changeOrders: [] },
    ]);
    mockPrisma.budgetLine.findMany.mockResolvedValue([{ id: "bl-1", costCodeId: "code-1", costType: "subcontract", status: "active" }]);
    mockPrisma.costRecord.findMany.mockResolvedValue([{ id: "cr-1", activityId: "act-1" }]);
    mockPrisma.budgetLine.update.mockClear();
    mockPrisma.costRecord.update.mockClear();
    await service.recomputeCommitted({ orgId: "org-1", projectId: "project-1" });
    expect(mockPrisma.budgetLine.update.mock.calls[0][0].data.committedFromCommitments.toFixed(2)).toBe("9999999999999999.00");
    expect(mockPrisma.costRecord.update.mock.calls[0][0].data.committed.toFixed(2)).toBe("9999999999999999.00");
  });
});

describe("Phase 21D — integrity (release challenge, eleventh pass)", () => {
  const executedParent = () => ({ id: "cm-1", ref: "SC-001", status: "approved", type: "subcontract", title: "Concrete", projectPartyId: null, vendorCompanyId: null, createdBy: "user-qs", lines: [{ id: "sov-1" }] });

  it("CX21-520: a change order's lines must name this project's activities, budget lines and cost codes — a line naming another project's activity is refused on creation and on edit", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue({ ...executedParent(), status: "executed", changeOrders: [] });
    mockPrisma.activity.findMany.mockResolvedValueOnce([]); // the foreign activity is not on this project
    mockPrisma.commitmentChangeOrder.create.mockClear();
    await expect(
      service.createChangeOrder({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", payload: { title: "Foreign", lines: [{ amount: 100, activityId: "act-of-project-2" }] }, actor: { id: "pm" } }),
    ).rejects.toMatchObject({ status: 404, code: "ACTIVITY_NOT_FOUND" });
    expect(mockPrisma.commitmentChangeOrder.create).not.toHaveBeenCalled();
    expect(mockPrisma.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["act-of-project-2"] }, projectId: "project-1" }) }));
    // on an edit as on a creation
    mockPrisma.commitmentChangeOrder.findFirst.mockResolvedValue({ id: "cco-1", ref: "SC-001-CO01", status: "draft", value: 0, linesJson: [], createdBy: "user-qs", commitmentId: "cm-1", primeChangeOrderId: null, commitment: executedParent() });
    mockPrisma.$queryRaw = jest.fn(async () => [{ status: "draft" }]);
    mockPrisma.activity.findMany.mockResolvedValueOnce([]);
    mockPrisma.commitmentChangeOrder.update.mockClear();
    await expect(
      service.updateChangeOrder({ orgId: "org-1", projectId: "project-1", changeOrderId: "cco-1", payload: { lines: [{ amount: 100, activityId: "act-of-project-2" }] }, actor: { id: "qs" } }),
    ).rejects.toMatchObject({ code: "ACTIVITY_NOT_FOUND" });
    expect(mockPrisma.commitmentChangeOrder.update).not.toHaveBeenCalled();
    delete mockPrisma.$queryRaw;
  });

  it("CX21-524: an approval decides whether to post to committed on the parent's standing as held — a parent executed since the copy was read counts", async () => {
    mockPrisma.$executeRaw = jest.fn(async () => 0);
    mockPrisma.$queryRaw = jest.fn(async () => [{ status: "pending" }]);
    mockPrisma.commitmentChangeOrder.findFirst.mockResolvedValue({ id: "cco-1", ref: "SC-001-CO01", status: "pending", value: 2500, linesJson: [], createdBy: "user-qs", commitmentId: "cm-1", primeChangeOrderId: null, commitment: executedParent() }); // the copy says the parent is only approved
    mockPrisma.commitmentChangeOrder.update.mockImplementation(async ({ data }) => ({ id: "cco-1", ref: "SC-001-CO01", value: 2500, linesJson: [], ...data }));
    mockPrisma.commitment.findFirst.mockResolvedValue({ status: "executed" }); // as held, it was executed meanwhile
    mockPrisma.commitment.findMany.mockResolvedValue([]);
    mockPrisma.budgetLine.findMany.mockResolvedValue([]);
    mockPrisma.commitment.findFirst.mockResolvedValue({ status: "executed" }); // the parent as held (CX21-524)
    mockPrisma.commitment.findMany.mockClear();
    await service.transitionChangeOrder({ orgId: "org-1", projectId: "project-1", changeOrderId: "cco-1", to: "approved", actor: { id: "pm" } });
    const parentLock = mockPrisma.$queryRaw.mock.calls.find(([strings]) => Array.isArray(strings) && /FROM "Commitment" WHERE/.test(strings.join("?")) && strings.join("?").includes("FOR UPDATE"));
    expect(parentLock).toBeDefined();
    expect(mockPrisma.commitment.findMany).toHaveBeenCalled(); // the recompute ran
    delete mockPrisma.$queryRaw;
  });
});

describe("Phase 21D — integrity (release challenge, fourteenth pass)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1", name: "Tower", currency: "USD", defaultRetentionRate: 10 });
  });
  const otherParty = { id: "sub-x", role: "external_party", projectAccess: { partyScoped: true, partyAccess: [{ companyId: "vendor-OTHER" }] } };
  it("CX21-554: a party-scoped actor whose company does not own the commitment cannot edit it, replace its lines, or act on its change order", async () => {
    mockPrisma.$queryRaw = jest.fn(async () => []);
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "draft" })); // vendor-1
    await expect(service.updateCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", payload: { title: "hijack" }, actor: otherParty })).rejects.toMatchObject({ status: 404, code: "COMMITMENT_NOT_FOUND" });
    await expect(service.replaceLines({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", payload: { lines: [] }, actor: otherParty })).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.commitment.update).not.toHaveBeenCalled();
    mockPrisma.commitmentChangeOrder.findFirst.mockResolvedValue({ id: "cco-1", ref: "SC-001-CO01", status: "draft", value: 100, createdBy: "user-qs", commitment: { id: "cm-1", ref: "SC-001", status: "draft", projectPartyId: "party-1", vendorCompanyId: "vendor-1", createdBy: "user-qs", title: "x", type: "subcontract" } });
    await expect(service.updateChangeOrder({ orgId: "org-1", projectId: "project-1", changeOrderId: "cco-1", payload: { title: "hijack" }, actor: otherParty })).rejects.toMatchObject({ status: 404 });
    // the owning company's own party is served
    const ownParty = { id: "sub-1", role: "external_party", projectAccess: { partyScoped: true, partyAccess: [{ companyId: "vendor-1" }] } };
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "draft" }));
    mockPrisma.commitment.update.mockImplementation(async ({ data }) => commitment({ ...data }));
    await expect(service.updateCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", payload: { title: "ours" }, actor: ownParty })).resolves.toBeTruthy();
  });
});

describe("certification L44 — a commitment's parts follow its party rule", () => {
  beforeEach(() => jest.clearAllMocks());
  const party = (companyId, id = "sub-x") => ({ id, role: "external_party", projectAccess: { partyScoped: true, partyAccess: [{ companyId }] } });
  const scope = { orgId: "org-1", projectId: "project-1", commitmentId: "cm-1" };

  it("answers 404 to a party member of another company, as the commitment itself does", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue({ id: "cm-1", vendorCompanyId: "vendor-1", createdBy: "user-qs" });
    await expect(service.assertCommitmentVisible({ ...scope, viewer: party("vendor-OTHER") })).rejects.toMatchObject({ status: 404, code: "COMMITMENT_NOT_FOUND" });
    expect(mockPrisma.commitment.findFirst).toHaveBeenCalledWith({ where: { id: "cm-1", projectId: "project-1", orgId: "org-1" }, select: { id: true, vendorCompanyId: true, createdBy: true } });
    mockPrisma.commitment.findFirst.mockResolvedValue(null);
    await expect(service.assertCommitmentVisible({ ...scope, viewer: party("vendor-1") })).rejects.toMatchObject({ status: 404, code: "COMMITMENT_NOT_FOUND" });
  });

  it("lets the vendor's own party, the creator and the project team through", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue({ id: "cm-1", vendorCompanyId: "vendor-1", createdBy: "sub-creator" });
    await expect(service.assertCommitmentVisible({ ...scope, viewer: party("vendor-1") })).resolves.toBeUndefined();
    await expect(service.assertCommitmentVisible({ ...scope, viewer: party("vendor-OTHER", "sub-creator") })).resolves.toBeUndefined();
    mockPrisma.commitment.findFirst.mockClear();
    await expect(service.assertCommitmentVisible({ ...scope, viewer: { id: "qs-1", role: "qs", projectAccess: {} } })).resolves.toBeUndefined();
    await expect(service.assertCommitmentVisible({ ...scope, viewer: null })).resolves.toBeUndefined();
    expect(mockPrisma.commitment.findFirst).not.toHaveBeenCalled();
  });
});

describe("certification R29 — an existing document executes a commitment only when the executor may read it", () => {
  beforeEach(() => {
    mockLinkable.mockReset();
    mockLinkable.mockImplementation(async () => undefined);
    mockPrisma.commitment.update.mockClear();
  });

  it("asks about the named document as the executor, keeping the agreement already on file, and refuses it as a missing one", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "approved", executedDocumentId: "doc-old", insuranceJson: [{ type: "general_liability", required: true }] }));
    // passes the document check, then stops at the insurance — nothing executed
    await expect(service.executeCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", actor: { id: "pm" }, documentId: "doc-1" })).rejects.toMatchObject({ code: "COMMITMENT_INSURANCE_MISSING" });
    const call = mockLinkable.mock.calls[0][0];
    expect(call).toMatchObject({ orgId: "org-1", projectId: "project-1", keys: ["doc-1"], unchanged: ["doc-old"], userId: "pm" });
    expect(call.refuse()).toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
    mockLinkable.mockImplementation(async ({ refuse }) => { throw refuse(); });
    await expect(service.executeCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", actor: { id: "pm" }, documentId: "doc-1" })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
    expect(mockPrisma.commitment.update).not.toHaveBeenCalled();
  });

  it("an agreement uploaded with the execution is the executor's own and is not asked about", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "approved", insuranceJson: [{ type: "general_liability", required: true }] }));
    await expect(service.executeCommitment({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", actor: { id: "pm" }, file: { path: "/tmp/x.pdf", originalname: "a.pdf", mimetype: "application/pdf", size: 10 } })).rejects.toMatchObject({ code: "COMMITMENT_INSURANCE_MISSING" });
    expect(mockLinkable).not.toHaveBeenCalled();
  });
});
