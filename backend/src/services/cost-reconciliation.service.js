const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, subtractMoney, toMoneyNumber } = require("../utils/money");
const auditService = require("./audit.service");

/**
 * Actual-cost reconciliation (OCTA-FIN-LEDGER-059).
 *
 * Answers the question the audit could not: **where did this actual cost number
 * come from?**
 *
 * `BudgetLine.actual` and `CostRecord.actual` are materialised projections of
 * the cost ledger, incremented as postings happen because that is cheap and
 * keeps every existing read fast. Incremental maintenance can drift — a crash
 * between the entry and the projection, a historic row written before the
 * ledger existed, a hand-edited figure. So the projections are never trusted
 * blindly: this service recomputes them from the ledger and reports the
 * difference.
 *
 * The shape — derived vs recorded vs variance, then a sync that writes only the
 * rows that differ — is borrowed from `getCommittedReconciliation` on the
 * parallel `change-sets` branch, rewritten against this schema. See
 * docs/architecture/OCTAPM_PARALLEL_BRANCH_RECONCILIATION.md §5.
 *
 * Committed cost is deliberately *not* reconciled here: it is already a full
 * recalculation in `commitment.recomputeCommitted` and cannot drift.
 */

const EPSILON = 0.005;
const num = (value) => toMoneyNumber(value, 0);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, name: true },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

/** Every ledger entry for the project, grouped the two ways the projections are. */
const derivedTotals = async ({ tx = prisma, projectId }) => {
  const entries = await tx.costLedgerEntry.findMany({
    where: { projectId },
    select: {
      amount: true,
      budgetLineId: true,
      activityId: true,
      sourceType: true,
      costType: true,
      incurredOn: true,
    },
  });

  const byBudgetLine = new Map();
  const byActivity = new Map();
  const bySource = new Map();
  const byCostType = new Map();
  const latestByActivity = new Map();
  let total = 0;

  for (const entry of entries) {
    const amount = num(entry.amount);
    total = addMoney(total, amount);
    if (entry.budgetLineId) {
      byBudgetLine.set(entry.budgetLineId, addMoney(byBudgetLine.get(entry.budgetLineId) || 0, amount));
    }
    if (entry.activityId) {
      byActivity.set(entry.activityId, addMoney(byActivity.get(entry.activityId) || 0, amount));
      const seen = latestByActivity.get(entry.activityId);
      if (!seen || new Date(entry.incurredOn) > seen) {
        latestByActivity.set(entry.activityId, new Date(entry.incurredOn));
      }
    }
    bySource.set(entry.sourceType, addMoney(bySource.get(entry.sourceType) || 0, amount));
    byCostType.set(entry.costType, addMoney(byCostType.get(entry.costType) || 0, amount));
  }

  return { entries: entries.length, total: round2(total), byBudgetLine, byActivity, bySource, byCostType, latestByActivity };
};

/**
 * Compares the ledger against both projections without changing anything.
 *
 * A row appears whenever the two disagree by more than half a cent, in either
 * direction — a projection ahead of the ledger is as much a defect as one
 * behind it.
 */
