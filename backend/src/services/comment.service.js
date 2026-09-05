const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const domainEvents = require("../events/bus");
const notificationService = require("./notification.service");
const { assertProjectAccess } = require("./project-authorization.service");
const { RECORD_TYPE_MODULES } = require("./attachment.service");
const { recordWorkspacePath } = require("../utils/record-links");

/**
 * Comments, @mentions and record subscriptions (OCTA-COMM-COMMENT-009).
 *
 * One Comment table serves every record type. Mentions are explicit user ids
 * chosen from the project team (never parsed from free text), so a typo can
 * never notify the wrong person. Anyone who creates, comments on, is
 * mentioned on, or is assigned to a record follows it; an explicit unfollow
 * mutes the row and automatic rules never re-follow it.
 */

const MAX_BODY_LENGTH = 5000;
const MAX_MENTIONS = 20;
const EXCERPT_LENGTH = 160;
const COMMENT_ACTION = "commented";

const SUBSCRIPTION_REASONS = Object.freeze({
  MANUAL: "manual",
  CREATED: "created",
  COMMENTED: "commented",
  MENTIONED: "mentioned",
  ASSIGNED: "assigned",
});

const USER_REF_FIELDS = [
  "ownerUserId",
  "reviewerUserId",
  "approverUserId",
  "assigneeUserId",
  "ballInCourtUserId",
];

// Prisma model, label and title fields per record type. `refs: false` marks
// types whose row has no projectId column or no people to auto-follow.
const RECORD_SOURCES = Object.freeze({
  risk: { model: "risk", label: "Risk", title: ["description"] },
  ncr: { model: "ncrRecord", label: "NCR", title: ["ref", "description"] },
  itp: { model: "itpRecord", label: "ITP", title: ["ref", "title"] },
  defect: { model: "defectRecord", label: "Defect", title: ["ref", "title"] },
  punch_item: {
    model: "punchItem",
    label: "Punch item",
    title: ["ref", "title"],
    extraRefs: ["managerUserId", "finalApproverUserId", "createdBy"],
  },
  material_test: {
    model: "materialTest",
    label: "Material test",
    title: ["ref", "testType"],
  },
  safety_incident: {
    model: "safetyIncident",
    label: "Safety incident",
    title: ["ref", "title"],
  },
  rfi: { model: "rfi", label: "RFI", title: ["ref", "subject"] },
  submittal: { model: "submittal", label: "Submittal", title: ["ref", "title"] },
  drawing: { model: "drawingRecord", label: "Drawing", title: ["ref", "title"] },
  drawing_set: { model: "drawingSet", label: "Drawing set", title: ["setNumber", "name"] },
  sheet: { model: "sheet", label: "Sheet", title: ["number", "title"] },
  sheet_revision: {
    model: "sheetRevision",
    label: "Sheet revision",
    title: ["number", "revision"],
    refs: false,
  },
  transmittal: {
    model: "transmittal",
    label: "Transmittal",
    title: ["ref", "subject"],
  },
  correspondence: {
    model: "correspondence",
    label: "Correspondence",
    title: ["ref", "subject"],
  },
  document: {
    model: "projectDocument",
    label: "Document",
    title: ["documentNumber", "title", "originalName", "fileName"],
  },
  task: {
    model: "task",
    label: "Task",
    title: ["taskNumber", "title"],
    extraRefs: ["assigneeId"],
  },
  daily_report: {
    model: "dailyReport",
    label: "Daily report",
    title: ["date"],
    extraRefs: ["engineerId"],
  },
  site_diary: {
    model: "siteDiary",
    label: "Site diary",
    title: ["date"],
    extraRefs: ["engineerId"],
  },
  progress_submission: {
    model: "progressSubmission",
    label: "Progress submission",
    title: ["id"],
  },
  activity: {
    model: "activity",
    label: "Activity",
    title: ["activityCode", "name"],
  },
  change_order: {
    model: "changeOrder",
    label: "Change order",
    title: ["ref", "description"],
  },
  ipc: { model: "ipcCertificate", label: "IPC", title: ["period"] },
  ipc_certificate: { model: "ipcCertificate", label: "IPC", title: ["period"] },
  sub_valuation: {
    model: "subValuation",
    label: "Sub valuation",
    title: ["ref", "subcontractor"],
  },
  eot: { model: "eotClaim", label: "EOT claim", title: ["ref", "eventName"] },
  weather_delay: {
    model: "weatherDelay",
    label: "Weather delay",
    title: ["description"],
  },
  meeting: {
    model: "meeting",
    label: "Meeting",
    title: ["meetingNumber", "title"],
  },
  meeting_action: {
    model: "meetingActionItem",
    label: "Meeting action",
    title: ["itemNumber", "title"],
  },
  procurement_order: {
    model: "procurementOrder",
    label: "Purchase order",
    title: ["ref", "item"],
  },
  procurement_package: {
    model: "procurementPackage",
    label: "Procurement package",
    title: ["packageNumber", "title"],
  },
  delivery_receipt: {
    model: "deliveryReceipt",
    label: "Delivery",
    title: ["receiptNumber"],
  },
  cost_record: { model: "costRecord", label: "Cost record", title: ["id"] },
  boq_item: { model: "boqItem", label: "BOQ item", title: ["code", "description"] },
  location: { model: "location", label: "Location", title: ["code", "name"] },
  project: { model: "project", label: "Project", title: ["name"], refs: false },
});

