const { prisma } = require("../config/db");
const { normalizeRoleId } = require("../config/permissions");
const { sendEmail } = require("./email.service");
const { HttpError } = require("../utils/http-error");
const domainEvents = require("../events/bus");
const { recordWorkspacePath } = require("../utils/record-links");
const {
  cursorArgs,
  normalizeListQuery,
  toCursorPage,
  trimToNull,
} = require("../utils/list-query");

const MAX_EMAIL_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const NOTIFICATION_CATEGORIES = Object.freeze({
  ASSIGNMENT: "assignment",
  MENTION: "mention",
  COMMENT: "comment",
  DUE: "due",
  OVERDUE: "overdue",
  APPROVAL: "approval",
  WORKFLOW: "workflow",
  COMMERCIAL: "commercial",
  QUALITY: "quality",
  SAFETY: "safety",
  TASK: "task",
});

const CATEGORY_ORDER = Object.freeze([
  NOTIFICATION_CATEGORIES.ASSIGNMENT,
  NOTIFICATION_CATEGORIES.MENTION,
  NOTIFICATION_CATEGORIES.COMMENT,
  NOTIFICATION_CATEGORIES.DUE,
  NOTIFICATION_CATEGORIES.OVERDUE,
  NOTIFICATION_CATEGORIES.APPROVAL,
  NOTIFICATION_CATEGORIES.COMMERCIAL,
  NOTIFICATION_CATEGORIES.QUALITY,
  NOTIFICATION_CATEGORIES.SAFETY,
  NOTIFICATION_CATEGORIES.TASK,
  NOTIFICATION_CATEGORIES.WORKFLOW,
]);

// Mentions are addressed to a person, so they email by default; new comments
// on followed records stay in-app unless the user opts in.
const DEFAULT_EMAIL_CATEGORIES = new Set([
  NOTIFICATION_CATEGORIES.ASSIGNMENT,
  NOTIFICATION_CATEGORIES.MENTION,
  NOTIFICATION_CATEGORIES.DUE,
  NOTIFICATION_CATEGORIES.OVERDUE,
  NOTIFICATION_CATEGORIES.APPROVAL,
  NOTIFICATION_CATEGORIES.COMMERCIAL,
  NOTIFICATION_CATEGORIES.QUALITY,
  NOTIFICATION_CATEGORIES.SAFETY,
  NOTIFICATION_CATEGORIES.TASK,
]);

const WORKFLOW_RECORDS = Object.freeze({
  boq_revision: {
    model: "boqRevision",
    label: "BOQ revision",
    moduleCategory: NOTIFICATION_CATEGORIES.WORKFLOW,
    assignmentFields: ["createdBy", "lockedBy"],
  },
  activity_boq_allocation: {
    model: "activityBoqAllocation",
    label: "BOQ allocation",
    moduleCategory: NOTIFICATION_CATEGORIES.WORKFLOW,
    assignmentFields: ["createdBy", "submittedBy", "approvedBy", "rejectedBy"],
  },
  schedule_revision: {
    model: "scheduleRevision",
    label: "Schedule revision",
    moduleCategory: NOTIFICATION_CATEGORIES.WORKFLOW,
    assignmentFields: [
      "submittedBy",
      "approvedBy",
      "rejectedBy",
      "baselinedBy",
      "activatedBy",
    ],
  },
  activity_cost_loading: {
    model: "activityCostLoading",
    label: "Cost loading",
    moduleCategory: NOTIFICATION_CATEGORIES.WORKFLOW,
    assignmentFields: ["createdBy", "submittedBy", "approvedBy", "rejectedBy"],
  },
  rfi: {
    model: "rfi",
    label: "RFI",
    moduleCategory: NOTIFICATION_CATEGORIES.APPROVAL,
    assignmentFields: [
      "owner",
      "reviewer",
      "approver",
      "raisedBy",
      "answeredBy",
    ],
    dueFields: ["dueDate", "responseRequiredBy"],
    closedStatuses: ["closed", "archived"],
  },
  submittal: {
    model: "submittal",
    label: "Submittal",
    moduleCategory: NOTIFICATION_CATEGORIES.APPROVAL,
    assignmentFields: ["owner", "reviewer", "approver"],
    dueFields: ["dueDate"],
    closedStatuses: ["approved", "rejected", "archived"],
  },
  change_order: {
    model: "changeOrder",
    label: "Change order",
    moduleCategory: NOTIFICATION_CATEGORIES.COMMERCIAL,
    assignmentFields: [
      "raisedBy",
      "createdBy",
      "updatedBy",
      "approvedBy",
      "rejectedBy",
    ],
    closedStatuses: ["approved", "rejected", "archived"],
  },
  ipc_certificate: {
    model: "ipcCertificate",
    label: "IPC",
    moduleCategory: NOTIFICATION_CATEGORIES.COMMERCIAL,
    assignmentFields: ["submittedBy", "certifiedBy", "certificationOverrideBy"],
    dueFields: ["dueDate"],
    closedStatuses: ["paid"],
  },
  eot_claim: {
    model: "eotClaim",
    label: "EOT claim",
    moduleCategory: NOTIFICATION_CATEGORIES.COMMERCIAL,
    assignmentFields: ["submittedBy", "approvedBy", "rejectedBy"],
    closedStatuses: ["approved", "rejected"],
  },
  ncr: {
    model: "ncrRecord",
    label: "NCR",
    moduleCategory: NOTIFICATION_CATEGORIES.QUALITY,
    assignmentFields: [
      "owner",
      "reviewer",
      "approver",
      "responsible",
      "closureSubmittedBy",
      "closureApprovedBy",
      "reopenedBy",
    ],
    dueFields: ["dueDate"],
    closedStatuses: ["closed"],
  },
  safety_incident: {
    model: "safetyIncident",
    label: "Safety incident",
    moduleCategory: NOTIFICATION_CATEGORIES.SAFETY,
    assignmentFields: [
      "owner",
      "reviewer",
      "approver",
      "responsible",
      "closureSubmittedBy",
      "closureApprovedBy",
      "reopenedBy",
    ],
    dueFields: ["dueDate"],
    closedStatuses: ["closed", "archived"],
  },
  risk: {
    model: "risk",
    label: "Risk",
    moduleCategory: NOTIFICATION_CATEGORIES.WORKFLOW,
    assignmentFields: [
      "owner",
      "closeoutSubmittedBy",
      "closedBy",
      "rejectedBy",
      "reopenedBy",
    ],
    dueFields: ["dueDate"],
    closedStatuses: ["closed", "archived"],
  },
  task: {
    model: "task",
    label: "Task",
    moduleCategory: NOTIFICATION_CATEGORIES.TASK,
    assignmentFields: ["assigneeId", "createdById"],
    dueFields: ["dueDate"],
    closedStatuses: ["done", "canceled", "archived"],
  },
});

