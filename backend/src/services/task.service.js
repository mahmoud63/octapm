const { prisma } = require("../config/db");
const { normalizeRoleId } = require("../config/permissions");
const { HttpError } = require("../utils/http-error");
const {
  containsInsensitive,
  cursorArgs,
  normalizeListQuery,
  toCursorPage,
  trimToNull,
} = require("../utils/list-query");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const { nextRef } = require("../utils/reference-number");
const {
  assertProjectAccess,
  canAccessAllProjects,
  getProjectAccessWhere,
} = require("./project-authorization.service");

const TASK_ENTITY_TYPE = "task";
const TASK_STATUSES = Object.freeze([
  "todo",
  "in_progress",
  "blocked",
  "done",
  "canceled",
]);
const TASK_PRIORITIES = Object.freeze(["low", "medium", "high", "critical"]);
const TASK_LABELS = Object.freeze([
  "action",
  "field",
  "procurement",
  "quality",
  "safety",
  "commercial",
  "document",
]);
const CLOSED_TASK_STATUSES = new Set(["done", "canceled"]);
const PROJECT_WIDE_TASK_ROLES = new Set(["pm", "planning_eng"]);

const taskInclude = {
  project: { select: { id: true, name: true } },
  activity: {
    select: {
      id: true,
      name: true,
      activityCode: true,
      p6ActivityId: true,
      wbsCode: true,
    },
  },
  assignee: { select: { id: true, name: true, email: true, role: true } },
  createdBy: { select: { id: true, name: true, email: true, role: true } },
  updatedBy: { select: { id: true, name: true, email: true, role: true } },
  closedBy: { select: { id: true, name: true, email: true, role: true } },
  comments: {
    orderBy: [{ createdAt: "asc" }],
    include: {
      author: { select: { id: true, name: true, email: true, role: true } },
    },
  },
  attachments: {
    orderBy: [{ createdAt: "asc" }],
    include: {
      projectDocument: {
        select: {
          id: true,
          title: true,
          originalName: true,
          fileName: true,
          mimeType: true,
          storageKey: true,
        },
      },
      uploadedBy: { select: { id: true, name: true, email: true, role: true } },
    },
  },
  history: {
    orderBy: [{ createdAt: "desc" }],
    take: 25,
    include: {
      actor: { select: { id: true, name: true, email: true, role: true } },
    },
  },
};

const toIso = (value) => value?.toISOString?.() || value || null;

const userSummary = (user) =>
  user
    ? {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      }
    : null;

const normalizeEnum = ({ value, allowed, fallback, errorCode, message }) => {
  const normalized = trimToNull(value)?.toLowerCase() || fallback;
  if (!allowed.includes(normalized)) {
    throw new HttpError(400, errorCode, message);
  }
  return normalized;
};

const parseDate = (value, errorCode = "INVALID_TASK_DATE") => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, errorCode, "Task date is invalid");
  }
  return date;
};

const hasProjectWideTaskVisibility = ({ role, projectAccess }) => {
  const effectiveRole = normalizeRoleId(projectAccess?.role || role);
  return (
    PROJECT_WIDE_TASK_ROLES.has(effectiveRole) ||
    canAccessAllProjects(effectiveRole)
  );
};

const projectScopeWhere = ({ userId, role, projectId = null }) => {
  if (projectId) return { id: projectId };
  return {
    archivedAt: null,
    ...getProjectAccessWhere({ userId, role }),
  };
};

const taskVisibilityWhere = ({
  orgId,
  userId,
  role,
  projectId = null,
  projectAccess = null,
  includeArchived = false,
}) => {
  const where = {
    orgId,
    project: projectScopeWhere({ userId, role, projectId }),
  };

  if (projectId) {
    where.projectId = projectId;
  }

  if (!includeArchived) {
    where.archivedAt = null;
  }

  if (!hasProjectWideTaskVisibility({ role, projectAccess })) {
    where.OR = [{ assigneeId: userId }, { createdById: userId }];
  }

  return where;
};

