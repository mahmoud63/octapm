const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  addMoney,
  divideMoney,
  multiplyMoney,
  subtractMoney,
  toMoneyNumber,
} = require('../utils/money');
const {
  containsInsensitive,
  cursorArgs,
  equalsInsensitive,
  normalizeListQuery,
  toCursorPage,
  trimToNull,
} = require('../utils/list-query');
const {
  getApprovedActivityAllocationTotals,
} = require('./activity-boq-allocation.service');
const auditService = require('./audit.service');

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const parseOptionalDate = (value, field = 'date') => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', `${field} is invalid`);
  }

  return date;
};

const resolveActualThroughDate = ({ payload }) => {
  // The date the actual is good through is the ledger's (it advances it with
  // every posting). An edit writes it only when the caller supplies one;
  // writing back the date it had read erased a posting's advance that landed
  // in between (Phase 21D, CX21-436). `undefined` means "not written".
  return parseOptionalDate(payload.actualThroughDate, 'actualThroughDate');
};

const COST_RECORD_INCLUDE = {
  activity: {
    select: {
      id: true,
      name: true,
      wbsCode: true,
      category: true,
      sortOrder: true,
    },
  },
};

const COST_SORT_FIELDS = [
  'activity',
  'phase',
  'updated',
  'labour',
  'material',
  'equipment',
  'subcontract',
  'committed',
  'actual',
  'forecast',
];

const buildCostWhere = ({ projectId, query = {} }) => {
  const activity = { isActive: true };
  const where = { projectId, activity };

  const activityId = trimToNull(query.activityId);
  if (activityId) where.activityId = activityId;

  const category = trimToNull(query.category);
  if (category) activity.category = equalsInsensitive(category);

  const search = trimToNull(query.search);
  if (search) {
    activity.OR = [
      { name: containsInsensitive(search) },
      { wbsCode: containsInsensitive(search) },
      { category: containsInsensitive(search) },
    ];
  }

  return where;
};

const buildCostOrderBy = ({ sortBy, sortDir }) => {
  if (sortBy === 'activity') {
    return [{ activity: { sortOrder: sortDir } }, { id: sortDir }];
  }

  if (sortBy === 'phase') {
    return [{ activity: { category: sortDir } }, { id: sortDir }];
  }

  if (sortBy === 'updated') {
    return [{ updatedAt: sortDir }, { id: sortDir }];
  }

  return [{ [sortBy]: sortDir }, { id: sortDir }];
};

const attachApprovedBudgets = async ({ projectId, records }) => {
  const activityIds = records.map((record) => record.activityId).filter(Boolean);
  const allocationTotals = await getApprovedActivityAllocationTotals({
    projectId,
    activityIds,
  });
  // Rows whose committed is the executed commitments' figure are marked, so
  // the screen does not offer to edit what the edit would refuse (CX21-493).
  const { activitiesWithExecutedCommitments } = require('./commitment.service');
  const derived = await activitiesWithExecutedCommitments({ projectId });

  return records.map((record) => ({
    ...record,
    generatedBudget: record.budget,
    budget: allocationTotals.get(record.activityId)?.amount || 0,
    committedDerived: derived.has(record.activityId),
  }));
};

const findCostRecords = ({ projectId, query = {}, listQuery = null }) => {
  const normalized =
    listQuery ||
    normalizeListQuery(query, {
      allowedSorts: COST_SORT_FIELDS,
      defaultSortBy: 'activity',
      defaultSortDir: 'asc',
      defaultLimit: 25,
    });

  return prisma.costRecord.findMany({
    where: buildCostWhere({ projectId, query }),
    include: COST_RECORD_INCLUDE,
    orderBy: buildCostOrderBy(normalized),
    ...(listQuery
      ? {
          take: normalized.limit + 1,
          ...cursorArgs(normalized.cursor),
        }
      : {}),
  });
};

const getCostRecords = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });

  const listQuery = normalizeListQuery(query, {
    allowedSorts: COST_SORT_FIELDS,
    defaultSortBy: 'activity',
    defaultSortDir: 'asc',
  });
  const records = await findCostRecords({ projectId, query, listQuery });
  const page = toCursorPage(records, listQuery.limit);
  const rows = await attachApprovedBudgets({
    projectId,
    records: page.rows,
  });

  return {
    rows,
    pagination: page.pagination,
  };
};

