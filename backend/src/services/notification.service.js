const { prisma } = require("../config/db");
const domains = require("../config/domains");
const linkAudience = require("./link-audience.service");
const { normalizeRoleId } = require("../config/permissions");
const { sendEmail } = require("./email.service");
const { HttpError } = require("../utils/http-error");
const domainEvents = require("../events/bus");
const { recordWorkspacePath, workspacePath, workspaceSegment } = require("../utils/record-links");
const {
  cursorArgs,
  normalizeListQuery,
  toCursorPage,
  trimToNull,
} = require("../utils/list-query");

const MAX_EMAIL_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const inboundAddresses = require("../utils/inbound-addresses");

/** Reply-To for a notification email: the record's or conversation's inbound address, when inbound mail is configured. */
const replyAddressFor = (notification) => {
  if (!notification?.entityType || !notification?.entityId || !inboundAddresses.isInboundConfigured()) return null;
  if (notification.entityType === "conversation") return inboundAddresses.conversationReplyAddress(notification.entityId);
  return inboundAddresses.recordReplyAddress({ recordType: notification.entityType, recordId: notification.entityId });
};

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
  MESSAGE: "message",
});

const CATEGORY_ORDER = Object.freeze([
  NOTIFICATION_CATEGORIES.ASSIGNMENT,
  NOTIFICATION_CATEGORIES.MENTION,
  NOTIFICATION_CATEGORIES.COMMENT,
  NOTIFICATION_CATEGORIES.MESSAGE,
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
      "managerUserId",
      "ballInCourtUserId",
      "assigneeUserId",
      "createdBy",
    ],
    dueFields: ["dueDate", "responseRequiredBy"],
    closedStatuses: ["closed", "archived"],
  },
  submittal: {
    model: "submittal",
    label: "Submittal",
    moduleCategory: NOTIFICATION_CATEGORIES.APPROVAL,
    assignmentFields: ["owner", "reviewer", "approver", "managerUserId", "ballInCourtUserId", "createdBy"],
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
  pushEnabled: true,
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
  pushEnabled: preference.pushEnabled === undefined ? true : Boolean(preference.pushEnabled),
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

/*
 * A bulk step's transaction — an import batch applied or undone, one
 * workflow transition per row inside ONE interactive transaction, bounded by
 * Prisma's timeout — fans a notice out for every row, and each fan-out read
 * the same things again: the project's PMs, the people a row names (its
 * creator, its submitter), their notification preferences and push devices,
 * and whether each may read the BOQ. Such a step marks its transaction
 * (inBulkTransaction), and inside it each of those is read once for the
 * whole transaction: a transaction is one moment, and a bulk step changes
 * none of them (closure review, 2026-09-28 — the undo of a 100-row batch ran
 * past the timeout). Any other transaction reads them per fan-out, as before.
 */
const bulkTransactionMemos = new WeakMap();

/** Marks `tx` (an interactive transaction's client) as a bulk step's; returns it. */
const inBulkTransaction = (tx) => {
  if (tx && typeof tx === "object" && tx !== prisma && !bulkTransactionMemos.has(tx)) {
    bulkTransactionMemos.set(tx, new Map());
  }
  return tx;
};

/** `load()` once per key inside a bulk step's transaction; every time elsewhere. */
const onceInBulkTransaction = (tx, key, load) => {
  const memo = tx && typeof tx === "object" ? bulkTransactionMemos.get(tx) : null;
  if (!memo) return load();
  if (!memo.has(key)) memo.set(key, load());
  return memo.get(key);
};

const idsKey = (ids) => [...ids].sort().join(",");

const preferenceMapForUsers = async ({
  tx = prisma,
  orgId,
  userIds,
  category,
}) => {
  if (!tx.notificationPreference?.findMany || !userIds.length) return new Map();

  const rows = await onceInBulkTransaction(tx, `preferences|${orgId}|${category}|${idsKey(userIds)}`, () =>
    tx.notificationPreference.findMany({
      where: { orgId, userId: { in: userIds }, category },
    }),
  );

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
    pushEnabled:
      entry.pushEnabled === undefined ? true : Boolean(entry.pushEnabled),
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
  // A person addressed by id belongs to this workspace through an active
  // membership in it (ENT-5): a member whose home is another workspace is
  // still notified here, and the socket router then delivers it to their
  // member room in this workspace and nowhere else. User.orgId alone no
  // longer qualifies anyone: a person removed from their home workspace keeps
  // User.orgId and an active identity while another workspace remains, and a
  // revoked membership must lose the workspace's notifications and pushes
  // (§11). Only a person with no membership row here at all — an account from
  // before memberships — is still recognised by User.orgId.
  const membershipService = require("./membership.service");
  const byMembership = membershipService.hasMembershipModel(tx) && membershipService.isMembershipReadEnabled();
  const ACTIVE_MEMBERSHIP = membershipService.MEMBERSHIP_STATUSES.ACTIVE;
  const inThisWorkspace = (where) =>
    byMembership
      ? {
          ...where,
          OR: [
            { memberships: { some: { orgId, status: ACTIVE_MEMBERSHIP } } },
            { orgId, memberships: { none: { orgId } } },
          ],
        }
      : { ...where, orgId };
  // Role-addressed lookups keep their home-workspace reading of User.role;
  // they only lose the person whose membership here is not active.
  const homeInGoodStanding = (where) =>
    byMembership
      ? { ...where, orgId, NOT: { memberships: { some: { orgId, status: { not: ACTIVE_MEMBERSHIP } } } } }
      : { ...where, orgId };

  if (directIds.length) {
    const users = await onceInBulkTransaction(tx, `users|${orgId}|${idsKey(directIds)}`, () =>
      tx.user.findMany({
        where: inThisWorkspace({ id: { in: directIds }, status: "active" }),
        select,
      }),
    );
    addUsersToMap(recipients, users, actorId);
  }

  // Assignment refs are user ids only (OCTA-DATA-REFS-004): free-text names
  // are never matched, so a typo can no longer notify the wrong person.
  const refIds = refs.filter((ref) => isUuidLike(ref) && !directIds.includes(ref));
  if (refIds.length) {
    const users = await onceInBulkTransaction(tx, `users|${orgId}|${idsKey(refIds)}`, () =>
      tx.user.findMany({
        where: inThisWorkspace({ status: "active", id: { in: refIds } }),
        select,
      }),
    );
    addUsersToMap(recipients, users, actorId);
  }

  if (roleSet.size) {
    const roles = [...roleSet];
    const orgRoleUsers = await onceInBulkTransaction(tx, `roles|${orgId}|${idsKey(roles)}`, () =>
      tx.user.findMany({
        where: homeInGoodStanding({ status: "active", role: { in: roles } }),
        select,
      }),
    );
    addUsersToMap(recipients, orgRoleUsers, actorId);

    if (projectId) {
      const projectRoleUsers = await onceInBulkTransaction(tx, `project-members|${orgId}|${projectId}`, () =>
        tx.user.findMany({
          where: homeInGoodStanding({
            status: "active",
            projectAssignments: { some: { projectId } },
          }),
          select: {
            ...select,
            projectAssignments: {
              where: { projectId },
              select: { role: true },
            },
          },
        }),
      );
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

/**
 * The workspace segment a notification link is stored under (workspace
 * switching doc §5). Callers build links from the project alone, so the
 * workspace is added here, once, before the row is written: every actionUrl,
 * and the email that quotes it, then opens under `/o/{slug}/…`. The segment
 * is remembered for a minute so a burst of notifications for one workspace
 * does not read its organisation row once per recipient; a client that does
 * not know the organisation model (a test double) leaves the link as built.
 */
const WORKSPACE_SEGMENT_TTL_MS = 60_000;
const workspaceSegmentCache = new Map();

const workspaceSegmentFor = async (tx, orgId) => {
  if (!orgId) return null;
  const cached = workspaceSegmentCache.get(orgId);
  if (cached && cached.until > Date.now()) return cached.segment;
  const client = typeof tx?.organisation?.findUnique === "function" ? tx : prisma;
  if (typeof client?.organisation?.findUnique !== "function") return null;
  let segment = null;
  try {
    const org = await client.organisation.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true },
    });
    segment = org && org.id === orgId ? workspaceSegment(org) : null;
  } catch {
    segment = null;
  }
  workspaceSegmentCache.set(orgId, { segment, until: Date.now() + WORKSPACE_SEGMENT_TTL_MS });
  return segment;
};

const workspaceActionUrl = async (tx, orgId, actionUrl) =>
  actionUrl ? workspacePath(actionUrl, await workspaceSegmentFor(tx, orgId)) : actionUrl;

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
  // Optional: (recipient) => ({ title, message }) for the one recipient, when
  // the words depend on what that person may read. `title` and `message`
  // stay the words everyone may read (the realtime badge event carries them).
  personalize = null,
  // Who may read the BOQ, decided once per (person, project) for this
  // fan-out (boqReaderFor); a caller that asks it too passes its own.
  boqReader = boqReaderFor(tx),
}) => {
  if (!ensureNotificationModels(tx) || !event || !title || !message) {
    return { created: 0, recipients: [] };
  }

  // A notice about one of the bill's own records (an allocation, a BOQ
  // revision, a BOQ item) reaches only a person who may read the BOQ on its
  // project: even its kind and its activity tell a member without BOQ read
  // that a mapping exists and how many there are, and a BOQ item's names its
  // code and description (owner, 2026-09-28; F1).
  const recipients = await recipientsWhoMayRead({
    orgId,
    projectId,
    entityType,
    boqReader,
    recipients: await resolveNotificationRecipients({
      tx,
      orgId,
      projectId,
      actorId,
      recipientUserIds,
      recipientRoles,
      assignmentRefs,
    }),
  });
  if (!recipients.length) return { created: 0, recipients: [] };

  const preferenceByUser = await preferenceMapForUsers({
    tx,
    orgId,
    userIds: recipients.map((recipient) => recipient.id),
    category,
  });

  // Stored once with its workspace, so the in-app link, the email and a push
  // all open under `/o/{slug}/…` (workspace switching doc §5).
  const storedActionUrl = await workspaceActionUrl(tx, orgId, actionUrl);
  // A recipient who works on this project as an external party (a consultant)
  // has the e-mail link on the external collaboration portal; everyone else on
  // the application (domain architecture, sections 28-29). Recorded on the row,
  // so the delivery later needs no second look.
  const onPortal = storedActionUrl
    ? await linkAudience.portalRecipients({ tx, projectId, userIds: recipients.map((recipient) => recipient.id) })
    : new Set();

  // Web Push (OCTA-MOB-PWA-018): only users with a registered device get a
  // push attempt; the preference can switch it off per category.
  const pushCandidates = recipients
    .map((recipient) => recipient.id)
    .filter((id) => (preferenceByUser.get(id) || defaultPreferenceFor(category)).pushEnabled !== false);
  const pushDevices = new Set();
  if (pushCandidates.length && tx.pushSubscription?.findMany) {
    const rows = await onceInBulkTransaction(tx, `push|${idsKey(pushCandidates)}`, () =>
      tx.pushSubscription.findMany({
        where: { userId: { in: pushCandidates } },
        select: { userId: true },
      }),
    );
    for (const row of rows) pushDevices.add(row.userId);
  }

  const created = [];
  for (const recipient of recipients) {
    const preference =
      preferenceByUser.get(recipient.id) || defaultPreferenceFor(category);
    if (!preference.inAppEnabled && !preference.emailEnabled) continue;

    try {
      const own = personalize ? await personalize(recipient) : null;
      const notification = await tx.notification.create({
        data: {
          orgId,
          projectId,
          recipientUserId: recipient.id,
          actorId: actorId || null,
          type,
          category,
          event,
          title: own?.title || title,
          message: own?.message || message,
          priority,
          inAppVisible: preference.inAppEnabled,
          dueAt: dueAt ? new Date(dueAt) : null,
          actionUrl: storedActionUrl,
          entityType,
          entityId,
          dedupeKey: dedupeKeyBase ? `${dedupeKeyBase}:${recipient.id}` : null,
          metadataJson: compactJson(onPortal.has(recipient.id) ? { ...metadata, surface: domains.SURFACES.PORTAL } : metadata),
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

      if (pushDevices.has(recipient.id) && tx.notificationDeliveryAttempt?.create) {
        await tx.notificationDeliveryAttempt.create({
          data: {
            notificationId: notification.id,
            orgId,
            userId: recipient.id,
            channel: "push",
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

  if (pushDevices.size) {
    // Sent after the surrounding transaction has had time to commit.
    require("./push.service").scheduleFlush();
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
      payload: { count: created.length, category, title: withoutIdentifiers(title), event },
    });
  }

  return {
    created: created.length,
    recipients: recipients.map((recipient) => recipient.id),
  };
};

// ─── What a notification calls a record ─────────────────────────────────────
//
// A notification names its record in words a person reads: a ref, a title,
// an activity code. A database identifier is never the fallback — not in the
// title, not in the message, on the web or in the field app (they read the
// same row). A record with nothing readable is named by its kind alone:
// "BOQ allocation needs approval". The link (actionUrl) still carries the id;
// that is where it belongs.

// A UUID-shaped token anywhere in a text, and the placeholder the subject
// once fell back to. Either in a stored row means the row was written before
// this rule and is re-rendered when it is read (the row itself is not
// rewritten).
const IDENTIFIER_TOKEN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const IDENTIFIER_TOKENS = new RegExp(IDENTIFIER_TOKEN.source, "gi");
const LEGACY_PLACEHOLDER = "Workflow record";

/** A string worth showing: non-empty once trimmed, and not an identifier. */
const readable = (value) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text && !IDENTIFIER_TOKEN.test(text) ? text : null;
};

const firstReadable = (...values) => {
  for (const value of values) {
    const text = readable(value);
    if (text) return text;
  }
  return null;
};

const activityCodePhrase = (activity) => {
  const code = readable(activity?.activityCode);
  return code ? `Activity ${code}` : null;
};

/**
 * Record types with no human field of their own, and task (whose `label`
 * column is a kind, "action", not a name): what to read the words from,
 * and the words. `display` follows the label in a title ("BOQ allocation
 * for Activity A120 needs approval"); `subject` names the record in the
 * message. `include` is what loading the record adds for them.
 *
 * `access.boq` is whether the reader may read the BOQ on the record's
 * project (utils/boq-figures: the bill's own records — its rows, revisions
 * and allocations — are the bill's). A BOQ row's description is not a
 * figure, but it is the bill's content, so it names an allocation only for
 * a reader of the BOQ; anyone else reads the activity code, or the kind.
 */
const RECORD_WORDS = Object.freeze({
  activity_boq_allocation: {
    include: {
      activity: { select: { activityCode: true } },
      boqItem: { select: { description: true } },
    },
    words: (record, access) => {
      const subject =
        activityCodePhrase(record?.activity) ||
        (access.boq ? readable(record?.boqItem?.description) : null);
      return { display: subject ? `for ${subject}` : null, subject };
    },
  },
  activity_cost_loading: {
    include: { activity: { select: { activityCode: true, name: true } } },
    words: (record) => {
      const subject = activityCodePhrase(record?.activity) || readable(record?.activity?.name);
      return { display: subject ? `for ${subject}` : null, subject };
    },
  },
  boq_revision: {
    words: (record) => {
      const label = readable(record?.label);
      const number = Number.isInteger(record?.revisionNumber) ? record.revisionNumber : null;
      return {
        display: label || (number !== null ? String(number) : null),
        subject: label || (number !== null ? `Revision ${number}` : null),
      };
    },
  },
  schedule_revision: {
    words: (record) => {
      const label = readable(record?.label);
      return { display: label, subject: label };
    },
  },
  task: {
    words: (record) => {
      const title = readable(record?.title);
      return { display: title, subject: title };
    },
  },
});

/** Every other record type names itself: ref, period, title, subject… — never its id. */
const genericWords = (record = {}) => ({
  display: firstReadable(
    record.ref,
    record.period,
    record.label,
    record.title,
    record.subject,
    record.description,
    record.eventName,
  ),
  subject: firstReadable(
    record.subject,
    record.title,
    record.description,
    record.eventName,
    record.period,
    record.ref,
  ),
});

const NO_BOQ = Object.freeze({ boq: false });
const WITH_BOQ = Object.freeze({ boq: true });

/** The words a notification uses for a record, as this reader may receive them. */
const recordWords = (recordType, record, access = NO_BOQ) => {
  const source = record || {};
  const words = RECORD_WORDS[recordType]?.words;
  return words ? words(source, access) : genericWords(source);
};

const sameWords = (a, b) => a.display === b.display && a.subject === b.subject;

const recordDisplay = (recordType, record, access) => recordWords(recordType, record, access).display;

const recordSubject = (recordType, record, access) => recordWords(recordType, record, access).subject;

/** Takes any identifier (and the old placeholder) out of a text, and tidies what is left. */
const withoutIdentifiers = (text) => {
  if (typeof text !== "string") return text;
  if (!IDENTIFIER_TOKEN.test(text) && !text.includes(LEGACY_PLACEHOLDER)) return text;
  return text
    .replace(IDENTIFIER_TOKENS, "")
    .split(LEGACY_PLACEHOLDER)
    .join("")
    .replace(/:\s*\./g, ".")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?)])/g, "$1")
    .replace(/\( *\)/g, "")
    .trim();
};

/**
 * Whether this person may read the BOQ on this project, decided the way the
 * project's own routes decide it (template, role and party; utils/boq-figures).
 * `viewer` is the signed-in person when it is them; otherwise their
 * principal in the workspace is resolved. Anything unknown is a no.
 */
const mayReadBoq = async ({ orgId, userId, projectId, viewer = null }) => {
  if (!orgId || !userId || !projectId) return false;
  try {
    const { resolveRequestPrincipal } = require("./membership.service");
    const { requestForProject } = require("../middleware/project-access");
    const { canReadBoq } = require("../utils/boq-figures");
    const user =
      viewer && viewer.id === userId && viewer.orgId === orgId
        ? viewer
        : await resolveRequestPrincipal({ tx: prisma, userId, orgId });
    if (!user) return false;
    return canReadBoq(await requestForProject({ user }, projectId));
  } catch {
    return false;
  }
};

// ─── The bill's own records reach only a reader of the BOQ ──────────────────
//
// A notification about a BOQ revision, an allocation or a BOQ item (the
// bill's own records, utils/boq-figures) is written only for a person who
// may read the BOQ on its project (createNotifications) — a workflow step, a
// comment or an @mention alike: a BOQ item's notice names its code and
// description, which the BOQ page refuses the same person (owner F1,
// 2026-09-28). A row stored before that rule, for someone who may not, is
// left out of what they read — the list, one notification, the summary and
// its unread count, mark-all-read, an email or a push — and is never
// rewritten. Every record type a comment files under the "boq" module is one
// of these (comment.service test).

const BOQ_RECORD_TYPES = Object.freeze(["boq_revision", "activity_boq_allocation", "boq_item"]);

const isBoqRecord = (entityType) => BOQ_RECORD_TYPES.includes(entityType);

/** Whether this person may receive a notification about this record. */
const mayReceive = async ({ orgId, userId, projectId, entityType, viewer = null }) =>
  !isBoqRecord(entityType) || mayReadBoq({ orgId, userId, projectId, viewer });

/*
 * Who may read the BOQ, decided once per (person, project) per fan-out — the
 * recipients and their words ask the same answer — and once for the whole
 * transaction inside a bulk step's (inBulkTransaction). Each answer resolves
 * the person's principal and project access (a few queries); d52deae asked
 * it for every recipient of every transition, twice, and a bulk undo ran out
 * of its transaction's time (closure review, 2026-09-28).
 */
const boqReaderFor = (tx) => {
  const answers = new Map();
  return ({ orgId, userId, projectId }) => {
    const key = `${orgId}|${userId}|${projectId}`;
    if (!answers.has(key)) {
      answers.set(key, onceInBulkTransaction(tx, `boq-read|${key}`, () => mayReadBoq({ orgId, userId, projectId })));
    }
    return answers.get(key);
  };
};

/** The recipients who may receive a notification about this record, in order. */
const recipientsWhoMayRead = async ({ orgId, projectId, entityType, recipients, boqReader = boqReaderFor(null) }) => {
  if (!isBoqRecord(entityType)) return recipients;
  const kept = [];
  // One at a time: the caller may hold a transaction's connection.
  for (const recipient of recipients) {
    if (await boqReader({ orgId, userId: recipient.id, projectId })) kept.push(recipient);
  }
  return kept;
};

/**
 * The filter that keeps a reader's stored BOQ-record notifications out of
 * what they read, on each project whose BOQ they may not read (and wherever
 * such a row has no project) — or null when there is nothing to keep out.
 * Decided per project as the project's own routes decide it (mayReadBoq).
 */
const readableRowsFilter = async ({ orgId, userId, viewer = null }) => {
  if (!orgId || !userId || typeof prisma.notification?.findMany !== "function") return null;
  const projects = await prisma.notification.findMany({
    where: { orgId, recipientUserId: userId, entityType: { in: [...BOQ_RECORD_TYPES] } },
    distinct: ["projectId"],
    select: { projectId: true },
  });
  const denied = [];
  let unscoped = false;
  for (const { projectId } of projects || []) {
    if (!projectId) unscoped = true;
    else if (!(await mayReadBoq({ orgId, userId, projectId, viewer }))) denied.push(projectId);
  }
  if (!denied.length && !unscoped) return null;
  // Kept: any row that is not a BOQ record's (entityType null counts, as SQL
  // would otherwise drop it), or one on a project whose BOQ they may read.
  return {
    OR: [
      { entityType: null },
      { entityType: { notIn: [...BOQ_RECORD_TYPES] } },
      denied.length ? { projectId: { notIn: denied } } : { projectId: { not: null } },
    ],
  };
};

/** A notification `where` for one reader, with their unreadable BOQ-record rows left out. */
const readerWhere = async ({ orgId, userId, viewer = null }, where) => {
  const filter = await readableRowsFilter({ orgId, userId, viewer });
  return filter ? { ...where, AND: [...(where.AND || []), filter] } : where;
};

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
  const base = display ? `${label} ${display}` : label;
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

/**
 * The message's first sentence, naming the record: "BOQ allocation:
 * Activity A120." — or, with nothing readable to name it by, the title
 * itself ("BOQ allocation needs approval.").
 */
const subjectSentence = ({ label, subject, title }) =>
  subject ? `${label}: ${subject}.` : `${title}.`;

const workflowMessage = ({ subject, title, event, label }) => {
  const comment = trim(event.comment || event.reason);
  const statusText =
    event.toStatus && event.fromStatus !== event.toStatus
      ? ` Status moved to ${event.toStatus}.`
      : "";
  const commentText = comment ? ` ${comment}` : "";
  return `${subjectSentence({ label, subject, title })}${statusText}${commentText}`.trim();
};

const loadWorkflowRecord = async ({ tx, projectId, recordType, recordId }) => {
  const config = WORKFLOW_RECORDS[recordType] || DUE_RECORDS[recordType];
  const model = config?.model ? tx?.[config.model] : null;
  if (!config || !model?.findFirst) return { config, record: null };

  const include = RECORD_WORDS[recordType]?.include;
  const record = await model.findFirst({
    where: { id: recordId, projectId },
    ...(include ? { include } : {}),
  });
  return { config, record };
};

/** A workflow notification's title and message, from the words a reader may receive. */
const workflowTexts = ({ config, words, workflowEvent }) => {
  const title = workflowTitle({
    label: config.label,
    display: words.display,
    action: workflowEvent.action,
  });
  return {
    title,
    message: workflowMessage({
      subject: words.subject,
      title,
      event: workflowEvent,
      label: config.label,
    }),
  };
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
  // Everyone receives the words anyone may read; where a BOQ row's
  // description is the only readable name, a reader of the BOQ receives it
  // and everyone else the kind alone (RECORD_WORDS).
  const source = record || workflowEvent.metadata || {};
  const plainWords = recordWords(workflowEvent.recordType, source, NO_BOQ);
  const boqWords = recordWords(workflowEvent.recordType, source, WITH_BOQ);
  const plain = workflowTexts({ config, words: plainWords, workflowEvent });
  const withBoq = sameWords(plainWords, boqWords)
    ? null
    : workflowTexts({ config, words: boqWords, workflowEvent });
  // One answer per recipient for the filter and the words alike.
  const boqReader = boqReaderFor(tx);

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
    title: plain.title,
    message: plain.message,
    boqReader,
    personalize: withBoq
      ? async (recipient) =>
          (await boqReader({
            orgId: workflowEvent.orgId,
            userId: recipient.id,
            projectId: workflowEvent.projectId,
          }))
            ? withBoq
            : plain
      : null,
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

const listNotifications = async ({ orgId, userId, query = {}, viewer = null }) => {
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
    where: await readerWhere({ orgId, userId, viewer }, where),
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
    rows: (await readableNotifications(page.rows, { viewer })).map(serializeNotification),
    pagination: page.pagination,
  };
};

const getNotificationForUser = async ({ orgId, userId, notificationId, viewer = null }) => {
  // A BOQ record's notice they may not read is not theirs to open, mark or
  // archive: it answers as if it did not exist.
  const notification = await prisma.notification.findFirst({
    where: await readerWhere(
      { orgId, userId, viewer },
      {
        id: notificationId,
        orgId,
        recipientUserId: userId,
      },
    ),
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

const getNotificationSummary = async ({ orgId, userId, viewer = null }) => {
  // The counts and the recent rows leave out what the reader may not read.
  const filter = await readableRowsFilter({ orgId, userId, viewer });
  const mine = (where) => ({
    orgId,
    recipientUserId: userId,
    inAppVisible: true,
    ...where,
    ...(filter ? { AND: [filter] } : {}),
  });
  const [unread, read, archived, recent] = await Promise.all([
    prisma.notification.count({
      where: mine({ readAt: null, archivedAt: null }),
    }),
    prisma.notification.count({
      where: mine({ readAt: { not: null }, archivedAt: null }),
    }),
    prisma.notification.count({
      where: mine({ archivedAt: { not: null } }),
    }),
    prisma.notification.findMany({
      where: mine({ archivedAt: null }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
    }),
  ]);

  return {
    unread,
    read,
    archived,
    recent: (await readableNotifications(recent, { viewer })).map(serializeNotification),
  };
};

const markNotificationRead = async ({
  orgId,
  userId,
  notificationId,
  read = true,
  viewer = null,
}) => {
  await getNotificationForUser({ orgId, userId, notificationId, viewer });
  const notification = await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: read ? new Date() : null },
    include: {
      deliveryAttempts: { orderBy: [{ createdAt: "desc" }], take: 3 },
    },
  });
  return serializeNotification(await readableNotification(notification, { viewer }));
};

const archiveNotification = async ({ orgId, userId, notificationId, viewer = null }) => {
  await getNotificationForUser({ orgId, userId, notificationId, viewer });
  const notification = await prisma.notification.update({
    where: { id: notificationId },
    data: { archivedAt: new Date() },
    include: {
      deliveryAttempts: { orderBy: [{ createdAt: "desc" }], take: 3 },
    },
  });
  return serializeNotification(await readableNotification(notification, { viewer }));
};

const markAllRead = async ({ orgId, userId, viewer = null }) => {
  if (!orgId || !userId) return { updated: 0 };
  // Only what they read: a hidden row keeps its readAt.
  const result = await prisma.notification.updateMany({
    where: await readerWhere(
      { orgId, userId, viewer },
      {
        orgId,
        recipientUserId: userId,
        inAppVisible: true,
        readAt: null,
        archivedAt: null,
      },
    ),
    data: { readAt: new Date() },
  });
  return { updated: result.count };
};

/** The e-mail link: the stored path on the recipient's surface (portal or app). */
const deliveryLink = (notification) => {
  const surface = notification.metadataJson?.surface === domains.SURFACES.PORTAL ? domains.SURFACES.PORTAL : domains.SURFACES.APP;
  try {
    return domains.buildUrl(surface, notification.actionUrl);
  } catch {
    // A stored link that is not an application path is not repeated in mail.
    return domains.surfaceUrl(surface);
  }
};

const deliveryBody = (notification) =>
  [
    notification.message,
    "",
    notification.actionUrl ? `Open in OctaPM: ${deliveryLink(notification)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

const nextRetryAt = (attemptNumber, now) =>
  new Date(
    now.getTime() + Math.min(60, 5 * 2 ** (attemptNumber - 1)) * 60 * 1000,
  );

// How long a claimed delivery stays out of other processes' reach: far longer
// than one send normally takes.
const DELIVERY_LEASE_MS = 5 * 60 * 1000;

/**
 * Claims one pending delivery attempt for this process. The row must still be
 * pending and unchanged since it was read (updatedAt moves on every write), so
 * of two processes racing for it exactly one sees count 1. No new status is
 * introduced: the row stays `pending` with nextAttemptAt pushed past the lease,
 * which every reader already treats as "not due yet".
 *
 * The lease runs from the clock at the moment of the claim, not from the
 * batch's `now`: a batch of a hundred sends can outlast five minutes, and a
 * lease measured from its start would already have ended for the later rows,
 * letting a fresh reader (the retry route, another task) send them again.
 */
const claimDeliveryAttempt = async (attempt, now = new Date()) => {
  const claimed = await prisma.notificationDeliveryAttempt.updateMany({
    where: { id: attempt.id, status: "pending", updatedAt: attempt.updatedAt },
    data: { nextAttemptAt: new Date(Math.max(now.getTime(), Date.now()) + DELIVERY_LEASE_MS) },
  });
  return claimed.count === 1;
};

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
    // Several processes can read the same pending row (every API task, the
    // worker's scheduler, the manual retry route). Only the one whose
    // conditional update lands may send it; the others see count 0 and move
    // on. The claim pushes nextAttemptAt out by the lease, so if this process
    // dies before recording the outcome the row is picked up again later.
    if (!(await claimDeliveryAttempt(attempt, now))) continue;
    result.processed += 1;
    // The email says what the in-app row says, re-rendered if it was stored
    // before the no-identifier rule.
    const notification = attempt.notification ? await readableNotification(attempt.notification) : null;
    const to = notification?.recipient?.email;

    // A BOQ record's notice stored before the reader rule, for someone who
    // may not read that BOQ, is not sent (the row itself is left as it is).
    if (notification && !(await mayReceive({
      orgId: notification.orgId,
      userId: notification.recipientUserId,
      projectId: notification.projectId,
      entityType: notification.entityType,
    }))) {
      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          nextAttemptAt: attempt.nextAttemptAt ?? null,
          status: "skipped",
          errorCode: "RECIPIENT_MAY_NOT_READ_RECORD",
          errorMessage: "The recipient may not read the record this notification is about",
          metadataJson: { skippedAt: now.toISOString() },
        },
      });
      result.skipped += 1;
      continue;
    }

    if (!notification || !to) {
      await prisma.notificationDeliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          nextAttemptAt: attempt.nextAttemptAt ?? null,
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
      // Replies to record / conversation emails come back into OctaPM (OCTA-COMM-CONV-042).
      const replyTo = replyAddressFor(notification);
      const providerResult = await sendEmail({
        to,
        subject: notification.title,
        body: replyTo
          ? `${deliveryBody(notification)}\n\nReply to this email to answer in OctaPM.`
          : deliveryBody(notification),
        replyTo,
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
          nextAttemptAt: attempt.nextAttemptAt ?? null,
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

const dueTitle = ({ label, display, event }) =>
  `${display ? `${label} ${display}` : label} ${event === "overdue" ? "is overdue" : "is due soon"}`;

const dueRecordTitle = ({ config, recordType, record, event }) =>
  dueTitle({ label: config.label, display: recordDisplay(recordType, record), event });

const dueRecordMessage = ({ config, recordType, record, dueAt, event }) => {
  const dueText = new Date(dueAt).toISOString().slice(0, 10);
  const prefix = event === "overdue" ? "Overdue since" : "Due on";
  const title = dueRecordTitle({ config, recordType, record, event });
  return `${subjectSentence({ label: config.label, subject: recordSubject(recordType, record), title })} ${prefix} ${dueText}.`;
};

// ─── Stored rows written before the rule ────────────────────────────────────
//
// Rows are never rewritten. A row whose title or message carries an
// identifier (or the old "Workflow record" placeholder) is re-rendered each
// time it is read — the list, one notification, the summary, a read or
// archive answer, an email, a push — through the builders above, from the
// record it names as it is now and as the reader may receive it. Only the
// title and message change; the link, the entity and the metadata are the
// row's own.

const carriesIdentifier = (text) =>
  typeof text === "string" && (IDENTIFIER_TOKEN.test(text) || text.includes(LEGACY_PLACEHOLDER));

const needsReadableText = (notification) =>
  Boolean(notification) && (carriesIdentifier(notification.title) || carriesIdentifier(notification.message));

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A stored message with its record's words put back: the builders' first
 * sentence ("<label>: <subject>.") replaces the old one ("<label>: Workflow
 * record." or "<label>: <id>."), and the rest — the status it moved to, the
 * reviewer's comment, the due date — is kept as written. The subject goes
 * only where the builders put the record: an id anywhere else is someone's
 * own words about another record ("Duplicate of allocation <id>"), never
 * this one, so it is not replaced by this record's name — the caller
 * strips it (withoutIdentifiers), leaving "Duplicate of allocation".
 */
const rewrittenMessage = ({ message, label, subject, title }) => {
  if (typeof message !== "string") return message;
  const oldFirst = new RegExp(
    `^${escapeRegExp(label)}: (?:${escapeRegExp(LEGACY_PLACEHOLDER)}|${IDENTIFIER_TOKEN.source})\\.`,
    "i",
  );
  if (oldFirst.test(message)) {
    return message.replace(oldFirst, subjectSentence({ label, subject, title }));
  }
  return subject ? message.split(LEGACY_PLACEHOLDER).join(subject) : message;
};

/** The records a batch of stored rows names, a record type at a time, from their own projects. */
const recordsForRows = async (rows) => {
  const byType = new Map();
  for (const row of rows) {
    if (!row.entityType || !row.entityId || !row.projectId || !DUE_RECORDS[row.entityType]) continue;
    if (!IDENTIFIER_TOKEN.test(row.entityId)) continue;
    const entry = byType.get(row.entityType) || { ids: new Set(), projectIds: new Set() };
    entry.ids.add(row.entityId);
    entry.projectIds.add(row.projectId);
    byType.set(row.entityType, entry);
  }
  const records = new Map();
  for (const [recordType, { ids, projectIds }] of byType) {
    const model = prisma[DUE_RECORDS[recordType].model];
    if (!model?.findMany) continue;
    const include = RECORD_WORDS[recordType]?.include;
    try {
      const found = await model.findMany({
        where: { id: { in: [...ids] }, projectId: { in: [...projectIds] } },
        ...(include ? { include } : {}),
      });
      for (const record of found || []) records.set(`${recordType}:${record.projectId}:${record.id}`, record);
    } catch {
      // A record that cannot be read is named by its kind alone.
    }
  }
  return records;
};

const readableTextFor = async ({ row, record, boqAccess }) => {
  const config = DUE_RECORDS[row.entityType];
  const kind = String(row.event || "").startsWith("workflow.")
    ? "workflow"
    : String(row.event || "").startsWith("due_date.")
      ? "due"
      : null;
  if (!config || !kind) {
    return { title: withoutIdentifiers(row.title), message: withoutIdentifiers(row.message) };
  }
  const plainWords = recordWords(row.entityType, record, NO_BOQ);
  const boqWords = recordWords(row.entityType, record, WITH_BOQ);
  const words = sameWords(plainWords, boqWords) || !(await boqAccess(row)) ? plainWords : boqWords;
  const title =
    kind === "workflow"
      ? workflowTitle({
          label: config.label,
          display: words.display,
          action: trim(row.metadataJson?.action) || String(row.event).slice("workflow.".length),
        })
      : dueTitle({ label: config.label, display: words.display, event: row.category });
  return {
    title: withoutIdentifiers(title),
    message: withoutIdentifiers(
      rewrittenMessage({ message: row.message, label: config.label, subject: words.subject, title }),
    ),
  };
};

/**
 * Stored rows as their reader receives them: rows that carry an identifier
 * re-rendered, every other row as it is (the same object). `viewer` is the
 * signed-in person reading their own notifications, when there is one.
 */
const readableNotifications = async (rows, { viewer = null } = {}) => {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.some(needsReadableText)) return list;
  const records = await recordsForRows(list.filter(needsReadableText));
  const boqByReader = new Map();
  const boqAccess = (row) => {
    const key = `${row.orgId}:${row.recipientUserId}:${row.projectId}`;
    if (!boqByReader.has(key)) {
      boqByReader.set(
        key,
        mayReadBoq({ orgId: row.orgId, userId: row.recipientUserId, projectId: row.projectId, viewer }),
      );
    }
    return boqByReader.get(key);
  };
  return Promise.all(
    list.map(async (row) => {
      if (!needsReadableText(row)) return row;
      const record = records.get(`${row.entityType}:${row.projectId}:${row.entityId}`) || null;
      return { ...row, ...(await readableTextFor({ row, record, boqAccess })) };
    }),
  );
};

const readableNotification = async (row, options) => (await readableNotifications([row], options))[0];

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
          title: dueRecordTitle({ config, recordType, record, event: category }),
          message: dueRecordMessage({ config, recordType, record, dueAt, event: category }),
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
  // A project named that is not one of this company's (another company's
  // included) is refused as an id that exists nowhere is, rather than
  // answered "0 projects" (CERT-2 injection sweep: nothing was scanned or
  // created, but the reference was taken rather than refused).
  if (projectId && !projects.length) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");

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
  BOQ_RECORD_TYPES,
  boqReaderFor,
  createDueNotificationsForProject,
  createNotifications,
  createWorkflowNotifications,
  emitTaskNotification,
  getNotificationForUser: async (params) =>
    serializeNotification(
      await readableNotification(await getNotificationForUser(params), { viewer: params.viewer }),
    ),
  getNotificationSummary,
  getUserPreferences,
  isBoqRecord,
  listNotifications,
  markAllRead,
  markNotificationRead,
  mayReceive,
  inBulkTransaction,
  processPendingEmailDeliveries,
  deliveryBody,
  readableNotification,
  readableNotifications,
  retryNotificationEmail,
  runDueNotificationScan,
  updateUserPreferences,
};
