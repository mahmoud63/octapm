const fs = require("fs/promises");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const fileStorageService = require("./file-storage.service");
const { sendEmail } = require("./email.service");
const { isPartyScopedAccess } = require("./company-party.service");
const {
  RECORD_TYPES,
  attachWorkflowDetailsToRecords,
  syncWorkflowReferences,
} = require("./workflow-support.service");
const { recordWorkspacePath } = require("../utils/record-links");
const { createPdf, formatDate } = require("../utils/pdf-writer");

/**
 * Punch list (OCTA-FLD-PUNCH-013).
 *
 * States: draft → open → ready_for_review → closed, with in_dispute from
 * open / ready_for_review and void from anything not closed. Only the final
 * approver (when one is set) closes; reopening needs a reason and counts.
 * Every change lands in the PunchItemEvent ledger and the audit log.
 * Subcontractor users only see items assigned to their company (or that
 * they raised); internal roles see everything.
 */

const STATUS = Object.freeze({
  DRAFT: "draft",
  OPEN: "open",
  READY: "ready_for_review",
  CLOSED: "closed",
  DISPUTE: "in_dispute",
  VOID: "void",
});
const STATUSES = Object.values(STATUS);
const PRIORITIES = ["low", "normal", "high", "urgent"];
const ACTIONS = ["open", "ready_for_review", "close", "reopen", "dispute", "resolve_dispute", "void"];
const OPEN_STATUSES = [STATUS.DRAFT, STATUS.OPEN, STATUS.READY, STATUS.DISPUTE];
const MAX_BULK = 100;
const MAX_LIST = 1000;
const MAX_EXPORT_PHOTOS = 40;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => value?.toISOString?.() || value || null;

const toDate = (value) => {
  if (value === null || value === "") return null;
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const uniqueIds = (values) => [...new Set(values.filter(Boolean))];

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, name: true },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

// ─── Visibility ───────────────────────────────────────────────────────────

const companyIdsFor = (viewer) =>
  uniqueIds((viewer?.projectAccess?.partyAccess || []).map((party) => party.companyId));

/** Party-scoped users (subcontractors) see their company's items and their own. */
const visibilityWhere = (viewer) => {
  if (!viewer || !isPartyScopedAccess(viewer.projectAccess || {})) return null;
  const companyIds = companyIdsFor(viewer);
  return {
    OR: [
      ...(companyIds.length ? [{ assigneeCompanyId: { in: companyIds } }] : []),
      ...(viewer.id ? [{ createdBy: viewer.id }, { assigneeUserId: viewer.id }] : []),
    ],
  };
};

const assertVisible = (item, viewer) => {
  const scope = visibilityWhere(viewer);
  if (!scope) return;
  const companyIds = companyIdsFor(viewer);
  const visible =
    (item.assigneeCompanyId && companyIds.includes(item.assigneeCompanyId)) ||
    item.createdBy === viewer.id ||
    item.assigneeUserId === viewer.id;
  if (!visible) throw new HttpError(404, "PUNCH_ITEM_NOT_FOUND", "Punch item not found");
};

// ─── Serialization ────────────────────────────────────────────────────────

const include = {
  assigneeCompany: { select: { id: true, name: true } },
  assigneeUser: { select: { id: true, name: true, email: true } },
  managerUser: { select: { id: true, name: true, email: true } },
  finalApproverUser: { select: { id: true, name: true, email: true } },
  ballInCourtUser: { select: { id: true, name: true } },
  location: { select: { id: true, name: true, code: true, path: true } },
  sheet: { select: { id: true, number: true, title: true } },
  activity: { select: { id: true, name: true, activityCode: true } },
};

const person = (user) => (user ? { id: user.id, name: user.name, email: user.email || null } : null);

const isOverdue = (item) =>
  Boolean(item.dueDate) && OPEN_STATUSES.includes(item.status) && new Date(item.dueDate).getTime() < Date.now();

