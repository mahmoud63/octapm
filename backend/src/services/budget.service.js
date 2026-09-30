const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { addMoney, subtractMoney, multiplyMoney, toMoneyNumber } = require("../utils/money");
const auditService = require("./audit.service");
const { getApprovedActivityAllocationTotals } = require("./activity-boq-allocation.service");
// Source / derived / projection labels on each line (labels only).
const { budgetLineTruth } = require("../utils/figure-truth");

/**
 * Budget by cost code (OCTA-FIN-COSTCODE-019).
 *
 * A project budgets against a subset of the organisation's cost codes. Each
 * BudgetLine (cost code × cost type) carries an original budget plus a
 * ledger of changes — approved change orders, revisions and transfers — so
 * `revised = original + Σ changes`. Lines are spread over activities by
 * weight (BudgetLineActivityAllocation), which is what lets the cost-code
 * view and the activity view be reconciled: Σ activity budgets must equal
 * Σ budget lines. Snapshots freeze the whole picture, one per locked
 * reporting period.
 */

const COST_TYPES = Object.freeze(["labour", "material", "equipment", "subcontract", "indirect", "overhead", "contingency", "other"]);
const CHANGE_KINDS = Object.freeze(["change_order", "revision", "transfer_in", "transfer_out"]);
const STATUSES = Object.freeze(["active", "archived"]);
const CHANGE_ORDER_COST_CODE = Object.freeze({ code: "CO", name: "Change orders", category: "other" });
const TOLERANCE = 0.01;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const roundWeight = (value) => Math.round((Number(value) || 0) * 10000) / 10000;

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true, contractValue: true, currency: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const money = (payload, key, fallback = 0) => {
  if (payload[key] === undefined) return undefined;
  if (payload[key] === null || payload[key] === "") return fallback;
  const value = Number(payload[key]);
  if (!Number.isFinite(value)) throw new HttpError(400, "BUDGET_AMOUNT_INVALID", `${key} must be a number`);
  return round2(value);
};

// ─── Project cost codes ────────────────────────────────────────────────────

const serializeProjectCostCode = (row) => ({
  id: row.id,
  costCodeId: row.costCodeId,
  code: row.costCode?.code ?? null,
  name: row.costCode?.name ?? null,
  category: row.costCode?.category ?? null,
  parentId: row.costCode?.parentId ?? null,
  status: row.status,
  sortOrder: row.sortOrder,
});

const listProjectCostCodes = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });
  const [selected, all] = await Promise.all([
    prisma.projectCostCode.findMany({
      where: { projectId, ...(query.includeArchived ? {} : { status: "active" }) },
      include: { costCode: { select: { id: true, code: true, name: true, category: true, parentId: true, status: true } } },
      orderBy: [{ sortOrder: "asc" }, { costCode: { code: "asc" } }],
    }),
    prisma.costCode.findMany({
      where: { orgId, status: "active" },
      select: { id: true, code: true, name: true, category: true, parentId: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      take: 2000,
    }),
  ]);
  const selectedIds = new Set(selected.map((row) => row.costCodeId));
  return {
    items: selected.map(serializeProjectCostCode),
    available: all.map((row) => ({ ...row, selected: selectedIds.has(row.id) })),
  };
};

