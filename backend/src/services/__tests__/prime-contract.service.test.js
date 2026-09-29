const { referenceCounterMock } = require("./helpers/reference-counter-mock");
/**
 * The client contract.
 *
 * The arithmetic is the product here: a certificate's net payable is what the
 * client is actually asked for, and getting the order of operations wrong —
 * taxing before retention, recovering more advance than is outstanding,
 * retaining past the cap — is the kind of error that is only found in a
 * dispute.
 */

const mockPrisma = {
  ...referenceCounterMock(),
  primeContract: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn() },
  primeContractAdvance: { findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
  changeOrder: { aggregate: jest.fn() },
  ipcInvoice: { findMany: jest.fn() },
  ipcCertificate: { findMany: jest.fn() },
  boqItem: { findMany: jest.fn(), aggregate: jest.fn() },
  ipcItem: { findMany: jest.fn() },
  project: { findFirst: jest.fn() },
  $transaction: (fn) => fn(mockPrisma),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => ({
  ENTITY_TYPES: { PROJECT: "project" },
  ACTIONS: { UPDATED: "updated" },
  recordEvent: jest.fn(async () => null),
}));

const service = require("../prime-contract.service");

const contract = (over = {}) => ({
  id: "contract-1",
  projectId: "project-1",
  revisedValue: 1_000_000,
  retentionRate: 5,
  retentionCapRate: null,
  advanceRate: 10,
  advanceAmount: 100_000,
  advancePaidAmount: 100_000,
  advanceRecoveryRate: 20,
  advanceRecoveredAmount: 0,
  materialsOnSiteRate: 100,
  taxRate: 0,
  currency: "USD",
  paymentTermsDays: 30,
  ...over,
});

describe("certificate financials", () => {
  it("takes retention, then the advance, then tax on what is left", () => {
    const result = service.certificateFinancials({
      contract: contract({ advanceRecoveryRate: 20, taxRate: 5 }),
      totalCert: 100_000,
      totalRet: 5_000,
      deductions: 0,
    });

    expect(result.gross).toBe(100_000);
    expect(result.retention).toBe(5_000);
    expect(result.advanceRecovery).toBe(20_000); // 20% of the gross
    expect(result.beforeTax).toBe(75_000);
    expect(result.taxAmount).toBe(3_750); // 5% of 75,000, not of the gross
    expect(result.netPayable).toBe(78_750);
  });

  it("adds stored materials to the gross", () => {
    const result = service.certificateFinancials({
      contract: contract({ advanceRecoveryRate: 0 }),
      totalCert: 80_000,
      materialsOnSite: 20_000,
      totalRet: 4_000,
    });
    expect(result.gross).toBe(100_000);
    expect(result.netPayable).toBe(96_000);
  });

  it("never recovers more advance than is still outstanding", () => {
    // 90,000 of a 100,000 advance is already back; 20% of this gross would be
    // 20,000, but only 10,000 is owed.
    const result = service.certificateFinancials({
      contract: contract({ advanceRecoveredAmount: 90_000 }),
      totalCert: 100_000,
      totalRet: 0,
    });
    expect(result.advanceRecovery).toBe(10_000);
  });

  it("stops recovering once the advance is repaid", () => {
    const result = service.certificateFinancials({
      contract: contract({ advanceRecoveredAmount: 100_000 }),
      totalCert: 100_000,
      totalRet: 0,
    });
    expect(result.advanceRecovery).toBe(0);
    expect(result.netPayable).toBe(100_000);
  });

  it("stops retaining at the contract cap", () => {
    // The cap is 5% of 1,000,000 = 50,000, and 48,000 is already held.
    const result = service.certificateFinancials({
      contract: contract({ retentionCapRate: 5, advanceRecoveryRate: 0 }),
      totalCert: 200_000,
      totalRet: 10_000,
      cumulativeRetention: 48_000,
    });
    expect(result.retention).toBe(2_000);
    expect(result.netPayable).toBe(198_000);
  });

  it("holds nothing more once the cap is reached", () => {
    const result = service.certificateFinancials({
      contract: contract({ retentionCapRate: 5, advanceRecoveryRate: 0 }),
      totalCert: 100_000,
      totalRet: 5_000,
      cumulativeRetention: 50_000,
    });
    expect(result.retention).toBe(0);
  });

  it("takes a deduction off before tax", () => {
    const result = service.certificateFinancials({
      contract: contract({ advanceRecoveryRate: 0, taxRate: 10 }),
      totalCert: 100_000,
      totalRet: 5_000,
      deductions: 15_000,
    });
    expect(result.beforeTax).toBe(80_000);
    expect(result.taxAmount).toBe(8_000);
    expect(result.netPayable).toBe(88_000);
  });

  it("reads a project with no terms as certified less retention", () => {
    // A project that never set up a contract must bill exactly as it always did.
    const result = service.certificateFinancials({
      contract: null,
      totalCert: 100_000,
      totalRet: 5_000,
    });
    expect(result.advanceRecovery).toBe(0);
    expect(result.taxAmount).toBe(0);
    expect(result.netPayable).toBe(95_000);
  });
});