const serializeItem = (item) => ({
  id: item.id,
  projectId: item.projectId,
  number: item.number,
  ref: item.ref,
  title: item.title,
  description: item.description || null,
  status: item.status,
  priority: item.priority,
  trade: item.trade || null,
  activityId: item.activityId || null,
  activity: item.activity ? { id: item.activity.id, name: item.activity.name, code: item.activity.activityCode || null } : null,
  locationId: item.locationId || null,
  location: item.location ? { id: item.location.id, name: item.location.name, code: item.location.code || null, path: item.location.path } : null,
  locationText: item.locationText || null,
  sheetId: item.sheetId || null,
  sheet: item.sheet ? { id: item.sheet.id, number: item.sheet.number, title: item.sheet.title } : null,
  assigneeCompanyId: item.assigneeCompanyId || null,
  assigneeCompany: item.assigneeCompany ? { id: item.assigneeCompany.id, name: item.assigneeCompany.name } : null,
  assigneeUserId: item.assigneeUserId || null,
  assigneeUser: person(item.assigneeUser),
  managerUserId: item.managerUserId || null,
  managerUser: person(item.managerUser),
  finalApproverUserId: item.finalApproverUserId || null,
  finalApproverUser: person(item.finalApproverUser),
  ballInCourtUserId: item.ballInCourtUserId || null,
  ballInCourtUser: item.ballInCourtUser ? { id: item.ballInCourtUser.id, name: item.ballInCourtUser.name } : null,
  dueDate: toIso(item.dueDate),
  isOverdue: isOverdue(item),
  daysOverdue: isOverdue(item) ? Math.floor((Date.now() - new Date(item.dueDate).getTime()) / 86_400_000) : 0,
  openedAt: toIso(item.openedAt),
  readyAt: toIso(item.readyAt),
  closedAt: toIso(item.closedAt),
  closedBy: item.closedBy || null,
  reopenCount: item.reopenCount || 0,
  disputeReason: item.disputeReason || null,
  distributedAt: toIso(item.distributedAt),
  legacyDefectId: item.legacyDefectId || null,
  createdBy: item.createdBy || null,
  updatedBy: item.updatedBy || null,
  createdAt: toIso(item.createdAt),
  updatedAt: toIso(item.updatedAt),
  path: recordWorkspacePath({ projectId: item.projectId, recordType: "punch_item", recordId: item.id }),
  attachments: item.attachments,
  attachmentRefs: item.attachmentRefs,
  activityLinks: item.activityLinks,
  history: item.history,
  approvalHistory: item.approvalHistory,
  revisions: item.revisions,
  dueAlert: item.dueAlert,
});

const serializeEvent = (event) => ({
  id: event.id,
  punchItemId: event.punchItemId,
  action: event.action,
  fromStatus: event.fromStatus || null,
  toStatus: event.toStatus || null,
  reason: event.reason || null,
  actorId: event.actorId || null,
  actorName: event.actorName || null,
  actorRole: event.actorRole || null,
  metadata: event.metadataJson || null,
  createdAt: toIso(event.createdAt),
});

const enrich = async ({ projectId, items }) => {
  const rows = await attachWorkflowDetailsToRecords({ projectId, recordType: RECORD_TYPES.PUNCH_ITEM, records: items });
  return rows.map(serializeItem);
};

// ─── Ledger + audit ───────────────────────────────────────────────────────

const addEvent = (tx, { orgId, projectId, punchItemId, action, fromStatus = null, toStatus = null, reason = null, actor = null, metadata = null }) =>
  tx.punchItemEvent.create({
    data: {
      orgId,
      projectId,
      punchItemId,
      action,
      fromStatus,
      toStatus,
      reason: trimOrNull(reason),
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      metadataJson: metadata || undefined,
    },
  });

const audit = ({ tx, orgId, projectId, item, action, actor, oldStatus = null, newStatus = null, reason = null, summary = {}, oldSummary = null, newSummary = null }) =>
  auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.PUNCH_ITEM,
    entityId: item.id,
    action,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    oldStatus,
    newStatus,
    reason,
    summary: { ref: item.ref, title: item.title, status: newStatus || item.status, ...summary },
    oldSummary,
    newSummary,
  });

const ballInCourtFor = (item) => {
  switch (item.status) {
    case STATUS.DRAFT:
      return item.createdBy || item.managerUserId || null;
    case STATUS.OPEN:
      return item.assigneeUserId || item.managerUserId || null;
    case STATUS.READY:
      return item.finalApproverUserId || item.managerUserId || null;
    case STATUS.DISPUTE:
      return item.managerUserId || item.createdBy || null;
    default:
      return null;
  }
};

const notify = async ({ orgId, projectId, item, recipientUserIds, category, event, title, message, actor, priority = "normal" }) =>
  notificationService.createNotifications({
    orgId,
    projectId,
    actorId: actor?.id || null,
    recipientUserIds: uniqueIds(recipientUserIds),
    type: "punch",
    category,
    event,
    title,
    message,
    priority,
    actionUrl: recordWorkspacePath({ projectId, recordType: "punch_item", recordId: item.id }),
    entityType: "punch_item",
    entityId: item.id,
    dedupeKeyBase: `punch:${item.id}:${event}:${Date.now()}`,
    metadata: { ref: item.ref, status: item.status },
  });

/** Active project members of a company (for distribution and notifications). */
const companyMemberIds = async ({ projectId, companyIds }) => {
  const ids = uniqueIds(companyIds);
  if (!ids.length || !prisma.projectPartyMember?.findMany) return [];
  const members = await prisma.projectPartyMember.findMany({
    where: { status: "active", projectParty: { projectId, status: "active", companyId: { in: ids } } },
    select: { userId: true },
  });
  return uniqueIds(members.map((member) => member.userId));
};

// ─── Create / update ──────────────────────────────────────────────────────

