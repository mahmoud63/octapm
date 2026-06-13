const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const auditService = require('./audit.service');
const { addMoney, multiplyMoney, toMoneyNumber } = require('../utils/money');

const RATE_TYPES = ['hourly', 'daily'];
const DAY_RATE_HOURS = 8;

const verifyProject = async (orgId, projectId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project)
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return project;
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeRateType = (value) => {
  const rateType = trimOrNull(value);
  return RATE_TYPES.includes(rateType) ? rateType : 'hourly';
};

const normalizeUsageDate = (value, fallback = new Date()) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const latestDate = (left, right) => {
  if (!left) return right || null;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
};

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
  actualThroughDate: toIso(record.actualThroughDate),
  forecast: toMoneyNumber(record.forecast),
});

const usageSummary = (usage) => ({
  activityId: usage.activityId,
  equipmentId: usage.equipmentId || null,
  dailyReportId: usage.dailyReportId || null,
  equipmentName: usage.equipmentName,
  hours: usage.hours,
  rateType: usage.rateType || null,
  rate: toMoneyNumber(usage.rate),
  costAmount: toMoneyNumber(usage.costAmount),
  usageDate: toIso(usage.usageDate),
  sourceLineIndex: usage.sourceLineIndex,
});

const serializeUsage = (usage) => ({
  id: usage.id,
  projectId: usage.projectId,
  activityId: usage.activityId,
  equipmentId: usage.equipmentId || null,
  dailyReportId: usage.dailyReportId || null,
  sourceLineIndex: usage.sourceLineIndex ?? null,
  equipmentName: usage.equipmentName,
  hours: Number(usage.hours || 0),
  rateType: usage.rateType || null,
  rate: toMoneyNumber(usage.rate),
  costAmount: toMoneyNumber(usage.costAmount),
  usageDate: toIso(usage.usageDate),
  status: usage.status,
  recordedBy: usage.recordedBy || null,
  approvedBy: usage.approvedBy || null,
  approvedAt: toIso(usage.approvedAt),
  notes: usage.notes || null,
  createdAt: toIso(usage.createdAt),
  activity: usage.activity
    ? {
        id: usage.activity.id,
        name: usage.activity.name,
        wbsCode: usage.activity.wbsCode,
        category: usage.activity.category,
      }
    : null,
  equipment: usage.equipment
    ? {
        id: usage.equipment.id,
        name: usage.equipment.name,
        rateType: usage.equipment.rateType,
        rate: toMoneyNumber(usage.equipment.rate),
      }
    : null,
  dailyReport: usage.dailyReport
    ? {
        id: usage.dailyReport.id,
        date: toIso(usage.dailyReport.date),
        status: usage.dailyReport.status,
      }
    : null,
});

const listEquipment = async ({ orgId, projectId }) => {
  await verifyProject(orgId, projectId);

  return prisma.equipment.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });
};

const addEquipment = async ({ orgId, projectId, payload }) => {
  await verifyProject(orgId, projectId);

  if (!RATE_TYPES.includes(payload.rateType)) {
    throw new HttpError(
      400,
      'INVALID_RATE_TYPE',
      'rateType must be "hourly" or "daily"',
    );
  }

  return prisma.equipment.create({
    data: {
      projectId,
      name: payload.name,
      rateType: payload.rateType,
      rate: toMoneyNumber(payload.rate),
    },
  });
};

