const { referenceCounterMock } = require("./helpers/reference-counter-mock");
const ledger = require("./helpers/cost-ledger-mock").createCostLedgerMock({ idPrefix: "pa-cle" });

const mockPrisma = {
  ...referenceCounterMock(),
  ...ledger.tables,
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async () => ({ id: "project-1", name: "Tower", currency: "USD" })) },
  projectDocument: { findFirst: jest.fn(async () => ({ id: "waiver-1" })) },
  projectPartyMember: { findMany: jest.fn(async () => [{ userId: "sub-user" }]) },
  activityProgress: { findMany: jest.fn(async () => []) },
  commitment: { findFirst: jest.fn() },
  subPayApp: { aggregate: jest.fn(async () => ({ _max: { number: 0 } })), findFirst: jest.fn(), findMany: jest.fn(async () => []), create: jest.fn(), update: jest.fn() },
  subPayAppLine: { findMany: jest.fn(async () => []), update: jest.fn(async () => ({})) },
  subPayAppPayment: { create: jest.fn(async ({ data }) => ({ id: "pay-1", ...data })), findMany: jest.fn(async () => []) },
  // Read when approving, to see whether this is the application that finishes
  // the subcontract and so triggers the closeout gate (OCTA-SUB-CLOSE-056).
  // Empty here: these applications are part-way claims, not the final one.
  commitmentSovLine: { findMany: jest.fn(async () => []) },
  commitmentChangeOrder: { findMany: jest.fn(async () => []) },
};
const mockAudit = { ENTITY_TYPES: { SUB_PAY_APP: "sub_pay_app" }, ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", APPROVED: "approved", REJECTED: "rejected" }, recordEvent: jest.fn(async () => ({})) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { APPROVAL: "approval", COMMERCIAL: "commercial", WORKFLOW: "workflow" }, createNotifications: jest.fn(async () => ({ created: 1 })) };
const mockCashFlow = { rebuildCashFlow: jest.fn(async () => ({})) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../cash-flow.service", () => mockCashFlow);
jest.mock("../company-party.service", () => ({ isPartyScopedAccess: (access) => Boolean(access?.partyScoped) }));
// who may name a document as a waiver is decided in document-text.service (certification R29)
const mockLinkable = jest.fn(async () => undefined);
jest.mock("../document-text.service", () => ({ assertDocumentsLinkable: (...args) => mockLinkable(...args) }));

const service = require("../sub-pay-app.service");

const sov = (overrides = {}) => ({ id: "sov-1", lineNumber: 1, activityId: "act-1", costCodeId: "code-1", activity: { id: "act-1", name: "Slab" }, costCode: { id: "code-1", code: "03-300" }, ...overrides });
const commitment = (overrides = {}) => ({ id: "cm-1", ref: "SC-001", title: "Concrete", type: "subcontract", status: "executed", currency: "USD", retentionRate: 10, vendorCompanyId: "vendor-1", projectPartyId: "party-1", createdBy: "user-qs", insuranceJson: [], vendorCompany: { id: "vendor-1", name: "ACME" }, lines: [{ id: "sov-1", description: "Slab", amount: 100000, activityId: "act-1", sortOrder: 0, lineNumber: 1 }, { id: "sov-2", description: "Columns", amount: 50000, activityId: "act-2", sortOrder: 1, lineNumber: 2 }], ...overrides });
const line = (overrides = {}) => ({ id: "pl-1", sovLineId: "sov-1", sovLine: sov(), description: "Slab", scheduledAmount: 100000, previousAmount: 20000, thisPeriodAmount: 0, cumulativeAmount: 20000, materialsOnSite: 0, approvedPct: null, capAmount: null, overClaimAmount: 0, notes: null, sortOrder: 0, ...overrides });
const payApp = (overrides = {}) => ({
  id: "pa-1",
  projectId: "project-1",
  commitmentId: "cm-1",
  number: 2,
  ref: "SC-001-PA02",
  periodLabel: "2026-09",
  status: "draft",
  retentionRate: 10,
  backCharges: 0,
  netThisPeriod: 0,
  paidAmount: 0,
  waiverRequired: false,
  waiverDocumentId: null,
  commitment: commitment(),
  lines: [line(), line({ id: "pl-2", sovLineId: "sov-2", sovLine: sov({ id: "sov-2", lineNumber: 2, activityId: "act-2" }), description: "Columns", scheduledAmount: 50000, previousAmount: 0, cumulativeAmount: 0, sortOrder: 1 })],
  payments: [],
  createdBy: "user-sub",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("subcontractor payment applications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ledger.reset();
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment());
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp());
    mockPrisma.subPayApp.create.mockImplementation(async ({ data }) => payApp({ ...data, id: "pa-new", lines: (data.lines?.create || []).map((row, index) => ({ id: `nl${index}`, ...row, sovLine: sov({ id: row.sovLineId }) })) }));
    mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => payApp({ ...data }));
    mockPrisma.activityProgress.findMany.mockResolvedValue([{ activityId: "act-1", pctComplete: 60 }, { activityId: "act-1", pctComplete: 40 }]);
  });

  it("caps cumulative claims by approved progress and flags over-claims", () => {
    const pctMap = new Map([["act-1", 60]]);
    const lines = service.applyClaims({ lines: [line()], claims: new Map([["sov-1", { thisPeriodAmount: 30000 }]]), pctMap });
    expect(lines[0]).toMatchObject({ thisPeriodAmount: 30000, cumulativeAmount: 50000, approvedPct: 60, capAmount: 60000, overClaimAmount: 0 });
    const over = service.applyClaims({ lines: [line()], claims: new Map([["sov-1", { thisPeriodPct: 75 }]]), pctMap });
    expect(over[0]).toMatchObject({ thisPeriodAmount: 55000, cumulativeAmount: 75000, overClaimAmount: 15000 });
    expect(() => service.applyClaims({ lines: [line()], claims: new Map([["sov-1", { thisPeriodAmount: 90000 }]]), pctMap })).toThrow(expect.objectContaining({ code: "SUB_PAY_APP_EXCEEDS_SCHEDULED" }));
    expect(() => service.applyClaims({ lines: [line()], claims: new Map([["sov-1", { thisPeriodAmount: -1 }]]), pctMap })).toThrow(expect.objectContaining({ code: "SUB_PAY_APP_LINE_NEGATIVE" }));
  });

  it("computes gross, retention, back-charges and net", () => {
    const lines = [line({ thisPeriodAmount: 30000, cumulativeAmount: 50000, materialsOnSite: 5000 }), line({ id: "pl-2", thisPeriodAmount: 10000, cumulativeAmount: 10000 })];
    const totals = service.financials({ lines, retentionRate: 10, backCharges: 1500, retentionBefore: 2000 });
    expect(totals).toMatchObject({ workThisPeriod: 40000, workCumulative: 60000, materialsOnSite: 5000, grossThisPeriod: 45000, retentionThisPeriod: 4500, retentionCumulative: 6500, netThisPeriod: 39000 });
  });

  it("taxes what is left after retention and withholdings, never the gross", () => {
    // 45,000 gross − 4,500 retention − 1,500 back-charges − 3,000 deduction
    // = 36,000, and 5% of that is 1,800. Tax on the gross would be 2,250 and
    // the subcontractor would be overpaid every period.
    const lines = [line({ thisPeriodAmount: 30000, cumulativeAmount: 50000, materialsOnSite: 5000 }), line({ id: "pl-2", thisPeriodAmount: 10000, cumulativeAmount: 10000 })];
    const totals = service.financials({ lines, retentionRate: 10, backCharges: 1500, retentionBefore: 0, otherDeductions: 3000, taxRate: 5 });
    expect(totals.taxAmount).toBe(1800);
    expect(totals.netThisPeriod).toBe(37800);
  });

  describe("recognising the final application", () => {
    // Nobody marks an application "final". The arithmetic says so: it is the
    // one that takes the cumulative claim to the revised value, and it is what
    // triggers the closeout gate.
    const tx = (lines, orders = []) => ({
      commitmentSovLine: { findMany: jest.fn(async () => lines) },
      commitmentChangeOrder: { findMany: jest.fn(async () => orders) },
    });

    it("is final when the claim reaches the revised value", async () => {
      const existing = { commitmentId: "cm-1", lines: [{ cumulativeAmount: 150000 }] };
      await expect(
        service.isFinalApplication({ existing, tx: tx([{ amount: 100000 }, { amount: 50000 }]) }),
      ).resolves.toBe(true);
    });

    it("counts approved change orders into the value it has to reach", async () => {
      const existing = { commitmentId: "cm-1", lines: [{ cumulativeAmount: 150000 }] };
      // 150,000 was the whole job until a change order added 20,000.
      await expect(
        service.isFinalApplication({
          existing,
          tx: tx([{ amount: 100000 }, { amount: 50000 }], [{ value: 20000 }]),
        }),
      ).resolves.toBe(false);
    });

    it("is not final part way through", async () => {
      const existing = { commitmentId: "cm-1", lines: [{ cumulativeAmount: 90000 }] };
      await expect(
        service.isFinalApplication({ existing, tx: tx([{ amount: 150000 }]) }),
      ).resolves.toBe(false);
    });

    it("is not final on a commitment with no schedule of values", async () => {
      const existing = { commitmentId: "cm-1", lines: [{ cumulativeAmount: 90000 }] };
      await expect(service.isFinalApplication({ existing, tx: tx([]) })).resolves.toBe(false);
    });
  });

  describe("the revised schedule of values", () => {
    const pctMap = new Map();

    it("refuses a claim past the line's scheduled amount", () => {
      expect(() =>
        service.applyClaims({ lines: [line()], claims: new Map([["sov-1", { thisPeriodAmount: 85000 }]]), pctMap }),
      ).toThrow(expect.objectContaining({ code: "SUB_PAY_APP_EXCEEDS_SCHEDULED" }));
    });

    it("allows it once an approved change order has raised the line", () => {
      // The rule is "not past the scheduled amount unless an authorised
      // contract modification says otherwise". This is the "unless".
      const changeMap = new Map([["sov-1", 20000]]);
      const [claimed] = service.applyClaims({
        lines: [line()],
        claims: new Map([["sov-1", { thisPeriodAmount: 85000 }]]),
        pctMap,
        changeMap,
      });
      expect(claimed.revisedScheduledAmount).toBe(120000);
      expect(claimed.approvedChangeAmount).toBe(20000);
      expect(claimed.cumulativeAmount).toBe(105000);
    });

    it("still refuses a claim past the revised amount", () => {
      const changeMap = new Map([["sov-1", 20000]]);
      expect(() =>
        service.applyClaims({ lines: [line()], claims: new Map([["sov-1", { thisPeriodAmount: 105000 }]]), pctMap, changeMap }),
      ).toThrow(expect.objectContaining({ code: "SUB_PAY_APP_EXCEEDS_SCHEDULED" }));
    });

    it("says what the ceiling is made of when it refuses", () => {
      const changeMap = new Map([["sov-1", 20000]]);
      let thrown = null;
      try {
        service.applyClaims({ lines: [line()], claims: new Map([["sov-1", { thisPeriodAmount: 200000 }]]), pctMap, changeMap });
      } catch (error) {
        thrown = error;
      }
      expect(thrown.message).toContain("120000");
      expect(thrown.message).toContain("20000");
    });

    it("counts only approved change-order lines that name a schedule line", async () => {
      const tx = {
        commitmentChangeOrder: {
          findMany: jest.fn(async () => [
            { linesJson: [{ sovLineId: "sov-1", amount: 20000 }, { sovLineId: null, amount: 9999 }] },
            { linesJson: [{ sovLineId: "sov-1", amount: 5000 }] },
            { linesJson: "not-a-list" },
          ]),
        },
      };
      const map = await service.approvedChangesBySovLine({ tx, commitmentId: "cm-1" });
      expect(map.get("sov-1")).toBe(25000);
      expect(map.size).toBe(1);
      // Only approved orders are asked for; a pending one must not raise a cap.
      expect(tx.commitmentChangeOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { commitmentId: "cm-1", status: "approved" } }),
      );
    });
  });

  it("seeds a numbered application from the executed commitment with previous claims", async () => {
    mockPrisma.subPayApp.aggregate.mockResolvedValue({ _max: { number: 1 } });
    mockPrisma.subPayAppLine.findMany.mockResolvedValue([{ sovLineId: "sov-1", thisPeriodAmount: 20000, payApp: { id: "pa-0" } }]);
    mockPrisma.subPayApp.findFirst.mockResolvedValueOnce(null);
    mockPrisma.subPayApp.findMany.mockResolvedValue([{ retentionThisPeriod: 2000 }]);
    const created = await service.createPayApp({ orgId: "org-1", projectId: "project-1", payload: { commitmentId: "cm-1", periodLabel: "2026-09" }, actor: { id: "user-sub" } });
    expect(mockPrisma.subPayApp.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ number: 2, ref: "SC-001-PA02", retentionRate: 10, retentionCumulative: 2000 }) }));
    const seeded = mockPrisma.subPayApp.create.mock.calls[0][0].data.lines.create;
    expect(seeded[0]).toMatchObject({ sovLineId: "sov-1", scheduledAmount: 100000, previousAmount: 20000, cumulativeAmount: 20000, approvedPct: 60, capAmount: 60000 });
    expect(created.ref).toBe("SC-001-PA02");

    mockPrisma.commitment.findFirst.mockResolvedValue(commitment({ status: "approved" }));
    await expect(service.createPayApp({ orgId: "org-1", projectId: "project-1", payload: { commitmentId: "cm-1", periodLabel: "2026-10" } })).rejects.toMatchObject({ code: "SUB_PAY_APP_COMMITMENT_NOT_EXECUTED" });
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment());
    mockPrisma.subPayApp.findFirst.mockResolvedValueOnce({ ref: "SC-001-PA02" });
    await expect(service.createPayApp({ orgId: "org-1", projectId: "project-1", payload: { commitmentId: "cm-1", periodLabel: "2026-10" } })).rejects.toMatchObject({ code: "SUB_PAY_APP_OPEN_EXISTS", details: { reasonCode: "DUPLICATE_PERIOD" } });
  });

  it("rejects an over-claim at submission with a reason code", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ lines: [line({ thisPeriodAmount: 55000, cumulativeAmount: 75000 })] }));
    await expect(service.submitPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "user-sub" } })).rejects.toMatchObject({ code: "SUB_PAY_APP_OVER_CLAIM", details: expect.objectContaining({ reasonCode: "OVER_APPROVED_PROGRESS" }) });
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ lines: [line({ thisPeriodAmount: 30000, cumulativeAmount: 50000 })] }));
    const submitted = await service.submitPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "user-sub" } });
    expect(mockPrisma.subPayApp.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "submitted", netThisPeriod: 27000, retentionThisPeriod: 3000 }) }));
    expect(submitted.status).toBe("submitted");
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "sub_pay_app.submitted", recipientRoles: ["qs", "pm"] }));
  });

  it("gates approval on compliance and allows an override with a reason", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "under_review", waiverRequired: true, waiverDocumentId: null, lines: [line({ thisPeriodAmount: 30000, cumulativeAmount: 50000 })] }));
    await expect(service.approvePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "pm" }, canRevoke: true })).rejects.toMatchObject({ code: "SUB_PAY_APP_COMPLIANCE", details: expect.objectContaining({ reasonCode: "MISSING_COMPLIANCE" }) });
    const approved = await service.approvePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "pm" }, complianceOverrideReason: "Waiver couriered, arrives Monday" });
    expect(approved.status).toBe("approved");
    expect(mockPrisma.subPayApp.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "approved", complianceOverrideReason: "Waiver couriered, arrives Monday" }) }));
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "sub_pay_app.approved", recipientUserIds: expect.arrayContaining(["sub-user"]) }));
    await expect(service.rejectPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "pm" }, code: "INCORRECT_QUANTITIES" })).rejects.toMatchObject({ code: "SUB_PAY_APP_REASON_REQUIRED" });
  });

  it("payments cannot exceed the net approved and paid in full closes the application", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "approved", netThisPeriod: 27000, paidAmount: 20000 }));
    await expect(service.recordPayment({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { amount: 8000 } })).rejects.toMatchObject({ code: "SUB_PAY_APP_PAYMENT_EXCEEDS", details: expect.objectContaining({ remaining: 7000 }) });
    const paid = await service.recordPayment({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { amount: 7000, reference: "EFT-88" }, actor: { id: "fin" } });
    expect(mockPrisma.subPayAppPayment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: 7000, reference: "EFT-88" }) });
    expect(mockPrisma.subPayApp.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "paid", paidAmount: 27000 }) }));
    expect(mockCashFlow.rebuildCashFlow).toHaveBeenCalledWith({ orgId: "org-1", projectId: "project-1" });
    expect(paid.status).toBe("paid");
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "draft" }));
    await expect(service.recordPayment({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { amount: 1 } })).rejects.toMatchObject({ code: "SUB_PAY_APP_NOT_APPROVED" });
  });

  it("party users see only applications on their commitments", () => {
    expect(service.visibilityWhere({ id: "u", projectAccess: {} })).toBeNull();
    expect(service.visibilityWhere({ id: "sub-user", projectAccess: { partyScoped: true, partyAccess: [{ companyId: "vendor-1" }] } })).toEqual({ OR: [{ commitment: { vendorCompanyId: { in: ["vendor-1"] } } }, { createdBy: "sub-user" }] });
  });

  it("renders a statement PDF", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "paid", payments: [{ id: "p", amount: 27000, paidAt: new Date(), reference: "EFT-88" }] }));
    const pdf = await service.exportStatementPdf({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1" });
    expect(pdf.fileName).toBe("SC-001-PA02.pdf");
    expect(pdf.buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  /**
   * Certification is the point subcontractor work becomes actual cost
   * (OCTA-FIN-LEDGER-059) and revocation is how a wrong one is corrected
   * (OCTA-FIN-SUBPAY-063). The ledger mock enforces the real unique
   * `sourceKey`, which is what makes these assertions mean anything.
   */
  describe("certification and its correction", () => {
    const claimed = (overrides = {}) =>
      payApp({
        status: "under_review",
        periodEnd: new Date("2026-09-30"),
        lines: [line({ thisPeriodAmount: 30000, cumulativeAmount: 50000 })],
        ...overrides,
      });

    const approve = () =>
      service.approvePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "pm" }, canRevoke: true });

    beforeEach(() => {
      // The projections the posting maintains.
      ledger.seedBudgetLine({ id: "bl-1", projectId: "project-1", costCodeId: "code-1", costType: "subcontract" });
      ledger.seedCostRecord({ id: "cr-1", projectId: "project-1", activityId: "act-1" });
      // The row the update returns is what gets posted, so it has to carry the
      // claim. The suite's default returns zero-claim lines, which is why none
      // of this path was reachable before.
      mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => claimed({ ...data }));
    });

    it("posts the gross claim to the ledger, coded off the schedule-of-values line", async () => {
      mockPrisma.subPayApp.findFirst.mockResolvedValue(claimed());
      await approve();
      expect(ledger.total()).toBe(30000);
      const [entry] = ledger.store.entries;
      expect(entry).toMatchObject({
        sourceType: "sub_pay_app",
        sourceId: "pa-1",
        sourceLineId: "pl-1",
        costType: "subcontract",
        activityId: "act-1",
        commitmentId: "cm-1",
      });
      expect(ledger.store.budgetLines[0].actual).toBe(30000);
      expect(ledger.store.costRecords[0].actual).toBe(30000);
    });

    it("posts once however many approvals arrive", async () => {
      mockPrisma.subPayApp.findFirst.mockResolvedValue(claimed());
      await approve();
      // The state machine would refuse the second call in real life; the ledger
      // has to survive it even if that guard is ever bypassed.
      mockPrisma.subPayApp.findFirst.mockResolvedValue(claimed());
      await approve();
      expect(ledger.store.entries.length).toBe(1);
      expect(ledger.total()).toBe(30000);
    });

    it("revoking reverses the posting instead of deleting it", async () => {
      mockPrisma.subPayApp.findFirst.mockResolvedValue(claimed());
      await approve();

      mockPrisma.subPayApp.findFirst.mockResolvedValue(claimed({ status: "approved", certificationRevision: 0 }));
      const revoked = await service.reopenPayApp({
        orgId: "org-1",
        canRevoke: true, projectId: "project-1", payAppId: "pa-1", actor: { id: "pm" },
        reason: "Measured against the superseded drawing",
      });

      expect(revoked.status).toBe("draft");
      expect(mockPrisma.subPayApp.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ certificationRevision: 1, revokedReason: "Measured against the superseded drawing", approvedAt: null }),
        }),
      );
      // Two entries, netting to nothing: both halves are on the record.
      expect(ledger.store.entries.length).toBe(2);
      expect(ledger.total()).toBe(0);
      expect(ledger.store.entries[1].amount).toBe(-30000);
      expect(ledger.store.entries[1].reversalOfId).toBe(ledger.store.entries[0].id);
      expect(mockNotifications.createNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ event: "sub_pay_app.revoked", priority: "high" }),
      );
    });

    /**
     * The trap this exists to avoid: the reversal leaves the original keys in
     * place, so a corrected re-certification under the same key would be taken
     * for a duplicate and post nothing — leaving the ledger holding the
     * reversal and none of the corrected cost.
     */
    it("re-certifying a corrected claim posts under its own revision", async () => {
      mockPrisma.subPayApp.findFirst.mockResolvedValue(claimed());
      await approve();
      mockPrisma.subPayApp.findFirst.mockResolvedValue(claimed({ status: "approved" }));
      await service.reopenPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "pm" }, canRevoke: true, reason: "wrong quantity" });

      mockPrisma.subPayApp.findFirst.mockResolvedValue(
        claimed({ certificationRevision: 1, lines: [line({ thisPeriodAmount: 28000, cumulativeAmount: 48000 })] }),
      );
      mockPrisma.subPayApp.update.mockImplementation(async ({ data }) =>
        payApp({ certificationRevision: 1, periodEnd: new Date("2026-09-30"), lines: [line({ thisPeriodAmount: 28000, cumulativeAmount: 48000 })], ...data }),
      );
      await approve();

      expect(ledger.store.entries.length).toBe(3);
      expect(ledger.total()).toBe(28000);
      expect(ledger.store.entries[2].sourceKey).toBe("sub_pay_app:pa-1:pl-1:r1");
      expect(ledger.store.entries[2].note).toContain("revision 1");
    });

    it("refuses to revoke a certificate that has been paid, and names the payment", async () => {
      mockPrisma.subPayApp.findFirst.mockResolvedValue(
        claimed({ status: "approved", paidAmount: 5000, netThisPeriod: 27000, payments: [{ id: "p-1", amount: 5000, paidAt: new Date(), reference: "EFT-12" }] }),
      );
      await expect(
        service.reopenPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "pm" }, canRevoke: true, reason: "changed my mind" }),
      ).rejects.toMatchObject({
        code: "SUB_PAY_APP_ALREADY_PAID",
        details: expect.objectContaining({ paidAmount: 5000, payments: [expect.objectContaining({ reference: "EFT-12" })] }),
      });
    });

    it("will not revoke without a reason", async () => {
      mockPrisma.subPayApp.findFirst.mockResolvedValue(claimed({ status: "approved" }));
      await expect(
        service.reopenPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "pm" }, canRevoke: true }),
      ).rejects.toMatchObject({ code: "SUB_PAY_APP_REASON_REQUIRED" });
      expect(ledger.store.entries.length).toBe(0);
    });

    it("still lets a rejected application go back to draft with no reason and no reversal", async () => {
      mockPrisma.subPayApp.findFirst.mockResolvedValue(claimed({ status: "rejected" }));
      const reopened = await service.reopenPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "qs" } });
      expect(reopened.status).toBe("draft");
      expect(ledger.store.entries.length).toBe(0);
    });
  });
});

