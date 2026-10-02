const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { isPrismaDecimal } = require("../utils/money");
const domainEvents = require("../events/bus");

const ENTITY_TYPES = Object.freeze({
  SCHEDULE_REVISION: "schedule_revision",
  PROGRESS_SUBMISSION: "progress_submission",
  DAILY_REPORT: "daily_report",
  SITE_DIARY: "site_diary",
  DAILY_LOG: "daily_log",
  REPORT: "report",
  WORKFLOW_TEMPLATE: "workflow_template",
  WORKFLOW_INSTANCE: "workflow_instance",
  CUSTOM_FIELD: "custom_field",
  CUSTOM_FIELDSET: "custom_fieldset",
  RECORD_TYPE: "record_type",
  API_CLIENT: "api_client",
  WEBHOOK: "webhook",
  ACCOUNTING_CONNECTION: "accounting_connection",
  BID_PACKAGE: "bid_package",
  BID: "bid",
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
  LOCATION: "location",
  BACKGROUND_JOB: "background_job",
  ATTACHMENT: "attachment",
  PHOTO: "photo",
  DRAWING_SET: "drawing_set",
  SHEET: "sheet",
  SHEET_REVISION: "sheet_revision",
  MARKUP: "markup",
  PIN: "pin",
  PUNCH_ITEM: "punch_item",
  FORM_TEMPLATE: "form_template",
  FORM_INSTANCE: "form_instance",
  SUBMITTAL_PACKAGE: "submittal_package",
  SUBMITTAL_WORKFLOW_TEMPLATE: "submittal_workflow_template",
  BUDGET_LINE: "budget_line",
  BUDGET_SNAPSHOT: "budget_snapshot",
  COMMITMENT: "commitment",
  COMMITMENT_CHANGE_ORDER: "commitment_change_order",
  SUB_PAY_APP: "sub_pay_app",
  SUBSCRIPTION: "subscription",
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
  COMMENT: "comment",
});

const COMMENT_ACTION = "commented";

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

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// A Prisma Decimal is an object. Walked field by field it was stored as its
// internals — { d: [...], e, s, constructor: "function Decimal…" } — instead
// of the amount, on every caller that hands a raw row's Decimal to a summary
// (change orders did, for `value`). It is stored as the plain number it
// represents, or as its exact text where a double cannot carry it.
const decimalToJson = (value) => {
  const number = value.toNumber();
  return Number.isFinite(number) && value.equals(number)
    ? number
    : value.toString();
};

// The rows written before the writer was fixed are history and are not
// rewritten: the read path decodes the stored internals back into the number
// so a screen prints the amount, never an object. decimal.js internals: `d`
// holds base-1e7 words, most significant first (the last word without its
// trailing zeros); `e` is the exponent of the leading digit; `s` the sign.
const isStoredDecimalInternals = (value) =>
  isPlainObject(value) &&
  (Array.isArray(value.d) || value.d === "[truncated]") &&
  Number.isInteger(value.e) &&
  (value.s === 1 || value.s === -1) &&
  Object.keys(value).every((key) =>
    ["d", "e", "s", "constructor"].includes(key),
  );