const normalizeDailyReportEquipmentLines = async ({ tx, projectId, report }) => {
  const rawRows = Array.isArray(report.equipmentJson) ? report.equipmentJson : [];
  const usableRows = rawRows
    .map((row, sourceLineIndex) => {
      if (!row || typeof row !== 'object') return null;
      const equipmentId = trimOrNull(row.equipmentId || row.id);
      const equipmentName = trimOrNull(row.name || row.equipmentName);
      const hours = Math.max(0, toNumber(row.hours, 0));
      if (hours <= 0 || (!equipmentId && !equipmentName)) return null;
      return {
        sourceLineIndex,
        equipmentId,
        equipmentName,
        hours,
        row,
      };
    })
    .filter(Boolean);

  if (!usableRows.length) return [];

  const equipment = await tx.equipment.findMany({
    where: { projectId },
  });
  const byId = new Map(equipment.map((item) => [item.id, item]));
  const byName = new Map(
    equipment.map((item) => [item.name.trim().toLowerCase(), item]),
  );

  const missingIds = usableRows
    .filter((row) => row.equipmentId && !byId.has(row.equipmentId))
    .map((row) => row.equipmentId);
  if (missingIds.length) {
    const error = new HttpError(
      400,
      'EQUIPMENT_USAGE_LINK_INVALID',
      'Daily report equipment usage must reference project equipment',
    );
    error.details = { missingEquipmentIds: [...new Set(missingIds)] };
    throw error;
  }

  return usableRows.map((row) => {
    const matchedEquipment =
      (row.equipmentId && byId.get(row.equipmentId)) ||
      (row.equipmentName && byName.get(row.equipmentName.toLowerCase())) ||
      null;
    const rateType = normalizeRateType(row.row.rateType || matchedEquipment?.rateType);
    const rate = toMoneyNumber(row.row.rate ?? matchedEquipment?.rate ?? 0);
    const costAmount =
      rateType === 'daily'
        ? multiplyMoney(rate, row.hours / DAY_RATE_HOURS)
        : multiplyMoney(rate, row.hours);

    return {
      projectId,
      activityId: report.activityId,
      equipmentId: matchedEquipment?.id || null,
      dailyReportId: report.id,
      sourceLineIndex: row.sourceLineIndex,
      equipmentName: row.equipmentName || matchedEquipment?.name || 'Equipment',
      hours: row.hours,
      rateType,
      rate,
      costAmount,
      usageDate: normalizeUsageDate(report.date),
      status: 'approved',
      recordedBy: report.engineerId || null,
      notes: trimOrNull(row.row.notes),
    };
  });
};

const postEquipmentCostImpact = async ({
  tx,
  orgId,
  projectId,
  report,
  usageRows,
  actorId,
  actorRole,
}) => {
  const equipmentCost = usageRows.reduce(
    (total, usage) => addMoney(total, usage.costAmount),
    0,
  );
  if (equipmentCost <= 0) return null;

  const existing = await tx.costRecord.findFirst({
    where: { projectId, activityId: report.activityId },
  });
  const actualThroughDate = latestDate(
    existing?.actualThroughDate || null,
    normalizeUsageDate(report.date),
  );

  const nextEquipment = addMoney(existing?.equipment || 0, equipmentCost);
  const nextActual = addMoney(existing?.actual || 0, equipmentCost);
  const existingForecast = toMoneyNumber(existing?.forecast || 0);
  const existingBudget = toMoneyNumber(existing?.budget || 0);
  const nextForecast = existing
    ? Math.max(existingForecast, existingBudget, nextActual)
    : nextActual;

  const data = {
    projectId,
    activityId: report.activityId,
    labour: toMoneyNumber(existing?.labour || 0),
    material: toMoneyNumber(existing?.material || 0),
    equipment: nextEquipment,
    subcontract: toMoneyNumber(existing?.subcontract || 0),
    indirect: toMoneyNumber(existing?.indirect || 0),
    overhead: toMoneyNumber(existing?.overhead || 0),
    contingency: toMoneyNumber(existing?.contingency || 0),
    budget: toMoneyNumber(existing?.budget || 0),
    committed: toMoneyNumber(existing?.committed || 0),
    actual: nextActual,
    actualThroughDate,
    forecast: nextForecast,
  };

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
    actorId,
    actorRole,
    oldSummary: existing ? costRecordSummary(existing) : null,
    newSummary: costRecordSummary(record),
    summary: {
      transition: 'daily_report.equipment_cost_post',
      activityId: report.activityId,
      dailyReportId: report.id,
      equipmentCost,
      equipmentUsageCount: usageRows.length,
      actualThroughDate: toIso(actualThroughDate),
    },
    metadata: { source: 'daily_report.equipment_usage' },
  });

  return record;
};