describe("Phase 21D — integrity (Codex round 1)", () => {
  it("CX21-005: a payment is checked against the payment rows under a lock, not the figure read before the transaction", async () => {
    // The application says 20,000 paid; the rows say a further 6,000 landed since.
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "approved", netThisPeriod: 27000, paidAmount: 20000 }));
    mockPrisma.subPayAppPayment.findMany.mockResolvedValue([{ amount: 20000 }, { amount: 6000 }]);
    const lock = jest.spyOn(mockPrisma, "$queryRaw");
    await expect(service.recordPayment({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { amount: 7000 } })).rejects.toMatchObject({ code: "SUB_PAY_APP_PAYMENT_EXCEEDS" });
    const paid = await service.recordPayment({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { amount: 1000 } });
    expect(mockPrisma.subPayApp.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paidAmount: 27000, status: "paid" }) }));
    expect(paid.status).toBe("paid");
    expect(lock.mock.calls.map((call) => call[0].join("?")).some((sql) => sql.includes('FROM "SubPayApp" WHERE id = ? FOR UPDATE'))).toBe(true);
    lock.mockRestore();
    mockPrisma.subPayAppPayment.findMany.mockResolvedValue([]);
  });
});

describe("Phase 21D — integrity (Codex round 2)", () => {
  it("CX21-103: a payment re-reads the application under the lock and refuses one revoked in between", async () => {
    mockPrisma.subPayApp.findFirst
      .mockResolvedValueOnce(payApp({ status: "approved", netThisPeriod: 27000, paidAmount: 0 }))
      .mockResolvedValueOnce(payApp({ status: "draft", netThisPeriod: 27000, paidAmount: 0 }));
    mockPrisma.subPayAppPayment.create.mockClear();
    await expect(service.recordPayment({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { amount: 1000 } })).rejects.toMatchObject({ code: "SUB_PAY_APP_NOT_APPROVED" });
    expect(mockPrisma.subPayAppPayment.create).not.toHaveBeenCalled();
  });

  it("CX21-103: a revocation counts the payments again under the lock and refuses once one has landed", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "approved", netThisPeriod: 27000, paidAmount: 0 }));
    mockPrisma.subPayAppPayment.findMany.mockResolvedValueOnce([{ amount: 5000 }]);
    await expect(service.reopenPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "qs" }, canRevoke: true, reason: "measured wrong" })).rejects.toMatchObject({ code: "SUB_PAY_APP_ALREADY_PAID" });
    expect(mockPrisma.subPayApp.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "draft" }) }));
  });
});