const DUE_RECORDS = Object.freeze({
  ...WORKFLOW_RECORDS,
  itp: {
    model: "itpRecord",
    label: "ITP",
    moduleCategory: NOTIFICATION_CATEGORIES.QUALITY,
    assignmentFields: ["owner", "reviewer", "approver", "inspector"],
    dueFields: ["dueDate", "inspectionDate"],
    statusField: "status",
    closedStatuses: ["passed", "failed", "waived"],
  },
  defect: {
    model: "defectRecord",
    label: "Defect",
    moduleCategory: NOTIFICATION_CATEGORIES.QUALITY,
    assignmentFields: ["owner", "reviewer", "approver", "assignee"],
    dueFields: ["dueDate", "targetCloseBy"],
    statusField: "status",
    closedStatuses: ["closed"],
  },
  punch_item: {
    model: "punchItem",
    label: "Punch item",
    moduleCategory: NOTIFICATION_CATEGORIES.QUALITY,
    assignmentFields: ["assigneeUserId", "managerUserId", "finalApproverUserId", "createdBy"],
    dueFields: ["dueDate"],
    statusField: "status",
    closedStatuses: ["closed", "void"],
  },
  form_instance: {
    model: "formInstance",
    label: "Inspection",
    moduleCategory: NOTIFICATION_CATEGORIES.QUALITY,
    assignmentFields: ["assigneeUserId", "inspectorUserId", "approverUserId", "createdBy"],
    dueFields: ["dueDate", "scheduledFor"],
    statusField: "status",
    closedStatuses: ["complete", "closed", "void"],
  },
  material_test: {
    model: "materialTest",
    label: "Material test",
    moduleCategory: NOTIFICATION_CATEGORIES.QUALITY,
    assignmentFields: ["owner", "reviewer", "approver"],
    dueFields: ["dueDate", "testDate"],
    statusField: "result",
    closedStatuses: ["pass", "passed", "fail", "failed"],
  },
  drawing: {
    model: "drawingRecord",
    label: "Drawing",
    moduleCategory: NOTIFICATION_CATEGORIES.APPROVAL,
    assignmentFields: ["owner", "reviewer", "approver"],
    dueFields: ["dueDate"],
    statusField: "status",
    closedStatuses: ["cancelled", "superseded"],
  },
  transmittal: {
    model: "transmittal",
    label: "Transmittal",
    moduleCategory: NOTIFICATION_CATEGORIES.APPROVAL,
    assignmentFields: ["owner", "reviewer", "approver", "recipient"],
    dueFields: ["dueDate"],
    statusField: "status",
    closedStatuses: ["acknowledged"],
  },
  correspondence: {
    model: "correspondence",
    label: "Correspondence",
    moduleCategory: NOTIFICATION_CATEGORIES.APPROVAL,
    assignmentFields: ["owner", "reviewer", "approver"],
    dueFields: ["dueDate", "responseRequiredBy"],
    statusField: "status",
    closedStatuses: ["closed"],
  },
});

const trim = (value) => trimToNull(value);

