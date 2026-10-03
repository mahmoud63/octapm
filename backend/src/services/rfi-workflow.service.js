const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { assertPartyWorkflowAccess } = require("./company-party.service");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const { RECORD_TYPES, attachWorkflowDetailsToRecords } = require("./workflow-support.service");
const { recordWorkspacePath } = require("../utils/record-links");
const { createPdf, formatDate } = require("../utils/pdf-writer");

/**
 * RFI upgrade (OCTA-PM-RFI-016): manager, assignees and distribution,
 * ball in court, a response thread with one official answer per revision,
 * draft visibility, schedule-impact links, change-order conversion and a
 * PDF. The base record workflow stays in rfi.service; this module owns the
 * people and the thread and is called from there.
 */

const ASSIGNEE_ROLES = Object.freeze({ ASSIGNEE: "assignee", DISTRIBUTION: "distribution" });
const OPEN_STATUSES = Object.freeze(["draft", "open", "answered"]);
const MAX_PEOPLE = 20;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const person = (user) => (user ? { id: user.id, name: user.name, email: user.email || null } : null);

const rfiPath = ({ projectId, rfiId }) => recordWorkspacePath({ projectId, recordType: "rfi", recordId: rfiId });

// ─── People ───────────────────────────────────────────────────────────────

const validateUsers = async ({ tx = prisma, orgId, userIds }) => {
  const ids = uniqueIds(userIds);
  if (!ids.length) return [];
  if (ids.length > MAX_PEOPLE) throw new HttpError(400, "RFI_TOO_MANY_PEOPLE", `At most ${MAX_PEOPLE} people per list`);
  const rows = await tx.user.findMany({ where: { id: { in: ids }, orgId }, select: { id: true } });
  if (rows.length !== ids.length) throw new HttpError(404, "USER_NOT_FOUND", "One or more users were not found in this organisation");
  return ids;
};

const validateLocation = async ({ tx = prisma, projectId, locationId }) => {
  if (!locationId) return null;
  const row = await tx.location.findFirst({ where: { id: locationId, projectId }, select: { id: true } });
  if (!row) throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found");
  return row.id;
};

/** Replaces the assignee / distribution rows (only the lists that were sent). */
const syncPeople = async ({ tx = prisma, orgId, rfiId, assigneeUserIds, distributionUserIds, actorId = null }) => {
  const changes = { assigneesAdded: [], distributionAdded: [] };
  if (!tx.rfiAssignee?.findMany) return changes;
  for (const [role, ids, key] of [
    [ASSIGNEE_ROLES.ASSIGNEE, assigneeUserIds, "assigneesAdded"],
    [ASSIGNEE_ROLES.DISTRIBUTION, distributionUserIds, "distributionAdded"],
  ]) {
    if (ids === undefined) continue;
    const wanted = await validateUsers({ tx, orgId, userIds: Array.isArray(ids) ? ids : [] });
    const existing = await tx.rfiAssignee.findMany({ where: { rfiId, role }, select: { userId: true } });
    const current = existing.map((row) => row.userId);
    const removed = current.filter((id) => !wanted.includes(id));
    if (removed.length) await tx.rfiAssignee.deleteMany({ where: { rfiId, role, userId: { in: removed } } });
    for (const [index, userId] of wanted.entries()) {
      await tx.rfiAssignee.upsert({
        where: { rfiId_userId_role: { rfiId, userId, role } },
        create: { rfiId, userId, role, sortOrder: index, addedBy: actorId },
        update: { sortOrder: index },
      });
      if (!current.includes(userId)) changes[key].push(userId);
    }
  }
  return changes;
};

const loadPeople = async ({ tx = prisma, rfiId }) => {
  if (!tx.rfiAssignee?.findMany) return { assignees: [], distribution: [] };
  const rows = await tx.rfiAssignee.findMany({
    where: { rfiId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ role: "asc" }, { sortOrder: "asc" }],
  });
  return {
    assignees: rows.filter((row) => row.role === ASSIGNEE_ROLES.ASSIGNEE).map((row) => ({ userId: row.userId, ...person(row.user), sortOrder: row.sortOrder })),
    distribution: rows.filter((row) => row.role === ASSIGNEE_ROLES.DISTRIBUTION).map((row) => ({ userId: row.userId, ...person(row.user), sortOrder: row.sortOrder })),
  };
};

/**
 * Who holds the RFI: draft → creator; open → first assignee (else the
 * legacy assignee, else the manager); answered → manager (else approver,
 * else creator); closed / archived → nobody.
 */