describe("revised contract value", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.primeContract.findFirst.mockResolvedValue(
      contract({ originalValue: 1_000_000, approvedChangesValue: 0 })
    );
    mockPrisma.primeContract.update.mockImplementation(async ({ data }) => data);
  });

  it("moves with approved client change orders and nothing else", async () => {
    mockPrisma.changeOrder.aggregate
      .mockResolvedValueOnce({ _sum: { value: 125_000 } }) // approved
      .mockResolvedValueOnce({ _sum: { value: 40_000 } }); // still in play

    const result = await service.recomputeChangeValues(mockPrisma, {
      orgId: "org-1",
      projectId: "project-1",
    });

    expect(result.approvedChangesValue).toBe(125_000);
    expect(result.revisedValue).toBe(1_125_000);
    // Pending is reported beside the revised value, never folded into it.
    expect(result.pendingChangesValue).toBe(40_000);
  });

  it("is the original value when nothing has been approved", async () => {
    mockPrisma.changeOrder.aggregate
      .mockResolvedValueOnce({ _sum: { value: null } })
      .mockResolvedValueOnce({ _sum: { value: null } });

    const result = await service.recomputeChangeValues(mockPrisma, {
      orgId: "org-1",
      projectId: "project-1",
    });
    expect(result.revisedValue).toBe(1_000_000);
  });

  it("does nothing on a project that has no contract yet", async () => {
    mockPrisma.primeContract.findFirst.mockResolvedValue(null);
    const result = await service.recomputeChangeValues(mockPrisma, {
      orgId: "org-1",
      projectId: "project-1",
    });
    expect(result).toBeNull();
    expect(mockPrisma.primeContract.update).not.toHaveBeenCalled();
  });
});

describe("creating the contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.primeContract.findFirst.mockResolvedValue(null);
    mockPrisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      name: "Riverside Tower",
      contractNumber: "RT-2026-014",
      contractType: "lump_sum",
      contractValue: 9_290_000,
      currency: "USD",
      defaultRetentionRate: 5,
      startDate: null,
      endDate: null,
    });
    mockPrisma.boqItem.aggregate.mockResolvedValue({ _sum: { amount: 7_727_000 } });
    mockPrisma.primeContract.create.mockImplementation(async ({ data }) => data);
  });

  it("counts change orders that were already approved before it existed", async () => {
    // A project that predates this module has a history of approved changes.
    // Starting the contract at zero and waiting for the next change order to
    // correct it would report the wrong contract value for months.
    mockPrisma.changeOrder.aggregate
      .mockResolvedValueOnce({ _sum: { value: 3_000_000 } })
      .mockResolvedValueOnce({ _sum: { value: 1_075_500 } });

    const created = await service.ensureContract({
      orgId: "org-1",
      projectId: "project-1",
    });

    expect(created.originalValue).toBe(9_290_000);
    expect(created.approvedChangesValue).toBe(3_000_000);
    expect(created.revisedValue).toBe(12_290_000);
    expect(created.pendingChangesValue).toBe(1_075_500);
    // The project's own value: established, and recorded as such.
    expect(created.originalValueSource).toBe("project_value");
  });

  it("falls back to the BOQ when the project carries no contract value", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      name: "Riverside Tower",
      contractNumber: null,
      contractType: null,
      contractValue: null,
      currency: "USD",
      defaultRetentionRate: null,
      startDate: null,
      endDate: null,
    });
    mockPrisma.changeOrder.aggregate
      .mockResolvedValueOnce({ _sum: { value: 0 } })
      .mockResolvedValueOnce({ _sum: { value: 0 } });

    const created = await service.ensureContract({
      orgId: "org-1",
      projectId: "project-1",
    });
    expect(created.originalValue).toBe(7_727_000);
    expect(created.retentionRate).toBe(5);
    expect(created.contractType).toBe("lump_sum");
    // The bill's total: recorded as the fallback, which nobody has confirmed.
    expect(created.originalValueSource).toBe("boq_fallback");
  });
});