const ensureProjectCostCodes = async ({ tx, orgId, projectId, costCodeIds, actorId = null }) => {
  const ids = [...new Set((costCodeIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const codes = await tx.costCode.findMany({ where: { id: { in: ids }, orgId }, select: { id: true } });
  if (codes.length !== ids.length) throw new HttpError(404, "COST_CODE_NOT_FOUND", "One or more cost codes were not found in this organisation");
  const existing = await tx.projectCostCode.findMany({ where: { projectId, costCodeId: { in: ids } }, select: { id: true, costCodeId: true, status: true } });
  const byCode = new Map(existing.map((row) => [row.costCodeId, row]));
  const rows = [];
  for (const id of ids) {
    const current = byCode.get(id);
    if (current) {
      rows.push(current.status === "active" ? current : await tx.projectCostCode.update({ where: { id: current.id }, data: { status: "active" } }));
    } else {
      rows.push(await tx.projectCostCode.create({ data: { orgId, projectId, costCodeId: id, createdBy: actorId } }));
    }
  }
  return rows;
};

/** Selects the org codes a project budgets against (`importAll` copies the whole library). */
const selectProjectCostCodes = async ({ orgId, projectId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  await prisma.$transaction(async (tx) => {
    let ids = Array.isArray(payload.costCodeIds) ? payload.costCodeIds : [];
    if (payload.importAll) {
      const all = await tx.costCode.findMany({ where: { orgId, status: "active" }, select: { id: true } });
      ids = all.map((row) => row.id);
    }
    await ensureProjectCostCodes({ tx, orgId, projectId, costCodeIds: ids, actorId: actor?.id || null });
    if (Array.isArray(payload.removeCostCodeIds) && payload.removeCostCodeIds.length) {
      const used = await tx.budgetLine.findMany({ where: { projectId, costCodeId: { in: payload.removeCostCodeIds }, status: "active" }, select: { costCodeId: true } });
      const blocked = new Set(used.map((row) => row.costCodeId));
      const removable = payload.removeCostCodeIds.filter((id) => !blocked.has(id));
      if (removable.length) await tx.projectCostCode.updateMany({ where: { projectId, costCodeId: { in: removable } }, data: { status: "archived" } });
      if (blocked.size) throw new HttpError(409, "COST_CODE_IN_USE", "Cost codes with active budget lines cannot be removed from the project");
    }
  });
  return listProjectCostCodes({ orgId, projectId });
};

// ─── Budget lines ──────────────────────────────────────────────────────────

const lineInclude = {
  costCode: { select: { id: true, code: true, name: true, category: true, parentId: true } },
  changes: { orderBy: { createdAt: "asc" } },
  allocations: { include: { activity: { select: { id: true, name: true, activityCode: true, wbsCode: true, isActive: true } } } },
};

const deriveLine = (line) => {
  const changes = line.changes || [];
  const sum = (kinds) => changes.filter((row) => kinds.includes(row.kind)).reduce((acc, row) => addMoney(acc, row.amount), 0);
  const approvedChanges = sum(["change_order"]);
  const revisions = sum(["revision", "transfer_in", "transfer_out"]);
  const original = toMoneyNumber(line.originalBudget);
  const revised = addMoney(original, addMoney(approvedChanges, revisions));
  const actual = toMoneyNumber(line.actual);
  // Executed commitments post committed cost (OCTA-FIN-COMMIT-020); the manual
  // figure only stands while nothing has been committed against the line.
  const committedFromCommitments = toMoneyNumber(line.committedFromCommitments);
  const committed = committedFromCommitments > 0 ? committedFromCommitments : toMoneyNumber(line.committed);
  const forecast = line.forecast === null || line.forecast === undefined ? Math.max(revised, actual, committed) : toMoneyNumber(line.forecast);
  const allocations = (line.allocations || []).filter((row) => row.activity?.isActive !== false);
  const allocatedWeight = roundWeight(allocations.reduce((acc, row) => acc + (Number(row.weight) || 0), 0));
  const allocatedAmount = allocations.reduce((acc, row) => addMoney(acc, row.amount), 0);
  return { original, approvedChanges, revisions, revised, committed, actual, forecast, variance: subtractMoney(revised, forecast), allocatedWeight, allocatedAmount, unallocatedAmount: subtractMoney(revised, allocatedAmount) };
};

// A stored budget snapshot keeps the figures only: the three-truths labels
// describe the live register and are not part of what a period froze.
const withoutTruth = (line) => {
  if (!line || typeof line !== "object" || !Object.prototype.hasOwnProperty.call(line, "truth")) return line;
  const rest = { ...line };
  delete rest.truth;
  return rest;
};

const serializeLine = (line) => {
  const derived = deriveLine(line);
  const forecastIsManual = line.forecast !== null && line.forecast !== undefined;
  return {
    id: line.id,
    projectId: line.projectId,
    costCodeId: line.costCodeId,
    costCode: line.costCode ? { id: line.costCode.id, code: line.costCode.code, name: line.costCode.name, category: line.costCode.category, parentId: line.costCode.parentId } : null,
    costType: line.costType,
    description: line.description || null,
    status: line.status,
    sortOrder: line.sortOrder,
    originalBudget: derived.original,
    approvedChanges: derived.approvedChanges,
    revisions: derived.revisions,
    revisedBudget: derived.revised,
    committed: derived.committed,
    committedManual: toMoneyNumber(line.committed),
    committedFromCommitments: toMoneyNumber(line.committedFromCommitments),
    actual: derived.actual,
    forecast: derived.forecast,
    forecastIsManual,
    // Which figure is a source fact, which is derived and which is a
    // projection, and from what (control model §3). The same words on every
    // line; only the forecast's typed/default split varies.
    truth: budgetLineTruth(forecastIsManual),
    variance: derived.variance,
    allocatedWeight: derived.allocatedWeight,
    allocatedAmount: derived.allocatedAmount,
    unallocatedAmount: derived.unallocatedAmount,
    allocations: (line.allocations || []).map((row) => ({
      id: row.id,
      activityId: row.activityId,
      activity: row.activity ? { id: row.activity.id, name: row.activity.name, code: row.activity.activityCode || row.activity.wbsCode || null } : null,
      weight: Number(row.weight) || 0,
      amount: toMoneyNumber(row.amount),
      source: row.source,
    })),
    changes: (line.changes || []).map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: toMoneyNumber(row.amount),
      changeOrderId: row.changeOrderId || null,
      counterpartLineId: row.counterpartLineId || null,
      note: row.note || null,
      createdAt: toIso(row.createdAt),
    })),
    createdAt: toIso(line.createdAt),
    updatedAt: toIso(line.updatedAt),
  };
};

const summarize = (lines) => {
  const totals = { originalBudget: 0, approvedChanges: 0, revisions: 0, revisedBudget: 0, committed: 0, actual: 0, forecast: 0, variance: 0, allocatedAmount: 0, unallocatedAmount: 0 };
  const byType = new Map();
  for (const line of lines) {
    for (const key of Object.keys(totals)) totals[key] = addMoney(totals[key], line[key]);
    const bucket = byType.get(line.costType) || { costType: line.costType, originalBudget: 0, revisedBudget: 0, committed: 0, actual: 0, forecast: 0, variance: 0 };
    for (const key of ["originalBudget", "revisedBudget", "committed", "actual", "forecast", "variance"]) bucket[key] = addMoney(bucket[key], line[key]);
    byType.set(line.costType, bucket);
  }
  return { totals, byType: [...byType.values()], lines: lines.length, underAllocated: lines.filter((line) => line.status === "active" && line.allocatedWeight < 99.99 && line.revisedBudget !== 0).length };
};

const loadLines = async ({ projectId, includeArchived = false }, tx = prisma) =>
  tx.budgetLine.findMany({
    where: { projectId, ...(includeArchived ? {} : { status: "active" }) },
    include: lineInclude,
    orderBy: [{ costCode: { code: "asc" } }, { sortOrder: "asc" }, { costType: "asc" }],
  });

const listBudgetLines = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });
  const rows = await loadLines({ projectId, includeArchived: Boolean(query.includeArchived) });
  let items = rows.map(serializeLine);
  if (query.costType && COST_TYPES.includes(query.costType)) items = items.filter((line) => line.costType === query.costType);
  if (query.costCodeId) items = items.filter((line) => line.costCodeId === query.costCodeId);
  if (query.search) {
    const needle = String(query.search).toLowerCase();
    items = items.filter((line) => [line.costCode?.code, line.costCode?.name, line.description].some((text) => text && String(text).toLowerCase().includes(needle)));
  }
  return { items, summary: summarize(items) };
};

const loadLine = async ({ projectId, lineId }, tx = prisma) => {
  const line = await tx.budgetLine.findFirst({ where: { id: lineId, projectId }, include: lineInclude });
  if (!line) throw new HttpError(404, "BUDGET_LINE_NOT_FOUND", "Budget line not found");
  return line;
};

const getBudgetLine = async ({ orgId, projectId, lineId }) => {
  await ensureProject({ orgId, projectId });
  return serializeLine(await loadLine({ projectId, lineId }));
};

/** Allocation amounts follow the revised budget; call after anything that changes it. */
const recomputeAllocations = async (tx, lineId) => {
  const line = await tx.budgetLine.findFirst({ where: { id: lineId }, include: { changes: true, allocations: true } });
  if (!line) return;
  const { revised } = deriveLine({ ...line, allocations: [] });
  for (const allocation of line.allocations) {
    const amount = round2(multiplyMoney(revised, (Number(allocation.weight) || 0) / 100));
    if (amount !== toMoneyNumber(allocation.amount)) await tx.budgetLineActivityAllocation.update({ where: { id: allocation.id }, data: { amount } });
  }
};

const audit = ({ tx, orgId, projectId, entityId, action, actor, summary, reason = null }) =>
  auditService.recordEvent({ tx, orgId, projectId, entityType: auditService.ENTITY_TYPES.BUDGET_LINE, entityId, action, actorId: actor?.id || null, actorRole: actor?.role || null, reason, summary, metadata: { source: "cost_control.budget" } });

