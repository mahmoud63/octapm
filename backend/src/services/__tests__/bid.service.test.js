const { referenceCounterMock } = require("./helpers/reference-counter-mock");
const store = { packages: [], lines: [], invitations: [], addenda: [], questions: [], bids: [], bidLines: [], attachments: [], companies: [], prequals: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((clause) => matches(row, clause));
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ("in" in expected) return expected.in.includes(row[key]);
      if ("not" in expected) return row[key] !== expected.not;
      return matches(row[key] || {}, expected);
    }
    return row[key] === expected;
  });

const includeFor = (model) => (row) => {
  if (!row) return row;
  if (model === "package") {
    const lines = store.lines.filter((line) => line.packageId === row.id).sort((a, b) => a.lineNumber - b.lineNumber);
    const invitations = store.invitations.filter((item) => item.packageId === row.id).map((item) => ({ ...item, bids: store.bids.filter((bid) => bid.invitationId === item.id).map((bid) => ({ status: bid.status, total: bid.total })) }));
    const bids = store.bids.filter((bid) => bid.packageId === row.id).map((bid) => ({ ...bid, lines: store.bidLines.filter((line) => line.bidId === bid.id), invitation: store.invitations.find((item) => item.id === bid.invitationId) || null }));
    return { ...row, lines, invitations, addenda: store.addenda.filter((item) => item.packageId === row.id), questions: store.questions.filter((item) => item.packageId === row.id).map((q) => ({ ...q, invitation: store.invitations.find((item) => item.id === q.invitationId) || null })), bids, _count: { lines: lines.length, invitations: invitations.length, questions: store.questions.filter((item) => item.packageId === row.id).length } };
  }
  if (model === "invitation") {
    const pkg = includeFor("package")(store.packages.find((item) => item.id === row.packageId));
    return { ...row, package: pkg, bids: store.bids.filter((bid) => bid.invitationId === row.id).map((bid) => ({ ...bid, lines: store.bidLines.filter((line) => line.bidId === bid.id) })) };
  }
  if (model === "bid") return { ...row, lines: store.bidLines.filter((line) => line.bidId === row.id), invitation: store.invitations.find((item) => item.id === row.invitationId) || null };
  if (model === "question") return { ...row, invitation: store.invitations.find((item) => item.id === row.invitationId) || null };
  return row;
};

/** Column defaults the database would apply. */
const DEFAULTS = {
  pkg: { status: "draft", boqSections: [], currency: "USD", commitmentType: "subcontract", settingsJson: {} },
  line: { qty: 1, sortOrder: 0 },
  inv: { status: "invited", remindersSent: 0 },
  q: { status: "open", shared: false, askedAt: new Date() },
  bid: { status: "draft", version: 1, total: 0 },
  bl: { included: true, amount: 0 },
  add: { issuedAt: new Date() },
  co: { status: "active", isVendor: false },
};

