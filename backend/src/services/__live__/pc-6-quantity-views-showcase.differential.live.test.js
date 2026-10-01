/**
 * PC-6 quantity views — a read-only differential against the showcase
 * project (Marina Bay, 4735659e): for every BOQ item and every activity,
 * each figure the new views state equals what the owning service lists —
 * committed quantity against commitment.service listCommitments (the lines
 * of posting-status commitments), certified against the allocation summary's
 * certified basis (certifiedIpcItemWhere) and ipc.service's certificates,
 * paid against those certificates' own payment state, received and issued
 * against inventory.service listTransactions, installed against the
 * seeded entries (none) — and the project's rows are byte-identical before
 * and after: nothing here writes.
 *
 * The showcase carries no IPC line, no payment and no stock movement today
 * (its certified, paid, received and issued figures are the empty case,
 * proven equal to the owners' empty listings) and four SOV lines naming BOQ
 * items on an executed commitment, the substantive comparison. Skipped when
 * the showcase is not on this database.
 *
 *   npm run test:live -- src/services/__live__/pc-6-quantity-views-showcase.differential.live.test.js
 */
const { prisma } = require("../../config/db");
const { liveDescribe } = require("../../__live__/helpers");
const allocationService = require("../activity-boq-allocation.service");
const commitmentService = require("../commitment.service");
const inventoryService = require("../inventory.service");
const ipcService = require("../ipc.service");
const progressService = require("../progress.service");
const quantityViews = require("../quantity-views.service");
const uomService = require("../uom.service");
const { toMoneyNumber } = require("../../utils/money");

const SHOWCASE_PREFIX = "4735659e";
const can = () => true;

// The units the differential compares are the units the view compares: every
// spelling resolved through the organisation's unit list (uom.service, the
// owner of unit spelling), an unrecognised spelling keeping its comparison
// key. "m3", "M3" and "cum" on one item are ONE unit, summed — not a mixed
// set that would expect "not available".
const unitResolver = async (orgId) => {
  const index = await uomService.loadUnitIndex(orgId);
  return (unit) => {
    const text = unit == null ? "" : String(unit).trim();
    if (!text) return null;
    return uomService.normaliseWith(index, text) || uomService.unitKey(text);
  };
};
// The distinct units of rows, each row's own spelling resolved, a row without
// one taking the item's unit (as the view's perUnitFigure does).
const unitsOf = (codeOf, rows, unitOf, itemUnit) => new Set(rows.map((row) => codeOf(unitOf(row)) || itemUnit || null));
const itemUnitOf = (codeOf, item) => item.unitCode || codeOf(item.unit) || null;

let realCore = null;
try {
  // eslint-disable-next-line global-require
  realCore = require("../quantity-progress.service");
} catch (error) {
  if (!(error.code === "MODULE_NOT_FOUND" && /quantity-progress\.service/.test(error.message))) throw error;
}

// Row count and latest write per table the views read: identical before and
// after proves the differential wrote nothing.
const TABLES = [
  ["BoqItem", "updatedAt"],
  ["ActivityBoqAllocation", "updatedAt"],
  ["ActivityProgressMethod", "updatedAt"],
  ["Commitment", "updatedAt"],
  ["CommitmentSovLine", "updatedAt"],
  ["IpcCertificate", "updatedAt"],
  ["IpcItem", "updatedAt"],
  ["IpcPayment", "updatedAt"],
  ["StockTransaction", "createdAt"],
  ["QuantityProgressEntry", "updatedAt"],
];
const snapshot = async (projectId) => {
  const out = {};
  for (const [table, column] of TABLES) {
    const [row] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count, MAX("${column}")::text AS latest FROM "${table}" WHERE "projectId" = $1`, projectId);
    out[table] = { count: row.count, latest: row.latest };
  }
  const [progress] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count, MAX("updatedAt")::text AS latest FROM "ActivityProgress" WHERE "activityId" IN (SELECT "id" FROM "Activity" WHERE "projectId" = $1)`,
    projectId,
  );
  out.ActivityProgress = { count: progress.count, latest: progress.latest };
  return out;
};

