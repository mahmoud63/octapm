const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const domainEvents = require("../events/bus");
const notificationService = require("./notification.service");
const { assertProjectAccess, canAccessAllProjects } = require("./project-authorization.service");
const commentService = require("./comment.service");
const { recordWorkspacePath } = require("../utils/record-links");

/**
 * Conversations (OCTA-COMM-CONV-042): messaging inside the organisation.
 *
 *  - Three kinds: `direct` (one thread per pair of people per scope), `group`
 *    (named, any members) and `record` (one thread per project record, for the
 *    people working it). A conversation is org-wide or scoped to a project; a
 *    project conversation only admits people who can open that project.
 *  - Messages are plain text with explicit @mentions (member ids, never parsed
 *    from text) and can carry a shared record (type + id → title and link).
 *  - Members star, mute, leave and mark as read; unread counts come from the
 *    member's `lastReadAt`. Every message is fanned out in real time to the
 *    members' own socket rooms and notified (mentions → `mention`, everyone
 *    else → `message`, in-app only by default).
 *  - Replies to notification emails land here through inbound-email.service
 *    (`kind = "email"`).
 */

const KINDS = Object.freeze(["direct", "group", "record"]);
const MAX_BODY_LENGTH = 10000;
const MAX_MEMBERS = 200;
const MAX_MENTIONS = 50;
const PREVIEW_LENGTH = 140;
const LIST_LIMIT = 100;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];
const excerpt = (text, length = PREVIEW_LENGTH) => {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};
const conversationPath = (id) => recordWorkspacePath({ projectId: null, recordType: "conversation", recordId: id });

// ─── People ───────────────────────────────────────────────────────────────

/** Active users of the organisation; with a project, only those who can open it. */
const peopleWhere = ({ orgId, projectId }) => ({
  orgId,
  status: "active",
  ...(projectId
    ? {
        OR: [
          { role: { in: ["pm", "super_admin"] } },
          { isCompanyAdmin: true },
          { projectAssignments: { some: { projectId } } },
          { projectPartyMemberships: { some: { status: "active", projectParty: { projectId, status: "active" } } } },
        ],
      }
    : {}),
});

const personOut = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role || null });

