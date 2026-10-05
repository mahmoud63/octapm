const crypto = require('crypto');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { nextRef } = require('../utils/reference-number');
const {
  ACTIONS,
  ENTITY_TYPES,
  recordEvent,
} = require('./audit.service');
const {
  SEVERITY_RANK,
  calculateNeedDate,
  calculateOrderByDate,
  computeProcurementRisk,
} = require('./procurement-risk.service');
const { MONEY_MAX, toMoneyDecimal, toMoneyNumber } = require('../utils/money');
const { assertProjectRows, idsOf } = require('./tenant-references.service');

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
    // The report each receipt and receipt line names is read with its
    // project, so it is served only when it is the receipt's own (CERT-2).
    include: { lines: { include: { dailyReport: { select: { projectId: true } } } }, dailyReport: { select: { projectId: true } } },
    orderBy: { receivedAt: 'desc' },
  },
};

/**
 * A delivery receipt (or a receipt line) as served: its daily report only
 * when that report is on the receipt's own project. A receipt stored naming
 * another company's report — residue from before the write guard — served
 * that report's id on the purchase-order list (CERT-2). The row keeps its
 * shape: the report's id or null, and nothing more of it.
 */
const withOwnReport = (row) => {
  const { dailyReport, ...served } = row;
  if (served.dailyReportId && dailyReport?.projectId !== served.projectId) served.dailyReportId = null;
  return served;
};
const ownReceipt = (receipt) => ({ ...withOwnReport(receipt), lines: (receipt.lines ?? []).map(withOwnReport) });

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

/**
 * The cost coding a purchase-order line may carry: only this project's BOQ
 * items, budget lines and material masters, and this organisation's cost
 * codes (CERT-2 injection sweep: another company's were stored on
 * procurement_po_line and answered back). A foreign id gets exactly the 404
 * an id that exists nowhere gets, before the order is written.
 */
const assertLineCoding = async ({ tx = prisma, orgId, projectId, lines }) => {
  const pick = (key) => lines.map((line) => line?.[key]);
  await assertProjectRows({ tx, model: 'boqItem', projectId, ids: pick('boqItemId'), code: 'BOQ_ITEM_NOT_FOUND', message: 'BOQ item not found' });
  await assertProjectRows({ tx, model: 'budgetLine', projectId, ids: pick('budgetLineId'), code: 'BUDGET_LINE_NOT_FOUND', message: 'Budget line not found' });
  await assertProjectRows({ tx, model: 'materialMaster', projectId, ids: pick('materialMasterId'), code: 'MATERIAL_NOT_FOUND', message: 'Material not found' });
  // Cost codes belong to the organisation, not to a project.
  // A cost code is named by one string. idsOf() skips any other shape, and the
  // line was then written with String(value): ["<id>"] became "<id>" and
  // another company's cost code was stored unchecked (CERT-2 shapes). Any
  // other shape gets the 404 a cost code that exists nowhere gets.
  if (pick('costCodeId').some((value) => value !== undefined && value !== null && value !== '' && typeof value !== 'string')) {
    throw new HttpError(404, 'COST_CODE_NOT_FOUND', 'Cost code not found');
  }
  const costCodeIds = idsOf(pick('costCodeId'));
  if (costCodeIds.length) {
    const found = orgId && tx.costCode?.findMany
      ? await tx.costCode.findMany({ where: { id: { in: costCodeIds }, orgId }, select: { id: true } })
      : [];
    if (found.length !== costCodeIds.length) {
      throw new HttpError(404, 'COST_CODE_NOT_FOUND', 'Cost code not found');
    }
  }
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

/** An order that will deliver nothing more. */
const SETTLED_ORDER_STATUSES = new Set(['cancelled', 'closed']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'void']);

/** A line whose order was cancelled or closed: it will deliver nothing more, and is no one's risk. */
const isOnSettledOrder = (line) => SETTLED_ORDER_STATUSES.has(lower(line?.order?.status));

/**
 * A line a material can still be waiting on: not cancelled or consumed, and
 * not on a cancelled or closed order (CERT-2, round 6). The material read its
 * promise from the first line not cancelled, whatever its order: a material
 * ordered on an order since cancelled kept its package's alert open, critical
 * "delivery after need" on the cancelled order's promised date. A line is
 * judged by its order only when the order's status was read with it.
 */
const isOpenMaterialLine = (line) =>
  !CANCELLED_STATUSES.has(lower(line.status)) &&
  lower(line.status) !== 'consumed' &&
  !isOnSettledOrder(line);

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

  const firstOpenLine = material.poLines?.find(isOpenMaterialLine);
  // Ordered only on orders since cancelled or closed: it is not on order any
  // more, and its order-by date speaks for it again.
  const status =
    !firstOpenLine && material.poLines?.length && lower(material.status) === 'ordered'
      ? 'not_ordered'
      : material.status;

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
    status,
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

/**
 * The lead-time alert (OCTA-PROC-LEADALERT-082; CERT-2 rounds 4 and 5).
 *
 * An alert is unique on its project by order line, by material requirement
 * and by procurement package, so each alert speaks for one SCOPE, and every
 * order line, material and package belongs to exactly one:
 *
 *   package   a procurement package, the materials planned on it, and the
 *             order lines on it — or naming no package, ordered against one
 *             of those materials. Its alert holds packageId.
 *   material  a material requirement on no package, and the lines ordered
 *             against it that name no package. Its alert holds
 *             activityMaterialId and no packageId.
 *   line      an order line that names neither. Its alert holds poLineId.
 *
 * The alert carries the WORST risk in its scope — recomputed from every
 * member each time one of them changes — and points (poLineId, orderId,
 * activityMaterialId, activityId) at the member carrying it. It is resolved
 * only when nothing in the scope is at risk. Round 4 made a package's one
 * alert follow whichever line or material changed it last: an on-time
 * delivery on a second order resolved the package's alert while the first
 * order's line was still five weeks late, and GET lead-time-alerts?status=open
 * showed nothing.
 *
 * An acknowledged alert is opened again when the risk becomes worse than what
 * was acknowledged: a higher severity, or more days at risk than time alone
 * has added since. An acknowledgement of a three-day slip used to carry over,
 * still acknowledged, to an eighty-day one.
 *
 * A package's own planning dates speak for it only while nothing is ordered
 * on it: its status does not follow the orders placed against it, and a
 * package left at "planning" would otherwise read "order-by date missed" for
 * ever. A line on a cancelled or closed order will deliver nothing more, and
 * a cancelled line or material is no one's risk: they are left out — of the
 * scope, and of what a material in it is still waiting on.
 *
 * Every scope a write touches is worked again ONCE, after the write — not
 * once per line (CERT-2, round 6): see syncLeadTimeAlerts.
 */