describe("where the original value came from (owner decisions 1-3)", () => {
  const stored = (over = {}) =>
    contract({
      ref: "PC-1",
      originalValue: 7_727_000,
      originalValueSource: "boq_fallback",
      approvedChangesValue: 0,
      advanceRate: 0,
      ...over,
    });
  let written;
  beforeEach(() => {
    jest.clearAllMocks();
    written = null;
    mockPrisma.primeContract.update.mockImplementation(async ({ data }) => {
      written = { ...(written || {}), ...data };
      return data;
    });
    mockPrisma.changeOrder.aggregate.mockResolvedValue({ _sum: { value: 0 } });
  });
  const run = async (current, payload, extra = {}) => {
    mockPrisma.primeContract.findFirst.mockResolvedValue(current);
    mockPrisma.primeContract.findUnique = jest.fn(async () => ({ ...current, ...written }));
    return service.updateContract({ orgId: "org-1", projectId: "project-1", userId: "user-1", payload, ...extra });
  };

  it("a save without an original value, or with the stored one sent back, leaves the fallback a fallback", async () => {
    for (const payload of [{ taxRate: 5 }, { originalValue: 7_727_000 }, { originalValue: "7727000.00" }]) {
      const answer = await run(stored(), payload);
      expect([payload, written.originalValueSource, answer.originalValueSource]).toEqual([payload, undefined, "boq_fallback"]);
    }
  });

  it("a different original value is an entry, recorded by the audit event", async () => {
    const audit = require("../audit.service");
    const answer = await run(stored(), { originalValue: 8_000_000 });
    expect(written.originalValueSource).toBe("contract_entry");
    expect(answer.originalValueSource).toBe("contract_entry");
    const event = audit.recordEvent.mock.calls.at(-1)[0];
    expect(event.actorId).toBe("user-1");
    expect(event.summary).toEqual({ transition: "contract.manage", ref: "PC-1", originalValueConfirmation: "entered" });
    expect(event.oldSummary).toMatchObject({ originalValue: 7_727_000, originalValueSource: "boq_fallback" });
    expect(event.newSummary).toMatchObject({ originalValue: 8_000_000, originalValueSource: "contract_entry" });
  });

  it("a client never sets the source itself", async () => {
    await run(stored(), { originalValueSource: "project_value", taxRate: 5 });
    expect(written.originalValueSource).toBeUndefined();
  });

  it("confirming the fallback as it stands needs BOQ read, stands alone, and only confirms what is not established", async () => {
    await expect(run(stored(), { confirmOriginalValue: true })).rejects.toMatchObject({ status: 403, code: "CONTRACT_VALUE_CONFIRM_FORBIDDEN" });
    expect(written).toBeNull();
    await expect(run(stored(), { confirmOriginalValue: true, originalValue: 7_727_000 }, { canConfirmFallback: true })).rejects.toMatchObject({ status: 400, code: "CONTRACT_VALUE_CONFIRM_CONFLICT" });
    await expect(run(stored({ originalValueSource: "project_value" }), { confirmOriginalValue: true }, { canConfirmFallback: true })).rejects.toMatchObject({ status: 409, code: "CONTRACT_VALUE_ALREADY_ESTABLISHED" });
    expect(written).toBeNull();

    const audit = require("../audit.service");
    for (const source of ["boq_fallback", null]) {
      written = null;
      const answer = await run(stored({ originalValueSource: source }), { confirmOriginalValue: true }, { canConfirmFallback: true });
      expect([source, written.originalValueSource, written.originalValue, answer.originalValue]).toEqual([source, "contract_entry", undefined, 7_727_000]);
      expect(audit.recordEvent.mock.calls.at(-1)[0].summary.originalValueConfirmation).toBe("confirmed");
    }
  });
});

