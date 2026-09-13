const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, toMoneyNumber } = require("../utils/money");

/**
 * The cost ledger (OCTA-FIN-LEDGER-059).
 *
 * Every actual cost, once, with its origin attached — and the only sanctioned
 * way to move `BudgetLine.actual` or `CostRecord.actual`.
 *
 * Before this, actual cost was incremented at four call sites and could not be
 * reconstructed from anything. That is precisely how subcontractor pay
 * applications and material issues came to be missing from it: nothing
 * recomputed actual from first principles, so nothing noticed an absent
 * contributor.
 *
 * The rules, from docs/finance/OCTAPM_COST_POSTING_MODEL.md:
 *
 *   1. Idempotent — one economic event, one entry, enforced by a unique
 *      `sourceKey`. A retry, a double click, a repeated webhook or two
 *      concurrent approvals produce one posting, not two.
 *   2. Reversible, not deletable — undoing writes a negative entry.
 *   3. Reconcilable — the projections are a cache; the ledger is the truth.
 *   4. Scoped, 5. Decimal, 6. Transactional, 7. Audited.
 *
 * Committed cost is never touched here. Under model decision B the commitment
 * keeps its full executed value and remaining commitment is derived as
 * `committed − certified`.
 */

const SOURCE_TYPES = Object.freeze([
  "direct_cost",
  "timesheet",
  "equipment",
  "sub_pay_app",
  "material_issue",
  "manual",
  // Actual cost that predates the ledger and cannot be reconstructed from any
  // source transaction (OCTA-FIN-MIGRATE-062). Recorded honestly as an opening
  // balance rather than pretended into an invoice that never existed.
  "legacy_opening_balance",
]);

/**
 * Sources that represent something that actually happened on this project.
 * An opening balance is a starting position, not a transaction, so every
 * report that asks "what has this project spent" must be able to tell the two
 * apart.
 */
const TRANSACTIONAL_SOURCES = Object.freeze(
  SOURCE_TYPES.filter((type) => type !== "legacy_opening_balance")
);

const COST_TYPES = Object.freeze([
  "labour",
  "material",
  "equipment",
  "subcontract",
  "indirect",
  "overhead",
  "contingency",
  "other",
]);

/** The cost type each source contributes, unless the caller overrides it. */
const DEFAULT_COST_TYPE = Object.freeze({
  direct_cost: "material",
  timesheet: "labour",
  equipment: "equipment",
  sub_pay_app: "subcontract",
  material_issue: "material",
  manual: "other",
});

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const num = (value) => toMoneyNumber(value, 0);

/**
 * The idempotency key. Built rather than relying on a unique over nullable
 * columns, because Postgres treats NULLs as distinct — three postings with a
 * null `sourceLineId` would all be allowed through such an index.
 */
const sourceKeyFor = ({ sourceType, sourceId, sourceLineId = null, suffix = null }) =>
  [sourceType, sourceId, sourceLineId || "header", suffix].filter(Boolean).join(":");

/**
 * Resolves the budget line a posting belongs to.
 *
 * Named line first — the source knew exactly where it goes. Otherwise the
 * active line for this cost code and cost type, which is how `direct-cost` and
 * `timesheet` have always resolved it.
 */
const resolveBudgetLine = async ({ tx, projectId, budgetLineId, costCodeId, costType }) => {
  if (budgetLineId) {
    const named = await tx.budgetLine.findFirst({
      where: { id: budgetLineId, projectId },
      select: { id: true, costCodeId: true, costType: true },
    });
    if (named) return named;
  }
  if (!costCodeId) return null;
  return tx.budgetLine.findFirst({
    where: { projectId, costCodeId, costType, status: "active" },
    select: { id: true, costCodeId: true, costType: true },
  });
};

/**
 * Applies an entry to the two materialised projections.
 *
 * `actualThroughDate` only ever moves forward: official AC reads the latest
 * actual on or before a cutoff, so a late-keyed posting for an earlier period
 * must not drag the date backwards and hide later cost.
 */