/**
 * What a scope reads of a line: what its risk is worked from (buildLineRiskRow,
 * computeProcurementRisk), what its alert points at (alertDataFor), and what
 * places it in a scope — not every column of every line (CERT-2,
 * availability-7: a scope of 240 lines read all thirty-odd columns of each).
 */
const ALERT_LINE_SELECT = {
  id: true,
  orderId: true,
  packageId: true,
  activityId: true,
  activityMaterialId: true,
  description: true,
  status: true,
  orderedQty: true,
  receivedQty: true,
  issuedQty: true,
  leadWeeks: true,
  requiredTiming: true,
  needOffsetDays: true,
  bufferDays: true,
  requiredDate: true,
  promisedDate: true,
  createdAt: true,
  activity: { select: ACTIVITY_SELECT },
  order: { select: { ref: true, status: true } },
};
const ALERT_MATERIAL_INCLUDE = {
  activity: { select: ACTIVITY_SELECT },
  // With each line's order status (isOpenMaterialLine), newest first as the
  // material register lists them.
  poLines: {
    include: { order: { select: { status: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  },
};
const MEMBER_ORDER = [{ createdAt: 'asc' }, { id: 'asc' }];
/**
 * The lines of a scope that can still deliver, as the database filters them —
 * the rule memberRisks applies again. A scope's cancelled and closed lines
 * are not read each time it is worked: cancelling a 240-line order read all
 * 240 back only to leave them out (CERT-2, round 6).
 */
const LIVE_LINE_WHERE = {
  status: { notIn: [...CANCELLED_STATUSES] },
  order: { status: { notIn: [...SETTLED_ORDER_STATUSES] } },
};
/** Reasons whose days at risk grow by themselves, a day each day. */
const TIME_DRIVEN_REASONS = new Set(['delivery_overdue', 'order_by_missed']);
const SCOPE_KEY = { package: 'packageId', material: 'activityMaterialId', line: 'poLineId' };
const DAY_MS = 86_400_000;

const findRows = async (tx, model, args) =>
  (tx[model]?.findMany ? (await tx[model].findMany(args)) || [] : []);
const scopeName = (scope) => `${scope.kind}:${scope.id}`;
/** The link an alert is unique on as its scope's alert; its other links only point. */
const ownKeyOf = (alert) =>
  alert.packageId ? 'packageId' : alert.activityMaterialId ? 'activityMaterialId' : 'poLineId';

/**
 * The scopes the given alerts speak for, from the link each is unique on
 * (scopeOfAlert, for many at once): a package's from its package; a
 * material's from the material as it now stands; a line's from the line — its
 * package, or the package of the material it was ordered against, or the
 * material, or the line itself. Two reads for any number of alerts (the
 * lines, then the materials); a line this same write has just written or
 * read (`known`: the lines it works the alerts of) is taken as it has it, as
 * its own scope was. null for an alert whose material or line is gone.
 */
const scopesOfAlerts = async (tx, projectId, alerts, known = new Map()) => {
  const lineIds = [
    ...new Set(alerts.filter((alert) => !alert.packageId && !alert.activityMaterialId && alert.poLineId).map((alert) => alert.poLineId)),
  ];
  const unknown = lineIds.filter((id) => !known.has(id));
  const read = unknown.length
    ? await findRows(tx, 'procurementPoLine', {
        where: { projectId, id: { in: unknown } },
        select: { id: true, packageId: true, activityMaterialId: true },
      })
    : [];
  const lineById = new Map([
    ...lineIds.filter((id) => known.has(id)).map((id) => [id, known.get(id)]),
    ...read.map((line) => [line.id, line]),
  ]);
  const lines = [...lineById.values()];
  const materialIds = [
    ...new Set([
      ...alerts.filter((alert) => !alert.packageId && alert.activityMaterialId).map((alert) => alert.activityMaterialId),
      ...lines.filter((line) => !line.packageId && line.activityMaterialId).map((line) => line.activityMaterialId),
    ]),
  ];
  const materials = materialIds.length
    ? await findRows(tx, 'activityMaterial', {
        where: { id: { in: materialIds }, projectId },
        select: { id: true, procurementPackageId: true },
      })
    : [];
  const materialById = new Map(materials.map((material) => [material.id, material]));
  return alerts.map((alert) => {
    if (alert.packageId) return { kind: 'package', id: alert.packageId };
    if (alert.activityMaterialId) {
      const material = materialById.get(alert.activityMaterialId);
      if (!material) return null;
      return material.procurementPackageId
        ? { kind: 'package', id: material.procurementPackageId }
        : { kind: 'material', id: material.id };
    }
    if (!alert.poLineId) return null;
    const line = lineById.get(alert.poLineId);
    if (!line) return null;
    if (line.packageId) return { kind: 'package', id: line.packageId };
    if (line.activityMaterialId) {
      const owner = materialById.get(line.activityMaterialId);
      return owner?.procurementPackageId
        ? { kind: 'package', id: owner.procurementPackageId }
        : { kind: 'material', id: line.activityMaterialId };
    }
    return { kind: 'line', id: line.id };
  });
};

/** Rows grouped by a key, each group in the rows' order. */
const groupBy = (rows, keyOf) => {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
};

/** A line the database left in a scope's read (LIVE_LINE_WHERE), judged the same way in memory. */
const isLiveLine = (line) =>
  !CANCELLED_STATUSES.has(line.status) && !SETTLED_ORDER_STATUSES.has(line.order?.status);

/**
 * Everything in the given scopes, read afresh: three reads for any number of
 * scopes (CERT-2, availability-7) — the packages; the materials planned on
 * them and each material scope's own; the lines that can still deliver on the
 * packages or against those materials, and each line scope's own line. Gives
 * each scope what it read for itself alone before, in the same order:
 *
 *   package   the package, its materials, and its lines that can still
 *             deliver — on it, or naming no package and ordered against one
 *             of its materials;
 *   material  the material, and the lines that can still deliver ordered
 *             against it naming no package (none when it is gone);
 *   line      the line, while it can still deliver (round 6 read it whatever
 *             its state, and left it out of the risk when it could not).
 */
const membersOfScopes = async (tx, projectId, scopes) => {
  const scopeIds = (kind) => [...new Set(scopes.filter((scope) => scope.kind === kind).map((scope) => scope.id))];
  const packageIds = scopeIds('package');
  const materialScopeIds = scopeIds('material');
  const lineScopeIds = scopeIds('line');
  const onPackage = new Set(packageIds);

  const packages = packageIds.length
    ? await findRows(tx, 'procurementPackage', {
        where: { id: { in: packageIds }, projectId },
        include: { activity: { select: ACTIVITY_SELECT } },
      })
    : [];
  const materialWhere = [
    ...(packageIds.length ? [{ procurementPackageId: { in: packageIds } }] : []),
    ...(materialScopeIds.length ? [{ id: { in: materialScopeIds } }] : []),
  ];
  const materials = materialWhere.length
    ? await findRows(tx, 'activityMaterial', {
        where: { projectId, OR: materialWhere },
        include: ALERT_MATERIAL_INCLUDE,
        orderBy: MEMBER_ORDER,
      })
    : [];
  const planned = materials.filter((material) => onPackage.has(material.procurementPackageId));
  const orderedAgainst = [...new Set([...planned.map((material) => material.id), ...materialScopeIds])];
  const lineWhere = [
    ...(packageIds.length ? [{ packageId: { in: packageIds }, ...LIVE_LINE_WHERE }] : []),
    ...(orderedAgainst.length ? [{ packageId: null, activityMaterialId: { in: orderedAgainst }, ...LIVE_LINE_WHERE }] : []),
    // A line scope's line too only while it can still deliver: one that cannot
    // is no one's risk (memberRisks leaves it out), and its scope's alert is
    // resolved on nothing — so cancelling an order of 240 lines reads none back.
    ...(lineScopeIds.length ? [{ id: { in: lineScopeIds }, ...LIVE_LINE_WHERE }] : []),
  ];
  const lines = lineWhere.length
    ? await findRows(tx, 'procurementPoLine', {
        where: { projectId, OR: lineWhere },
        select: ALERT_LINE_SELECT,
        orderBy: MEMBER_ORDER,
      })
    : [];

  const packageById = new Map(packages.map((row) => [row.id, row]));
  const materialById = new Map(materials.map((row) => [row.id, row]));
  const lineById = new Map(lines.map((row) => [row.id, row]));
  const plannedOn = groupBy(planned, (material) => material.procurementPackageId);
  const packageOfPlanned = new Map(planned.map((material) => [material.id, material.procurementPackageId]));
  // One pass over the lines, in their order: a line is on at most one
  // package's scope (its own package, or its material's when it names none),
  // and, naming no package, in its material's own scope as well.
  const linesOn = new Map();
  const linesAgainst = new Map();
  const push = (map, key, line) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(line);
  };
  for (const line of lines) {
    if (!isLiveLine(line)) continue;
    if (line.packageId) {
      if (onPackage.has(line.packageId)) push(linesOn, line.packageId, line);
      continue;
    }
    if (!line.activityMaterialId) continue;
    const packageId = packageOfPlanned.get(line.activityMaterialId);
    if (packageId) push(linesOn, packageId, line);
    push(linesAgainst, line.activityMaterialId, line);
  }
  return (scope) => {
    if (scope.kind === 'package') {
      return {
        packageRow: packageById.get(scope.id) || null,
        materials: plannedOn.get(scope.id) || [],
        lines: linesOn.get(scope.id) || [],
      };
    }
    if (scope.kind === 'material') {
      const material = materialById.get(scope.id);
      return {
        packageRow: null,
        materials: material ? [material] : [],
        lines: material ? linesAgainst.get(scope.id) || [] : [],
      };
    }
    const line = lineById.get(scope.id);
    return { packageRow: null, materials: [], lines: line ? [line] : [] };
  };
};

/** Each member that can still be late, with its risk. */
const memberRisks = ({ packageRow, materials, lines }, project) => {
  const liveLines = lines.filter(
    (line) =>
      !SETTLED_ORDER_STATUSES.has(lower(line.order?.status)) &&
      !CANCELLED_STATUSES.has(lower(line.status)),
  );
  const risks = [
    ...liveLines.map((line) => ({
      line,
      risk: computeProcurementRisk(buildLineRiskRow(line), { project }),
    })),
    ...materials
      .filter((material) => !CANCELLED_STATUSES.has(lower(material.status)))
      .map((material) => ({
        material,
        risk: computeProcurementRisk(buildMaterialRiskRow(material), { project }),
      })),
  ];
  if (packageRow && !liveLines.length && !CANCELLED_STATUSES.has(lower(packageRow.status))) {
    risks.push({ packageRow, risk: enrichPackage(packageRow, project).procurementRisk });
  }
  return risks;
};

const rankOf = (severity) => SEVERITY_RANK[severity] ?? 0;
/** The worse of two: higher severity, then more days at risk; the earlier member on a tie. */
const worstRisk = (risks) =>
  risks.reduce((top, item) => {
    if (!top) return item;
    const delta = rankOf(item.risk.severity) - rankOf(top.risk.severity);
    if (delta) return delta > 0 ? item : top;
    return (item.risk.daysAtRisk || 0) > (top.risk.daysAtRisk || 0) ? item : top;
  }, null);

/** What the scope's alert says: the worst risk, pointing at the member carrying it. */
const alertDataFor = (projectId, scope, top) => {
  const { risk, line = null, material = null, packageRow = null } = top;
  return {
    projectId,
    activityId: line?.activityId || material?.activityId || packageRow?.activityId || null,
    packageId: scope.kind === 'package' ? scope.id : null,
    orderId: line?.orderId || null,
    poLineId: scope.kind === 'line' ? scope.id : line?.id || null,
    activityMaterialId:
      scope.kind === 'material' ? scope.id : material?.id || line?.activityMaterialId || null,
    severity: risk.severity,
    reason: risk.reason,
    daysAtRisk: Math.round(risk.daysAtRisk || 0),
    needDate: risk.needDate || null,
    orderByDate: risk.orderByDate || null,
    expectedDeliveryDate: risk.expectedDeliveryDate || null,
  };
};

const utcDay = (value) => {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS;
};

/**
 * Whether the risk an alert now carries is worse than the one it carried:
 * a higher severity, or, at the same severity, more days at risk — beyond the
 * days that time alone has added to the same overdue line or missed order-by
 * date since the alert was last brought up to date.
 */
const riskWorsened = (previous, next, today = new Date()) => {
  const delta = rankOf(next.severity) - rankOf(previous.severity);
  if (delta) return delta > 0;
  const sameRisk =
    previous.reason === next.reason &&
    (previous.poLineId || null) === (next.poLineId || null) &&
    (previous.activityMaterialId || null) === (next.activityMaterialId || null);
  const elapsed =
    sameRisk && TIME_DRIVEN_REASONS.has(next.reason) && previous.updatedAt
      ? Math.max(0, utcDay(today) - utcDay(previous.updatedAt))
      : 0;
  return (next.daysAtRisk || 0) > (previous.daysAtRisk || 0) + elapsed;
};

/** The links an alert is unique on, each once per project. */
const ALERT_LINKS = ['packageId', 'activityMaterialId', 'poLineId'];

/**
 * The project's alerts that one write's scopes can read or change, held in
 * memory while the scopes are worked (CERT-2, availability-7). They are read
 * before the first scope is worked, for every link a scope can look up; each
 * scope then finds and changes the rows here exactly as it found and changed
 * them in the table, one scope after another; and the rows that changed are
 * written once, at the end (writeAlertBook). Round 6 asked the table about ten
 * times for each scope, one scope at a time: an order of 220 lines, each on
 * its own package, answered 500 after 6 s (the transaction expired) where the
 * baseline answered 201 in 3.3 s, and cancelling 240 lines on no package took
 * 1.8 s where the baseline took 0.1 s.
 */
const alertBook = () => {
  const rows = new Map();
  const initial = new Map();
  const written = new Map();
  const index = Object.fromEntries(ALERT_LINKS.map((key) => [key, new Map()]));
  const place = (row, present) => {
    for (const key of ALERT_LINKS) {
      const value = row[key];
      if (!value) continue;
      if (!index[key].has(value)) index[key].set(value, new Set());
      if (present) index[key].get(value).add(row.id);
      else index[key].get(value).delete(row.id);
    }
  };
  const wrote = (id, data) => {
    if (!written.has(id)) written.set(id, new Set());
    for (const key of Object.keys(data)) written.get(id).add(key);
  };
  return {
    rows,
    initial,
    written,
    /** Rows as the table holds them; a row already here keeps what this write made of it. */
    add(found) {
      for (const row of found) {
        if (rows.has(row.id)) continue;
        const copy = { ...row };
        rows.set(row.id, copy);
        initial.set(row.id, { ...row });
        place(copy, true);
      }
    },
    /** The rows that hold a link now, as findMany would answer them. */
    holding(key, value) {
      const ids = value ? index[key].get(value) : null;
      return ids ? [...ids].map((id) => ({ ...rows.get(id) })) : [];
    },
    update(id, data, now) {
      const row = rows.get(id);
      place(row, false);
      Object.assign(row, data, { updatedAt: now });
      place(row, true);
      wrote(id, data);
      return { ...row };
    },
    create(data, now) {
      const row = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        acknowledgedAt: null,
        acknowledgedBy: null,
        resolvedAt: null,
        resolvedBy: null,
        ...data,
      };
      rows.set(row.id, row);
      place(row, true);
      wrote(row.id, data);
      return { ...row };
    },
  };
};

/** The project's alerts holding any of these links, as the table holds them. One read. */
const readAlerts = async (tx, projectId, { packageIds = [], materialIds = [], lineIds = [] }) => {
  const links = [];
  for (const [key, values] of [['packageId', packageIds], ['activityMaterialId', materialIds], ['poLineId', lineIds]]) {
    const list = [...values];
    if (list.length) links.push({ [key]: { in: list } });
  }
  return links.length ? findRows(tx, 'procurementLeadTimeAlert', { where: { projectId, OR: links } }) : [];
};

/**
 * Brings one scope's alert up to date from every member of the scope, in the
 * book: the reads and writes round 6 made of the table, in the same order.
 *
 *   - the scope's own alert;
 *   - alerts of a narrower scope whose subject has since joined this one (a
 *     material put on a package, a line ordered against a material): adopted
 *     when the scope is at risk and has no alert of its own, otherwise closed
 *     and their links released to the alert that now speaks for them;
 *   - nothing at risk: the alert resolved;
 *   - at risk: the scope's own link is its alert's (another alert that merely
 *     points at the line or the material gives it up); a link the alert would
 *     only point at, held by another alert, stays there â€” unless that alert is
 *     resolved, or the line or material is a member of this scope, carrying
 *     its risk; a link that is the other alert's own stays with it;
 *   - the alert created, or updated â€” opened again when it was resolved, or
 *     acknowledged on a risk that has since worsened.
 */
const syncScopeInBook = ({ book, projectId, project, scope, members, now }) => {
  const top = worstRisk(memberRisks(members, project));
  const atRisk = Boolean(top?.risk.isAtRisk);
  const lineIds = members.lines.map((row) => row.id);

  let alert =
    (scope.kind === 'package'
      ? book.holding('packageId', scope.id)[0]
      : scope.kind === 'material'
        ? book.holding('activityMaterialId', scope.id).find((row) => !row.packageId)
        : book.holding('poLineId', scope.id).find((row) => !row.packageId && !row.activityMaterialId)) || null;

  const narrower = new Map();
  const narrowerLines = () => {
    for (const id of lineIds) {
      for (const row of book.holding('poLineId', id)) {
        if (!row.packageId && !row.activityMaterialId) narrower.set(row.id, row);
      }
    }
  };
  if (scope.kind === 'material') narrowerLines();
  if (scope.kind === 'package') {
    for (const material of members.materials) {
      for (const row of book.holding('activityMaterialId', material.id)) if (!row.packageId) narrower.set(row.id, row);
    }
    narrowerLines();
  }
  const orphans = [...narrower.values()];
  if (!alert && atRisk && orphans.length) {
    alert = [...orphans].sort(
      (a, b) =>
        Number(a.status === 'resolved') - Number(b.status === 'resolved') ||
        new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
    )[0];
  }
  for (const orphan of orphans) {
    if (orphan.id === alert?.id) continue;
    book.update(
      orphan.id,
      {
        poLineId: null,
        activityMaterialId: null,
        ...(orphan.status === 'resolved' ? {} : { status: 'resolved', resolvedAt: now, resolvedBy: null }),
      },
      now,
    );
  }

  if (!atRisk) {
    if (!alert || alert.status === 'resolved') return alert || null;
    return book.update(
      alert.id,
      {
        status: 'resolved',
        reason: top?.risk.reason || 'on_track',
        severity: top?.risk.severity || 'none',
        daysAtRisk: 0,
        needDate: top?.risk.needDate || null,
        orderByDate: top?.risk.orderByDate || null,
        expectedDeliveryDate: top?.risk.expectedDeliveryDate || null,
        resolvedAt: now,
      },
      now,
    );
  }

  const data = alertDataFor(projectId, scope, top);
  const other = (row) => !alert || row.id !== alert.id;
  const scopeKey = SCOPE_KEY[scope.kind];
  if (scopeKey !== 'packageId') {
    for (const row of book.holding(scopeKey, scope.id).filter(other)) book.update(row.id, { [scopeKey]: null }, now);
  }
  const memberIds = {
    poLineId: new Set(lineIds),
    activityMaterialId: new Set(members.materials.map((row) => row.id)),
  };
  for (const key of ['poLineId', 'activityMaterialId']) {
    if (key === scopeKey || !data[key]) continue;
    const holder = book.holding(key, data[key]).find(other);
    if (!holder) continue;
    const takeBack =
      ownKeyOf(holder) !== key && (holder.status === 'resolved' || memberIds[key].has(data[key]));
    if (takeBack) book.update(holder.id, { [key]: null }, now);
    else data[key] = null;
  }

  if (!alert) return book.create({ ...data, status: 'open' }, now);
  const reopen =
    alert.status === 'resolved' ||
    (alert.status === 'acknowledged' && riskWorsened(alert, data, now));
  return book.update(
    alert.id,
    {
      ...data,
      status: reopen ? 'open' : alert.status,
      resolvedAt: null,
      resolvedBy: null,
      ...(reopen ? { acknowledgedAt: null, acknowledgedBy: null } : {}),
    },
    now,
  );
};

const sameValue = (a, b) => {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined);
  }
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return false;
};
/** One text per set of values, whatever order the fields were written in. */
const payloadKey = (data) =>
  JSON.stringify(Object.keys(data).sort().map((key) => [key, data[key] instanceof Date ? data[key].toISOString() : data[key] ?? null]));