const asIso = (value) => {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
};

const compactJson = (value) => {
  if (value === null || value === undefined) return {};
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(compactJson);
  if (typeof value !== "object") return value;
  return Object.entries(value).reduce((acc, [key, raw]) => {
    acc[key] = compactJson(raw);
    return acc;
  }, {});
};

const unique = (values) => [
  ...new Set((values || []).map(trim).filter(Boolean)),
];

const isUuidLike = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const dayKey = (value) => new Date(value).toISOString().slice(0, 10);

const defaultPreferenceFor = (category) => ({
  category,
  inAppEnabled: true,
  emailEnabled: DEFAULT_EMAIL_CATEGORIES.has(category),
  digestEnabled: false,
  dueSoonDays: 3,
  quietHoursStart: null,
  quietHoursEnd: null,
});

const serializePreference = (preference) => ({
  id: preference.id || null,
  category: preference.category,
  inAppEnabled: Boolean(preference.inAppEnabled),
  emailEnabled: Boolean(preference.emailEnabled),
  digestEnabled: Boolean(preference.digestEnabled),
  dueSoonDays: Number(preference.dueSoonDays || 3),
  quietHoursStart: preference.quietHoursStart || null,
  quietHoursEnd: preference.quietHoursEnd || null,
  updatedAt: asIso(preference.updatedAt),
});

const serializeDeliveryAttempt = (attempt) => ({
  id: attempt.id,
  notificationId: attempt.notificationId,
  channel: attempt.channel,
  provider: attempt.provider || null,
  status: attempt.status,
  attemptNumber: attempt.attemptNumber,
  errorCode: attempt.errorCode || null,
  errorMessage: attempt.errorMessage || null,
  nextAttemptAt: asIso(attempt.nextAttemptAt),
  sentAt: asIso(attempt.sentAt),
  metadata: attempt.metadataJson || {},
  createdAt: asIso(attempt.createdAt),
  updatedAt: asIso(attempt.updatedAt),
});

const serializeNotification = (notification) => ({
  id: notification.id,
  orgId: notification.orgId,
  projectId: notification.projectId || null,
  recipientUserId: notification.recipientUserId,
  actorId: notification.actorId || null,
  type: notification.type,
  category: notification.category,
  event: notification.event,
  title: notification.title,
  message: notification.message,
  priority: notification.priority,
  status: notification.archivedAt
    ? "archived"
    : notification.readAt
      ? "read"
      : "unread",
  readAt: asIso(notification.readAt),
  archivedAt: asIso(notification.archivedAt),
  dueAt: asIso(notification.dueAt),
  actionUrl: notification.actionUrl || null,
  entityType: notification.entityType || null,
  entityId: notification.entityId || null,
  metadata: notification.metadataJson || {},
  deliveryAttempts: (notification.deliveryAttempts || []).map(
    serializeDeliveryAttempt,
  ),
  createdAt: asIso(notification.createdAt),
  updatedAt: asIso(notification.updatedAt),
});

const ensureNotificationModels = (tx) =>
  tx?.notification?.create && tx?.notificationPreference?.findMany;

const preferenceMapForUsers = async ({
  tx = prisma,
  orgId,
  userIds,
  category,
}) => {
  if (!tx.notificationPreference?.findMany || !userIds.length) return new Map();

  const rows = await tx.notificationPreference.findMany({
    where: { orgId, userId: { in: userIds }, category },
  });

  return rows.reduce((acc, row) => {
    acc.set(row.userId, serializePreference(row));
    return acc;
  }, new Map());
};

const getUserPreferences = async ({ orgId, userId }) => {
  if (!prisma.notificationPreference?.findMany) {
    return {
      preferences: CATEGORY_ORDER.map((category) =>
        serializePreference(defaultPreferenceFor(category)),
      ),
    };
  }

  const existing = await prisma.notificationPreference.findMany({
    where: { orgId, userId },
  });
  const existingByCategory = new Map(
    existing.map((preference) => [preference.category, preference]),
  );
  const missing = CATEGORY_ORDER.filter(
    (category) => !existingByCategory.has(category),
  );

  if (missing.length && prisma.notificationPreference.createMany) {
    await prisma.notificationPreference.createMany({
      data: missing.map((category) => ({
        orgId,
        userId,
        ...defaultPreferenceFor(category),
      })),
      skipDuplicates: true,
    });
  }

  const rows = await prisma.notificationPreference.findMany({
    where: { orgId, userId },
    orderBy: [{ category: "asc" }],
  });
  const rowByCategory = new Map(rows.map((row) => [row.category, row]));

  return {
    preferences: CATEGORY_ORDER.map((category) =>
      serializePreference(
        rowByCategory.get(category) || defaultPreferenceFor(category),
      ),
    ),
  };
};