const decodeStoredDecimal = (value) => {
  const words = value.d;
  if (
    !Array.isArray(words) ||
    !words.length ||
    !words.every(
      (word) => Number.isInteger(word) && word >= 0 && word < 10_000_000,
    )
  ) {
    return null;
  }
  let digits = String(words[0]);
  for (let index = 1; index < words.length; index += 1) {
    digits += String(words[index]).padStart(7, "0");
  }
  digits = digits.replace(/0+$/, "");
  if (!digits) return 0;
  const exponent = value.e;
  let text;
  if (exponent < 0) text = `0.${"0".repeat(-exponent - 1)}${digits}`;
  else if (exponent + 1 >= digits.length) {
    text = digits + "0".repeat(exponent + 1 - digits.length);
  } else {
    text = `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
  }
  const number = Number(text) * value.s;
  return Number.isFinite(number) ? number : null;
};

const decodeStoredDecimals = (value) => {
  if (Array.isArray(value)) return value.map(decodeStoredDecimals);
  if (!isPlainObject(value)) return value;
  // A Decimal that sat at the depth limit lost its digits ("[truncated]"):
  // nothing can be recovered, and the screen gets no value rather than the
  // internals.
  if (isStoredDecimalInternals(value)) return decodeStoredDecimal(value);
  return Object.entries(value).reduce((acc, [key, child]) => {
    acc[key] = decodeStoredDecimals(child);
    return acc;
  }, {});
};

const compactJson = (value, depth = 0) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "string") return compactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return String(value);
  if (isPrismaDecimal(value)) return decimalToJson(value);

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
  oldSummary: decodeStoredDecimals(event.oldSummaryJson) || null,
  newSummary: decodeStoredDecimals(event.newSummaryJson) || null,
  summary: decodeStoredDecimals(event.summaryJson) || {},
  attachments: event.attachmentsJson || [],
  metadata: decodeStoredDecimals(event.metadataJson) || {},
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

// Comments (OCTA-COMM-COMMENT-009) appear in the same feed as audit,
// approval and status rows so a record's history reads as one conversation.
const serializeCommentEvent = (row) => ({
  id: `${HISTORY_SOURCES.COMMENT}:${row.id}`,
  rawId: row.id,
  source: HISTORY_SOURCES.COMMENT,
  orgId: row.orgId,
  projectId: row.projectId,
  entityType: row.recordType,
  entityId: row.recordId,
  recordType: row.recordType,
  recordId: row.recordId,
  workflowType: null,
  action: COMMENT_ACTION,
  decision: null,
  actorId: row.authorId || null,
  actorRole: null,
  occurredAt: toIso(row.createdAt),
  oldStatus: null,
  newStatus: null,
  fromStatus: null,
  toStatus: null,
  reason: null,
  comment: row.body || null,
  oldSummary: null,
  newSummary: null,
  summary: {
    commentId: row.id,
    author: row.author?.name || null,
    mentions: toArray(row.mentions).map(
      (mention) => mention.user?.name || mention.userId,
    ),
    edited: Boolean(row.editedAt),
    parentId: row.parentId || null,
  },
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
  // projectId is optional: company-scoped entities — shared form templates,
  // submittal workflow templates, report definitions — belong to the
  // organisation and have no project, but still have to be auditable.
  if (!orgId || !entityType || !entityId || !action) {
    throw new HttpError(
      400,
      "AUDIT_EVENT_INVALID",
      "Audit events require org, entity, and action metadata",
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

  // Fan out a domain event: persist it in the same transaction for the durable
  // outbound log, then publish (deferred) for realtime subscribers. Neither
  // step may break the audited business action — and neither may break its
  // transaction: inside a caller's transaction the outbound insert runs under
  // its own savepoint (events/bus recordOutboundEvent), so a refused insert is
  // rolled back alone and the audit event, its history snapshot and the
  // caller's writes commit. The audit event and snapshot above are not
  // best-effort: their failure propagates. Only a transaction that can no
  // longer commit (transactionAborted) is rethrown from here, so the caller
  // fails loudly instead of answering for writes a COMMIT would drop. The
  // event is announced only once its transaction has committed.
  try {
    const domainEvent = domainEvents.buildRecordEvent({
      orgId,
      projectId,
      entityType,
      entityId,
      action,
      actorId,
      occurredAt,
      oldStatus,
      newStatus,
      summary: newSummaryJson || summaryJson,
    });
    const recorded = await domainEvents.recordOutboundEvent({ tx, event: domainEvent });
    domainEvents.publishRecorded(recorded?.id ? { ...domainEvent, id: recorded.id } : domainEvent, { tx, client: prisma });
  } catch (error) {
    if (error?.transactionAborted) throw error;
    console.error("[audit-domain-event]", error);
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

/**
 * Who acted, by name. A client-facing history must never show a raw user id
 * (Phase 22A, from the Phase 22 audit UX22-05): one lookup for every actor
 * on the page, the role filled from the account when the row carries none,
 * and a person no longer in the organisation left as null for the screen to
 * label. The id stays on the event for technical detail only.
 */
const attachActorNames = async (events) => {
  const actorIds = [...new Set(events.map((event) => event.actorId).filter(Boolean))];
  const users = actorIds.length && prisma.user?.findMany
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, role: true } })
    : [];
  const byId = new Map(users.map((user) => [user.id, user]));
  for (const event of events) {
    const user = event.actorId ? byId.get(event.actorId) : null;
    event.actorName = user?.name || event.summary?.author || null;
    if (!event.actorRole && user?.role) event.actorRole = user.role;
  }
  return events;
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
  const includeComments = !action || action === COMMENT_ACTION;
  const auditOnly =
    sources.size === 1 && sources.has(HISTORY_SOURCES.AUDIT);

  const commentWhere = { orgId, projectId, deletedAt: null };
  if (entityType) commentWhere.recordType = entityType;
  if (entityId) commentWhere.recordId = entityId;

  const [auditRows, approvalRows, statusRows, commentRows] = await Promise.all([
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
    sources.has(HISTORY_SOURCES.COMMENT) &&
    includeComments &&
    prisma.comment?.findMany
      ? prisma.comment.findMany({
          where: commentWhere,
          include: {
            author: { select: { id: true, name: true } },
            mentions: {
              include: { user: { select: { id: true, name: true } } },
            },
          },
          orderBy: [{ createdAt: direction }, { id: direction }],
          take: safeLimit + 1,
        })
      : Promise.resolve([]),
  ]);

  const combined = [
    ...toArray(auditRows).map(serializeEvent),
    ...toArray(approvalRows).map(serializeApprovalEvent),
    ...toArray(statusRows).map((row) => serializeStatusHistory({ orgId, row })),
    ...toArray(commentRows).map(serializeCommentEvent),
  ].sort((a, b) => compareTimeline(a, b, direction));
  await attachActorNames(combined);

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
  COMMENT_ACTION,
  ENTITY_TYPES,
  HISTORY_SOURCES,
  buildChangeSet,
  compactJson,
  listEvents,
  recordEvent,
  serializeCommentEvent,
  serializeEvent,
};