const serializeAttachment = (attachment) => ({
  id: attachment.id,
  projectDocumentId: attachment.projectDocumentId || null,
  fileName:
    attachment.fileName ||
    attachment.projectDocument?.originalName ||
    attachment.projectDocument?.fileName ||
    null,
  fileUrl: attachment.fileUrl || null,
  storageKey:
    attachment.storageKey || attachment.projectDocument?.storageKey || null,
  mimeType: attachment.projectDocument?.mimeType || null,
  uploadedById: attachment.uploadedById || null,
  uploadedBy: userSummary(attachment.uploadedBy),
  createdAt: toIso(attachment.createdAt),
});

const serializeComment = (comment) => ({
  id: comment.id,
  taskId: comment.taskId,
  body: comment.body,
  authorId: comment.authorId || null,
  author: userSummary(comment.author),
  createdAt: toIso(comment.createdAt),
  updatedAt: toIso(comment.updatedAt),
});

const serializeHistory = (event) => ({
  id: event.id,
  taskId: event.taskId,
  action: event.action,
  actorId: event.actorId || null,
  actorRole: event.actorRole || null,
  actor: userSummary(event.actor),
  fromStatus: event.fromStatus || null,
  toStatus: event.toStatus || null,
  comment: event.comment || null,
  metadata: event.metadataJson || {},
  createdAt: toIso(event.createdAt),
});

const serializeTask = (task) => ({
  id: task.id,
  orgId: task.orgId,
  projectId: task.projectId,
  project: task.project || null,
  activityId: task.activityId || null,
  activity: task.activity || null,
  taskNumber: task.taskNumber,
  title: task.title,
  description: task.description || null,
  label: task.label,
  priority: task.priority,
  status: task.status,
  dueDate: toIso(task.dueDate),
  isOverdue:
    Boolean(task.dueDate) &&
    new Date(task.dueDate).getTime() < Date.now() &&
    !CLOSED_TASK_STATUSES.has(task.status),
  assigneeId: task.assigneeId || null,
  assignee: userSummary(task.assignee),
  assigneeName: task.assignee?.name || null,
  createdById: task.createdById || null,
  createdBy: userSummary(task.createdBy),
  updatedById: task.updatedById || null,
  updatedBy: userSummary(task.updatedBy),
  closedById: task.closedById || null,
  closedBy: userSummary(task.closedBy),
  closedAt: toIso(task.closedAt),
  archivedAt: toIso(task.archivedAt),
  archivedBy: task.archivedBy || null,
  comments: (task.comments || []).map(serializeComment),
  commentCount: task.comments?.length || 0,
  attachments: (task.attachments || []).map(serializeAttachment),
  attachmentCount: task.attachments?.length || 0,
  history: (task.history || []).map(serializeHistory),
  createdAt: toIso(task.createdAt),
  updatedAt: toIso(task.updatedAt),
});

const summarizeTask = (task) => ({
  taskNumber: task.taskNumber,
  title: task.title,
  status: task.status,
  priority: task.priority,
  dueDate: toIso(task.dueDate),
  assigneeId: task.assigneeId || null,
  activityId: task.activityId || null,
});

const buildTaskSearchWhere = (search) => {
  if (!search) return null;
  return {
    OR: [
      { taskNumber: containsInsensitive(search) },
      { title: containsInsensitive(search) },
      { description: containsInsensitive(search) },
      { project: { name: containsInsensitive(search) } },
      { activity: { name: containsInsensitive(search) } },
    ],
  };
};

const getAccessForProject = async ({
  orgId,
  projectId,
  userId,
  role,
  projectAccess,
}) => {
  if (projectAccess?.id === projectId) return projectAccess;
  return assertProjectAccess({ orgId, projectId, userId, role });
};

