const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { isPrismaDecimal, toMoneyNumber } = require("../utils/money");
const notificationService = require("./notification.service");
const domainEvents = require("../events/bus");

const RECORD_TYPES = Object.freeze({
  BOQ_REVISION: "boq_revision",
  BOQ_ALLOCATION: "activity_boq_allocation",
  SCHEDULE_REVISION: "schedule_revision",
  ACTIVITY_COST_LOADING: "activity_cost_loading",
  RFI: "rfi",
  SUBMITTAL: "submittal",
  CHANGE_ORDER: "change_order",
  IPC_CERTIFICATE: "ipc_certificate",
  EOT_CLAIM: "eot_claim",
  NCR: "ncr",
  SAFETY_INCIDENT: "safety_incident",
  RISK: "risk",
  PROCUREMENT_ORDER: "procurement_order",
});

const ACTIONS = Object.freeze({
  CREATED: "created",
  IMPORTED: "imported",
  SUBMITTED: "submitted",
  ANSWERED: "answered",
  REVIEWED: "reviewed",
  APPROVED: "approved",
  REJECTED: "rejected",
  RESUBMIT_REQUIRED: "resubmit_required",
  CERTIFIED: "certified",
  PAID: "paid",
  CLOSED: "closed",
  BASELINE_LOCKED: "baseline_locked",
  SUPERSEDED: "superseded",
  REOPENED: "reopened",
  STATUS_CHANGED: "status_changed",
  ARCHIVED: "archived",
});

const DECISIONS = Object.freeze({
  CREATED: "created",
  SUBMITTED: "submitted",
  REVIEWED: "reviewed",
  APPROVED: "approved",
  REJECTED: "rejected",
  CERTIFIED: "certified",
  CLOSED: "closed",
  SUPERSEDED: "superseded",
  REOPENED: "reopened",
  PAID: "paid",
  STATUS_CHANGED: "status_changed",
  ARCHIVED: "archived",
});

const ANY = Symbol("any");

const toArray = (value) => (Array.isArray(value) ? value : [value]);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const compactJson = (value) => {
  if (value === null || value === undefined) return {};
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(compactJson);
  // A Prisma Decimal is an object, so without this it would be walked field by
  // field and stored as its internals ({ s, e, d, constructor }) — which Prisma
  // then refuses to write to a Json column, taking the whole transaction down.
  // Callers pass raw rows here, so amounts arrive as Decimals routinely.
  if (isPrismaDecimal(value)) return toMoneyNumber(value);
  if (typeof value !== "object") return value;
  return Object.entries(value).reduce((acc, [key, raw]) => {
    acc[key] = compactJson(raw);
    return acc;
  }, {});
};

const rule = ({ from, to, action, decision, requireReason = false }) => ({
  from: from === ANY ? ANY : toArray(from).map((value) => value ?? null),
  to: to === ANY ? ANY : toArray(to).map((value) => value ?? null),
  action,
  decision,
  requireReason,
});