const listPeople = async ({ orgId, projectId = null, q = null, viewer, limit = 50 }) => {
  if (projectId) await assertProjectAccess({ orgId, projectId, userId: viewer.id, role: viewer.role, isCompanyAdmin: viewer.isCompanyAdmin });
  const text = trimOrNull(q);
  const rows = await prisma.user.findMany({
    where: { AND: [peopleWhere({ orgId, projectId }), ...(text ? [{ OR: [{ name: { contains: text, mode: "insensitive" } }, { email: { contains: text, mode: "insensitive" } }] }] : [])], id: { not: viewer.id } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
    take: Math.min(Math.max(Number(limit) || 50, 1), 200),
  });
  return { items: rows.map(personOut) };
};

const usersWithAccess = async ({ orgId, projectId, userIds }) => {
  const ids = uniqueIds(userIds);
  if (!ids.length) return [];
  return prisma.user.findMany({ where: { ...peopleWhere({ orgId, projectId }), id: { in: ids } }, select: { id: true, name: true, email: true, role: true } });
};

const assertMembersValid = async ({ orgId, projectId, userIds }) => {
  const ids = uniqueIds(userIds);
  if (ids.length > MAX_MEMBERS) throw new HttpError(400, "CONVERSATION_TOO_MANY_MEMBERS", `At most ${MAX_MEMBERS} people per conversation`);
  const users = await usersWithAccess({ orgId, projectId, userIds: ids });
  if (users.length !== ids.length) {
    const found = new Set(users.map((user) => user.id));
    const missing = ids.filter((id) => !found.has(id));
    throw new HttpError(400, "CONVERSATION_MEMBER_INVALID", projectId ? `${missing.length} of the people cannot open this project` : `${missing.length} of the people are not active members of the organisation`);
  }
  return users;
};

// ─── Serialisers ──────────────────────────────────────────────────────────

const memberInclude = { user: { select: { id: true, name: true, email: true, role: true } } };
const conversationInclude = {
  project: { select: { id: true, name: true } },
  members: { where: { leftAt: null }, include: memberInclude, orderBy: { joinedAt: "asc" } },
};
const messageInclude = { author: { select: { id: true, name: true, email: true } } };

const displayTitle = (row, viewerId) => {
  if (row.title) return row.title;
  if (row.kind === "record" && row.recordTitle) return row.recordTitle;
  const others = (row.members || []).filter((member) => member.userId !== viewerId).map((member) => member.user?.name || "Someone");
  if (row.kind === "direct") return others[0] || "Just you";
  return others.length ? others.slice(0, 3).join(", ") + (others.length > 3 ? ` +${others.length - 3}` : "") : "New conversation";
};

const conversationOut = (row, { viewerId = null, unread = 0 } = {}) => {
  const me = (row.members || []).find((member) => member.userId === viewerId) || null;
  return {
    id: row.id,
    projectId: row.projectId || null,
    project: row.project ? { id: row.project.id, name: row.project.name } : null,
    kind: row.kind,
    title: displayTitle(row, viewerId),
    rawTitle: row.title || null,
    recordType: row.recordType || null,
    recordId: row.recordId || null,
    recordTitle: row.recordTitle || null,
    recordPath: row.recordType && row.projectId ? recordWorkspacePath({ projectId: row.projectId, recordType: row.recordType, recordId: row.recordId }) : null,
    lastMessageAt: toIso(row.lastMessageAt),
    lastMessagePreview: row.lastMessagePreview || null,
    messageCount: row.messageCount || 0,
    archivedAt: toIso(row.archivedAt),
    members: (row.members || []).map((member) => ({ userId: member.userId, name: member.user?.name || null, email: member.user?.email || null, role: member.user?.role || null, memberRole: member.role, joinedAt: toIso(member.joinedAt), lastReadAt: toIso(member.lastReadAt) })),
    me: me ? { memberRole: me.role, lastReadAt: toIso(me.lastReadAt), starred: Boolean(me.starred), muted: Boolean(me.muted) } : null,
    unread,
    path: conversationPath(row.id),
    createdBy: row.createdBy || null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
};

const messageOut = (row, viewerId = null) => ({
  id: row.id,
  conversationId: row.conversationId,
  authorId: row.authorId || null,
  author: row.author ? { id: row.author.id, name: row.author.name, email: row.author.email } : null,
  kind: row.kind,
  body: row.deletedAt ? "" : row.body,
  mentions: Array.isArray(row.mentionsJson) ? row.mentionsJson : [],
  linkedRecord: row.linkedRecordType
    ? { recordType: row.linkedRecordType, recordId: row.linkedRecordId, title: row.linkedRecordTitle || null, projectId: row.linkedProjectId || null, path: row.linkedProjectId ? recordWorkspacePath({ projectId: row.linkedProjectId, recordType: row.linkedRecordType, recordId: row.linkedRecordId }) : null }
    : null,
  inboundEmailId: row.inboundEmailId || null,
  editedAt: toIso(row.editedAt),
  deletedAt: toIso(row.deletedAt),
  isMine: Boolean(viewerId && row.authorId === viewerId),
  createdAt: toIso(row.createdAt),
});

// ─── Loading ──────────────────────────────────────────────────────────────

const load = async ({ orgId, conversationId, tx = prisma }) => {
  const row = await tx.conversation.findFirst({ where: { id: conversationId, orgId }, include: conversationInclude });
  if (!row) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
  return row;
};

/** The viewer's active membership, or 404 — non-members never learn a thread exists. */
const ensureMember = async ({ orgId, conversationId, userId, tx = prisma }) => {
  const member = await tx.conversationMember.findFirst({ where: { conversationId, orgId, userId, leftAt: null } });
  if (!member) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
  return member;
};

const unreadCount = ({ conversationId, viewerId, lastReadAt, tx = prisma }) =>
  tx.conversationMessage.count({ where: { conversationId, deletedAt: null, authorId: { not: viewerId }, ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}) } });

const canModerate = (viewer, row, member) => Boolean(viewer?.canModerate || viewer?.isCompanyAdmin || member?.role === "admin" || row.createdBy === viewer?.id);

// ─── Events and notifications ─────────────────────────────────────────────

const publishConversationEvent = async ({ tx = prisma, row, action, actorId, summary, recipientUserIds }) => {
  try {
    const event = domainEvents.buildRecordEvent({ orgId: row.orgId, projectId: row.projectId || null, entityType: "conversation", entityId: row.id, action, actorId, summary });
    event.recipientUserIds = recipientUserIds;
    await domainEvents.recordOutboundEvent({ tx, event });
    domainEvents.publish(event);
  } catch (error) {
    console.error("[conversation-domain-event]", error);
  }
};

