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

const resolveActualThroughDate = ({ payload, existing = null, actual }) => {
  const suppliedDate = parseOptionalDate(
    payload.actualThroughDate,
    'actualThroughDate',
  );
  if (suppliedDate !== undefined) return suppliedDate;

  // An actual in the payload is only ever an echo of what the ledger posted
  // (COST_ACTUAL_IS_DERIVED); it is not a posting, so it does not move the
  // date the actual is good through. Treating it as one reset the date under
  // the latest ledger entry and the reconciliation flagged the activity as
  // stale (Phase 21D, T-15).
  if (existing?.actualThroughDate) {
    return existing.actualThroughDate;
  }

  if (existing && Number(existing.actual) > 0) {
    return existing.updatedAt || new Date();
  }

  return Number(actual) > 0 ? new Date() : null;
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

  return records.map((record) => ({
    ...record,
    generatedBudget: record.budget,
    budget: allocationTotals.get(record.activityId)?.amount || 0,
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

  const existing = await prisma.costRecord.findFirst({
    where: { projectId, activityId },
  });
  const allocationTotals = await getApprovedActivityAllocationTotals({
    projectId,
  });
  const approvedBudget = allocationTotals.get(activityId)?.amount || 0;

  const budget = toMoneyNumber(payload.budget ?? approvedBudget);
  // Actual cost is a projection of the cost ledger (OCTA-FIN-LEDGER-059);
  // a figure typed onto the activity would be one the ledger never posted
  // (Phase 21D, CX21-412).
  if (payload.actual !== undefined && Math.abs(toMoneyNumber(payload.actual) - toMoneyNumber(existing?.actual ?? 0)) > 0.005) {
    throw new HttpError(400, 'COST_ACTUAL_IS_DERIVED', 'Actual cost is posted through the cost ledger; it cannot be typed onto an activity');
  }
  const actual = toMoneyNumber(payload.actual ?? existing?.actual ?? 0);
  const actualThroughDate = resolveActualThroughDate({
    payload,
    existing,
    actual,
  });

  const data = {
    projectId,
    activityId,
    labour: toMoneyNumber(payload.labour ?? existing?.labour ?? 0),
    material: toMoneyNumber(payload.material ?? existing?.material ?? 0),
    equipment: toMoneyNumber(payload.equipment ?? existing?.equipment ?? 0),
    subcontract: toMoneyNumber(payload.subcontract ?? existing?.subcontract ?? 0),
    indirect: toMoneyNumber(payload.indirect ?? existing?.indirect ?? 0),
    overhead: toMoneyNumber(payload.overhead ?? existing?.overhead ?? 0),
    contingency: toMoneyNumber(payload.contingency ?? existing?.contingency ?? 0),
    budget,
    committed: toMoneyNumber(payload.committed ?? existing?.committed ?? 0),
    // actual is not written here: it is the ledger's projection, and a stale
    // copy would erase a posting that landed since the read (Phase 21D, CX21-422)
    actualThroughDate,
    forecast: resolveForecast({
      budget,
      actual,
      payloadForecast: payload.forecast,
    }),
  };

  return runInTransaction(async (tx) => {
    const record = existing
      ? await tx.costRecord.update({ where: { id: existing.id }, data })
      : await tx.costRecord.create({ data });

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

  const existing = await prisma.costRecord.findFirst({
    where: { id: costRecordId, projectId },
  });
  if (!existing) {
    throw new HttpError(404, 'COST_RECORD_NOT_FOUND', 'Cost record not found');
  }

  const budget = toMoneyNumber(payload.budget ?? existing.budget);
  if (payload.actual !== undefined && Math.abs(toMoneyNumber(payload.actual) - toMoneyNumber(existing.actual)) > 0.005) {
    throw new HttpError(400, 'COST_ACTUAL_IS_DERIVED', 'Actual cost is posted through the cost ledger; it cannot be typed onto an activity');
  }
  const actual = toMoneyNumber(payload.actual ?? existing.actual);
  const actualThroughDate = resolveActualThroughDate({
    payload,
    existing,
    actual,
  });

  const data = {
    labour: toMoneyNumber(payload.labour ?? existing.labour),
    material: toMoneyNumber(payload.material ?? existing.material),
    equipment: toMoneyNumber(payload.equipment ?? existing.equipment),
    subcontract: toMoneyNumber(payload.subcontract ?? existing.subcontract),
    indirect: toMoneyNumber(payload.indirect ?? existing.indirect),
    overhead: toMoneyNumber(payload.overhead ?? existing.overhead),
    contingency: toMoneyNumber(payload.contingency ?? existing.contingency),
    budget,
    committed: toMoneyNumber(payload.committed ?? existing.committed),
    // actual is not written here: it is the ledger's projection, and a stale
    // copy would erase a posting that landed since the read (Phase 21D, CX21-422)
    actualThroughDate,
    forecast: resolveForecast({
      budget,
      actual,
      payloadForecast: payload.forecast,
    }),
  };

  return runInTransaction(async (tx) => {
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