const normalizePreferenceUpdate = (entry = {}) => {
  const category = trim(entry.category);
  if (!CATEGORY_ORDER.includes(category)) {
    throw new HttpError(
      400,
      "NOTIFICATION_PREFERENCE_INVALID",
      "Notification preference category is invalid",
      { category },
    );
  }

  return {
    category,
    inAppEnabled:
      entry.inAppEnabled === undefined
        ? defaultPreferenceFor(category).inAppEnabled
        : Boolean(entry.inAppEnabled),
    emailEnabled:
      entry.emailEnabled === undefined
        ? defaultPreferenceFor(category).emailEnabled
        : Boolean(entry.emailEnabled),
    digestEnabled: Boolean(entry.digestEnabled),
    dueSoonDays: Math.min(Math.max(Number(entry.dueSoonDays) || 3, 1), 30),
    quietHoursStart: trim(entry.quietHoursStart),
    quietHoursEnd: trim(entry.quietHoursEnd),
  };
};

const updateUserPreferences = async ({ orgId, userId, preferences }) => {
  const rows = (preferences || []).map(normalizePreferenceUpdate);
  if (!rows.length) return getUserPreferences({ orgId, userId });

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      await tx.notificationPreference.upsert({
        where: { userId_category: { userId, category: row.category } },
        create: { orgId, userId, ...row },
        update: row,
      });
    }
  });

  return getUserPreferences({ orgId, userId });
};

