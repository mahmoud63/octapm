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

// The merged timeline is ordered by time, then by source in this order, then
// as each source's own query orders its rows (time, id). The page cursor is a
// position in that order, so every source pages (certification X-PARTY-1).
const SOURCE_ORDER = Object.freeze([
  HISTORY_SOURCES.AUDIT,
  HISTORY_SOURCES.APPROVAL,
  HISTORY_SOURCES.STATUS,
  HISTORY_SOURCES.COMMENT,
]);
const sourceRank = (source) => SOURCE_ORDER.indexOf(source);

// Array.prototype.sort is stable: rows of one source at the same instant keep
// the order their query returned them in (its id order).
const compareTimeline = (a, b, direction = "asc") => {
  const multiplier = direction === "desc" ? -1 : 1;
  const dateDiff = dateValue(a.occurredAt) - dateValue(b.occurredAt);
  if (dateDiff !== 0) return dateDiff * multiplier;
  return (sourceRank(a.source) - sourceRank(b.source)) * multiplier;
};

const CURSOR_VERSION = "h1";
const CURSOR_PATTERN = /^(\d{1,15})\.([0-9])\.(.+)$/;

const invalidCursor = () =>
  new HttpError(
    400,
    "VALIDATION_ERROR",
    "cursor is not a position in this project's history",
  );

/** The page's last event as an opaque position: its time, its source and its row id. */
const encodeCursor = (event) =>
  `${CURSOR_VERSION}.${Buffer.from(
    `${dateValue(event.occurredAt)}.${sourceRank(event.source)}.${event.rawId}`,
    "utf8",
  ).toString("base64url")}`;

/**
 * The position a cursor names. A cursor of the earlier form — an audit
 * event's id, which only source=audit honoured — is read as that event's
 * place in the timeline, so a client holding one keeps paging.
 */
const decodeCursor = async ({ cursor, orgId, projectId }) => {
  if (!cursor) return null;
  const text = String(cursor);
  if (text.startsWith(`${CURSOR_VERSION}.`)) {
    const raw = Buffer.from(text.slice(CURSOR_VERSION.length + 1), "base64url").toString("utf8");
    const match = raw.match(CURSOR_PATTERN);
    const rank = match ? Number(match[2]) : -1;
    if (!match || rank >= SOURCE_ORDER.length) throw invalidCursor();
    return { time: new Date(Number(match[1])), rank, id: match[3] };
  }
  const row = prisma.auditEvent?.findFirst
    ? await prisma.auditEvent.findFirst({
        where: { id: text, orgId, projectId },
        select: { id: true, occurredAt: true },
      })
    : null;
  if (!row) throw invalidCursor();
  return { time: row.occurredAt, rank: sourceRank(HISTORY_SOURCES.AUDIT), id: row.id };
};

/** One source's rows after a position, in the page's direction (null: from the start). */
const afterPosition = ({ position, source, timeField, direction }) => {
  if (!position) return null;
  const rank = sourceRank(source);
  const later = direction === "desc" ? "lt" : "gt";
  if (rank === position.rank) {
    return {
      OR: [
        { [timeField]: { [later]: position.time } },
        { [timeField]: position.time, id: { [later]: position.id } },
      ],
    };
  }
  // At the same instant a source ordered after the cursor's comes after it.
  const comesAfter = direction === "desc" ? rank < position.rank : rank > position.rank;
  const operator = comesAfter ? (direction === "desc" ? "lte" : "gte") : later;
  return { [timeField]: { [operator]: position.time } };
};

// ─── what a reader may see (certification L43) ─────────────────────────────