describe("Phase 21D — integrity (Codex round 3)", () => {
  it("CX21-204: a rejection that started on a submitted application refuses once it is approved under the lock", async () => {
    mockPrisma.subPayApp.findFirst
      .mockResolvedValueOnce(payApp({ status: "submitted", netThisPeriod: 27000 }))
      .mockResolvedValueOnce(payApp({ status: "approved", netThisPeriod: 27000 }));
    mockPrisma.subPayApp.update.mockClear();
    await expect(service.rejectPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "qs" }, code: "measurement", reason: "measured wrong" })).rejects.toMatchObject({ code: "SUB_PAY_APP_TRANSITION_INVALID" });
    expect(mockPrisma.subPayApp.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "rejected" }) }));
  });
});

describe("Phase 21D — integrity (Codex round 4)", () => {
  it("CX21-302: an edit holds the application first and refuses once it is no longer editable under the lock", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "draft", netThisPeriod: 27000 }));
    mockPrisma.subPayApp.update.mockClear();
    mockPrisma.subPayAppLine.update.mockClear();
    const lock = jest.spyOn(mockPrisma, "$queryRaw").mockImplementation(async (strings) => (strings.join("?").includes('FROM "SubPayApp"') ? [{ status: "paid" }] : []));
    await expect(service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { backCharges: 500 }, actor: { id: "qs" } })).rejects.toMatchObject({ code: "SUB_PAY_APP_LOCKED" });
    lock.mockRestore();
    expect(mockPrisma.subPayApp.update).not.toHaveBeenCalled();
    expect(mockPrisma.subPayAppLine.update).not.toHaveBeenCalled();
  });

  it("CX21-302: a transition re-reads the application under its lock before it recomputes", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "submitted", netThisPeriod: 27000 }));
    mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => payApp({ status: "submitted", netThisPeriod: 27000, ...data }));
    mockPrisma.subPayApp.findFirst.mockClear();
    await service.rejectPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "qs" }, code: "measurement", reason: "re-measure" });
    // one read before the transaction, the status guard, then the reload with the include
    const reads = mockPrisma.subPayApp.findFirst.mock.calls.map((call) => call[0]);
    expect(reads.filter((args) => args.include).length).toBeGreaterThanOrEqual(2);
  });
});

