const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, subtractMoney, toMoneyNumber } = require("../utils/money");
const auditService = require("./audit.service");
const costLedger = require("./cost-ledger.service");

/**
 * Bringing actual cost that predates the ledger onto it (OCTA-FIN-MIGRATE-062).
 *
 * `CostRecord.actual` and `BudgetLine.actual` existed long before
 * `CostLedgerEntry`, so a live project can carry millions of actual cost with
 * nothing behind it. Once the ledger is the source of truth that is not a
 * tenable permanent state — but neither of the easy answers is acceptable
 * either. Zeroing the figures destroys real financial history. Letting
 * `recomputeActualCost` "repair" them does the same thing while calling it a
 * fix. And inventing an invoice to explain them is a lie told in a financial
 * record.
 *
 * So the amount that cannot be reconstructed is recorded as exactly what it
 * is: an **opening balance**. It carries its own source type, its own batch,
 * and a stated reason, and every report that asks what a project has spent can
 * tell it apart from money that was actually transacted here.
 *
 * ── Classification ────────────────────────────────────────────────────────
 *
 *   A  reconstructible   the ledger already explains it — nothing to do
 *   B  partial           part is explained; only the remainder opens
 *   C  legacy opening    nothing explains it; it opens in full
 *   D  seed artifact     a demo figure — the seed is fixed instead
 *
 * The migration is idempotent by construction: the source key names the row it
 * opens, not the run that opened it, so a second pass finds the entry already
 * there and writes nothing.
 */

const SOURCE_TYPE = "legacy_opening_balance";
const EPSILON = 0.005;

const num = (value) => toMoneyNumber(value, 0);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * The key that makes concurrent runs safe.
 *
 * Idempotency here comes from **arithmetic, not from the key**: the opening
 * amount is always `stored − everything the ledger already explains`, and a
 * prior opening entry is part of what it explains. So a second run finds
 * nothing unexplained and writes nothing, without needing to remember that it
 * ran.
 *
 * That distinction matters. Keying on the row alone — "has this row ever been
 * opened?" — looks equivalent and is not: if stored actual later grows without
 * a ledger entry behind it, the row is already marked opened and the new
 * unexplained amount becomes invisible, which is exactly the blindness this
 * whole phase exists to remove.
 *
 * The sequence number is only a concurrency guard. Two runs computing the same
 * delta produce the same key, so the unique index lets one through and fails
 * the other rather than opening the balance twice.
 */
const openingKeyFor = ({ target, id, sequence = 0 }) =>
  `${SOURCE_TYPE}:${target}:${id}${sequence ? `:${sequence}` : ""}`;

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, name: true, startDate: true, createdAt: true },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

/**
 * What the ledger already explains, per target row.
 *
 * Opening balances are counted here too — a row that has already been opened
 * is fully explained and must not be opened twice.
 */
const ledgerTotals = async ({ tx = prisma, projectId }) => {
  const entries = await tx.costLedgerEntry.findMany({
    where: { projectId },
    select: { amount: true, budgetLineId: true, activityId: true, sourceType: true, sourceId: true },
  });
  const byBudgetLine = new Map();
  const byActivity = new Map();
  // How many times each row has already been opened — the sequence the next
  // opening would take, used only to keep concurrent runs from both posting.
  const openingCounts = new Map();
  for (const entry of entries) {
    const amount = num(entry.amount);
    if (entry.budgetLineId) byBudgetLine.set(entry.budgetLineId, addMoney(byBudgetLine.get(entry.budgetLineId) || 0, amount));
    if (entry.activityId) byActivity.set(entry.activityId, addMoney(byActivity.get(entry.activityId) || 0, amount));
    if (entry.sourceType === SOURCE_TYPE) {
      openingCounts.set(entry.sourceId, (openingCounts.get(entry.sourceId) || 0) + 1);
    }
  }
  return { byBudgetLine, byActivity, openingCounts };
};

/**
 * What needs opening, and why — without changing anything.
 *
 * Each row is classified rather than lumped together, because "reconstructible"
 * and "nothing explains this" call for different answers and an operator
 * deserves to see which they are looking at.
 */