/**
 * Writes what the scopes made of the book: each new alert, and each alert
 * whose values changed, once â€” the changes that are the same values for
 * several alerts (resolving every line of a cancelled order) in one statement.
 * An alert the scopes brought up to date without changing a value is still
 * marked brought up to date (updatedAt: how long an acknowledged risk has
 * grown on its own is counted from it, riskWorsened), all such alerts in one
 * statement.
 *
 * Each link is one alert's at most (the table's unique keys), and the book
 * ends as the table would have after each scope's writes in turn: so every
 * link given up is released first, and only then is a link taken by another
 * alert, an existing one or a new one. An alert that gives up a link another
 * takes while it takes a new one releases it in the first pass.
 */
const writeAlertBook = async (tx, book, now) => {
  const model = tx.procurementLeadTimeAlert;
  const creates = [];
  const changes = [];
  const unchanged = [];
  for (const [id, fields] of book.written) {
    const row = book.rows.get(id);
    const before = book.initial.get(id);
    const data = {};
    for (const key of fields) data[key] = row[key];
    if (!before) creates.push({ id, ...data });
    else if ([...fields].some((key) => !sameValue(row[key], before[key]))) changes.push({ id, data, row, before });
    else unchanged.push(id);
  }
  const takes = (change, key) => key in change.data && Boolean(change.row[key]) && !sameValue(change.row[key], change.before[key]);
  const taken = Object.fromEntries(ALERT_LINKS.map((key) => [key, new Set()]));
  for (const row of creates) for (const key of ALERT_LINKS) if (row[key]) taken[key].add(row[key]);
  const first = [];
  const then = [];
  for (const change of changes) {
    if (ALERT_LINKS.some((key) => takes(change, key))) {
      then.push(change);
      for (const key of ALERT_LINKS) if (takes(change, key)) taken[key].add(change.row[key]);
    } else {
      first.push(change);
    }
  }
  const released = [];
  for (const change of then) {
    const release = {};
    for (const key of ALERT_LINKS) {
      if (change.before[key] && !sameValue(change.row[key], change.before[key]) && taken[key].has(change.before[key])) release[key] = null;
    }
    if (Object.keys(release).length) released.push({ id: change.id, data: release });
  }

  const groups = new Map();
  for (const { id, data } of [...first, ...released]) {
    const key = payloadKey(data);
    if (!groups.has(key)) groups.set(key, { data, ids: [] });
    groups.get(key).ids.push(id);
  }
  if (unchanged.length) groups.set('updatedAt', { data: { updatedAt: now }, ids: unchanged });
  for (const { data, ids } of groups.values()) {
    if (ids.length > 1 && model.updateMany) await model.updateMany({ where: { id: { in: ids } }, data });
    else for (const id of ids) await model.update({ where: { id }, data });
  }
  for (const { id, data } of then) await model.update({ where: { id }, data });
  if (creates.length > 1 && model.createMany) await model.createMany({ data: creates });
  else for (const data of creates) await model.create({ data });
};