describe("Phase 21D — integrity (Codex round 5)", () => {
  it("CX21-401: a notes-only edit recomputes from the application as it is under the lock, keeping a deduction another edit just made", async () => {
    // The caller's copy has no back-charge; by the time the lock is held,
    // another edit has recorded 20,000. A notes edit must not put 0 back.
    mockPrisma.subPayApp.findFirst
      .mockResolvedValueOnce(payApp({ status: "draft", backCharges: 0, lines: [line({ thisPeriodAmount: 50000, cumulativeAmount: 70000 })] }))
      .mockResolvedValueOnce(payApp({ status: "draft", backCharges: 20000, lines: [line({ thisPeriodAmount: 50000, cumulativeAmount: 70000 })] }));
    mockPrisma.subPayApp.update.mockClear();
    mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => payApp({ status: "draft", ...data }));
    await service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { notes: "invoice attached" }, actor: { id: "qs" } });
    expect(mockPrisma.subPayApp.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ backCharges: 20000, notes: "invoice attached" }) }));
  });

  it("CX21-402: a transition asks its guard again about the application it reloaded under the lock", async () => {
    // The guard passed on a claimed application; under the lock the claims
    // are gone (an edit landed in between). Submitting nothing is refused.
    mockPrisma.subPayApp.findFirst
      .mockResolvedValueOnce(payApp({ status: "draft", lines: [line({ thisPeriodAmount: 50000, cumulativeAmount: 70000 })] }))
      .mockResolvedValueOnce(payApp({ status: "draft" }))
      .mockResolvedValueOnce(payApp({ status: "draft", lines: [line({ thisPeriodAmount: 0, cumulativeAmount: 20000 })] }));
    mockPrisma.subPayApp.update.mockClear();
    await expect(service.submitPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "sub-user" } })).rejects.toMatchObject({ code: "SUB_PAY_APP_EMPTY" });
    expect(mockPrisma.subPayApp.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "submitted" }) }));
  });
});