const addUsersToMap = (map, users, actorId) => {
  for (const user of users || []) {
    if (!user?.id || user.id === actorId) continue;
    map.set(user.id, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  }
};

const resolveNotificationRecipients = async ({
  tx = prisma,
  orgId,
  projectId = null,
  actorId = null,
  recipientUserIds = [],
  recipientRoles = [],
  assignmentRefs = [],
}) => {
  if (!tx.user?.findMany) return [];

  const recipients = new Map();
  const directIds = unique(recipientUserIds);
  const refs = unique(assignmentRefs);
  const roleSet = new Set(
    unique(recipientRoles)
      .map((role) => normalizeRoleId(role))
      .filter(Boolean),
  );
  const select = { id: true, email: true, name: true, role: true };

  if (directIds.length) {
    const users = await tx.user.findMany({
      where: { orgId, id: { in: directIds }, status: "active" },
      select,
    });
    addUsersToMap(recipients, users, actorId);
  }

  // Assignment refs are user ids only (OCTA-DATA-REFS-004): free-text names
  // are never matched, so a typo can no longer notify the wrong person.
  const refIds = refs.filter((ref) => isUuidLike(ref) && !directIds.includes(ref));
  if (refIds.length) {
    const users = await tx.user.findMany({
      where: { orgId, status: "active", id: { in: refIds } },
      select,
    });
    addUsersToMap(recipients, users, actorId);
  }

  if (roleSet.size) {
    const roles = [...roleSet];
    const orgRoleUsers = await tx.user.findMany({
      where: { orgId, status: "active", role: { in: roles } },
      select,
    });
    addUsersToMap(recipients, orgRoleUsers, actorId);

    if (projectId) {
      const projectRoleUsers = await tx.user.findMany({
        where: {
          orgId,
          status: "active",
          projectAssignments: { some: { projectId } },
        },
        select: {
          ...select,
          projectAssignments: {
            where: { projectId },
            select: { role: true },
          },
        },
      });
      addUsersToMap(
        recipients,
        projectRoleUsers.filter((user) =>
          user.projectAssignments?.some((assignment) =>
            roleSet.has(normalizeRoleId(assignment.role)),
          ),
        ),
        actorId,
      );
    }
  }

  return [...recipients.values()];
};

const createNotifications = async ({
  tx = prisma,
  orgId,
  projectId = null,
  actorId = null,
  recipientUserIds = [],
  recipientRoles = [],
  assignmentRefs = [],
  type = "workflow",
  category = NOTIFICATION_CATEGORIES.WORKFLOW,
  event,
  title,
  message,
  priority = "normal",
  dueAt = null,
  actionUrl = null,
  entityType = null,
  entityId = null,
  dedupeKeyBase = null,
  metadata = {},
}) => {
  if (!ensureNotificationModels(tx) || !event || !title || !message) {
    return { created: 0, recipients: [] };
  }

  const recipients = await resolveNotificationRecipients({
    tx,
    orgId,
    projectId,
    actorId,
    recipientUserIds,
    recipientRoles,
    assignmentRefs,
  });
  if (!recipients.length) return { created: 0, recipients: [] };

  const preferenceByUser = await preferenceMapForUsers({
    tx,
    orgId,
    userIds: recipients.map((recipient) => recipient.id),
    category,
  });

  const created = [];
  for (const recipient of recipients) {
    const preference =
      preferenceByUser.get(recipient.id) || defaultPreferenceFor(category);
    if (!preference.inAppEnabled && !preference.emailEnabled) continue;

    try {
      const notification = await tx.notification.create({
        data: {
          orgId,
          projectId,
          recipientUserId: recipient.id,
          actorId: actorId || null,
          type,
          category,
          event,
          title,
          message,
          priority,
          inAppVisible: preference.inAppEnabled,
          dueAt: dueAt ? new Date(dueAt) : null,
          actionUrl,
          entityType,
          entityId,
          dedupeKey: dedupeKeyBase ? `${dedupeKeyBase}:${recipient.id}` : null,
          metadataJson: compactJson(metadata),
        },
      });

      if (preference.emailEnabled && tx.notificationDeliveryAttempt?.create) {
        await tx.notificationDeliveryAttempt.create({
          data: {
            notificationId: notification.id,
            orgId,
            userId: recipient.id,
            channel: "email",
            status: "pending",
            attemptNumber: 1,
            nextAttemptAt: new Date(),
          },
        });
      }

      created.push(notification);
    } catch (error) {
      if (error?.code !== "P2002") throw error;
    }
  }

  if (created.length) {
    // Realtime badge refresh for recipients only; never broadcast to a project room.
    domainEvents.publish({
      type: domainEvents.EVENT_TYPES.NOTIFICATION_CREATED,
      orgId,
      projectId,
      entityType,
      entityId,
      action: event,
      actorId,
      recipientUserIds: created.map((row) => row.recipientUserId),
      payload: { count: created.length, category, title, event },
    });
  }

  return {
    created: created.length,
    recipients: recipients.map((recipient) => recipient.id),
  };
};

const recordDisplay = (record = {}) =>
  record.ref ||
  record.period ||
  record.label ||
  record.title ||
  record.subject ||
  record.description ||
  record.eventName ||
  record.id;

const recordSubject = (record = {}) =>
  record.subject ||
  record.title ||
  record.description ||
  record.eventName ||
  record.period ||
  record.ref ||
  "Workflow record";

// Opens the record's own workspace module with the record pre-selected
// (module routes, OCTA-FE-ROUTES-008).
const actionUrlFor = ({ projectId, recordType, recordId }) =>
  recordWorkspacePath({ projectId, recordType, recordId });

const USER_REFERENCE_FIELDS = [
  "ownerUserId",
  "reviewerUserId",
  "approverUserId",
  "assigneeUserId",
  "ballInCourtUserId",
];

// Recipients come from id columns only: the record's accountability
// references plus any configured actor-id fields (createdBy, submittedBy…).
const assignmentRefsFor = (record, fields = []) =>
  unique(
    [...USER_REFERENCE_FIELDS, ...fields]
      .map((field) => record?.[field])
      .filter((value) => value && isUuidLike(String(value))),
  );

const workflowCategory = ({
  action,
  toStatus,
  recordConfig,
  assignmentRefs,
}) => {
  if (
    ["submitted", "answered", "reviewed"].includes(action) ||
    ["pending", "submitted", "under_review"].includes(toStatus)
  ) {
    return NOTIFICATION_CATEGORIES.APPROVAL;
  }
  if (
    [
      "approved",
      "rejected",
      "certified",
      "paid",
      "closed",
      "resubmit_required",
    ].includes(action)
  ) {
    return NOTIFICATION_CATEGORIES.APPROVAL;
  }
  if (action === "created" && assignmentRefs.length) {
    return NOTIFICATION_CATEGORIES.ASSIGNMENT;
  }
  return recordConfig.moduleCategory || NOTIFICATION_CATEGORIES.WORKFLOW;
};

const workflowTitle = ({ label, display, action }) => {
  const base = `${label} ${display}`;
  const titles = {
    created: `${base} assigned`,
    submitted: `${base} needs approval`,
    answered: `${base} needs review`,
    reviewed: `${base} reviewed`,
    approved: `${base} approved`,
    rejected: `${base} rejected`,
    resubmit_required: `${base} needs resubmission`,
    certified: `${base} certified`,
    paid: `${base} paid`,
    closed: `${base} closed`,
    reopened: `${base} reopened`,
    archived: `${base} archived`,
  };
  return titles[action] || `${base} updated`;
};

const workflowMessage = ({ record, event, label }) => {
  const subject = recordSubject(record);
  const comment = trim(event.comment || event.reason);
  const statusText =
    event.toStatus && event.fromStatus !== event.toStatus
      ? ` Status moved to ${event.toStatus}.`
      : "";
  const commentText = comment ? ` ${comment}` : "";
  return `${label}: ${subject}.${statusText}${commentText}`.trim();
};

const loadWorkflowRecord = async ({ tx, projectId, recordType, recordId }) => {
  const config = WORKFLOW_RECORDS[recordType] || DUE_RECORDS[recordType];
  const model = config?.model ? tx?.[config.model] : null;
  if (!config || !model?.findFirst) return { config, record: null };

  const record = await model.findFirst({
    where: { id: recordId, projectId },
  });
  return { config, record };
};

const createWorkflowNotifications = async ({ tx = prisma, workflowEvent }) => {
  if (!workflowEvent?.orgId || !workflowEvent.projectId) {
    return { created: 0, recipients: [] };
  }

  const { config, record } = await loadWorkflowRecord({
    tx,
    projectId: workflowEvent.projectId,
    recordType: workflowEvent.recordType,
    recordId: workflowEvent.recordId,
  });
  if (!config) return { created: 0, recipients: [] };

  const assignmentRefs = assignmentRefsFor(record, config.assignmentFields);
  const isApprovalRequest =
    ["submitted", "answered", "reviewed"].includes(workflowEvent.action) ||
    ["pending", "submitted", "under_review"].includes(
      workflowEvent.toStatus || "",
    );
  const recipientRoles = isApprovalRequest ? ["pm"] : [];
  const category = workflowCategory({
    action: workflowEvent.action,
    toStatus: workflowEvent.toStatus || "",
    recordConfig: config,
    assignmentRefs,
  });
  const display = recordDisplay(record || workflowEvent.metadata || {});

  return createNotifications({
    tx,
    orgId: workflowEvent.orgId,
    projectId: workflowEvent.projectId,
    actorId: workflowEvent.actorId || null,
    recipientRoles,
    assignmentRefs,
    type: "workflow",
    category,
    event: `workflow.${workflowEvent.action}`,
    title: workflowTitle({
      label: config.label,
      display,
      action: workflowEvent.action,
    }),
    message: workflowMessage({
      record: record || workflowEvent.metadata || {},
      event: workflowEvent,
      label: config.label,
    }),
    priority: isApprovalRequest ? "high" : "normal",
    actionUrl: actionUrlFor({
      projectId: workflowEvent.projectId,
      recordType: workflowEvent.recordType,
      recordId: workflowEvent.recordId,
    }),
    entityType: workflowEvent.recordType,
    entityId: workflowEvent.recordId,
    dedupeKeyBase: workflowEvent.id
      ? `workflow:${workflowEvent.id}`
      : `workflow:${workflowEvent.recordType}:${workflowEvent.recordId}:${workflowEvent.action}:${Date.now()}`,
    metadata: {
      workflowEventId: workflowEvent.id || null,
      workflowType: workflowEvent.workflowType,
      action: workflowEvent.action,
      decision: workflowEvent.decision,
      fromStatus: workflowEvent.fromStatus,
      toStatus: workflowEvent.toStatus,
      recordType: workflowEvent.recordType,
      recordId: workflowEvent.recordId,
    },
  });
};

const emitTaskNotification = async ({
  tx = prisma,
  orgId,
  projectId = null,
  taskId,
  actorId = null,
  assigneeIds = [],
  title,
  message,
  event = "task.assigned",
  dueAt = null,
  priority = "normal",
  metadata = {},
}) =>
  createNotifications({
    tx,
    orgId,
    projectId,
    actorId,
    recipientUserIds: assigneeIds,
    type: "task",
    category: NOTIFICATION_CATEGORIES.TASK,
    event,
    title,
    message,
    priority,
    dueAt,
    actionUrl: projectId
      ? `/projects/${projectId}?module=tasks&taskId=${encodeURIComponent(taskId)}`
      : "/tasks",
    entityType: "task",
    entityId: taskId,
    dedupeKeyBase: `task:${event}:${taskId}`,
    metadata,
  });

const notificationWhereForStatus = (where, status) => {
  if (status === "archived") {
    where.archivedAt = { not: null };
    return;
  }
  if (status === "read") {
    where.readAt = { not: null };
    where.archivedAt = null;
    return;
  }
  if (status === "unread") {
    where.readAt = null;
    where.archivedAt = null;
    return;
  }
  if (status !== "all") {
    where.archivedAt = null;
  }
};

const listNotifications = async ({ orgId, userId, query = {} }) => {
  const listQuery = normalizeListQuery(query, {
    allowedSorts: ["created"],
    defaultSortBy: "created",
    defaultSortDir: "desc",
    defaultLimit: 25,
    maxLimit: 100,
  });
  const status = trim(query.status) || "active";
  const where = {
    orgId,
    recipientUserId: userId,
    inAppVisible: true,
  };
  notificationWhereForStatus(where, status);

  const category = trim(query.category);
  if (category && CATEGORY_ORDER.includes(category)) where.category = category;
  const projectId = trim(query.projectId);
  if (projectId) where.projectId = projectId;

  const rows = await prisma.notification.findMany({
    where,
    take: listQuery.limit + 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...cursorArgs(listQuery.cursor),
    include: {
      deliveryAttempts: {
        orderBy: [{ createdAt: "desc" }],
        take: 3,
      },
    },
  });
  const page = toCursorPage(rows, listQuery.limit);
  return {
    rows: page.rows.map(serializeNotification),
    pagination: page.pagination,
  };
};

const getNotificationForUser = async ({ orgId, userId, notificationId }) => {
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      orgId,
      recipientUserId: userId,
    },
    include: {
      deliveryAttempts: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  });

  if (!notification) {
    throw new HttpError(
      404,
      "NOTIFICATION_NOT_FOUND",
      "Notification not found",
    );
  }

  return notification;
};

