/**
 * Recording a client payment must refresh the cash-flow projection.
 *
 * Cash flow is a materialised projection. A subcontractor payment and a
 * direct-cost payment both rebuild it after their transaction commits; a
 * client (IPC) payment did not. The Phase 21 greenfield run recorded an
 * 80,000.00 client payment, and while the invoice said `amountPaid 80000,
 * balanceDue 28000, partially_paid` and receivables said `received 80000`,
 * the cash-flow summary said `inflow 0`. Finance would have seen no money in
 * until somebody happened to press rebuild (P21-009).
 *
 * The three payment paths must behave the same way, so this test pins the
 * IPC one to the pattern the other two already follow.
 */
const { referenceCounterMock } = require("./helpers/reference-counter-mock");

const ORG = "org-1";
const PROJECT = "project-1";
const PERIOD = "2027-03";

const certificate = () => ({
  id: "cert-1",
  projectId: PROJECT,
  period: PERIOD,
  status: "certified",
  paymentStatus: "unpaid",
  totalCert: 120000,
  totalRet: 12000,
  netPayable: 108000,
  amountPaid: 0,
});

const invoice = () => ({
  id: "inv-1",
  projectId: PROJECT,
  ipcCertificateId: "cert-1",
  status: "issued",
  grossAmount: 120000,
  retentionHeld: 12000,
  retentionReleased: 0,
  netAmount: 108000,
  amountPaid: 0,
  balanceDue: 108000,
});

const mockPrisma = {
  ...referenceCounterMock(),
  project: { findFirst: jest.fn(async () => ({ id: PROJECT, orgId: ORG })) },
  ipcCertificate: {
    findFirst: jest.fn(async () => certificate()),
    update: jest.fn(async ({ data }) => ({ ...certificate(), ...data })),
  },
  ipcInvoice: {
    findFirst: jest.fn(async () => invoice()),
    findMany: jest.fn(async () => [invoice()]),
    update: jest.fn(async ({ data }) => ({ ...invoice(), ...data })),
  },
  ipcPayment: {
    findMany: jest.fn(async () => []),
    findFirst: jest.fn(async () => null),
    create: jest.fn(async ({ data }) => ({ id: "pay-1", ...data })),
  },
  ipcRetentionRelease: { findMany: jest.fn(async () => []) },
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};

const mockCashFlow = { rebuildCashFlow: jest.fn(async () => ({})) };
const mockAudit = {
  ENTITY_TYPES: { IPC_CERTIFICATE: "ipc_certificate" },
  ACTIONS: { STATUS_CHANGED: "status_changed", UPDATED: "updated", CREATED: "created" },
  recordEvent: jest.fn(async () => null),
};
const mockWorkflow = {
  RECORD_TYPES: { IPC_CERTIFICATE: "ipc_certificate" },
  recordTransition: jest.fn(async () => null),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../cash-flow.service", () => mockCashFlow);
jest.mock("../audit.service", () => mockAudit);
jest.mock("../approval-workflow.service", () => mockWorkflow);
jest.mock("../prime-contract.service", () => ({}));

const ipcService = require("../ipc.service");

beforeEach(() => {
  mockCashFlow.rebuildCashFlow.mockClear();
  mockPrisma.ipcPayment.create.mockClear();
});

describe("recording a client (IPC) payment", () => {
  it("rebuilds the cash-flow projection for the project, like every other payment", async () => {
    await ipcService.recordIpcPayment({
      orgId: ORG,
      projectId: PROJECT,
      period: PERIOD,
      payload: { amount: 80000, paymentReference: "PMT-01", paymentDate: "2027-04-28" },
      userId: "finance-1",
      userRole: "finance",
    });

    expect(mockPrisma.ipcPayment.create).toHaveBeenCalledTimes(1);
    expect(mockCashFlow.rebuildCashFlow).toHaveBeenCalledWith({ orgId: ORG, projectId: PROJECT });
  });

  it("still returns the payment when the projection rebuild fails — cash flow is derived, the payment is the record", async () => {
    mockCashFlow.rebuildCashFlow.mockRejectedValueOnce(new Error("projection unavailable"));

    const result = await ipcService.recordIpcPayment({
      orgId: ORG,
      projectId: PROJECT,
      period: PERIOD,
      payload: { amount: 80000, paymentReference: "PMT-02" },
    });

    expect(result.payment).toMatchObject({ amount: 80000, paymentReference: "PMT-02" });
    expect(mockCashFlow.rebuildCashFlow).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild anything when the payment is refused", async () => {
    await expect(
      ipcService.recordIpcPayment({
        orgId: ORG,
        projectId: PROJECT,
        period: PERIOD,
        payload: { amount: 999999, paymentReference: "PMT-TOO-BIG" },
      }),
    ).rejects.toMatchObject({ code: "IPC_PAYMENT_EXCEEDS_PAYABLE_BALANCE" });

    expect(mockPrisma.ipcPayment.create).not.toHaveBeenCalled();
    expect(mockCashFlow.rebuildCashFlow).not.toHaveBeenCalled();
  });
});