// ─── The Original Budget boundary (PC-7a, owner decision 2026-09-29) ──────────
//
// Original Budget is a source figure (certified rule §121): once something
// stands on a line's original amount, a new required amount is a budget
// revision that flows into Revised Budget — original 100,000 + an approved
// revision of +50,000 reads revised 150,000 with the original still 100,000,
// never original 150,000. The lock is per line and starts at the FIRST of:
//   1. the line is in an approved financial/budget baseline — no such record
//      exists in this codebase (BudgetRevision is a project-level ledger with
//      no budget-line link, and a schedule baseline is a separate control that
//      never locks the budget), so this condition is inert until one exists;
//   2. an approved change stands on it — any BudgetLineChange row (an approved
//      change order posted at approval, a revision or a transfer, both of which
//      need cost.approve and take effect when written);
//   3. an executed commitment references it — the certified definition in
//      commitment.service recomputeCommitted: a commitment in a posting status
//      (executed, closed) whose SOV lines or approved CCO lines name the line
//      (by id, or by cost code for an active line of the commitment's cost
//      type), or committedFromCommitments ≠ 0;
//   4. the cost ledger posts to it — any CostLedgerEntry on the line (openings
//      and reversals included), or a non-zero actual projection;
//   5. the line is in the budget snapshot of a LOCKED reporting period. An
//      ad-hoc snapshot (no period) or an open period's snapshot never locks.
const ORIGINAL_LOCK = Object.freeze({
  BUDGET_BASELINE: Object.freeze({ condition: "approved_budget_baseline", number: 1 }),
  APPROVED_CHANGE: Object.freeze({ condition: "approved_change", number: 2 }),
  EXECUTED_COMMITMENT: Object.freeze({ condition: "executed_commitment", number: 3 }),
  LEDGER_POSTING: Object.freeze({ condition: "ledger_posting", number: 4 }),
  LOCKED_PERIOD_SNAPSHOT: Object.freeze({ condition: "locked_period_snapshot", number: 5 }),
});
// A PATCH that sends the stored figure back is an echo, not an edit.
const ORIGINAL_ECHO_TOLERANCE = 0.005;
const CHANGE_KIND_WORDS = Object.freeze({ change_order: "an approved change order", revision: "a budget revision", transfer_in: "a budget transfer into it", transfer_out: "a budget transfer out of it" });