const ballInCourtFor = (rfi, assignees = []) => {
  switch (rfi.status) {
    case "draft":
      return rfi.createdBy || rfi.managerUserId || null;
    case "open":
      return assignees[0]?.userId || rfi.assigneeUserId || rfi.managerUserId || rfi.ballInCourtUserId || null;
    case "answered":
      return rfi.managerUserId || rfi.approverUserId || rfi.createdBy || rfi.ballInCourtUserId || null;
    default:
      return null;
  }
};

const applyBallInCourt = async ({ tx = prisma, rfi }) => {
  const { assignees } = await loadPeople({ tx, rfiId: rfi.id });
  const ballInCourtUserId = ballInCourtFor(rfi, assignees);
  if (ballInCourtUserId === (rfi.ballInCourtUserId || null)) return rfi;
  return tx.rfi.update({ where: { id: rfi.id }, data: { ballInCourtUserId } });
};

// ─── Visibility ───────────────────────────────────────────────────────────

/** Drafts are private to their creator and manager. */
const withDraftVisibility = (where, viewerId) => {
  if (!viewerId) return where;
  return { AND: [where, { OR: [{ status: { not: "draft" } }, { createdBy: viewerId }, { managerUserId: viewerId }] }] };
};

const assertDraftVisible = (rfi, viewerId) => {
  if (rfi.status !== "draft" || !viewerId) return;
  if (rfi.createdBy === viewerId || rfi.managerUserId === viewerId) return;
  throw new HttpError(404, "RFI_NOT_FOUND", "RFI not found");
};

// ─── Notifications ────────────────────────────────────────────────────────

const notify = async ({ orgId, projectId, rfi, recipientUserIds, category, event, title, message, actorId = null, priority = "normal" }) => {
  const recipients = uniqueIds(recipientUserIds).filter((id) => id !== actorId);
  if (!recipients.length) return null;
  return notificationService.createNotifications({
    orgId,
    projectId,
    actorId,
    recipientUserIds: recipients,
    type: "rfi",
    category,
    event,
    title,
    message,
    priority,
    actionUrl: rfiPath({ projectId, rfiId: rfi.id }),
    entityType: "rfi",
    entityId: rfi.id,
    dedupeKeyBase: `rfi:${rfi.id}:${event}:${Date.now()}`,
    metadata: { ref: rfi.ref, status: rfi.status, revision: rfi.revision || 0 },
  });
};

const notifyAssigned = async ({ orgId, projectId, rfi, userIds, actorId }) =>
  notify({
    orgId,
    projectId,
    rfi,
    actorId,
    recipientUserIds: userIds,
    category: notificationService.NOTIFICATION_CATEGORIES.ASSIGNMENT,
    event: "rfi.assigned",
    title: `${rfi.ref} assigned to you: ${rfi.subject}`,
    message: [rfi.responseRequiredBy ? `response required by ${formatDate(rfi.responseRequiredBy)}` : rfi.dueDate ? `due ${formatDate(rfi.dueDate)}` : null, rfi.priority !== "normal" ? `${rfi.priority} priority` : null].filter(Boolean).join(" · ") || rfi.subject,
    priority: rfi.priority === "urgent" ? "high" : "normal",
  });

const notifyDistribution = async ({ orgId, projectId, rfi, userIds, actorId, event = "rfi.distributed", title = null }) =>
  notify({
    orgId,
    projectId,
    rfi,
    actorId,
    recipientUserIds: userIds,
    category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
    event,
    title: title || `${rfi.ref} shared with you: ${rfi.subject}`,
    message: rfi.question ? rfi.question.slice(0, 200) : rfi.subject,
  });

// ─── Detail ───────────────────────────────────────────────────────────────

const responseInclude = { author: { select: { id: true, name: true, email: true } } };