const summarizeTotals = (records) =>
  records.reduce(
    (acc, record) => {
      acc.budget = addMoney(acc.budget, record.budget);
      acc.committed = addMoney(acc.committed, record.committed);
      acc.actual = addMoney(acc.actual, record.actual);
      acc.forecast = addMoney(acc.forecast, record.forecast);
      return acc;
    },
    { budget: 0, committed: 0, actual: 0, forecast: 0 },
  );

const getCostSummary = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const records = await attachApprovedBudgets({
    projectId,
    records: await findCostRecords({
      projectId,
      query: {},
      listQuery: null,
    }),
  });

  const byPhaseMap = new Map();
  for (const record of records) {
    const phase = record.activity?.category || 'General';
    const current = byPhaseMap.get(phase) || {
      phase,
      budget: 0,
      committed: 0,
      actual: 0,
      forecast: 0,
    };

    current.budget = addMoney(current.budget, record.budget);
    current.committed = addMoney(current.committed, record.committed);
    current.actual = addMoney(current.actual, record.actual);
    current.forecast = addMoney(current.forecast, record.forecast);
    byPhaseMap.set(phase, current);
  }

  const totals = summarizeTotals(records);
  const eac = {
    optimistic: multiplyMoney(totals.budget, 0.9),
    mostLikely: totals.forecast || totals.budget,
    pessimistic: multiplyMoney(totals.budget, 1.15),
  };

  return {
    records,
    byPhase: Array.from(byPhaseMap.values()).map((row) => ({
      ...row,
      variance: subtractMoney(row.budget, row.forecast),
      variancePct:
        row.budget > 0 ? ((row.budget - row.forecast) / row.budget) * 100 : 0,
    })),
    totals,
    eac,
  };
};

const resolveForecast = ({ budget, actual, payloadForecast }) => {
  if (payloadForecast !== undefined && payloadForecast !== null) {
    return Number(payloadForecast) || 0;
  }

  return addMoney(budget, multiplyMoney(subtractMoney(actual, budget), 1.1));
};

const runInTransaction = (fn) =>
  prisma.$transaction ? prisma.$transaction(fn) : fn(prisma);

const dateSummary = (value) =>
  value ? new Date(value).toISOString() : null;

const costRecordSummary = (record) => ({
  activityId: record.activityId,
  labour: toMoneyNumber(record.labour),
  material: toMoneyNumber(record.material),
  equipment: toMoneyNumber(record.equipment),
  subcontract: toMoneyNumber(record.subcontract),
  indirect: toMoneyNumber(record.indirect),
  overhead: toMoneyNumber(record.overhead),
  contingency: toMoneyNumber(record.contingency),
  budget: toMoneyNumber(record.budget),
  committed: toMoneyNumber(record.committed),
  actual: toMoneyNumber(record.actual),
  actualThroughDate: dateSummary(record.actualThroughDate),
  forecast: toMoneyNumber(record.forecast),
});

const burnRateSummary = (entry) => ({
  date: dateSummary(entry.date),
  amount: toMoneyNumber(entry.amount),
  category: entry.category || null,
  note: entry.note || null,
});

const CATEGORY_FIELDS = ['labour', 'material', 'equipment', 'subcontract', 'indirect', 'overhead', 'contingency'];

/**
 * Actual cost is a projection of the cost ledger (OCTA-FIN-LEDGER-059); a
 * figure typed onto the activity would be one the ledger never posted
 * (Phase 21D, CX21-412). An echo of the row's own figure is let through.
 */
const assertActualIsTheLedgers = ({ payload, existing }) => {
  if (payload.actual === undefined) return;
  if (Math.abs(toMoneyNumber(payload.actual) - toMoneyNumber(existing?.actual ?? 0)) > 0.005) {
    throw new HttpError(400, 'COST_ACTUAL_IS_DERIVED', 'Actual cost is posted through the cost ledger; it cannot be typed onto an activity');
  }
};

