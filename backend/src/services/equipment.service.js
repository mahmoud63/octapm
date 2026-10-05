const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const auditService = require('./audit.service');
const { MONEY_MAX, addMoney, multiplyMoney, toMoneyDecimal, toMoneyNumber } = require('../utils/money');
const { defaultForecastOnCreate } = require('./cost-record-default.service');

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
  forecastSource: record.forecastSource ?? null,
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

/**
 * Adds project equipment, optionally from the company equipment list
 * (OCTA-ADM-COMPANY-007): the master supplies name/rate defaults and the
 * project row keeps a link so utilisation can roll up per master.
 */
const addEquipment = async ({ orgId, projectId, payload }) => {
  await verifyProject(orgId, projectId);

  let master = null;
  if (payload.companyEquipmentId) {
    master = await prisma.companyEquipment.findFirst({
      where: { id: payload.companyEquipmentId, orgId },
    });
    if (!master) {
      throw new HttpError(
        404,
        'COMPANY_EQUIPMENT_NOT_FOUND',
        'Company equipment not found',
      );
    }
  }

  const rateType = payload.rateType || master?.rateType;
  if (!RATE_TYPES.includes(rateType)) {
    throw new HttpError(
      400,
      'INVALID_RATE_TYPE',
      'rateType must be "hourly" or "daily"',
    );
  }
  const name = trimOrNull(payload.name) || master?.name || null;
  if (!name) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Equipment name is required');
  }

  return prisma.equipment.create({
    data: {
      projectId,
      companyEquipmentId: master?.id || null,
      name,
      rateType,
      rate:
        payload.rate !== undefined && payload.rate !== null
          ? toMoneyNumber(payload.rate)
          : toMoneyNumber(master?.rate ?? 0),
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

const costLedger = require('./cost-ledger.service');

const postEquipmentCostImpact = async ({
  tx,
  orgId,
  projectId,
  report,
  usageRows,
  actorId,
  actorRole,
}) => {
  // Added up as an exact decimal (CERT-2, round 6).
  const equipmentCost = usageRows.reduce(
    (total, usage) => total.plus(toMoneyDecimal(usage.costAmount || 0)),
    toMoneyDecimal(0),
  );
  if (!equipmentCost.greaterThan(0)) return null;

  // Through the cost ledger (OCTA-FIN-LEDGER-059): one entry per report, so
  // approving a report twice posts once, the activity's actual is incremented
  // rather than overwritten under a concurrent posting, and the equipment
  // charge reconciles like every other source (Phase 21D, CX21-418).
  const posting = await costLedger.post({
    tx,
    orgId,
    projectId,
    sourceType: 'equipment',
    sourceId: report.id,
    // The ledger checks and posts the amount as it takes it; the category
    // below moves by exactly what it posted.
    amount: toMoneyNumber(equipmentCost),
    costType: 'equipment',
    activityId: report.activityId,
    incurredOn: normalizeUsageDate(report.date),
    postedBy: actorId,
    note: 'Equipment usage from the daily report',
  });

  // The ledger has already created or advanced the activity's record; what is
  // left is the equipment category. The forecast is not this posting's: an
  // equipment charge is actual cost arriving, and under owner decision R5-2 it
  // never writes the record's forecast or forecastSource (it used to raise the
  // forecast to max(forecast, budget, actual) — over an entered one too).
  const existing = await tx.costRecord.findFirst({
    where: { projectId, activityId: report.activityId },
  });
  const actualThroughDate = latestDate(
    existing?.actualThroughDate || null,
    normalizeUsageDate(report.date),
  );
  // The category moves by exactly what the ledger posted, as an exact
  // decimal, and must fit its Decimal(18,2) column (CERT-2, round 6). It was
  // added up in floating point and written unchecked — the ledger checks the
  // activity's actual, not its equipment category, which the cost register
  // can set on its own: an equipment category at 9.9e15 and a day's
  // equipment of 2e14 failed the daily report's approval at the write
  // (numeric field overflow), and 9.8e15 with 199,999,999,999,999 more — which
  // fits — failed there too, as a float sum of 10^16. The
  // other categories are left as they are, no longer written back through a
  // float (which loses cents past 2^53 / 100, and reads 9,999,999,999,999,999.99
  // as 10^16).
  const postedAmount = posting.posted ? toMoneyDecimal(posting.entry?.amount ?? equipmentCost) : toMoneyDecimal(0);
  const nextEquipment = toMoneyDecimal(existing?.equipment || 0).plus(postedAmount);
  if (nextEquipment.abs().greaterThan(MONEY_MAX)) {
    throw new HttpError(
      400,
      'COST_LEDGER_TOTAL_TOO_LARGE',
      "This equipment cost would take the activity's equipment cost past what it can record",
      { projection: 'activity_equipment' },
    );
  }

  const data = { equipment: nextEquipment, actualThroughDate };

  // Created here only if the ledger made none: no forecast supplied, so the
  // initial default, marked 'default' (R5-2) — from the activity's approved
  // allocation, as every creator reads it.
  const record = existing
    ? await tx.costRecord.update({ where: { id: existing.id }, data })
    : await tx.costRecord.create({
        data: {
          projectId,
          activityId: report.activityId,
          ...Object.fromEntries(['labour', 'material', 'subcontract', 'indirect', 'overhead', 'contingency', 'budget', 'committed'].map((key) => [key, 0])),
          ...data,
          actual: 0,
          ...(await defaultForecastOnCreate({ tx, projectId, activityId: report.activityId, actual: 0 })),
        },
      });

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
      equipmentCost: toMoneyNumber(equipmentCost),
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