/**
 * The module each record type in a project's history is read under: the
 * record types of the attachment table (attachment.service
 * RECORD_TYPE_MODULES) and those only the history carries. An event, an
 * approval, a status change or a comment on a record is given to a reader
 * who may read that record's module — the rule GET /comments applies to one
 * record — and, for a reader a record's own rule binds (a party's RFIs and
 * submittals, a vendor's commitments and pay applications, a person's
 * tasks; document-text.service RECORD_RULES), only on the records that rule
 * admits. The whole trail went to every audit reader: a subcontractor's
 * guest read change orders, payment certificates, other vendors' pay
 * applications and the text of comments the comments route refuses them.
 */
const HISTORY_ONLY_MODULES = Object.freeze({
  eot_claim: "eot",
  ipc_item: "ipc",
  boq_revision: "boq",
  activity_boq_allocation: "boq",
  quantity_progress_entry: "progress",
  schedule_revision: "schedule",
  wbs_node: "schedule",
  progress_import: "schedule",
  schedule_generation_job: "schedule",
  activity_cost_loading: "cost",
  budget_line: "cost",
  budget_snapshot: "cost",
  budget_revision: "cost",
  burn_rate_entry: "cost",
  cost_code: "cost",
  activity_equipment_usage: "cost",
  project_setup_readiness: "cost",
  procurement_supplier: "procurement",
  procurement_alert: "procurement",
  activity_material_usage: "procurement",
  vendor: "procurement",
  vendor_prequalification: "procurement",
  crew: "timesheet",
  submittal_package: "submittal",
  submittal_workflow_template: "submittal",
  spec_section: "document_control",
  document_revision: "document_control",
  photo: "document_control",
  report: "report",
  workflow_template: "workflow",
  workflow_instance: "workflow",
  custom_field: "custom_field",
  custom_fieldset: "custom_field",
  record_type: "custom_field",
  user_invitation: "user_management",
  invitation: "user_management",
  membership: "user_management",
  user: "user_management",
  project_assignment: "user_management",
  project_user_permission: "user_management",
  project_party_permission: "user_management",
  permission_template: "user_management",
  api_client: "user_management",
  webhook: "user_management",
  accounting_connection: "user_management",
  subscription: "user_management",
});

// Record rules only the history needs besides document-text.service
// RECORD_RULES, written as those are: a submittal package is a party
// member's when it holds a submittal routed to their company or they made it
// (submittal-workflow.service packageForCaller, which answers 403 for any
// other package).
const routedToParties = (partyIds) =>
  Array.isArray(partyIds) && partyIds.length
    ? { OR: [{ ownerPartyId: { in: partyIds } }, { reviewerPartyId: { in: partyIds } }, { approverPartyId: { in: partyIds } }] }
    : null;
const HISTORY_ONLY_RULES = Object.freeze({
  submittal_package: {
    model: "submittalPackage",
    party: true,
    clauses: ({ partyIds, userId }) => [
      routedToParties(partyIds) ? { submittals: { some: routedToParties(partyIds) } } : null,
      userId ? { createdBy: userId } : null,
    ],
  },
});

// Events about a file on a record: the file's record decides as well.
const LINKED_RECORD_TYPES = new Set(["attachment", "document_revision"]);
// The client contract's changes are recorded on the project
// (prime-contract.service, transition contract.manage); they are the
// contract's, read under its module (routes/prime-contract.js).
const CONTRACT_MANAGE_MODULE = "ipc";

let historyModules = null;
const historyModuleMap = () => {
  if (!historyModules) {
    // Lazy: attachment.service records its own events through this service.
    const { RECORD_TYPE_MODULES } = require("./attachment.service");
    historyModules = Object.freeze({ ...RECORD_TYPE_MODULES, ...HISTORY_ONLY_MODULES });
  }
  return historyModules;
};
const moduleOfRecordType = (recordType) =>
  Object.prototype.hasOwnProperty.call(historyModuleMap(), recordType)
    ? historyModuleMap()[recordType]
    : null;

/**
 * What one reader may be given of a project's history. `viewer` is
 * document-text.service documentViewer's: `canRead(module)` (role, template,
 * party, API key) and, for a party-scoped reader, its parties and companies.
 * Returns the record types refused outright, for a party-scoped reader the
 * only types given (a type of no known module is not), and the ids each
 * record rule admits on this project.
 */
