const { prisma } = require("../config/db");
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
const taskService = require("./task.service");
const { assertProjectAccess } = require("./project-authorization.service");
const { nextRef } = require("../utils/reference-number");

const MEETING_ENTITY_TYPE = "meeting";
const MEETING_STATUSES = Object.freeze([
  "draft",
  "finalized",
  "distributed",
  "archived",
]);
const MEETING_TYPES = Object.freeze([
  "coordination",
  "progress",
  "commercial",
  "quality",
  "safety",
  "design",
  "client",
  "other",
]);
const ATTENDANCE_STATUSES = Object.freeze([
  "invited",
  "attended",
  "absent",
  "apology",
]);
const AGENDA_STATUSES = Object.freeze(["open", "covered", "deferred"]);
const ACTION_STATUSES = Object.freeze([
  "open",
  "in_progress",
  "closed",
  "canceled",
]);
const ACTION_PRIORITIES = Object.freeze(["low", "medium", "high", "critical"]);
const ACTION_STATUS_TO_TASK_STATUS = Object.freeze({
  open: "todo",
  in_progress: "in_progress",
  closed: "done",
  canceled: "canceled",
});

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
};

const activitySelect = {
  id: true,
  name: true,
  activityCode: true,
  p6ActivityId: true,
  wbsCode: true,
};

const partySelect = {
  id: true,
  role: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  company: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
    },
  },
};