const normalizePayload = (payload = {}, { partial = false } = {}) => {
  const data = {};
  const set = (key, value) => {
    if (value !== undefined) data[key] = value;
  };
  if (!partial || payload.title !== undefined) {
    const title = trimOrNull(payload.title);
    if (!title) throw new HttpError(400, "PUNCH_TITLE_REQUIRED", "Give the punch item a title");
    data.title = title.slice(0, 200);
  }
  if (payload.description !== undefined) set("description", trimOrNull(payload.description));
  if (payload.priority !== undefined) {
    if (!PRIORITIES.includes(payload.priority)) throw new HttpError(400, "PUNCH_PRIORITY_INVALID", `Priority must be one of ${PRIORITIES.join(", ")}`);
    set("priority", payload.priority);
  }
  if (payload.trade !== undefined) set("trade", trimOrNull(payload.trade));
  if (payload.locationText !== undefined) set("locationText", trimOrNull(payload.locationText));
  if (payload.locationId !== undefined) set("locationId", payload.locationId || null);
  if (payload.sheetId !== undefined) set("sheetId", payload.sheetId || null);
  if (payload.activityId !== undefined) set("activityId", payload.activityId || null);
  if (payload.assigneeCompanyId !== undefined) set("assigneeCompanyId", payload.assigneeCompanyId || null);
  if (payload.assigneeUserId !== undefined) set("assigneeUserId", payload.assigneeUserId || null);
  if (payload.managerUserId !== undefined) set("managerUserId", payload.managerUserId || null);
  if (payload.finalApproverUserId !== undefined) set("finalApproverUserId", payload.finalApproverUserId || null);
  if (payload.dueDate !== undefined) set("dueDate", toDate(payload.dueDate) ?? null);
  return data;
};

const validateReferences = async ({ orgId, projectId, data }) => {
  const checks = [];
  if (data.locationId) checks.push(prisma.location.findFirst({ where: { id: data.locationId, projectId }, select: { id: true } }).then((row) => [row, "LOCATION_NOT_FOUND", "Location not found"]));
  if (data.sheetId) checks.push(prisma.sheet.findFirst({ where: { id: data.sheetId, projectId }, select: { id: true } }).then((row) => [row, "SHEET_NOT_FOUND", "Sheet not found"]));
  if (data.activityId) checks.push(prisma.activity.findFirst({ where: { id: data.activityId, projectId }, select: { id: true } }).then((row) => [row, "ACTIVITY_NOT_FOUND", "Activity not found"]));
  if (data.assigneeCompanyId) checks.push(prisma.company.findFirst({ where: { id: data.assigneeCompanyId, orgId }, select: { id: true } }).then((row) => [row, "COMPANY_NOT_FOUND", "Company not found"]));
  const userIds = uniqueIds([data.assigneeUserId, data.managerUserId, data.finalApproverUserId]);
  if (userIds.length) {
    checks.push(
      prisma.user.findMany({ where: { id: { in: userIds }, orgId }, select: { id: true } }).then((rows) => [rows.length === userIds.length ? rows : null, "USER_NOT_FOUND", "One or more users were not found"]),
    );
  }
  for (const [row, code, message] of await Promise.all(checks)) {
    if (!row) throw new HttpError(404, code, message);
  }
};

const nextNumber = async (tx, projectId) => {
  const result = await tx.punchItem.aggregate({ where: { projectId }, _max: { number: true } });
  return (result?._max?.number || 0) + 1;
};

const refFor = (number) => `PL-${String(number).padStart(3, "0")}`;

const createInTx = async (tx, { orgId, projectId, data, actor, initialStatus }) => {
  const status = initialStatus === STATUS.OPEN ? STATUS.OPEN : STATUS.DRAFT;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const number = (await nextNumber(tx, projectId)) + attempt;
    try {
      const item = await tx.punchItem.create({
        data: {
          orgId,
          projectId,
          number,
          ref: refFor(number),
          status,
          openedAt: status === STATUS.OPEN ? new Date() : null,
          createdBy: actor?.id || null,
          updatedBy: actor?.id || null,
          ...data,
        },
      });
      const withBall = await tx.punchItem.update({ where: { id: item.id }, data: { ballInCourtUserId: ballInCourtFor(item) }, include });
      await addEvent(tx, { orgId, projectId, punchItemId: item.id, action: "created", toStatus: status, actor });
      if (status === STATUS.OPEN) await addEvent(tx, { orgId, projectId, punchItemId: item.id, action: "opened", fromStatus: STATUS.DRAFT, toStatus: STATUS.OPEN, actor });
      await audit({ tx, orgId, projectId, item: withBall, action: auditService.ACTIONS.CREATED, actor, newStatus: status, summary: { priority: item.priority, assigneeCompanyId: item.assigneeCompanyId } });
      return withBall;
    } catch (error) {
      if (error?.code !== "P2002" || attempt === 2) throw error;
    }
  }
  throw new HttpError(500, "PUNCH_NUMBERING_FAILED", "Could not allocate a punch item number");
};