const formatAmount = (value) => toMoneyNumber(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Which lock conditions stand on each line, read inside the caller's
 * transaction: Map<lineId, [{ condition, number, reason }]> (an empty list =
 * the original is still writable). A line of another project answers as none.
 */
const originalBudgetLocks = async ({ tx = prisma, projectId, lineIds }) => {
  const ids = [...new Set((lineIds || []).filter(Boolean))];
  const locks = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return locks;
  const add = (lineId, kind, reason) => {
    const list = locks.get(lineId);
    if (list && !list.some((row) => row.condition === kind.condition)) list.push({ ...kind, reason });
  };
  const lines = await tx.budgetLine.findMany({ where: { projectId, id: { in: ids } }, select: { id: true, costCodeId: true, costType: true, status: true, actual: true, committedFromCommitments: true } });
  // Condition 1 is inert: there is no approved financial/budget baseline record to consult (see above).

  // Condition 2.
  const changes = await tx.budgetLineChange.findMany({ where: { projectId, budgetLineId: { in: ids } }, select: { budgetLineId: true, kind: true }, orderBy: { createdAt: "asc" } });
  for (const row of changes) add(row.budgetLineId, ORIGINAL_LOCK.APPROVED_CHANGE, `${CHANGE_KIND_WORDS[row.kind] || "an approved budget change"} stands on it`);

  // Condition 3, read exactly as recomputeCommitted posts committed cost.
  const { POSTING_STATUSES, CO_STATUS, costTypeForCommitment } = require("./commitment.service");
  const lineIdSet = new Set(lines.map((line) => line.id));
  const activeByKey = new Map(lines.filter((line) => line.status === "active").map((line) => [`${line.costCodeId}:${line.costType}`, line.id]));
  const commitments = await tx.commitment.findMany({
    where: { projectId, status: { in: POSTING_STATUSES } },
    select: { ref: true, type: true, lines: { select: { budgetLineId: true, costCodeId: true } }, changeOrders: { where: { status: CO_STATUS.APPROVED }, select: { linesJson: true } } },
  });
  for (const commitment of commitments) {
    const costType = costTypeForCommitment(commitment.type);
    const entries = [...commitment.lines, ...commitment.changeOrders.flatMap((co) => (Array.isArray(co.linesJson) ? co.linesJson.filter(Boolean) : []))];
    for (const entry of entries) {
      const lineId = entry.budgetLineId ? (lineIdSet.has(entry.budgetLineId) ? entry.budgetLineId : null) : entry.costCodeId ? activeByKey.get(`${entry.costCodeId}:${costType}`) : null;
      if (lineId) add(lineId, ORIGINAL_LOCK.EXECUTED_COMMITMENT, `executed commitment ${commitment.ref || commitment.type} is committed against it`);
    }
  }
  for (const line of lines) {
    if (toMoneyNumber(line.committedFromCommitments) !== 0) add(line.id, ORIGINAL_LOCK.EXECUTED_COMMITMENT, "executed commitments are committed against it");
  }

  // Condition 4.
  const ledger = await tx.costLedgerEntry.findMany({ where: { projectId, budgetLineId: { in: ids } }, select: { budgetLineId: true, sourceType: true }, distinct: ["budgetLineId"] });
  for (const row of ledger) add(row.budgetLineId, ORIGINAL_LOCK.LEDGER_POSTING, `the cost ledger has posted to it (${row.sourceType})`);
  for (const line of lines) {
    if (toMoneyNumber(line.actual) !== 0) add(line.id, ORIGINAL_LOCK.LEDGER_POSTING, "the cost ledger has posted actual cost to it");
  }

  // Condition 5: only a LOCKED period's snapshot; an ad-hoc or open-period one never locks.
  const snapshots = await tx.budgetSnapshot.findMany({ where: { projectId, reportingPeriod: { is: { status: "locked" } } }, select: { linesJson: true, reportingPeriod: { select: { code: true } } } });
  for (const snapshot of snapshots) {
    for (const row of Array.isArray(snapshot.linesJson) ? snapshot.linesJson : []) {
      if (row && locks.has(row.id)) add(row.id, ORIGINAL_LOCK.LOCKED_PERIOD_SNAPSHOT, `it is in the budget snapshot of locked reporting period ${snapshot.reportingPeriod?.code || ""}`.trim());
    }
  }
  for (const list of locks.values()) list.sort((a, b) => a.number - b.number);
  return locks;
};

const originalBudgetLockedError = ({ line, proposed, reasons }) => {
  const label = [line.costCode?.code, line.costType].filter(Boolean).join(" / ") || "this line";
  const original = formatAmount(line.originalBudget);
  const because = reasons.map((row) => `condition ${row.number}: ${row.reason}`).join("; ");
  return new HttpError(
    409,
    "BUDGET_ORIGINAL_LOCKED",
    `The original budget of ${label} is locked at ${original} (${because}). A changed amount is a budget revision: add it on the line's revisions (POST /budget/lines/${line.id}/revisions). It flows into the Revised Budget and the Original Budget stays ${original} — for example, original 100,000 + an approved revision of +50,000 reads revised 150,000 with the original still 100,000.`,
    { lineId: line.id, code: line.costCode?.code || null, costType: line.costType, originalBudget: toMoneyNumber(line.originalBudget), proposed, conditions: reasons, revisionPath: `/budget/lines/${line.id}/revisions` },
  );
};

const isOriginalEcho = (stored, proposed) => Math.abs(subtractMoney(proposed, stored)) <= ORIGINAL_ECHO_TOLERANCE;

/**
 * The one Original Budget guard. Every write path that could move
 * originalBudget asks it first, inside its transaction, with the line held.
 * Returns the lock reasons (empty = writable); with `refuse` (the default) it
 * throws 409 BUDGET_ORIGINAL_LOCKED instead when the amount would move.
 */
const assertOriginalBudgetWritable = async ({ tx, projectId, line, proposed, refuse = true }) => {
  if (proposed === undefined || proposed === null || isOriginalEcho(line.originalBudget, proposed)) return [];
  const reasons = (await originalBudgetLocks({ tx, projectId, lineIds: [line.id] })).get(line.id) || [];
  if (reasons.length && refuse) throw originalBudgetLockedError({ line, proposed, reasons });
  return reasons;
};

// Held for the transaction (FOR UPDATE also blocks a new child row naming the
// line), so a ledger posting, change or commitment recompute on the line waits
// for this write, or this write reads it once it has landed.
const holdLine = async (tx, lineId) => {
  if (tx.$queryRaw) await tx.$queryRaw`SELECT id FROM "BudgetLine" WHERE id = ${lineId} FOR UPDATE`;
};

const normalizeCostType = (value) => {
  const costType = String(value || "other").toLowerCase();
  if (!COST_TYPES.includes(costType)) throw new HttpError(400, "BUDGET_COST_TYPE_INVALID", `costType must be one of ${COST_TYPES.join(", ")}`);
  return costType;
};

const createBudgetLine = async ({ orgId, projectId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const costType = normalizeCostType(payload.costType);
  const costCodeId = trimOrNull(payload.costCodeId);
  if (!costCodeId) throw new HttpError(400, "BUDGET_COST_CODE_REQUIRED", "Pick a cost code");
  const originalBudget = money(payload, "originalBudget") ?? 0;
  // Actual cost is a projection of the cost ledger (OCTA-FIN-LEDGER-059). A
  // figure typed onto a line would be one the ledger never posted, and the
  // reconciliation would then be arguing with an invention (Phase 21D, CX21-007).
  if (round2(money(payload, "actual") ?? 0) !== 0) {
    throw new HttpError(400, "BUDGET_ACTUAL_IS_DERIVED", "Actual cost is posted through the cost ledger; it cannot be typed onto a budget line");
  }
  let originalBudgetKept = null;
  const created = await prisma.$transaction(async (tx) => {
    await ensureProjectCostCodes({ tx, orgId, projectId, costCodeIds: [costCodeId], actorId: actor?.id || null });
    const clash = await tx.budgetLine.findFirst({ where: { projectId, costCodeId, costType }, select: { id: true, status: true } });
    if (clash && clash.status === "active") throw new HttpError(409, "BUDGET_LINE_DUPLICATE", "A line for this cost code and cost type already exists");
    if (clash) {
      // Re-activating an archived line is never a hidden Original Budget edit
      // (PC-7a): the line keeps the original it has, whatever the payload
      // says, and the answer says so when the two differ — with the lock
      // conditions, if any, that would refuse a PATCH of it too.
      await holdLine(tx, clash.id);
      const archived = await loadLine({ projectId, lineId: clash.id }, tx);
      if (!isOriginalEcho(archived.originalBudget, originalBudget)) {
        const conditions = await assertOriginalBudgetWritable({ tx, projectId, line: archived, proposed: originalBudget, refuse: false });
        originalBudgetKept = { existing: toMoneyNumber(archived.originalBudget), proposed: originalBudget, locked: conditions.length > 0, conditions };
      }
    }
    const data = {
      ...(clash ? {} : { originalBudget }),
      description: trimOrNull(payload.description)?.slice(0, 500) || null,
      committed: money(payload, "committed") ?? 0,
      forecast: payload.forecast === undefined || payload.forecast === null || payload.forecast === "" ? null : money(payload, "forecast"),
      sortOrder: Number.isInteger(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0,
      status: "active",
      updatedBy: actor?.id || null,
    };
    // An archived line that comes back keeps the actual the ledger posted on
    // it — the entries are still there, and a projection reset to zero would
    // make the reconciliation lie (Phase 21D, CX21-102). A new line starts at 0.
    const row = clash
      ? await tx.budgetLine.update({ where: { id: clash.id }, data, include: lineInclude })
      : await tx.budgetLine.create({ data: { orgId, projectId, costCodeId, costType, createdBy: actor?.id || null, actual: 0, ...data }, include: lineInclude });
    await audit({ tx, orgId, projectId, entityId: row.id, action: auditService.ACTIONS.CREATED, actor, summary: { code: row.costCode?.code, costType, originalBudget: toMoneyNumber(row.originalBudget), ...(clash ? { reactivated: true } : {}), ...(originalBudgetKept ? { originalBudgetKept } : {}) } });
    return row;
  });
  return originalBudgetKept ? { ...serializeLine(created), originalBudgetKept } : serializeLine(created);
};

const updateBudgetLine = async ({ orgId, projectId, lineId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadLine({ projectId, lineId });
  const data = { updatedBy: actor?.id || null };
  if (payload.description !== undefined) data.description = trimOrNull(payload.description)?.slice(0, 500) || null;
  if (payload.originalBudget !== undefined) data.originalBudget = money(payload, "originalBudget");
  if (payload.committed !== undefined) data.committed = money(payload, "committed");
  if (payload.actual !== undefined && round2(money(payload, "actual") ?? 0) !== round2(Number(existing.actual ?? 0))) {
    throw new HttpError(400, "BUDGET_ACTUAL_IS_DERIVED", "Actual cost is posted through the cost ledger; it cannot be typed onto a budget line");
  }
  if (payload.forecast !== undefined) data.forecast = payload.forecast === null || payload.forecast === "" ? null : money(payload, "forecast");
  if (payload.costType !== undefined) data.costType = normalizeCostType(payload.costType);
  if (payload.sortOrder !== undefined) data.sortOrder = Number.isInteger(Number(payload.sortOrder)) ? Number(payload.sortOrder) : existing.sortOrder;
  if (payload.status !== undefined) {
    if (!STATUSES.includes(payload.status)) throw new HttpError(400, "BUDGET_LINE_STATUS_INVALID", "status must be active or archived");
    data.status = payload.status;
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (data.originalBudget !== undefined) {
      await holdLine(tx, lineId);
      const held = await loadLine({ projectId, lineId }, tx);
      await assertOriginalBudgetWritable({ tx, projectId, line: held, proposed: data.originalBudget });
      // An echo writes nothing new: the stored figure stays exactly as it is.
      if (isOriginalEcho(held.originalBudget, data.originalBudget)) delete data.originalBudget;
    }
    if (data.costType && data.costType !== existing.costType) {
      const clash = await tx.budgetLine.findFirst({ where: { projectId, costCodeId: existing.costCodeId, costType: data.costType, id: { not: lineId } }, select: { id: true } });
      if (clash) throw new HttpError(409, "BUDGET_LINE_DUPLICATE", "A line for this cost code and cost type already exists");
    }
    const row = await tx.budgetLine.update({ where: { id: lineId }, data, include: lineInclude });
    if (data.originalBudget !== undefined) await recomputeAllocations(tx, lineId);
    await audit({ tx, orgId, projectId, entityId: lineId, action: data.status === "archived" ? auditService.ACTIONS.ARCHIVED : auditService.ACTIONS.UPDATED, actor, summary: { code: row.costCode?.code, changed: Object.keys(data).filter((key) => key !== "updatedBy") } });
    return row;
  });
  return serializeLine(await loadLine({ projectId, lineId }) || updated);
};

const archiveBudgetLine = ({ orgId, projectId, lineId, actor }) => updateBudgetLine({ orgId, projectId, lineId, payload: { status: "archived" }, actor });

/** CSV-style import: rows of { code, costType, originalBudget, description }. Existing lines are updated, except a locked original (see lockedLines). */
const importBudgetLines = async ({ orgId, projectId, rows = [], actor = null }) => {
  await ensureProject({ orgId, projectId });
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, "BUDGET_ROWS_REQUIRED", "Provide at least one row");
  if (rows.length > 2000) throw new HttpError(400, "BUDGET_ROWS_TOO_MANY", "Import at most 2000 rows at a time");
  const result = await prisma.$transaction(async (tx) => {
    const codes = await tx.costCode.findMany({ where: { orgId }, select: { id: true, code: true } });
    const idByCode = new Map(codes.map((row) => [row.code.toUpperCase(), row.id]));
    let created = 0;
    let updated = 0;
    const missing = [];
    // An existing line whose original is locked is never overwritten (PC-7a):
    // its description and status are written, its original stays, and the
    // answer lists it so the importer can raise a budget revision instead.
    const lockedLines = [];
    for (const [index, row] of rows.entries()) {
      const code = trimOrNull(row.code)?.toUpperCase();
      if (!code) throw new HttpError(400, "BUDGET_ROW_CODE_REQUIRED", `Row ${index + 1} needs a cost code`);
      let costCodeId = idByCode.get(code);
      if (!costCodeId) {
        if (!row.name) {
          missing.push(code);
          continue;
        }
        const createdCode = await tx.costCode.create({ data: { orgId, code, name: String(row.name).trim(), category: COST_TYPES.includes(String(row.costType || "").toLowerCase()) ? String(row.costType).toLowerCase() : "other", createdBy: actor?.id || null, updatedBy: actor?.id || null } });
        costCodeId = createdCode.id;
        idByCode.set(code, costCodeId);
      }
      const costType = normalizeCostType(row.costType);
      await ensureProjectCostCodes({ tx, orgId, projectId, costCodeIds: [costCodeId], actorId: actor?.id || null });
      const originalBudget = money(row, "originalBudget") ?? 0;
      const existing = await tx.budgetLine.findFirst({ where: { projectId, costCodeId, costType }, select: { id: true } });
      if (existing) {
        await holdLine(tx, existing.id);
        const line = await loadLine({ projectId, lineId: existing.id }, tx);
        const conditions = await assertOriginalBudgetWritable({ tx, projectId, line, proposed: originalBudget, refuse: false });
        const description = trimOrNull(row.description)?.slice(0, 500) || null;
        if (conditions.length) {
          await tx.budgetLine.update({ where: { id: existing.id }, data: { description, status: "active", updatedBy: actor?.id || null } });
          lockedLines.push({ code, costType, existing: toMoneyNumber(line.originalBudget), proposed: originalBudget, conditions });
          continue;
        }
        await tx.budgetLine.update({ where: { id: existing.id }, data: { originalBudget, description, status: "active", updatedBy: actor?.id || null } });
        await recomputeAllocations(tx, existing.id);
        updated += 1;
      } else {
        await tx.budgetLine.create({ data: { orgId, projectId, costCodeId, costType, originalBudget, description: trimOrNull(row.description)?.slice(0, 500) || null, sortOrder: index, createdBy: actor?.id || null, updatedBy: actor?.id || null } });
        created += 1;
      }
    }
    await audit({ tx, orgId, projectId, entityId: projectId, action: auditService.ACTIONS.UPDATED, actor, summary: { import: true, created, updated, missing: missing.length, lockedLines: lockedLines.length } });
    return { created, updated, missingCodes: missing, lockedLines };
  });
  return result;
};

// ─── Allocations ───────────────────────────────────────────────────────────

const normalizeAllocations = (entries) => {
  if (!Array.isArray(entries)) throw new HttpError(400, "BUDGET_ALLOCATIONS_REQUIRED", "allocations must be a list");
  const seen = new Set();
  const rows = entries.map((entry) => {
    const activityId = trimOrNull(entry?.activityId);
    if (!activityId) throw new HttpError(400, "BUDGET_ALLOCATION_ACTIVITY_REQUIRED", "Every allocation needs an activityId");
    if (seen.has(activityId)) throw new HttpError(400, "BUDGET_ALLOCATION_DUPLICATE", "An activity appears twice");
    seen.add(activityId);
    const weight = roundWeight(entry.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) throw new HttpError(400, "BUDGET_ALLOCATION_WEIGHT_INVALID", "Weights are percentages between 0 and 100");
    return { activityId, weight, source: ["manual", "boq", "even"].includes(entry.source) ? entry.source : "manual" };
  }).filter((row) => row.weight > 0);
  const total = roundWeight(rows.reduce((acc, row) => acc + row.weight, 0));
  if (total > 100.0001) throw new HttpError(400, "BUDGET_ALLOCATION_OVER", `Weights add up to ${total}%; at most 100% of a line can be allocated`);
  return rows;
};

const setLineAllocations = async ({ orgId, projectId, lineId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const line = await loadLine({ projectId, lineId });
  const rows = normalizeAllocations(payload.allocations);
  const { revised } = deriveLine(line);
  await prisma.$transaction(async (tx) => {
    if (rows.length) {
      const activities = await tx.activity.findMany({ where: { id: { in: rows.map((row) => row.activityId) }, projectId, isActive: true }, select: { id: true } });
      if (activities.length !== rows.length) throw new HttpError(404, "ACTIVITY_NOT_FOUND", "One or more activities were not found in this project");
    }
    await tx.budgetLineActivityAllocation.deleteMany({ where: { budgetLineId: lineId } });
    for (const row of rows) {
      await tx.budgetLineActivityAllocation.create({ data: { projectId, budgetLineId: lineId, activityId: row.activityId, weight: row.weight, amount: round2(multiplyMoney(revised, row.weight / 100)), source: row.source } });
    }
    await audit({ tx, orgId, projectId, entityId: lineId, action: auditService.ACTIONS.UPDATED, actor, summary: { code: line.costCode?.code, allocations: rows.length, allocatedWeight: roundWeight(rows.reduce((acc, row) => acc + row.weight, 0)) } });
  });
  return serializeLine(await loadLine({ projectId, lineId }));
};

/**
 * Suggests weights from approved BOQ allocations: activities whose BOQ item
 * codes start with the line's cost code share it in proportion to their
 * approved amounts; with no match, every activity with an approved
 * allocation shares in proportion to its approved budget.
 */
const suggestAllocations = async ({ orgId, projectId, lineId }) => {
  await ensureProject({ orgId, projectId });
  const line = await loadLine({ projectId, lineId });
  const code = String(line.costCode?.code || "").toUpperCase();
  const allocations = await prisma.activityBoqAllocation.findMany({
    where: { projectId, status: "approved", isActive: true, activity: { isActive: true } },
    select: { activityId: true, amount: true, boqItem: { select: { code: true, ref: true, section: true } }, activity: { select: { id: true, name: true, activityCode: true, wbsCode: true } } },
  });
  const matches = allocations.filter((row) => {
    const itemCode = String(row.boqItem?.code || row.boqItem?.ref || "").toUpperCase().replace(/\s+/g, "");
    const normalized = code.replace(/\s+/g, "");
    return normalized && itemCode && (itemCode === normalized || itemCode.startsWith(`${normalized}.`) || itemCode.startsWith(`${normalized}-`) || itemCode.startsWith(normalized));
  });
  const basis = matches.length ? matches : allocations;
  const source = matches.length ? "boq" : "even";
  const byActivity = new Map();
  for (const row of basis) {
    const current = byActivity.get(row.activityId) || { activityId: row.activityId, activity: row.activity, amount: 0 };
    current.amount = addMoney(current.amount, row.amount);
    byActivity.set(row.activityId, current);
  }
  const total = [...byActivity.values()].reduce((acc, row) => addMoney(acc, row.amount), 0);
  const items = [...byActivity.values()].map((row) => ({
    activityId: row.activityId,
    activity: row.activity ? { id: row.activity.id, name: row.activity.name, code: row.activity.activityCode || row.activity.wbsCode || null } : null,
    basisAmount: row.amount,
    weight: total > 0 ? roundWeight((row.amount / total) * 100) : roundWeight(100 / byActivity.size),
    source,
  }));
  // Fix rounding so the weights sum to exactly 100.
  const sum = roundWeight(items.reduce((acc, row) => acc + row.weight, 0));
  if (items.length && Math.abs(sum - 100) > 0.0001) items[0].weight = roundWeight(items[0].weight + (100 - sum));
  return { lineId, basis: source, items };
};

// ─── Ledger: transfers, revisions, change orders ───────────────────────────

const transferBudget = async ({ orgId, projectId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const amount = money(payload, "amount");
  if (!amount || amount <= 0) throw new HttpError(400, "BUDGET_TRANSFER_AMOUNT_INVALID", "Transfer a positive amount");
  const fromLineId = trimOrNull(payload.fromLineId);
  const toLineId = trimOrNull(payload.toLineId);
  if (!fromLineId || !toLineId || fromLineId === toLineId) throw new HttpError(400, "BUDGET_TRANSFER_LINES_INVALID", "Pick two different lines");
  const note = trimOrNull(payload.note)?.slice(0, 500) || null;
  await prisma.$transaction(async (tx) => {
    // Both lines are held first, in id order, so two transfers out of the
    // same line decide on figures the other has committed, not on the same
    // read (Phase 21D, CX21-446).
    for (const lineId of [fromLineId, toLineId].sort()) {
      await tx.$queryRaw`SELECT id FROM "BudgetLine" WHERE id = ${lineId} FOR NO KEY UPDATE`;
    }
    const from = await loadLine({ projectId, lineId: fromLineId }, tx);
    const to = await loadLine({ projectId, lineId: toLineId }, tx);
    if (from.status !== "active" || to.status !== "active") throw new HttpError(409, "BUDGET_LINE_ARCHIVED", "Archived lines cannot take transfers");
    const available = deriveLine(from).revised;
    if (amount > available + TOLERANCE) throw new HttpError(409, "BUDGET_TRANSFER_EXCEEDS", `Only ${available} is available on ${from.costCode?.code}`);
    await tx.budgetLineChange.create({ data: { orgId, projectId, budgetLineId: fromLineId, kind: "transfer_out", amount: -amount, counterpartLineId: toLineId, note, createdBy: actor?.id || null } });
    await tx.budgetLineChange.create({ data: { orgId, projectId, budgetLineId: toLineId, kind: "transfer_in", amount, counterpartLineId: fromLineId, note, createdBy: actor?.id || null } });
    await recomputeAllocations(tx, fromLineId);
    await recomputeAllocations(tx, toLineId);
    await audit({ tx, orgId, projectId, entityId: fromLineId, action: auditService.ACTIONS.UPDATED, actor, reason: note, summary: { transfer: amount, from: from.costCode?.code, to: to.costCode?.code } });
  });
  return listBudgetLines({ orgId, projectId });
};

const addRevision = async ({ orgId, projectId, lineId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const amount = money(payload, "amount");
  if (!amount) throw new HttpError(400, "BUDGET_REVISION_AMOUNT_INVALID", "Enter a non-zero amount (negative to reduce)");
  const note = trimOrNull(payload.note)?.slice(0, 500) || null;
  if (!note) throw new HttpError(400, "BUDGET_REVISION_NOTE_REQUIRED", "Say why the budget changes");
  await prisma.$transaction(async (tx) => {
    const line = await loadLine({ projectId, lineId }, tx);
    if (line.status !== "active") throw new HttpError(409, "BUDGET_LINE_ARCHIVED", "Archived lines cannot be revised");
    await tx.budgetLineChange.create({ data: { orgId, projectId, budgetLineId: lineId, kind: "revision", amount, note, createdBy: actor?.id || null } });
    await recomputeAllocations(tx, lineId);
    await audit({ tx, orgId, projectId, entityId: lineId, action: auditService.ACTIONS.UPDATED, actor, reason: note, summary: { code: line.costCode?.code, revision: amount } });
  });
  return serializeLine(await loadLine({ projectId, lineId }));
};

const CATEGORY_TO_COST_TYPE = Object.freeze({ labour: "labour", labor: "labour", material: "material", materials: "material", equipment: "equipment", plant: "equipment", subcontract: "subcontract", subcontractor: "subcontract", indirect: "indirect", overhead: "overhead", overheads: "overhead", contingency: "contingency", provisional: "contingency" });

const costTypeForOrder = (order) => CATEGORY_TO_COST_TYPE[String(order?.category || "").toLowerCase().trim()] || "other";

const ensureChangeOrderLine = async ({ tx, orgId, projectId, costType, actorId }) => {
  let code = await tx.costCode.findFirst({ where: { orgId, code: CHANGE_ORDER_COST_CODE.code }, select: { id: true } });
  if (!code) code = await tx.costCode.create({ data: { orgId, ...CHANGE_ORDER_COST_CODE, description: "Approved change orders not assigned to a budget line", createdBy: actorId, updatedBy: actorId }, select: { id: true } });
  await ensureProjectCostCodes({ tx, orgId, projectId, costCodeIds: [code.id], actorId });
  const existing = await tx.budgetLine.findFirst({ where: { projectId, costCodeId: code.id, costType }, select: { id: true } });
  if (existing) {
    await tx.budgetLine.update({ where: { id: existing.id }, data: { status: "active" } });
    return existing.id;
  }
  const created = await tx.budgetLine.create({ data: { orgId, projectId, costCodeId: code.id, costType, description: "Unassigned approved changes", createdBy: actorId, updatedBy: actorId }, select: { id: true } });
  return created.id;
};

/**
 * Called from change-order approval (inside its transaction). The approved
 * value lands on the order's budget line; otherwise on the lines allocated
 * to its activity in proportion to their allocation; otherwise on the
 * project's "Change orders" line for the order's cost type. Re-approval
 * replaces earlier rows for the same order.
 */
const applyChangeOrderToBudgetLines = async ({ tx = prisma, orgId, projectId, order, actorId = null }) => {
  if (!tx.budgetLine?.findMany || !tx.budgetLineChange?.create || !order) return null;
  const value = toMoneyNumber(order.value);
  await tx.budgetLineChange.deleteMany({ where: { projectId, changeOrderId: order.id } });
  let targets = [];
  // Phase 22B: the order names its lines and amounts. A line archived since is
  // not dropped in silence — its share goes to the "Change orders" line, so the
  // lines still add up to the approved value.
  const explicit = Array.isArray(order.budgetAllocationsJson)
    ? order.budgetAllocationsJson.filter((row) => row && row.budgetLineId && toMoneyNumber(row.amount) > 0)
    : [];
  if (explicit.length) {
    const lines = await tx.budgetLine.findMany({ where: { id: { in: explicit.map((row) => row.budgetLineId) }, projectId }, select: { id: true } });
    const known = new Set(lines.map((line) => line.id));
    let orphan = 0;
    for (const row of explicit) {
      if (known.has(row.budgetLineId)) targets.push({ lineId: row.budgetLineId, amount: round2(toMoneyNumber(row.amount)) });
      else orphan = addMoney(orphan, row.amount);
    }
    if (orphan > 0) targets.push({ lineId: await ensureChangeOrderLine({ tx, orgId, projectId, costType: costTypeForOrder(order), actorId }), amount: round2(orphan) });
  }
  if (!targets.length && order.budgetLineId) {
    const line = await tx.budgetLine.findFirst({ where: { id: order.budgetLineId, projectId }, select: { id: true } });
    if (line) targets = [{ lineId: line.id, share: 1 }];
  }
  if (!targets.length && order.activityId && tx.budgetLineActivityAllocation?.findMany) {
    const allocations = await tx.budgetLineActivityAllocation.findMany({ where: { projectId, activityId: order.activityId, budgetLine: { status: "active" } }, select: { budgetLineId: true, amount: true } });
    const total = allocations.reduce((acc, row) => addMoney(acc, row.amount), 0);
    if (allocations.length) targets = allocations.map((row) => ({ lineId: row.budgetLineId, share: total > 0 ? toMoneyNumber(row.amount) / total : 1 / allocations.length }));
  }
  if (!targets.length) targets = [{ lineId: await ensureChangeOrderLine({ tx, orgId, projectId, costType: costTypeForOrder(order), actorId }), share: 1 }];
  const applied = [];
  let remaining = value;
  for (const [index, target] of targets.entries()) {
    const amount =
      index === targets.length - 1
        ? round2(remaining) // the last line takes the rounding, so the lines add up to the value exactly
        : target.amount !== undefined
          ? round2(Math.min(target.amount, remaining))
          : round2(multiplyMoney(value, target.share));
    remaining = subtractMoney(remaining, amount);
    await tx.budgetLineChange.create({ data: { orgId, projectId, budgetLineId: target.lineId, kind: "change_order", amount, changeOrderId: order.id, note: `Approved ${order.ref || "change order"}`, createdBy: actorId } });
    await recomputeAllocations(tx, target.lineId);
    applied.push({ lineId: target.lineId, amount });
  }
  return { changeOrderId: order.id, value, lines: applied };
};

/** Points a change order at a budget line; re-applies when it is already approved. */
const setChangeOrderBudgetLine = async ({ orgId, projectId, changeOrderId, lineId, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const order = await prisma.changeOrder.findFirst({ where: { id: changeOrderId, projectId } });
  if (!order) throw new HttpError(404, "CHANGE_ORDER_NOT_FOUND", "Change order not found");
  if (lineId) await loadLine({ projectId, lineId });
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.changeOrder.update({ where: { id: changeOrderId }, data: { budgetLineId: lineId || null } });
    if (updated.status === "approved") return applyChangeOrderToBudgetLines({ tx, orgId, projectId, order: updated, actorId: actor?.id || null });
    return null;
  });
  return { changeOrderId, budgetLineId: lineId || null, applied: result };
};

// ─── Reconciliation ────────────────────────────────────────────────────────

/**
 * Σ activity budgets (approved BOQ allocations + approved change-order
 * impacts on activities) against Σ budget lines (revised) and the lines'
 * activity allocations.
 */
const reconcile = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });
  const [activities, lines, allocationTotals, coLinks] = await Promise.all([
    prisma.activity.findMany({ where: { projectId, isActive: true }, select: { id: true, name: true, activityCode: true, wbsCode: true, budget: true }, orderBy: [{ sortOrder: "asc" }] }),
    loadLines({ projectId }),
    getApprovedActivityAllocationTotals({ projectId }),
    prisma.changeOrderActivityLink?.findMany
      ? prisma.changeOrderActivityLink.findMany({ where: { projectId, changeOrder: { status: "approved", archivedAt: null } }, select: { activityId: true, approvedCostImpact: true } })
      : [],
  ]);
  const coByActivity = new Map();
  for (const link of coLinks) coByActivity.set(link.activityId, addMoney(coByActivity.get(link.activityId) || 0, link.approvedCostImpact));
  const serialized = lines.map(serializeLine);
  const lineByActivity = new Map();
  for (const line of serialized) {
    for (const allocation of line.allocations) lineByActivity.set(allocation.activityId, addMoney(lineByActivity.get(allocation.activityId) || 0, allocation.amount));
  }
  const rows = activities.map((activity) => {
    const boq = allocationTotals.get(activity.id)?.amount || 0;
    const changes = coByActivity.get(activity.id) || 0;
    const activityBudget = addMoney(boq, changes);
    const fromLines = lineByActivity.get(activity.id) || 0;
    return { activityId: activity.id, name: activity.name, code: activity.activityCode || activity.wbsCode || null, boqBudget: boq, approvedChanges: changes, activityBudget, budgetFromLines: fromLines, difference: subtractMoney(fromLines, activityBudget) };
  });
  const totals = {
    activityBudget: rows.reduce((acc, row) => addMoney(acc, row.activityBudget), 0),
    budgetLines: serialized.reduce((acc, line) => addMoney(acc, line.revisedBudget), 0),
    allocatedToActivities: serialized.reduce((acc, line) => addMoney(acc, line.allocatedAmount), 0),
    unallocatedLines: serialized.reduce((acc, line) => addMoney(acc, line.unallocatedAmount), 0),
  };
  totals.difference = subtractMoney(totals.budgetLines, totals.activityBudget);
  const mismatches = rows.filter((row) => Math.abs(row.difference) > TOLERANCE);
  return {
    generatedAt: new Date().toISOString(),
    balanced: Math.abs(totals.difference) <= TOLERANCE && mismatches.length === 0,
    totals,
    activities: rows,
    mismatches,
    underAllocatedLines: serialized.filter((line) => line.allocatedWeight < 99.99 && line.revisedBudget !== 0).map((line) => ({ id: line.id, code: line.costCode?.code, costType: line.costType, revisedBudget: line.revisedBudget, allocatedWeight: line.allocatedWeight, unallocatedAmount: line.unallocatedAmount })),
    activitiesWithoutLines: rows.filter((row) => row.activityBudget !== 0 && row.budgetFromLines === 0).map((row) => ({ activityId: row.activityId, name: row.name, code: row.code, activityBudget: row.activityBudget })),
  };
};

// ─── Snapshots ─────────────────────────────────────────────────────────────

// A period's cutoff as the EV reports use it (the instant its figures are
// cut at, with its date and zone), never the stored reporting-date value.
const periodCutoffReader = ({ orgId, projectId }) => require("./earned-value.service").periodCutoffReader({ orgId, projectId });

const serializeSnapshot = (row, { withLines = false, cutoffOf = null } = {}) => ({
  id: row.id,
  projectId: row.projectId,
  reportingPeriodId: row.reportingPeriodId || null,
  reportingPeriod: row.reportingPeriod ? { id: row.reportingPeriod.id, code: row.reportingPeriod.code, label: row.reportingPeriod.label, ...(cutoffOf ? cutoffOf(row.reportingPeriod) : { cutoffDate: null }), status: row.reportingPeriod.status } : null,
  label: row.label,
  takenBy: row.takenBy || null,
  takenAt: toIso(row.takenAt),
  totals: row.totalsJson || {},
  reconciliation: row.reconciliationJson || {},
  ...(withLines ? { lines: row.linesJson || [] } : { lineCount: Array.isArray(row.linesJson) ? row.linesJson.length : 0 }),
});

const snapshotInclude = { reportingPeriod: { select: { id: true, code: true, label: true, cutoffDate: true, status: true, evSnapshot: { select: { cutoffDate: true, basisJson: true } } } } };

const buildSnapshotPayload = async ({ orgId, projectId }) => {
  const [{ items, summary }, reconciliation] = await Promise.all([listBudgetLines({ orgId, projectId, query: { includeArchived: true } }), reconcile({ orgId, projectId })]);
  return { totals: { ...summary.totals, byType: summary.byType, lines: summary.lines }, lines: items.map(withoutTruth), reconciliation };
};

const takeSnapshot = async ({ orgId, projectId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const reportingPeriodId = trimOrNull(payload.reportingPeriodId);
  let period = null;
  if (reportingPeriodId) {
    period = await prisma.reportingPeriod.findFirst({ where: { id: reportingPeriodId, projectId } });
    if (!period) throw new HttpError(404, "REPORTING_PERIOD_NOT_FOUND", "Reporting period not found");
  }
  const label = trimOrNull(payload.label) || (period ? `Period ${period.code}` : `Budget as of ${new Date().toISOString().slice(0, 10)}`);
  const body = await buildSnapshotPayload({ orgId, projectId });
  const data = { orgId, projectId, reportingPeriodId: reportingPeriodId || null, label: label.slice(0, 160), takenBy: actor?.id || null, takenAt: new Date(), totalsJson: body.totals, linesJson: body.lines, reconciliationJson: body.reconciliation };
  const row = reportingPeriodId
    ? await prisma.budgetSnapshot.upsert({ where: { reportingPeriodId }, create: data, update: { label: data.label, takenBy: data.takenBy, takenAt: data.takenAt, totalsJson: data.totalsJson, linesJson: data.linesJson, reconciliationJson: data.reconciliationJson }, include: snapshotInclude })
    : await prisma.budgetSnapshot.create({ data, include: snapshotInclude });
  await auditService.recordEvent({ orgId, projectId, entityType: auditService.ENTITY_TYPES.BUDGET_SNAPSHOT, entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, actorRole: actor?.role || null, summary: { label: row.label, reportingPeriodId: reportingPeriodId || null, balanced: body.reconciliation.balanced, budgetLines: body.totals.revisedBudget }, metadata: { source: "cost_control.budget" } });
  return serializeSnapshot(row, { withLines: true, cutoffOf: await periodCutoffReader({ orgId, projectId }) });
};

/** Locking a reporting period freezes the budget with it (called inside the lock transaction). */
const snapshotForPeriod = async ({ tx = prisma, orgId, projectId, periodId, userId = null }) => {
  if (!tx.budgetSnapshot?.upsert || !tx.budgetLine?.findMany) return null;
  const lines = (await loadLines({ projectId, includeArchived: true }, tx)).map((line) => withoutTruth(serializeLine(line)));
  if (!lines.length) return null;
  const summary = summarize(lines);
  const period = await tx.reportingPeriod.findFirst({ where: { id: periodId }, select: { code: true } });
  const totals = { ...summary.totals, byType: summary.byType, lines: summary.lines };
  const row = await tx.budgetSnapshot.upsert({
    where: { reportingPeriodId: periodId },
    create: { orgId, projectId, reportingPeriodId: periodId, label: `Period ${period?.code || ""}`.trim(), takenBy: userId, totalsJson: totals, linesJson: lines, reconciliationJson: { note: "Taken at period lock; run the reconciliation report for activity detail", budgetLines: totals.revisedBudget } },
    update: { takenBy: userId, takenAt: new Date(), totalsJson: totals, linesJson: lines },
  });
  return { id: row.id, label: row.label };
};

const listSnapshots = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });
  const rows = await prisma.budgetSnapshot.findMany({ where: { projectId }, include: snapshotInclude, orderBy: { takenAt: "desc" }, take: 100 });
  const cutoffOf = await periodCutoffReader({ orgId, projectId });
  return { items: rows.map((row) => serializeSnapshot(row, { cutoffOf })) };
};

