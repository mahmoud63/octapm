const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  ACTIONS,
  ENTITY_TYPES,
  recordEvent,
} = require('./audit.service');
const {
  calculateNeedDate,
  calculateOrderByDate,
  computeProcurementRisk,
} = require('./procurement-risk.service');
const { toMoneyDecimal, toMoneyNumber } = require('../utils/money');

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

const ORDER_INCLUDE = {
  supplierRef: true,
  package: true,
  lines: {
    include: {
      activity: { select: ACTIVITY_SELECT },
      activityMaterial: true,
      supplier: true,
    },
    orderBy: { lineNumber: 'asc' },
  },
  deliveryReceipts: {
    include: { lines: true },
    orderBy: { receivedAt: 'desc' },
  },
};

const VALID_REQUIRED_TIMINGS = new Set(['activity_start', 'activity_finish']);
const ALERT_STATUSES = new Set(['open', 'acknowledged', 'resolved']);

const isBlank = (value) =>
  value === undefined || value === null || value === '';

const trimOrNull = (value) => {
  if (isBlank(value)) return null;
  const text = String(value).trim();
  return text || null;
};

const lower = (value) => String(value || '').trim().toLowerCase();

const asInt = (value, fallback = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
};

const asNonNegative = (value, fallback = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, number);
};