describe("Phase 21D — integrity (Codex round 6)", () => {
  afterEach(() => mockPrisma.subPayAppLine.findMany.mockImplementation(async () => []));

  it("CX21-502: a reopened application's previous amount is what the other counted applications certified, so the same work cannot be billed twice", async () => {
    // Application A was rejected, B (newer) was approved and paid for 60,000
    // on the 100,000 line. A comes back claiming 60,000: previous is B's
    // 60,000, cumulative would be 120,000 — refused.
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ id: "pa-A", status: "draft", lines: [line({ scheduledAmount: 100000, previousAmount: 0, thisPeriodAmount: 0, cumulativeAmount: 0 })] }));
    mockPrisma.subPayAppLine.findMany.mockImplementation(async ({ where } = {}) => (where?.payApp?.id?.not === "pa-A" ? [{ sovLineId: "sov-1", thisPeriodAmount: 60000 }] : []));
    await expect(
      service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-A", payload: { lines: [{ sovLineId: "sov-1", thisPeriodAmount: 60000 }] }, actor: { id: "sub-user" } }),
    ).rejects.toMatchObject({ code: "SUB_PAY_APP_EXCEEDS_SCHEDULED" });
  });

  it("CX21-502: with nothing certified elsewhere, previous is zero even if the line says otherwise", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ id: "pa-A", status: "draft", lines: [line({ scheduledAmount: 100000, previousAmount: 40000, thisPeriodAmount: 0, cumulativeAmount: 40000 })] }));
    mockPrisma.subPayAppLine.update.mockClear();
    mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => payApp({ id: "pa-A", status: "draft", ...data }));
    await service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-A", payload: { lines: [{ sovLineId: "sov-1", thisPeriodAmount: 70000 }] }, actor: { id: "sub-user" } });
    expect(mockPrisma.subPayAppLine.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ previousAmount: 0, thisPeriodAmount: 70000, cumulativeAmount: 70000 }) }));
  });
});

