const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const getCostRecords = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  return prisma.costRecord.findMany({
    where: { projectId },
    include: {
      activity: {
        select: {
          id: true,
          name: true,
          wbsCode: true,
          category: true,
          sortOrder: true,
        },
      },
    },
    orderBy: { activity: { sortOrder: 'asc' } },
  });
};

const summarizeTotals = (records) =>
  records.reduce(
    (acc, record) => {
      acc.budget += Number(record.budget) || 0;
      acc.committed += Number(record.committed) || 0;
      acc.actual += Number(record.actual) || 0;
      acc.forecast += Number(record.forecast) || 0;
      return acc;
    },
    { budget: 0, committed: 0, actual: 0, forecast: 0 },
  );

const getCostSummary = async ({ orgId, projectId }) => {
  const records = await getCostRecords({ orgId, projectId });

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

    current.budget += Number(record.budget) || 0;
    current.committed += Number(record.committed) || 0;
    current.actual += Number(record.actual) || 0;
    current.forecast += Number(record.forecast) || 0;
    byPhaseMap.set(phase, current);
  }

  const totals = summarizeTotals(records);
  const eac = {
    optimistic: totals.budget * 0.9,
    mostLikely: totals.forecast || totals.budget,
    pessimistic: totals.budget * 1.15,
  };

  return {
    records,
    byPhase: Array.from(byPhaseMap.values()).map((row) => ({
      ...row,
      variance: row.budget - row.forecast,
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

  return budget + (actual - budget) * 1.1;
};

const upsertCostRecord = async ({ orgId, projectId, activityId, payload }) => {
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

  const budget =
    Number(payload.budget ?? existing?.budget ?? activity.budget ?? 0) || 0;
  const actual = Number(payload.actual ?? existing?.actual ?? 0) || 0;

  const data = {
    projectId,
    activityId,
    labour: Number(payload.labour ?? existing?.labour ?? 0) || 0,
    material: Number(payload.material ?? existing?.material ?? 0) || 0,
    equipment: Number(payload.equipment ?? existing?.equipment ?? 0) || 0,
    subcontract: Number(payload.subcontract ?? existing?.subcontract ?? 0) || 0,
    indirect: Number(payload.indirect ?? existing?.indirect ?? 0) || 0,
    overhead: Number(payload.overhead ?? existing?.overhead ?? 0) || 0,
    contingency: Number(payload.contingency ?? existing?.contingency ?? 0) || 0,
    budget,
    committed: Number(payload.committed ?? existing?.committed ?? 0) || 0,
    actual,
    forecast: resolveForecast({
      budget,
      actual,
      payloadForecast: payload.forecast,
    }),
  };

  if (existing) {
    return prisma.costRecord.update({ where: { id: existing.id }, data });
  }

  return prisma.costRecord.create({ data });
};

const updateCostRecord = async ({
  orgId,
  projectId,
  costRecordId,
  payload,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.costRecord.findFirst({
    where: { id: costRecordId, projectId },
  });
  if (!existing) {
    throw new HttpError(404, 'COST_RECORD_NOT_FOUND', 'Cost record not found');
  }

  const budget = Number(payload.budget ?? existing.budget) || 0;
  const actual = Number(payload.actual ?? existing.actual) || 0;

  const data = {
    labour: Number(payload.labour ?? existing.labour) || 0,
    material: Number(payload.material ?? existing.material) || 0,
    equipment: Number(payload.equipment ?? existing.equipment) || 0,
    subcontract: Number(payload.subcontract ?? existing.subcontract) || 0,
    indirect: Number(payload.indirect ?? existing.indirect) || 0,
    overhead: Number(payload.overhead ?? existing.overhead) || 0,
    contingency: Number(payload.contingency ?? existing.contingency) || 0,
    budget,
    committed: Number(payload.committed ?? existing.committed) || 0,
    actual,
    forecast: resolveForecast({
      budget,
      actual,
      payloadForecast: payload.forecast,
    }),
  };

  return prisma.costRecord.update({ where: { id: costRecordId }, data });
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
    byDate.set(key, (byDate.get(key) || 0) + (Number(entry.amount) || 0));
  }

  const durationDays = toProjectDurationDays(project);
  const budgetRate =
    durationDays > 0 ? (Number(project.contractValue) || 0) / durationDays : 0;

  const data = Array.from(byDate.entries()).map(([date, actual]) => ({
    date,
    actual,
    budget: budgetRate,
  }));

  return { budgetRate, data };
};

const addBurnRateEntry = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  return prisma.burnRateEntry.create({
    data: {
      projectId,
      date: payload.date ? new Date(payload.date) : new Date(),
      amount: Number(payload.amount) || 0,
      category: payload.category?.trim() || null,
      note: payload.note?.trim() || null,
    },
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