const applyToProjections = async ({ tx, entry }) => {
  const amount = num(entry.amount);
  if (!amount) return;

  if (entry.budgetLineId) {
    await tx.budgetLine.update({
      where: { id: entry.budgetLineId },
      data: { actual: { increment: amount } },
    });
  }

  if (entry.activityId) {
    const record = await tx.costRecord.findFirst({
      where: { projectId: entry.projectId, activityId: entry.activityId },
      select: { id: true, actualThroughDate: true },
    });
    const incurredOn = new Date(entry.incurredOn);
    if (record) {
      // Decided from the row as held for this transaction, not from the read
      // above: two postings reading the same date at once could each
      // "advance" it and the later-committing one drag it back (Phase 21D,
      // CX21-445).
      const [held] = tx.$queryRaw ? await tx.$queryRaw`SELECT "actualThroughDate" FROM "CostRecord" WHERE id = ${record.id} FOR NO KEY UPDATE` : [];
      const current = held ? held.actualThroughDate : record.actualThroughDate;
      const advance = !current || new Date(current) < incurredOn;
      await tx.costRecord.update({
        where: { id: record.id },
        data: {
          actual: { increment: amount },
          ...(advance ? { actualThroughDate: incurredOn } : {}),
        },
      });
    } else {
      await tx.costRecord.create({
        data: {
          projectId: entry.projectId,
          activityId: entry.activityId,
          actual: amount,
          actualThroughDate: incurredOn,
        },
      });
    }
  }
};

/**
 * Posts one cost.
 *
 * Returns `{ entry, posted }`. `posted: false` means an entry for this exact
 * economic event already existed and nothing was written — the caller should
 * treat that as success, because it is: the cost is on the ledger.
 *
 * Runs inside the caller's transaction when one is passed, so the ledger entry
 * and the projection commit together or not at all.
 */
const post = async ({
  tx = prisma,
  orgId,
  projectId,
  sourceType,
  sourceId,
  sourceLineId = null,
  keySuffix = null,
  amount,
  costType = null,
  activityId = null,
  costCodeId = null,
  budgetLineId = null,
  commitmentId = null,
  quantity = null,
  unitCost = null,
  incurredOn,
  postedBy = null,
  note = null,
  batchId = null,
}) => {
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw new HttpError(400, "COST_LEDGER_SOURCE_INVALID", `Unknown cost source "${sourceType}"`);
  }
  // The project must be the organisation's. Every caller scopes its own
  // records; this is the last line, so that no caller can post one tenant's
  // cost onto another's project whatever it was handed (Phase 21D, CX21-420).
  if (tx.project?.findFirst) {
    const owner = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
    if (owner === null) throw new HttpError(403, "COST_LEDGER_PROJECT_FOREIGN", "That project is not this organisation's");
  }
  const value = round2(num(amount));
  if (!value) return { entry: null, posted: false, reason: "zero" };

  const resolvedType = COST_TYPES.includes(costType) ? costType : DEFAULT_COST_TYPE[sourceType];
  const line = await resolveBudgetLine({
    tx,
    projectId,
    budgetLineId,
    costCodeId,
    costType: resolvedType,
  });

  let sourceKey = sourceKeyFor({ sourceType, sourceId, sourceLineId, suffix: keySuffix });

  // The unique index is the real guard — checking first only saves a rollback,
  // and two concurrent approvals both passing the check is exactly the race
  // this table exists to lose safely.
  //
  // A posting that was since REVERSED does not hold its key: the economic
  // event has happened again (a reopened timesheet re-approved, a returned
  // invoice re-approved) and must post again, under its own key, so that the
  // history keeps the first posting, its reversal and the new posting. Before
  // this, re-approval answered "already posted" and the cost stayed reversed
  // (Phase 21D, CX21-006).
  let existing = await tx.costLedgerEntry.findFirst({
    where: { orgId, sourceKey },
    select: { id: true },
  });
  for (let repost = 2; existing; repost += 1) {
    const reversed = await tx.costLedgerEntry.findFirst({
      where: { orgId, reversalOfId: existing.id },
      select: { id: true },
    });
    if (!reversed) return { entry: existing, posted: false, reason: "already_posted" };
    sourceKey = sourceKeyFor({ sourceType, sourceId, sourceLineId, suffix: [keySuffix, `r${repost}`].filter(Boolean).join(":") });
    existing = await tx.costLedgerEntry.findFirst({ where: { orgId, sourceKey }, select: { id: true } });
  }

  let entry;
  try {
    entry = await tx.costLedgerEntry.create({
      data: {
        orgId,
        projectId,
        sourceKey,
        sourceType,
        sourceId,
        sourceLineId,
        activityId,
        costCodeId: line?.costCodeId || costCodeId || null,
        budgetLineId: line?.id || null,
        commitmentId,
        costType: resolvedType,
        amount: value,
        quantity,
        unitCost,
        incurredOn: new Date(incurredOn),
        postedBy,
        note,
        batchId,
      },
    });
  } catch (error) {
    // P2002: another transaction won the race. The cost is posted; that is the
    // outcome we wanted.
    if (error?.code === "P2002") return { entry: null, posted: false, reason: "already_posted" };
    throw error;
  }

  await applyToProjections({ tx, entry });
  return { entry, posted: true };
};