describe("Phase 21D — integrity (Codex round 7)", () => {
  it("CX21-601: a transition holds the commitment before the application, so two applications cannot both pass the shared ceiling", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "draft", lines: [line({ thisPeriodAmount: 50000, cumulativeAmount: 70000 })] }));
    mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => payApp({ status: "submitted", ...data }));
    const lock = jest.spyOn(mockPrisma, "$queryRaw");
    await service.submitPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "sub-user" } });
    const statements = lock.mock.calls.map((call) => (Array.isArray(call[0]) ? call[0].join("?") : String(call[0])));
    lock.mockRestore();
    const commitment = statements.findIndex((sql) => /FROM "Commitment" WHERE id = \? FOR NO KEY UPDATE/.test(sql));
    const application = statements.findIndex((sql) => /FROM "SubPayApp" WHERE id = \? FOR UPDATE/.test(sql));
    expect(commitment).toBeGreaterThanOrEqual(0);
    expect(application).toBeGreaterThan(commitment);
  });

  it("CX21-601: a rejected application cannot come back to draft while another application is open on the commitment", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "rejected", netThisPeriod: 27000 }));
    mockPrisma.subPayApp.update.mockClear();
    const lock = jest.spyOn(mockPrisma, "$queryRaw").mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes("status IN ('draft', 'submitted', 'under_review')") ? [{ ref: "SC-001-PA03" }] : []));
    await expect(service.reopenPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "pm" }, reason: "resubmit" })).rejects.toMatchObject({ code: "SUB_PAY_APP_OPEN_EXISTS", details: { reasonCode: "DUPLICATE_PERIOD" } });
    lock.mockRestore();
    expect(mockPrisma.subPayApp.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "draft" }) }));
  });

  it("CX21-601: raising an application holds the commitment before it checks for an open one", async () => {
    mockPrisma.commitment.findFirst.mockResolvedValue(commitment());
    mockPrisma.subPayApp.findFirst.mockResolvedValueOnce(null).mockResolvedValue(payApp({ status: "draft" }));
    mockPrisma.subPayApp.create.mockResolvedValue(payApp({ status: "draft" }));
    const lock = jest.spyOn(mockPrisma, "$queryRaw");
    await service.createPayApp({ orgId: "org-1", projectId: "project-1", payload: { commitmentId: "cm-1", periodLabel: "2026-10" }, actor: { id: "sub-user" } });
    const statements = lock.mock.calls.map((call) => (Array.isArray(call[0]) ? call[0].join("?") : String(call[0])));
    lock.mockRestore();
    expect(statements.some((sql) => /FROM "Commitment" WHERE id = \? FOR NO KEY UPDATE/.test(sql))).toBe(true);
  });
});