const postDailyReportEquipmentUsage = async ({
  tx = prisma,
  orgId,
  projectId,
  report,
  actorId = null,
  actorRole = null,
}) => {
  const existingUsages = await tx.activityEquipmentUsage.findMany({
    where: { projectId, dailyReportId: report.id },
  });
  if (existingUsages.length) {
    return {
      posted: false,
      usages: existingUsages.map(serializeUsage),
      equipmentCost: existingUsages.reduce(
        (total, usage) => addMoney(total, usage.costAmount),
        0,
      ),
      costRecord: null,
    };
  }

  const usageRows = await normalizeDailyReportEquipmentLines({
    tx,
    projectId,
    report,
  });
  if (!usageRows.length) {
    return { posted: false, usages: [], equipmentCost: 0, costRecord: null };
  }

  const approvedAt = report.reviewedAt || new Date();
  const usages = [];
  for (const usageRow of usageRows) {
    const usage = await tx.activityEquipmentUsage.create({
      data: {
        ...usageRow,
        approvedBy: actorId || null,
        approvedAt,
      },
    });
    usages.push(usage);

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.ACTIVITY_EQUIPMENT_USAGE,
      entityId: usage.id,
      action: auditService.ACTIONS.CREATED,
      actorId,
      actorRole,
      newStatus: usage.status,
      newSummary: usageSummary(usage),
      summary: {
        transition: 'daily_report.equipment_usage.post',
        activityId: usage.activityId,
        dailyReportId: usage.dailyReportId,
        sourceLineIndex: usage.sourceLineIndex,
      },
      metadata: { source: 'daily_report.approval' },
    });
  }

  const equipmentCost = usages.reduce(
    (total, usage) => addMoney(total, usage.costAmount),
    0,
  );
  const costRecord = await postEquipmentCostImpact({
    tx,
    orgId,
    projectId,
    report,
    usageRows: usages,
    actorId,
    actorRole,
  });

  return {
    posted: true,
    usages: usages.map(serializeUsage),
    equipmentCost,
    costRecord,
  };
};

const buildUtilizationReport = (rows) => {
  const byActivity = new Map();
  const byEquipment = new Map();
  let totalHours = 0;
  let totalCost = 0;
  let unpricedHours = 0;

  for (const usage of rows) {
    const serialized = serializeUsage(usage);
    totalHours += serialized.hours;
    totalCost = addMoney(totalCost, serialized.costAmount);
    if (serialized.costAmount <= 0) unpricedHours += serialized.hours;

    const activityKey = serialized.activityId;
    if (!byActivity.has(activityKey)) {
      byActivity.set(activityKey, {
        activityId: serialized.activityId,
        activityName: serialized.activity?.name || 'Activity',
        wbsCode: serialized.activity?.wbsCode || null,
        category: serialized.activity?.category || null,
        hours: 0,
        costAmount: 0,
        usageCount: 0,
        equipment: [],
      });
    }
    const activity = byActivity.get(activityKey);
    activity.hours += serialized.hours;
    activity.costAmount = addMoney(activity.costAmount, serialized.costAmount);
    activity.usageCount += 1;
    activity.equipment.push({
      equipmentId: serialized.equipmentId,
      equipmentName: serialized.equipmentName,
      hours: serialized.hours,
      costAmount: serialized.costAmount,
      dailyReportId: serialized.dailyReportId,
      usageDate: serialized.usageDate,
    });

    const equipmentKey =
      serialized.equipmentId || `name:${serialized.equipmentName.toLowerCase()}`;
    if (!byEquipment.has(equipmentKey)) {
      byEquipment.set(equipmentKey, {
        equipmentId: serialized.equipmentId,
        equipmentName: serialized.equipmentName,
        rateType: serialized.rateType,
        rate: serialized.rate,
        hours: 0,
        costAmount: 0,
        usageCount: 0,
        activities: [],
      });
    }
    const equipment = byEquipment.get(equipmentKey);
    equipment.hours += serialized.hours;
    equipment.costAmount = addMoney(equipment.costAmount, serialized.costAmount);
    equipment.usageCount += 1;
    equipment.activities.push({
      activityId: serialized.activityId,
      activityName: serialized.activity?.name || 'Activity',
      wbsCode: serialized.activity?.wbsCode || null,
      hours: serialized.hours,
      costAmount: serialized.costAmount,
      dailyReportId: serialized.dailyReportId,
      usageDate: serialized.usageDate,
    });
  }

  return {
    totals: {
      hours: totalHours,
      costAmount: totalCost,
      unpricedHours,
      pricedHours: totalHours - unpricedHours,
      usageCount: rows.length,
      activityCount: byActivity.size,
      equipmentCount: byEquipment.size,
    },
    byActivity: Array.from(byActivity.values()).sort(
      (a, b) => b.costAmount - a.costAmount,
    ),
    byEquipment: Array.from(byEquipment.values()).sort(
      (a, b) => b.costAmount - a.costAmount,
    ),
    recentUsage: rows.slice(0, 25).map(serializeUsage),
  };
};

