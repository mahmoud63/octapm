const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");

const ENTITY_TYPES = Object.freeze({
  SCHEDULE_REVISION: "schedule_revision",
  PROGRESS_SUBMISSION: "progress_submission",
  DAILY_REPORT: "daily_report",
  SITE_DIARY: "site_diary",
  IPC_CERTIFICATE: "ipc_certificate",
  IPC_ITEM: "ipc_item",
  CHANGE_ORDER: "change_order",
  SUB_VALUATION: "sub_valuation",
  EOT_CLAIM: "eot_claim",
  WEATHER_DELAY: "weather_delay",
  BOQ_ITEM: "boq_item",
  BOQ_REVISION: "boq_revision",
  COST_RECORD: "cost_record",
  BURN_RATE_ENTRY: "burn_rate_entry",
  PROCUREMENT_SUPPLIER: "procurement_supplier",
  PROCUREMENT_PACKAGE: "procurement_package",
  PROCUREMENT_ORDER: "procurement_order",
  DELIVERY_RECEIPT: "delivery_receipt",
  ACTIVITY_MATERIAL_USAGE: "activity_material_usage",
  ACTIVITY_EQUIPMENT_USAGE: "activity_equipment_usage",
  PROCUREMENT_ALERT: "procurement_alert",
  PROJECT: "project",
  RFI: "rfi",
  SUBMITTAL: "submittal",
  DOCUMENT_REVISION: "document_revision",
  PROJECT_SETUP_READINESS: "project_setup_readiness",
  RISK: "risk",
  MEETING: "meeting",
  TASK: "task",
  SAFETY_INCIDENT: "safety_incident",
});

const ACTIONS = Object.freeze({
  CREATED: "created",
  UPDATED: "updated",
  STATUS_CHANGED: "status_changed",
  APPROVED: "approved",
  REJECTED: "rejected",
  BASELINE_LOCKED: "baseline_locked",
  CERTIFIED: "certified",
  DELETED: "deleted",
  ARCHIVED: "archived",
  SUPERSEDED: "superseded",
  IMPORTED: "imported",
  OVERRIDDEN: "overridden",
});

const HISTORY_SOURCES = Object.freeze({
  AUDIT: "audit",
  APPROVAL: "approval",
  STATUS: "status",
});

const SENSITIVE_KEY =
  /(password|secret|token|apikey|api_key|authorization|cookie|credential|hash)/i;
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

  if (typeof value === "string") return compactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return String(value);

  if (depth >= MAX_DEPTH) return "[truncated]";

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
        ? "[redacted]"
        : compactJson(raw, depth + 1);
      return acc;
    }, {});
};

const hasValue = (value) => value !== null && value !== undefined;

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

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

const toArray = (value) => (Array.isArray(value) ? value : []);

const normalizeSourceFilter = (source) => {
  if (!source || source === "all") {
    return new Set(Object.values(HISTORY_SOURCES));
  }
  return new Set(
    String(source)
      .split(",")
      .map((item) => item.trim())
      .filter((item) => Object.values(HISTORY_SOURCES).includes(item)),
  );
};

const toIso = (value) => value?.toISOString?.() || value;