describe("Phase 21D — integrity (Codex round 8)", () => {
  afterEach(() => mockPrisma.subPayAppLine.findMany.mockImplementation(async () => []));

  it("CX21-701: materials on site count against the line with the work — 200,000 of materials on a 100,000 line is refused", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "draft", lines: [line({ scheduledAmount: 100000, previousAmount: 0, thisPeriodAmount: 0, cumulativeAmount: 0, materialsOnSite: 0 })] }));
    await expect(
      service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { lines: [{ sovLineId: "sov-1", thisPeriodAmount: 0, materialsOnSite: 200000 }] }, actor: { id: "sub-user" } }),
    ).rejects.toMatchObject({ code: "SUB_PAY_APP_EXCEEDS_SCHEDULED" });
    // work plus materials up to the line's value is fine
    mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => payApp({ status: "draft", ...data }));
    await expect(
      service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { lines: [{ sovLineId: "sov-1", thisPeriodAmount: 60000, materialsOnSite: 40000 }] }, actor: { id: "sub-user" } }),
    ).resolves.toBeTruthy();
  });

  it("CX21-701: materials another application was paid for count in previous", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ id: "pa-A", status: "draft", lines: [line({ scheduledAmount: 100000, previousAmount: 0, thisPeriodAmount: 0, cumulativeAmount: 0 })] }));
    mockPrisma.subPayAppLine.findMany.mockImplementation(async ({ where } = {}) => (where?.payApp?.id?.not === "pa-A" ? [{ sovLineId: "sov-1", thisPeriodAmount: 40000, materialsOnSite: 30000 }] : []));
    await expect(
      service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-A", payload: { lines: [{ sovLineId: "sov-1", thisPeriodAmount: 40000 }] }, actor: { id: "sub-user" } }),
    ).rejects.toMatchObject({ code: "SUB_PAY_APP_EXCEEDS_SCHEDULED" });
    mockPrisma.subPayAppLine.update.mockClear();
    mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => payApp({ id: "pa-A", status: "draft", ...data }));
    await service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-A", payload: { lines: [{ sovLineId: "sov-1", thisPeriodAmount: 30000 }] }, actor: { id: "sub-user" } });
    // previous is the other application's WORK (40,000); its 30,000 of materials bound the value, not the work (CX21-801)
    expect(mockPrisma.subPayAppLine.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ previousAmount: 40000, cumulativeAmount: 70000 }) }));
  });

  it("CX21-702: an editor without the approval permission cannot revoke a certified application", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "approved", netThisPeriod: 27000, paidAmount: 0 }));
    mockPrisma.subPayApp.update.mockClear();
    await expect(service.reopenPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "qs" }, reason: "correction" })).rejects.toMatchObject({ code: "SUB_PAY_APP_REVOKE_FORBIDDEN", status: 403 });
    expect(mockPrisma.subPayApp.update).not.toHaveBeenCalled();
  });

  it("CX21-702: coming back from rejected needs no approval authority", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "rejected", netThisPeriod: 27000 }));
    mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => payApp({ status: "rejected", ...data }));
    const reopened = await service.reopenPayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", actor: { id: "qs" } });
    expect(reopened.status).toBe("draft");
  });
});