const ensureActivityInProject = async ({ tx = prisma, projectId, activityId }) => {
  if (!activityId) return null;
  const activity = await tx.activity.findFirst({
    where: { id: activityId, projectId, isActive: true },
    select: {
      id: true,
      name: true,
      activityCode: true,
      p6ActivityId: true,
      wbsCode: true,
    },
  });
  if (!activity) {
    throw new HttpError(
      400,
      "TASK_ACTIVITY_INVALID",
      "Task activity is invalid for this project",
    );
  }
  return activity;
};

const ensureAssigneeInProject = async ({
  tx = prisma,
  orgId,
  projectId,
  assigneeId,
}) => {
  if (!assigneeId) return null;

  const assignee = await tx.user.findFirst({
    where: {
      id: assigneeId,
      orgId,
      status: "active",
      OR: [
        { role: { in: ["pm", "super_admin"] } },
        { projectAssignments: { some: { projectId } } },
        {
          projectPartyMemberships: {
            some: {
              status: "active",
              projectParty: {
                projectId,
                status: "active",
              },
            },
          },
        },
      ],
    },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!assignee) {
    throw new HttpError(
      400,
      "TASK_ASSIGNEE_INVALID",
      "Task assignee is not an active member of this project",
    );
  }

  return assignee;
};

const normalizeAttachments = (value) => {
  if (value === undefined) return undefined;
  const rows = Array.isArray(value) ? value : [value];
  return rows
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === "string") {
        return {
          projectDocumentId: trimToNull(entry),
          fileName: null,
          fileUrl: null,
          storageKey: null,
        };
      }
      return {
        projectDocumentId: trimToNull(
          entry.projectDocumentId || entry.documentId || entry.id,
        ),
        fileName: trimToNull(entry.fileName || entry.originalName || entry.name),
        fileUrl: trimToNull(entry.fileUrl || entry.url),
        storageKey: trimToNull(entry.storageKey || entry.key),
      };
    })
    .filter(
      (entry) =>
        entry &&
        (entry.projectDocumentId || entry.fileName || entry.fileUrl || entry.storageKey),
    );
};

