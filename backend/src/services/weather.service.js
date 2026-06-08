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

const toMonth = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 7);
};

const listWeatherDelays = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });

  const rows = await prisma.weatherDelay.findMany({
    where: { projectId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  const allowance = Number(project.weatherAllowanceDays) || 20;
  const contractualUsed = rows.reduce((sum, row) => {
    if (!row.contractual) return sum;
    return sum + (Number(row.delayDays) || 0);
  }, 0);

  const consumedPct = allowance > 0 ? (contractualUsed / allowance) * 100 : 0;

  const monthlyMap = new Map();
  for (const row of rows) {
    const month = toMonth(row.date) || row.monthKey || 'unknown';
    const current = monthlyMap.get(month) || {
      month,
      contractual: 0,
      nonContractual: 0,
    };

    if (row.contractual) {
      current.contractual += Number(row.delayDays) || 0;
    } else {
      current.nonContractual += Number(row.delayDays) || 0;
    }

    monthlyMap.set(month, current);
  }

  return {
    rows,
    summary: {
      allowance,
      contractualUsed,
      remaining: Math.max(allowance - contractualUsed, 0),
      consumedPct,
      warning: consumedPct >= 70,
    },
    monthly: Array.from(monthlyMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    ),
  };
};

const createWeatherDelay = async ({ orgId, projectId, payload }) => {
  await ensureProject({ orgId, projectId });

  return prisma.weatherDelay.create({
    data: {
      projectId,
      date: payload.date ? new Date(payload.date) : new Date(),
      description: payload.description,
      delayDays: Number(payload.delayDays) || 0,
      contractual:
        payload.contractual !== undefined ? Boolean(payload.contractual) : true,
      monthKey: payload.monthKey || toMonth(payload.date || new Date()),
    },
  });
};

const updateWeatherDelay = async ({ orgId, projectId, weatherId, payload }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.weatherDelay.findFirst({
    where: { id: weatherId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'WEATHER_DELAY_NOT_FOUND',
      'Weather delay not found',
    );
  }

  const nextDate =
    payload.date !== undefined
      ? payload.date
        ? new Date(payload.date)
        : null
      : existing.date;

  return prisma.weatherDelay.update({
    where: { id: weatherId },
    data: {
      date: nextDate,
      description: payload.description ?? existing.description,
      delayDays:
        payload.delayDays !== undefined
          ? Number(payload.delayDays) || 0
          : existing.delayDays,
      contractual:
        payload.contractual !== undefined
          ? Boolean(payload.contractual)
          : existing.contractual,
      monthKey:
        payload.monthKey !== undefined
          ? payload.monthKey || null
          : toMonth(nextDate) || existing.monthKey,
    },
  });
};

const deleteWeatherDelay = async ({ orgId, projectId, weatherId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.weatherDelay.findFirst({
    where: { id: weatherId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      'WEATHER_DELAY_NOT_FOUND',
      'Weather delay not found',
    );
  }

  await prisma.weatherDelay.delete({ where: { id: weatherId } });
  return { deleted: true };
};

module.exports = {
  listWeatherDelays,
  createWeatherDelay,
  updateWeatherDelay,
  deleteWeatherDelay,
};