const historyVisibility = async ({ projectId, viewer }) => {
  if (!viewer || typeof viewer.canRead !== "function") return null;
  const decided = new Map();
  const canRead = (moduleName) => {
    if (!decided.has(moduleName)) decided.set(moduleName, Boolean(viewer.canRead(moduleName)));
    return decided.get(moduleName);
  };
  const partyScoped = Array.isArray(viewer.partyIds);
  const denied = [];
  const allowed = [...LINKED_RECORD_TYPES];
  for (const [recordType, moduleName] of Object.entries(historyModuleMap())) {
    if (LINKED_RECORD_TYPES.has(recordType)) continue;
    (canRead(moduleName) ? allowed : denied).push(recordType);
  }
  const { RECORD_RULES } = require("./document-text.service");
  const ruled = {};
  for (const [recordType, rule] of Object.entries({ ...(RECORD_RULES || {}), ...HISTORY_ONLY_RULES })) {
    // A rule binds a party-scoped reader always, anyone else when it says so.
    if (!rule || (rule.party && !partyScoped)) continue;
    if (denied.includes(recordType)) continue;
    const clauses = (rule.clauses(viewer) || []).filter(Boolean);
    const rows = clauses.length && prisma[rule.model]?.findMany
      ? await prisma[rule.model].findMany({ where: { projectId, OR: clauses }, select: { id: true } })
      : [];
    ruled[recordType] = toArray(rows).map((row) => row.id);
  }
  return { canRead, partyScoped, denied, allowed: partyScoped ? allowed : null, ruled };
};

/** The where clause that keeps one source's rows to what the reader may see. */
const visibleWhere = (visibility, typeField, idField) => {
  if (!visibility) return null;
  const and = [];
  if (visibility.denied.length) and.push({ [typeField]: { notIn: visibility.denied } });
  if (visibility.allowed) and.push({ [typeField]: { in: visibility.allowed } });
  const ruledTypes = Object.keys(visibility.ruled);
  if (ruledTypes.length) {
    and.push({
      OR: [
        { [typeField]: { notIn: ruledTypes } },
        ...ruledTypes.map((recordType) => ({
          [typeField]: recordType,
          [idField]: { in: visibility.ruled[recordType] },
        })),
      ],
    });
  }
  return and.length ? and : null;
};

/** Whether a record named inside an event (a file's record, the contract) is one the reader may see. */
const recordVisible = (visibility, recordType, recordId) => {
  const moduleName = moduleOfRecordType(recordType);
  if (!moduleName) return !visibility.partyScoped;
  if (!visibility.canRead(moduleName)) return false;
  const ids = visibility.ruled[recordType];
  return !ids || ids.includes(recordId);
};

/** The events whose content names a record of its own: kept only when the reader may see that record too. */
const eventVisible = (visibility, event) => {
  if (!visibility) return true;
  const type = event.recordType || event.entityType;
  if (type === "project" && event.summary?.transition === "contract.manage") {
    return visibility.canRead(CONTRACT_MANAGE_MODULE);
  }
  if (!LINKED_RECORD_TYPES.has(type)) return true;
  const linkedType = event.summary?.recordType || event.metadata?.recordType || null;
  const linkedId = event.summary?.recordId || event.metadata?.recordId || null;
  if (!linkedType) return visibility.canRead(moduleOfRecordType(type) || "document_control");
  if (moduleOfRecordType(type) && !visibility.canRead(moduleOfRecordType(type))) return false;
  return recordVisible(visibility, linkedType, linkedId);
};