const afterOpenNotifications = async ({ orgId, projectId, item, actor }) => {
  const companyMembers = await companyMemberIds({ projectId, companyIds: [item.assigneeCompanyId] });
  await notify({
    orgId,
    projectId,
    item,
    actor,
    recipientUserIds: [item.assigneeUserId, item.managerUserId, ...companyMembers],
    category: notificationService.NOTIFICATION_CATEGORIES.ASSIGNMENT,
    event: "punch.opened",
    title: `${item.ref} assigned: ${item.title}`,
    message: [item.locationText || item.location?.name, item.dueDate ? `due ${formatDate(item.dueDate)}` : null, item.priority !== "normal" ? `${item.priority} priority` : null].filter(Boolean).join(" · ") || item.title,
    priority: item.priority === "urgent" ? "high" : "normal",
  });
};

const createPunchItem = async ({ orgId, projectId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const data = normalizePayload(payload);
  await validateReferences({ orgId, projectId, data });
  const initialStatus = payload.status === STATUS.OPEN ? STATUS.OPEN : STATUS.DRAFT;
  const item = await prisma.$transaction(async (tx) => {
    const created = await createInTx(tx, { orgId, projectId, data, actor, initialStatus });
    await syncWorkflowReferences({ tx, projectId, recordType: RECORD_TYPES.PUNCH_ITEM, recordId: created.id, payload, userId: actor?.id || null });
    return created;
  });
  if (item.status === STATUS.OPEN) await afterOpenNotifications({ orgId, projectId, item, actor });
  const [row] = await enrich({ projectId, items: [item] });
  return row;
};

const bulkCreatePunchItems = async ({ orgId, projectId, items = [], defaults = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, "PUNCH_ITEMS_REQUIRED", "Add at least one item");
  if (items.length > MAX_BULK) throw new HttpError(400, "PUNCH_BULK_TOO_LARGE", `Create at most ${MAX_BULK} items at once`);
  const prepared = items.map((entry) => normalizePayload({ ...defaults, ...entry }));
  await validateReferences({ orgId, projectId, data: normalizePayload({ title: "x", ...defaults }, { partial: true }) });
  const initialStatus = (defaults.status || items[0]?.status) === STATUS.OPEN ? STATUS.OPEN : STATUS.DRAFT;
  const created = await prisma.$transaction(async (tx) => {
    const rows = [];
    for (const data of prepared) rows.push(await createInTx(tx, { orgId, projectId, data, actor, initialStatus }));
    return rows;
  });
  if (initialStatus === STATUS.OPEN) {
    for (const item of created) await afterOpenNotifications({ orgId, projectId, item, actor });
  }
  return { items: await enrich({ projectId, items: created }), created: created.length };
};

const getPunchItem = async ({ orgId, projectId, itemId, viewer = null }) => {
  const item = await prisma.punchItem.findFirst({ where: { id: itemId, orgId, projectId }, include });
  if (!item) throw new HttpError(404, "PUNCH_ITEM_NOT_FOUND", "Punch item not found");
  assertVisible(item, viewer);
  const events = await prisma.punchItemEvent.findMany({ where: { punchItemId: item.id }, orderBy: { createdAt: "asc" } });
  const actorIds = uniqueIds(events.map((event) => event.actorId));
  const users = actorIds.length && prisma.user?.findMany ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  const [row] = await enrich({ projectId, items: [item] });
  return { ...row, events: events.map((event) => serializeEvent({ ...event, actorName: names.get(event.actorId) || null })) };
};

const updatePunchItem = async ({ orgId, projectId, itemId, payload = {}, actor = null }) => {
  const existing = await prisma.punchItem.findFirst({ where: { id: itemId, orgId, projectId }, include });
  if (!existing) throw new HttpError(404, "PUNCH_ITEM_NOT_FOUND", "Punch item not found");
  assertVisible(existing, actor);
  if ([STATUS.CLOSED, STATUS.VOID].includes(existing.status)) {
    throw new HttpError(409, "PUNCH_ITEM_LOCKED", `A ${existing.status} item cannot be edited; reopen it first`);
  }
  const data = normalizePayload(payload, { partial: true });
  await validateReferences({ orgId, projectId, data });
  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.punchItem.update({ where: { id: existing.id }, data: { ...data, updatedBy: actor?.id || null }, include });
    const withBall = await tx.punchItem.update({ where: { id: existing.id }, data: { ballInCourtUserId: ballInCourtFor(updated) }, include });
    const assignmentChanged = ["assigneeCompanyId", "assigneeUserId", "managerUserId", "finalApproverUserId"].some((field) => data[field] !== undefined && data[field] !== existing[field]);
    await addEvent(tx, { orgId, projectId, punchItemId: existing.id, action: assignmentChanged ? "assigned" : "updated", actor, metadata: { fields: Object.keys(data) } });
    await syncWorkflowReferences({ tx, projectId, recordType: RECORD_TYPES.PUNCH_ITEM, recordId: existing.id, payload, userId: actor?.id || null });
    await audit({
      tx,
      orgId,
      projectId,
      item: withBall,
      action: auditService.ACTIONS.UPDATED,
      actor,
      oldSummary: { title: existing.title, priority: existing.priority, dueDate: existing.dueDate, assigneeCompanyId: existing.assigneeCompanyId, assigneeUserId: existing.assigneeUserId },
      newSummary: { title: withBall.title, priority: withBall.priority, dueDate: withBall.dueDate, assigneeCompanyId: withBall.assigneeCompanyId, assigneeUserId: withBall.assigneeUserId },
    });
    return { withBall, assignmentChanged };
  });
  if (item.assignmentChanged && item.withBall.status === STATUS.OPEN) {
    await afterOpenNotifications({ orgId, projectId, item: item.withBall, actor });
  }
  const [row] = await enrich({ projectId, items: [item.withBall] });
  return row;
};