const ensureAttachmentDocuments = async ({
  tx = prisma,
  orgId,
  projectId,
  attachments = [],
}) => {
  const ids = [...new Set(attachments.map((item) => item.projectDocumentId).filter(Boolean))];
  if (!ids.length) return;

  const documents = await tx.projectDocument.findMany({
    where: { id: { in: ids }, orgId, projectId },
    select: { id: true },
  });
  const found = new Set(documents.map((document) => document.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new HttpError(
      400,
      "TASK_ATTACHMENT_INVALID",
      "One or more task attachments are invalid for this project",
      { projectDocumentIds: missing },
    );
  }
};

const nextTaskNumber = async ({ tx, projectId }) =>
  nextRef(tx, {
    table: "Task",
    column: "taskNumber",
    scopeColumn: "projectId",
    scopeId: projectId,
    prefix: "TSK",
    pad: 4,
  });

const createTaskHistory = ({
  tx,
  task,
  action,
  userId,
  userRole,
  fromStatus = null,
  toStatus = null,
  comment = null,
  metadata = {},
}) =>
  tx.taskHistory.create({
    data: {
      orgId: task.orgId,
      projectId: task.projectId,
      taskId: task.id,
      action,
      actorId: userId || null,
      actorRole: userRole || null,
      fromStatus,
      toStatus,
      comment,
      metadataJson: metadata,
    },
  });

const recordTaskAudit = ({
  tx,
  task,
  action,
  userId,
  userRole,
  oldTask = null,
  reason = null,
  metadata = {},
}) =>
  auditService.recordEvent({
    tx,
    orgId: task.orgId,
    projectId: task.projectId,
    entityType: auditService.ENTITY_TYPES.TASK || TASK_ENTITY_TYPE,
    entityId: task.id,
    action,
    actorId: userId,
    actorRole: userRole,
    oldStatus: oldTask?.status || null,
    newStatus: task.status,
    reason,
    oldSummary: oldTask ? summarizeTask(oldTask) : null,
    newSummary: summarizeTask(task),
    summary: summarizeTask(task),
    metadata,
  });

const emitAssignmentNotification = ({
  tx,
  task,
  assigneeId,
  actorId,
  event = "task.assigned",
}) => {
  if (!assigneeId) return Promise.resolve({ created: 0, recipients: [] });
  return notificationService.emitTaskNotification({
    tx,
    orgId: task.orgId,
    projectId: task.projectId,
    taskId: task.id,
    actorId,
    assigneeIds: [assigneeId],
    title: `Task ${task.taskNumber} assigned`,
    message: task.dueDate
      ? `${task.title} is due ${toIso(task.dueDate).slice(0, 10)}.`
      : task.title,
    event,
    dueAt: task.dueDate || null,
    priority: task.priority === "critical" ? "urgent" : "high",
    metadata: {
      taskNumber: task.taskNumber,
      status: task.status,
      priority: task.priority,
      activityId: task.activityId || null,
    },
  });
};

const normalizedTaskData = (payload, { requireTitle = false } = {}) => {
  const data = {};
  const title = trimToNull(payload.title);

  if (requireTitle && !title) {
    throw new HttpError(400, "TASK_TITLE_REQUIRED", "Task title is required");
  }
  if (title !== null) data.title = title;

  if (payload.description !== undefined) {
    data.description = trimToNull(payload.description);
  }
  if (payload.label !== undefined) {
    data.label = normalizeEnum({
      value: payload.label,
      allowed: TASK_LABELS,
      fallback: "action",
      errorCode: "INVALID_TASK_LABEL",
      message: "Task label is invalid",
    });
  }
  if (payload.priority !== undefined) {
    data.priority = normalizeEnum({
      value: payload.priority,
      allowed: TASK_PRIORITIES,
      fallback: "medium",
      errorCode: "INVALID_TASK_PRIORITY",
      message: "Task priority is invalid",
    });
  }
  if (payload.status !== undefined) {
    data.status = normalizeEnum({
      value: payload.status,
      allowed: TASK_STATUSES,
      fallback: "todo",
      errorCode: "INVALID_TASK_STATUS",
      message: "Task status is invalid",
    });
  }
  if (payload.dueDate !== undefined) {
    data.dueDate = parseDate(payload.dueDate);
  }
  if (payload.activityId !== undefined) {
    data.activityId = trimToNull(payload.activityId);
  }
  if (payload.assigneeId !== undefined) {
    data.assigneeId = trimToNull(payload.assigneeId);
  }

  return data;
};

const upsertAttachments = async ({
  tx,
  orgId,
  projectId,
  taskId,
  attachments,
  uploadedById,
  replace = false,
}) => {
  if (attachments === undefined) return;

  await ensureAttachmentDocuments({ tx, orgId, projectId, attachments });
  if (replace) {
    await tx.taskAttachment.deleteMany({ where: { taskId } });
  }
  if (!attachments.length) return;

  await tx.taskAttachment.createMany({
    data: attachments.map((attachment) => ({
      orgId,
      projectId,
      taskId,
      projectDocumentId: attachment.projectDocumentId || null,
      fileName: attachment.fileName || null,
      fileUrl: attachment.fileUrl || null,
      storageKey: attachment.storageKey || null,
      uploadedById: uploadedById || null,
    })),
  });
};

const getTaskOrThrow = async ({
  orgId,
  projectId = null,
  taskId,
  userId,
  role,
  projectAccess = null,
  includeArchived = false,
}) => {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      ...taskVisibilityWhere({
        orgId,
        userId,
        role,
        projectId,
        projectAccess,
        includeArchived,
      }),
    },
    include: taskInclude,
  });

  if (!task) {
    throw new HttpError(404, "TASK_NOT_FOUND", "Task not found");
  }

  return task;
};