const RECORD_TYPES = Object.keys(RECORD_SOURCES).filter(
  (recordType) => RECORD_TYPE_MODULES[recordType],
);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const unique = (values) => [
  ...new Set((Array.isArray(values) ? values : []).map(trimOrNull).filter(Boolean)),
];

const toIso = (value) => value?.toISOString?.() || value || null;

const excerpt = (body) => {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text;
};

const moduleForRecordType = (recordType) => {
  const moduleName = RECORD_TYPE_MODULES[recordType];
  if (!moduleName || !RECORD_SOURCES[recordType]) {
    throw new HttpError(400, "COMMENT_RECORD_TYPE_INVALID", `Unknown record type: ${recordType}`);
  }
  return moduleName;
};

const requireSource = (recordType) => {
  moduleForRecordType(recordType);
  return RECORD_SOURCES[recordType];
};

const normalizeBody = (body) => {
  const text = trimOrNull(body);
  if (!text) throw new HttpError(400, "COMMENT_BODY_REQUIRED", "Comment text is required");
  if (text.length > MAX_BODY_LENGTH) {
    throw new HttpError(
      400,
      "COMMENT_BODY_TOO_LONG",
      `Comments are limited to ${MAX_BODY_LENGTH} characters`,
    );
  }
  return text;
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, name: true },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const recordTitle = (config, record) => {
  const parts = config.title
    .map((field) => {
      const value = record?.[field];
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      return trimOrNull(value);
    })
    .filter(Boolean);
  return parts.length ? parts.slice(0, 2).join(" – ") : null;
};

/**
 * Loads the commented record (404 when it is not on this project) and
 * returns a display label such as "RFI RFI-012 – Rebar spacing".
 */
const loadRecord = async ({ orgId, projectId, recordType, recordId }) => {
  const config = requireSource(recordType);
  const id = trimOrNull(recordId);
  if (!id) throw new HttpError(400, "COMMENT_RECORD_ID_REQUIRED", "recordId is required");

  const model = prisma[config.model];
  let record = null;
  if (recordType === "project") {
    record = id === projectId ? await prisma.project.findFirst({ where: { id, orgId } }) : null;
  } else if (model?.findFirst) {
    record = await model.findFirst({ where: { id, projectId } });
  } else {
    // Model missing from a partial client (tests): trust the caller.
    record = { id };
  }
  if (!record) {
    throw new HttpError(404, "COMMENT_RECORD_NOT_FOUND", `${config.label} not found on this project`);
  }
  const title = recordTitle(config, record);
  return {
    config,
    record,
    label: config.label,
    display: title ? `${config.label} ${title}` : config.label,
  };
};

const serializeMention = (mention) => ({
  userId: mention.userId,
  name: mention.user?.name || null,
  email: mention.user?.email || null,
});