const getNotificationSummary = async ({ orgId, userId }) => {
  const [unread, read, archived, recent] = await Promise.all([
    prisma.notification.count({
      where: {
        orgId,
        recipientUserId: userId,
        inAppVisible: true,
        readAt: null,
        archivedAt: null,
      },
    }),
    prisma.notification.count({
      where: {
        orgId,
        recipientUserId: userId,
        inAppVisible: true,
        readAt: { not: null },
        archivedAt: null,
      },
    }),
    prisma.notification.count({
      where: {
        orgId,
        recipientUserId: userId,
        inAppVisible: true,
        archivedAt: { not: null },
      },
    }),
    prisma.notification.findMany({
      where: {
        orgId,
        recipientUserId: userId,
        inAppVisible: true,
        archivedAt: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
    }),
  ]);

  return {
    unread,
    read,
    archived,
    recent: recent.map(serializeNotification),
  };
};

const markNotificationRead = async ({
  orgId,
  userId,
  notificationId,
  read = true,
}) => {
  await getNotificationForUser({ orgId, userId, notificationId });
  const notification = await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: read ? new Date() : null },
    include: {
      deliveryAttempts: { orderBy: [{ createdAt: "desc" }], take: 3 },
    },
  });
  return serializeNotification(notification);
};

const archiveNotification = async ({ orgId, userId, notificationId }) => {
  await getNotificationForUser({ orgId, userId, notificationId });
  const notification = await prisma.notification.update({
    where: { id: notificationId },
    data: { archivedAt: new Date() },
    include: {
      deliveryAttempts: { orderBy: [{ createdAt: "desc" }], take: 3 },
    },
  });
  return serializeNotification(notification);
};

