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


/**
 * What the procurement package already knows.
 *
 * A long-lead item and a procurement package carried the same six facts with
 * nothing joining them, so the planner and the buyer maintained the dates and
 * statuses separately and the register could not see what had actually been
 * ordered. Where the link exists these are read from the package, its orders
 * and its deliveries rather than typed a second time
 * (OCTA-PROC-LONGLEAD-083).
 *
 * Where it does not, nothing changes: an item registered before anything is
 * ordered is the planner's own, and stays hand-maintained.
 */
const DERIVED_FIELDS = Object.freeze([
  'status',
  'warehouseStatus',
  'expectedDeliveryDate',
  'deliveredAt',
  'orderBy',
  'supplier',
]);

/** Ordered state, from the orders raised under the package. */
const orderedStateOf = (orders) => {
  if (!orders.length) return 'not_ordered';
  const live = orders.filter((order) => order.status !== 'cancelled');
  if (!live.length) return 'not_ordered';
  if (live.every((order) => ['received', 'closed'].includes(order.status))) return 'delivered';
  if (live.some((order) => ['issued', 'acknowledged', 'partial', 'received', 'closed'].includes(order.status))) {
    return 'ordered';
  }
  return 'not_ordered';
};

/** Delivered state, from what the warehouse actually has. */
const warehouseStateOf = (orders) => {
  if (!orders.length) return 'not_received';
  const states = orders.map((order) => order.warehouseStatus || 'not_received');
  if (states.every((state) => state === 'issued')) return 'issued';
  if (states.every((state) => ['received', 'issued'].includes(state))) return 'received';
  if (states.some((state) => state !== 'not_received')) return 'partial';
  return 'not_received';
};

const deriveFromPackage = (row) => {
  const pkg = row.procurementPackage;
  if (!pkg) return { ...row, procurementLinked: false, derivedFields: [] };

  const orders = pkg.orders || [];
  const receipts = pkg.deliveryReceipts || [];
  const status = orderedStateOf(orders);
  const warehouseStatus = warehouseStateOf(orders);
  const latestReceipt = receipts
    .map((receipt) => receipt.receivedAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;

  return {
    ...row,
    procurementLinked: true,
    // The package is the source; the register shows what it says.
    status,
    warehouseStatus,
    expectedDeliveryDate: pkg.requiredOnSiteDate ?? row.expectedDeliveryDate,
    orderBy: pkg.latestOrderDate ? new Date(pkg.latestOrderDate).toISOString().slice(0, 10) : row.orderBy,
    deliveredAt: warehouseStatus === 'not_received' ? null : latestReceipt,
    supplier: pkg.supplier?.name ?? row.supplier,
    derivedFields: DERIVED_FIELDS,
    procurementPackage: {
      id: pkg.id,
      packageNumber: pkg.packageNumber,
      title: pkg.title,
      status: pkg.status,
      requiredOnSiteDate: pkg.requiredOnSiteDate,
      latestOrderDate: pkg.latestOrderDate,
      orderCount: orders.length,
      receiptCount: receipts.length,
    },
  };
};

const PACKAGE_INCLUDE = {
  select: {
    id: true,
    packageNumber: true,
    title: true,
    status: true,
    requiredOnSiteDate: true,
    latestOrderDate: true,
    supplier: { select: { name: true } },
    orders: { select: { id: true, status: true, warehouseStatus: true } },
    deliveryReceipts: { select: { id: true, receivedAt: true } },
  },
};

/**
 * A field the package owns cannot also be typed here.
 *
 * Refused rather than quietly ignored: a planner who edits a status and sees it
 * snap back has learned nothing about why.
 */
const assertNotDerived = (payload, linked) => {
  if (!linked) return;
  const attempted = DERIVED_FIELDS.filter((field) => payload[field] !== undefined);
  if (!attempted.length) return;
  const error = new HttpError(
    409,
    'LONG_LEAD_FIELD_DERIVED',
    `This item is linked to a procurement package, so ${attempted.join(', ')} ${attempted.length === 1 ? 'comes' : 'come'} from the package, its orders and its deliveries. Change it there, or unlink the item to maintain it by hand.`,
  );
  error.details = { derivedFields: DERIVED_FIELDS, attempted };
  throw error;
};

/** The package a long-lead item may be attached to, on this project only. */
const ensurePackageLink = async ({ projectId, procurementPackageId }) => {
  if (!procurementPackageId) return null;
  const pkg = await prisma.procurementPackage.findFirst({
    where: { id: procurementPackageId, projectId },
    select: { id: true },
  });
  if (!pkg) {
    throw new HttpError(
      404,
      'PROCUREMENT_PACKAGE_NOT_FOUND',
      "That procurement package is not on this project",
    );
  }
  return pkg.id;
};

const listLongLeadItems = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });

  const rows = await prisma.longLeadItem.findMany({
    where: { projectId },
    include: {
      activity: { select: ACTIVITY_SELECT },
      procurementPackage: PACKAGE_INCLUDE,
    },
    orderBy: [{ leadWeeks: 'desc' }, { createdAt: 'asc' }],
  });

  return enrichRows(rows.map(deriveFromPackage), project);
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
  const procurementPackageId = await ensurePackageLink({
    projectId,
    procurementPackageId: payload.procurementPackageId,
  });
  assertNotDerived(payload, Boolean(procurementPackageId));

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
      procurementPackageId,
    },
    include: {
      activity: { select: ACTIVITY_SELECT },
      procurementPackage: PACKAGE_INCLUDE,
    },
  });

  return enrichProcurementRow(deriveFromPackage(row), { project });
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

  // Linking, unlinking, or leaving it as it was.
  const nextPackageId =
    payload.procurementPackageId === undefined
      ? existing.procurementPackageId
      : await ensurePackageLink({
          projectId,
          procurementPackageId: payload.procurementPackageId,
        });
  assertNotDerived(payload, Boolean(nextPackageId));

  const data = normalizeRowForWrite(payload, existing);
  if (payload.procurementPackageId !== undefined) {
    data.procurementPackageId = nextPackageId;
  }

  const row = await prisma.longLeadItem.update({
    where: { id: itemId },
    data,
    include: {
      activity: { select: ACTIVITY_SELECT },
      procurementPackage: PACKAGE_INCLUDE,
    },
  });

  return enrichProcurementRow(deriveFromPackage(row), { project });
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