const listTasks = async ({
  orgId,
  projectId = null,
  userId,
  role,
  projectAccess = null,
  query = {},
}) => {
  if (projectId) {
    await getAccessForProject({ orgId, projectId, userId, role, projectAccess });
  }

  const listQuery = normalizeListQuery(query, {
    allowedSorts: ["created", "updated", "due", "priority", "status"],
    defaultSortBy: "due",
    defaultSortDir: "asc",
    defaultLimit: 50,
    maxLimit: 100,
  });
  const includeArchived = query.includeArchived === true || query.includeArchived === "true";
  const where = taskVisibilityWhere({
    orgId,
    userId,
    role,
    projectId,
    projectAccess,
    includeArchived,
  });

  if (query.status && query.status !== "all") {
    where.status = String(query.status).split(",");
  }
  if (Array.isArray(where.status)) {
    where.status = { in: where.status.filter((status) => TASK_STATUSES.includes(status)) };
  }
  if (query.priority && query.priority !== "all") {
    where.priority = {
      in: String(query.priority)
        .split(",")
        .filter((priority) => TASK_PRIORITIES.includes(priority)),
    };
  }
  if (query.assignee === "me") {
    where.assigneeId = userId;
  } else if (query.assigneeId) {
    where.assigneeId = String(query.assigneeId);
  }
  if (query.overdue === true || query.overdue === "true") {
    where.dueDate = { not: null, lt: new Date() };
    where.status = { notIn: [...CLOSED_TASK_STATUSES] };
  }
  const searchWhere = buildTaskSearchWhere(listQuery.search);
  if (searchWhere) {
    where.AND = [...(where.AND || []), searchWhere];
  }

  const orderByMap = {
    created: [{ createdAt: listQuery.sortDir }, { id: listQuery.sortDir }],
    updated: [{ updatedAt: listQuery.sortDir }, { id: listQuery.sortDir }],
    due: [{ dueDate: listQuery.sortDir }, { createdAt: "desc" }],
    priority: [{ priority: listQuery.sortDir }, { dueDate: "asc" }],
    status: [{ status: listQuery.sortDir }, { dueDate: "asc" }],
  };

  const rows = await prisma.task.findMany({
    where,
    take: listQuery.limit + 1,
    ...cursorArgs(listQuery.cursor),
    orderBy: orderByMap[listQuery.sortBy],
    include: taskInclude,
  });

  const page = toCursorPage(rows.map(serializeTask), listQuery.limit);
  return {
    ...page,
    summary: {
      open: page.rows.filter((task) => !CLOSED_TASK_STATUSES.has(task.status))
        .length,
      overdue: page.rows.filter(
        (task) =>
          task.dueDate &&
          new Date(task.dueDate).getTime() < Date.now() &&
          !CLOSED_TASK_STATUSES.has(task.status),
      ).length,
    },
  };
};