const dateValue = (value) => {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const compareTimeline = (a, b, direction = "asc") => {
  const multiplier = direction === "desc" ? -1 : 1;
  const dateDiff = dateValue(a.occurredAt) - dateValue(b.occurredAt);
  if (dateDiff !== 0) return dateDiff * multiplier;
  return String(a.id).localeCompare(String(b.id)) * multiplier;
};

const selectSnapshot = ({
  action,
  oldSummaryJson,
  newSummaryJson,
  summaryJson,
}) => {
  if (newSummaryJson) return newSummaryJson;
  if (action === ACTIONS.DELETED && oldSummaryJson) return oldSummaryJson;
  if (hasObjectKeys(summaryJson)) return summaryJson;
  return oldSummaryJson || {};
};

const serializeEvent = (event) => ({
  id: event.id,
  rawId: event.id,
  source: HISTORY_SOURCES.AUDIT,
  orgId: event.orgId,
  projectId: event.projectId,
  entityType: event.entityType,
  entityId: event.entityId,
  recordType: event.entityType,
  recordId: event.entityId,
  workflowType: null,
  action: event.action,
  decision: null,
  actorId: event.actorId || null,
  actorRole: event.actorRole || null,
  occurredAt: toIso(event.occurredAt),
  oldStatus: event.oldStatus || null,
  newStatus: event.newStatus || null,
  fromStatus: event.oldStatus || null,
  toStatus: event.newStatus || null,
  reason: event.reason || null,
  comment: null,
  oldSummary: event.oldSummaryJson || null,
  newSummary: event.newSummaryJson || null,
  summary: event.summaryJson || {},
  attachments: event.attachmentsJson || [],
  metadata: event.metadataJson || {},
  createdAt: toIso(event.createdAt),
});

const serializeApprovalEvent = (event) => ({
  id: `${HISTORY_SOURCES.APPROVAL}:${event.id}`,
  rawId: event.id,
  source: HISTORY_SOURCES.APPROVAL,
  orgId: event.orgId,
  projectId: event.projectId,
  entityType: event.recordType,
  entityId: event.recordId,
  recordType: event.recordType,
  recordId: event.recordId,
  workflowType: event.workflowType || event.recordType,
  action: event.action,
  decision: event.decision || null,
  actorId: event.actorId || null,
  actorRole: event.actorRole || null,
  occurredAt: toIso(event.createdAt),
  oldStatus: event.fromStatus || null,
  newStatus: event.toStatus || null,
  fromStatus: event.fromStatus || null,
  toStatus: event.toStatus || null,
  reason: event.reason || null,
  comment: event.comment || null,
  oldSummary: null,
  newSummary: null,
  summary: {
    workflowType: event.workflowType || event.recordType,
    decision: event.decision || null,
    comment: event.comment || null,
  },
  attachments: [],
  metadata: event.metadataJson || {},
  createdAt: toIso(event.createdAt),
});

const serializeStatusHistory = ({ orgId, row }) => ({
  id: `${HISTORY_SOURCES.STATUS}:${row.id}`,
  rawId: row.id,
  source: HISTORY_SOURCES.STATUS,
  orgId,
  projectId: row.projectId,
  entityType: row.recordType,
  entityId: row.recordId,
  recordType: row.recordType,
  recordId: row.recordId,
  workflowType: row.recordType,
  action: ACTIONS.STATUS_CHANGED,
  decision: null,
  actorId: row.createdBy || null,
  actorRole: row.actorRole || null,
  occurredAt: toIso(row.createdAt),
  oldStatus: row.oldStatus || null,
  newStatus: row.newStatus || null,
  fromStatus: row.oldStatus || null,
  toStatus: row.newStatus || null,
  reason: null,
  comment: row.comment || null,
  oldSummary: null,
  newSummary: null,
  summary: { comment: row.comment || null },
  attachments: [],
  metadata: {},
  createdAt: toIso(row.createdAt),
});

const recordKey = ({ entityType, entityId, recordType, recordId }) =>
  `${recordType || entityType || ""}::${recordId || entityId || ""}`;

const serializeAttachment = (attachment, source) => ({
  id: attachment.id,
  source,
  documentId: attachment.documentId || attachment.projectDocumentId || null,
  fileName:
    attachment.fileName ||
    attachment.originalName ||
    attachment.projectDocument?.originalName ||
    attachment.projectDocument?.fileName ||
    null,
  fileUrl: attachment.fileUrl || null,
  storageKey: attachment.storageKey || null,
  mimeType: attachment.mimeType || attachment.projectDocument?.mimeType || null,
  sizeBytes: attachment.sizeBytes || attachment.projectDocument?.sizeBytes || null,
  description: attachment.description || null,
  uploadedBy:
    attachment.uploadedBy || attachment.projectDocument?.uploadedBy || null,
  uploadedAt: toIso(attachment.uploadedAt || attachment.createdAt),
});

const loadRecordAttachments = async ({ projectId, events }) => {
  const pairs = [
    ...new Map(
      events
        .map((event) => ({
          recordType: event.recordType || event.entityType,
          recordId: event.recordId || event.entityId,
        }))
        .filter((pair) => pair.recordType && pair.recordId)
        .map((pair) => [`${pair.recordType}::${pair.recordId}`, pair]),
    ).values(),
  ];

  if (!pairs.length) return events;

  const where = {
    projectId,
    OR: pairs.map((pair) => ({
      recordType: pair.recordType,
      recordId: pair.recordId,
    })),
  };

  const [workflowAttachments, commercialAttachments] = await Promise.all([
    prisma.workflowAttachment?.findMany
      ? prisma.workflowAttachment.findMany({
          where,
          orderBy: [{ createdAt: "asc" }],
        })
      : Promise.resolve([]),
    prisma.commercialAttachmentRef?.findMany
      ? prisma.commercialAttachmentRef.findMany({
          where,
          include: {
            projectDocument: {
              select: {
                id: true,
                fileName: true,
                originalName: true,
                mimeType: true,
                sizeBytes: true,
                uploadedBy: true,
              },
            },
          },
          orderBy: [{ createdAt: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  const byRecord = new Map();
  for (const attachment of toArray(workflowAttachments)) {
    const key = recordKey(attachment);
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord
      .get(key)
      .push(serializeAttachment(attachment, "workflow_attachment"));
  }
  for (const attachment of toArray(commercialAttachments)) {
    const key = recordKey(attachment);
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord
      .get(key)
      .push(serializeAttachment(attachment, "commercial_attachment"));
  }

  return events.map((event) => {
    const currentAttachments = byRecord.get(recordKey(event)) || [];
    if (!currentAttachments.length) return event;
    const existingKeys = new Set(
      toArray(event.attachments).map((attachment) =>
        JSON.stringify([
          attachment.id,
          attachment.storageKey,
          attachment.fileName || attachment.filename,
        ]),
      ),
    );
    const merged = [
      ...toArray(event.attachments),
      ...currentAttachments.filter(
        (attachment) =>
          !existingKeys.has(
            JSON.stringify([
              attachment.id,
              attachment.storageKey,
              attachment.fileName,
            ]),
          ),
      ),
    ];
    return { ...event, attachments: merged };
  });
};

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
      "AUDIT_EVENT_INVALID",
      "Audit events require org, project, entity, and action metadata",
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
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
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
  order = "asc",
  source = "all",
}) => {
  await ensureProject({ orgId, projectId });

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const direction = order === "desc" ? "desc" : "asc";
  const sources = normalizeSourceFilter(source);
  if (sources.size === 0) {
    return { events: [], nextCursor: null };
  }

  const auditWhere = { orgId, projectId };
  if (entityType) auditWhere.entityType = entityType;
  if (entityId) auditWhere.entityId = entityId;
  if (action) auditWhere.action = action;

  const workflowWhere = { orgId, projectId };
  if (entityType) workflowWhere.recordType = entityType;
  if (entityId) workflowWhere.recordId = entityId;
  if (action) workflowWhere.action = action;

  const statusWhere = { projectId };
  if (entityType) statusWhere.recordType = entityType;
  if (entityId) statusWhere.recordId = entityId;

  const includeStatus = !action || action === ACTIONS.STATUS_CHANGED;
  const auditOnly =
    sources.size === 1 && sources.has(HISTORY_SOURCES.AUDIT);

  const [auditRows, approvalRows, statusRows] = await Promise.all([
    sources.has(HISTORY_SOURCES.AUDIT) && prisma.auditEvent?.findMany
      ? prisma.auditEvent.findMany({
          where: auditWhere,
          orderBy: [{ occurredAt: direction }, { id: direction }],
          take: safeLimit + 1,
          ...(auditOnly && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })
      : Promise.resolve([]),
    sources.has(HISTORY_SOURCES.APPROVAL) &&
    prisma.approvalWorkflowEvent?.findMany
      ? prisma.approvalWorkflowEvent.findMany({
          where: workflowWhere,
          orderBy: [{ createdAt: direction }, { id: direction }],
          take: safeLimit + 1,
        })
      : Promise.resolve([]),
    sources.has(HISTORY_SOURCES.STATUS) &&
    includeStatus &&
    prisma.workflowStatusHistory?.findMany
      ? prisma.workflowStatusHistory.findMany({
          where: statusWhere,
          orderBy: [{ createdAt: direction }, { id: direction }],
          take: safeLimit + 1,
        })
      : Promise.resolve([]),
  ]);

  const combined = [
    ...toArray(auditRows).map(serializeEvent),
    ...toArray(approvalRows).map(serializeApprovalEvent),
    ...toArray(statusRows).map((row) => serializeStatusHistory({ orgId, row })),
  ].sort((a, b) => compareTimeline(a, b, direction));

  const hasMore = combined.length > safeLimit;
  const events = await loadRecordAttachments({
    projectId,
    events: combined.slice(0, safeLimit),
  });

  return {
    events,
    nextCursor: hasMore ? events[events.length - 1]?.rawId || null : null,
  };
};

module.exports = {
  ACTIONS,
  ENTITY_TYPES,
  HISTORY_SOURCES,
  buildChangeSet,
  compactJson,
  listEvents,
  recordEvent,
  serializeEvent,
};