const analyse = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });
  const { byBudgetLine, byActivity, openingCounts } = await ledgerTotals({ projectId });

  const [budgetLines, costRecords] = await Promise.all([
    prisma.budgetLine.findMany({
      where: { projectId },
      select: { id: true, actual: true, costCodeId: true, costType: true, costCode: { select: { code: true } } },
    }),
    prisma.costRecord.findMany({
      where: { projectId },
      select: {
        id: true,
        activityId: true,
        actual: true,
        actualThroughDate: true,
        activity: { select: { activityCode: true, name: true } },
      },
    }),
  ]);

  /**
   * Only a **shortfall** is an opening balance.
   *
   * If the ledger explains more than the projection holds, that is not
   * history — it is drift, and rewriting it as an opening balance would bury
   * a posting bug under a plausible-looking financial record. Drift is
   * `recomputeActualCost`'s job; this reports it and refuses to touch it.
   */
  const classify = (stored, explained) => {
    if (Math.abs(stored) <= EPSILON && Math.abs(explained) <= EPSILON) return "none";
    const gap = subtractMoney(stored, explained);
    if (Math.abs(gap) <= EPSILON) return "A";
    if (gap < 0) return "drift";
    if (Math.abs(explained) > EPSILON) return "B";
    return "C";
  };

  const rows = [];

  for (const line of budgetLines) {
    const stored = num(line.actual);
    const explained = round2(byBudgetLine.get(line.id) || 0);
    const opening = round2(subtractMoney(stored, explained));
    const classification = classify(stored, explained);
    // "none" has nothing to explain; "A" is fully explained; "drift" belongs to
    // recompute, not to an opening balance.
    if (["none", "A", "drift"].includes(classification) || opening <= EPSILON) continue;
    rows.push({
      target: "budget_line",
      id: line.id,
      label: line.costCode?.code ? `${line.costCode.code} · ${line.costType}` : line.id,
      budgetLineId: line.id,
      costCodeId: line.costCodeId,
      activityId: null,
      stored,
      explained,
      opening,
      classification,
    });
  }

  for (const record of costRecords) {
    const stored = num(record.actual);
    const explained = round2(byActivity.get(record.activityId) || 0);
    const opening = round2(subtractMoney(stored, explained));
    const classification = classify(stored, explained);
    // "none" has nothing to explain; "A" is fully explained; "drift" belongs to
    // recompute, not to an opening balance.
    if (["none", "A", "drift"].includes(classification) || opening <= EPSILON) continue;
    rows.push({
      target: "cost_record",
      id: record.id,
      label: record.activity?.activityCode || record.activity?.name || record.activityId,
      budgetLineId: null,
      costCodeId: null,
      activityId: record.activityId,
      effectiveDate: record.actualThroughDate,
      stored,
      explained,
      opening,
      classification,
    });
  }

  // Every row listed here still has something unexplained — `opening` is what
  // is left after everything the ledger already accounts for, prior opening
  // balances included. A row that has been fully opened has an opening of zero
  // and never reaches this point.
  const pending = rows.map((row) => ({
    ...row,
    sequence: openingCounts.get(row.id) || 0,
    previouslyOpened: openingCounts.get(row.id) || 0,
  }));

  return {
    projectId,
    project: project.name,
    rows: pending,
    pending,
    summary: {
      rowsNeedingOpening: pending.length,
      alreadyOpened: [...openingCounts.values()].reduce((sum, count) => sum + count, 0),
      openingTotal: round2(pending.reduce((sum, row) => addMoney(sum, row.opening), 0)),
      byClassification: pending.reduce((acc, row) => {
        acc[row.classification] = round2(addMoney(acc[row.classification] || 0, row.opening));
        return acc;
      }, {}),
    },
    migrationRequired: pending.length > 0,
  };
};

/**
 * Opens the unexplained balances.
 *
 * One entry per target row, keyed on that row, so running twice writes nothing
 * the second time. Every entry states what it is and why it exists — it does
 * not claim to be an invoice, a pay application or a stock issue, because it
 * was none of those.
 */
const migrate = async ({ orgId, projectId, actor = null, reason = null, dryRun = false }) => {
  const before = await analyse({ orgId, projectId });
  if (dryRun || !before.pending.length) {
    return { ...before, applied: 0, batchId: null, dryRun: Boolean(dryRun) };
  }

  const project = await ensureProject({ orgId, projectId });
  const batchId = `legacy-${projectId.slice(0, 8)}-${Date.now().toString(36)}`;
  const why =
    reason?.trim() ||
    "Actual cost recorded before the cost ledger existed; no source transaction explains it.";
  // The best date available: the figure was true as at the record's own
  // through-date, else the project start, else its creation.
  const fallbackDate = project.startDate || project.createdAt || new Date();

  const applied = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const row of before.pending) {
      const result = await tx.costLedgerEntry.create({
        data: {
          orgId,
          projectId,
          sourceKey: openingKeyFor({ target: row.target, id: row.id, sequence: row.sequence }),
          sourceType: SOURCE_TYPE,
          sourceId: row.id,
          sourceLineId: null,
          batchId,
          activityId: row.activityId,
          costCodeId: row.costCodeId,
          budgetLineId: row.budgetLineId,
          costType: "other",
          amount: row.opening,
          incurredOn: row.effectiveDate || fallbackDate,
          postedBy: actor?.id || null,
          note: `Opening balance · ${row.label} · ${why}`,
        },
      });
      void result;
      count += 1;
    }
    return count;
  });

  await auditService
    .recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COST_RECORD || "cost_record",
      entityId: projectId,
      action: auditService.ACTIONS.CREATED,
      actorId: actor?.id || null,
      reason: why,
      summary: {
        transition: "cost.legacy_opening_balance",
        batchId,
        entries: applied,
        openingTotal: before.summary.openingTotal,
      },
    })
    .catch(() => null);

  const after = await analyse({ orgId, projectId });
  return { ...after, applied, batchId, dryRun: false, reason: why };
};

module.exports = { SOURCE_TYPE, analyse, migrate, openingKeyFor };