const notify = ({ row, actor, recipientUserIds, category, event, title, message, priority = "normal", dedupeKeyBase, metadata = {} }) =>
  notificationService
    .createNotifications({ orgId: row.orgId, projectId: row.projectId || null, actorId: actor?.id || null, recipientUserIds: uniqueIds(recipientUserIds), type: "conversation", category, event, title, message, priority, actionUrl: conversationPath(row.id), entityType: "conversation", entityId: row.id, dedupeKeyBase, metadata: { conversationId: row.id, kind: row.kind, ...metadata } })
    .catch(() => null);

// ─── Conversations ────────────────────────────────────────────────────────

const listConversations = async ({ orgId, viewer, query = {} }) => {
  const filter = ["all", "unread", "starred", "archived"].includes(query.filter) ? query.filter : "all";
  const text = trimOrNull(query.q);
  const memberships = await prisma.conversationMember.findMany({
    where: {
      orgId,
      userId: viewer.id,
      leftAt: null,
      ...(filter === "starred" ? { starred: true } : {}),
      conversation: {
        ...(query.projectId ? { projectId: query.projectId } : {}),
        archivedAt: filter === "archived" ? { not: null } : null,
        ...(text ? { OR: [{ title: { contains: text, mode: "insensitive" } }, { recordTitle: { contains: text, mode: "insensitive" } }, { lastMessagePreview: { contains: text, mode: "insensitive" } }, { members: { some: { leftAt: null, user: { name: { contains: text, mode: "insensitive" } } } } }] } : {}),
      },
    },
    include: { conversation: { include: conversationInclude } },
    orderBy: [{ conversation: { lastMessageAt: "desc" } }, { joinedAt: "desc" }],
    take: Math.min(Math.max(Number(query.limit) || LIST_LIMIT, 1), 200),
  });
  const items = await Promise.all(
    memberships.map(async (membership) => {
      const unread = await unreadCount({ conversationId: membership.conversationId, viewerId: viewer.id, lastReadAt: membership.lastReadAt });
      return conversationOut(membership.conversation, { viewerId: viewer.id, unread });
    }),
  );
  const visible = filter === "unread" ? items.filter((item) => item.unread > 0) : items;
  return { items: visible, summary: { count: visible.length, unreadConversations: items.filter((item) => item.unread > 0).length, unreadMessages: items.reduce((sum, item) => sum + item.unread, 0) } };
};

const unreadSummary = async ({ orgId, viewer }) => {
  const memberships = await prisma.conversationMember.findMany({ where: { orgId, userId: viewer.id, leftAt: null, muted: false, conversation: { archivedAt: null } }, select: { conversationId: true, lastReadAt: true } });
  const counts = await Promise.all(memberships.map((membership) => unreadCount({ conversationId: membership.conversationId, viewerId: viewer.id, lastReadAt: membership.lastReadAt })));
  return { unreadConversations: counts.filter((count) => count > 0).length, unreadMessages: counts.reduce((sum, count) => sum + count, 0) };
};

const getConversation = async ({ orgId, viewer, conversationId }) => {
  const member = await ensureMember({ orgId, conversationId, userId: viewer.id });
  const row = await load({ orgId, conversationId });
  const unread = await unreadCount({ conversationId, viewerId: viewer.id, lastReadAt: member.lastReadAt });
  return conversationOut(row, { viewerId: viewer.id, unread });
};

const directKeyFor = ({ projectId, userIds }) => `${projectId || "org"}:${[...userIds].sort().join(":")}`;

const rejoin = async ({ tx, orgId, conversationId, userIds, role = "member" }) => {
  for (const userId of uniqueIds(userIds)) {
    await tx.conversationMember.upsert({ where: { conversationId_userId: { conversationId, userId } }, create: { orgId, conversationId, userId, role }, update: { leftAt: null } });
  }
};

