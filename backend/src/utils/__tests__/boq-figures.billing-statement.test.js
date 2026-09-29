jest.mock("../../middleware/rbac", () => ({ hasPermission: jest.fn() }));

const { BILLING_LINES_WITHHELD, withheldBillingStatement } = require("../boq-figures");

// A statement as prime-contract.service buildStatement builds it: the
// commercial module's own records, and the schedule of values read off the
// BOQ's rows.
const statement = () => ({
  contract: { id: "pc-1", ref: "PC-1", originalValue: 250000, revisedValue: 250000 },
  summary: { originalValue: 250000, currentCertified: 0, totalDue: 0 },
  current: { id: "ipc-1", period: "P01", status: "draft", totalCert: 0 },
  periods: [{ id: "ipc-1", period: "P01", status: "draft", totalCert: 0 }],
  lines: [
    {
      boqItemId: "boq-1",
      code: "Z9.71",
      section: null,
      description: "Grout to baseplates",
      unit: "m3",
      quantity: 37,
      rate: 487.61,
      contractAmount: 18041.57,
      previous: 0,
      thisPeriod: 0,
      total: 0,
      remaining: 18041.57,
      pctComplete: 0,
    },
  ],
});

describe("withheldBillingStatement (the client billing statement's BOQ rows)", () => {
  it("hands a BOQ reader the statement exactly as built", () => {
    const built = statement();
    expect(withheldBillingStatement(built, { boq: true, budget: true })).toBe(built);
  });

  it("leaves the schedule of values out for a member without BOQ read, cost readers included, and says so", () => {
    for (const access of [{ boq: false, budget: true }, { boq: false, budget: false }]) {
      const built = statement();
      const answer = withheldBillingStatement(built, access);
      const { lines, ...rest } = statement();
      expect(lines).toHaveLength(1);
      expect(answer).toEqual({ ...rest, linesWithheld: { reason: BILLING_LINES_WITHHELD } });
      for (const secret of ["boq-1", "Z9.71", "Grout", "487.61", "18041.57"]) {
        expect([secret, JSON.stringify(answer).includes(secret)]).toEqual([secret, false]);
      }
      // Output only: the built statement is not touched.
      expect(built.lines).toHaveLength(1);
    }
  });

  it("takes the BOQ reader's view when no access is passed — the route always passes the caller's", () => {
    expect(withheldBillingStatement(statement())).toHaveProperty("lines");
    expect(withheldBillingStatement(statement(), { boq: false, budget: false })).not.toHaveProperty("lines");
  });

  it("returns anything that is not a statement untouched", () => {
    for (const value of [null, undefined, "x", { contract: {} }]) {
      expect(withheldBillingStatement(value, { boq: false, budget: false })).toBe(value);
    }
  });
});

// The payment certificate beside the statement: the period read, as
// ipc.service getIpcPeriod builds it — the certificate's own record, its
// lines (each a BoqItem row with its allocation) and the review over them.
const { IPC_LINES_WITHHELD, withheldIpcCertificate, withheldIpcItem } = require("../boq-figures");

const line = () => ({
  id: "ipc-item-1",
  boqItemId: "boq-1",
  allocationId: "alloc-1",
  qty: 10,
  rate: 487.61,
  currentCert: 4876.1,
  boqItem: { id: "boq-1", code: "Z9.71", ref: "Z9.71", description: "Grout to baseplates", unit: "m3", qty: 37, rate: 487.61 },
  allocation: { id: "alloc-1", quantity: 37, amount: 18041.57, weight: 1, activity: { id: "act-1", name: "Grout" } },
  progressLinks: [{ id: "link-1", allocationId: "alloc-1", certifiedAmount: 4876.1 }],
  certificationReview: { approvedLimitAmount: 18041.57, earnedAmount: 0 },
});

const certificate = () => ({
  id: "ipc-1",
  period: "P01",
  status: "certified",
  totalCert: 4876.1,
  totalRet: 243.81,
  netPayable: 4632.29,
  earnedValueAtCertification: 0,
  approvedLimitAtCertification: 18041.57,
  overCertificationAmount: 4876.1,
  items: [line()],
  certificationReview: { approvedLimitAmount: 18041.57, overrideLineCount: 1 },
  invoices: [],
  payments: [],
  retentionReleases: [],
});

describe("withheldIpcCertificate (a payment certificate's BOQ rows and the review over them)", () => {
  it("hands a BOQ reader the certificate exactly as built", () => {
    const built = certificate();
    expect(withheldIpcCertificate(built, { boq: true, budget: true })).toBe(built);
  });

  it("leaves the lines, the review and its stamp out for a member without BOQ read, cost readers included, and says so", () => {
    for (const access of [{ boq: false, budget: true }, { boq: false, budget: false }]) {
      const built = certificate();
      const answer = withheldIpcCertificate(built, access);
      expect(answer).toEqual({
        id: "ipc-1",
        period: "P01",
        status: "certified",
        totalCert: 4876.1,
        totalRet: 243.81,
        netPayable: 4632.29,
        invoices: [],
        payments: [],
        retentionReleases: [],
        boqWithheld: {
          keys: ["items", "certificationReview", "earnedValueAtCertification", "approvedLimitAtCertification", "overCertificationAmount"],
          reason: IPC_LINES_WITHHELD,
        },
      });
      for (const secret of ["boq-1", "alloc-1", "Z9.71", "Grout", "487.61", "18041.57"]) {
        expect([secret, JSON.stringify(answer).includes(secret)]).toEqual([secret, false]);
      }
      expect(built.items).toHaveLength(1);
    }
  });

  it("names only the keys a certificate carried (a list row has no lines), and leaves one with none untouched", () => {
    const { items, certificationReview, ...row } = certificate();
    expect(items).toHaveLength(1);
    expect(certificationReview).toBeDefined();
    expect(withheldIpcCertificate(row, { boq: false, budget: true }).boqWithheld.keys).toEqual([
      "earnedValueAtCertification",
      "approvedLimitAtCertification",
      "overCertificationAmount",
    ]);
    const bare = { id: "ipc-2", period: "P02", totalCert: 0 };
    expect(withheldIpcCertificate(bare, { boq: false, budget: false })).toBe(bare);
    for (const value of [null, undefined, "x", []]) {
      expect(withheldIpcCertificate(value, { boq: false, budget: false })).toBe(value);
    }
  });
});

describe("withheldIpcItem (the answer to editing a certificate line)", () => {
  it("hands a BOQ reader the line exactly as written", () => {
    const written = line();
    expect(withheldIpcItem(written, { boq: true, budget: true })).toBe(written);
  });

  it("names the line and nothing of it for a member without BOQ read", () => {
    expect(withheldIpcItem(line(), { boq: false, budget: true })).toEqual({
      id: "ipc-item-1",
      itemWithheld: { reason: IPC_LINES_WITHHELD },
    });
  });
});