const meetingInclude = {
  project: { select: { id: true, name: true } },
  activity: { select: activitySelect },
  chair: { select: userSelect },
  createdBy: { select: userSelect },
  updatedBy: { select: userSelect },
  distributedBy: { select: userSelect },
  attendees: {
    orderBy: [{ role: "asc" }, { name: "asc" }, { createdAt: "asc" }],
    include: {
      activity: { select: activitySelect },
      user: { select: userSelect },
      projectParty: { select: partySelect },
    },
  },
  agendaItems: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      activity: { select: activitySelect },
      presenter: { select: userSelect },
    },
  },
  decisions: {
    orderBy: [{ decidedAt: "asc" }, { createdAt: "asc" }],
    include: {
      activity: { select: activitySelect },
      decidedBy: { select: userSelect },
    },
  },
  actionItems: {
    orderBy: [{ itemNumber: "asc" }],
    include: {
      activity: { select: activitySelect },
      owner: { select: userSelect },
      task: {
        select: {
          id: true,
          taskNumber: true,
          title: true,
          status: true,
          dueDate: true,
          assigneeId: true,
        },
      },
    },
  },
  distributions: {
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    include: {
      activity: { select: activitySelect },
      recipientUser: { select: userSelect },
      projectParty: { select: partySelect },
      sentBy: { select: userSelect },
    },
  },
  comments: {
    orderBy: [{ createdAt: "asc" }],
    include: {
      activity: { select: activitySelect },
      author: { select: userSelect },
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

const activitySummary = (activity) =>
  activity
    ? {
        id: activity.id,
        name: activity.name,
        activityCode: activity.activityCode || null,
        p6ActivityId: activity.p6ActivityId || null,
        wbsCode: activity.wbsCode || null,
      }
    : null;

const partySummary = (party) =>
  party
    ? {
        id: party.id,
        role: party.role,
        contactName: party.contactName || null,
        contactEmail: party.contactEmail || null,
        company: party.company
          ? {
              id: party.company.id,
              name: party.company.name,
              email: party.company.email || null,
              status: party.company.status,
            }
          : null,
      }
    : null;

const parseDate = (value, errorCode, label, { required = false } = {}) => {
  if (value === undefined) {
    if (required) throw new HttpError(400, errorCode, `${label} is required`);
    return undefined;
  }
  if (value === null || value === "") {
    if (required) throw new HttpError(400, errorCode, `${label} is required`);
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, errorCode, `${label} is invalid`);
  }
  return date;
};

const normalizeEnum = ({ value, allowed, fallback, errorCode, message }) => {
  const normalized = trimToNull(value)?.toLowerCase() || fallback;
  if (!allowed.includes(normalized)) {
    throw new HttpError(400, errorCode, message);
  }
  return normalized;
};

const unique = (values = []) => [
  ...new Set(values.map(trimToNull).filter(Boolean)),
];

const serializeAttendee = (attendee) => ({
  id: attendee.id,
  meetingId: attendee.meetingId,
  activityId: attendee.activityId || null,
  activity: activitySummary(attendee.activity),
  userId: attendee.userId || null,
  user: userSummary(attendee.user),
  projectPartyId: attendee.projectPartyId || null,
  projectParty: partySummary(attendee.projectParty),
  name: attendee.name || attendee.user?.name || null,
  email: attendee.email || attendee.user?.email || null,
  companyName:
    attendee.companyName || attendee.projectParty?.company?.name || null,
  role: attendee.role,
  attendanceStatus: attendee.attendanceStatus,
  distributionRequired: Boolean(attendee.distributionRequired),
  attendedAt: toIso(attendee.attendedAt),
  createdAt: toIso(attendee.createdAt),
  updatedAt: toIso(attendee.updatedAt),
});

const serializeAgendaItem = (item) => ({
  id: item.id,
  meetingId: item.meetingId,
  activityId: item.activityId || null,
  activity: activitySummary(item.activity),
  presenterId: item.presenterId || null,
  presenter: userSummary(item.presenter),
  sortOrder: item.sortOrder,
  title: item.title,
  notes: item.notes || null,
  status: item.status,
  createdAt: toIso(item.createdAt),
  updatedAt: toIso(item.updatedAt),
});

const serializeDecision = (decision) => ({
  id: decision.id,
  meetingId: decision.meetingId,
  activityId: decision.activityId || null,
  activity: activitySummary(decision.activity),
  decidedById: decision.decidedById || null,
  decidedBy: userSummary(decision.decidedBy),
  title: decision.title,
  decision: decision.decision,
  impact: decision.impact || null,
  decidedAt: toIso(decision.decidedAt),
  createdAt: toIso(decision.createdAt),
  updatedAt: toIso(decision.updatedAt),
});

const serializeActionItem = (item) => ({
  id: item.id,
  meetingId: item.meetingId,
  activityId: item.activityId || null,
  activity: activitySummary(item.activity),
  taskId: item.taskId || null,
  task: item.task
    ? {
        ...item.task,
        dueDate: toIso(item.task.dueDate),
      }
    : null,
  itemNumber: item.itemNumber,
  title: item.title,
  description: item.description || null,
  ownerId: item.ownerId || null,
  owner: userSummary(item.owner),
  ownerName: item.ownerName || item.owner?.name || null,
  ownerEmail: item.ownerEmail || item.owner?.email || null,
  dueDate: toIso(item.dueDate),
  priority: item.priority,
  status: item.status,
  createdAt: toIso(item.createdAt),
  updatedAt: toIso(item.updatedAt),
});

const serializeDistribution = (distribution) => ({
  id: distribution.id,
  meetingId: distribution.meetingId,
  activityId: distribution.activityId || null,
  activity: activitySummary(distribution.activity),
  recipientUserId: distribution.recipientUserId || null,
  recipientUser: userSummary(distribution.recipientUser),
  projectPartyId: distribution.projectPartyId || null,
  projectParty: partySummary(distribution.projectParty),
  recipientName:
    distribution.recipientName || distribution.recipientUser?.name || null,
  recipientEmail:
    distribution.recipientEmail || distribution.recipientUser?.email || null,
  companyName:
    distribution.companyName ||
    distribution.projectParty?.company?.name ||
    null,
  channel: distribution.channel,
  status: distribution.status,
  message: distribution.message || null,
  sentById: distribution.sentById || null,
  sentBy: userSummary(distribution.sentBy),
  sentAt: toIso(distribution.sentAt),
  metadata: distribution.metadataJson || {},
  createdAt: toIso(distribution.createdAt),
  updatedAt: toIso(distribution.updatedAt),
});

const serializeComment = (comment) => ({
  id: comment.id,
  meetingId: comment.meetingId,
  activityId: comment.activityId || null,
  activity: activitySummary(comment.activity),
  authorId: comment.authorId || null,
  author: userSummary(comment.author),
  body: comment.body,
  createdAt: toIso(comment.createdAt),
  updatedAt: toIso(comment.updatedAt),
});

const serializeMeeting = (meeting) => {
  const actionItems = (meeting.actionItems || []).map(serializeActionItem);
  const openActionItems = actionItems.filter((item) =>
    ["open", "in_progress"].includes(item.status),
  );

  return {
    id: meeting.id,
    orgId: meeting.orgId,
    projectId: meeting.projectId,
    project: meeting.project || null,
    activityId: meeting.activityId || null,
    activity: activitySummary(meeting.activity),
    meetingNumber: meeting.meetingNumber,
    title: meeting.title,
    meetingType: meeting.meetingType,
    location: meeting.location || null,
    scheduledAt: toIso(meeting.scheduledAt),
    startedAt: toIso(meeting.startedAt),
    endedAt: toIso(meeting.endedAt),
    status: meeting.status,
    objective: meeting.objective || null,
    minutesText: meeting.minutesText || null,
    nextMeetingAt: toIso(meeting.nextMeetingAt),
    chairId: meeting.chairId || null,
    chair: userSummary(meeting.chair),
    createdById: meeting.createdById || null,
    createdBy: userSummary(meeting.createdBy),
    updatedById: meeting.updatedById || null,
    updatedBy: userSummary(meeting.updatedBy),
    distributedById: meeting.distributedById || null,
    distributedBy: userSummary(meeting.distributedBy),
    distributedAt: toIso(meeting.distributedAt),
    archivedAt: toIso(meeting.archivedAt),
    archivedBy: meeting.archivedBy || null,
    attendees: (meeting.attendees || []).map(serializeAttendee),
    agendaItems: (meeting.agendaItems || []).map(serializeAgendaItem),
    decisions: (meeting.decisions || []).map(serializeDecision),
    actionItems,
    distributions: (meeting.distributions || []).map(serializeDistribution),
    comments: (meeting.comments || []).map(serializeComment),
    attendeeCount: meeting.attendees?.length || 0,
    decisionCount: meeting.decisions?.length || 0,
    actionItemCount: actionItems.length,
    openActionItemCount: openActionItems.length,
    distributionCount: meeting.distributions?.length || 0,
    createdAt: toIso(meeting.createdAt),
    updatedAt: toIso(meeting.updatedAt),
  };
};

const summarizeMeeting = (meeting) => ({
  meetingNumber: meeting.meetingNumber,
  title: meeting.title,
  meetingType: meeting.meetingType,
  status: meeting.status,
  scheduledAt: toIso(meeting.scheduledAt),
  activityId: meeting.activityId || null,
  distributedAt: toIso(meeting.distributedAt),
});

const assertAccess = async ({
  orgId,
  projectId,
  userId,
  role,
  projectAccess,
}) => {
  if (projectAccess?.id === projectId) return projectAccess;
  return assertProjectAccess({ orgId, projectId, userId, role });
};

const ensureActivitiesInProject = async ({
  tx = prisma,
  projectId,
  activityIds,
}) => {
  const ids = unique(activityIds);
  if (!ids.length) return;

  const rows = await tx.activity.findMany({
    where: { id: { in: ids }, projectId, isActive: true },
    select: { id: true },
  });
  const found = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    // The refusal does not list the ids it was sent: it handed another
    // company's activity id back in the answer (CERT-2), and the answer is the
    // same whichever id is missing (as RISK_ACTIVITY_INVALID).
    throw new HttpError(
      400,
      "MEETING_ACTIVITY_INVALID",
      "One or more meeting activity links are invalid for this project",
    );
  }
};