/** The scopes of many lines, materials and packages, each named once; one read for the lines' materials. */
const scopesOf = async (tx, projectId, { lines = [], materials = [], packages = [] }) => {
  const scopes = new Map();
  const add = (scope) => {
    if (!scopes.has(scopeName(scope))) scopes.set(scopeName(scope), scope);
  };
  for (const packageRow of packages) add({ kind: 'package', id: packageRow.id });
  for (const material of materials) {
    add(
      material.procurementPackageId
        ? { kind: 'package', id: material.procurementPackageId }
        : { kind: 'material', id: material.id },
    );
  }
  const ownerIds = [
    ...new Set(lines.filter((line) => !line.packageId && line.activityMaterialId).map((line) => line.activityMaterialId)),
  ];
  const owners = ownerIds.length
    ? await findRows(tx, 'activityMaterial', {
        where: { id: { in: ownerIds }, projectId },
        select: { id: true, procurementPackageId: true },
      })
    : [];
  const packageOfMaterial = new Map(owners.map((row) => [row.id, row.procurementPackageId || null]));
  for (const line of lines) {
    if (line.packageId) add({ kind: 'package', id: line.packageId });
    else if (line.activityMaterialId) {
      const packageId = packageOfMaterial.get(line.activityMaterialId);
      add(packageId ? { kind: 'package', id: packageId } : { kind: 'material', id: line.activityMaterialId });
    } else add({ kind: 'line', id: line.id });
  }
  return [...scopes.values()];
};