const serializeResponse = (row) => ({
  id: row.id,
  rfiId: row.rfiId,
  body: row.body,
  isOfficial: row.isOfficial,
  revision: row.revision,
  authorId: row.authorId || null,
  author: person(row.author),
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const isOverdue = (rfi) => {
  if (!OPEN_STATUSES.includes(rfi.status)) return false;
  const due = rfi.responseRequiredBy || rfi.dueDate;
  return Boolean(due) && new Date(due).getTime() < Date.now();
};

/**
 * Every by-id RFI path reads the record through here. With the caller's
 * `projectAccess` the party routing the list applies is applied here too: a
 * party member reaches only an RFI routed to their company (owner, reviewer or
 * approver party), whatever the route — detail, thread, export, assistant,
 * change event (certification findings L42 / FILES-X1). Internal callers that
 * already decided pass none.
 */
const loadRfi = async ({ orgId, projectId, rfiId, projectAccess = null }, tx = prisma) => {
  const project = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  const rfi = await tx.rfi.findFirst({
    where: { id: rfiId, projectId },
    include: {
      managerUser: { select: { id: true, name: true, email: true } },
      location: { select: { id: true, name: true, code: true, path: true } },
      activity: { select: { id: true, name: true } },
    },
  });
  if (!rfi) throw new HttpError(404, "RFI_NOT_FOUND", "RFI not found");
  assertPartyWorkflowAccess({ projectAccess, record: rfi });
  return { project, rfi };
};

/** The caller may open this RFI at all: its party routing and draft privacy (the assistant's guard). */
const assertRfiVisible = async ({ orgId, projectId, rfiId, projectAccess = null, viewerId = null }) => {
  const { rfi } = await loadRfi({ orgId, projectId, rfiId, projectAccess });
  assertDraftVisible(rfi, viewerId);
  return { id: rfi.id };
};

const getRfi = async ({ orgId, projectId, rfiId, viewerId = null, projectAccess = null }) => {
  const { rfi } = await loadRfi({ orgId, projectId, rfiId, projectAccess });
  assertDraftVisible(rfi, viewerId);
  const [people, responses, workflow] = await Promise.all([
    loadPeople({ rfiId }),
    prisma.rfiResponse?.findMany ? prisma.rfiResponse.findMany({ where: { rfiId }, include: responseInclude, orderBy: { createdAt: "asc" } }) : [],
    attachWorkflowDetailsToRecords({ projectId, recordType: RECORD_TYPES.RFI, records: [rfi] }),
  ]);
  const [enriched] = workflow;
  const serializedResponses = responses.map(serializeResponse);
  return {
    ...enriched,
    costImpactAmount: rfi.costImpactAmount === null || rfi.costImpactAmount === undefined ? null : Number(rfi.costImpactAmount),
    manager: person(rfi.managerUser),
    location: rfi.location || null,
    activity: rfi.activity || null,
    assignees: people.assignees,
    distribution: people.distribution,
    responses: serializedResponses,
    officialResponse: serializedResponses.find((row) => row.id === rfi.officialResponseId) || serializedResponses.find((row) => row.isOfficial) || null,
    isOverdue: isOverdue(rfi),
    path: rfiPath({ projectId, rfiId: rfi.id }),
  };
};

// ─── Responses ────────────────────────────────────────────────────────────

const listResponses = async ({ orgId, projectId, rfiId, viewerId = null, projectAccess = null }) => {
  const { rfi } = await loadRfi({ orgId, projectId, rfiId, projectAccess });
  assertDraftVisible(rfi, viewerId);
  const rows = await prisma.rfiResponse.findMany({ where: { rfiId }, include: responseInclude, orderBy: { createdAt: "asc" } });
  return { items: rows.map(serializeResponse), officialResponseId: rfi.officialResponseId || null, revision: rfi.revision || 0 };
};

/** Creates the official-answer row for an answer that came through rfi.service.answerRfi. */
const recordOfficialResponse = async ({ tx = prisma, orgId, projectId, rfi, body, authorId = null }) => {
  if (!tx.rfiResponse?.create) return null;
  await tx.rfiResponse.updateMany({ where: { rfiId: rfi.id, isOfficial: true }, data: { isOfficial: false } });
  const row = await tx.rfiResponse.create({
    data: { orgId, projectId, rfiId: rfi.id, authorId, body, isOfficial: true, revision: rfi.revision || 0 },
    include: responseInclude,
  });
  await tx.rfi.update({ where: { id: rfi.id }, data: { officialResponseId: row.id } });
  return serializeResponse(row);
};

const addResponse = async ({ orgId, projectId, rfiId, payload = {}, userId = null, userRole = null, projectAccess = null }) => {
  const body = trimOrNull(payload.body);
  if (!body) throw new HttpError(400, "RFI_RESPONSE_REQUIRED", "Write a response");
  const { rfi } = await loadRfi({ orgId, projectId, rfiId, projectAccess });
  assertDraftVisible(rfi, userId);
  if (rfi.status === "closed" || rfi.status === "archived") throw new HttpError(409, "RFI_ALREADY_CLOSED", "Reopen the RFI before responding");
  if (payload.isOfficial) {
    const rfiService = require("./rfi.service");
    await rfiService.answerRfi({ orgId, projectId, rfiId, payload: { response: body }, userId, userRole, projectAccess });
    return getRfi({ orgId, projectId, rfiId, viewerId: userId, projectAccess });
  }
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.rfiResponse.create({
      data: { orgId, projectId, rfiId, authorId: userId, body: body.slice(0, 20000), isOfficial: false, revision: rfi.revision || 0 },
      include: responseInclude,
    });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.RFI,
      entityId: rfiId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      summary: { ref: rfi.ref, subject: rfi.subject, status: rfi.status, response: "added", official: false },
      metadata: { source: "document_control.rfi", responseId: created.id },
    });
    return created;
  });
  const people = await loadPeople({ rfiId });
  await notify({
    orgId,
    projectId,
    rfi,
    actorId: userId,
    recipientUserIds: [rfi.managerUserId, rfi.createdBy, ...people.assignees.map((row) => row.userId)],
    category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
    event: "rfi.response",
    title: `${rfi.ref}: new response`,
    message: body.slice(0, 200),
  });
  return getRfi({ orgId, projectId, rfiId, viewerId: userId, projectAccess });
};