/**
 * Reverses every entry for a source — a voided invoice, a reopened timesheet,
 * a rejected pay application.
 *
 * Writes negative mirrors rather than deleting, so the history of what was
 * posted and then undone survives. Reversals carry their own `sourceKey`, so
 * reversing twice is a no-op for the same reason posting twice is.
 */
const reverse = async ({
  tx = prisma,
  orgId,
  projectId,
  sourceType,
  sourceId,
  postedBy = null,
  note = null,
}) => {
  const entries = await tx.costLedgerEntry.findMany({
    where: { orgId, projectId, sourceType, sourceId, reversalOfId: null },
  });
  if (!entries.length) return { reversed: 0 };

  let reversed = 0;
  for (const original of entries) {
    const already = await tx.costLedgerEntry.findFirst({
      where: { orgId, reversalOfId: original.id },
      select: { id: true },
    });
    if (already) continue;

    const mirror = {
      orgId,
      projectId,
      sourceKey: `reversal:${original.id}`,
      sourceType,
      sourceId,
      sourceLineId: original.sourceLineId,
      activityId: original.activityId,
      costCodeId: original.costCodeId,
      budgetLineId: original.budgetLineId,
      commitmentId: original.commitmentId,
      costType: original.costType,
      amount: round2(-num(original.amount)),
      quantity: original.quantity === null ? null : -original.quantity,
      unitCost: original.unitCost,
      incurredOn: original.incurredOn,
      postedBy,
      reversalOfId: original.id,
      note,
    };
    try {
      const entry = await tx.costLedgerEntry.create({ data: mirror });
      await applyToProjections({ tx, entry });
      reversed += 1;
    } catch (error) {
      if (error?.code !== "P2002") throw error;
    }
  }
  return { reversed };
};

/** What a source has on the ledger, net of reversals. */
const postedTotalFor = async ({ tx = prisma, orgId, projectId, sourceType, sourceId }) => {
  const rows = await tx.costLedgerEntry.findMany({
    where: { orgId, projectId, sourceType, sourceId },
    select: { amount: true },
  });
  return round2(rows.reduce((sum, row) => addMoney(sum, row.amount), 0));
};

/**
 * Certified-to-date against a commitment — the number that turns committed
 * cost into remaining commitment under model decision B.
 */
const certifiedAgainstCommitment = async ({ tx = prisma, projectId, commitmentId }) => {
  const rows = await tx.costLedgerEntry.findMany({
    where: { projectId, commitmentId },
    select: { amount: true },
  });
  return round2(rows.reduce((sum, row) => addMoney(sum, row.amount), 0));
};

module.exports = {
  COST_TYPES,
  DEFAULT_COST_TYPE,
  SOURCE_TYPES,
  TRANSACTIONAL_SOURCES,
  applyToProjections,
  certifiedAgainstCommitment,
  post,
  postedTotalFor,
  resolveBudgetLine,
  reverse,
  sourceKeyFor,
};