const withConditions = (where, ...conditions) => {
  const list = conditions.flat().filter(Boolean);
  return list.length ? { ...where, AND: list } : where;
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

/**
 * A project's history: audit events, approval decisions, status changes and
 * comments as one timeline, `limit` at a time. `cursor` is the `nextCursor`
 * of the previous page, whatever the sources (certification X-PARTY-1: it
 * was honoured for source=audit only, and every other request answered the
 * first page again with the same cursor). `viewer` is the reader
 * (historyVisibility above); without one — the service's own callers — the
 * whole history is returned.
 */
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
  viewer = null,
}) => {
  await ensureProject({ orgId, projectId });

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const direction = order === "desc" ? "desc" : "asc";
  const sources = normalizeSourceFilter(source);
  if (sources.size === 0) {
    return { events: [], nextCursor: null };
  }
  const position = await decodeCursor({ cursor, orgId, projectId });
  const visibility = await historyVisibility({ projectId, viewer });
  const after = (sourceName, timeField) =>
    afterPosition({ position, source: sourceName, timeField, direction });

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

  const commentWhere = { orgId, projectId, deletedAt: null };
  if (entityType) commentWhere.recordType = entityType;
  if (entityId) commentWhere.recordId = entityId;

  const [auditRows, approvalRows, statusRows, commentRows] = await Promise.all([
    sources.has(HISTORY_SOURCES.AUDIT) && prisma.auditEvent?.findMany
      ? prisma.auditEvent.findMany({
          where: withConditions(
            auditWhere,
            visibleWhere(visibility, "entityType", "entityId"),
            after(HISTORY_SOURCES.AUDIT, "occurredAt"),
          ),
          orderBy: [{ occurredAt: direction }, { id: direction }],
          take: safeLimit + 1,
        })
      : Promise.resolve([]),
    sources.has(HISTORY_SOURCES.APPROVAL) &&
    prisma.approvalWorkflowEvent?.findMany
      ? prisma.approvalWorkflowEvent.findMany({
          where: withConditions(
            workflowWhere,
            visibleWhere(visibility, "recordType", "recordId"),
            after(HISTORY_SOURCES.APPROVAL, "createdAt"),
          ),
          orderBy: [{ createdAt: direction }, { id: direction }],
          take: safeLimit + 1,
        })
      : Promise.resolve([]),
    sources.has(HISTORY_SOURCES.STATUS) &&
    includeStatus &&
    prisma.workflowStatusHistory?.findMany
      ? prisma.workflowStatusHistory.findMany({
          where: withConditions(
            statusWhere,
            visibleWhere(visibility, "recordType", "recordId"),
            after(HISTORY_SOURCES.STATUS, "createdAt"),
          ),
          orderBy: [{ createdAt: direction }, { id: direction }],
          take: safeLimit + 1,
        })
      : Promise.resolve([]),
    sources.has(HISTORY_SOURCES.COMMENT) &&
    includeComments &&
    prisma.comment?.findMany
      ? prisma.comment.findMany({
          where: withConditions(
            commentWhere,
            visibleWhere(visibility, "recordType", "recordId"),
            after(HISTORY_SOURCES.COMMENT, "createdAt"),
          ),
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

  // Concatenated in source order, so the stable sort keeps each source's own
  // order among rows of the same instant (compareTimeline).
  const combined = [
    ...toArray(auditRows).map(serializeEvent),
    ...toArray(approvalRows).map(serializeApprovalEvent),
    ...toArray(statusRows).map((row) => serializeStatusHistory({ orgId, row })),
    ...toArray(commentRows).map(serializeCommentEvent),
  ].sort((a, b) => compareTimeline(a, b, direction));

  const hasMore = combined.length > safeLimit;
  const page = combined.slice(0, safeLimit);
  // The cursor is the page's last position before the events whose content
  // names a record of its own are judged, so a page short of those still
  // leads to the next.
  const nextCursor = hasMore && page.length ? encodeCursor(page[page.length - 1]) : null;
  const visible = page.filter((event) => eventVisible(visibility, event));
  await attachActorNames(visible);
  const events = await loadRecordAttachments({ projectId, events: visible });

  return { events, nextCursor };
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