const updateResponse = async ({ orgId, projectId, rfiId, responseId, payload = {}, userId = null, userRole = null, projectAccess = null }) => {
  const { rfi } = await loadRfi({ orgId, projectId, rfiId, projectAccess });
  const existing = await prisma.rfiResponse.findFirst({ where: { id: responseId, rfiId } });
  if (!existing) throw new HttpError(404, "RFI_RESPONSE_NOT_FOUND", "Response not found");
  if (existing.authorId && existing.authorId !== userId && userRole !== "pm") throw new HttpError(403, "RFI_RESPONSE_NOT_YOURS", "Only the author can edit this response");
  const body = trimOrNull(payload.body);
  if (!body) throw new HttpError(400, "RFI_RESPONSE_REQUIRED", "Write a response");
  await prisma.$transaction(async (tx) => {
    await tx.rfiResponse.update({ where: { id: responseId }, data: { body: body.slice(0, 20000) } });
    if (existing.isOfficial) await tx.rfi.update({ where: { id: rfiId }, data: { response: body.slice(0, 20000) } });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.RFI,
      entityId: rfiId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      summary: { ref: rfi.ref, subject: rfi.subject, status: rfi.status, response: "edited", official: existing.isOfficial },
      metadata: { source: "document_control.rfi", responseId },
    });
  });
  return getRfi({ orgId, projectId, rfiId, viewerId: userId, projectAccess });
};

const deleteResponse = async ({ orgId, projectId, rfiId, responseId, userId = null, userRole = null, projectAccess = null }) => {
  const { rfi } = await loadRfi({ orgId, projectId, rfiId, projectAccess });
  const existing = await prisma.rfiResponse.findFirst({ where: { id: responseId, rfiId } });
  if (!existing) throw new HttpError(404, "RFI_RESPONSE_NOT_FOUND", "Response not found");
  if (existing.isOfficial) throw new HttpError(409, "RFI_RESPONSE_OFFICIAL", "The official response cannot be removed; reopen the RFI instead");
  if (existing.authorId && existing.authorId !== userId && userRole !== "pm") throw new HttpError(403, "RFI_RESPONSE_NOT_YOURS", "Only the author can remove this response");
  await prisma.$transaction(async (tx) => {
    await tx.rfiResponse.delete({ where: { id: responseId } });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.RFI,
      entityId: rfiId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      summary: { ref: rfi.ref, subject: rfi.subject, status: rfi.status, response: "removed" },
      metadata: { source: "document_control.rfi", responseId },
    });
  });
  return { deleted: true, id: responseId };
};

