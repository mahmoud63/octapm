const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  enrichProcurementRow,
} = require('./procurement-risk.service');

const ACTIVITY_SELECT = {
  id: true,
  name: true,
  wbsCode: true,
  startDate: true,
  endDate: true,
  earlyStart: true,
  earlyFinish: true,
  baselineStart: true,
  baselineFinish: true,
  lateStart: true,
  lateFinish: true,
  isCritical: true,
  totalFloat: true,
};

const VALID_REQUIRED_TIMINGS = new Set(['activity_start', 'activity_finish']);
const VALID_WAREHOUSE_STATUSES = new Set([
  'not_received',
  'partial',
  'received',
  'issued',
]);

function normalizePositiveInt(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function parseNullableDate(value) {
  if (value === null || value === '') return null;
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', 'Invalid procurement date');
  }
  return date;
}

function isScheduleCritical({ criticality, leadWeeks }) {
  const level = String(criticality || '').trim().toLowerCase();
  return ['critical', 'high'].includes(level) || normalizePositiveInt(leadWeeks) >= 12;
}

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const ensureActivityLink = async ({ projectId, activityId }) => {
  if (!activityId) return null;

  const activity = await prisma.activity.findFirst({
    where: { id: activityId, projectId, isActive: true },
    select: ACTIVITY_SELECT,
  });

  if (!activity) {
    throw new HttpError(
      400,
      'INVALID_ACTIVITY_LINK',
      'Linked activity must belong to the project active schedule',
    );
  }

  return activity;
};

function assertCriticalActivityLink({ activityId, criticality, leadWeeks }) {
  if (!activityId && isScheduleCritical({ criticality, leadWeeks })) {
    throw new HttpError(
      400,
      'PROCUREMENT_ACTIVITY_REQUIRED',
      'Schedule-critical procurement items must link to an activity',
    );
  }
}

function normalizeTiming(value, fallback = 'activity_start') {
  if (value === undefined) return fallback;
  return VALID_REQUIRED_TIMINGS.has(value) ? value : fallback;
}

function normalizeWarehouseStatus(value, fallback = 'not_received') {
  if (value === undefined) return fallback;
  return VALID_WAREHOUSE_STATUSES.has(value) ? value : fallback;
}

function shouldStampDeliveredAt({ status, warehouseStatus }) {
  return (
    status === 'delivered' ||
    warehouseStatus === 'partial' ||
    warehouseStatus === 'received' ||
    warehouseStatus === 'issued'
  );
}

function normalizeRowForWrite(payload, existing = {}) {
  const data = {};

  if (payload.item !== undefined) data.item = payload.item;
  if (payload.activityId !== undefined) {
    data.activityId = payload.activityId || null;
  }
  if (payload.leadWeeks !== undefined) {
    data.leadWeeks = normalizePositiveInt(payload.leadWeeks);
  }
  if (payload.requiredTiming !== undefined) {
    data.requiredTiming = normalizeTiming(
      payload.requiredTiming,
      existing.requiredTiming || 'activity_start',
    );
  }
  if (payload.needOffsetDays !== undefined) {
    data.needOffsetDays = normalizePositiveInt(payload.needOffsetDays);
  }
  if (payload.bufferDays !== undefined) {
    data.bufferDays = normalizePositiveInt(payload.bufferDays, 14);
  }
  if (payload.orderBy !== undefined) {
    data.orderBy = payload.orderBy?.trim() || null;
  }
  if (payload.expectedDeliveryDate !== undefined) {
    data.expectedDeliveryDate = parseNullableDate(payload.expectedDeliveryDate);
  }
  if (payload.deliveredAt !== undefined) {
    data.deliveredAt = parseNullableDate(payload.deliveredAt);
  }
  if (payload.warehouseStatus !== undefined) {
    data.warehouseStatus = normalizeWarehouseStatus(
      payload.warehouseStatus,
      existing.warehouseStatus || 'not_received',
    );
  }
  if (payload.criticality !== undefined) {
    data.criticality = payload.criticality?.trim() || null;
  }
  if (payload.risk !== undefined) data.risk = payload.risk?.trim() || null;
  if (payload.status !== undefined) data.status = payload.status;
  if (payload.supplier !== undefined) {
    data.supplier = payload.supplier?.trim() || null;
  }

  const nextStatus = data.status ?? existing.status ?? 'not_ordered';
  const nextWarehouseStatus =
    data.warehouseStatus ?? existing.warehouseStatus ?? 'not_received';
  if (
    data.deliveredAt === undefined &&
    !existing.deliveredAt &&
    shouldStampDeliveredAt({
      status: nextStatus,
      warehouseStatus: nextWarehouseStatus,
    })
  ) {
    data.deliveredAt = new Date();
  }

  if (
    ['partial', 'received', 'issued'].includes(nextWarehouseStatus) &&
    nextStatus !== 'delivered'
  ) {
    data.status = 'delivered';
  }

  return data;
}