const createTask = async ({
  orgId,
  projectId: routeProjectId = null,
  payload,
  userId,
  userRole,
  projectAccess = null,
}) => {
  const projectId = routeProjectId || trimToNull(payload.projectId);
  if (!projectId) {
    throw new HttpError(400, "TASK_PROJECT_REQUIRED", "Task project is required");
  }

  await getAccessForProject({
    orgId,
    projectId,
    userId,
    role: userRole,
    projectAccess,
  });

  const data = normalizedTaskData(payload, { requireTitle: true });
  const attachments = normalizeAttachments(payload.attachments);

  return prisma.$transaction(async (tx) => {
    await ensureActivityInProject({ tx, projectId, activityId: data.activityId });
    await ensureAssigneeInProject({
      tx,
      orgId,
      projectId,
      assigneeId: data.assigneeId,
    });

    const status = data.status || "todo";
    const task = await tx.task.create({
      data: {
        orgId,
        projectId,
        taskNumber: await nextTaskNumber({ tx, projectId }),
        title: data.title,
        description: data.description ?? null,
        label: data.label || "action",
        priority: data.priority || "medium",
        status,
        dueDate: data.dueDate ?? null,
        activityId: data.activityId || null,
        assigneeId: data.assigneeId || null,
        createdById: userId || null,
        updatedById: userId || null,
        closedAt: CLOSED_TASK_STATUSES.has(status) ? new Date() : null,
        closedById: CLOSED_TASK_STATUSES.has(status) ? userId || null : null,
      },
      include: taskInclude,
    });

    await upsertAttachments({
      tx,
      orgId,
      projectId,
      taskId: task.id,
      attachments,
      uploadedById: userId,
    });

    if (trimToNull(payload.comment)) {
      await tx.taskComment.create({
        data: {
          orgId,
          projectId,
          taskId: task.id,
          authorId: userId || null,
          body: trimToNull(payload.comment),
        },
      });
    }

    await createTaskHistory({
      tx,
      task,
      action: "created",
      userId,
      userRole,
      toStatus: task.status,
    });
    await recordTaskAudit({
      tx,
      task,
      action: auditService.ACTIONS.CREATED,
      userId,
      userRole,
    });
    await emitAssignmentNotification({
      tx,
      task,
      assigneeId: task.assigneeId,
      actorId: userId,
    });

    const created = await tx.task.findUnique({
      where: { id: task.id },
      include: taskInclude,
    });
    return serializeTask(created);
  });
};

const updateTask = async ({
  orgId,
  projectId = null,
  taskId,
  payload,
  userId,
  userRole,
  projectAccess = null,
}) => {
  const current = await getTaskOrThrow({
    orgId,
    projectId,
    taskId,
    userId,
    role: userRole,
    projectAccess,
  });
  const data = normalizedTaskData(payload);
  const attachments = normalizeAttachments(payload.attachments);

  return prisma.$transaction(async (tx) => {
    await ensureActivityInProject({
      tx,
      projectId: current.projectId,
      activityId: data.activityId,
    });
    await ensureAssigneeInProject({
      tx,
      orgId,
      projectId: current.projectId,
      assigneeId: data.assigneeId,
    });

    const updateData = { ...data, updatedById: userId || null };
    if (data.status) {
      if (CLOSED_TASK_STATUSES.has(data.status)) {
        updateData.closedAt = current.closedAt || new Date();
        updateData.closedById = current.closedById || userId || null;
      } else {
        updateData.closedAt = null;
        updateData.closedById = null;
      }
    }

    const task = await tx.task.update({
      where: { id: taskId },
      data: updateData,
      include: taskInclude,
    });

    await upsertAttachments({
      tx,
      orgId,
      projectId: current.projectId,
      taskId,
      attachments,
      uploadedById: userId,
      replace: attachments !== undefined,
    });

    if (trimToNull(payload.comment)) {
      await tx.taskComment.create({
        data: {
          orgId,
          projectId: current.projectId,
          taskId,
          authorId: userId || null,
          body: trimToNull(payload.comment),
        },
      });
    }

    const statusChanged = current.status !== task.status;
    await createTaskHistory({
      tx,
      task,
      action: statusChanged ? "status_changed" : "updated",
      userId,
      userRole,
      fromStatus: statusChanged ? current.status : null,
      toStatus: statusChanged ? task.status : null,
      comment: trimToNull(payload.comment),
      metadata: {
        assigneeChanged: current.assigneeId !== task.assigneeId,
        dueDateChanged: toIso(current.dueDate) !== toIso(task.dueDate),
      },
    });
    await recordTaskAudit({
      tx,
      task,
      action: statusChanged
        ? auditService.ACTIONS.STATUS_CHANGED
        : auditService.ACTIONS.UPDATED,
      userId,
      userRole,
      oldTask: current,
    });
    if (current.assigneeId !== task.assigneeId) {
      await emitAssignmentNotification({
        tx,
        task,
        assigneeId: task.assigneeId,
        actorId: userId,
      });
    }

    const updated = await tx.task.findUnique({
      where: { id: taskId },
      include: taskInclude,
    });
    return serializeTask(updated);
  });
};