/** Promotes a thread response to the official answer (answers the RFI when open). */
const setOfficialResponse = async ({ orgId, projectId, rfiId, responseId, userId = null, userRole = null, projectAccess = null }) => {
  const { rfi } = await loadRfi({ orgId, projectId, rfiId, projectAccess });
  if (rfi.status === "closed" || rfi.status === "archived") throw new HttpError(409, "RFI_ALREADY_CLOSED", "Reopen the RFI before changing the official response");
  const target = await prisma.rfiResponse.findFirst({ where: { id: responseId, rfiId } });
  if (!target) throw new HttpError(404, "RFI_RESPONSE_NOT_FOUND", "Response not found");
  const rfiService = require("./rfi.service");
  if (rfi.status === "open" || rfi.status === "draft") {
    await rfiService.answerRfi({
      orgId,
      projectId,
      rfiId,
      payload: { response: target.body, answeredBy: target.authorId || userId, officialResponseId: responseId },
      userId,
      userRole,
      projectAccess,
    });
  } else {
    await rfiService.updateRfi({
      orgId,
      projectId,
      rfiId,
      payload: { response: target.body, officialResponseId: responseId, comment: "Official response changed" },
      userId,
      userRole,
      projectAccess,
    });
  }
  // The thread's flags follow the answer the RFI now carries: written only once
  // the answer was accepted, so a refused answer changes nothing (finding L42 —
  // a refused promotion used to leave the response flagged official).
  await prisma.$transaction(async (tx) => {
    await tx.rfiResponse.updateMany({ where: { rfiId, isOfficial: true }, data: { isOfficial: false } });
    await tx.rfiResponse.update({ where: { id: responseId }, data: { isOfficial: true, revision: rfi.revision || 0 } });
  });
  return getRfi({ orgId, projectId, rfiId, viewerId: userId, projectAccess });
};

// ─── Schedule impact and change events ───────────────────────────────────

/** When an RFI with an approved schedule impact closes, the activity link carries the days. */
const applyScheduleImpact = async ({ tx = prisma, projectId, rfi }) => {
  if (!tx.workflowActivityLink?.upsert) return null;
  const days = Number(rfi.scheduleImpact) || 0;
  if (!rfi.scheduleImpactFlag || days <= 0 || !rfi.activityId) return null;
  return tx.workflowActivityLink.upsert({
    where: {
      recordType_recordId_activityId_relationType: { recordType: RECORD_TYPES.RFI, recordId: rfi.id, activityId: rfi.activityId, relationType: "schedule_impact" },
    },
    create: { projectId, recordType: RECORD_TYPES.RFI, recordId: rfi.id, activityId: rfi.activityId, relationType: "schedule_impact", scheduleImpactDays: days, notes: `Approved with ${rfi.ref}` },
    update: { scheduleImpactDays: days },
  });
};

const convertToChangeEvent = async ({ orgId, projectId, rfiId, payload = {}, userId = null, userRole = null, projectAccess = null }) => {
  const { rfi } = await loadRfi({ orgId, projectId, rfiId, projectAccess });
  if (rfi.changeOrderId) throw new HttpError(409, "RFI_ALREADY_CONVERTED", "This RFI already has a change event");
  const changeOrderService = require("./change-order.service");
  // The official response is one of THIS RFI's responses (certification finding L9: an id from
  // another company's RFI used to be dereferenced here and its text copied into the change order).
  const official = rfi.officialResponseId && prisma.rfiResponse?.findFirst ? await prisma.rfiResponse.findFirst({ where: { id: rfi.officialResponseId, rfiId: rfi.id } }) : null;
  const description = trimOrNull(payload.description) || [`${rfi.ref}: ${rfi.subject}`, rfi.question ? `Question: ${rfi.question}` : null, official?.body || rfi.response ? `Response: ${official?.body || rfi.response}` : null].filter(Boolean).join("\n\n");
  const changeOrder = await changeOrderService.createChangeOrder({
    orgId,
    projectId,
    userId,
    userRole,
    payload: {
      description,
      category: trimOrNull(payload.category) || "rfi",
      value: payload.value !== undefined && payload.value !== null ? payload.value : rfi.costImpactAmount !== null && rfi.costImpactAmount !== undefined ? Number(rfi.costImpactAmount) : 0,
      scheduleImpact: Number(rfi.scheduleImpact) || 0,
      scheduleImpactSummary: rfi.scheduleImpactFlag ? `${rfi.scheduleImpact} day(s) per ${rfi.ref}` : null,
      costImpactSummary: rfi.costImpact ? `Cost impact flagged on ${rfi.ref}` : null,
      activityId: rfi.activityId || null,
      raisedBy: rfi.raisedBy || null,
    },
  });
  await prisma.$transaction(async (tx) => {
    await tx.rfi.update({ where: { id: rfiId }, data: { changeOrderId: changeOrder.id } });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.RFI,
      entityId: rfiId,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      summary: { ref: rfi.ref, subject: rfi.subject, status: rfi.status, convertedTo: changeOrder.ref },
      metadata: { source: "document_control.rfi", changeOrderId: changeOrder.id },
    });
  });
  return { changeOrder, rfi: await getRfi({ orgId, projectId, rfiId, viewerId: userId, projectAccess }) };
};