/**
 * Committed is the executed commitments' projection wherever one names the
 * activity (`recomputeCommitted` writes it); a figure typed there would hide
 * an obligation the project has entered. An activity no commitment names
 * keeps a typed figure, and an echo of the row's own figure is let through
 * (Phase 21D, CX21-493).
 */
const assertCommittedIsTheCommitments = async ({ tx, payload, existing, projectId, activityId }) => {
  if (payload.committed === undefined) return;
  if (Math.abs(toMoneyNumber(payload.committed) - toMoneyNumber(existing?.committed ?? 0)) <= 0.005) return;
  const { hasExecutedCommitmentOn } = require('./commitment.service');
  if (await hasExecutedCommitmentOn({ tx, projectId, activityId })) {
    throw new HttpError(400, 'COST_COMMITTED_IS_DERIVED', "Committed cost on this activity is the executed commitments' figure; it cannot be typed");
  }
};

/**
 * Only what the caller supplied is written. A copy of the row read before
 * the lock was written back over fields the caller never mentioned, and two
 * editors of different fields erased each other's work (Phase 21D, CX21-497);
 * budget, actual, its through-date and committed each have their own owner.
 * The forecast follows the budget when the budget is set and no forecast is
 * given.
 */
const suppliedCostFields = ({ payload, existing }) => {
  const data = {};
  for (const field of CATEGORY_FIELDS) {
    if (payload[field] !== undefined) data[field] = toMoneyNumber(payload[field]);
  }
  if (payload.budget !== undefined) data.budget = toMoneyNumber(payload.budget);
  // committed is written only when it differs from the row's: an echo of the
  // figure read is not written back over a recompute that landed since the
  // read (Phase 21D, CX21-511)
  if (payload.committed !== undefined && Math.abs(toMoneyNumber(payload.committed) - toMoneyNumber(existing?.committed ?? 0)) > 0.005) {
    data.committed = toMoneyNumber(payload.committed);
  }
  const actualThroughDate = resolveActualThroughDate({ payload });
  if (actualThroughDate !== undefined) data.actualThroughDate = actualThroughDate;
  if (payload.forecast !== undefined && payload.forecast !== null) {
    data.forecast = Number(payload.forecast) || 0;
  } else if (data.budget !== undefined) {
    data.forecast = resolveForecast({ budget: data.budget, actual: toMoneyNumber(existing?.actual ?? 0) });
  }
  return data;
};

const upsertCostRecord = async ({
  orgId,
  projectId,
  activityId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const activity = await prisma.activity.findFirst({
    where: { id: activityId, projectId },
  });
  if (!activity) {
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  }

  const allocationTotals = await getApprovedActivityAllocationTotals({
    projectId,
  });
  const approvedBudget = allocationTotals.get(activityId)?.amount || 0;

  return runInTransaction(async (tx) => {
    // One projection row per activity, whoever creates it: the pair is held
    // first and the row is read under it, so every decision below is made on
    // the row as it is now — not on a copy read before — and a posting that
    // created the row meanwhile is updated, not duplicated (Phase 21D,
    // CX21-464, CX21-497).
    if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cost-record:${projectId}:${activityId}`}))`;
    const existing = await tx.costRecord.findFirst({ where: { projectId, activityId } });
    assertActualIsTheLedgers({ payload, existing });
    await assertCommittedIsTheCommitments({ tx, payload, existing, projectId, activityId });

    const data = suppliedCostFields({ payload, existing });
    let record;
    if (existing) {
      // A row found under the lock keeps the committed a commitment gave it
      // (Phase 21D, CX21-482) and every figure the caller did not mention.
      record = await tx.costRecord.update({ where: { id: existing.id }, data });
    } else {
      const budget = data.budget ?? approvedBudget;
      record = await tx.costRecord.create({
        data: {
          projectId,
          activityId,
          committed: 0,
          ...data,
          budget,
          forecast: data.forecast ?? resolveForecast({ budget, actual: 0 }),
        },
      });
    }

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COST_RECORD,
      entityId: record.id,
      action: existing
        ? auditService.ACTIONS.UPDATED
        : auditService.ACTIONS.CREATED,
      actorId: userId,
      actorRole: userRole,
      oldSummary: existing ? costRecordSummary(existing) : null,
      newSummary: costRecordSummary(record),
      summary: {
        activityId,
        actual: toMoneyNumber(record.actual),
        committed: toMoneyNumber(record.committed),
        forecast: toMoneyNumber(record.forecast),
      },
      metadata: { source: 'cost_control' },
    });

    return record;
  });
};