const deletePunchItem = async ({ orgId, projectId, itemId, actor = null }) => {
  const existing = await prisma.punchItem.findFirst({ where: { id: itemId, orgId, projectId } });
  if (!existing) throw new HttpError(404, "PUNCH_ITEM_NOT_FOUND", "Punch item not found");
  if (existing.status !== STATUS.DRAFT) {
    throw new HttpError(409, "PUNCH_ITEM_NOT_DRAFT", "Only draft items can be deleted; void the item instead");
  }
  await prisma.punchItem.delete({ where: { id: existing.id } });
  await audit({ orgId, projectId, item: existing, action: auditService.ACTIONS.DELETED, actor, oldStatus: existing.status });
  return { deleted: true, id: existing.id };
};

// ─── State machine ────────────────────────────────────────────────────────

const TRANSITION_RULES = Object.freeze({
  open: { from: [STATUS.DRAFT], to: STATUS.OPEN, event: "opened" },
  ready_for_review: { from: [STATUS.OPEN], to: STATUS.READY, event: "ready_for_review" },
  close: { from: [STATUS.READY, STATUS.OPEN], to: STATUS.CLOSED, event: "closed" },
  reopen: { from: [STATUS.CLOSED, STATUS.READY], to: STATUS.OPEN, event: "reopened", reasonRequired: true },
  dispute: { from: [STATUS.OPEN, STATUS.READY], to: STATUS.DISPUTE, event: "disputed", reasonRequired: true },
  resolve_dispute: { from: [STATUS.DISPUTE], to: STATUS.OPEN, event: "dispute_resolved" },
  void: { from: [STATUS.DRAFT, STATUS.OPEN, STATUS.READY, STATUS.DISPUTE], to: STATUS.VOID, event: "voided", reasonRequired: true },
});

const transitionPunchItem = async ({ orgId, projectId, itemId, action, reason = null, actor = null }) => {
  const rule = TRANSITION_RULES[action];
  if (!rule) throw new HttpError(400, "PUNCH_ACTION_INVALID", `Unknown action: ${action}`);
  const existing = await prisma.punchItem.findFirst({ where: { id: itemId, orgId, projectId }, include });
  if (!existing) throw new HttpError(404, "PUNCH_ITEM_NOT_FOUND", "Punch item not found");
  assertVisible(existing, actor);
  if (!rule.from.includes(existing.status)) {
    throw new HttpError(409, "PUNCH_TRANSITION_INVALID", `Cannot ${action.replace(/_/g, " ")} an item that is ${existing.status.replace(/_/g, " ")}`);
  }
  const text = trimOrNull(reason);
  if (rule.reasonRequired && !text) throw new HttpError(400, "PUNCH_REASON_REQUIRED", "Give a reason");
  if (action === "close" && existing.finalApproverUserId && existing.finalApproverUserId !== actor?.id) {
    throw new HttpError(403, "PUNCH_FINAL_APPROVER_ONLY", `Only ${existing.finalApproverUser?.name || "the final approver"} can close this item`);
  }

  const now = new Date();
  const data = { status: rule.to, updatedBy: actor?.id || null };
  if (rule.to === STATUS.OPEN) {
    data.openedAt = existing.openedAt || now;
    data.readyAt = null;
    data.closedAt = null;
    data.closedBy = null;
    if (action === "resolve_dispute") data.disputeReason = null;
    if (action === "reopen") data.reopenCount = (existing.reopenCount || 0) + 1;
  }
  if (rule.to === STATUS.READY) data.readyAt = now;
  if (rule.to === STATUS.CLOSED) {
    data.closedAt = now;
    data.closedBy = actor?.id || null;
  }
  if (rule.to === STATUS.DISPUTE) data.disputeReason = text;

  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.punchItem.update({ where: { id: existing.id }, data, include });
    const withBall = await tx.punchItem.update({ where: { id: existing.id }, data: { ballInCourtUserId: ballInCourtFor(updated) }, include });
    await addEvent(tx, { orgId, projectId, punchItemId: existing.id, action: rule.event, fromStatus: existing.status, toStatus: rule.to, reason: text, actor });
    await audit({ tx, orgId, projectId, item: withBall, action: auditService.ACTIONS.STATUS_CHANGED, actor, oldStatus: existing.status, newStatus: rule.to, reason: text });
    return withBall;
  });

  const recipients = {
    open: [item.assigneeUserId, item.managerUserId],
    ready_for_review: [item.finalApproverUserId, item.managerUserId, item.createdBy],
    close: [item.assigneeUserId, item.managerUserId, item.createdBy],
    reopen: [item.assigneeUserId, item.managerUserId],
    dispute: [item.managerUserId, item.createdBy, item.finalApproverUserId],
    resolve_dispute: [item.assigneeUserId, item.managerUserId],
    void: [item.assigneeUserId, item.managerUserId],
  }[action];
  const category =
    action === "ready_for_review"
      ? notificationService.NOTIFICATION_CATEGORIES.APPROVAL
      : action === "open" || action === "reopen"
        ? notificationService.NOTIFICATION_CATEGORIES.ASSIGNMENT
        : notificationService.NOTIFICATION_CATEGORIES.QUALITY;
  const titles = {
    open: `${item.ref} assigned: ${item.title}`,
    ready_for_review: `${item.ref} ready for review`,
    close: `${item.ref} closed`,
    reopen: `${item.ref} reopened`,
    dispute: `${item.ref} in dispute`,
    resolve_dispute: `${item.ref} dispute resolved`,
    void: `${item.ref} voided`,
  };
  const companyMembers = action === "open" || action === "reopen" ? await companyMemberIds({ projectId, companyIds: [item.assigneeCompanyId] }) : [];
  await notify({
    orgId,
    projectId,
    item,
    actor,
    recipientUserIds: [...recipients, ...companyMembers],
    category,
    event: `punch.${rule.event}`,
    title: titles[action],
    message: [item.title, text ? `Reason: ${text}` : null].filter(Boolean).join(" — "),
    priority: action === "ready_for_review" || item.priority === "urgent" ? "high" : "normal",
  });

  const [row] = await enrich({ projectId, items: [item] });
  return row;
};