const table = (rows, prefix, model = null) => ({
  findMany: jest.fn(async ({ where } = {}) => rows.filter((row) => matches(row, where)).map(includeFor(model))),
  findFirst: jest.fn(async ({ where } = {}) => includeFor(model)(rows.find((row) => matches(row, where)) || null)),
  findUnique: jest.fn(async ({ where }) => includeFor(model)(rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) || null)),
  count: jest.fn(async ({ where } = {}) => rows.filter((row) => matches(row, where)).length),
  // Sequences take their next value from the highest already used, not from
  // how many rows exist, so the fake table has to be able to answer that
  // (OCTA-API-REFNUM-111).
  aggregate: jest.fn(async ({ where, _max } = {}) => {
    const found = rows.filter((row) => matches(row, where));
    const max = {};
    for (const field of Object.keys(_max || {})) {
      const values = found
        .map((row) => row[field])
        .filter((value) => value !== null && value !== undefined);
      max[field] = values.length ? values.reduce((a, b) => (a > b ? a : b)) : null;
    }
    return { _max: max };
  }),
  create: jest.fn(async ({ data }) => {
    const nested = data.lines?.create;
    const { lines, ...rest } = data;
    const row = { id: nextId(prefix), createdAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[prefix] || {}), ...rest };
    rows.push(row);
    if (nested && model === "package") for (const line of nested) store.lines.push({ id: nextId("line"), packageId: row.id, createdAt: new Date(), ...DEFAULTS.line, ...line });
    void lines;
    return includeFor(model)(row);
  }),
  createMany: jest.fn(async ({ data }) => {
    for (const entry of data) rows.push({ id: nextId(prefix), createdAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[prefix] || {}), ...entry });
    return { count: data.length };
  }),
  update: jest.fn(async ({ where, data }) => {
    const row = rows.find((item) => item.id === where.id);
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? (row[key] || 0) + value.increment : value;
    return includeFor(model)(row);
  }),
  updateMany: jest.fn(async ({ where, data }) => {
    let count = 0;
    for (const row of rows) if (matches(row, where)) Object.assign(row, data) && (count += 1);
    return { count };
  }),
  delete: jest.fn(async ({ where }) => rows.splice(rows.findIndex((item) => item.id === where.id), 1)[0]),
  deleteMany: jest.fn(async ({ where }) => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i], where)) rows.splice(i, 1);
    return { count: before - rows.length };
  }),
  groupBy: jest.fn(async () => [{ section: "02 Substructure", _count: { _all: 2 }, _sum: { amount: 150000 } }, { section: "03 Concrete", _count: { _all: 1 }, _sum: { amount: 80000 } }]),
});

const BOQ = [
  { id: "boq-1", projectId: "p1", section: "02 Substructure", code: "2.1", description: "Bored piles 600mm", unit: "m", qty: 1000, rate: 120, amount: 120000, isActive: true, supersededAt: null, sortOrder: 1 },
  { id: "boq-2", projectId: "p1", section: "02 Substructure", code: "2.2", description: "Pile caps", unit: "m3", qty: 150, rate: 200, amount: 30000, isActive: true, supersededAt: null, sortOrder: 2 },
  { id: "boq-3", projectId: "p1", section: "03 Concrete", code: "3.1", description: "Slab on grade", unit: "m3", qty: 400, rate: 200, amount: 80000, isActive: true, supersededAt: null, sortOrder: 3 },
];