/**
 * Brings up to date the alert of every scope the given lines, materials and
 * packages belong to — each scope ONCE (CERT-2, round 6) — reading the
 * scopes' members and alerts together, not scope by scope (CERT-2,
 * availability-7).
 *
 * Working a scope reads every member of it. Round 5 worked the scope again
 * for every line written, inside the writer's five-second transaction: a
 * 180-line order on one package read the package's lines 180 times and
 * answered 500 (transaction expired), where the commit before created 240
 * lines in 3.5 s, and cancelling 120 lines took 3.1 s where it had taken
 * 0.1 s. A writer of many lines collects them and calls this once, after its
 * loop, with the lines as written.
 *
 * Round 6 then read each scope's members and alerts one scope at a time, ten
 * reads or so a scope: an order whose lines are each on their own package,
 * or on none, is as many scopes as lines, and 220 of them answered 500 again.
 * Every scope's members are now read in three reads, and every alert any
 * scope can look up in one more (alertBook); the scopes are worked in memory,
 * one after another as before, and the alerts that changed are written at the
 * end (writeAlertBook) — a handful of statements for any number of scopes
 * when the changes are alike (every line of a cancelled order resolved).
 *
 * Alerts of another scope that point at one of them are worked again too:
 * what made it their worst may just have changed — a material taken off
 * their package, a line delivered. They are read with the scopes' own alerts,
 * before any scope takes its links back, and worked after the scopes of the
 * subjects (their members and alerts read then, when there are any).
 */
