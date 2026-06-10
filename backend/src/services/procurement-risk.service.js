const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BUFFER_DAYS = 14;

const SEVERITY_RANK = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const CLEAR_WAREHOUSE_STATUSES = new Set(['received', 'issued']);
const PARTIAL_WAREHOUSE_STATUSES = new Set(['partial']);
const DELIVERED_STATUSES = new Set([
  'delivered',
  'received',
  'issued',
  'complete',
  'closed',
]);
const NOT_ORDERED_STATUSES = new Set([
  'not_ordered',
  'not ordered',
  'planned',
  'draft',
]);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'void']);

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addDays(date, days) {
  const normalized = normalizeDate(date);
  if (!normalized) return null;
  const result = new Date(normalized);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function subtractDays(date, days) {
  return addDays(date, -days);
}

function diffDays(later, earlier) {
  const laterDate = normalizeDate(later);
  const earlierDate = normalizeDate(earlier);
  if (!laterDate || !earlierDate) return null;
  return Math.ceil((laterDate.getTime() - earlierDate.getTime()) / DAY_MS);
}

function toPositiveInt(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isCriticalValue(value) {
  return ['critical', 'high'].includes(lower(value));
}

function isScheduleCritical(row) {
  return Boolean(
    row?.activity?.isCritical ||
      isCriticalValue(row?.criticality) ||
      toPositiveInt(row?.leadWeeks) >= 12,
  );
}

function deriveActivityDate({ activity, projectStartDate, requiredTiming }) {
  if (!activity) return null;

  const useFinish = requiredTiming === 'activity_finish';
  const directDate = normalizeDate(useFinish ? activity.endDate : activity.startDate);
  if (directDate) return directDate;

  const offset = useFinish
    ? (activity.earlyFinish ??
      activity.baselineFinish ??
      activity.lateFinish)
    : (activity.earlyStart ?? activity.baselineStart ?? activity.lateStart);

  const numericOffset = Number(offset);
  if (!Number.isFinite(numericOffset)) return null;

  const start = normalizeDate(projectStartDate);
  if (!start) return null;

  return addDays(start, Math.round(numericOffset));
}

function calculateNeedDate(row, project) {
  const requiredTiming =
    row?.requiredTiming === 'activity_finish'
      ? 'activity_finish'
      : 'activity_start';
  const activityDate = deriveActivityDate({
    activity: row?.activity,
    projectStartDate: project?.startDate,
    requiredTiming,
  });
  if (!activityDate) return null;

  return subtractDays(activityDate, toPositiveInt(row?.needOffsetDays));
}

function calculateOrderByDate({ needDate, leadWeeks, bufferDays }) {
  const normalizedNeedDate = normalizeDate(needDate);
  if (!normalizedNeedDate) return null;

  const leadDays = toPositiveInt(leadWeeks) * 7;
  const buffer = toPositiveInt(bufferDays, DEFAULT_BUFFER_DAYS);
  return subtractDays(normalizedNeedDate, leadDays + buffer);
}

function isWarehouseClear(row) {
  return CLEAR_WAREHOUSE_STATUSES.has(lower(row?.warehouseStatus));
}

function isWarehousePartial(row) {
  return PARTIAL_WAREHOUSE_STATUSES.has(lower(row?.warehouseStatus));
}

function isDelivered(row) {
  return Boolean(
    row?.deliveredAt ||
      row?.receivedAt ||
      row?.issuedAt ||
      DELIVERED_STATUSES.has(lower(row?.status)) ||
      CLEAR_WAREHOUSE_STATUSES.has(lower(row?.warehouseStatus)),
  );
}

function isOrdered(row) {
  const status = lower(row?.status);
  if (!status) return false;
  if (NOT_ORDERED_STATUSES.has(status) || CANCELLED_STATUSES.has(status)) {
    return false;
  }
  return true;
}

function buildRisk({
  severity,
  reason,
  daysAtRisk = 0,
  needDate,
  orderByDate,
  expectedDeliveryDate,
  deliverySlipDays = 0,
  orderBySlackDays = null,
  needSlackDays = null,
  flags = [],
  row,
}) {
  const normalizedSeverity = severity || 'none';
  return {
    severity: normalizedSeverity,
    reason,
    isAtRisk: SEVERITY_RANK[normalizedSeverity] >= SEVERITY_RANK.medium,
    daysAtRisk: Math.max(0, Number(daysAtRisk) || 0),
    deliverySlipDays: Math.max(0, Number(deliverySlipDays) || 0),
    orderBySlackDays,
    needSlackDays,
    needDate,
    orderByDate,
    expectedDeliveryDate,
    flags,
    impactedActivity: row?.activity
      ? {
          id: row.activity.id,
          name: row.activity.name,
          wbsCode: row.activity.wbsCode || null,
          isCritical: Boolean(row.activity.isCritical),
          totalFloat: row.activity.totalFloat ?? null,
        }
      : null,
  };
}

function computeProcurementRisk(row, { project, today = new Date() } = {}) {
  const todayDate = normalizeDate(today) || normalizeDate(new Date());
  const leadWeeks = toPositiveInt(row?.leadWeeks);
  const bufferDays = toPositiveInt(row?.bufferDays, DEFAULT_BUFFER_DAYS);
  const needDate =
    normalizeDate(row?.needDate) ||
    normalizeDate(row?.requiredDate) ||
    calculateNeedDate(row, project);
  const orderByDate = calculateOrderByDate({
    needDate,
    leadWeeks,
    bufferDays,
  });
  const expectedDeliveryDate =
    normalizeDate(row?.expectedDeliveryDate) ||
    normalizeDate(row?.promisedDate) ||
    normalizeDate(row?.deliveryDate) ||
    normalizeDate(row?.deliveredAt);
  const scheduleCritical = isScheduleCritical(row);
  const orderBySlackDays = orderByDate ? diffDays(orderByDate, todayDate) : null;
  const needSlackDays = needDate ? diffDays(needDate, todayDate) : null;
  const deliverySlipDays =
    expectedDeliveryDate && needDate
      ? Math.max(0, diffDays(expectedDeliveryDate, needDate) || 0)
      : 0;
  const flags = [];

  if (isWarehouseClear(row)) {
    return buildRisk({
      severity: 'none',
      reason: lower(row?.warehouseStatus) === 'issued' ? 'issued' : 'received',
      needDate,
      orderByDate,
      expectedDeliveryDate,
      deliverySlipDays,
      orderBySlackDays,
      needSlackDays,
      flags: ['warehouse_clear'],
      row,
    });
  }

  if (!row?.activityId && !row?.activity) {
    if (scheduleCritical) {
      return buildRisk({
        severity: 'high',
        reason: 'missing_activity_link',
        needDate,
        orderByDate,
        expectedDeliveryDate,
        orderBySlackDays,
        needSlackDays,
        flags: ['missing_activity_link'],
        row,
      });
    }

    return buildRisk({
      severity: 'none',
      reason: 'not_schedule_linked',
      needDate,
      orderByDate,
      expectedDeliveryDate,
      orderBySlackDays,
      needSlackDays,
      row,
    });
  }

  if (!needDate || !orderByDate) {
    flags.push('missing_schedule_dates');
    return buildRisk({
      severity: scheduleCritical ? 'medium' : 'low',
      reason: 'missing_schedule_dates',
      needDate,
      orderByDate,
      expectedDeliveryDate,
      orderBySlackDays,
      needSlackDays,
      flags,
      row,
    });
  }

  if (deliverySlipDays > 0) {
    flags.push('delivery_after_need');
    const severity =
      scheduleCritical || deliverySlipDays > 14 ? 'critical' : 'high';
    return buildRisk({
      severity,
      reason: 'delivery_after_need',
      daysAtRisk: deliverySlipDays,
      needDate,
      orderByDate,
      expectedDeliveryDate,
      deliverySlipDays,
      orderBySlackDays,
      needSlackDays,
      flags,
      row,
    });
  }

  if (isDelivered(row)) {
    flags.push(isWarehousePartial(row) ? 'partial_receipt' : 'pending_receipt');
    if (isWarehousePartial(row)) {
      return buildRisk({
        severity: needSlackDays !== null && needSlackDays <= 3 ? 'medium' : 'low',
        reason: 'partial_receipt',
        needDate,
        orderByDate,
        expectedDeliveryDate,
        deliverySlipDays,
        orderBySlackDays,
        needSlackDays,
        flags,
        row,
      });
    }

    return buildRisk({
      severity: needSlackDays !== null && needSlackDays <= 0 ? 'high' : 'low',
      reason: 'pending_warehouse_receipt',
      needDate,
      orderByDate,
      expectedDeliveryDate,
      deliverySlipDays,
      orderBySlackDays,
      needSlackDays,
      flags,
      row,
    });
  }

  if (expectedDeliveryDate && diffDays(todayDate, expectedDeliveryDate) > 0) {
    const daysLate = diffDays(todayDate, expectedDeliveryDate) || 0;
    flags.push('delivery_overdue');
    return buildRisk({
      severity: scheduleCritical || daysLate > 7 ? 'critical' : 'high',
      reason: 'delivery_overdue',
      daysAtRisk: daysLate,
      needDate,
      orderByDate,
      expectedDeliveryDate,
      deliverySlipDays,
      orderBySlackDays,
      needSlackDays,
      flags,
      row,
    });
  }

  if (!isOrdered(row)) {
    if (orderBySlackDays !== null && orderBySlackDays < 0) {
      const daysLate = Math.abs(orderBySlackDays);
      flags.push('order_by_missed');
      return buildRisk({
        severity: scheduleCritical || daysLate > 7 ? 'critical' : 'high',
        reason: 'order_by_missed',
        daysAtRisk: daysLate,
        needDate,
        orderByDate,
        expectedDeliveryDate,
        deliverySlipDays,
        orderBySlackDays,
        needSlackDays,
        flags,
        row,
      });
    }

    if (orderBySlackDays !== null && orderBySlackDays <= 7) {
      flags.push('order_by_due');
      return buildRisk({
        severity: scheduleCritical ? 'medium' : 'low',
        reason: 'order_by_due',
        needDate,
        orderByDate,
        expectedDeliveryDate,
        deliverySlipDays,
        orderBySlackDays,
        needSlackDays,
        flags,
        row,
      });
    }
  }

  if (isOrdered(row) && !expectedDeliveryDate) {
    flags.push('missing_delivery_commitment');
    return buildRisk({
      severity: scheduleCritical ? 'medium' : 'low',
      reason: 'missing_delivery_commitment',
      needDate,
      orderByDate,
      expectedDeliveryDate,
      deliverySlipDays,
      orderBySlackDays,
      needSlackDays,
      flags,
      row,
    });
  }

  if (needSlackDays !== null && needSlackDays <= 7) {
    flags.push('need_date_approaching');
    return buildRisk({
      severity: scheduleCritical ? 'medium' : 'low',
      reason: 'need_date_approaching',
      needDate,
      orderByDate,
      expectedDeliveryDate,
      deliverySlipDays,
      orderBySlackDays,
      needSlackDays,
      flags,
      row,
    });
  }

  return buildRisk({
    severity: 'none',
    reason: 'on_track',
    needDate,
    orderByDate,
    expectedDeliveryDate,
    deliverySlipDays,
    orderBySlackDays,
    needSlackDays,
    row,
  });
}

function serializeDate(date) {
  const normalized = normalizeDate(date);
  return normalized ? normalized.toISOString() : null;
}

function serializeProcurementRisk(risk) {
  return {
    ...risk,
    needDate: serializeDate(risk.needDate),
    orderByDate: serializeDate(risk.orderByDate),
    expectedDeliveryDate: serializeDate(risk.expectedDeliveryDate),
  };
}

function enrichProcurementRow(row, options = {}) {
  return {
    ...row,
    procurementRisk: serializeProcurementRisk(
      computeProcurementRisk(row, options),
    ),
  };
}

function summarizeProcurementRisks(rows, options = {}) {
  const risks = rows.map((row) => ({
    row,
    risk: computeProcurementRisk(row, options),
  }));

  const bySeverity = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
  };
  let daysAtRisk = 0;

  risks.forEach(({ risk }) => {
    bySeverity[risk.severity] += 1;
    daysAtRisk += risk.daysAtRisk || 0;
  });

  const penalty =
    bySeverity.critical * 25 +
    bySeverity.high * 15 +
    bySeverity.medium * 8 +
    bySeverity.low * 3;
  const atRiskItems =
    bySeverity.critical + bySeverity.high + bySeverity.medium;

  const topRisks = risks
    .filter(({ risk }) => risk.isAtRisk)
    .sort((a, b) => {
      const severityDelta =
        SEVERITY_RANK[b.risk.severity] - SEVERITY_RANK[a.risk.severity];
      if (severityDelta !== 0) return severityDelta;
      return (b.risk.daysAtRisk || 0) - (a.risk.daysAtRisk || 0);
    })
    .slice(0, 5)
    .map(({ row, risk }) => ({
      id: row.id,
      item: row.item,
      source: row.ref ? 'procurement_order' : 'long_lead',
      ref: row.ref || null,
      severity: risk.severity,
      reason: risk.reason,
      daysAtRisk: risk.daysAtRisk,
      needDate: serializeDate(risk.needDate),
      orderByDate: serializeDate(risk.orderByDate),
      expectedDeliveryDate: serializeDate(risk.expectedDeliveryDate),
      impactedActivity: risk.impactedActivity,
    }));

  return {
    bySeverity,
    atRiskItems,
    daysAtRisk,
    penalty,
    topRisks,
  };
}

module.exports = {
  DEFAULT_BUFFER_DAYS,
  SEVERITY_RANK,
  calculateNeedDate,
  calculateOrderByDate,
  computeProcurementRisk,
  deriveActivityDate,
  enrichProcurementRow,
  serializeDate,
  serializeProcurementRisk,
  summarizeProcurementRisks,
};