const createConversation = async ({ orgId, viewer, payload = {} }) => {
  const kind = KINDS.includes(payload.kind) ? payload.kind : "group";
  const projectId = trimOrNull(payload.projectId);
  if (projectId) await assertProjectAccess({ orgId, projectId, userId: viewer.id, role: viewer.role, isCompanyAdmin: viewer.isCompanyAdmin });
  const others = uniqueIds(payload.memberUserIds).filter((id) => id !== viewer.id);
  const users = await assertMembersValid({ orgId, projectId, userIds: others });
  let title = trimOrNull(payload.title);
  let recordType = null;
  let recordId = null;
  let recordTitle = null;
  let directKey = null;

  if (kind === "direct") {
    if (others.length !== 1) throw new HttpError(400, "CONVERSATION_DIRECT_ONE_PERSON", "A direct conversation is with exactly one other person");
    directKey = directKeyFor({ projectId, userIds: [viewer.id, others[0]] });
    const existing = await prisma.conversation.findFirst({ where: { orgId, directKey } });
    if (existing) {
      await prisma.$transaction((tx) => rejoin({ tx, orgId, conversationId: existing.id, userIds: [viewer.id, others[0]] }));
      if (payload.message) await sendMessage({ orgId, viewer, conversationId: existing.id, payload: { body: payload.message } });
      return getConversation({ orgId, viewer, conversationId: existing.id });
    }
    title = null;
  }
  if (kind === "record") {
    if (!projectId) throw new HttpError(400, "CONVERSATION_PROJECT_REQUIRED", "A record conversation belongs to a project");
    recordType = trimOrNull(payload.recordType);
    recordId = trimOrNull(payload.recordId);
    if (!recordType || !recordId || !commentService.RECORD_TYPES.includes(recordType)) throw new HttpError(400, "CONVERSATION_RECORD_INVALID", "Choose a record to talk about");
    const { display } = await commentService.loadRecord({ orgId, projectId, recordType, recordId });
    recordTitle = display;
    const existing = await prisma.conversation.findFirst({ where: { orgId, projectId, kind: "record", recordType, recordId } });
    if (existing) {
      await prisma.$transaction((tx) => rejoin({ tx, orgId, conversationId: existing.id, userIds: [viewer.id, ...others] }));
      if (payload.message) await sendMessage({ orgId, viewer, conversationId: existing.id, payload: { body: payload.message } });
      return getConversation({ orgId, viewer, conversationId: existing.id });
    }
  }
  if (kind === "group" && !others.length) throw new HttpError(400, "CONVERSATION_MEMBERS_REQUIRED", "Add at least one person");

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.conversation.create({
      data: { orgId, projectId, kind, title, directKey, recordType, recordId, recordTitle, createdBy: viewer.id, members: { create: [{ orgId, userId: viewer.id, role: "admin" }, ...others.map((userId) => ({ orgId, userId, role: "member" }))] } },
      include: conversationInclude,
    });
    await publishConversationEvent({ tx, row, action: "created", actorId: viewer.id, summary: { kind, title: displayTitle(row, null) }, recipientUserIds: [viewer.id, ...others] });
    return row;
  });
  if (others.length && kind !== "direct") {
    await notify({ row: created, actor: viewer, recipientUserIds: others, category: notificationService.NOTIFICATION_CATEGORIES.MESSAGE, event: "conversation.added", title: `${viewer.name || "Someone"} added you to ${displayTitle(created, null)}`, message: users.length > 1 ? `With ${users.map((user) => user.name).join(", ")}` : "You can reply here or by email.", priority: "low", dedupeKeyBase: `conversation:${created.id}:added:${Date.now()}` });
  }
  if (payload.message) await sendMessage({ orgId, viewer, conversationId: created.id, payload: { body: payload.message } });
  return getConversation({ orgId, viewer, conversationId: created.id });
};

const updateConversation = async ({ orgId, viewer, conversationId, payload = {} }) => {
  const member = await ensureMember({ orgId, conversationId, userId: viewer.id });
  const row = await load({ orgId, conversationId });
  const data = {};
  if (payload.title !== undefined) {
    if (row.kind === "direct") throw new HttpError(400, "CONVERSATION_DIRECT_NO_TITLE", "Direct conversations are named after the other person");
    data.title = trimOrNull(payload.title);
  }
  if (payload.archived !== undefined) {
    if (!canModerate(viewer, row, member)) throw new HttpError(403, "CONVERSATION_FORBIDDEN", "Only the person who started it, a project manager or an admin can archive a conversation");
    data.archivedAt = payload.archived ? new Date() : null;
    data.archivedBy = payload.archived ? viewer.id : null;
  }
  if (Object.keys(data).length) {
    await prisma.conversation.update({ where: { id: conversationId }, data });
    await publishConversationEvent({ row, action: "updated", actorId: viewer.id, summary: data, recipientUserIds: row.members.map((item) => item.userId) });
  }
  return getConversation({ orgId, viewer, conversationId });
};