const syncLeadTimeAlerts = async ({
  tx = prisma,
  projectId,
  project,
  lines = [],
  materials = [],
  packages = [],
}) => {
  if (!tx.procurementLeadTimeAlert?.findFirst) return [];
  const subjects = {
    lines: (lines || []).filter(Boolean),
    materials: (materials || []).filter(Boolean),
    packages: (packages || []).filter(Boolean),
  };
  const scopes = await scopesOf(tx, projectId, subjects);
  if (!scopes.length) return [];

  const lineIds = [...new Set(subjects.lines.map((line) => line.id))];
  const materialIds = [
    ...new Set(
      [...subjects.materials.map((material) => material.id), ...subjects.lines.map((line) => line.activityMaterialId)].filter(Boolean),
    ),
  ];
  const book = alertBook();
  // Each scope's members, and every link the scopes can look an alert up by:
  // their own, their members', what their members were ordered against.
  const readScopes = async (list, also = {}) => {
    const membersOf = await membersOfScopes(tx, projectId, list);
    const members = list.map(membersOf);
    const links = {
      packageIds: list.filter((scope) => scope.kind === 'package').map((scope) => scope.id),
      materialIds: new Set([...(also.materialIds || []), ...list.filter((scope) => scope.kind === 'material').map((scope) => scope.id)]),
      lineIds: new Set([...(also.lineIds || []), ...list.filter((scope) => scope.kind === 'line').map((scope) => scope.id)]),
    };
    for (const { materials: planned, lines: delivering } of members) {
      for (const material of planned) links.materialIds.add(material.id);
      for (const line of delivering) {
        links.lineIds.add(line.id);
        if (line.activityMaterialId) links.materialIds.add(line.activityMaterialId);
      }
    }
    const found = await readAlerts(tx, projectId, links);
    book.add(found);
    return { members, found };
  };
  // With the subjects' links too: the alerts that point at a subject, as they
  // stand before any scope takes its links back.
  const first = await readScopes(scopes, { lineIds, materialIds });
  const subjectLines = new Set(lineIds);
  const subjectMaterials = new Set(materialIds);
  const pointing = first.found.filter(
    (alert) => subjectLines.has(alert.poLineId) || subjectMaterials.has(alert.activityMaterialId),
  );
  const done = new Set(scopes.map(scopeName));
  const others = [];
  const known = new Map(subjects.lines.map((line) => [line.id, line]));
  for (const otherScope of pointing.length ? await scopesOfAlerts(tx, projectId, pointing, known) : []) {
    if (!otherScope || done.has(scopeName(otherScope))) continue;
    done.add(scopeName(otherScope));
    others.push(otherScope);
  }
  const worked = [...scopes, ...others];
  const members = others.length ? [...first.members, ...(await readScopes(others)).members] : first.members;

  const now = new Date();
  const synced = [];
  worked.forEach((scope, index) => {
    const alert = syncScopeInBook({ book, projectId, project, scope, members: members[index], now });
    if (index < scopes.length) synced.push(alert);
  });
  await writeAlertBook(tx, book, now);
  return synced;
};

/** One line, material or package: its scope's alert, as syncLeadTimeAlerts brings it up to date. */
const syncLeadTimeAlert = async ({
  tx = prisma,
  projectId,
  project,
  line = null,
  material = null,
  packageRow = null,
}) => {
  const subject = packageRow
    ? { packages: [packageRow] }
    : material
      ? { materials: [material] }
      : line
        ? { lines: [line] }
        : null;
  if (!subject) return null;
  const [alert = null] = await syncLeadTimeAlerts({ tx, projectId, project, ...subject });
  return alert;
};

/**
 * Before order lines or materials are deleted — with the activity they are
 * on: the database cascades both, and every alert linked to them with them
 * (CERT-2, round 6). An alert that only POINTS at one of them gives the link
 * up, so the alert of a package, or of a material, outlives the member that
 * was its worst risk: deleting that member's activity deleted the package's
 * whole alert while another line on it was five days late. The alert that is
 * the line's or the material's own goes with it — it is about nothing now.
 *
 * Returns what to work again once they are gone (syncReleasedLeadTimeAlerts):
 * the packages they were on, the materials the lines were ordered against,
 * and the lines ordered against the materials.
 */
const releaseLeadTimeAlertLinks = async ({ tx = prisma, projectId, lineIds = [], materialIds = [] }) => {
  const released = { lineIds: [...new Set(lineIds)], materialIds: [...new Set(materialIds)], packageIds: [], survivingMaterialIds: [], survivingLineIds: [] };
  if (!tx.procurementLeadTimeAlert?.findMany || (!released.lineIds.length && !released.materialIds.length)) return released;
  const goneLines = new Set(released.lineIds);
  const goneMaterials = new Set(released.materialIds);
  const lines = goneLines.size
    ? await findRows(tx, 'procurementPoLine', {
        where: { projectId, id: { in: released.lineIds } },
        select: { id: true, packageId: true, activityMaterialId: true },
      })
    : [];
  const materials = goneMaterials.size
    ? await findRows(tx, 'activityMaterial', {
        where: { projectId, id: { in: released.materialIds } },
        select: { id: true, procurementPackageId: true },
      })
    : [];
  const orderedAgainst = goneMaterials.size
    ? await findRows(tx, 'procurementPoLine', {
        where: { projectId, activityMaterialId: { in: released.materialIds } },
        select: { id: true },
      })
    : [];
  released.packageIds = [
    ...new Set([...lines.map((line) => line.packageId), ...materials.map((material) => material.procurementPackageId)].filter(Boolean)),
  ];
  released.survivingMaterialIds = [
    ...new Set(lines.map((line) => line.activityMaterialId).filter((id) => id && !goneMaterials.has(id))),
  ];
  released.survivingLineIds = orderedAgainst.map((line) => line.id).filter((id) => !goneLines.has(id));

  const links = [];
  if (goneLines.size) links.push({ poLineId: { in: released.lineIds } });
  if (goneMaterials.size) links.push({ activityMaterialId: { in: released.materialIds } });
  const pointing = await findRows(tx, 'procurementLeadTimeAlert', { where: { projectId, OR: links } });
  for (const alert of pointing) {
    const own = ownKeyOf(alert);
    if ((own === 'poLineId' && goneLines.has(alert.poLineId)) || (own === 'activityMaterialId' && goneMaterials.has(alert.activityMaterialId))) {
      continue;
    }
    const release = {};
    if (goneLines.has(alert.poLineId)) release.poLineId = null;
    if (goneMaterials.has(alert.activityMaterialId)) release.activityMaterialId = null;
    await tx.procurementLeadTimeAlert.update({ where: { id: alert.id }, data: release });
    if (alert.packageId) released.packageIds = [...new Set([...released.packageIds, alert.packageId])];
    else if (alert.activityMaterialId && !goneMaterials.has(alert.activityMaterialId)) {
      released.survivingMaterialIds = [...new Set([...released.survivingMaterialIds, alert.activityMaterialId])];
    }
  }
  return released;
};