liveDescribe("PC-6 quantity views: showcase differential (read-only)", () => {
  let project;
  let before;
  const sum = (rows, pick) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);

  beforeAll(async () => {
    project = await prisma.project.findFirst({ where: { id: { startsWith: SHOWCASE_PREFIX } }, select: { id: true, orgId: true, name: true } });
    if (project) before = await snapshot(project.id);
  });

  afterAll(async () => {
    if (project) {
      const after = await snapshot(project.id);
      expect(after).toEqual(before);
    }
    await prisma.$disconnect();
  });

  it("every BOQ item's figures equal the owners' listings", async () => {
    if (!project) return;
    const items = await prisma.boqItem.findMany({ where: { projectId: project.id }, select: { id: true, code: true, unit: true, unitCode: true }, orderBy: { sortOrder: "asc" } });
    expect(items.length).toBeGreaterThan(0);

    // The owners' listings, once.
    const commitments = await commitmentService.listCommitments({ orgId: project.orgId, projectId: project.id, query: { includeVoid: true } });
    const postingLines = commitments.items.filter((entry) => commitmentService.POSTING_STATUSES.includes(entry.status)).flatMap((entry) => entry.lines.map((line) => ({ ...line, commitmentId: entry.id })));
    const certificates = await ipcService.listIpcCertificates({ orgId: project.orgId, projectId: project.id });
    const certifiedRows = await prisma.ipcItem.findMany({ where: allocationService.certifiedIpcItemWhere(project.id), select: { boqItemId: true, qty: true, ipcCertificateId: true } });
    const stock = (await inventoryService.listTransactions({ orgId: project.orgId, projectId: project.id, limit: 500 })).items;
    const entries = await prisma.quantityProgressEntry.findMany({ where: { projectId: project.id, status: "approved" }, select: { boqItemId: true, quantity: true } });
    const summary = await allocationService.buildAllocationSummary({ projectId: project.id });
    const codeOf = await unitResolver(project.orgId);

    let committedLinesSeen = 0;
    for (const item of items) {
      const view = await quantityViews.getBoqItemQuantities({ orgId: project.orgId, projectId: project.id, itemId: item.id, can, core: realCore || undefined });
      const { figures } = view;
      const itemUnit = itemUnitOf(codeOf, item);

      // committed: the posting-status commitments' lines naming the item, as listCommitments lists them.
      const mine = postingLines.filter((line) => line.boqItemId === item.id);
      committedLinesSeen += mine.length;
      const units = unitsOf(codeOf, mine, (line) => line.unit, itemUnit);
      if (units.size <= 1) {
        expect([item.code, figures.committed.value, figures.committed.label]).toEqual([item.code, sum(mine, (line) => line.qty), "Committed quantity (excludes variations)"]);
        expect(figures.committed.commitments).toBe(new Set(mine.map((line) => line.commitmentId)).size);
        // The one unit the test resolved is the one unit the view states.
        if (mine.length) expect([item.code, figures.committed.unitCode]).toEqual([item.code, [...units][0]]);
      } else {
        expect([item.code, figures.committed.value, figures.committed.notAvailable?.reason]).toEqual([item.code, null, quantityViews.MIXED_UNITS_REASON]);
      }

      // certified: the allocation summary's certified basis — the rows whose currentCert its certifiedValue sums.
      const certifiedMine = certifiedRows.filter((row) => row.boqItemId === item.id);
      expect([item.code, figures.certified.value]).toEqual([item.code, sum(certifiedMine, (row) => row.qty)]);
      const summaryItem = (summary.items || []).find((entry) => entry.boqItemId === item.id);
      if (summaryItem && certifiedMine.length === 0) expect([item.code, summaryItem.certifiedValue]).toEqual([item.code, 0]);

      // paid: each certificate's own payment state (amountPaid ÷ netPayable, capped at 1).
      let paid = 0;
      for (const bucket of figures.paid.certificates) {
        const certificate = certificates.find((row) => row.id === bucket.certificateId);
        const share = certificate ? quantityViews.paidShareOf(certificate) : 0;
        expect([item.code, bucket.certificateId, bucket.paidShare]).toEqual([item.code, bucket.certificateId, Math.round(share * 10000) / 10000]);
        if (certificate) expect([bucket.amountPaid, bucket.netPayable]).toEqual([toMoneyNumber(certificate.amountPaid), toMoneyNumber(certificate.netPayable)]);
        paid += bucket.certifiedQuantity * share;
      }
      expect([item.code, figures.paid.value]).toEqual([item.code, Math.round(paid * 1000) / 1000]);

      // received and issued: the inventory ledger's movements naming the item.
      const movements = stock.filter((row) => row.boqItemId === item.id);
      const receipts = movements.filter((row) => row.type === "receipt");
      const issues = movements.filter((row) => row.type === "issue");
      const returns = movements.filter((row) => row.type === "return");
      if (unitsOf(codeOf, movements, (row) => row.item?.unit, itemUnit).size <= 1) {
        expect([item.code, figures.received.value]).toEqual([item.code, sum(receipts, (row) => Math.abs(row.quantity))]);
        expect([item.code, figures.issued.value, figures.issued.components]).toEqual([
          item.code,
          Math.round((sum(issues, (row) => Math.abs(row.quantity)) - sum(returns, (row) => Math.abs(row.quantity))) * 1000) / 1000,
          { issued: sum(issues, (row) => Math.abs(row.quantity)), returned: sum(returns, (row) => Math.abs(row.quantity)) },
        ]);
      }

      // installed: the approved entries (none on the showcase today) — or "PC-6 core pending".
      const approved = entries.filter((row) => row.boqItemId === item.id);
      if (realCore) expect([item.code, figures.installed.value]).toEqual([item.code, sum(approved, (row) => row.quantity)]);
      else expect([item.code, figures.installed.notAvailable]).toEqual([item.code, { reason: "PC-6 core pending" }]);

      // Five truths, kept apart.
      expect([figures.installed.truth, figures.certified.truth, figures.paid.truth, figures.received.truth, figures.issued.truth, figures.committed.truth]).toEqual([
        "derived", "source", "projection", "derived", "derived", "derived",
      ]);
    }
    // The substantive comparison stood on real rows.
    expect(committedLinesSeen).toBe(postingLines.filter((line) => line.boqItemId).length);
    // eslint-disable-next-line no-console
    console.log(`[pc-6 differential] ${project.name}: ${items.length} items, ${committedLinesSeen} posting SOV lines, ${certifiedRows.length} certified lines, ${certificates.length} certificates, ${stock.length} movements, ${entries.length} approved entries`);
  });

  it("the differential's unit predicate resolves spellings as the view does: aliases of one unit are one unit, not a mixed set", async () => {
    if (!project) return;
    const codeOf = await unitResolver(project.orgId);
    const item = { unitCode: "m3", unit: "m3" };
    const itemUnit = itemUnitOf(codeOf, item);
    // Four spellings of the cubic metre on one item: one unit, the item's — the view sums them; so must the test.
    const aliases = [{ unit: "m3" }, { unit: "M3" }, { unit: "M³" }, { unit: "m 3" }, { unit: null }];
    expect([...unitsOf(codeOf, aliases, (row) => row.unit, itemUnit)]).toEqual(["m3"]);
    // Two units stay two: the mixed case the view reports as not available.
    expect(unitsOf(codeOf, [{ unit: "m3" }, { unit: "KG" }], (row) => row.unit, itemUnit).size).toBe(2);
    // An unrecognised spelling keeps its own key, never passing as the item's unit.
    expect(unitsOf(codeOf, [{ unit: "widgets" }], (row) => row.unit, itemUnit).size).toBe(1);
    expect([...unitsOf(codeOf, [{ unit: "widgets" }], (row) => row.unit, itemUnit)][0]).not.toBe(itemUnit);
  });

  it("every activity's figures equal the owners' listings, and no percent-method activity states an installed quantity", async () => {
    if (!project) return;
    const activities = await prisma.activity.findMany({ where: { projectId: project.id }, select: { id: true, activityCode: true }, orderBy: { sortOrder: "asc" } });
    const commitments = await commitmentService.listCommitments({ orgId: project.orgId, projectId: project.id, query: { includeVoid: true } });
    const postingLines = commitments.items.filter((entry) => commitmentService.POSTING_STATUSES.includes(entry.status)).flatMap((entry) => entry.lines);
    const codeOf = await unitResolver(project.orgId);
    let percentActivities = 0;
    for (const activity of activities) {
      const method = await progressService.getProgressMethod({ orgId: project.orgId, projectId: project.id, activityId: activity.id });
      const view = await quantityViews.getActivityQuantities({ orgId: project.orgId, projectId: project.id, activityId: activity.id, can, core: realCore || undefined });
      const normalised = progressService.normalizeMethod(method?.method || "percent");
      if (normalised !== "quantity") {
        percentActivities += 1;
        expect([activity.activityCode, view.figures.installed.value, view.figures.installed.notAvailable?.reason]).toEqual([activity.activityCode, null, quantityViews.PERCENT_METHOD_REASON]);
        for (const block of view.items) expect([activity.activityCode, block.boqItemId, block.figures.installed.value]).toEqual([activity.activityCode, block.boqItemId, null]);
      }
      const mine = postingLines.filter((line) => line.activityId === activity.id && line.boqItemId);
      for (const block of view.items) {
        const lines = mine.filter((line) => line.boqItemId === block.boqItemId);
        if (unitsOf(codeOf, lines, (line) => line.unit, block.unitCode).size <= 1) expect([activity.activityCode, block.boqItemId, block.figures.committed.value]).toEqual([activity.activityCode, block.boqItemId, lines.reduce((total, line) => total + line.qty, 0)]);
      }
      expect(view.sovLinesWithoutBoqItem).toBe(postingLines.filter((line) => line.activityId === activity.id && !line.boqItemId).length);
    }
    expect(activities.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[pc-6 differential] ${activities.length} activities, ${percentActivities} measured by percent`);
  });
});