const getSnapshot = async ({ orgId, projectId, snapshotId }) => {
  await ensureProject({ orgId, projectId });
  const row = await prisma.budgetSnapshot.findFirst({ where: { id: snapshotId, projectId }, include: snapshotInclude });
  if (!row) throw new HttpError(404, "BUDGET_SNAPSHOT_NOT_FOUND", "Snapshot not found");
  return serializeSnapshot(row, { withLines: true, cutoffOf: await periodCutoffReader({ orgId, projectId }) });
};

module.exports = {
  COST_TYPES,
  CHANGE_KINDS,
  TOLERANCE,
  deriveLine,
  serializeLine,
  summarize,
  normalizeAllocations,
  costTypeForOrder,
  listProjectCostCodes,
  selectProjectCostCodes,
  listBudgetLines,
  getBudgetLine,
  createBudgetLine,
  updateBudgetLine,
  archiveBudgetLine,
  importBudgetLines,
  ORIGINAL_LOCK,
  originalBudgetLocks,
  assertOriginalBudgetWritable,
  setLineAllocations,
  suggestAllocations,
  transferBudget,
  addRevision,
  applyChangeOrderToBudgetLines,
  setChangeOrderBudgetLine,
  reconcile,
  takeSnapshot,
  snapshotForPeriod,
  listSnapshots,
  getSnapshot,
};