// ─── Lists, summaries, exports ───────────────────────────────────────────

const buildWhere = async ({ orgId, projectId, filters = {}, viewer = null }) => {
  const where = { orgId, projectId };
  const status = filters.status || null;
  if (status && status !== "all") {
    const list = String(status).split(",").map((value) => value.trim()).filter((value) => STATUSES.includes(value));
    if (list.length) where.status = list.length === 1 ? list[0] : { in: list };
  } else if (!status) {
    where.status = { not: STATUS.VOID };
  }
  if (filters.assigneeCompanyId) where.assigneeCompanyId = filters.assigneeCompanyId;
  if (filters.assigneeUserId) where.assigneeUserId = filters.assigneeUserId;
  if (filters.managerUserId) where.managerUserId = filters.managerUserId;
  if (filters.finalApproverUserId) where.finalApproverUserId = filters.finalApproverUserId;
  if (filters.ballInCourtUserId) where.ballInCourtUserId = filters.ballInCourtUserId;
  if (filters.sheetId) where.sheetId = filters.sheetId;
  if (trimOrNull(filters.trade)) where.trade = { equals: filters.trade.trim(), mode: "insensitive" };
  if (filters.priority && PRIORITIES.includes(filters.priority)) where.priority = filters.priority;
  if (filters.overdue === true || filters.overdue === "true") {
    where.dueDate = { lt: new Date() };
    where.status = { in: OPEN_STATUSES };
  }
  if (filters.locationId) {
    const location = await prisma.location.findFirst({ where: { id: filters.locationId, projectId }, select: { path: true } });
    if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found");
    where.location = { path: { startsWith: location.path } };
  }
  const and = [];
  if (trimOrNull(filters.search)) {
    const search = filters.search.trim();
    and.push({ OR: [{ ref: { contains: search, mode: "insensitive" } }, { title: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }, { locationText: { contains: search, mode: "insensitive" } }] });
  }
  const scope = visibilityWhere(viewer);
  if (scope) and.push(scope);
  if (and.length) where.AND = and;
  return where;
};

const summarize = (items) => {
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  const byCompany = new Map();
  const byTrade = new Map();
  let overdue = 0;
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    if (isOverdue(item)) overdue += 1;
    const company = item.assigneeCompany?.name || "Unassigned";
    const entry = byCompany.get(company) || { company, total: 0, open: 0, overdue: 0 };
    entry.total += 1;
    if (OPEN_STATUSES.includes(item.status)) entry.open += 1;
    if (isOverdue(item)) entry.overdue += 1;
    byCompany.set(company, entry);
    const trade = item.trade || "Unassigned";
    byTrade.set(trade, (byTrade.get(trade) || 0) + 1);
  }
  return {
    total: items.length,
    open: items.filter((item) => OPEN_STATUSES.includes(item.status)).length,
    overdue,
    byStatus,
    byCompany: [...byCompany.values()].sort((a, b) => b.open - a.open),
    byTrade: [...byTrade.entries()].map(([trade, count]) => ({ trade, count })).sort((a, b) => b.count - a.count),
  };
};