const systemMessage = async ({ tx = prisma, row, body }) => {
  const message = await tx.conversationMessage.create({ data: { orgId: row.orgId, conversationId: row.id, authorId: null, kind: "system", body } });
  await tx.conversation.update({ where: { id: row.id }, data: { lastMessageAt: message.createdAt, lastMessagePreview: excerpt(body), messageCount: { increment: 1 } } });
  return message;
};

const addMembers = async ({ orgId, viewer, conversationId, userIds }) => {
  await ensureMember({ orgId, conversationId, userId: viewer.id });
  const row = await load({ orgId, conversationId });
  if (row.kind === "direct") throw new HttpError(400, "CONVERSATION_DIRECT_FIXED", "Start a group to add more people");
  if (row.archivedAt) throw new HttpError(409, "CONVERSATION_ARCHIVED", "This conversation is archived");
  const current = new Set(row.members.map((member) => member.userId));
  const added = uniqueIds(userIds).filter((id) => !current.has(id));
  if (!added.length) return getConversation({ orgId, viewer, conversationId });
  if (current.size + added.length > MAX_MEMBERS) throw new HttpError(400, "CONVERSATION_TOO_MANY_MEMBERS", `At most ${MAX_MEMBERS} people per conversation`);
  const users = await assertMembersValid({ orgId, projectId: row.projectId, userIds: added });
  await prisma.$transaction(async (tx) => {
    await rejoin({ tx, orgId, conversationId, userIds: added });
    await systemMessage({ tx, row, body: `${viewer.name || "Someone"} added ${users.map((user) => user.name).join(", ")}` });
    await publishConversationEvent({ tx, row, action: "members_added", actorId: viewer.id, summary: { added: users.map((user) => user.name) }, recipientUserIds: [...current, ...added] });
  });
  await notify({ row, actor: viewer, recipientUserIds: added, category: notificationService.NOTIFICATION_CATEGORIES.MESSAGE, event: "conversation.added", title: `${viewer.name || "Someone"} added you to ${displayTitle(row, null)}`, message: row.lastMessagePreview || "Say hello.", priority: "low", dedupeKeyBase: `conversation:${row.id}:added:${Date.now()}` });
  return getConversation({ orgId, viewer, conversationId });
};

const removeMember = async ({ orgId, viewer, conversationId, userId }) => {
  const me = await ensureMember({ orgId, conversationId, userId: viewer.id });
  const row = await load({ orgId, conversationId });
  const leaving = userId === viewer.id;
  if (!leaving && !canModerate(viewer, row, me)) throw new HttpError(403, "CONVERSATION_FORBIDDEN", "Only an admin can remove other people");
  if (row.kind === "direct" && !leaving) throw new HttpError(400, "CONVERSATION_DIRECT_FIXED", "You can leave a direct conversation, not remove the other person");
  const target = row.members.find((member) => member.userId === userId);
  if (!target) return getConversation({ orgId, viewer, conversationId }).catch(() => ({ left: true }));
  await prisma.$transaction(async (tx) => {
    await tx.conversationMember.update({ where: { id: target.id }, data: { leftAt: new Date() } });
    await systemMessage({ tx, row, body: leaving ? `${viewer.name || "Someone"} left` : `${viewer.name || "Someone"} removed ${target.user?.name || "a member"}` });
    await publishConversationEvent({ tx, row, action: leaving ? "member_left" : "member_removed", actorId: viewer.id, summary: { userId }, recipientUserIds: row.members.map((member) => member.userId) });
  });
  if (leaving) return { left: true, conversationId };
  return getConversation({ orgId, viewer, conversationId });
};

const setMemberFlags = async ({ orgId, viewer, conversationId, payload = {} }) => {
  const member = await ensureMember({ orgId, conversationId, userId: viewer.id });
  const data = {};
  if (payload.starred !== undefined) data.starred = Boolean(payload.starred);
  if (payload.muted !== undefined) data.muted = Boolean(payload.muted);
  if (Object.keys(data).length) await prisma.conversationMember.update({ where: { id: member.id }, data });
  return getConversation({ orgId, viewer, conversationId });
};