const reconcile = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });
  const derived = await derivedTotals({ projectId });

  const [budgetLines, costRecords] = await Promise.all([
    prisma.budgetLine.findMany({
      where: { projectId },
      select: { id: true, actual: true, costType: true, costCode: { select: { code: true, name: true } } },
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

  const budgetRows = [];
  const seenLines = new Set();
  for (const line of budgetLines) {
    seenLines.add(line.id);
    const recorded = num(line.actual);
    const derivedAmount = round2(derived.byBudgetLine.get(line.id) || 0);
    const variance = round2(subtractMoney(recorded, derivedAmount));
    if (Math.abs(variance) > EPSILON) {
      budgetRows.push({
        budgetLineId: line.id,
        costCode: line.costCode?.code ?? null,
        costType: line.costType,
        recorded,
        derived: derivedAmount,
        variance,
      });
    }
  }
  // Ledger entries pointing at a budget line the project no longer has.
  for (const [budgetLineId, amount] of derived.byBudgetLine) {
    if (seenLines.has(budgetLineId)) continue;
    budgetRows.push({
      budgetLineId,
      costCode: null,
      costType: null,
      recorded: 0,
      derived: round2(amount),
      variance: round2(-amount),
      note: "ledger entries point at a budget line that no longer exists",
    });
  }

  const activityRows = [];
  const seenActivities = new Set();
  for (const record of costRecords) {
    seenActivities.add(record.activityId);
    const recorded = num(record.actual);
    const derivedAmount = round2(derived.byActivity.get(record.activityId) || 0);
    const variance = round2(subtractMoney(recorded, derivedAmount));
    const expectedThrough = derived.latestByActivity.get(record.activityId) || null;
    // A stale actualThroughDate silently drops cost out of official AC, which
    // reads the latest actual on or before the cutoff — so it is reported even
    // when the amount agrees.
    const dateStale = Boolean(
      expectedThrough && (!record.actualThroughDate || record.actualThroughDate < expectedThrough)
    );
    if (Math.abs(variance) > EPSILON || dateStale) {
      activityRows.push({
        activityId: record.activityId,
        activity: record.activity?.activityCode || record.activity?.name || null,
        recorded,
        derived: derivedAmount,
        variance,
        actualThroughDate: record.actualThroughDate?.toISOString() ?? null,
        expectedThroughDate: expectedThrough?.toISOString() ?? null,
        dateStale,
      });
    }
  }
  for (const [activityId, amount] of derived.byActivity) {
    if (seenActivities.has(activityId)) continue;
    activityRows.push({
      activityId,
      activity: null,
      recorded: 0,
      derived: round2(amount),
      variance: round2(-amount),
      dateStale: false,
      note: "ledger entries with no cost record",
    });
  }

  const recordedBudgetTotal = round2(budgetLines.reduce((sum, line) => addMoney(sum, line.actual), 0));
  const recordedActivityTotal = round2(costRecords.reduce((sum, row) => addMoney(sum, row.actual), 0));

  return {
    projectId,
    ledger: {
      entries: derived.entries,
      total: derived.total,
      bySource: Object.fromEntries([...derived.bySource].map(([k, v]) => [k, round2(v)])),
      byCostType: Object.fromEntries([...derived.byCostType].map(([k, v]) => [k, round2(v)])),
    },
    budget: {
      recordedTotal: recordedBudgetTotal,
      derivedTotal: round2([...derived.byBudgetLine.values()].reduce((s, v) => addMoney(s, v), 0)),
      variances: budgetRows,
    },
    activity: {
      recordedTotal: recordedActivityTotal,
      derivedTotal: round2([...derived.byActivity.values()].reduce((s, v) => addMoney(s, v), 0)),
      variances: activityRows,
    },
    balanced: budgetRows.length === 0 && activityRows.length === 0,
  };
};

/**
 * Rebuilds the projections from the ledger.
 *
 * Writes only the rows that disagree, and only ever sets them to the derived
 * figure — the ledger is the authority. Returns the same report as `reconcile`
 * so the caller can see exactly what moved and why.
 *
 * Not scheduled: this is a deliberate act, because a silent nightly rewrite of
 * financial figures is how a real drift gets hidden instead of investigated.
 */
const recomputeActualCost = async ({ orgId, projectId, actor = null, dryRun = false }) => {
  const before = await reconcile({ orgId, projectId });
  if (dryRun || before.balanced) return { ...before, applied: 0, dryRun };

  const applied = await prisma.$transaction(async (tx) => {
    let count = 0;
    for (const row of before.budget.variances) {
      if (row.note) continue; // orphaned ledger rows have no line to correct
      await tx.budgetLine.update({ where: { id: row.budgetLineId }, data: { actual: row.derived } });
      count += 1;
    }
    for (const row of before.activity.variances) {
      if (row.note) continue;
      await tx.costRecord.updateMany({
        where: { projectId, activityId: row.activityId },
        data: {
          actual: row.derived,
          ...(row.expectedThroughDate ? { actualThroughDate: new Date(row.expectedThroughDate) } : {}),
        },
      });
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
      action: auditService.ACTIONS.UPDATED,
      actorId: actor?.id || null,
      summary: {
        transition: "cost.recompute_actual",
        budgetLinesCorrected: before.budget.variances.filter((r) => !r.note).length,
        activitiesCorrected: before.activity.variances.filter((r) => !r.note).length,
        ledgerTotal: before.ledger.total,
      },
    })
    .catch(() => null);

  const after = await reconcile({ orgId, projectId });
  return { ...after, applied, dryRun: false, correctedFrom: { budget: before.budget.variances, activity: before.activity.variances } };
};

/**
 * Where one actual-cost figure came from — the ledger entries behind a budget
 * line or an activity, newest first.
 */
const explain = async ({ orgId, projectId, budgetLineId = null, activityId = null, limit = 200 }) => {
  await ensureProject({ orgId, projectId });
  if (!budgetLineId && !activityId) {
    throw new HttpError(400, "COST_EXPLAIN_TARGET_REQUIRED", "Name a budget line or an activity");
  }
  const entries = await prisma.costLedgerEntry.findMany({
    where: { projectId, ...(budgetLineId ? { budgetLineId } : {}), ...(activityId ? { activityId } : {}) },
    orderBy: [{ incurredOn: "desc" }, { postedAt: "desc" }],
    take: Math.min(limit, 500),
  });
  return {
    total: round2(entries.reduce((sum, row) => addMoney(sum, row.amount), 0)),
    entries: entries.map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceLineId: row.sourceLineId,
      costType: row.costType,
      amount: num(row.amount),
      quantity: row.quantity,
      unitCost: row.unitCost === null ? null : Number(row.unitCost),
      incurredOn: row.incurredOn.toISOString(),
      postedAt: row.postedAt.toISOString(),
      isReversal: Boolean(row.reversalOfId),
      note: row.note,
    })),
  };
};

module.exports = { derivedTotals, explain, recomputeActualCost, reconcile };