// ─── PDF ──────────────────────────────────────────────────────────────────

const exportRfiPdf = async ({ orgId, projectId, rfiId, viewerId = null, projectAccess = null }) => {
  const { project } = await loadRfi({ orgId, projectId, rfiId, projectAccess });
  const rfi = await getRfi({ orgId, projectId, rfiId, viewerId, projectAccess });
  const doc = createPdf({ title: `${rfi.ref} ${rfi.subject}`, author: project.name, pageSize: "A4", footer: `${project.name} · ${rfi.ref} · rev ${rfi.revision || 0} · generated ${formatDate(new Date())}` });
  doc.heading(`${rfi.ref} · ${rfi.subject}`);
  doc.keyValues([
    ["Status", `${rfi.status}${rfi.revision ? ` · revision ${rfi.revision}` : ""}`],
    ["Priority", rfi.priority],
    ["Discipline", rfi.discipline || "—"],
    ["Spec section", rfi.specSection || "—"],
    ["Activity", rfi.activity?.name || "—"],
    ["Location", rfi.location?.name || "—"],
    ["Manager", rfi.manager?.name || "—"],
    ["Assignees", rfi.assignees.map((row) => row.name).join(", ") || rfi.assigneeUser?.name || "—"],
    ["Distribution", rfi.distribution.map((row) => row.name).join(", ") || "—"],
    ["Raised", `${rfi.raisedBy || rfi.ownerUser?.name || "—"} · ${formatDate(rfi.raisedDate || rfi.createdAt)}`],
    ["Response required by", formatDate(rfi.responseRequiredBy || rfi.dueDate)],
    ["Answered", rfi.answeredDate ? formatDate(rfi.answeredDate) : "—"],
    ["Cost impact", rfi.costImpact ? `Yes${rfi.costImpactAmount !== null ? ` · ${rfi.costImpactAmount}` : ""}` : "No"],
    ["Schedule impact", rfi.scheduleImpactFlag ? `Yes · ${rfi.scheduleImpact} day(s)` : "No"],
  ]);
  doc.heading("Question", { level: 2 });
  doc.paragraph(rfi.question || "—");
  doc.heading("Official response", { level: 2 });
  if (rfi.officialResponse) {
    doc.paragraph(rfi.officialResponse.body);
    doc.paragraph(`${rfi.officialResponse.author?.name || rfi.answeredBy || "—"} · ${formatDate(rfi.officialResponse.createdAt)}`, { size: 8, color: "0.3 0.3 0.3" });
  } else {
    doc.paragraph(rfi.response || "Not yet answered.");
  }
  const thread = rfi.responses.filter((row) => !row.isOfficial);
  if (thread.length) {
    doc.heading("Discussion", { level: 2 });
    doc.table({
      columns: [
        { key: (row) => formatDate(row.createdAt), label: "Date", width: 60 },
        { key: (row) => row.author?.name || "—", label: "From", width: 110 },
        { key: "body", label: "Response", width: 1 },
      ],
      rows: thread,
      size: 8.5,
    });
  }
  if (rfi.attachments?.length) {
    doc.heading("Attachments", { level: 2 });
    doc.table({
      columns: [
        { key: (row) => row.fileName || row.filename || "", label: "File", width: 0.7 },
        { key: (row) => row.role || "", label: "Role", width: 0.3 },
      ],
      rows: rfi.attachments,
      size: 8.5,
    });
  }
  const fileName = `${rfi.ref.toLowerCase()}-${rfi.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "rfi"}.pdf`;
  return { buffer: doc.render(), fileName };
};

module.exports = {
  ASSIGNEE_ROLES,
  MAX_PEOPLE,
  ballInCourtFor,
  applyBallInCourt,
  syncPeople,
  loadPeople,
  validateUsers,
  validateLocation,
  withDraftVisibility,
  assertDraftVisible,
  assertRfiVisible,
  notifyAssigned,
  notifyDistribution,
  getRfi,
  listResponses,
  recordOfficialResponse,
  addResponse,
  updateResponse,
  deleteResponse,
  setOfficialResponse,
  applyScheduleImpact,
  convertToChangeEvent,
  exportRfiPdf,
  isOverdue,
};