/** After the delete: every scope the deleted lines and materials were in, worked again once. */
const syncReleasedLeadTimeAlerts = async ({ tx = prisma, projectId, project, released }) => {
  if (!released) return [];
  const materials = released.survivingMaterialIds.length
    ? await findRows(tx, 'activityMaterial', {
        where: { projectId, id: { in: released.survivingMaterialIds } },
        select: { id: true, procurementPackageId: true },
      })
    : [];
  const lines = released.survivingLineIds.length
    ? await findRows(tx, 'procurementPoLine', {
        where: { projectId, id: { in: released.survivingLineIds } },
        select: { id: true, packageId: true, activityMaterialId: true },
      })
    : [];
  return syncLeadTimeAlerts({
    tx,
    projectId,
    project,
    lines,
    materials,
    packages: released.packageIds.map((id) => ({ id })),
  });
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

/**
 * The next order number on this project.
 *
 * Making a buyer invent one is duplicate entry of the worst kind: the system
 * knows every reference it has ever issued and the person does not, so they
 * keep a list somewhere else and two of them working the same afternoon
 * collide (OCTA-UX-PODUP-102). A reference typed by hand is still honoured —
 * some organisations number orders from a finance system — but nobody has to.
 *
 * Only generated references are counted, so a hand-typed "PO-STEEL-REV2"
 * cannot push the sequence somewhere strange.
 *
 * This read `MAX(ref) + 1` until Phase 20.6. Two buyers raising an order in
 * the same moment read the same maximum and computed the same reference, and
 * the second lost on the unique index on (projectId, ref) with an HTTP 500 —
 * which is the collision the docstring above says the generator exists to
 * prevent. Phase 20.5 moved 34 registers off that pattern but missed this one,
 * because it is written in raw SQL rather than the `count + 1` /
 * `_max: { number }` shapes the audit grepped for.
 *
 * `nextRef` advances a counter row in one atomic statement, so the reference
 * is unique before the index is consulted. Seeding is unchanged: only "PO-"
 * followed by digits counts, so a hand-typed "PO-STEEL-REV2" still cannot push
 * the sequence somewhere strange.
 */
const nextOrderRef = async (tx, projectId) =>
  nextRef(tx, {
    table: 'ProcurementOrder',
    column: 'ref',
    scopeColumn: 'projectId',
    scopeId: projectId,
    prefix: 'PO',
    pad: 5,
  });

/**
 * Raise the order for what was awarded.
 *
 * Everything on a purchase order raised after an award is already written
 * down somewhere: the supplier on the winning bid, the lines and units on the
 * package that was priced, the rates the supplier quoted, the date the
 * package is needed on site. Making a buyer copy that across is not just
 * tedious — it is where the order stops matching the award, and the
 * three-way match then has nothing true to compare against
 * (OCTA-UX-PODUP-102).
 *
 * What is inherited and what stays the buyer's:
 *   ref            auto-generated, unless they have their own numbering
 *   supplier       inherited from the winning bid — never retyped
 *   lines          inherited from the priced package lines, at the quoted rate
 *   unit, qty      inherited from the package line
 *   activity       inherited from the package line, or the package
 *   required date  inherited from the package, overridable on the call
 *   lead weeks     inherited from the package, overridable on the call
 */
const raiseOrderFromAward = async ({ orgId, projectId, packageId, actor, payload = {} }) => {
  await ensureProject({ orgId, projectId });

  const pkg = await prisma.procurementPackage.findFirst({
    where: { id: packageId, projectId },
  });
  if (!pkg) {
    throw new HttpError(404, 'PROCUREMENT_PACKAGE_NOT_FOUND', 'Procurement package not found');
  }

  const enquiry = await prisma.bidPackage.findFirst({
    where: { projectId, procurementPackageId: packageId, status: 'awarded' },
    orderBy: { awardedAt: 'desc' },
    include: {
      lines: true,
      bids: {
        include: {
          lines: true,
          // The company sits on the invitation the bid answers, not on the
          // bid itself, and the invitation carries its name directly.
          invitation: { select: { vendorCompanyId: true, companyName: true } },
        },
      },
    },
  });
  if (!enquiry) {
    throw new HttpError(
      409,
      'PROCUREMENT_NO_AWARD',
      'Award a quote for this package before raising the order',
    );
  }

  const winner = (enquiry.bids || []).find((bid) => bid.id === enquiry.awardedBidId);
  if (!winner) {
    throw new HttpError(
      409,
      'PROCUREMENT_AWARD_INCOMPLETE',
      'The awarded quote could not be read back',
    );
  }

  const ratesByLine = new Map((winner.lines || []).map((line) => [line.packageLineId, line]));
  const lines = (enquiry.lines || [])
    .map((line) => {
      const priced = ratesByLine.get(line.id);
      // A bidder may exclude a line. An excluded line was not bought.
      if (priced && priced.included === false) return null;
      return {
        activityId: line.activityId || pkg.activityId,
        description: line.description,
        unit: line.unit || null,
        orderedQty: Number(line.qty) || 0,
        unitCost: priced?.rate === null || priced?.rate === undefined ? 0 : Number(priced.rate),
        packageId,
      };
    })
    .filter((line) => line && line.activityId);

  if (!lines.length) {
    throw new HttpError(
      409,
      'PROCUREMENT_AWARD_NOT_SCHEDULE_LINKED',
      'The awarded lines are not linked to an activity, so the order cannot be traced',
    );
  }

  return createPurchaseOrder({
    orgId,
    projectId,
    actor,
    payload: {
      // The buyer's own reference wins if they gave one; otherwise the
      // project numbers it.
      ref: payload.ref || null,
      item: pkg.title,
      activityId: pkg.activityId || null,
      packageId,
      // The name only. `supplierId` on an order points at a
      // ProcurementSupplier — this project's own supplier record — while the
      // bid names a Company from the directory. They are different things,
      // and passing one for the other is refused as SUPPLIER_NOT_FOUND.
      supplier: winner.invitation?.companyName || null,
      currency: enquiry.currency || pkg.currency || undefined,
      requiredBy:
        payload.requiredBy ||
        (pkg.requiredOnSiteDate
          ? new Date(pkg.requiredOnSiteDate).toISOString().slice(0, 10)
          : undefined),
      leadWeeks:
        payload.leadWeeks === undefined || payload.leadWeeks === null
          ? pkg.leadWeeks ?? undefined
          : payload.leadWeeks,
      notes: payload.notes || null,
      lines,
    },
  });
};

/**
 * An order is one transaction however many lines it carries: every line is
 * checked, written and put on its material, and the alerts of every scope the
 * lines are in are worked once at the end. Prisma's default five-second
 * interactive window was outlived by an order of 500 lines at the baseline
 * commit (500, P2028 transaction expired, on one package, on 500 packages and
 * on none) and by 220 lines each on its own package in round 6 (CERT-2,
 * availability-7). The window of the other batch writers (a delivery,
 * activity bulk progress).
 */
const ORDER_TRANSACTION = Object.freeze({ maxWait: 10_000, timeout: 60_000 });

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

  // What the order is worth fits its value column, a Decimal(18,2): 1e15 of
  // something at 100.00 failed at the write with a 500 (CERT-2). Refused
  // before anything is written.
  const orderValue = payload.lines.reduce(
    (total, line) => total.plus(toMoneyDecimal(line.unitCost || 0).times(Number(line.orderedQty) || 0)),
    toMoneyDecimal(0),
  );
  if (orderValue.greaterThan(MONEY_MAX)) {
    throw new HttpError(400, 'PO_VALUE_TOO_LARGE', 'This order is worth more than an order can record');
  }

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
  await assertLineCoding({ orgId, projectId, lines: payload.lines });

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
    const ref = trimOrNull(payload.ref) || (await nextOrderRef(tx, projectId));
    const order = await tx.procurementOrder.create({
      data: {
        projectId,
        activityId: payload.activityId || null,
        packageId: payload.packageId || null,
        supplierId: payload.supplierId || null,
        commitmentId: payload.commitmentId || null,
        ref,
        item: payload.item || ref,
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
    }

    // Every scope the order's lines are in, worked once, after every line is
    // written (CERT-2, round 6).
    await syncLeadTimeAlerts({ tx, projectId, project, lines: createdLines });

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
  }, ORDER_TRANSACTION);
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
    deliveryReceipts: (order.deliveryReceipts ?? []).map(ownReceipt),
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


/**
 * Ask suppliers to price a procurement package.
 *
 * The comparison itself — inviting suppliers, taking their prices, levelling
 * them side by side, awarding — is what the bid engine already does, and it
 * already understands a purchase order as the thing being awarded. So this does
 * not build a second one: it opens a bid package of the right type, linked back
 * to the procurement package, with the title, currency and due date taken from
 * what the buyer has already said. A buyer asking for quotes should not have to
 * know that the machinery is shared with subcontract tendering, or choose a
 * commitment type to make it behave (OCTA-PROC-QUOTES-084).
 */
const requestQuotes = async ({ orgId, projectId, packageId, actor, payload = {} }) => {
  const pkg = await prisma.procurementPackage.findFirst({
    where: { id: packageId, projectId, project: { orgId } },
    select: {
      id: true,
      packageNumber: true,
      title: true,
      description: true,
      requiredOnSiteDate: true,
      latestOrderDate: true,
      project: { select: { currency: true } },
    },
  });
  if (!pkg) {
    throw new HttpError(404, 'PROCUREMENT_PACKAGE_NOT_FOUND', 'Procurement package not found');
  }

  const bidService = require('./bid.service');
  return bidService.createPackage({
    orgId,
    projectId,
    actor,
    payload: {
      // Inherited, not retyped.
      title: payload.title || `${pkg.packageNumber} ${pkg.title}`,
      description: payload.description ?? pkg.description ?? null,
      instructions: payload.instructions ?? null,
      // Quotes are wanted by the date the buyer has to place the order.
      dueAt: payload.dueAt ?? pkg.latestOrderDate ?? null,
      currency: payload.currency || pkg.project?.currency || 'USD',
      // Materials, not a subcontract — chosen here so the buyer never has to.
      commitmentType: 'purchase_order',
      procurementPackageId: pkg.id,
      ...(payload.boqSections ? { boqSections: payload.boqSections } : {}),
    },
  });
};

/** The quote enquiries raised for a procurement package. */
const listQuotes = async ({ orgId, projectId, packageId }) => {
  const packages = await prisma.bidPackage.findMany({
    where: { orgId, projectId, procurementPackageId: packageId },
    select: {
      id: true,
      ref: true,
      title: true,
      status: true,
      dueAt: true,
      currency: true,
      commitmentType: true,
      createdAt: true,
      _count: { select: { invitations: true, bids: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return {
    packageId,
    items: packages.map((row) => ({
      ...row,
      invitedSuppliers: row._count.invitations,
      quotesReceived: row._count.bids,
      _count: undefined,
    })),
  };
};

module.exports = {
  requestQuotes,
  listQuotes,
  ACTIVITY_SELECT,
  // Exported so the concurrency property can be tested directly rather than
  // inferred from raising an order (Phase 20.6).
  nextOrderRef,
  acknowledgeLeadTimeAlert,
  buildMaterialRiskRow,
  buildPackageRiskRow,
  buildLineRiskRow,
  createPackage,
  createPurchaseOrder,
  isOnSettledOrder,
  raiseOrderFromAward,
  createSupplier,
  enrichActivityMaterial,
  enrichActivityMaterials,
  getProcurementOverview,
  listLeadTimeAlerts,
  listPackages,
  listPurchaseOrders,
  listSuppliers,
  recordActivityMaterialUsage,
  releaseLeadTimeAlertLinks,
  resolveLeadTimeAlert,
  syncLeadTimeAlert,
  syncLeadTimeAlerts,
  syncReleasedLeadTimeAlerts,
  updateLeadTimeAlert,
};