const projectUserWhere = ({ orgId, projectId, userIds }) => ({
  id: { in: unique(userIds) },
  orgId,
  status: "active",
  OR: [
    { role: "pm" },
    { projectAssignments: { some: { projectId } } },
    {
      projectPartyMemberships: {
        some: {
          status: "active",
          projectParty: { projectId, status: "active" },
        },
      },
    },
  ],
});

const ensureUsersInProject = async ({
  tx = prisma,
  orgId,
  projectId,
  userIds,
}) => {
  const ids = unique(userIds);
  if (!ids.length) return new Map();

  const rows = await tx.user.findMany({
    where: projectUserWhere({ orgId, projectId, userIds: ids }),
    select: userSelect,
  });
  const map = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) {
    throw new HttpError(
      400,
      "MEETING_USER_INVALID",
      "One or more meeting users are not active project members",
      { userIds: missing },
    );
  }
  return map;
};

const ensureProjectPartiesInProject = async ({
  tx = prisma,
  projectId,
  projectPartyIds,
}) => {
  const ids = unique(projectPartyIds);
  if (!ids.length) return new Map();

  const rows = await tx.projectParty.findMany({
    where: { id: { in: ids }, projectId, status: "active" },
    select: partySelect,
  });
  const map = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) {
    throw new HttpError(
      400,
      "MEETING_PARTY_INVALID",
      "One or more meeting project parties are invalid for this project",
      { projectPartyIds: missing },
    );
  }
  return map;
};

const ensureTasksInProject = async ({
  tx = prisma,
  orgId,
  projectId,
  taskIds,
}) => {
  const ids = unique(taskIds);
  if (!ids.length) return;

  const rows = await tx.task.findMany({
    where: { id: { in: ids }, orgId, projectId, archivedAt: null },
    select: { id: true },
  });
  const found = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new HttpError(
      400,
      "MEETING_TASK_INVALID",
      "One or more linked tasks are invalid for this project",
      { taskIds: missing },
    );
  }
};

const normalizeMeetingData = (payload = {}, { requireTitle = false } = {}) => {
  const data = {};
  const title = trimToNull(payload.title);
  if (requireTitle && !title) {
    throw new HttpError(
      400,
      "MEETING_TITLE_REQUIRED",
      "Meeting title is required",
    );
  }
  if (title !== null) data.title = title;

  if (payload.activityId !== undefined)
    data.activityId = trimToNull(payload.activityId);
  if (payload.meetingType !== undefined) {
    data.meetingType = normalizeEnum({
      value: payload.meetingType,
      allowed: MEETING_TYPES,
      fallback: "coordination",
      errorCode: "MEETING_TYPE_INVALID",
      message: "Meeting type is invalid",
    });
  }
  if (payload.location !== undefined)
    data.location = trimToNull(payload.location);
  if (payload.status !== undefined) {
    data.status = normalizeEnum({
      value: payload.status,
      allowed: MEETING_STATUSES.filter((status) => status !== "archived"),
      fallback: "draft",
      errorCode: "MEETING_STATUS_INVALID",
      message: "Meeting status is invalid",
    });
  }
  for (const [field, label] of [
    ["scheduledAt", "Meeting scheduled date"],
    ["startedAt", "Meeting start date"],
    ["endedAt", "Meeting end date"],
    ["nextMeetingAt", "Next meeting date"],
  ]) {
    if (payload[field] !== undefined) {
      data[field] = parseDate(payload[field], "MEETING_DATE_INVALID", label);
    }
  }
  if (payload.objective !== undefined)
    data.objective = trimToNull(payload.objective);
  if (payload.minutesText !== undefined)
    data.minutesText = trimToNull(payload.minutesText);
  if (payload.chairId !== undefined) data.chairId = trimToNull(payload.chairId);

  return data;
};

const arrayFrom = (value, aliases = []) => {
  if (value !== undefined) return Array.isArray(value) ? value : [];
  for (const alias of aliases) {
    if (alias !== undefined) return Array.isArray(alias) ? alias : [];
  }
  return undefined;
};

const normalizeAttendees = (payload = {}) => {
  const rows = arrayFrom(payload.attendees);
  if (rows === undefined) return undefined;

  return rows
    .map((row) => {
      const name = trimToNull(row.name || row.attendeeName);
      const userId = trimToNull(row.userId);
      const projectPartyId = trimToNull(row.projectPartyId || row.partyId);
      if (!name && !userId && !projectPartyId && !trimToNull(row.email)) {
        return null;
      }
      return {
        activityId: trimToNull(row.activityId),
        userId,
        projectPartyId,
        name,
        email: trimToNull(row.email),
        companyName: trimToNull(row.companyName || row.company),
        role: trimToNull(row.role)?.toLowerCase() || "attendee",
        attendanceStatus: normalizeEnum({
          value: row.attendanceStatus || row.status,
          allowed: ATTENDANCE_STATUSES,
          fallback: "invited",
          errorCode: "MEETING_ATTENDANCE_STATUS_INVALID",
          message: "Meeting attendee status is invalid",
        }),
        distributionRequired:
          row.distributionRequired === undefined
            ? true
            : Boolean(row.distributionRequired),
        attendedAt: parseDate(
          row.attendedAt,
          "MEETING_ATTENDEE_DATE_INVALID",
          "Attendee date",
        ),
      };
    })
    .filter(Boolean);
};