describe("Phase 21D — integrity (Codex round 9)", () => {
  afterEach(() => {
    mockPrisma.subPayAppLine.findMany.mockImplementation(async () => []);
    mockPrisma.activityProgress.findMany.mockResolvedValue([]);
    mockPrisma.commitmentSovLine.findMany.mockImplementation(async () => []);
  });

  it("CX21-801: materials another application was paid for bound the line's value but are not work against the progress cap", async () => {
    // 40,000 of work and 30,000 of materials were certified before; progress
    // is now approved at 50 %. A claim of 10,000 more work is valid: work
    // reaches 50,000 (the cap), value reaches 80,000 (under the line).
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ id: "pa-B", status: "draft", lines: [line({ scheduledAmount: 100000, previousAmount: 0, thisPeriodAmount: 0, cumulativeAmount: 0 })] }));
    mockPrisma.subPayAppLine.findMany.mockImplementation(async ({ where } = {}) => (where?.payApp?.id?.not === "pa-B" ? [{ sovLineId: "sov-1", thisPeriodAmount: 40000, materialsOnSite: 30000 }] : []));
    mockPrisma.activityProgress.findMany.mockResolvedValue([{ activityId: "act-1", pctComplete: 50 }]);
    mockPrisma.subPayAppLine.update.mockClear();
    mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => payApp({ id: "pa-B", status: "draft", ...data }));
    await service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-B", payload: { lines: [{ sovLineId: "sov-1", thisPeriodAmount: 10000 }] }, actor: { id: "sub-user" } });
    expect(mockPrisma.subPayAppLine.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ previousAmount: 40000, cumulativeAmount: 50000, overClaimAmount: 0 }) }));
    // but the value ceiling still counts those materials: 40,000 more work would be 80,000 + 30,000
    await expect(
      service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-B", payload: { lines: [{ sovLineId: "sov-1", thisPeriodAmount: 40000 }] }, actor: { id: "sub-user" } }),
    ).rejects.toMatchObject({ code: "SUB_PAY_APP_EXCEEDS_SCHEDULED" });
  });

  it("CX21-802: an application that exhausts the subcontract with work and materials is the final one", async () => {
    mockPrisma.commitmentSovLine.findMany.mockImplementation(async () => [{ amount: 100000 }]);
    const withMaterials = payApp({ id: "pa-F", lines: [line({ cumulativeAmount: 60000, materialsOnSite: 40000 })] });
    await expect(service.isFinalApplication({ existing: withMaterials })).resolves.toBe(true);
    const workOnly = payApp({ id: "pa-F", lines: [line({ cumulativeAmount: 60000, materialsOnSite: 0 })] });
    await expect(service.isFinalApplication({ existing: workOnly })).resolves.toBe(false);
    // materials another counted application was paid for count too
    mockPrisma.subPayAppLine.findMany.mockImplementation(async ({ where } = {}) => (where?.payApp?.id?.not === "pa-F" ? [{ sovLineId: "sov-1", thisPeriodAmount: 0, materialsOnSite: 40000 }] : []));
    await expect(service.isFinalApplication({ existing: workOnly })).resolves.toBe(true);
  });
});

describe("certification R29 — a lien waiver names only a file its writer may read", () => {
  beforeEach(() => {
    mockLinkable.mockReset();
    mockLinkable.mockImplementation(async () => undefined);
    mockPrisma.subPayApp.update.mockClear();
    mockPrisma.subPayApp.update.mockImplementation(async ({ data }) => payApp({ status: "draft", ...data }));
  });

  it("asks about the new waiver as the writer, keeping the one already on file, before anything is written", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "draft", waiverDocumentId: "waiver-old" }));
    await service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { waiverDocumentId: "waiver-1" }, actor: { id: "sub-user" } });
    const call = mockLinkable.mock.calls[0][0];
    expect(call).toMatchObject({ orgId: "org-1", projectId: "project-1", keys: ["waiver-1"], unchanged: ["waiver-old"], userId: "sub-user" });
    expect(call.refuse()).toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
    expect(mockPrisma.subPayApp.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ waiverDocumentId: "waiver-1" }) }));
  });

  it("a refused waiver is answered as a missing one and the application is not changed", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "draft", waiverDocumentId: null }));
    mockLinkable.mockImplementation(async ({ refuse }) => { throw refuse(); });
    await expect(service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { waiverDocumentId: "waiver-1" }, actor: { id: "sub-user" } })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
    expect(mockPrisma.subPayApp.update).not.toHaveBeenCalled();
  });

  it("clearing the waiver names no document", async () => {
    mockPrisma.subPayApp.findFirst.mockResolvedValue(payApp({ status: "draft", waiverDocumentId: "waiver-old" }));
    await service.updatePayApp({ orgId: "org-1", projectId: "project-1", payAppId: "pa-1", payload: { waiverDocumentId: null }, actor: { id: "sub-user" } });
    expect(mockLinkable).not.toHaveBeenCalled();
  });
});