const markRead = async ({ orgId, viewer, conversationId }) => {
  const member = await ensureMember({ orgId, conversationId, userId: viewer.id });
  await prisma.conversationMember.update({ where: { id: member.id }, data: { lastReadAt: new Date() } });
  return { conversationId, lastReadAt: new Date().toISOString(), unread: 0 };
};

// ─── Messages ─────────────────────────────────────────────────────────────

const listMessages = async ({ orgId, viewer, conversationId, cursor = null, limit = 50 }) => {
  await ensureMember({ orgId, conversationId, userId: viewer.id });
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const cursorRow = cursor ? await prisma.conversationMessage.findFirst({ where: { id: cursor, conversationId }, select: { createdAt: true } }) : null;
  const rows = await prisma.conversationMessage.findMany({ where: { conversationId, orgId, ...(cursorRow ? { createdAt: { lt: cursorRow.createdAt } } : {}) }, include: messageInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: take + 1 });
  const hasMore = rows.length > take;
  const page = rows.slice(0, take);
  return { items: page.reverse().map((row) => messageOut(row, viewer.id)), nextCursor: hasMore ? page[0].id : null };
};

const resolveLinkedRecord = async ({ orgId, viewer, row, linkedRecord }) => {
  if (!linkedRecord) return null;
  const recordType = trimOrNull(linkedRecord.recordType);
  const recordId = trimOrNull(linkedRecord.recordId);
  const projectId = trimOrNull(linkedRecord.projectId) || row.projectId;
  if (!recordType || !recordId || !projectId) throw new HttpError(400, "CONVERSATION_LINK_INVALID", "A shared record needs a project, a type and an id");
  await assertProjectAccess({ orgId, projectId, userId: viewer.id, role: viewer.role, isCompanyAdmin: viewer.isCompanyAdmin });
  let title = trimOrNull(linkedRecord.title);
  if (commentService.RECORD_TYPES.includes(recordType)) {
    const { display } = await commentService.loadRecord({ orgId, projectId, recordType, recordId });
    title = display;
  }
  return { linkedRecordType: recordType, linkedRecordId: recordId, linkedRecordTitle: title || `${recordType} ${recordId}`, linkedProjectId: projectId };
};

const sendMessage = async ({ orgId, viewer, conversationId, payload = {}, kind = "text", inboundEmailId = null }) => {
  await ensureMember({ orgId, conversationId, userId: viewer.id });
  const row = await load({ orgId, conversationId });
  if (row.archivedAt) throw new HttpError(409, "CONVERSATION_ARCHIVED", "This conversation is archived — unarchive it to write");
  const body = String(payload.body ?? "").trim();
  const linked = await resolveLinkedRecord({ orgId, viewer, row, linkedRecord: payload.linkedRecord });
  if (!body && !linked) throw new HttpError(400, "CONVERSATION_MESSAGE_EMPTY", "Write something or share a record");
  if (body.length > MAX_BODY_LENGTH) throw new HttpError(400, "CONVERSATION_MESSAGE_TOO_LONG", `Messages are limited to ${MAX_BODY_LENGTH} characters`);
  const memberIds = row.members.map((member) => member.userId);
  const mentionIds = uniqueIds(payload.mentionUserIds).filter((id) => id !== viewer.id);
  if (mentionIds.length > MAX_MENTIONS) throw new HttpError(400, "CONVERSATION_TOO_MANY_MENTIONS", `At most ${MAX_MENTIONS} mentions`);
  const notMembers = mentionIds.filter((id) => !memberIds.includes(id));
  if (notMembers.length) throw new HttpError(400, "CONVERSATION_MENTION_INVALID", "You can only mention people in the conversation");
  const mentions = mentionIds.map((id) => ({ userId: id, name: row.members.find((member) => member.userId === id)?.user?.name || null }));
  const preview = body ? excerpt(body) : `Shared ${linked.linkedRecordTitle}`;

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.conversationMessage.create({ data: { orgId, conversationId, authorId: viewer.id, kind, body, mentionsJson: mentions, ...(linked || {}), inboundEmailId }, include: messageInclude });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt, lastMessagePreview: `${viewer.name ? `${viewer.name.split(" ")[0]}: ` : ""}${preview}`, messageCount: { increment: 1 } } });
    await tx.conversationMember.updateMany({ where: { conversationId, userId: viewer.id }, data: { lastReadAt: created.createdAt } });
    await publishConversationEvent({ tx, row, action: "message", actorId: viewer.id, summary: { messageId: created.id, preview, kind }, recipientUserIds: memberIds });
    return created;
  });

  const title = displayTitle(row, null);
  const authorName = viewer.name || "Someone";
  if (mentions.length) {
    await notify({ row, actor: viewer, recipientUserIds: mentions.map((mention) => mention.userId), category: notificationService.NOTIFICATION_CATEGORIES.MENTION, event: "conversation.mentioned", title: `${authorName} mentioned you in ${title}`, message: preview, dedupeKeyBase: `conversation:${message.id}:mention`, metadata: { messageId: message.id } });
  }
  const muted = new Set(row.members.filter((member) => member.muted).map((member) => member.userId));
  const others = memberIds.filter((id) => id !== viewer.id && !mentionIds.includes(id) && !muted.has(id));
  if (others.length) {
    await notify({ row, actor: viewer, recipientUserIds: others, category: notificationService.NOTIFICATION_CATEGORIES.MESSAGE, event: "conversation.message", title: row.kind === "direct" ? `${authorName} sent you a message` : `${authorName} in ${title}`, message: preview, priority: "low", dedupeKeyBase: `conversation:${message.id}:message`, metadata: { messageId: message.id } });
  }
  return messageOut(message, viewer.id);
};