const normalizeAgendaItems = (payload = {}) => {
  const rows = arrayFrom(payload.agendaItems, [payload.agenda]);
  if (rows === undefined) return undefined;

  return rows
    .map((row, index) => {
      const title = trimToNull(row.title || row.subject);
      if (!title) return null;
      return {
        activityId: trimToNull(row.activityId),
        presenterId: trimToNull(row.presenterId),
        sortOrder: Number.isFinite(Number(row.sortOrder))
          ? Number(row.sortOrder)
          : index + 1,
        title,
        notes: trimToNull(row.notes || row.description),
        status: normalizeEnum({
          value: row.status,
          allowed: AGENDA_STATUSES,
          fallback: "open",
          errorCode: "MEETING_AGENDA_STATUS_INVALID",
          message: "Meeting agenda status is invalid",
        }),
      };
    })
    .filter(Boolean);
};

const normalizeDecisions = (payload = {}) => {
  const rows = arrayFrom(payload.decisions);
  if (rows === undefined) return undefined;

  return rows
    .map((row) => {
      const decision = trimToNull(row.decision || row.decisionText);
      const title = trimToNull(row.title) || decision?.slice(0, 120);
      if (!title || !decision) return null;
      return {
        activityId: trimToNull(row.activityId),
        decidedById: trimToNull(row.decidedById),
        title,
        decision,
        impact: trimToNull(row.impact),
        decidedAt:
          parseDate(
            row.decidedAt,
            "MEETING_DECISION_DATE_INVALID",
            "Decision date",
          ) || new Date(),
      };
    })
    .filter(Boolean);
};

const normalizeActionItems = (payload = {}) => {
  const rows = arrayFrom(payload.actionItems);
  if (rows === undefined) return undefined;

  return rows
    .map((row, index) => {
      const title = trimToNull(row.title || row.action);
      if (!title) return null;
      const ownerId = trimToNull(row.ownerId || row.assigneeId);
      const ownerName = trimToNull(row.ownerName || row.assigneeName);
      if (!ownerId && !ownerName && !trimToNull(row.ownerEmail)) {
        throw new HttpError(
          400,
          "MEETING_ACTION_OWNER_REQUIRED",
          "Meeting action item owner is required",
        );
      }
      const dueDate = parseDate(
        row.dueDate,
        "MEETING_ACTION_DUE_DATE_REQUIRED",
        "Meeting action item due date",
        { required: true },
      );
      return {
        activityId: trimToNull(row.activityId),
        taskId: trimToNull(row.taskId),
        itemNumber:
          trimToNull(row.itemNumber) ||
          `AI-${String(index + 1).padStart(3, "0")}`,
        title,
        description: trimToNull(row.description || row.notes),
        ownerId,
        ownerName,
        ownerEmail: trimToNull(row.ownerEmail || row.assigneeEmail),
        dueDate,
        priority: normalizeEnum({
          value: row.priority,
          allowed: ACTION_PRIORITIES,
          fallback: "medium",
          errorCode: "MEETING_ACTION_PRIORITY_INVALID",
          message: "Meeting action item priority is invalid",
        }),
        status: normalizeEnum({
          value: row.status,
          allowed: ACTION_STATUSES,
          fallback: "open",
          errorCode: "MEETING_ACTION_STATUS_INVALID",
          message: "Meeting action item status is invalid",
        }),
        createTask: row.createTask !== false,
      };
    })
    .filter(Boolean);
};

const collectValidationIds = ({
  data,
  attendees,
  agendaItems,
  decisions,
  actionItems,
}) => ({
  activityIds: [
    data.activityId,
    ...(attendees || []).map((row) => row.activityId),
    ...(agendaItems || []).map((row) => row.activityId),
    ...(decisions || []).map((row) => row.activityId),
    ...(actionItems || []).map((row) => row.activityId),
  ],
  userIds: [
    data.chairId,
    ...(attendees || []).map((row) => row.userId),
    ...(agendaItems || []).map((row) => row.presenterId),
    ...(decisions || []).map((row) => row.decidedById),
    ...(actionItems || []).map((row) => row.ownerId),
  ],
  projectPartyIds: (attendees || []).map((row) => row.projectPartyId),
  taskIds: (actionItems || []).map((row) => row.taskId),
});

const nextMeetingNumber = async ({ tx, projectId }) =>
  nextRef(tx, {
    table: "Meeting",
    column: "meetingNumber",
    scopeColumn: "projectId",
    scopeId: projectId,
    prefix: "MTG",
    pad: 4,
  });

const recordMeetingAudit = ({
  tx,
  meeting,
  action,
  userId,
  userRole,
  oldMeeting = null,
  metadata = {},
}) =>
  auditService.recordEvent({
    tx,
    orgId: meeting.orgId,
    projectId: meeting.projectId,
    entityType: auditService.ENTITY_TYPES.MEETING || MEETING_ENTITY_TYPE,
    entityId: meeting.id,
    action,
    actorId: userId,
    actorRole: userRole,
    oldStatus: oldMeeting?.status || null,
    newStatus: meeting.status,
    oldSummary: oldMeeting ? summarizeMeeting(oldMeeting) : null,
    newSummary: summarizeMeeting(meeting),
    summary: summarizeMeeting(meeting),
    metadata,
  });