const serializeComment = (row, viewer = null) => {
  const deleted = Boolean(row.deletedAt);
  const isAuthor = Boolean(viewer?.id) && row.authorId === viewer.id;
  return {
    id: row.id,
    projectId: row.projectId,
    recordType: row.recordType,
    recordId: row.recordId,
    parentId: row.parentId || null,
    body: deleted ? "" : row.body,
    author: row.author
      ? { id: row.author.id, name: row.author.name, email: row.author.email || null }
      : null,
    authorId: row.authorId || null,
    mentions: (row.mentions || []).map(serializeMention),
    editedAt: toIso(row.editedAt),
    deletedAt: toIso(row.deletedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    canEdit: !deleted && isAuthor,
    canDelete: !deleted && (isAuthor || Boolean(viewer?.canModerate)),
  };
};

const commentInclude = {
  author: { select: { id: true, name: true, email: true } },
  mentions: { include: { user: { select: { id: true, name: true, email: true } } } },
};

/**
 * Mentioned users must be active members of the organisation with access to
 * the project (assignment, party membership, or org-wide role).
 */
const resolveMentionUsers = async ({ orgId, projectId, userIds }) => {
  const ids = unique(userIds);
  if (ids.length > MAX_MENTIONS) {
    throw new HttpError(400, "COMMENT_MENTIONS_TOO_MANY", `Mention at most ${MAX_MENTIONS} people`);
  }
  if (!ids.length) return [];

  const users = await prisma.user.findMany({
    where: { orgId, id: { in: ids }, status: "active" },
    select: { id: true, name: true, email: true, role: true, isCompanyAdmin: true },
  });
  if (users.length !== ids.length) {
    throw new HttpError(
      400,
      "COMMENT_MENTION_INVALID",
      "One or more mentioned users are not active members of this organisation",
    );
  }

  for (const user of users) {
    try {
      await assertProjectAccess({
        orgId,
        projectId,
        userId: user.id,
        role: user.role,
        isCompanyAdmin: Boolean(user.isCompanyAdmin),
      });
    } catch (error) {
      if (error instanceof HttpError) {
        throw new HttpError(
          400,
          "COMMENT_MENTION_NO_ACCESS",
          `${user.name} does not have access to this project`,
        );
      }
      throw error;
    }
  }
  return users;
};

// ─── Subscriptions ────────────────────────────────────────────────────────

const serializeSubscription = (row) => ({
  id: row.id,
  projectId: row.projectId,
  recordType: row.recordType,
  recordId: row.recordId,
  userId: row.userId,
  user: row.user ? { id: row.user.id, name: row.user.name, email: row.user.email || null } : null,
  reason: row.reason,
  muted: Boolean(row.muted),
  path: recordWorkspacePath({
    projectId: row.projectId,
    recordType: row.recordType,
    recordId: row.recordId,
  }),
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

/**
 * Automatic follow. Existing rows are left untouched so an explicit unfollow
 * (muted) sticks and the original reason is kept.
 */
const subscribeUsers = async ({
  tx = prisma,
  orgId,
  projectId,
  recordType,
  recordId,
  userIds,
  reason = SUBSCRIPTION_REASONS.MANUAL,
}) => {
  if (!tx.recordSubscription?.upsert) return 0;
  let created = 0;
  for (const userId of unique(userIds)) {
    const row = await tx.recordSubscription.upsert({
      where: { recordType_recordId_userId: { recordType, recordId, userId } },
      create: { orgId, projectId, recordType, recordId, userId, reason, muted: false },
      update: {},
    });
    if (row?.reason === reason && !row.muted) created += 1;
  }
  return created;
};

const listSubscribers = async ({ tx = prisma, orgId, projectId, recordType, recordId }) => {
  if (!tx.recordSubscription?.findMany) return [];
  const rows = await tx.recordSubscription.findMany({
    where: { orgId, projectId, recordType, recordId, muted: false },
    include: { user: { select: { id: true, name: true, email: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.filter((row) => !row.user || row.user.status === "active");
};

const getSubscriptionState = async ({ orgId, projectId, recordType, recordId, userId }) => {
  moduleForRecordType(recordType);
  await ensureProject({ orgId, projectId });
  const id = trimOrNull(recordId);
  if (!id) throw new HttpError(400, "COMMENT_RECORD_ID_REQUIRED", "recordId is required");

  const [mine, subscribers] = await Promise.all([
    prisma.recordSubscription.findFirst({
      where: { orgId, projectId, recordType, recordId: id, userId },
    }),
    listSubscribers({ orgId, projectId, recordType, recordId: id }),
  ]);

  return {
    recordType,
    recordId: id,
    following: Boolean(mine) && !mine.muted,
    subscription: mine ? serializeSubscription(mine) : null,
    subscribers: subscribers.map(serializeSubscription),
    count: subscribers.length,
  };
};

const setSubscription = async ({ orgId, projectId, recordType, recordId, userId, follow }) => {
  const { record } = await loadRecord({ orgId, projectId, recordType, recordId });
  const row = await prisma.recordSubscription.upsert({
    where: { recordType_recordId_userId: { recordType, recordId: record.id, userId } },
    create: {
      orgId,
      projectId,
      recordType,
      recordId: record.id,
      userId,
      reason: SUBSCRIPTION_REASONS.MANUAL,
      muted: !follow,
    },
    update: follow
      ? { muted: false, reason: SUBSCRIPTION_REASONS.MANUAL }
      : { muted: true },
  });
  return getSubscriptionState({ orgId, projectId, recordType, recordId: record.id, userId });
};

const listMySubscriptions = async ({ orgId, projectId, userId, limit = 100 }) => {
  await ensureProject({ orgId, projectId });
  const rows = await prisma.recordSubscription.findMany({
    where: { orgId, projectId, userId, muted: false },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 100, 1), 500),
  });
  return {
    items: rows.map((row) => ({
      ...serializeSubscription(row),
      label: RECORD_SOURCES[row.recordType]?.label || row.recordType,
    })),
  };
};

// ─── Comments ─────────────────────────────────────────────────────────────

const publishCommentEvent = async ({
  tx,
  orgId,
  projectId,
  recordType,
  recordId,
  actorId,
  action,
  comment,
}) => {
  try {
    const event = domainEvents.buildRecordEvent({
      orgId,
      projectId,
      entityType: recordType,
      entityId: recordId,
      action,
      actorId,
      summary: { commentId: comment.id, excerpt: excerpt(comment.body) },
    });
    await domainEvents.recordOutboundEvent({ tx, event });
    domainEvents.publish(event);
  } catch (error) {
    console.error("[comment-domain-event]", error);
  }
};

const notifyForComment = async ({
  orgId,
  projectId,
  recordType,
  recordId,
  display,
  comment,
  author,
  mentionIds,
  isEdit = false,
}) => {
  const actionUrl = recordWorkspacePath({ projectId, recordType, recordId });
  const authorName = author?.name || "Someone";
  const text = excerpt(comment.body);

  if (mentionIds.length) {
    await notificationService.createNotifications({
      orgId,
      projectId,
      actorId: author?.id || null,
      recipientUserIds: mentionIds,
      type: "comment",
      category: notificationService.NOTIFICATION_CATEGORIES.MENTION,
      event: "comment.mentioned",
      title: `${authorName} mentioned you on ${display}`,
      message: text,
      priority: "normal",
      actionUrl,
      entityType: recordType,
      entityId: recordId,
      dedupeKeyBase: `comment:${comment.id}:mention`,
      metadata: { commentId: comment.id, recordType, recordId },
    });
  }

  if (isEdit) return;

  const subscribers = await listSubscribers({ orgId, projectId, recordType, recordId });
  const mentioned = new Set(mentionIds);
  const recipientUserIds = subscribers
    .map((row) => row.userId)
    .filter((userId) => userId !== author?.id && !mentioned.has(userId));
  if (!recipientUserIds.length) return;

  await notificationService.createNotifications({
    orgId,
    projectId,
    actorId: author?.id || null,
    recipientUserIds,
    type: "comment",
    category: notificationService.NOTIFICATION_CATEGORIES.COMMENT,
    event: "comment.created",
    title: `New comment on ${display}`,
    message: `${authorName}: ${text}`,
    priority: "low",
    actionUrl,
    entityType: recordType,
    entityId: recordId,
    dedupeKeyBase: `comment:${comment.id}:follow`,
    metadata: { commentId: comment.id, recordType, recordId },
  });
};

const listComments = async ({
  orgId,
  projectId,
  recordType,
  recordId,
  viewer = null,
  cursor = null,
  limit = 50,
  order = "asc",
  includeDeleted = false,
}) => {
  moduleForRecordType(recordType);
  await ensureProject({ orgId, projectId });
  const id = trimOrNull(recordId);
  if (!id) throw new HttpError(400, "COMMENT_RECORD_ID_REQUIRED", "recordId is required");

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const direction = order === "desc" ? "desc" : "asc";
  const where = { orgId, projectId, recordType, recordId: id };
  if (!includeDeleted) where.deletedAt = null;

  const rows = await prisma.comment.findMany({
    where,
    include: commentInclude,
    orderBy: [{ createdAt: direction }, { id: direction }],
    take: safeLimit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > safeLimit;
  const page = rows.slice(0, safeLimit);
  return {
    items: page.map((row) => serializeComment(row, viewer)),
    pagination: {
      limit: safeLimit,
      nextCursor: hasMore ? page[page.length - 1]?.id || null : null,
    },
  };
};

const getComment = async ({ orgId, projectId, commentId, viewer = null }) => {
  const row = await prisma.comment.findFirst({
    where: { id: commentId, orgId, projectId },
    include: commentInclude,
  });
  if (!row) throw new HttpError(404, "COMMENT_NOT_FOUND", "Comment not found");
  return serializeComment(row, viewer);
};

const createComment = async ({
  orgId,
  projectId,
  recordType,
  recordId,
  body,
  mentionUserIds = [],
  parentId = null,
  actor,
}) => {
  await ensureProject({ orgId, projectId });
  const { record, display } = await loadRecord({ orgId, projectId, recordType, recordId });
  const text = normalizeBody(body);
  const mentionUsers = await resolveMentionUsers({ orgId, projectId, userIds: mentionUserIds });
  const mentionIds = mentionUsers.map((user) => user.id);

  const parent = parentId
    ? await prisma.comment.findFirst({
        where: { id: parentId, orgId, projectId, recordType, recordId: record.id },
        select: { id: true },
      })
    : null;
  if (parentId && !parent) {
    throw new HttpError(404, "COMMENT_PARENT_NOT_FOUND", "The comment you are replying to no longer exists");
  }

  const created = await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        orgId,
        projectId,
        recordType,
        recordId: record.id,
        parentId: parent?.id || null,
        authorId: actor?.id || null,
        body: text,
        mentions: mentionIds.length
          ? { create: mentionIds.map((userId) => ({ orgId, userId })) }
          : undefined,
      },
      include: commentInclude,
    });

    if (actor?.id) {
      await subscribeUsers({
        tx,
        orgId,
        projectId,
        recordType,
        recordId: record.id,
        userIds: [actor.id],
        reason: SUBSCRIPTION_REASONS.COMMENTED,
      });
    }
    await subscribeUsers({
      tx,
      orgId,
      projectId,
      recordType,
      recordId: record.id,
      userIds: mentionIds,
      reason: SUBSCRIPTION_REASONS.MENTIONED,
    });

    await publishCommentEvent({
      tx,
      orgId,
      projectId,
      recordType,
      recordId: record.id,
      actorId: actor?.id || null,
      action: COMMENT_ACTION,
      comment,
    });
    return comment;
  });

  await notifyForComment({
    orgId,
    projectId,
    recordType,
    recordId: record.id,
    display,
    comment: created,
    author: created.author || (actor ? { id: actor.id, name: actor.name } : null),
    mentionIds,
  });

  return serializeComment(created, actor);
};

const updateComment = async ({ orgId, projectId, commentId, body, mentionUserIds, actor }) => {
  const existing = await prisma.comment.findFirst({
    where: { id: commentId, orgId, projectId },
    include: commentInclude,
  });
  if (!existing) throw new HttpError(404, "COMMENT_NOT_FOUND", "Comment not found");
  if (existing.deletedAt) {
    throw new HttpError(409, "COMMENT_DELETED", "This comment has been removed");
  }
  if (!actor?.id || existing.authorId !== actor.id) {
    throw new HttpError(403, "COMMENT_NOT_AUTHOR", "Only the author can edit a comment");
  }

  const text = body === undefined ? existing.body : normalizeBody(body);
  const previousMentions = existing.mentions.map((mention) => mention.userId);
  const nextMentionIds =
    mentionUserIds === undefined
      ? previousMentions
      : (await resolveMentionUsers({ orgId, projectId, userIds: mentionUserIds })).map(
          (user) => user.id,
        );
  const addedMentions = nextMentionIds.filter((id) => !previousMentions.includes(id));
  const removedMentions = previousMentions.filter((id) => !nextMentionIds.includes(id));

  const mentionWrites = {
    ...(removedMentions.length
      ? { deleteMany: { userId: { in: removedMentions } } }
      : {}),
    ...(addedMentions.length
      ? { create: addedMentions.map((userId) => ({ orgId, userId })) }
      : {}),
  };

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.comment.update({
      where: { id: existing.id },
      data: {
        body: text,
        editedAt: new Date(),
        ...(Object.keys(mentionWrites).length ? { mentions: mentionWrites } : {}),
      },
      include: commentInclude,
    });
    await subscribeUsers({
      tx,
      orgId,
      projectId,
      recordType: existing.recordType,
      recordId: existing.recordId,
      userIds: addedMentions,
      reason: SUBSCRIPTION_REASONS.MENTIONED,
    });
    await publishCommentEvent({
      tx,
      orgId,
      projectId,
      recordType: existing.recordType,
      recordId: existing.recordId,
      actorId: actor.id,
      action: "comment_updated",
      comment: row,
    });
    return row;
  });

  if (addedMentions.length) {
    const { display } = await loadRecord({
      orgId,
      projectId,
      recordType: existing.recordType,
      recordId: existing.recordId,
    });
    await notifyForComment({
      orgId,
      projectId,
      recordType: existing.recordType,
      recordId: existing.recordId,
      display,
      comment: updated,
      author: updated.author || { id: actor.id, name: actor.name },
      mentionIds: addedMentions,
      isEdit: true,
    });
  }

  return serializeComment(updated, actor);
};

const deleteComment = async ({ orgId, projectId, commentId, actor }) => {
  const existing = await prisma.comment.findFirst({
    where: { id: commentId, orgId, projectId },
    select: { id: true, authorId: true, deletedAt: true, recordType: true, recordId: true, body: true },
  });
  if (!existing) throw new HttpError(404, "COMMENT_NOT_FOUND", "Comment not found");
  if (existing.deletedAt) return { deleted: true, id: existing.id };

  const isAuthor = Boolean(actor?.id) && existing.authorId === actor.id;
  if (!isAuthor && !actor?.canModerate) {
    throw new HttpError(
      403,
      "COMMENT_DELETE_FORBIDDEN",
      "Only the author, a project manager or a company admin can remove a comment",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.comment.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), deletedBy: actor?.id || null },
    });
    await publishCommentEvent({
      tx,
      orgId,
      projectId,
      recordType: existing.recordType,
      recordId: existing.recordId,
      actorId: actor?.id || null,
      action: "comment_deleted",
      comment: existing,
    });
  });

  return { deleted: true, id: existing.id };
};