describe("receivables", () => {
  const day = 24 * 60 * 60 * 1000;
  const asOf = new Date("2026-09-07T00:00:00.000Z");
  const daysAgo = (n) => new Date(asOf.getTime() - n * day);

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.primeContract.findFirst.mockResolvedValue(contract({ paymentTermsDays: 30 }));
  });

  it("ages an invoice from its due date", async () => {
    mockPrisma.ipcInvoice.findMany.mockResolvedValue([
      {
        id: "inv-1",
        invoiceNumber: "INV-001",
        invoiceDate: daysAgo(100),
        dueDate: daysAgo(45),
        netAmount: 50_000,
        amountPaid: 0,
        status: "issued",
        ipcCertificate: { period: "IPC-1" },
      },
    ]);

    const result = await service.receivables({ orgId: "org-1", projectId: "project-1", asOf });
    expect(result.outstanding).toBe(50_000);
    expect(result.overdue).toBe(50_000);
    expect(result.invoices[0].daysOverdue).toBe(45);
    expect(result.invoices[0].bucket).toBe("d31_60");
  });

  it("falls back to the contract's payment terms when no due date was set", async () => {
    // An invoice with no due date is still owed. Hiding it until somebody
    // types a date is how debt goes unnoticed.
    mockPrisma.ipcInvoice.findMany.mockResolvedValue([
      {
        id: "inv-2",
        invoiceNumber: "INV-002",
        invoiceDate: daysAgo(40),
        dueDate: null,
        netAmount: 20_000,
        amountPaid: 0,
        status: "issued",
        ipcCertificate: { period: "IPC-2" },
      },
    ]);

    const result = await service.receivables({ orgId: "org-1", projectId: "project-1", asOf });
    expect(result.invoices[0].daysOverdue).toBe(10);
    expect(result.invoices[0].bucket).toBe("d1_30");
  });

  it("leaves a paid invoice out of the ageing but keeps it in the totals", async () => {
    mockPrisma.ipcInvoice.findMany.mockResolvedValue([
      {
        id: "inv-3",
        invoiceNumber: "INV-003",
        invoiceDate: daysAgo(200),
        dueDate: daysAgo(170),
        netAmount: 30_000,
        amountPaid: 30_000,
        status: "paid",
        ipcCertificate: { period: "IPC-1" },
      },
    ]);

    const result = await service.receivables({ orgId: "org-1", projectId: "project-1", asOf });
    expect(result.received).toBe(30_000);
    expect(result.outstanding).toBe(0);
    expect(result.overdue).toBe(0);
    expect(result.ageing.every((bucket) => bucket.amount === 0)).toBe(true);
  });

  it("is not yet due before its date", async () => {
    mockPrisma.ipcInvoice.findMany.mockResolvedValue([
      {
        id: "inv-4",
        invoiceNumber: "INV-004",
        invoiceDate: daysAgo(5),
        dueDate: new Date(asOf.getTime() + 25 * day),
        netAmount: 10_000,
        amountPaid: 0,
        status: "issued",
        ipcCertificate: { period: "IPC-3" },
      },
    ]);

    const result = await service.receivables({ orgId: "org-1", projectId: "project-1", asOf });
    expect(result.invoices[0].bucket).toBe("current");
    expect(result.overdue).toBe(0);
    expect(result.outstanding).toBe(10_000);
  });
});