const markAllRead = async ({ orgId, userId }) => {
  const result = await prisma.notification.updateMany({
    where: {
      orgId,
      recipientUserId: userId,
      inAppVisible: true,
      readAt: null,
      archivedAt: null,
    },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
};

const deliveryBody = (notification) =>
  [
    notification.message,
    "",
    notification.actionUrl
      ? `Open in OctaPM: ${process.env.WEB_APP_URL || ""}${notification.actionUrl}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

const nextRetryAt = (attemptNumber, now) =>
  new Date(
    now.getTime() + Math.min(60, 5 * 2 ** (attemptNumber - 1)) * 60 * 1000,
  );

const processPendingEmailDeliveries = async ({
  limit = 25,
  now = new Date(),
  userId = null,
  notificationId = null,
} = {}) => {
  if (!prisma.notificationDeliveryAttempt?.findMany) {
    return { sent: 0, failed: 0, skipped: 0, processed: 0 };
  }

  const where = {
    channel: "email",
    status: "pending",
    attemptNumber: { lte: MAX_EMAIL_ATTEMPTS },
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
  };
  if (userId) where.userId = userId;
  if (notificationId) where.notificationId = notificationId;

  const attempts = await prisma.notificationDeliveryAttempt.findMany({
    where,
    take: Math.min(Math.max(Number(limit) || 25, 1), 100),
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    include: {
      notification: {
        include: {
          recipient: { select: { id: true, email: true, name: true } },
        },
      },
    },
  });

  const result = { sent: 0, failed: 0, skipped: 0, processed: 0 };
  for (const attempt of attempts) {
    result.processed += 1;
    const notification = attempt.notification;
    const to = notification?.recipient?.email;

    if (!notification || !to) {
      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "skipped",
          errorCode: "EMAIL_RECIPIENT_MISSING",
          errorMessage: "Notification recipient email is missing",
          metadataJson: { skippedAt: now.toISOString() },
        },
      });
      result.skipped += 1;
      continue;
    }

    try {
      const providerResult = await sendEmail({
        to,
        subject: notification.title,
        body: deliveryBody(notification),
        metadata: {
          notificationId: notification.id,
          category: notification.category,
          event: notification.event,
          entityType: notification.entityType,
          entityId: notification.entityId,
        },
      });
      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "sent",
          provider: providerResult.provider || "unknown",
          sentAt: now,
          metadataJson: compactJson(providerResult),
        },
      });
      result.sent += 1;
    } catch (error) {
      const errorCode = error?.code || "EMAIL_DELIVERY_FAILED";
      const errorMessage = error?.message || "Email delivery failed";
      const nextAttemptNumber = attempt.attemptNumber + 1;
      const canRetry = nextAttemptNumber <= MAX_EMAIL_ATTEMPTS;

      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "failed",
          errorCode,
          errorMessage,
          nextAttemptAt: canRetry
            ? nextRetryAt(attempt.attemptNumber, now)
            : null,
          metadataJson: {
            failedAt: now.toISOString(),
            retryQueued: canRetry,
          },
        },
      });

      if (canRetry) {
        await prisma.notificationDeliveryAttempt.create({
          data: {
            notificationId: notification.id,
            orgId: notification.orgId,
            userId: notification.recipientUserId,
            channel: "email",
            status: "pending",
            attemptNumber: nextAttemptNumber,
            nextAttemptAt: nextRetryAt(attempt.attemptNumber, now),
          },
        });
      }

      result.failed += 1;
    }
  }

  return result;
};

const retryNotificationEmail = async ({ orgId, userId, notificationId }) => {
  const notification = await getNotificationForUser({
    orgId,
    userId,
    notificationId,
  });
  const attempts = notification.deliveryAttempts || [];
  const lastAttempt = attempts[0];

  if (lastAttempt?.status === "sent") {
    return { queued: false, reason: "already_sent" };
  }

  await prisma.notificationDeliveryAttempt.create({
    data: {
      notificationId,
      orgId,
      userId,
      channel: "email",
      status: "pending",
      attemptNumber:
        lastAttempt?.attemptNumber &&
        lastAttempt.attemptNumber < MAX_EMAIL_ATTEMPTS
          ? lastAttempt.attemptNumber + 1
          : 1,
      nextAttemptAt: new Date(),
    },
  });

  const delivery = await processPendingEmailDeliveries({
    userId,
    notificationId,
    limit: 1,
  });
  return { queued: true, delivery };
};

const dueRecordTitle = ({ config, record, event }) =>
  `${config.label} ${recordDisplay(record)} ${event === "overdue" ? "is overdue" : "is due soon"}`;

const dueRecordMessage = ({ config, record, dueAt, event }) => {
  const dueText = new Date(dueAt).toISOString().slice(0, 10);
  const prefix = event === "overdue" ? "Overdue since" : "Due on";
  return `${config.label}: ${recordSubject(record)}. ${prefix} ${dueText}.`;
};

const isClosedRecord = (record, config) => {
  const field = config.statusField || "status";
  const value = String(record?.[field] || "").toLowerCase();
  return (config.closedStatuses || []).includes(value);
};

const createDueNotificationsForProject = async ({
  orgId,
  projectId,
  now = new Date(),
  horizonDays = 3,
}) => {
  let created = 0;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + horizonDays * DAY_MS);

  for (const [recordType, config] of Object.entries(DUE_RECORDS)) {
    const model = prisma[config.model];
    if (!model?.findMany || !config.dueFields?.length) continue;

    for (const dueField of config.dueFields) {
      const rows = await model.findMany({
        where: {
          projectId,
          [dueField]: { not: null, lte: horizon },
        },
        take: 200,
        orderBy: [{ [dueField]: "asc" }],
      });

      for (const record of rows) {
        if (isClosedRecord(record, config)) continue;
        const dueAt = record[dueField];
        const event =
          new Date(dueAt).getTime() < today.getTime() ? "overdue" : "due_soon";
        const category =
          event === "overdue"
            ? NOTIFICATION_CATEGORIES.OVERDUE
            : NOTIFICATION_CATEGORIES.DUE;
        const result = await createNotifications({
          orgId,
          projectId,
          recipientRoles: ["pm"],
          assignmentRefs: assignmentRefsFor(record, config.assignmentFields),
          type: "due_date",
          category,
          event: `due_date.${event}`,
          title: dueRecordTitle({ config, record, event: category }),
          message: dueRecordMessage({ config, record, dueAt, event: category }),
          priority: event === "overdue" ? "urgent" : "high",
          dueAt,
          actionUrl: actionUrlFor({
            projectId,
            recordType,
            recordId: record.id,
          }),
          entityType: recordType,
          entityId: record.id,
          dedupeKeyBase: `due:${recordType}:${record.id}:${dueField}:${event}:${dayKey(now)}`,
          metadata: { recordType, recordId: record.id, dueField, event },
        });
        created += result.created;
      }
    }
  }

  return { created };
};

const runDueNotificationScan = async ({
  orgId,
  projectId = null,
  now = new Date(),
  horizonDays = 3,
}) => {
  const projects = projectId
    ? await prisma.project.findMany({ where: { id: projectId, orgId } })
    : await prisma.project.findMany({
        where: { orgId, archivedAt: null, status: { not: "cancelled" } },
        select: { id: true, orgId: true },
      });

  let created = 0;
  for (const project of projects) {
    const result = await createDueNotificationsForProject({
      orgId: project.orgId || orgId,
      projectId: project.id,
      now,
      horizonDays,
    });
    created += result.created;
  }

  return { projects: projects.length, created };
};

module.exports = {
  CATEGORY_ORDER,
  NOTIFICATION_CATEGORIES,
  archiveNotification,
  createDueNotificationsForProject,
  createNotifications,
  createWorkflowNotifications,
  emitTaskNotification,
  getNotificationForUser: async (params) =>
    serializeNotification(await getNotificationForUser(params)),
  getNotificationSummary,
  getUserPreferences,
  listNotifications,
  markAllRead,
  markNotificationRead,
  processPendingEmailDeliveries,
  retryNotificationEmail,
  runDueNotificationScan,
  updateUserPreferences,
};