// ─── Automatic subscriptions from record events ───────────────────────────

/**
 * Listens to the domain bus: whoever creates a record follows it, and every
 * user referenced on it (owner, reviewer, approver, assignee, ball in court,
 * task assignee, report engineer) follows it after each change.
 */
const handleRecordEvent = async (event) => {
  if (event?.type !== domainEvents.EVENT_TYPES.RECORD_CHANGED) return 0;
  const config = RECORD_SOURCES[event.entityType];
  if (!config || !event.projectId || !event.entityId || !event.orgId) return 0;
  if (!prisma.recordSubscription?.upsert) return 0;
  if (["comment_updated", "comment_deleted", COMMENT_ACTION].includes(event.action)) return 0;

  const byReason = new Map();
  if (event.actorId && event.action === "created") {
    byReason.set(SUBSCRIPTION_REASONS.CREATED, [event.actorId]);
  }

  if (config.refs !== false) {
    const model = prisma[config.model];
    const record = model?.findFirst
      ? await model.findFirst({ where: { id: event.entityId, projectId: event.projectId } })
      : null;
    const refs = unique(
      [...USER_REF_FIELDS, ...(config.extraRefs || [])].map((field) => record?.[field]),
    ).filter((id) => id !== event.actorId || event.action !== "created");
    if (refs.length) byReason.set(SUBSCRIPTION_REASONS.ASSIGNED, refs);
  }

  let total = 0;
  for (const [reason, userIds] of byReason) {
    total += await subscribeUsers({
      orgId: event.orgId,
      projectId: event.projectId,
      recordType: event.entityType,
      recordId: event.entityId,
      userIds,
      reason,
    });
  }
  return total;
};

let unsubscribeAuto = null;
const registerAutoSubscriptions = () => {
  if (unsubscribeAuto) return unsubscribeAuto;
  unsubscribeAuto = domainEvents.subscribe((event) => {
    handleRecordEvent(event).catch((error) => {
      console.error("[record-subscriptions]", error);
    });
  });
  return unsubscribeAuto;
};

const unregisterAutoSubscriptions = () => {
  if (unsubscribeAuto) unsubscribeAuto();
  unsubscribeAuto = null;
};

module.exports = {
  COMMENT_ACTION,
  MAX_BODY_LENGTH,
  MAX_MENTIONS,
  RECORD_SOURCES,
  RECORD_TYPES,
  SUBSCRIPTION_REASONS,
  createComment,
  deleteComment,
  getComment,
  getSubscriptionState,
  handleRecordEvent,
  listComments,
  listMySubscriptions,
  listSubscribers,
  loadRecord,
  moduleForRecordType,
  registerAutoSubscriptions,
  serializeComment,
  serializeSubscription,
  setSubscription,
  subscribeUsers,
  unregisterAutoSubscriptions,
  updateComment,
};