const TRANSITIONS = Object.freeze({
  [RECORD_TYPES.BOQ_REVISION]: [
    rule({
      from: null,
      to: ["imported", "comparison_only"],
      action: ACTIONS.IMPORTED,
      decision: DECISIONS.CREATED,
    }),
    // A BOQ revision is reviewed before it becomes the baseline (PC-2): the
    // upload applies its rows at once, the review is about signing them off.
    rule({
      from: "imported",
      to: "under_review",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "under_review",
      to: "approved",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: ["imported", "comparison_only", "approved"],
      to: "baselined",
      action: ACTIONS.BASELINE_LOCKED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: ["imported", "comparison_only", "under_review", "approved", "baselined"],
      to: "superseded",
      action: ACTIONS.SUPERSEDED,
      decision: DECISIONS.SUPERSEDED,
    }),
  ],
  [RECORD_TYPES.BOQ_ALLOCATION]: [
    rule({
      from: null,
      to: "draft",
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: ["draft", "rejected"],
      to: "submitted",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "submitted",
      to: "approved",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: "submitted",
      to: "rejected",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
  ],
  [RECORD_TYPES.SCHEDULE_REVISION]: [
    rule({
      from: null,
      to: ["draft", "under_review"],
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: ["draft", "rejected"],
      to: "under_review",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "under_review",
      to: "approved",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: "under_review",
      to: "rejected",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
    rule({
      from: "approved",
      to: "baselined",
      action: ACTIONS.BASELINE_LOCKED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: ["draft", "under_review", "approved", "baselined"],
      to: "superseded",
      action: ACTIONS.SUPERSEDED,
      decision: DECISIONS.SUPERSEDED,
    }),
  ],
  [RECORD_TYPES.ACTIVITY_COST_LOADING]: [
    rule({
      from: null,
      to: "draft",
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: null,
      to: "submitted",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "draft",
      to: "submitted",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "submitted",
      to: "approved",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: "submitted",
      to: "rejected",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
    rule({
      from: ["draft", "submitted", "approved"],
      to: "superseded",
      action: ACTIONS.SUPERSEDED,
      decision: DECISIONS.SUPERSEDED,
    }),
  ],
  [RECORD_TYPES.RFI]: [
    rule({
      from: null,
      to: ["open", "answered", "closed"],
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: "open",
      to: "open",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "open",
      to: "answered",
      action: ACTIONS.ANSWERED,
      decision: DECISIONS.REVIEWED,
    }),
    rule({
      from: "answered",
      to: "closed",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: "answered",
      to: "open",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
    rule({
      from: ["open", "answered"],
      to: "closed",
      action: ACTIONS.CLOSED,
      decision: DECISIONS.CLOSED,
    }),
    rule({
      from: ["answered", "closed"],
      to: "open",
      action: ACTIONS.REOPENED,
      decision: DECISIONS.REOPENED,
    }),
    rule({
      from: ["open", "answered", "closed"],
      to: "archived",
      action: ACTIONS.ARCHIVED,
      decision: DECISIONS.ARCHIVED,
    }),
  ],
  [RECORD_TYPES.SUBMITTAL]: [
    rule({
      from: null,
      to: "pending",
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: null,
      to: "under_review",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: ["pending", "resubmit", "rejected"],
      to: "under_review",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "under_review",
      to: "under_review",
      action: ACTIONS.REVIEWED,
      decision: DECISIONS.REVIEWED,
    }),
    rule({
      from: "under_review",
      to: "approved",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: "under_review",
      to: "resubmit",
      action: ACTIONS.RESUBMIT_REQUIRED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
    rule({
      from: "under_review",
      to: "rejected",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
    rule({
      from: ["pending", "under_review", "approved", "resubmit", "rejected"],
      to: "archived",
      action: ACTIONS.ARCHIVED,
      decision: DECISIONS.ARCHIVED,
    }),
  ],
  [RECORD_TYPES.CHANGE_ORDER]: [
    rule({
      from: null,
      to: "draft",
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: null,
      to: "pending",
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: "draft",
      to: "pending",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "pending",
      to: "approved",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: "pending",
      to: "rejected",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
    rule({
      from: "rejected",
      to: "draft",
      action: ACTIONS.REOPENED,
      decision: DECISIONS.REOPENED,
    }),
    rule({
      from: ["draft", "pending", "rejected"],
      to: "archived",
      action: ACTIONS.ARCHIVED,
      decision: DECISIONS.ARCHIVED,
    }),
  ],
  [RECORD_TYPES.IPC_CERTIFICATE]: [
    rule({
      from: null,
      to: "draft",
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: "draft",
      to: "submitted",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "submitted",
      to: "certified",
      action: ACTIONS.CERTIFIED,
      decision: DECISIONS.CERTIFIED,
    }),
    rule({
      from: "certified",
      to: "paid",
      action: ACTIONS.PAID,
      decision: DECISIONS.PAID,
    }),
  ],
  [RECORD_TYPES.EOT_CLAIM]: [
    rule({
      from: null,
      to: "draft",
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: null,
      to: "submitted",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: ["draft", "rejected"],
      to: "submitted",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "submitted",
      to: "approved",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: "submitted",
      to: "rejected",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
  ],
  [RECORD_TYPES.NCR]: [
    rule({
      from: null,
      to: "open",
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: "open",
      to: "submitted",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "submitted",
      to: "closed",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: "submitted",
      to: "open",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
    rule({
      from: "closed",
      to: "open",
      action: ACTIONS.REOPENED,
      decision: DECISIONS.REOPENED,
    }),
  ],
  [RECORD_TYPES.SAFETY_INCIDENT]: [
    rule({
      from: null,
      to: ["open", "investigating"],
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: "open",
      to: "investigating",
      action: ACTIONS.REVIEWED,
      decision: DECISIONS.REVIEWED,
    }),
    rule({
      from: ["open", "investigating"],
      to: "submitted",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "submitted",
      to: "closed",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: "submitted",
      to: "investigating",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
    rule({
      from: "closed",
      to: "investigating",
      action: ACTIONS.REOPENED,
      decision: DECISIONS.REOPENED,
    }),
    rule({
      from: ["open", "investigating", "submitted", "closed"],
      to: "archived",
      action: ACTIONS.ARCHIVED,
      decision: DECISIONS.ARCHIVED,
    }),
  ],
  [RECORD_TYPES.RISK]: [
    rule({
      from: null,
      to: ["open", "monitoring"],
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: ["open", "monitoring"],
      to: "submitted",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "submitted",
      to: "closed",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: "submitted",
      to: "monitoring",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
    rule({
      from: "closed",
      to: "monitoring",
      action: ACTIONS.REOPENED,
      decision: DECISIONS.REOPENED,
    }),
    rule({
      from: ["open", "monitoring", "submitted", "closed"],
      to: "archived",
      action: ACTIONS.ARCHIVED,
      decision: DECISIONS.ARCHIVED,
    }),
  ],
  // The purchase order's commercial lifecycle (OCTA-COM-PO-053). Delivery and
  // billing are separate states on the order and do not pass through here.
  [RECORD_TYPES.PROCUREMENT_ORDER]: [
    rule({
      from: null,
      to: ["planned", "draft"],
      action: ACTIONS.CREATED,
      decision: DECISIONS.CREATED,
    }),
    rule({
      from: ["planned", "draft"],
      to: "pending_approval",
      action: ACTIONS.SUBMITTED,
      decision: DECISIONS.SUBMITTED,
    }),
    rule({
      from: "pending_approval",
      to: "approved",
      action: ACTIONS.APPROVED,
      decision: DECISIONS.APPROVED,
    }),
    rule({
      from: ["pending_approval", "approved"],
      to: "draft",
      action: ACTIONS.REJECTED,
      decision: DECISIONS.REJECTED,
      requireReason: true,
    }),
    rule({
      from: "approved",
      to: "issued",
      action: ACTIONS.STATUS_CHANGED,
      decision: DECISIONS.STATUS_CHANGED,
    }),
    rule({
      from: "issued",
      to: "acknowledged",
      action: ACTIONS.STATUS_CHANGED,
      decision: DECISIONS.STATUS_CHANGED,
    }),
    rule({
      from: ["issued", "acknowledged"],
      to: "closed",
      action: ACTIONS.CLOSED,
      decision: DECISIONS.CLOSED,
    }),
    rule({
      from: ["planned", "draft", "pending_approval", "approved", "issued", "acknowledged"],
      to: "cancelled",
      action: ACTIONS.ARCHIVED,
      decision: DECISIONS.ARCHIVED,
      requireReason: true,
    }),
  ],
});

const statusMatches = (allowed, status) =>
  allowed === ANY || allowed.includes(status ?? null);

const resolveTransitionRule = ({ recordType, fromStatus, toStatus }) => {
  const normalizedFrom = trimOrNull(fromStatus);
  const normalizedTo = trimOrNull(toStatus);
  return (TRANSITIONS[recordType] || []).find(
    (candidate) =>
      statusMatches(candidate.from, normalizedFrom) &&
      statusMatches(candidate.to, normalizedTo),
  );
};

const assertAllowedTransition = ({
  recordType,
  fromStatus = null,
  toStatus = null,
  reason = null,
  comment = null,
}) => {
  const normalizedRecordType = trimOrNull(recordType);
  const normalizedFrom = trimOrNull(fromStatus);
  const normalizedTo = trimOrNull(toStatus);

  if (!normalizedRecordType || !TRANSITIONS[normalizedRecordType]) {
    throw new HttpError(
      400,
      "APPROVAL_WORKFLOW_UNSUPPORTED_RECORD",
      "Approval workflow record type is not supported",
    );
  }

  const transition = resolveTransitionRule({
    recordType: normalizedRecordType,
    fromStatus: normalizedFrom,
    toStatus: normalizedTo,
  });

  if (normalizedFrom === normalizedTo && !transition) return null;

  if (!transition) {
    throw new HttpError(
      409,
      "APPROVAL_WORKFLOW_INVALID_TRANSITION",
      `Invalid ${normalizedRecordType} workflow transition from ${normalizedFrom || "new"} to ${normalizedTo || "none"}`,
      {
        recordType: normalizedRecordType,
        fromStatus: normalizedFrom,
        toStatus: normalizedTo,
      },
    );
  }

  if (transition.requireReason && !trimOrNull(reason || comment)) {
    throw new HttpError(
      400,
      "APPROVAL_WORKFLOW_REASON_REQUIRED",
      "A reason is required for this workflow decision",
      {
        recordType: normalizedRecordType,
        fromStatus: normalizedFrom,
        toStatus: normalizedTo,
      },
    );
  }

  return transition;
};

const serializeWorkflowEvent = (event) => ({
  id: event.id,
  orgId: event.orgId,
  projectId: event.projectId,
  recordType: event.recordType,
  recordId: event.recordId,
  workflowType: event.workflowType,
  action: event.action,
  fromStatus: event.fromStatus || null,
  toStatus: event.toStatus || null,
  actorId: event.actorId || null,
  actorRole: event.actorRole || null,
  decision: event.decision || null,
  reason: event.reason || null,
  comment: event.comment || null,
  metadata: event.metadataJson || {},
  createdAt: event.createdAt?.toISOString?.() || event.createdAt,
  occurredAt: event.createdAt?.toISOString?.() || event.createdAt,
  oldStatus: event.fromStatus || null,
  newStatus: event.toStatus || null,
});

const recordTransition = async ({
  tx = prisma,
  orgId,
  projectId,
  recordType,
  recordId,
  workflowType = null,
  fromStatus = null,
  toStatus = null,
  actorId = null,
  actorRole = null,
  reason = null,
  comment = null,
  metadata = {},
  occurredAt = new Date(),
  force = false,
}) => {
  const normalizedRecordType = trimOrNull(recordType);
  const normalizedFrom = trimOrNull(fromStatus);
  const normalizedTo = trimOrNull(toStatus);
  const normalizedReason = trimOrNull(reason);
  const normalizedComment = trimOrNull(comment);

  if (!force && normalizedFrom === normalizedTo) return null;

  const transition = assertAllowedTransition({
    recordType: normalizedRecordType,
    fromStatus: normalizedFrom,
    toStatus: normalizedTo,
    reason: normalizedReason,
    comment: normalizedComment,
  });

  if (!orgId || !projectId || !recordId) {
    throw new HttpError(
      400,
      "APPROVAL_WORKFLOW_EVENT_INVALID",
      "Approval workflow events require org, project, and record metadata",
    );
  }

  const eventPayload = {
    orgId,
    projectId,
    recordType: normalizedRecordType,
    recordId,
    workflowType: trimOrNull(workflowType) || normalizedRecordType,
    action: transition?.action || ACTIONS.STATUS_CHANGED,
    fromStatus: normalizedFrom,
    toStatus: normalizedTo,
    actorId: actorId || null,
    actorRole: actorRole || null,
    decision: transition?.decision || DECISIONS.STATUS_CHANGED,
    reason: normalizedReason,
    comment: normalizedComment,
    metadataJson: compactJson(metadata),
    createdAt: occurredAt,
  };

  if (!tx.approvalWorkflowEvent?.create) {
    return serializeWorkflowEvent({ id: null, ...eventPayload });
  }

  const event = await tx.approvalWorkflowEvent.create({
    data: eventPayload,
  });

  domainEvents.publish({
    type: domainEvents.EVENT_TYPES.APPROVAL_DECIDED,
    orgId,
    projectId,
    entityType: eventPayload.recordType,
    entityId: recordId,
    action: eventPayload.action,
    actorId,
    occurredAt,
    payload: {
      workflowType: eventPayload.workflowType,
      decision: eventPayload.decision,
      fromStatus: normalizedFrom,
      toStatus: normalizedTo,
    },
  });

  try {
    await notificationService.createWorkflowNotifications({
      tx,
      workflowEvent: serializeWorkflowEvent(event),
    });
  } catch (error) {
    // Notification fanout must not block the source workflow transition.
    console.error("[notification-workflow-fanout]", error);
  }

  return serializeWorkflowEvent(event);
};

const listEventsForRecords = async ({
  tx = prisma,
  projectId,
  recordType,
  recordIds,
}) => {
  const ids = [...new Set((recordIds || []).filter(Boolean))];
  if (!ids.length || !tx.approvalWorkflowEvent?.findMany) return new Map();

  const events = await tx.approvalWorkflowEvent.findMany({
    where: {
      projectId,
      recordType,
      recordId: { in: ids },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return events.reduce((acc, event) => {
    if (!acc.has(event.recordId)) acc.set(event.recordId, []);
    acc.get(event.recordId).push(serializeWorkflowEvent(event));
    return acc;
  }, new Map());
};

module.exports = {
  ACTIONS,
  DECISIONS,
  RECORD_TYPES,
  TRANSITIONS,
  assertAllowedTransition,
  listEventsForRecords,
  recordTransition,
  serializeWorkflowEvent,
};