const asPositive = (field, value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be positive`);
  }
  return number;
};

const parseNullableDate = (value, field = 'date') => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', `${field} must be a valid date`);
  }
  return date;
};

const lineValue = (line) =>
  toMoneyNumber(toMoneyDecimal(line.unitCost || 0).times(line.orderedQty || 0));

const serializeDate = (value) =>
  value instanceof Date ? value.toISOString() : value || null;

const ensureProject = async ({ tx = prisma, orgId, projectId }) => {
  const project = await tx.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const ensureActivity = async ({ tx = prisma, projectId, activityId }) => {
  if (!activityId) {
    throw new HttpError(
      400,
      'PROCUREMENT_ACTIVITY_REQUIRED',
      'Every procurement PO line, receipt line, and usage row must link to an activity',
    );
  }

  const activity = await tx.activity.findFirst({
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

const ensureDailyReport = async ({
  tx = prisma,
  projectId,
  dailyReportId,
  activityId = null,
}) => {
  if (!dailyReportId) return null;

  const report = await tx.dailyReport.findFirst({
    where: {
      id: dailyReportId,
      projectId,
      ...(activityId ? { activityId } : {}),
    },
    select: {
      id: true,
      activityId: true,
      date: true,
      status: true,
    },
  });

  if (!report) {
    throw new HttpError(
      400,
      'DAILY_REPORT_LINK_INVALID',
      activityId
        ? 'Daily report must belong to the same project activity'
        : 'Daily report must belong to the project',
    );
  }

  return report;
};

const ensureSupplier = async ({ tx = prisma, projectId, supplierId }) => {
  if (!supplierId) return null;
  const supplier = await tx.procurementSupplier.findFirst({
    where: { id: supplierId, projectId },
  });
  if (!supplier) {
    throw new HttpError(400, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  }
  return supplier;
};

const ensurePackage = async ({ tx = prisma, projectId, packageId }) => {
  if (!packageId) return null;
  const row = await tx.procurementPackage.findFirst({
    where: { id: packageId, projectId },
  });
  if (!row) {
    throw new HttpError(
      400,
      'PROCUREMENT_PACKAGE_NOT_FOUND',
      'Procurement package not found',
    );
  }
  return row;
};

const ensureMaterialRequirement = async ({
  tx = prisma,
  projectId,
  activityId = null,
  materialId,
}) => {
  if (!materialId) return null;
  const where = { id: materialId, projectId };
  if (activityId) where.activityId = activityId;
  const material = await tx.activityMaterial.findFirst({ where });
  if (!material) {
    throw new HttpError(404, 'MATERIAL_NOT_FOUND', 'Material not found');
  }
  return material;
};

const ensureOrder = async ({ tx = prisma, projectId, orderId }) => {
  const order = await tx.procurementOrder.findFirst({
    where: { id: orderId, projectId },
  });
  if (!order) {
    throw new HttpError(
      404,
      'PROCUREMENT_ORDER_NOT_FOUND',
      'Procurement order not found',
    );
  }
  return order;
};

const ensurePoLine = async ({ tx = prisma, projectId, orderId, poLineId }) => {
  const line = await tx.procurementPoLine.findFirst({
    where: { id: poLineId, projectId, ...(orderId ? { orderId } : {}) },
    include: {
      activity: { select: ACTIVITY_SELECT },
      activityMaterial: true,
    },
  });

  if (!line) {
    throw new HttpError(404, 'PO_LINE_NOT_FOUND', 'PO line not found');
  }

  return line;
};

const ensureReceiptLine = async ({
  tx = prisma,
  projectId,
  receiptLineId,
  materialId = null,
}) => {
  if (!receiptLineId) return null;
  const where = { id: receiptLineId, projectId };
  if (materialId) where.activityMaterialId = materialId;
  const line = await tx.deliveryReceiptLine.findFirst({ where });
  if (!line) {
    throw new HttpError(
      404,
      'RECEIPT_LINE_NOT_FOUND',
      'Delivery receipt line not found for this material',
    );
  }
  return line;
};

const recordAudit = async ({
  tx,
  orgId,
  projectId,
  entityType,
  entityId,
  action,
  actor,
  oldStatus = null,
  newStatus = null,
  reason = null,
  summary = {},
  metadata = {},
}) => {
  if (!tx.auditEvent?.create) return null;
  return recordEvent({
    tx,
    orgId,
    projectId,
    entityType,
    entityId,
    action,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    oldStatus,
    newStatus,
    reason,
    summary,
    metadata,
  });
};

const buildLineRiskRow = (line) => {
  const orderedQty = Number(line.orderedQty || 0);
  const receivedQty = Number(line.receivedQty || 0);
  const issuedQty = Number(line.issuedQty || 0);
  const warehouseStatus =
    issuedQty >= orderedQty && orderedQty > 0
      ? 'issued'
      : receivedQty >= orderedQty && orderedQty > 0
        ? 'received'
        : receivedQty > 0 || issuedQty > 0
          ? 'partial'
          : 'not_received';

  return {
    id: line.id,
    ref: line.order?.ref || line.orderRef || null,
    activityId: line.activityId,
    activity: line.activity,
    item: line.description,
    leadWeeks: line.leadWeeks,
    requiredTiming: line.requiredTiming,
    needOffsetDays: line.needOffsetDays,
    bufferDays: line.bufferDays,
    requiredDate: line.requiredDate,
    promisedDate: line.promisedDate,
    expectedDeliveryDate: line.promisedDate,
    status: line.status,
    warehouseStatus,
  };
};

const buildMaterialRiskRow = (material) => {
  const plannedQty = Number(material.plannedQty || material.qty || 0);
  const receivedQty = Number(material.receivedQty || 0);
  const issuedQty = Number(material.issuedQty || 0);
  const warehouseStatus =
    issuedQty >= plannedQty && plannedQty > 0
      ? 'issued'
      : receivedQty >= plannedQty && plannedQty > 0
        ? 'received'
        : receivedQty > 0 || issuedQty > 0
          ? 'partial'
          : 'not_received';

  const firstOpenLine = material.poLines?.find(
    (line) => !['cancelled', 'consumed'].includes(line.status),
  );

  return {
    id: material.id,
    activityId: material.activityId,
    activity: material.activity,
    item: material.name,
    leadWeeks: material.leadWeeks,
    requiredTiming: material.requiredTiming,
    needOffsetDays: material.needOffsetDays,
    bufferDays: material.bufferDays,
    requiredDate: material.requiredDate,
    promisedDate: firstOpenLine?.promisedDate || null,
    expectedDeliveryDate: firstOpenLine?.promisedDate || null,
    status: material.status,
    warehouseStatus,
  };
};

const packageRiskStatus = (status) => {
  const normalized = lower(status);
  if (['closed'].includes(normalized)) return 'delivered';
  if (['planning', 'tendering'].includes(normalized)) return 'not_ordered';
  if (['cancelled', 'canceled'].includes(normalized)) return 'cancelled';
  return 'ordered';
};

const packageWarehouseStatus = (status) =>
  lower(status) === 'closed' ? 'received' : 'not_received';

const buildPackageRiskRow = (row) => ({
  id: row.id,
  ref: row.packageNumber,
  activityId: row.activityId,
  activity: row.activity,
  item: row.title,
  leadWeeks: row.leadWeeks,
  requiredTiming: row.requiredTiming,
  needOffsetDays: row.needOffsetDays,
  bufferDays: row.bufferDays,
  requiredDate: row.requiredOnSiteDate,
  expectedDeliveryDate: row.expectedDeliveryDate || null,
  status: packageRiskStatus(row.status),
  warehouseStatus: packageWarehouseStatus(row.status),
});

const deriveScheduleNeedDates = ({
  activity,
  project,
  explicitNeedDate = null,
  requiredTiming = 'activity_start',
  needOffsetDays = 0,
  leadWeeks = 0,
  bufferDays = 14,
}) => {
  const needDate =
    explicitNeedDate ||
    calculateNeedDate(
      {
        activity,
        requiredTiming,
        needOffsetDays,
      },
      project,
    );

  return {
    requiredOnSiteDate: needDate,
    latestOrderDate: calculateOrderByDate({
      needDate,
      leadWeeks,
      bufferDays,
    }),
  };
};

const normalizeAlertData = ({
  projectId,
  risk,
  line = null,
  material = null,
  packageRow = null,
}) => ({
  projectId,
  activityId: line?.activityId || material?.activityId || packageRow?.activityId || null,
  packageId:
    line?.packageId ||
    material?.procurementPackageId ||
    packageRow?.id ||
    null,
  orderId: line?.orderId || null,
  poLineId: line?.id || null,
  activityMaterialId: material?.id || line?.activityMaterialId || null,
  severity: risk.severity,
  reason: risk.reason,
  daysAtRisk: Math.round(risk.daysAtRisk || 0),
  needDate: risk.needDate || null,
  orderByDate: risk.orderByDate || null,
  expectedDeliveryDate: risk.expectedDeliveryDate || null,
});

const syncLeadTimeAlert = async ({
  tx = prisma,
  projectId,
  project,
  line = null,
  material = null,
  packageRow = null,
}) => {
  if (!tx.procurementLeadTimeAlert?.findFirst) return null;

  const riskRow = line
    ? buildLineRiskRow(line)
    : material
      ? buildMaterialRiskRow(material)
      : buildPackageRiskRow(packageRow);
  const risk = computeProcurementRisk(riskRow, { project });
  // The row is unique on (projectId, poLineId) AND on
  // (projectId, activityMaterialId), so a line that names a material has to be
  // looked up by the material or the second order for it collides: the lookup
  // by line finds nothing, the create then breaks the material constraint, and
  // the buyer gets a raw 500 for the ordinary act of ordering the same material
  // twice — a top-up, a split delivery, a second supplier
  // (OCTA-PROC-LEADALERT-082). One alert per material, pointing at the line
  // that most recently changed its outlook.
  const where = {
    projectId,
    ...(line
      ? line.activityMaterialId
        ? { activityMaterialId: line.activityMaterialId }
        : { poLineId: line.id }
      : material
        ? { activityMaterialId: material.id }
        : { packageId: packageRow.id }),
  };
  const existing = await tx.procurementLeadTimeAlert.findFirst({ where });

  if (risk.isAtRisk) {
    const data = normalizeAlertData({
      projectId,
      risk,
      line,
      material,
      packageRow,
    });
    if (existing) {
      return tx.procurementLeadTimeAlert.update({
        where: { id: existing.id },
        data: {
          ...data,
          status: existing.status === 'resolved' ? 'open' : existing.status,
          resolvedAt: null,
          resolvedBy: null,
        },
      });
    }

    return tx.procurementLeadTimeAlert.create({
      data: { ...data, status: 'open' },
    });
  }

  if (existing && existing.status !== 'resolved') {
    return tx.procurementLeadTimeAlert.update({
      where: { id: existing.id },
      data: {
        status: 'resolved',
        reason: risk.reason,
        severity: risk.severity,
        daysAtRisk: 0,
        needDate: risk.needDate || null,
        orderByDate: risk.orderByDate || null,
        expectedDeliveryDate: risk.expectedDeliveryDate || null,
        resolvedAt: new Date(),
      },
    });
  }

  return existing || null;
};

const enrichPoLine = (line, project) => ({
  ...line,
  procurementRisk: computeProcurementRisk(buildLineRiskRow(line), { project }),
});

const enrichPackage = (row, project) => {
  const dates = deriveScheduleNeedDates({
    activity: row.activity,
    project,
    explicitNeedDate: row.requiredOnSiteDate || null,
    requiredTiming: row.requiredTiming,
    needOffsetDays: row.needOffsetDays,
    leadWeeks: row.leadWeeks,
    bufferDays: row.bufferDays,
  });
  const source = {
    ...row,
    requiredOnSiteDate: dates.requiredOnSiteDate,
    latestOrderDate: row.latestOrderDate || dates.latestOrderDate,
  };

  return {
    ...source,
    requiredOnSiteDate: dates.requiredOnSiteDate,
    latestOrderDate: source.latestOrderDate,
    procurementRisk: computeProcurementRisk(buildPackageRiskRow(source), {
      project,
    }),
  };
};

const supplierInclude = {
  company: { select: { id: true, name: true, isVendor: true, trades: true } },
};

const listSuppliers = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });
  return prisma.procurementSupplier.findMany({
    where: { projectId },
    include: supplierInclude,
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
};

/**
 * Suppliers are project records that may point at an org-level vendor
 * (Company.isVendor, OCTA-ADM-COMPANY-007). Passing `companyId` copies the
 * vendor's details; a vendor with the same name is linked automatically.
 */
const createSupplier = async ({ orgId, projectId, actor, payload }) => {
  await ensureProject({ orgId, projectId });

  let company = null;
  if (payload.companyId) {
    company = await prisma.company.findFirst({
      where: { id: payload.companyId, orgId },
    });
    if (!company) {
      throw new HttpError(404, 'VENDOR_NOT_FOUND', 'Vendor company not found');
    }
  }

  const name = trimOrNull(payload.name) || company?.name || null;
  if (!name) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Supplier name is required');
  }

  const existing = await prisma.procurementSupplier.findFirst({
    where: { projectId, name },
    include: supplierInclude,
  });
  if (existing) return existing;

  if (!company) {
    company = await prisma.company.findFirst({
      where: { orgId, name: { equals: name, mode: 'insensitive' } },
    });
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.procurementSupplier.create({
      data: {
        projectId,
        companyId: company?.id || null,
        code: trimOrNull(payload.code),
        name,
        contactName: trimOrNull(payload.contactName) || company?.contactName || null,
        email: trimOrNull(payload.email) || company?.email || null,
        phone: trimOrNull(payload.phone) || company?.phone || null,
        address: trimOrNull(payload.address) || company?.address || null,
        tradeCategories: Array.isArray(payload.tradeCategories)
          ? payload.tradeCategories
          : company?.trades || [],
        status: payload.status || 'approved',
        leadTimeReliability: isBlank(payload.leadTimeReliability)
          ? null
          : Number(payload.leadTimeReliability),
        notes: trimOrNull(payload.notes),
        createdBy: actor?.id || null,
        updatedBy: actor?.id || null,
      },
      include: supplierInclude,
    });

    if (company && !company.isVendor && tx.company?.update) {
      await tx.company.update({
        where: { id: company.id },
        data: { isVendor: true },
      });
    }

    await recordAudit({
      tx,
      orgId,
      projectId,
      entityType: ENTITY_TYPES.PROCUREMENT_SUPPLIER,
      entityId: row.id,
      action: ACTIONS.CREATED,
      actor,
      newStatus: row.status,
      summary: { name: row.name, code: row.code },
    });

    return row;
  });
};

const listPackages = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });
  const rows = await prisma.procurementPackage.findMany({
    where: { projectId },
    include: {
      supplier: true,
      activity: { select: ACTIVITY_SELECT },
      leadTimeAlerts: {
        where: { status: { in: ['open', 'acknowledged'] } },
        orderBy: { updatedAt: 'desc' },
      },
    },
    orderBy: [{ status: 'asc' }, { packageNumber: 'asc' }],
  });

  return rows.map((row) => enrichPackage(row, project));
};

const createPackage = async ({ orgId, projectId, actor, payload }) => {
  const project = await ensureProject({ orgId, projectId });
  await ensureSupplier({ projectId, supplierId: payload.supplierId });
  let activity = null;
  if (payload.activityId) {
    activity = await ensureActivity({ projectId, activityId: payload.activityId });
  }

  const requiredTiming = VALID_REQUIRED_TIMINGS.has(payload.requiredTiming)
    ? payload.requiredTiming
    : 'activity_start';
  const needOffsetDays = asInt(payload.needOffsetDays);
  const leadWeeks = asInt(payload.leadWeeks);
  const bufferDays = asInt(payload.bufferDays, 14);
  const explicitRequiredOnSiteDate =
    parseNullableDate(payload.requiredOnSiteDate, 'requiredOnSiteDate') || null;
  const dates = deriveScheduleNeedDates({
    activity,
    project,
    explicitNeedDate: explicitRequiredOnSiteDate,
    requiredTiming,
    needOffsetDays,
    leadWeeks,
    bufferDays,
  });

  return prisma.$transaction(async (tx) => {
    const row = await tx.procurementPackage.create({
      data: {
        projectId,
        supplierId: payload.supplierId || null,
        activityId: payload.activityId || null,
        packageNumber: payload.packageNumber,
        title: payload.title,
        description: trimOrNull(payload.description),
        status: payload.status || 'planning',
        buyer: trimOrNull(payload.buyer),
        plannedAwardDate:
          parseNullableDate(payload.plannedAwardDate, 'plannedAwardDate') ||
          null,
        requiredOnSiteDate: dates.requiredOnSiteDate,
        requiredTiming,
        needOffsetDays,
        leadWeeks,
        bufferDays,
        latestOrderDate: dates.latestOrderDate,
        notes: trimOrNull(payload.notes),
        createdBy: actor?.id || null,
        updatedBy: actor?.id || null,
      },
    });

    const enrichedRow = { ...row, activity };
    await syncLeadTimeAlert({
      tx,
      projectId,
      project,
      packageRow: enrichedRow,
    });

    await recordAudit({
      tx,
      orgId,
      projectId,
      entityType: ENTITY_TYPES.PROCUREMENT_PACKAGE,
      entityId: row.id,
      action: ACTIONS.CREATED,
      actor,
      newStatus: row.status,
      summary: {
        packageNumber: row.packageNumber,
        title: row.title,
        activityId: row.activityId,
        requiredOnSiteDate: serializeDate(row.requiredOnSiteDate),
        latestOrderDate: serializeDate(row.latestOrderDate),
      },
    });

    return enrichPackage(enrichedRow, project);
  });
};

const normalizeLineInput = async ({
  tx,
  projectId,
  orderDefaults,
  line,
  index,
}) => {
  const activityId = line.activityId || orderDefaults.activityId || null;
  const activity = await ensureActivity({ tx, projectId, activityId });
  const material = await ensureMaterialRequirement({
    tx,
    projectId,
    activityId,
    materialId: line.activityMaterialId,
  });
  await ensureSupplier({ tx, projectId, supplierId: line.supplierId });
  await ensurePackage({ tx, projectId, packageId: line.packageId });

  const orderedQty = asPositive(
    `lines.${index}.orderedQty`,
    line.orderedQty,
  );
  const unitCost = toMoneyDecimal(line.unitCost || 0);

  return {
    projectId,
    orderId: orderDefaults.orderId,
    packageId: line.packageId || orderDefaults.packageId || null,
    supplierId: line.supplierId || orderDefaults.supplierId || null,
    activityId,
    // Cost coding at the moment the order is raised (OCTA-FIN-POLINE-060), so
    // the buyer codes it while they still know what it is for, instead of
    // finance guessing on the invoice weeks later.
    costCodeId: trimOrNull(line.costCodeId) || material?.costCodeId || null,
    budgetLineId: trimOrNull(line.budgetLineId) || null,
    boqItemId: trimOrNull(line.boqItemId) || material?.boqItemId || null,
    activityMaterialId: line.activityMaterialId || null,
    materialMasterId: line.materialMasterId || material?.materialMasterId || null,
    lineNumber: Number(line.lineNumber || index + 1),
    itemCode: trimOrNull(line.itemCode || material?.code),
    description: trimOrNull(line.description || material?.name),
    spec: trimOrNull(line.spec || material?.spec),
    unit: line.unit || material?.unit,
    orderedQty,
    unitCost,
    status: line.status || 'ordered',
    leadWeeks: asInt(line.leadWeeks, orderDefaults.leadWeeks),
    requiredTiming: VALID_REQUIRED_TIMINGS.has(line.requiredTiming)
      ? line.requiredTiming
      : orderDefaults.requiredTiming,
    needOffsetDays: asInt(line.needOffsetDays, orderDefaults.needOffsetDays),
    bufferDays: asInt(line.bufferDays, orderDefaults.bufferDays),
    requiredDate:
      parseNullableDate(line.requiredDate, `lines.${index}.requiredDate`) ||
      orderDefaults.requiredBy ||
      material?.requiredDate ||
      null,
    promisedDate:
      parseNullableDate(line.promisedDate, `lines.${index}.promisedDate`) ||
      orderDefaults.promisedDate ||
      null,
    notes: trimOrNull(line.notes),
    activity,
    material,
  };
};

/**
 * What a newly planned order may start as (OCTA-PROC-APPROVAL-067).
 *
 * Planning may say an order is not yet raised (`planned`) or being written
 * (`draft`). It may not declare an order approved, issued or acknowledged:
 * those are decisions, they belong to somebody, and the register's transitions
 * are what record who made them and when. Creating straight into one of them
 * produced orders that read as sent to a supplier with nothing behind it.
 */
const PLANNABLE_STATUSES = new Set(['planned', 'draft']);
const startingStatus = (requested) => {
  const status = trimOrNull(requested);
  if (!status) return 'planned';
  if (PLANNABLE_STATUSES.has(status)) return status;
  const error = new HttpError(
    400,
    'PO_STATUS_NOT_PLANNABLE',
    `A new order can only start as planned or draft — "${status}" is a decision that has to be made on the order itself.`,
  );
  error.details = {
    requested: status,
    allowed: [...PLANNABLE_STATUSES],
    remedy: 'POST /projects/{projectId}/purchase-orders/{orderId}/submit, then /approve, then /issue',
  };
  throw error;
};

const createPurchaseOrder = async ({ orgId, projectId, actor, payload }) => {
  const project = await ensureProject({ orgId, projectId });
  await ensureSupplier({ projectId, supplierId: payload.supplierId });
  await ensurePackage({ projectId, packageId: payload.packageId });
  if (payload.activityId) {
    await ensureActivity({ projectId, activityId: payload.activityId });
  }

  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw new HttpError(
      400,
      'PO_LINES_REQUIRED',
      'A purchase order requires at least one activity-linked line',
    );
  }

  payload.lines.forEach((line, index) => {
    if (!line.activityId && !payload.activityId) {
      throw new HttpError(
        400,
        'PROCUREMENT_ACTIVITY_REQUIRED',
        `lines.${index}.activityId is required for procurement traceability`,
      );
    }
  });

  for (const line of payload.lines) {
    const activityId = line.activityId || payload.activityId;
    await ensureActivity({ projectId, activityId });
    await ensureSupplier({ projectId, supplierId: line.supplierId });
    await ensurePackage({ projectId, packageId: line.packageId });
    await ensureMaterialRequirement({
      projectId,
      activityId,
      materialId: line.activityMaterialId,
    });
  }

  // A PO may draw down a purchase-order commitment (OCTA-FIN-COMMIT-020).
  if (payload.commitmentId && prisma.commitment?.findFirst) {
    const commitment = await prisma.commitment.findFirst({
      where: { id: payload.commitmentId, projectId },
      select: { id: true, status: true },
    });
    if (!commitment) {
      throw new HttpError(404, 'COMMITMENT_NOT_FOUND', 'Commitment not found');
    }
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.procurementOrder.create({
      data: {
        projectId,
        activityId: payload.activityId || null,
        packageId: payload.packageId || null,
        supplierId: payload.supplierId || null,
        commitmentId: payload.commitmentId || null,
        ref: payload.ref,
        item: payload.item || payload.ref,
        supplier: trimOrNull(payload.supplier),
        // Planned, not issued (OCTA-PROC-APPROVAL-067). This endpoint plans
        // procurement; the same `ProcurementOrder` is governed by the register's
        // submit → approve → issue transitions, which stamp who did each and
        // audit it. Defaulting to `issued` created orders that read as sent to a
        // supplier with `submittedAt`, `approvedAt` and `issuedAt` all null —
        // the approval workflow bypassed, and nothing in the record saying so.
        status: startingStatus(payload.status),
        leadWeeks: asInt(payload.leadWeeks),
        requiredTiming: VALID_REQUIRED_TIMINGS.has(payload.requiredTiming)
          ? payload.requiredTiming
          : 'activity_start',
        needOffsetDays: asInt(payload.needOffsetDays),
        bufferDays: asInt(payload.bufferDays, 14),
        value: toMoneyDecimal(0),
        currency: payload.currency || 'USD',
        orderDate: parseNullableDate(payload.orderDate, 'orderDate') || null,
        requiredBy: parseNullableDate(payload.requiredBy, 'requiredBy') || null,
        promisedDate:
          parseNullableDate(payload.promisedDate, 'promisedDate') || null,
        deliveryDate:
          parseNullableDate(payload.deliveryDate, 'deliveryDate') || null,
        buyer: trimOrNull(payload.buyer),
        notes: trimOrNull(payload.notes),
        createdBy: actor?.id || null,
        updatedBy: actor?.id || null,
      },
    });

    const orderDefaults = {
      orderId: order.id,
      activityId: order.activityId,
      packageId: order.packageId,
      supplierId: order.supplierId,
      leadWeeks: order.leadWeeks,
      requiredTiming: order.requiredTiming,
      needOffsetDays: order.needOffsetDays,
      bufferDays: order.bufferDays,
      requiredBy: order.requiredBy,
      promisedDate: order.promisedDate,
    };

    const createdLines = [];
    for (const [index, rawLine] of payload.lines.entries()) {
      const normalized = await normalizeLineInput({
        tx,
        projectId,
        orderDefaults,
        line: rawLine,
        index,
      });
      const { activity, material, ...data } = normalized;
      if (!data.description || !data.unit) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'PO line description and unit are required',
        );
      }

      const createdLine = await tx.procurementPoLine.create({ data });
      const enrichedLine = { ...createdLine, activity, activityMaterial: material };
      createdLines.push(enrichedLine);

      if (material) {
        await tx.activityMaterial.update({
          where: { id: material.id },
          data: {
            supplierId: data.supplierId || material.supplierId || null,
            procurementPackageId:
              data.packageId || material.procurementPackageId || null,
            status: 'ordered',
            updatedBy: actor?.id || null,
          },
        });
      }

      await syncLeadTimeAlert({
        tx,
        projectId,
        project,
        line: enrichedLine,
      });
    }

    const value = createdLines.reduce(
      (total, line) => total + lineValue(line),
      0,
    );

    // The order's subtotal, tax and value all follow the lines
    // (OCTA-COM-PO-053). One place computes them so a new order and an edited
    // one cannot disagree.
    await require('./purchase-order.service').recomputeTotals(tx, order.id);

    await recordAudit({
      tx,
      orgId,
      projectId,
      entityType: ENTITY_TYPES.PROCUREMENT_ORDER,
      entityId: order.id,
      action: ACTIONS.CREATED,
      actor,
      newStatus: order.status,
      summary: { ref: order.ref, item: order.item, lineCount: createdLines.length },
      metadata: { value },
    });

    return {
      ...order,
      value,
      lines: createdLines.map((line) => enrichPoLine(line, project)),
    };
  });
};

const listPurchaseOrders = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });
  const orders = await prisma.procurementOrder.findMany({
    where: { projectId },
    include: ORDER_INCLUDE,
    orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
  });

  return orders.map((order) => ({
    ...order,
    lines: order.lines.map((line) => enrichPoLine(line, project)),
  }));
};

const deriveOrderStatus = (lines) => {
  if (lines.length === 0) return 'issued';
  const allIssued = lines.every(
    (line) => Number(line.issuedQty || 0) >= Number(line.orderedQty || 0),
  );
  if (allIssued) return 'closed';

  const allReceived = lines.every(
    (line) => Number(line.receivedQty || 0) >= Number(line.orderedQty || 0),
  );
  if (allReceived) return 'received';

  const hasReceipt = lines.some(
    (line) =>
      Number(line.receivedQty || 0) > 0 || Number(line.issuedQty || 0) > 0,
  );
  return hasReceipt ? 'partial' : 'issued';
};

const deriveLineStatus = ({ orderedQty, receivedQty, issuedQty, consumedQty }) => {
  if (consumedQty >= orderedQty && orderedQty > 0) return 'consumed';
  if (issuedQty >= orderedQty && orderedQty > 0) return 'issued';
  if (receivedQty >= orderedQty && orderedQty > 0) return 'received';
  if (receivedQty > 0 || issuedQty > 0) return 'partial';
  return 'ordered';
};

/**
 * Delivery receipts are written by `goods-receipt.service`, not here.
 *
 * There used to be a second writer at this point, reached from the procurement
 * route. It recorded the delivery and updated the order, but it put nothing on
 * a shelf and had no view of the warehouse — so a delivery booked from
 * Procurement left the stock empty, and every guard added to the other writer
 * (an order that was never issued, a delivery note posted twice) had to be
 * remembered here and was not. One economic event, one writer
 * (OCTA-PROC-RECEIPT-081).
 */

const recordActivityMaterialUsage = async ({
  orgId,
  projectId,
  activityId,
  materialId,
  actor,
  payload,
}) => {
  await ensureProject({ orgId, projectId });
  const material = await ensureMaterialRequirement({
    projectId,
    activityId,
    materialId,
  });

  const usedQty = asPositive('usedQty', payload.usedQty);
  const wasteQty = asNonNegative(payload.wasteQty);
  const totalUsage = usedQty + wasteQty;
  const issuedQty = Number(material.issuedQty || 0);
  const consumedQty = Number(material.consumedQty || 0);
  const existingWasteQty = Number(material.wasteQty || 0);
  const availableQty = issuedQty - consumedQty - existingWasteQty;

  if (totalUsage > availableQty) {
    throw new HttpError(
      409,
      'MATERIAL_USAGE_EXCEEDS_ISSUED_QTY',
      'Activity material usage exceeds the issued quantity available for consumption',
    );
  }

  if (payload.poLineId) {
    await ensurePoLine({ projectId, poLineId: payload.poLineId });
  }
  if (payload.receiptLineId) {
    await ensureReceiptLine({
      projectId,
      receiptLineId: payload.receiptLineId,
      materialId: material.id,
    });
  }
  await ensureDailyReport({
    projectId,
    dailyReportId: payload.dailyReportId,
    activityId: material.activityId,
  });

  return prisma.$transaction(async (tx) => {
    const usage = await tx.activityMaterialUsage.create({
      data: {
        projectId,
        activityId: material.activityId,
        activityMaterialId: material.id,
        poLineId: payload.poLineId || null,
        receiptLineId: payload.receiptLineId || null,
        dailyReportId: payload.dailyReportId || null,
        usedQty,
        wasteQty,
        usageDate: parseNullableDate(payload.usageDate, 'usageDate') || new Date(),
        installedLocation: trimOrNull(payload.installedLocation),
        recordedBy: actor?.id || trimOrNull(payload.recordedBy),
        notes: trimOrNull(payload.notes),
      },
    });

    const nextConsumedQty = consumedQty + usedQty;
    const nextWasteQty = existingWasteQty + wasteQty;
    const nextStatus =
      nextConsumedQty + nextWasteQty >= issuedQty ? 'consumed' : 'issued';

    const updatedMaterial = await tx.activityMaterial.update({
      where: { id: material.id },
      data: {
        consumedQty: nextConsumedQty,
        wasteQty: nextWasteQty,
        status: nextStatus,
        updatedBy: actor?.id || null,
      },
    });

    if (payload.poLineId) {
      const line = await tx.procurementPoLine.findFirst({
        where: { id: payload.poLineId, projectId },
      });
      if (line) {
        const nextLineConsumedQty = Number(line.consumedQty || 0) + totalUsage;
        await tx.procurementPoLine.update({
          where: { id: line.id },
          data: {
            consumedQty: nextLineConsumedQty,
            status: deriveLineStatus({
              orderedQty: Number(line.orderedQty || 0),
              receivedQty: Number(line.receivedQty || 0),
              issuedQty: Number(line.issuedQty || 0),
              consumedQty: nextLineConsumedQty,
            }),
          },
        });
      }
    }

    await recordAudit({
      tx,
      orgId,
      projectId,
      entityType: ENTITY_TYPES.ACTIVITY_MATERIAL_USAGE,
      entityId: usage.id,
      action: ACTIONS.CREATED,
      actor,
      summary: {
        materialId: material.id,
        activityId: material.activityId,
        usedQty,
        wasteQty,
      },
    });

    return { usage, material: updatedMaterial };
  });
};

const listLeadTimeAlerts = async ({ orgId, projectId, status = null }) => {
  await ensureProject({ orgId, projectId });
  return prisma.procurementLeadTimeAlert.findMany({
    where: {
      projectId,
      ...(status ? { status } : {}),
    },
    include: {
      activity: { select: ACTIVITY_SELECT },
      package: true,
      order: true,
      poLine: true,
      activityMaterial: true,
    },
    orderBy: [
      { status: 'asc' },
      { severity: 'desc' },
      { daysAtRisk: 'desc' },
      { updatedAt: 'desc' },
    ],
  });
};

const updateLeadTimeAlert = async ({
  orgId,
  projectId,
  alertId,
  actor,
  payload,
}) => {
  if (payload.status !== 'acknowledged') {
    throw new HttpError(
      400,
      'PROCUREMENT_ALERT_WORKFLOW_ENDPOINT_REQUIRED',
      'Use the acknowledge or resolve alert workflow endpoint for this status change',
    );
  }

  return acknowledgeLeadTimeAlert({
    orgId,
    projectId,
    alertId,
    actor,
    payload,
  });
};

const transitionLeadTimeAlert = async ({
  orgId,
  projectId,
  alertId,
  actor,
  payload,
  status,
  transition,
}) => {
  await ensureProject({ orgId, projectId });
  if (!ALERT_STATUSES.has(status)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid alert status');
  }

  const existing = await prisma.procurementLeadTimeAlert.findFirst({
    where: { id: alertId, projectId },
  });
  if (!existing) {
    throw new HttpError(
      404,
      'PROCUREMENT_ALERT_NOT_FOUND',
      'Procurement lead-time alert not found',
    );
  }

  if (existing.status === 'resolved' && status !== 'resolved') {
    throw new HttpError(
      409,
      'PROCUREMENT_ALERT_ALREADY_RESOLVED',
      'Resolved procurement lead-time alerts cannot be acknowledged again',
    );
  }

  if (existing.status === status) return existing;

  const data = { status };
  if (status === 'acknowledged') {
    data.acknowledgedBy = actor?.id || null;
    data.acknowledgedAt = new Date();
  }
  if (status === 'resolved') {
    data.resolvedBy = actor?.id || null;
    data.resolvedAt = new Date();
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.procurementLeadTimeAlert.update({
      where: { id: alertId },
      data,
    });

    await recordAudit({
      tx,
      orgId,
      projectId,
      entityType: ENTITY_TYPES.PROCUREMENT_ALERT,
      entityId: row.id,
      action: ACTIONS.STATUS_CHANGED,
      actor,
      oldStatus: existing.status,
      newStatus: row.status,
      reason: trimOrNull(payload.note),
      summary: {
        transition,
        reason: row.reason,
        severity: row.severity,
        activityId: row.activityId,
        packageId: row.packageId,
        poLineId: row.poLineId,
        activityMaterialId: row.activityMaterialId,
      },
      metadata: {
        needDate: serializeDate(row.needDate),
        orderByDate: serializeDate(row.orderByDate),
        expectedDeliveryDate: serializeDate(row.expectedDeliveryDate),
      },
    });

    return row;
  });
};

const acknowledgeLeadTimeAlert = (options) =>
  transitionLeadTimeAlert({
    ...options,
    status: 'acknowledged',
    transition: 'alert.acknowledge',
  });

const resolveLeadTimeAlert = (options) =>
  transitionLeadTimeAlert({
    ...options,
    status: 'resolved',
    transition: 'alert.resolve',
  });

const getProcurementOverview = async ({ orgId, projectId }) => {
  const project = await ensureProject({ orgId, projectId });
  const [suppliers, packages, orders, alerts] = await Promise.all([
    prisma.procurementSupplier.findMany({ where: { projectId } }),
    prisma.procurementPackage.findMany({
      where: { projectId },
      include: {
        supplier: true,
        activity: { select: ACTIVITY_SELECT },
        leadTimeAlerts: {
          where: { status: { in: ['open', 'acknowledged'] } },
          orderBy: { updatedAt: 'desc' },
        },
      },
    }),
    prisma.procurementOrder.findMany({ where: { projectId } }),
    prisma.procurementLeadTimeAlert.findMany({
      where: { projectId, status: { in: ['open', 'acknowledged'] } },
    }),
  ]);

  return {
    suppliers,
    packages: packages.map((row) => enrichPackage(row, project)),
    orders,
    alerts,
    summary: {
      suppliers: suppliers.length,
      packages: packages.length,
      purchaseOrders: orders.length,
      openAlerts: alerts.filter((alert) => alert.status === 'open').length,
      acknowledgedAlerts: alerts.filter(
        (alert) => alert.status === 'acknowledged',
      ).length,
    },
  };
};

const enrichActivityMaterial = (material, project) => ({
  ...material,
  procurementRisk: computeProcurementRisk(buildMaterialRiskRow(material), {
    project,
  }),
});

const enrichActivityMaterials = (materials, project) =>
  materials.map((material) => enrichActivityMaterial(material, project));

module.exports = {
  ACTIVITY_SELECT,
  acknowledgeLeadTimeAlert,
  buildMaterialRiskRow,
  buildPackageRiskRow,
  buildLineRiskRow,
  createPackage,
  createPurchaseOrder,
  createSupplier,
  enrichActivityMaterial,
  enrichActivityMaterials,
  getProcurementOverview,
  listLeadTimeAlerts,
  listPackages,
  listPurchaseOrders,
  listSuppliers,
  recordActivityMaterialUsage,
  resolveLeadTimeAlert,
  syncLeadTimeAlert,
  updateLeadTimeAlert,
};