const getMeetingOrThrow = async ({
  orgId,
  projectId,
  meetingId,
  includeArchived = false,
}) => {
  const meeting = await prisma.meeting.findFirst({
    where: {
      id: meetingId,
      orgId,
      projectId,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    include: meetingInclude,
  });

  if (!meeting) {
    throw new HttpError(404, "MEETING_NOT_FOUND", "Meeting not found");
  }

  return meeting;
};

const createChildRows = async ({
  tx,
  orgId,
  projectId,
  meetingId,
  attendees = [],
  agendaItems = [],
  decisions = [],
  actionItems = [],
}) => {
  if (attendees.length) {
    await tx.meetingAttendee.createMany({
      data: attendees.map((row) => ({
        orgId,
        projectId,
        meetingId,
        activityId: row.activityId || null,
        userId: row.userId || null,
        projectPartyId: row.projectPartyId || null,
        name: row.name || null,
        email: row.email || null,
        companyName: row.companyName || null,
        role: row.role,
        attendanceStatus: row.attendanceStatus,
        distributionRequired: row.distributionRequired,
        attendedAt: row.attendedAt || null,
      })),
    });
  }

  if (agendaItems.length) {
    await tx.meetingAgendaItem.createMany({
      data: agendaItems.map((row) => ({
        orgId,
        projectId,
        meetingId,
        activityId: row.activityId || null,
        presenterId: row.presenterId || null,
        sortOrder: row.sortOrder,
        title: row.title,
        notes: row.notes || null,
        status: row.status,
      })),
    });
  }

  if (decisions.length) {
    await tx.meetingDecision.createMany({
      data: decisions.map((row) => ({
        orgId,
        projectId,
        meetingId,
        activityId: row.activityId || null,
        decidedById: row.decidedById || null,
        title: row.title,
        decision: row.decision,
        impact: row.impact || null,
        decidedAt: row.decidedAt,
      })),
    });
  }

  const createdActionItems = [];
  for (const row of actionItems) {
    const actionItem = await tx.meetingActionItem.create({
      data: {
        orgId,
        projectId,
        meetingId,
        activityId: row.activityId || null,
        taskId: row.taskId || null,
        itemNumber: row.itemNumber,
        title: row.title,
        description: row.description || null,
        ownerId: row.ownerId || null,
        ownerName: row.ownerName || null,
        ownerEmail: row.ownerEmail || null,
        dueDate: row.dueDate,
        priority: row.priority,
        status: row.status,
      },
    });
    createdActionItems.push({
      ...actionItem,
      createTask: row.createTask && !row.taskId,
    });
  }

  return createdActionItems;
};

const replaceChildren = async ({
  tx,
  orgId,
  projectId,
  meetingId,
  attendees,
  agendaItems,
  decisions,
  actionItems,
}) => {
  const actionItemsForTasks = [];

  if (attendees !== undefined) {
    await tx.meetingAttendee.deleteMany({ where: { meetingId } });
  }
  if (agendaItems !== undefined) {
    await tx.meetingAgendaItem.deleteMany({ where: { meetingId } });
  }
  if (decisions !== undefined) {
    await tx.meetingDecision.deleteMany({ where: { meetingId } });
  }
  if (actionItems !== undefined) {
    await tx.meetingActionItem.deleteMany({ where: { meetingId } });
  }

  const created = await createChildRows({
    tx,
    orgId,
    projectId,
    meetingId,
    attendees: attendees || [],
    agendaItems: agendaItems || [],
    decisions: decisions || [],
    actionItems: actionItems || [],
  });
  actionItemsForTasks.push(...created.filter((row) => row.createTask));

  return actionItemsForTasks;
};

const linkActionItemTasks = async ({
  orgId,
  projectId,
  meeting,
  actionItems,
  userId,
  userRole,
}) => {
  for (const item of actionItems || []) {
    if (!item.createTask || item.taskId) continue;

    const description = [
      item.description,
      `Meeting ${meeting.meetingNumber}: ${meeting.title}`,
      item.ownerName && !item.ownerId ? `Owner: ${item.ownerName}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const task = await taskService.createTask({
      orgId,
      projectId,
      payload: {
        title: item.title,
        description,
        label: "action",
        priority: item.priority,
        status: ACTION_STATUS_TO_TASK_STATUS[item.status] || "todo",
        dueDate: toIso(item.dueDate),
        assigneeId: item.ownerId || null,
        activityId: item.activityId || meeting.activityId || null,
        comment: `Created from meeting ${meeting.meetingNumber}.`,
      },
      userId,
      userRole,
    });

    await prisma.meetingActionItem.update({
      where: { id: item.id },
      data: { taskId: task.id },
    });
  }
};

const buildMeetingSearchWhere = (search) => {
  if (!search) return null;
  return {
    OR: [
      { meetingNumber: containsInsensitive(search) },
      { title: containsInsensitive(search) },
      { objective: containsInsensitive(search) },
      { minutesText: containsInsensitive(search) },
      { location: containsInsensitive(search) },
    ],
  };
};

const listMeetings = async ({
  orgId,
  projectId,
  userId,
  role,
  projectAccess = null,
  query = {},
}) => {
  await assertAccess({ orgId, projectId, userId, role, projectAccess });

  const listQuery = normalizeListQuery(query, {
    allowedSorts: ["created", "updated", "scheduled", "status", "type"],
    defaultSortBy: "scheduled",
    defaultSortDir: "desc",
    defaultLimit: 25,
    maxLimit: 100,
  });
  const includeArchived =
    query.includeArchived === true || query.includeArchived === "true";
  const where = {
    orgId,
    projectId,
    ...(includeArchived ? {} : { archivedAt: null }),
  };

  if (query.status && query.status !== "all") {
    where.status = {
      in: String(query.status)
        .split(",")
        .filter((status) => MEETING_STATUSES.includes(status)),
    };
  }
  if (query.meetingType && query.meetingType !== "all") {
    where.meetingType = String(query.meetingType);
  }
  if (query.activityId) {
    where.activityId = String(query.activityId);
  }
  const searchWhere = buildMeetingSearchWhere(listQuery.search);
  if (searchWhere) where.AND = [...(where.AND || []), searchWhere];

  const orderByMap = {
    created: [{ createdAt: listQuery.sortDir }, { id: listQuery.sortDir }],
    updated: [{ updatedAt: listQuery.sortDir }, { id: listQuery.sortDir }],
    scheduled: [{ scheduledAt: listQuery.sortDir }, { createdAt: "desc" }],
    status: [{ status: listQuery.sortDir }, { scheduledAt: "desc" }],
    type: [{ meetingType: listQuery.sortDir }, { scheduledAt: "desc" }],
  };

  const rows = await prisma.meeting.findMany({
    where,
    take: listQuery.limit + 1,
    ...cursorArgs(listQuery.cursor),
    orderBy: orderByMap[listQuery.sortBy],
    include: meetingInclude,
  });

  const page = toCursorPage(rows.map(serializeMeeting), listQuery.limit);
  return {
    ...page,
    summary: {
      total: page.rows.length,
      draft: page.rows.filter((meeting) => meeting.status === "draft").length,
      distributed: page.rows.filter(
        (meeting) => meeting.status === "distributed",
      ).length,
      openActionItems: page.rows.reduce(
        (sum, meeting) => sum + meeting.openActionItemCount,
        0,
      ),
    },
  };
};

const validateMeetingPayload = async ({
  tx,
  orgId,
  projectId,
  data,
  attendees,
  agendaItems,
  decisions,
  actionItems,
}) => {
  const ids = collectValidationIds({
    data,
    attendees,
    agendaItems,
    decisions,
    actionItems,
  });
  await ensureActivitiesInProject({
    tx,
    projectId,
    activityIds: ids.activityIds,
  });
  await ensureUsersInProject({ tx, orgId, projectId, userIds: ids.userIds });
  await ensureProjectPartiesInProject({
    tx,
    projectId,
    projectPartyIds: ids.projectPartyIds,
  });
  await ensureTasksInProject({ tx, orgId, projectId, taskIds: ids.taskIds });
};

const createMeeting = async ({
  orgId,
  projectId,
  payload,
  userId,
  userRole,
  projectAccess = null,
}) => {
  await assertAccess({
    orgId,
    projectId,
    userId,
    role: userRole,
    projectAccess,
  });
  const data = normalizeMeetingData(payload, { requireTitle: true });
  const attendees = normalizeAttendees(payload) || [];
  const agendaItems = normalizeAgendaItems(payload) || [];
  const decisions = normalizeDecisions(payload) || [];
  const actionItems = normalizeActionItems(payload) || [];

  const { meeting, actionItemsForTasks } = await prisma.$transaction(
    async (tx) => {
      await validateMeetingPayload({
        tx,
        orgId,
        projectId,
        data,
        attendees,
        agendaItems,
        decisions,
        actionItems,
      });

      const meetingRow = await tx.meeting.create({
        data: {
          orgId,
          projectId,
          activityId: data.activityId || null,
          meetingNumber: await nextMeetingNumber({ tx, projectId }),
          title: data.title,
          meetingType: data.meetingType || "coordination",
          location: data.location ?? null,
          scheduledAt: data.scheduledAt ?? null,
          startedAt: data.startedAt ?? null,
          endedAt: data.endedAt ?? null,
          status: data.status || "draft",
          objective: data.objective ?? null,
          minutesText: data.minutesText ?? null,
          nextMeetingAt: data.nextMeetingAt ?? null,
          chairId: data.chairId || null,
          createdById: userId || null,
          updatedById: userId || null,
        },
      });

      const createdActionItems = await createChildRows({
        tx,
        orgId,
        projectId,
        meetingId: meetingRow.id,
        attendees,
        agendaItems,
        decisions,
        actionItems,
      });

      await recordMeetingAudit({
        tx,
        meeting: meetingRow,
        action: auditService.ACTIONS.CREATED,
        userId,
        userRole,
        metadata: {
          attendeeCount: attendees.length,
          agendaItemCount: agendaItems.length,
          decisionCount: decisions.length,
          actionItemCount: actionItems.length,
        },
      });

      return {
        meeting: meetingRow,
        actionItemsForTasks: createdActionItems.filter((row) => row.createTask),
      };
    },
  );

  await linkActionItemTasks({
    orgId,
    projectId,
    meeting,
    actionItems: actionItemsForTasks,
    userId,
    userRole,
  });

  return serializeMeeting(
    await prisma.meeting.findUnique({
      where: { id: meeting.id },
      include: meetingInclude,
    }),
  );
};

const updateMeeting = async ({
  orgId,
  projectId,
  meetingId,
  payload,
  userId,
  userRole,
  projectAccess = null,
}) => {
  await assertAccess({
    orgId,
    projectId,
    userId,
    role: userRole,
    projectAccess,
  });
  const current = await getMeetingOrThrow({ orgId, projectId, meetingId });
  const data = normalizeMeetingData(payload);
  const attendees = normalizeAttendees(payload);
  const agendaItems = normalizeAgendaItems(payload);
  const decisions = normalizeDecisions(payload);
  const actionItems = normalizeActionItems(payload);

  const { meeting, actionItemsForTasks } = await prisma.$transaction(
    async (tx) => {
      await validateMeetingPayload({
        tx,
        orgId,
        projectId,
        data,
        attendees,
        agendaItems,
        decisions,
        actionItems,
      });

      const meetingRow = await tx.meeting.update({
        where: { id: meetingId },
        data: {
          ...data,
          updatedById: userId || null,
        },
      });

      const createdActionItems = await replaceChildren({
        tx,
        orgId,
        projectId,
        meetingId,
        attendees,
        agendaItems,
        decisions,
        actionItems,
      });

      await recordMeetingAudit({
        tx,
        meeting: meetingRow,
        action:
          current.status !== meetingRow.status
            ? auditService.ACTIONS.STATUS_CHANGED
            : auditService.ACTIONS.UPDATED,
        userId,
        userRole,
        oldMeeting: current,
        metadata: {
          replacedAttendees: attendees !== undefined,
          replacedAgenda: agendaItems !== undefined,
          replacedDecisions: decisions !== undefined,
          replacedActionItems: actionItems !== undefined,
        },
      });

      return {
        meeting: meetingRow,
        actionItemsForTasks: createdActionItems.filter((row) => row.createTask),
      };
    },
  );

  await linkActionItemTasks({
    orgId,
    projectId,
    meeting,
    actionItems: actionItemsForTasks,
    userId,
    userRole,
  });

  return serializeMeeting(
    await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: meetingInclude,
    }),
  );
};

const getMeetingById = async (params) => {
  await assertAccess({
    orgId: params.orgId,
    projectId: params.projectId,
    userId: params.userId,
    role: params.role,
    projectAccess: params.projectAccess,
  });
  return serializeMeeting(
    await getMeetingOrThrow({
      orgId: params.orgId,
      projectId: params.projectId,
      meetingId: params.meetingId,
      includeArchived: true,
    }),
  );
};

const normalizeDistributionRequest = (payload = {}) => {
  const manualRows = Array.isArray(payload.recipients)
    ? payload.recipients
    : [];
  return {
    message: trimToNull(payload.message),
    includeAttendees: payload.includeAttendees !== false,
    recipientUserIds: unique([
      ...(payload.recipientUserIds || []),
      ...(payload.userIds || []),
    ]),
    projectPartyIds: unique([
      ...(payload.projectPartyIds || []),
      ...(payload.partyIds || []),
    ]),
    recipients: manualRows
      .map((row) => ({
        name: trimToNull(row.name),
        email: trimToNull(row.email),
        companyName: trimToNull(row.companyName || row.company),
      }))
      .filter((row) => row.name || row.email),
  };
};

const addDistributionTarget = (targets, target) => {
  const key = target.recipientUserId
    ? `user:${target.recipientUserId}`
    : target.recipientEmail
      ? `email:${target.recipientEmail.toLowerCase()}`
      : target.projectPartyId
        ? `party:${target.projectPartyId}:${target.recipientName || ""}`
        : `name:${target.recipientName}`;
  if (!key || targets.has(key)) return;
  targets.set(key, target);
};

const resolveDistributionTargets = async ({
  tx = prisma,
  orgId,
  projectId,
  meeting,
  request,
}) => {
  const userIds = new Set(request.recipientUserIds);
  const partyIds = new Set(request.projectPartyIds);
  const targets = new Map();

  if (request.includeAttendees) {
    for (const attendee of meeting.attendees || []) {
      if (!attendee.distributionRequired) continue;
      if (attendee.userId) userIds.add(attendee.userId);
      if (attendee.projectPartyId) partyIds.add(attendee.projectPartyId);
      if (!attendee.userId && (attendee.email || attendee.name)) {
        addDistributionTarget(targets, {
          activityId: attendee.activityId || meeting.activityId || null,
          recipientName: attendee.name || attendee.email,
          recipientEmail: attendee.email || null,
          companyName: attendee.companyName || null,
          projectPartyId: attendee.projectPartyId || null,
        });
      }
    }
  }

  for (const recipient of request.recipients) {
    addDistributionTarget(targets, {
      activityId: meeting.activityId || null,
      recipientName: recipient.name || recipient.email,
      recipientEmail: recipient.email || null,
      companyName: recipient.companyName || null,
    });
  }

  const parties = [...partyIds].length
    ? await tx.projectParty.findMany({
        where: { id: { in: [...partyIds] }, projectId, status: "active" },
        include: {
          company: {
            select: { id: true, name: true, email: true, status: true },
          },
          members: {
            where: { status: "active" },
            include: { user: { select: userSelect } },
          },
        },
      })
    : [];
  const foundPartyIds = new Set(parties.map((party) => party.id));
  const missingPartyIds = [...partyIds].filter((id) => !foundPartyIds.has(id));
  if (missingPartyIds.length) {
    throw new HttpError(
      400,
      "MEETING_DISTRIBUTION_PARTY_INVALID",
      "One or more distribution project parties are invalid",
      { projectPartyIds: missingPartyIds },
    );
  }

  for (const party of parties) {
    if (party.members?.length) {
      for (const member of party.members) {
        if (member.user?.id) userIds.add(member.user.id);
      }
    } else if (party.contactEmail || party.contactName) {
      addDistributionTarget(targets, {
        activityId: meeting.activityId || null,
        projectPartyId: party.id,
        recipientName: party.contactName || party.company?.name,
        recipientEmail: party.contactEmail || party.company?.email || null,
        companyName: party.company?.name || null,
      });
    }
  }

  const users = [...userIds].length
    ? await tx.user.findMany({
        where: projectUserWhere({ orgId, projectId, userIds: [...userIds] }),
        select: userSelect,
      })
    : [];
  const foundUserIds = new Set(users.map((user) => user.id));
  const missingUserIds = [...userIds].filter((id) => !foundUserIds.has(id));
  if (missingUserIds.length) {
    throw new HttpError(
      400,
      "MEETING_DISTRIBUTION_USER_INVALID",
      "One or more distribution recipients are not active project members",
      { userIds: missingUserIds },
    );
  }

  for (const user of users) {
    addDistributionTarget(targets, {
      activityId: meeting.activityId || null,
      recipientUserId: user.id,
      recipientName: user.name,
      recipientEmail: user.email,
    });
  }

  return [...targets.values()];
};

const distributeMeeting = async ({
  orgId,
  projectId,
  meetingId,
  payload,
  userId,
  userRole,
  projectAccess = null,
}) => {
  await assertAccess({
    orgId,
    projectId,
    userId,
    role: userRole,
    projectAccess,
  });
  const current = await getMeetingOrThrow({ orgId, projectId, meetingId });
  const request = normalizeDistributionRequest(payload);

  const { meeting, distributions } = await prisma.$transaction(async (tx) => {
    const targets = await resolveDistributionTargets({
      tx,
      orgId,
      projectId,
      meeting: current,
      request,
    });
    if (!targets.length) {
      throw new HttpError(
        400,
        "MEETING_DISTRIBUTION_RECIPIENT_REQUIRED",
        "Meeting distribution requires at least one recipient",
      );
    }

    const created = [];
    for (const target of targets) {
      created.push(
        await tx.meetingDistribution.create({
          data: {
            orgId,
            projectId,
            meetingId,
            activityId: target.activityId || current.activityId || null,
            recipientUserId: target.recipientUserId || null,
            projectPartyId: target.projectPartyId || null,
            recipientName: target.recipientName || null,
            recipientEmail: target.recipientEmail || null,
            companyName: target.companyName || null,
            channel: "email",
            status: "sent",
            message: request.message,
            sentById: userId || null,
            metadataJson: {
              meetingNumber: current.meetingNumber,
              source: "meeting_distribution",
            },
          },
        }),
      );
    }

    const meetingRow = await tx.meeting.update({
      where: { id: meetingId },
      data: {
        status: "distributed",
        distributedAt: new Date(),
        distributedById: userId || null,
        updatedById: userId || null,
      },
    });

    await recordMeetingAudit({
      tx,
      meeting: meetingRow,
      action: auditService.ACTIONS.STATUS_CHANGED,
      userId,
      userRole,
      oldMeeting: current,
      metadata: {
        event: "meeting.distributed",
        distributionCount: created.length,
        recipientUserIds: created
          .map((row) => row.recipientUserId)
          .filter(Boolean),
      },
    });

    const recipientUserIds = unique(
      created.map((row) => row.recipientUserId).filter(Boolean),
    );
    if (recipientUserIds.length) {
      await notificationService.createNotifications({
        tx,
        orgId,
        projectId,
        actorId: userId,
        recipientUserIds,
        type: "meeting",
        category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
        event: "meeting.distributed",
        title: `Meeting ${current.meetingNumber} distributed`,
        message: `${current.title} minutes were distributed.`,
        priority: "normal",
        actionUrl: `/projects/${projectId}?module=meetings&recordId=${meetingId}`,
        entityType: MEETING_ENTITY_TYPE,
        entityId: meetingId,
        dedupeKeyBase: `meeting:distributed:${meetingId}:${Date.now()}`,
        metadata: {
          meetingNumber: current.meetingNumber,
          distributionCount: created.length,
        },
      });
    }

    return { meeting: meetingRow, distributions: created };
  });

  return {
    meeting: serializeMeeting(
      await prisma.meeting.findUnique({
        where: { id: meeting.id },
        include: meetingInclude,
      }),
    ),
    distributionCount: distributions.length,
  };
};

const addMeetingComment = async ({
  orgId,
  projectId,
  meetingId,
  body,
  activityId = null,
  userId,
  userRole,
  projectAccess = null,
}) => {
  await assertAccess({
    orgId,
    projectId,
    userId,
    role: userRole,
    projectAccess,
  });
  const meeting = await getMeetingOrThrow({ orgId, projectId, meetingId });
  const text = trimToNull(body);
  if (!text) {
    throw new HttpError(
      400,
      "MEETING_COMMENT_REQUIRED",
      "Meeting comment is required",
    );
  }
  const linkedActivityId = trimToNull(activityId);

  return prisma.$transaction(async (tx) => {
    await ensureActivitiesInProject({
      tx,
      projectId,
      activityIds: [linkedActivityId],
    });

    const comment = await tx.meetingComment.create({
      data: {
        orgId,
        projectId,
        meetingId,
        activityId: linkedActivityId || null,
        authorId: userId || null,
        body: text,
      },
      include: {
        activity: { select: activitySelect },
        author: { select: userSelect },
      },
    });

    await recordMeetingAudit({
      tx,
      meeting,
      action: auditService.ACTIONS.UPDATED,
      userId,
      userRole,
      metadata: { event: "meeting.comment", commentId: comment.id },
    });

    return serializeComment(comment);
  });
};

const deleteMeeting = async ({
  orgId,
  projectId,
  meetingId,
  userId,
  userRole,
  projectAccess = null,
}) => {
  await assertAccess({
    orgId,
    projectId,
    userId,
    role: userRole,
    projectAccess,
  });
  const current = await getMeetingOrThrow({ orgId, projectId, meetingId });

  const archived = await prisma.$transaction(async (tx) => {
    const row = await tx.meeting.update({
      where: { id: meetingId },
      data: {
        status: "archived",
        archivedAt: new Date(),
        archivedBy: userId || null,
        updatedById: userId || null,
      },
    });
    await recordMeetingAudit({
      tx,
      meeting: row,
      action: auditService.ACTIONS.ARCHIVED,
      userId,
      userRole,
      oldMeeting: current,
    });
    return row;
  });

  return {
    id: archived.id,
    status: "archived",
    archived: true,
    deleted: false,
    archivedAt: toIso(archived.archivedAt),
  };
};

module.exports = {
  ACTION_PRIORITIES,
  ACTION_STATUSES,
  AGENDA_STATUSES,
  ATTENDANCE_STATUSES,
  MEETING_STATUSES,
  MEETING_TYPES,
  addMeetingComment,
  createMeeting,
  deleteMeeting,
  distributeMeeting,
  getMeetingById,
  listMeetings,
  serializeMeeting,
  updateMeeting,
};