const getEquipmentUtilization = async ({
  orgId,
  projectId,
  activityId = null,
  equipmentId = null,
  from = null,
  to = null,
}) => {
  await verifyProject(orgId, projectId);

  const where = { projectId, status: 'approved' };
  if (activityId) where.activityId = activityId;
  if (equipmentId) where.equipmentId = equipmentId;
  if (from || to) {
    where.usageDate = {};
    if (from) where.usageDate.gte = normalizeUsageDate(from);
    if (to) where.usageDate.lte = normalizeUsageDate(to);
  }

  const rows = await prisma.activityEquipmentUsage.findMany({
    where,
    include: {
      activity: {
        select: {
          id: true,
          name: true,
          wbsCode: true,
          category: true,
        },
      },
      equipment: {
        select: {
          id: true,
          name: true,
          rateType: true,
          rate: true,
        },
      },
      dailyReport: {
        select: {
          id: true,
          date: true,
          status: true,
        },
      },
    },
    orderBy: [{ usageDate: 'desc' }, { createdAt: 'desc' }],
  });

  return buildUtilizationReport(rows);
};

const updateEquipment = async ({ orgId, projectId, equipmentId, payload }) => {
  await verifyProject(orgId, projectId);

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, projectId },
  });
  if (!equipment)
    throw new HttpError(404, 'EQUIPMENT_NOT_FOUND', 'Equipment not found');

  const data = {};
  if (payload.name !== undefined) data.name = payload.name;
  if (payload.rateType !== undefined) {
    if (!RATE_TYPES.includes(payload.rateType)) {
      throw new HttpError(
        400,
        'INVALID_RATE_TYPE',
        'rateType must be "hourly" or "daily"',
      );
    }
    data.rateType = payload.rateType;
  }
  if (payload.rate !== undefined) data.rate = toMoneyNumber(payload.rate);

  return prisma.equipment.update({ where: { id: equipmentId }, data });
};

const deleteEquipment = async ({ orgId, projectId, equipmentId }) => {
  await verifyProject(orgId, projectId);

  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, projectId },
  });
  if (!equipment)
    throw new HttpError(404, 'EQUIPMENT_NOT_FOUND', 'Equipment not found');

  await prisma.equipment.delete({ where: { id: equipmentId } });
  return { deleted: true };
};

module.exports = {
  listEquipment,
  addEquipment,
  getEquipmentUtilization,
  postDailyReportEquipmentUsage,
  updateEquipment,
  deleteEquipment,
};