describe("advance payments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.primeContract.findFirst.mockResolvedValue(
      contract({ advanceAmount: 100_000, advancePaidAmount: 0 })
    );
    mockPrisma.primeContractAdvance.count.mockResolvedValue(0);
    mockPrisma.primeContractAdvance.findFirst.mockResolvedValue(null);
    mockPrisma.primeContractAdvance.create.mockResolvedValue({ id: "adv-1" });
    mockPrisma.primeContract.update.mockImplementation(async ({ data }) =>
      contract({ ...data })
    );
  });

  it("records what the client paid against the advance", async () => {
    const result = await service.recordAdvancePayment({
      orgId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      payload: { amount: 100_000 },
    });

    expect(mockPrisma.primeContractAdvance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "payment", amount: 100_000 }),
      })
    );
    expect(result.advancePaidAmount).toBe(100_000);
  });

  it("refuses more than the advance agreed in the contract", async () => {
    await expect(
      service.recordAdvancePayment({
        orgId: "org-1",
        projectId: "project-1",
        userId: "user-1",
        payload: { amount: 150_000 },
      })
    ).rejects.toThrow(expect.objectContaining({ code: "ADVANCE_OVER_AGREED" }));
  });

  it("writes a ledger row when a certificate recovers some of it", async () => {
    mockPrisma.primeContract.findFirst.mockResolvedValue(
      contract({ advancePaidAmount: 100_000, advanceRecoveredAmount: 0 })
    );

    await service.applyAdvanceRecovery(mockPrisma, {
      orgId: "org-1",
      projectId: "project-1",
      certificate: { id: "cert-1", period: "IPC-1" },
      amount: 20_000,
    });

    expect(mockPrisma.primeContractAdvance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "recovery", certificateId: "cert-1" }),
      })
    );
    expect(mockPrisma.primeContract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ advanceRecoveredAmount: 20_000 }),
      })
    );
  });

  it("does not recover the same certificate twice", async () => {
    mockPrisma.primeContractAdvance.findFirst.mockResolvedValue({ id: "adv-existing" });

    await service.applyAdvanceRecovery(mockPrisma, {
      orgId: "org-1",
      projectId: "project-1",
      certificate: { id: "cert-1", period: "IPC-1" },
      amount: 20_000,
    });

    expect(mockPrisma.primeContractAdvance.create).not.toHaveBeenCalled();
    expect(mockPrisma.primeContract.update).not.toHaveBeenCalled();
  });
});

describe("Phase 21D — integrity (release challenge, ninth pass)", () => {
  it("CX21-495: a receipt is decided on the contract as held — a receipt that landed since the read counts against the agreed advance, and the aggregate carries both", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1", orgId: "org-1", name: "P" });
    mockPrisma.primeContract.findFirst.mockResolvedValue(contract({ advanceAmount: 100_000, advancePaidAmount: 0 }));
    mockPrisma.primeContractAdvance.findFirst.mockResolvedValue(null);
    mockPrisma.primeContractAdvance.create.mockClear();
    mockPrisma.primeContract.update.mockClear();
    mockPrisma.primeContract.update.mockImplementation(async ({ data }) => contract({ ...data }));
    // as held, 60,000 has arrived since the read: a second 60,000 would exceed the 100,000 agreed
    mockPrisma.$queryRaw = jest.fn(async () => [{ advanceAmount: 100_000, advancePaidAmount: 60_000 }]);
    await expect(
      service.recordAdvancePayment({ orgId: "org-1", projectId: "project-1", userId: "user-1", payload: { amount: 60_000, reference: "ADV-2" } })
    ).rejects.toMatchObject({ status: 409, code: "ADVANCE_OVER_AGREED" });
    expect(mockPrisma.primeContractAdvance.create).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw.mock.calls[0][0].join("?")).toMatch(/FOR UPDATE/);
    // a receipt that fits is added to the figure as held, not to the one read before
    mockPrisma.$queryRaw.mockResolvedValue([{ advanceAmount: 100_000, advancePaidAmount: 30_000 }]);
    await service.recordAdvancePayment({ orgId: "org-1", projectId: "project-1", userId: "user-1", payload: { amount: 60_000, reference: "ADV-3" } });
    expect(mockPrisma.primeContract.update.mock.calls.at(-1)[0].data).toMatchObject({ advancePaidAmount: 90_000 });
    delete mockPrisma.$queryRaw;
  });
});