function enrichRows(rows, project) {
  return rows.map((row) => enrichProcurementRow(row, { project }));
}

const listLongLeadItems = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });

  const rows = await prisma.longLeadItem.findMany({
    where: { projectId },
    include: {
      activity: { select: ACTIVITY_SELECT },
    },
    orderBy: [{ leadWeeks: 'desc' }, { createdAt: 'asc' }],
  });

  return enrichRows(rows, project);
};

const createLongLeadItem = async ({ orgId, projectId, payload }) => {
  const project = await ensureProject({ orgId, projectId });
  const activityId = payload.activityId || null;

  assertCriticalActivityLink({
    activityId,
    criticality: payload.criticality,
    leadWeeks: payload.leadWeeks,
  });
  await ensureActivityLink({ projectId, activityId });

  const data = normalizeRowForWrite(payload, {
    requiredTiming: 'activity_start',
    needOffsetDays: 0,
    bufferDays: 14,
    warehouseStatus: 'not_received',
    status: 'not_ordered',
  });

  const row = await prisma.longLeadItem.create({
    data: {
      projectId,
      item: payload.item,
      leadWeeks: normalizePositiveInt(payload.leadWeeks),
      requiredTiming: 'activity_start',
      needOffsetDays: 0,
      bufferDays: 14,
      warehouseStatus: 'not_received',
      status: 'not_ordered',
      ...data,
      activityId,
    },
    include: {
      activity: { select: ACTIVITY_SELECT },
    },
  });

  return enrichProcurementRow(row, { project });
};

const updateLongLeadItem = async ({ orgId, projectId, itemId, payload }) => {
  const project = await ensureProject({ orgId, projectId });

  const existing = await prisma.longLeadItem.findFirst({
    where: { id: itemId, projectId },
  });
  if (!existing) {
    throw new HttpError(404, 'LONG_LEAD_NOT_FOUND', 'Long lead item not found');
  }

  const nextActivityId =
    payload.activityId === undefined
      ? existing.activityId
      : payload.activityId || null;
  const nextCriticality =
    payload.criticality === undefined
      ? existing.criticality
      : payload.criticality;
  const nextLeadWeeks =
    payload.leadWeeks === undefined ? existing.leadWeeks : payload.leadWeeks;

  assertCriticalActivityLink({
    activityId: nextActivityId,
    criticality: nextCriticality,
    leadWeeks: nextLeadWeeks,
  });
  await ensureActivityLink({ projectId, activityId: nextActivityId });

  const data = normalizeRowForWrite(payload, existing);

  const row = await prisma.longLeadItem.update({
    where: { id: itemId },
    data,
    include: {
      activity: { select: ACTIVITY_SELECT },
    },
  });

  return enrichProcurementRow(row, { project });
};

const deleteLongLeadItem = async ({ orgId, projectId, itemId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.longLeadItem.findFirst({
    where: { id: itemId, projectId },
  });
  if (!existing) {
    throw new HttpError(404, 'LONG_LEAD_NOT_FOUND', 'Long lead item not found');
  }

  await prisma.longLeadItem.delete({ where: { id: itemId } });
  return { deleted: true };
};

module.exports = {
  listLongLeadItems,
  createLongLeadItem,
  updateLongLeadItem,
  deleteLongLeadItem,
};