const editMessage = async ({ orgId, viewer, conversationId, messageId, body }) => {
  await ensureMember({ orgId, conversationId, userId: viewer.id });
  const existing = await prisma.conversationMessage.findFirst({ where: { id: messageId, conversationId, orgId, deletedAt: null } });
  if (!existing) throw new HttpError(404, "CONVERSATION_MESSAGE_NOT_FOUND", "Message not found");
  if (existing.authorId !== viewer.id) throw new HttpError(403, "CONVERSATION_NOT_AUTHOR", "You can only edit your own messages");
  const text = String(body ?? "").trim();
  if (!text) throw new HttpError(400, "CONVERSATION_MESSAGE_EMPTY", "Write something");
  if (text.length > MAX_BODY_LENGTH) throw new HttpError(400, "CONVERSATION_MESSAGE_TOO_LONG", `Messages are limited to ${MAX_BODY_LENGTH} characters`);
  const row = await load({ orgId, conversationId });
  const updated = await prisma.conversationMessage.update({ where: { id: messageId }, data: { body: text, editedAt: new Date() }, include: messageInclude });
  await publishConversationEvent({ row, action: "message_updated", actorId: viewer.id, summary: { messageId }, recipientUserIds: row.members.map((member) => member.userId) });
  return messageOut(updated, viewer.id);
};

const deleteMessage = async ({ orgId, viewer, conversationId, messageId }) => {
  const me = await ensureMember({ orgId, conversationId, userId: viewer.id });
  const row = await load({ orgId, conversationId });
  const existing = await prisma.conversationMessage.findFirst({ where: { id: messageId, conversationId, orgId, deletedAt: null } });
  if (!existing) throw new HttpError(404, "CONVERSATION_MESSAGE_NOT_FOUND", "Message not found");
  if (existing.authorId !== viewer.id && !canModerate(viewer, row, me)) throw new HttpError(403, "CONVERSATION_DELETE_FORBIDDEN", "You can remove your own messages; admins can remove any");
  await prisma.conversationMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), deletedBy: viewer.id } });
  await publishConversationEvent({ row, action: "message_deleted", actorId: viewer.id, summary: { messageId }, recipientUserIds: row.members.map((member) => member.userId) });
  return { deleted: true, messageId };
};

/** Membership check for inbound replies: the sender must be an active member. */
const memberForEmail = async ({ orgId, conversationId, userId }) => {
  const member = await prisma.conversationMember.findFirst({ where: { conversationId, orgId, userId, leftAt: null }, include: { conversation: { select: { id: true, projectId: true, archivedAt: true } } } });
  return member || null;
};

module.exports = {
  KINDS,
  MAX_BODY_LENGTH,
  MAX_MEMBERS,
  MAX_MENTIONS,
  canAccessAllProjects,
  conversationOut,
  messageOut,
  listPeople,
  listConversations,
  unreadSummary,
  getConversation,
  createConversation,
  updateConversation,
  addMembers,
  removeMember,
  setMemberFlags,
  markRead,
  listMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  memberForEmail,
};