const updateCostRecord = async ({
  orgId,
  projectId,
  costRecordId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const found = await prisma.costRecord.findFirst({
    where: { id: costRecordId, projectId },
  });
  if (!found) {
    throw new HttpError(404, 'COST_RECORD_NOT_FOUND', 'Cost record not found');
  }

  return runInTransaction(async (tx) => {
    // The (project, activity) pair is held — the ledger, the commitments and
    // the upsert hold it too — and the row is read again under it: the edit
    // is decided on the row as it is now (Phase 21D, CX21-497).
    if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cost-record:${projectId}:${found.activityId}`}))`;
    const existing = await tx.costRecord.findFirst({ where: { id: costRecordId, projectId } });
    if (!existing) {
      throw new HttpError(404, 'COST_RECORD_NOT_FOUND', 'Cost record not found');
    }
    assertActualIsTheLedgers({ payload, existing });
    await assertCommittedIsTheCommitments({ tx, payload, existing, projectId, activityId: existing.activityId });

    const data = suppliedCostFields({ payload, existing });
    const record = await tx.costRecord.update({ where: { id: costRecordId }, data });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.COST_RECORD,
      entityId: costRecordId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      oldSummary: costRecordSummary(existing),
      newSummary: costRecordSummary(record),
      summary: {
        activityId: record.activityId,
        actual: toMoneyNumber(record.actual),
        committed: toMoneyNumber(record.committed),
        forecast: toMoneyNumber(record.forecast),
      },
      metadata: { source: 'cost_control' },
    });

    return record;
  });
};

const toProjectDurationDays = (project) => {
  if (project.duration && project.duration > 0) {
    if (project.durationUnit === 'days') return project.duration;
    if (project.durationUnit === 'weeks') return project.duration * 7;
    return project.duration * 30;
  }

  if (project.startDate && project.endDate) {
    const diff =
      (new Date(project.endDate).getTime() -
        new Date(project.startDate).getTime()) /
      (1000 * 60 * 60 * 24);
    return Math.max(1, Math.round(diff));
  }

  return 30;
};

const getBurnRate = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });

  const entries = await prisma.burnRateEntry.findMany({
    where: { projectId },
    orderBy: { date: 'asc' },
  });

  const byDate = new Map();
  for (const entry of entries) {
    const key = new Date(entry.date).toISOString().slice(0, 10);
    byDate.set(key, addMoney(byDate.get(key) || 0, entry.amount));
  }

  const durationDays = toProjectDurationDays(project);
  const budgetRate =
    durationDays > 0 ? divideMoney(project.contractValue, durationDays) : 0;

  const data = Array.from(byDate.entries()).map(([date, actual]) => ({
    date,
    actual,
    budget: budgetRate,
  }));

  return { budgetRate, data };
};

const addBurnRateEntry = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  return runInTransaction(async (tx) => {
    const entry = await tx.burnRateEntry.create({
      data: {
        projectId,
        date: payload.date ? new Date(payload.date) : new Date(),
        amount: toMoneyNumber(payload.amount),
        category: payload.category?.trim() || null,
        note: payload.note?.trim() || null,
      },
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.BURN_RATE_ENTRY,
      entityId: entry.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      actorRole: userRole,
      newSummary: burnRateSummary(entry),
      summary: {
        amount: toMoneyNumber(entry.amount),
        category: entry.category || null,
      },
      metadata: { source: 'cost_control.burn_rate' },
    });

    return entry;
  });
};

module.exports = {
  getCostRecords,
  getCostSummary,
  upsertCostRecord,
  updateCostRecord,
  getBurnRate,
  addBurnRateEntry,
};