const mockPrisma = {
  ...referenceCounterMock(),
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async ({ where }) => (where.id === "p1" ? { id: "p1", name: "Tower", currency: "USD", orgId: "org-1" } : null)) },
  boqItem: { ...table(BOQ, "boq"), findMany: jest.fn(async ({ where }) => BOQ.filter((item) => item.isActive && (!where.section || where.section.in.includes(item.section)) && (!where.id || where.id.in.includes(item.id)))) },
  bidPackage: table(store.packages, "pkg", "package"),
  bidPackageLine: table(store.lines, "line"),
  bidInvitation: table(store.invitations, "inv", "invitation"),
  bidAddendum: table(store.addenda, "add"),
  bidQuestion: table(store.questions, "q", "question"),
  bid: table(store.bids, "bid", "bid"),
  bidLine: table(store.bidLines, "bl"),
  attachment: { ...table(store.attachments, "att"), findMany: jest.fn(async () => store.attachments.map((row) => ({ ...row, document: { id: row.documentId, originalName: "Drawings.pdf", fileName: "d.pdf", mimeType: "application/pdf", sizeBytes: 10, uploadedAt: new Date() } }))) },
  company: table(store.companies, "co"),
  vendorPrequalification: table(store.prequals, "pq"),
};
const mockAudit = { ENTITY_TYPES: { BID_PACKAGE: "bid_package" }, ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed" }, recordEvent: jest.fn(async () => ({})) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { COMMERCIAL: "commercial" }, createNotifications: jest.fn(async () => ({ created: 1 })) };
const mockEmail = { sendEmail: jest.fn(async ({ to }) => ({ delivered: true, to })) };
const mockCommitments = { createCommitment: jest.fn(async ({ payload }) => ({ id: "commit-1", ref: "SC-007", status: "draft", lines: payload.lines })) };
const mockAttachments = { getDocumentFile: jest.fn(async () => ({ path: "/tmp/d.pdf", mimeType: "application/pdf" })), createAttachments: jest.fn(async () => ({ items: [] })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../email.service", () => mockEmail);
jest.mock("../commitment.service", () => mockCommitments);
jest.mock("../attachment.service", () => mockAttachments);

const service = require("../bid.service");

const ORG = "org-1";
const PROJECT = "p1";
const actor = { id: "pm-1", role: "pm" };
const tokenFromEmail = (index = 0) => {
  const call = mockEmail.sendEmail.mock.calls[index][0];
  return /\/bid\/([A-Za-z0-9_-]+)/.exec(call.body)[1];
};
const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("bid management", () => {
  beforeEach(() => {
    for (const rows of Object.values(store)) rows.length = 0;
    jest.clearAllMocks();
  });

  const setupOpenPackage = async () => {
    const pkg = await service.createPackage({ orgId: ORG, projectId: PROJECT, payload: { title: "Piling subcontract", boqSections: ["02 Substructure"], dueAt: future(10), questionsDueAt: future(7) }, actor });
    await service.inviteBidders({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, invitations: [{ companyName: "Delta Piling", contactEmail: "bids@delta.example", contactName: "Dana" }, { companyName: "Omega Foundations", contactEmail: "tenders@omega.example" }], actor });
    const published = await service.publishPackage({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, actor });
    return { pkg: published, tokenA: tokenFromEmail(0), tokenB: tokenFromEmail(1) };
  };

  it("builds a package from BOQ sections, invites bidders and publishes with personal links", async () => {
    const sections = await service.listBoqSections({ orgId: ORG, projectId: PROJECT });
    expect(sections.map((row) => row.section)).toEqual(["02 Substructure", "03 Concrete"]);
    const pkg = await service.createPackage({ orgId: ORG, projectId: PROJECT, payload: { title: "Piling subcontract", boqSections: ["02 Substructure"], dueAt: future(10) }, actor });
    expect(pkg).toMatchObject({ ref: "BP-001", status: "draft", currency: "USD", commitmentType: "subcontract" });
    expect(pkg.lines.map((line) => [line.lineNumber, line.code, line.qty, line.estimateRate, line.estimateAmount])).toEqual([[1, "2.1", 1000, 120, 120000], [2, "2.2", 150, 200, 30000]]);
    await expect(service.publishPackage({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, actor })).rejects.toMatchObject({ code: "BID_INVITATIONS_REQUIRED" });
    await expect(service.inviteBidders({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, invitations: [{ companyName: "No email" }], actor })).rejects.toMatchObject({ code: "BID_INVITATION_EMAIL" });
    const invited = await service.inviteBidders({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, invitations: [{ companyName: "Delta Piling", contactEmail: "Bids@Delta.example" }], actor });
    expect(invited[0]).toMatchObject({ companyName: "Delta Piling", contactEmail: "bids@delta.example", status: "invited" });
    expect(invited[0].portalUrl).toBeUndefined();
    expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    await service.addLinesFromBoq({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, sections: ["03 Concrete"], actor });
    const published = await service.publishPackage({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, actor });
    expect(published.status).toBe("open");
    expect(published.lines).toHaveLength(3);
    expect(mockEmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(mockEmail.sendEmail.mock.calls[0][0]).toMatchObject({ to: "bids@delta.example", subject: "Invitation to bid: BP-001 Piling subcontract" });
    expect(mockEmail.sendEmail.mock.calls[0][0].body).toMatch(/\/bid\/[A-Za-z0-9_-]{20,}/);
    expect(store.invitations[0].tokenHash).toBe(service.hashToken(tokenFromEmail(0)));
  });

  it("portal: bidders see only their own bid and questions, never the estimate or each other", async () => {
    const { tokenA, tokenB } = await setupOpenPackage();
    await expect(service.portalView("nope-nope-nope-nope-nope")).rejects.toMatchObject({ code: "BID_LINK_INVALID" });
    const viewA = await service.portalView(tokenA);
    expect(viewA.invitation).toMatchObject({ companyName: "Delta Piling", status: "viewed" });
    expect(viewA.package).toMatchObject({ ref: "BP-001", acceptingBids: true, questionsOpen: true });
    expect(viewA.package.lines[0]).toEqual(expect.not.objectContaining({ estimateRate: expect.anything() }));
    expect(viewA.package.lines[0].estimateRate).toBeUndefined();
    expect(JSON.stringify(viewA)).not.toContain("Omega");
    expect(viewA.bid).toBeNull();

    await service.portalAsk(tokenA, { question: "Is dewatering included?" });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "bid.question", recipientRoles: ["pm", "procurement"] }));
    const viewB = await service.portalView(tokenB);
    expect(viewB.package.questions).toEqual([]);
    const pkg = await service.getPackage({ orgId: ORG, projectId: PROJECT, packageId: store.packages[0].id });
    expect(pkg.questions[0]).toMatchObject({ question: "Is dewatering included?", companyName: "Delta Piling", status: "open" });

    // private answer goes to the asker only; shared answers reach everyone anonymously
    mockEmail.sendEmail.mockClear();
    await service.answerQuestion({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, questionId: pkg.questions[0].id, payload: { answer: "Yes, allow for it.", shared: true }, actor });
    expect(mockEmail.sendEmail).toHaveBeenCalledTimes(2);
    const freshB = tokenFromEmail(1);
    const viewB2 = await service.portalView(freshB);
    expect(viewB2.package.questions).toEqual([expect.objectContaining({ question: "Is dewatering included?", answer: "Yes, allow for it.", mine: false, shared: true })]);
    expect(JSON.stringify(viewB2.package.questions)).not.toContain("Delta");
    // the old link was rotated by the email
    await expect(service.portalView(tokenB)).rejects.toMatchObject({ code: "BID_LINK_INVALID" });
  });

  it("portal: pricing, submission rules, withdraw, upload and decline", async () => {
    const { pkg, tokenA, tokenB } = await setupOpenPackage();
    const [line1, line2] = pkg.lines;
    await expect(service.portalSubmitBid(tokenA)).rejects.toMatchObject({ code: "BID_EMPTY" });
    const draft = await service.portalSaveBid(tokenA, { lines: [{ packageLineId: line1.id, rate: "110" }], inclusions: "Mobilisation", validityDays: 60 });
    expect(draft).toMatchObject({ status: "draft", total: 110000, inclusions: "Mobilisation", validityDays: 60 });
    await expect(service.portalSubmitBid(tokenA)).rejects.toMatchObject({ code: "BID_INCOMPLETE", details: { lines: [line2.id] } });
    await service.portalSaveBid(tokenA, { lines: [{ packageLineId: line1.id, rate: 110 }, { packageLineId: line2.id, included: false, note: "By others" }] });
    const submitted = await service.portalSubmitBid(tokenA, { submittedBy: "Dana" });
    expect(submitted).toMatchObject({ status: "submitted", total: 110000, submittedBy: "Dana" });
    expect(store.invitations[0].status).toBe("submitted");
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "bid.submitted", title: "BP-001: bid received from Delta Piling" }));
    await expect(service.portalSaveBid(tokenA, { notes: "changed my mind" })).rejects.toMatchObject({ code: "BID_ALREADY_SUBMITTED" });
    await service.portalWithdrawBid(tokenA);
    expect(store.invitations[0].status).toBe("withdrawn");
    const resaved = await service.portalSaveBid(tokenA, { lines: [{ packageLineId: line1.id, rate: 105 }, { packageLineId: line2.id, rate: 190 }] });
    expect(resaved).toMatchObject({ status: "draft", version: 2, total: 133500 });
    await service.portalSubmitBid(tokenA);

    const uploaded = await service.portalUpload(tokenB, { file: { path: "/tmp/x.pdf", originalname: "priced.pdf", mimetype: "application/pdf", size: 10 } }).catch((error) => error);
    expect(uploaded.code).not.toBe("BID_ALREADY_SUBMITTED");
    const declined = await service.portalDecline(tokenB, { reason: "Too busy" });
    expect(declined).toMatchObject({ status: "declined", declinedReason: "Too busy" });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "bid.declined" }));
  });

  it("levels submitted bids with plugs, exports XLSX, soft-awards and creates the commitment SOV on confirmation", async () => {
    const { pkg, tokenA, tokenB } = await setupOpenPackage();
    const [line1, line2] = pkg.lines;
    await service.portalSaveBid(tokenA, { lines: [{ packageLineId: line1.id, rate: 110 }, { packageLineId: line2.id, rate: 210 }], leadTimeDays: 14 });
    await service.portalSubmitBid(tokenA);
    await service.portalSaveBid(tokenB, { lines: [{ packageLineId: line1.id, rate: 100 }, { packageLineId: line2.id, included: false, note: "Excluded" }], exclusions: "Pile caps" });
    await service.portalSubmitBid(tokenB);

    const level = await service.leveling({ orgId: ORG, projectId: PROJECT, packageId: pkg.id });
    expect(level.estimateTotal).toBe(150000);
    const [first, second] = level.bidders;
    expect(first).toMatchObject({ companyName: "Omega Foundations", total: 100000, normalizedTotal: 131500, pluggedLines: 1, lowLines: 1, rank: 1 });
    expect(second).toMatchObject({ companyName: "Delta Piling", total: 141500, normalizedTotal: 141500, pluggedLines: 0, lowLines: 1, rank: 2 });
    expect(level.cells[first.bidId][line2.id]).toMatchObject({ included: false, plugged: true, normalizedAmount: 31500, amount: null });
    expect(level.lineStats[line1.id]).toMatchObject({ low: 100000, high: 110000, avg: 105000, spread: 10000 });
    const xlsx = await service.levelingXlsx({ orgId: ORG, projectId: PROJECT, packageId: pkg.id });
    expect(xlsx.fileName).toBe("bp-001-leveling.xlsx");
    expect(xlsx.buffer.subarray(0, 2).toString()).toBe("PK");

    const soft = await service.softAward({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, bidId: second.bidId, actor });
    expect(soft).toMatchObject({ status: "closed", softAwardBidId: second.bidId });
    await expect(service.portalSaveBid(tokenA, { notes: "late" })).rejects.toMatchObject({ code: "BID_PACKAGE_NOT_OPEN" });

    mockEmail.sendEmail.mockClear();
    // Delta Piling was invited by email, so the company is created at award and
    // has never been prequalified. That is the last moment before a subcontract
    // exists, so the gate holds it — and names the reason.
    await expect(
      service.confirmAward({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, payload: { retentionRate: 10 }, actor }),
    ).rejects.toMatchObject({ code: "PREQUAL_AWARD_BLOCKED", message: expect.stringContaining("has not been prequalified") });

    const result = await service.confirmAward({
      orgId: ORG,
      projectId: PROJECT,
      packageId: pkg.id,
      payload: { retentionRate: 10, prequalOverrideReason: "Assessment under way; award needed to hold the programme." },
      actor,
    });
    expect(result.package).toMatchObject({ status: "awarded", awardedBidId: second.bidId, awardedCommitmentId: "commit-1" });
    expect(result.commitment).toEqual({ id: "commit-1", ref: "SC-007", status: "draft" });
    expect(mockCommitments.createCommitment).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, projectId: PROJECT, payload: expect.objectContaining({ type: "subcontract", title: "Piling subcontract — Delta Piling", currency: "USD", retentionRate: 10, vendorCompanyId: expect.any(String) }) }));
    const sov = mockCommitments.createCommitment.mock.calls[0][0].payload.lines;
    expect(sov).toEqual([
      expect.objectContaining({ description: "2.1 Bored piles 600mm", unit: "m", qty: 1000, rate: 110, amount: 110000, boqItemId: "boq-1" }),
      expect.objectContaining({ description: "2.2 Pile caps", unit: "m3", qty: 150, rate: 210, amount: 31500, boqItemId: "boq-2" }),
    ]);
    expect(store.companies[0]).toMatchObject({ name: "Delta Piling", isVendor: true, email: "bids@delta.example" });
    expect(store.bids.map((bid) => bid.status).sort()).toEqual(["awarded", "unsuccessful"]);
    expect(mockEmail.sendEmail).toHaveBeenCalledTimes(2);
    expect(mockEmail.sendEmail.mock.calls.map((call) => call[0].subject).sort()).toEqual(["BP-001 Piling subcontract: award decision", "BP-001 Piling subcontract: you have been awarded the work"]);
    await expect(service.confirmAward({ orgId: ORG, projectId: PROJECT, packageId: pkg.id, payload: {}, actor })).rejects.toMatchObject({ code: "BID_PACKAGE_LOCKED" });
  });

  /**
   * A bid line seeded from the BOQ used to carry only `boqItemId`, so the award
   * built a schedule of values with no activity — and certified cost then
   * landed on the ledger attached to nothing, invisible to activity actual cost
   * and to earned value, while reconciliation still read "balanced"
   * (OCTA-BID-CODING-065).
   */
  describe("cost coding inherited from the BOQ", () => {
    const tx = ({ allocations = [], budgetLinks = [] }) => ({
      activityBoqAllocation: { findMany: jest.fn(async () => allocations) },
      budgetLineActivityAllocation: { findMany: jest.fn(async () => budgetLinks) },
    });

    it("takes the activity when the BOQ item is allocated to exactly one", async () => {
      const coding = await service.codingForBoqItems({
        tx: tx({ allocations: [{ boqItemId: "boq-1", activityId: "act-1" }] }),
        projectId: PROJECT,
        boqItemIds: ["boq-1"],
      });
      expect(coding.get("boq-1")).toEqual({ activityId: "act-1", budgetLineId: null, costCodeId: null });
    });

    it("takes the budget line and cost code when one line owns that activity", async () => {
      const coding = await service.codingForBoqItems({
        tx: tx({
          allocations: [{ boqItemId: "boq-1", activityId: "act-1" }],
          budgetLinks: [{ activityId: "act-1", budgetLineId: "bl-1", budgetLine: { id: "bl-1", costCodeId: "cc-1" } }],
        }),
        projectId: PROJECT,
        boqItemIds: ["boq-1"],
      });
      expect(coding.get("boq-1")).toEqual({ activityId: "act-1", budgetLineId: "bl-1", costCodeId: "cc-1" });
    });

    /**
     * The refusal that matters. One schedule-of-values line cannot honestly
     * name one of three activities, and taking the largest share would put real
     * money on the wrong one. Uncoded and visible beats coded and wrong.
     */
    it("leaves a BOQ item split across activities uncoded rather than guessing", async () => {
      const coding = await service.codingForBoqItems({
        tx: tx({
          allocations: [
            { boqItemId: "boq-1", activityId: "act-1" },
            { boqItemId: "boq-1", activityId: "act-2" },
            { boqItemId: "boq-2", activityId: "act-3" },
          ],
        }),
        projectId: PROJECT,
        boqItemIds: ["boq-1", "boq-2"],
      });
      expect(coding.has("boq-1")).toBe(false);
      expect(coding.get("boq-2")).toMatchObject({ activityId: "act-3" });
    });

    it("leaves the budget line alone when the activity sits on more than one", async () => {
      const coding = await service.codingForBoqItems({
        tx: tx({
          allocations: [{ boqItemId: "boq-1", activityId: "act-1" }],
          budgetLinks: [
            { activityId: "act-1", budgetLineId: "bl-1", budgetLine: { id: "bl-1", costCodeId: "cc-1" } },
            { activityId: "act-1", budgetLineId: "bl-2", budgetLine: { id: "bl-2", costCodeId: "cc-2" } },
          ],
        }),
        projectId: PROJECT,
        boqItemIds: ["boq-1"],
      });
      // The activity is unambiguous, so it is taken; the budget line is not.
      expect(coding.get("boq-1")).toEqual({ activityId: "act-1", budgetLineId: null, costCodeId: null });
    });

    it("only counts approved, active allocations", async () => {
      const allocationTx = tx({ allocations: [] });
      await service.codingForBoqItems({ tx: allocationTx, projectId: PROJECT, boqItemIds: ["boq-1"] });
      expect(allocationTx.activityBoqAllocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "approved", isActive: true }),
        }),
      );
    });
  });
});