const closeTask = async (params) =>
  updateTask({
    ...params,
    payload: {
      status: "done",
      comment: params.payload?.comment,
    },
  });

const addTaskComment = async ({
  orgId,
  projectId = null,
  taskId,
  body,
  userId,
  userRole,
  projectAccess = null,
}) => {
  const current = await getTaskOrThrow({
    orgId,
    projectId,
    taskId,
    userId,
    role: userRole,
    projectAccess,
  });
  const text = trimToNull(body);
  if (!text) {
    throw new HttpError(400, "TASK_COMMENT_REQUIRED", "Task comment is required");
  }

  return prisma.$transaction(async (tx) => {
    const comment = await tx.taskComment.create({
      data: {
        orgId,
        projectId: current.projectId,
        taskId,
        authorId: userId || null,
        body: text,
      },
      include: {
        author: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    await createTaskHistory({
      tx,
      task: current,
      action: "commented",
      userId,
      userRole,
      comment: text,
    });
    await recordTaskAudit({
      tx,
      task: current,
      action: auditService.ACTIONS.UPDATED,
      userId,
      userRole,
      metadata: { commentId: comment.id },
    });

    return serializeComment(comment);
  });
};

const addTaskAttachment = async ({
  orgId,
  projectId = null,
  taskId,
  payload,
  userId,
  userRole,
  projectAccess = null,
}) => {
  const current = await getTaskOrThrow({
    orgId,
    projectId,
    taskId,
    userId,
    role: userRole,
    projectAccess,
  });
  const attachments = normalizeAttachments(payload.attachments || payload);
  if (!attachments?.length) {
    throw new HttpError(
      400,
      "TASK_ATTACHMENT_REQUIRED",
      "Task attachment is required",
    );
  }

  return prisma.$transaction(async (tx) => {
    await upsertAttachments({
      tx,
      orgId,
      projectId: current.projectId,
      taskId,
      attachments,
      uploadedById: userId,
    });

    await createTaskHistory({
      tx,
      task: current,
      action: "attachment_added",
      userId,
      userRole,
      metadata: { count: attachments.length },
    });
    await recordTaskAudit({
      tx,
      task: current,
      action: auditService.ACTIONS.UPDATED,
      userId,
      userRole,
      metadata: { attachmentCount: attachments.length },
    });

    const updated = await tx.task.findUnique({
      where: { id: taskId },
      include: taskInclude,
    });
    return serializeTask(updated);
  });
};

const deleteTask = async ({
  orgId,
  projectId = null,
  taskId,
  userId,
  userRole,
  projectAccess = null,
}) => {
  const current = await getTaskOrThrow({
    orgId,
    projectId,
    taskId,
    userId,
    role: userRole,
    projectAccess,
  });

  const task = await prisma.$transaction(async (tx) => {
    const archived = await tx.task.update({
      where: { id: taskId },
      data: {
        archivedAt: new Date(),
        archivedBy: userId || null,
        updatedById: userId || null,
      },
      include: taskInclude,
    });
    await createTaskHistory({
      tx,
      task: archived,
      action: "archived",
      userId,
      userRole,
      fromStatus: current.status,
      toStatus: archived.status,
    });
    await recordTaskAudit({
      tx,
      task: archived,
      action: auditService.ACTIONS.ARCHIVED,
      userId,
      userRole,
      oldTask: current,
    });
    return archived;
  });

  return {
    id: task.id,
    status: "archived",
    archived: true,
    deleted: false,
    archivedAt: toIso(task.archivedAt),
  };
};

const getTaskById = async (params) =>
  serializeTask(await getTaskOrThrow({ ...params, includeArchived: true }));

module.exports = {
  CLOSED_TASK_STATUSES,
  TASK_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  addTaskAttachment,
  addTaskComment,
  closeTask,
  createTask,
  deleteTask,
  getTaskById,
  listTasks,
  serializeTask,
  updateTask,
};
