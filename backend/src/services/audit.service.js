const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const ENTITY_TYPES = Object.freeze({
  SCHEDULE_REVISION: 'schedule_revision',
  PROGRESS_SUBMISSION: 'progress_submission',
  DAILY_REPORT: 'daily_report',
  SITE_DIARY: 'site_diary',
  IPC_CERTIFICATE: 'ipc_certificate',
  IPC_ITEM: 'ipc_item',
  CHANGE_ORDER: 'change_order',
  SUB_VALUATION: 'sub_valuation',
  EOT_CLAIM: 'eot_claim',
  WEATHER_DELAY: 'weather_delay',
  BOQ_ITEM: 'boq_item',
  BOQ_REVISION: 'boq_revision',
  COST_RECORD: 'cost_record',
  BURN_RATE_ENTRY: 'burn_rate_entry',
  PROCUREMENT_SUPPLIER: 'procurement_supplier',
  PROCUREMENT_PACKAGE: 'procurement_package',
  PROCUREMENT_ORDER: 'procurement_order',
  DELIVERY_RECEIPT: 'delivery_receipt',
  ACTIVITY_MATERIAL_USAGE: 'activity_material_usage',
  PROCUREMENT_ALERT: 'procurement_alert',
  RFI: 'rfi',
  SUBMITTAL: 'submittal',
});

const ACTIONS = Object.freeze({
  CREATED: 'created',
  UPDATED: 'updated',
  STATUS_CHANGED: 'status_changed',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  BASELINE_LOCKED: 'baseline_locked',
  CERTIFIED: 'certified',
  DELETED: 'deleted',
  SUPERSEDED: 'superseded',
  IMPORTED: 'imported',
});

const SENSITIVE_KEY = /(password|secret|token|apikey|api_key|authorization|cookie|credential|hash)/i;
const MAX_DEPTH = 4;
const MAX_KEYS = 50;
const MAX_ARRAY_ITEMS = 25;
const MAX_STRING_LENGTH = 1000;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const compactString = (value) =>
  value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...`
    : value;

const compactJson = (value, depth = 0) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'string') return compactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return String(value);

  if (depth >= MAX_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    const rows = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => compactJson(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      rows.push({ truncatedCount: value.length - MAX_ARRAY_ITEMS });
    }
    return rows;
  }

  return Object.entries(value)
    .slice(0, MAX_KEYS)
    .reduce((acc, [key, raw]) => {
      acc[key] = SENSITIVE_KEY.test(key)
        ? '[redacted]'
        : compactJson(raw, depth + 1);
      return acc;
    }, {});
};

const hasValue = (value) => value !== null && value !== undefined;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const sameJsonValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const buildChangeSet = (oldSnapshot, newSnapshot) => {
  if (!isPlainObject(oldSnapshot) || !isPlainObject(newSnapshot)) return {};

  return Array.from(
    new Set([...Object.keys(oldSnapshot), ...Object.keys(newSnapshot)]),
  )
    .slice(0, MAX_KEYS)
    .reduce((acc, key) => {
      const before = oldSnapshot[key] ?? null;
      const after = newSnapshot[key] ?? null;
      if (!sameJsonValue(before, after)) {
        acc[key] = { before, after };
      }
      return acc;
    }, {});
};

const hasObjectKeys = (value) =>
  isPlainObject(value) && Object.keys(value).length > 0;

const selectSnapshot = ({ action, oldSummaryJson, newSummaryJson, summaryJson }) => {
  if (newSummaryJson) return newSummaryJson;
  if (action === ACTIONS.DELETED && oldSummaryJson) return oldSummaryJson;
  if (hasObjectKeys(summaryJson)) return summaryJson;
  return oldSummaryJson || {};
};

const serializeEvent = (event) => ({
  id: event.id,
  orgId: event.orgId,
  projectId: event.projectId,
  entityType: event.entityType,
  entityId: event.entityId,
  action: event.action,
  actorId: event.actorId || null,
  actorRole: event.actorRole || null,
  occurredAt: event.occurredAt?.toISOString?.() || event.occurredAt,
  oldStatus: event.oldStatus || null,
  newStatus: event.newStatus || null,
  reason: event.reason || null,
  oldSummary: event.oldSummaryJson || null,
  newSummary: event.newSummaryJson || null,
  summary: event.summaryJson || {},
  attachments: event.attachmentsJson || [],
  metadata: event.metadataJson || {},
  createdAt: event.createdAt?.toISOString?.() || event.createdAt,
});

const recordEvent = async ({
  tx = prisma,
  orgId,
  projectId,
  entityType,
  entityId,
  action,
  actorId = null,
  actorRole = null,
  occurredAt = new Date(),
  oldStatus = null,
  newStatus = null,
  reason = null,
  oldSummary = null,
  newSummary = null,
  summary = {},
  attachments = [],
  metadata = {},
}) => {
  if (!orgId || !projectId || !entityType || !entityId || !action) {
    throw new HttpError(
      400,
      'AUDIT_EVENT_INVALID',
      'Audit events require org, project, entity, and action metadata',
    );
  }

  const oldSummaryJson = hasValue(oldSummary) ? compactJson(oldSummary) : null;
  const newSummaryJson = hasValue(newSummary) ? compactJson(newSummary) : null;
  const summaryJson = compactJson(summary) || {};
  const attachmentsJson = compactJson(attachments) || [];
  const metadataJson = compactJson(metadata) || {};

  const event = await tx.auditEvent.create({
    data: {
      orgId,
      projectId,
      entityType,
      entityId,
      action,
      actorId: actorId || null,
      actorRole: actorRole || null,
      occurredAt,
      oldStatus: trimOrNull(oldStatus),
      newStatus: trimOrNull(newStatus),
      reason: trimOrNull(reason),
      oldSummaryJson,
      newSummaryJson,
      summaryJson,
      attachmentsJson,
      metadataJson,
    },
  });

  if (tx.recordHistorySnapshot?.create) {
    const snapshotJson = selectSnapshot({
      action,
      oldSummaryJson,
      newSummaryJson,
      summaryJson,
    });
    await tx.recordHistorySnapshot.create({
      data: {
        orgId,
        projectId,
        entityType,
        entityId,
        action,
        actorId: actorId || null,
        actorRole: actorRole || null,
        auditEventId: event.id,
        occurredAt,
        oldStatus: trimOrNull(oldStatus),
        newStatus: trimOrNull(newStatus),
        reason: trimOrNull(reason),
        previousSnapshotJson: oldSummaryJson,
        snapshotJson,
        changeSetJson: buildChangeSet(oldSummaryJson, snapshotJson),
        metadataJson,
      },
    });
  }

  return serializeEvent(event);
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
};

const listEvents = async ({
  orgId,
  projectId,
  entityType = null,
  entityId = null,
  action = null,
  cursor = null,
  limit = 50,
  order = 'asc',
}) => {
  await ensureProject({ orgId, projectId });

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const direction = order === 'desc' ? 'desc' : 'asc';
  const where = { orgId, projectId };
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (action) where.action = action;

  const rows = await prisma.auditEvent.findMany({
    where,
    orderBy: [{ occurredAt: direction }, { id: direction }],
    take: safeLimit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > safeLimit;
  const events = rows.slice(0, safeLimit).map(serializeEvent);

  return {
    events,
    nextCursor: hasMore ? events[events.length - 1]?.id || null : null,
  };
};

module.exports = {
  ACTIONS,
  ENTITY_TYPES,
  buildChangeSet,
  compactJson,
  listEvents,
  recordEvent,
  serializeEvent,
};