const listPunchItems = async ({ orgId, projectId, filters = {}, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const where = await buildWhere({ orgId, projectId, filters, viewer });
  const items = await prisma.punchItem.findMany({
    where,
    include,
    orderBy: [{ number: "desc" }],
    take: Math.min(Math.max(Number(filters.limit) || MAX_LIST, 1), MAX_LIST),
  });
  return { items: await enrich({ projectId, items }), summary: summarize(items) };
};

const distributePunchItems = async ({ orgId, projectId, itemIds = [], companyIds = [], userIds = [], message = null, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const where = { orgId, projectId };
  if (itemIds.length) where.id = { in: itemIds };
  else {
    where.status = { in: [STATUS.OPEN, STATUS.READY, STATUS.DISPUTE] };
    if (companyIds.length) where.assigneeCompanyId = { in: companyIds };
  }
  const items = await prisma.punchItem.findMany({ where, include, orderBy: [{ number: "asc" }] });
  if (!items.length) throw new HttpError(400, "PUNCH_NOTHING_TO_DISTRIBUTE", "No items match");

  const targetCompanies = companyIds.length ? companyIds : uniqueIds(items.map((item) => item.assigneeCompanyId));
  const recipientIds = uniqueIds([
    ...userIds,
    ...(await companyMemberIds({ projectId, companyIds: targetCompanies })),
    ...items.map((item) => item.assigneeUserId),
  ]);
  if (!recipientIds.length) throw new HttpError(400, "PUNCH_NO_RECIPIENTS", "Nobody to send to: assign a company or user first");
  const recipients = await prisma.user.findMany({ where: { id: { in: recipientIds }, orgId, status: "active" }, select: { id: true, name: true, email: true } });

  const baseUrl = (process.env.WEB_APP_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
  const lines = items.map((item) =>
    `${item.ref}  ${item.title}${item.locationText || item.location?.name ? ` — ${item.locationText || item.location?.name}` : ""}${item.dueDate ? ` (due ${formatDate(item.dueDate)})` : ""} [${item.status.replace(/_/g, " ")}]`,
  );
  const subject = `Punch list: ${items.length} item${items.length === 1 ? "" : "s"} on ${project.name}`;
  const body = [
    message ? `${message}\n` : null,
    `${items.length} punch item${items.length === 1 ? "" : "s"} for your attention on ${project.name}:`,
    "",
    ...lines,
    "",
    baseUrl ? `Open the punch list: ${baseUrl}${recordWorkspacePath({ projectId, recordType: "punch_item" })}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const results = [];
  for (const recipient of recipients) {
    if (!recipient.email) continue;
    try {
      await sendEmail({ to: recipient.email, subject, body, metadata: { kind: "punch_distribution", projectId, count: items.length } });
      results.push({ userId: recipient.id, email: recipient.email, delivered: true });
    } catch (error) {
      results.push({ userId: recipient.id, email: recipient.email, delivered: false, error: error?.message || "send_failed" });
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.punchItem.updateMany({ where: { id: { in: items.map((item) => item.id) } }, data: { distributedAt: now } });
    for (const item of items) {
      await addEvent(tx, { orgId, projectId, punchItemId: item.id, action: "distributed", actor, metadata: { recipients: recipients.map((r) => r.id), message: trimOrNull(message) } });
    }
  });
  await notificationService.createNotifications({
    orgId,
    projectId,
    actorId: actor?.id || null,
    recipientUserIds: recipients.map((recipient) => recipient.id),
    type: "punch",
    category: notificationService.NOTIFICATION_CATEGORIES.QUALITY,
    event: "punch.distributed",
    title: subject,
    message: lines.slice(0, 5).join("\n") + (lines.length > 5 ? `\n+${lines.length - 5} more` : ""),
    actionUrl: recordWorkspacePath({ projectId, recordType: "punch_item" }),
    entityType: "punch_item",
    dedupeKeyBase: `punch:distribute:${projectId}:${now.getTime()}`,
    metadata: { count: items.length },
  });

  return { items: items.length, recipients: results, distributedAt: now.toISOString() };
};

const photoBuffersFor = async ({ orgId, projectId, itemIds, limit }) => {
  if (!prisma.attachment?.findMany || limit <= 0) return new Map();
  const rows = await prisma.attachment.findMany({
    where: { projectId, recordType: "punch_item", recordId: { in: itemIds }, document: { mimeType: "image/jpeg" } },
    include: { document: { select: { id: true, documentType: true, mimeType: true } } },
    orderBy: { createdAt: "asc" },
  });
  const byItem = new Map();
  let used = 0;
  for (const row of rows) {
    const list = byItem.get(row.recordId) || [];
    if (list.length >= 2 || used >= limit) continue;
    try {
      const file = await fileStorageService.getProjectDocumentFile({ orgId, projectId, key: row.document.id, documentType: row.document.documentType });
      let buffer = null;
      if (file.path) buffer = await fs.readFile(file.path);
      else if (file.redirectUrl) {
        const response = await fetch(file.redirectUrl, { signal: AbortSignal.timeout(30_000) });
        if (response.ok) buffer = Buffer.from(await response.arrayBuffer());
      }
      if (buffer) {
        list.push(buffer);
        used += 1;
        byItem.set(row.recordId, list);
      }
    } catch (error) {
      console.error("[punch-export] photo skipped", error?.message || error);
    }
  }
  return byItem;
};

const groupItems = (items, groupBy) => {
  if (groupBy === "company") {
    const groups = new Map();
    for (const item of items) {
      const key = item.assigneeCompany?.name || "Unassigned";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return [...groups.entries()].map(([label, rows]) => ({ label: `Assigned to ${label}`, rows }));
  }
  if (groupBy === "location") {
    const groups = new Map();
    for (const item of items) {
      const key = item.location?.name || item.locationText || "No location";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, rows]) => ({ label, rows }));
  }
  return [{ label: null, rows: items }];
};

const exportPunchListPdf = async ({ orgId, projectId, filters = {}, groupBy = "company", includePhotos = false, viewer = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const where = await buildWhere({ orgId, projectId, filters, viewer });
  const items = await prisma.punchItem.findMany({ where, include, orderBy: [{ number: "asc" }], take: MAX_LIST });
  const photos = includePhotos ? await photoBuffersFor({ orgId, projectId, itemIds: items.map((item) => item.id), limit: MAX_EXPORT_PHOTOS }) : new Map();

  const doc = createPdf({ title: `Punch list — ${project.name}`, pageSize: "A4-landscape", footer: new Date().toISOString().slice(0, 10) });
  doc.heading(`Punch list — ${project.name}`);
  const summary = summarize(items);
  doc.paragraph(
    `${summary.total} item${summary.total === 1 ? "" : "s"} · ${summary.open} open · ${summary.overdue} overdue · ${summary.byStatus.closed || 0} closed` +
      (filters.status && filters.status !== "all" ? ` · status: ${filters.status}` : "") +
      (filters.assigneeCompanyId ? " · filtered by company" : ""),
    { size: 9, color: "0.3 0.3 0.3" },
  );
  const columns = [
    { key: "ref", label: "Ref", width: 52 },
    { key: "title", label: "Item", width: 0.34 },
    { key: (row) => row.location?.name || row.locationText || "", label: "Location", width: 0.18 },
    { key: (row) => row.trade || "", label: "Trade", width: 0.12 },
    { key: (row) => row.priority, label: "Priority", width: 52 },
    { key: (row) => formatDate(row.dueDate), label: "Due", width: 58 },
    { key: (row) => row.status.replace(/_/g, " "), label: "Status", width: 74 },
    { key: (row) => [row.assigneeCompany?.name, row.assigneeUser?.name].filter(Boolean).join(" / "), label: "Assignee", width: 0.18 },
  ];
  for (const group of groupItems(items, groupBy)) {
    if (group.label) doc.heading(`${group.label} (${group.rows.length})`, { level: 2 });
    doc.table({ columns, rows: group.rows, size: 8 });
    if (includePhotos) {
      for (const row of group.rows) {
        const buffers = photos.get(row.id);
        if (!buffers?.length) continue;
        doc.paragraph(`${row.ref} — ${row.title}`, { size: 8, bold: true });
        doc.imageRow(buffers, { width: 140 });
      }
    }
  }
  if (!items.length) doc.paragraph("No punch items match the selected filters.");
  return { buffer: doc.render(), fileName: `punch-list-${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`, count: items.length };
};

const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const exportPunchListCsv = async ({ orgId, projectId, filters = {}, viewer = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const where = await buildWhere({ orgId, projectId, filters, viewer });
  const items = await prisma.punchItem.findMany({ where, include, orderBy: [{ number: "asc" }], take: MAX_LIST });
  const header = ["Ref", "Title", "Description", "Status", "Priority", "Trade", "Location", "Sheet", "Assignee company", "Assignee", "Manager", "Final approver", "Due", "Opened", "Closed", "Reopened", "Created"];
  const rows = items.map((item) => [
    item.ref,
    item.title,
    item.description || "",
    item.status,
    item.priority,
    item.trade || "",
    item.location?.name || item.locationText || "",
    item.sheet?.number || "",
    item.assigneeCompany?.name || "",
    item.assigneeUser?.name || "",
    item.managerUser?.name || "",
    item.finalApproverUser?.name || "",
    formatDate(item.dueDate),
    formatDate(item.openedAt),
    formatDate(item.closedAt),
    item.reopenCount || 0,
    formatDate(item.createdAt),
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return { csv: `﻿${csv}`, fileName: `punch-list-${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`, count: items.length };
};

module.exports = {
  ACTIONS,
  MAX_BULK,
  PRIORITIES,
  STATUS,
  STATUSES,
  TRANSITION_RULES,
  ballInCourtFor,
  bulkCreatePunchItems,
  createPunchItem,
  deletePunchItem,
  distributePunchItems,
  exportPunchListCsv,
  exportPunchListPdf,
  getPunchItem,
  listPunchItems,
  serializeItem,
  transitionPunchItem,
  updatePunchItem,
  visibilityWhere,
};
