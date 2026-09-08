const store = { conversations: [], members: [], messages: [], notifications: [], events: [] };
let seq = 0;
// Mock rows are stamped just before "now" so the service's own `new Date()` marks (read receipts) land after them.
let tick = Date.now() - 3_600_000;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const now = () => new Date((tick += 1000));

const mockUsers = [
  { id: "u-pm", orgId: "org-1", name: "Priya Nair", email: "priya@tower.test", role: "pm", isCompanyAdmin: false, status: "active", projects: [], parties: [] },
  { id: "u-eng", orgId: "org-1", name: "Amal Haddad", email: "amal@tower.test", role: "site_engineer", isCompanyAdmin: false, status: "active", projects: ["p1"], parties: [] },
  { id: "u-qs", orgId: "org-1", name: "Bilal Khan", email: "bilal@tower.test", role: "qs", isCompanyAdmin: false, status: "active", projects: ["p1"], parties: [] },
  { id: "u-out", orgId: "org-1", name: "Omar Said", email: "omar@tower.test", role: "site_engineer", isCompanyAdmin: false, status: "active", projects: ["p2"], parties: [] },
  { id: "u-sub", orgId: "org-1", name: "Sara Sub", email: "sara@steel.test", role: "site_engineer", isCompanyAdmin: false, status: "active", projects: [], parties: ["p1"] },
  { id: "u-off", orgId: "org-1", name: "Gone Person", email: "gone@tower.test", role: "qs", isCompanyAdmin: false, status: "inactive", projects: [], parties: [] },
];
const userOut = (user) => (user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null);
const contains = (value, condition) => String(value || "").toLowerCase().includes(String(condition.contains).toLowerCase());

const matchUser = (user, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "AND") return condition.every((clause) => matchUser(user, clause));
    if (key === "OR") return condition.some((clause) => matchUser(user, clause));
    if (key === "id") return typeof condition === "string" ? user.id === condition : (!condition.in || condition.in.includes(user.id)) && (!condition.not || user.id !== condition.not);
    if (key === "role") return condition.in ? condition.in.includes(user.role) : user.role === condition;
    if (key === "projectAssignments") return user.projects.includes(condition.some.projectId);
    if (key === "projectPartyMemberships") return user.parties.includes(condition.some.projectParty.projectId);
    if (key === "name" || key === "email") return contains(user[key], condition);
    return user[key] === condition;
  });

const hydrateMember = (member) => ({ ...member, user: userOut(mockUsers.find((user) => user.id === member.userId)) });
const hydrateConversation = (row) => ({ ...row, project: row.projectId ? { id: row.projectId, name: "Tower" } : null, members: store.members.filter((member) => member.conversationId === row.id && !member.leftAt).sort((a, b) => a.joinedAt - b.joinedAt).map(hydrateMember) });
const hydrateMessage = (row) => ({ ...row, author: userOut(mockUsers.find((user) => user.id === row.authorId)) });

const matchConversation = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((clause) => matchConversation(row, clause));
    if (key === "archivedAt") return condition === null ? !row.archivedAt : condition.not === null ? Boolean(row.archivedAt) : true;
    if (key === "members") return store.members.some((member) => member.conversationId === row.id && !member.leftAt && contains(mockUsers.find((user) => user.id === member.userId)?.name, condition.some.user.name));
    if (condition && typeof condition === "object" && "contains" in condition) return contains(row[key], condition);
    return row[key] === condition;
  });
const matchMember = (member, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "conversation") return matchConversation(store.conversations.find((row) => row.id === member.conversationId) || {}, condition);
    if (key === "leftAt") return condition === null ? !member.leftAt : true;
    return member[key] === condition;
  });
const matchMessage = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "deletedAt") return condition === null ? !row.deletedAt : true;
    if (key === "authorId") return condition && typeof condition === "object" ? row.authorId !== condition.not : row.authorId === condition;
    if (key === "createdAt") return (!condition.gt || row.createdAt > condition.gt) && (!condition.lt || row.createdAt < condition.lt);
    return row[key] === condition;
  });
const applyData = (row, data) => {
  for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && !(value instanceof Date) && "increment" in value ? Number(row[key] || 0) + value.increment : value;
  row.updatedAt = now();
  return row;
};

const mockPrisma = {
  user: { findMany: jest.fn(async ({ where, take }) => mockUsers.filter((user) => matchUser(user, where)).slice(0, take || 100).map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role }))) },
  conversation: {
    findFirst: jest.fn(async ({ where }) => {
      const row = store.conversations.find((item) => matchConversation(item, where));
      return row ? hydrateConversation(row) : null;
    }),
    create: jest.fn(async ({ data }) => {
      const { members, ...rest } = data;
      const row = { id: nextId("conv"), messageCount: 0, lastMessageAt: null, lastMessagePreview: null, archivedAt: null, createdAt: now(), updatedAt: now(), ...rest };
      store.conversations.push(row);
      for (const member of members?.create || []) store.members.push({ id: nextId("mem"), conversationId: row.id, lastReadAt: null, starred: false, muted: false, joinedAt: now(), leftAt: null, ...member });
      return hydrateConversation(row);
    }),
    update: jest.fn(async ({ where, data }) => hydrateConversation(applyData(store.conversations.find((row) => row.id === where.id), data))),
  },
  conversationMember: {
    findFirst: jest.fn(async ({ where, include }) => {
      const member = store.members.find((item) => matchMember(item, where));
      if (!member) return null;
      return include?.conversation ? { ...member, conversation: store.conversations.find((row) => row.id === member.conversationId) } : { ...member };
    }),
    findMany: jest.fn(async ({ where, include, take }) => {
      const rows = store.members.filter((item) => matchMember(item, where)).sort((a, b) => (store.conversations.find((row) => row.id === b.conversationId)?.lastMessageAt || 0) - (store.conversations.find((row) => row.id === a.conversationId)?.lastMessageAt || 0));
      return rows.slice(0, take || 100).map((member) => (include?.conversation ? { ...member, conversation: hydrateConversation(store.conversations.find((row) => row.id === member.conversationId)) } : { ...member }));
    }),
    upsert: jest.fn(async ({ where, create, update }) => {
      const { conversationId, userId } = where.conversationId_userId;
      const existing = store.members.find((item) => item.conversationId === conversationId && item.userId === userId);
      if (existing) return Object.assign(existing, update);
      const row = { id: nextId("mem"), lastReadAt: null, starred: false, muted: false, joinedAt: now(), leftAt: null, ...create };
      store.members.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }) => Object.assign(store.members.find((item) => item.id === where.id), data)),
    updateMany: jest.fn(async ({ where, data }) => {
      store.members.filter((item) => item.conversationId === where.conversationId && item.userId === where.userId).forEach((item) => Object.assign(item, data));
      return { count: 1 };
    }),
  },
  conversationMessage: {
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("msg"), editedAt: null, deletedAt: null, createdAt: now(), ...data };
      store.messages.push(row);
      return hydrateMessage(row);
    }),
    count: jest.fn(async ({ where }) => store.messages.filter((row) => matchMessage(row, where)).length),
    findFirst: jest.fn(async ({ where }) => {
      const row = store.messages.find((item) => matchMessage(item, where));
      return row ? hydrateMessage(row) : null;
    }),
    findMany: jest.fn(async ({ where, take }) => store.messages.filter((row) => matchMessage(row, where)).sort((a, b) => b.createdAt - a.createdAt).slice(0, take).map(hydrateMessage)),
    update: jest.fn(async ({ where, data }) => hydrateMessage(Object.assign(store.messages.find((row) => row.id === where.id), data))),
  },
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
const mockNotifications = { NOTIFICATION_CATEGORIES: { MENTION: "mention", MESSAGE: "message" }, createNotifications: jest.fn(async (payload) => store.notifications.push(payload)) };
const mockBus = { buildRecordEvent: jest.fn((event) => ({ type: "record.changed", ...event })), recordOutboundEvent: jest.fn(async () => null), publish: jest.fn((event) => store.events.push(event)) };
const mockHasAccess = (user, projectId) => user.role === "pm" || user.isCompanyAdmin || user.projects.includes(projectId) || user.parties.includes(projectId);

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../../events/bus", () => mockBus);
jest.mock("../project-authorization.service", () => ({
  assertProjectAccess: async ({ projectId, userId }) => {
    const { HttpError } = require("../../utils/http-error");
    const user = mockUsers.find((item) => item.id === userId);
    if (projectId !== "p1" && projectId !== "p2") throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    if (!user || !mockHasAccess(user, projectId)) throw new HttpError(403, "PROJECT_ACCESS_DENIED", "denied");
    return { id: projectId };
  },
  canAccessAllProjects: () => false,
}));
jest.mock("../comment.service", () => ({ RECORD_TYPES: ["rfi", "submittal"], loadRecord: async ({ recordType, recordId }) => ({ record: { id: recordId }, display: `${recordType === "rfi" ? "RFI RFI-012" : "Submittal SUB-3"} – Rebar spacing` }) }));

const service = require("../conversation.service");

const viewer = (id) => {
  const user = mockUsers.find((item) => item.id === id);
  return { id: user.id, name: user.name, role: user.role, isCompanyAdmin: user.isCompanyAdmin, canModerate: user.role === "pm" };
};
const pm = viewer("u-pm");
const eng = viewer("u-eng");
const qs = viewer("u-qs");
const reset = () => {
  for (const key of Object.keys(store)) store[key] = [];
  jest.clearAllMocks();
};

describe("conversations", () => {
  beforeEach(reset);

  it("lists the people one can message: active members of the organisation, narrowed to those who can open a project", async () => {
    const org = await service.listPeople({ orgId: "org-1", viewer: pm });
    expect(org.items.map((person) => person.id)).toEqual(["u-eng", "u-qs", "u-out", "u-sub"]);
    const project = await service.listPeople({ orgId: "org-1", projectId: "p1", viewer: pm });
    expect(project.items.map((person) => person.id)).toEqual(["u-eng", "u-qs", "u-sub"]);
    const search = await service.listPeople({ orgId: "org-1", projectId: "p1", q: "bil", viewer: pm });
    expect(search.items.map((person) => person.id)).toEqual(["u-qs"]);
    await expect(service.listPeople({ orgId: "org-1", projectId: "p1", viewer: viewer("u-out") })).rejects.toMatchObject({ code: "PROJECT_ACCESS_DENIED" });
  });

  it("opens one direct thread per pair of people and reuses it", async () => {
    const direct = await service.createConversation({ orgId: "org-1", viewer: pm, payload: { kind: "direct", projectId: "p1", memberUserIds: ["u-eng"], message: "Can you check the rebar spacing on L1?" } });
    expect(direct).toMatchObject({ kind: "direct", title: "Amal Haddad", messageCount: 1, unread: 0, me: { memberRole: "admin" }, path: `/messages?conversationId=${direct.id}` });
    expect(direct.members.map((member) => member.userId)).toEqual(["u-pm", "u-eng"]);
    expect(store.notifications.map((item) => [item.event, item.recipientUserIds])).toEqual([["conversation.message", ["u-eng"]]]);
    expect(store.notifications[0]).toMatchObject({ category: "message", title: "Priya Nair sent you a message", actionUrl: `/messages?conversationId=${direct.id}` });
    const again = await service.createConversation({ orgId: "org-1", viewer: eng, payload: { kind: "direct", projectId: "p1", memberUserIds: ["u-pm"] } });
    expect(again.id).toBe(direct.id);
    expect(again.title).toBe("Priya Nair");
    expect(again.unread).toBe(1);
    await expect(service.createConversation({ orgId: "org-1", viewer: pm, payload: { kind: "direct", projectId: "p1", memberUserIds: ["u-out"] } })).rejects.toMatchObject({ code: "CONVERSATION_MEMBER_INVALID" });
    await expect(service.createConversation({ orgId: "org-1", viewer: pm, payload: { kind: "direct", memberUserIds: ["u-eng", "u-qs"] } })).rejects.toMatchObject({ code: "CONVERSATION_DIRECT_ONE_PERSON" });
    await expect(service.createConversation({ orgId: "org-1", viewer: pm, payload: { kind: "direct", memberUserIds: ["u-off"] } })).rejects.toMatchObject({ code: "CONVERSATION_MEMBER_INVALID" });
  });

  it("runs a group: members notified when added, mentions must be members, unread counts, read marks, stars, mutes, leaving, archiving", async () => {
    const group = await service.createConversation({ orgId: "org-1", viewer: pm, payload: { kind: "group", projectId: "p1", title: "L1 slab pour", memberUserIds: ["u-eng", "u-qs"] } });
    expect(group).toMatchObject({ kind: "group", title: "L1 slab pour", messageCount: 0 });
    expect(store.notifications.map((item) => [item.event, item.recipientUserIds.sort()])).toEqual([["conversation.added", ["u-eng", "u-qs"]]]);

    await expect(service.sendMessage({ orgId: "org-1", viewer: pm, conversationId: group.id, payload: { body: "hi", mentionUserIds: ["u-out"] } })).rejects.toMatchObject({ code: "CONVERSATION_MENTION_INVALID" });
    await expect(service.sendMessage({ orgId: "org-1", viewer: pm, conversationId: group.id, payload: { body: "   " } })).rejects.toMatchObject({ code: "CONVERSATION_MESSAGE_EMPTY" });
    await expect(service.sendMessage({ orgId: "org-1", viewer: viewer("u-out"), conversationId: group.id, payload: { body: "hi" } })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    const first = await service.sendMessage({ orgId: "org-1", viewer: pm, conversationId: group.id, payload: { body: "@Amal Haddad pump arrives 06:00, be there", mentionUserIds: ["u-eng"] } });
    expect(first).toMatchObject({ kind: "text", isMine: true, mentions: [{ userId: "u-eng", name: "Amal Haddad" }] });
    const sent = store.notifications.slice(1);
    expect(sent.map((item) => [item.event, item.category, item.recipientUserIds])).toEqual([
      ["conversation.mentioned", "mention", ["u-eng"]],
      ["conversation.message", "message", ["u-qs"]],
    ]);
    const event = store.events.find((item) => item.action === "message");
    expect(event).toMatchObject({ entityType: "conversation", entityId: group.id, projectId: "p1", recipientUserIds: ["u-pm", "u-eng", "u-qs"] });

    const forEng = await service.listConversations({ orgId: "org-1", viewer: eng });
    expect(forEng.items[0]).toMatchObject({ id: group.id, unread: 1, lastMessagePreview: "Priya: @Amal Haddad pump arrives 06:00, be there" });
    expect(forEng.summary).toEqual({ count: 1, unreadConversations: 1, unreadMessages: 1 });
    expect((await service.listConversations({ orgId: "org-1", viewer: eng, query: { filter: "unread" } })).items).toHaveLength(1);
    await service.markRead({ orgId: "org-1", viewer: eng, conversationId: group.id });
    expect((await service.listConversations({ orgId: "org-1", viewer: eng, query: { filter: "unread" } })).items).toHaveLength(0);
    expect((await service.unreadSummary({ orgId: "org-1", viewer: eng })).unreadMessages).toBe(0);

    await service.setMemberFlags({ orgId: "org-1", viewer: eng, conversationId: group.id, payload: { starred: true } });
    expect((await service.listConversations({ orgId: "org-1", viewer: eng, query: { filter: "starred" } })).items.map((item) => item.id)).toEqual([group.id]);
    await service.setMemberFlags({ orgId: "org-1", viewer: qs, conversationId: group.id, payload: { muted: true } });
    await service.sendMessage({ orgId: "org-1", viewer: eng, conversationId: group.id, payload: { body: "On my way" } });
    expect(store.notifications.slice(3).map((item) => [item.event, item.recipientUserIds])).toEqual([["conversation.message", ["u-pm"]]]);
    expect((await service.listConversations({ orgId: "org-1", viewer: eng, query: { q: "bilal" } })).items).toHaveLength(1);
    expect((await service.listConversations({ orgId: "org-1", viewer: eng, query: { q: "nothing here" } })).items).toHaveLength(0);

    const messages = await service.listMessages({ orgId: "org-1", viewer: qs, conversationId: group.id, limit: 1 });
    expect(messages.items.map((item) => item.body)).toEqual(["On my way"]);
    expect(messages.nextCursor).toBeTruthy();
    const older = await service.listMessages({ orgId: "org-1", viewer: qs, conversationId: group.id, cursor: messages.nextCursor });
    expect(older.items.map((item) => item.body)).toEqual(["@Amal Haddad pump arrives 06:00, be there"]);

    await expect(service.deleteMessage({ orgId: "org-1", viewer: qs, conversationId: group.id, messageId: first.id })).rejects.toMatchObject({ code: "CONVERSATION_DELETE_FORBIDDEN" });
    await expect(service.editMessage({ orgId: "org-1", viewer: qs, conversationId: group.id, messageId: first.id, body: "x" })).rejects.toMatchObject({ code: "CONVERSATION_NOT_AUTHOR" });
    expect((await service.editMessage({ orgId: "org-1", viewer: pm, conversationId: group.id, messageId: first.id, body: "pump arrives 06:30" })).editedAt).toBeTruthy();
    expect(await service.deleteMessage({ orgId: "org-1", viewer: pm, conversationId: group.id, messageId: first.id })).toEqual({ deleted: true, messageId: first.id });

    await service.addMembers({ orgId: "org-1", viewer: pm, conversationId: group.id, userIds: ["u-sub"] });
    expect((await service.getConversation({ orgId: "org-1", viewer: pm, conversationId: group.id })).members.map((member) => member.userId)).toEqual(["u-pm", "u-eng", "u-qs", "u-sub"]);
    expect(store.messages.filter((row) => row.kind === "system").map((row) => row.body)).toEqual(["Priya Nair added Sara Sub"]);
    expect(await service.removeMember({ orgId: "org-1", viewer: qs, conversationId: group.id, userId: "u-qs" })).toEqual({ left: true, conversationId: group.id });
    await expect(service.getConversation({ orgId: "org-1", viewer: qs, conversationId: group.id })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(service.removeMember({ orgId: "org-1", viewer: eng, conversationId: group.id, userId: "u-sub" })).rejects.toMatchObject({ code: "CONVERSATION_FORBIDDEN" });

    await expect(service.updateConversation({ orgId: "org-1", viewer: eng, conversationId: group.id, payload: { archived: true } })).rejects.toMatchObject({ code: "CONVERSATION_FORBIDDEN" });
    const archived = await service.updateConversation({ orgId: "org-1", viewer: pm, conversationId: group.id, payload: { archived: true, title: "L1 slab pour (done)" } });
    expect(archived).toMatchObject({ title: "L1 slab pour (done)" });
    expect(archived.archivedAt).toBeTruthy();
    await expect(service.sendMessage({ orgId: "org-1", viewer: pm, conversationId: group.id, payload: { body: "late" } })).rejects.toMatchObject({ code: "CONVERSATION_ARCHIVED" });
    expect((await service.listConversations({ orgId: "org-1", viewer: pm })).items).toHaveLength(0);
    expect((await service.listConversations({ orgId: "org-1", viewer: pm, query: { filter: "archived" } })).items.map((item) => item.id)).toEqual([group.id]);
  });

  it("keeps one thread per record and lets a message share a record with its title and link", async () => {
    const thread = await service.createConversation({ orgId: "org-1", viewer: eng, payload: { kind: "record", projectId: "p1", recordType: "rfi", recordId: "rfi-12", memberUserIds: ["u-qs"] } });
    expect(thread).toMatchObject({ kind: "record", title: "RFI RFI-012 – Rebar spacing", recordType: "rfi", recordId: "rfi-12", recordPath: "/projects/p1/doc-control/rfi?recordId=rfi-12&source=rfi" });
    const same = await service.createConversation({ orgId: "org-1", viewer: pm, payload: { kind: "record", projectId: "p1", recordType: "rfi", recordId: "rfi-12" } });
    expect(same.id).toBe(thread.id);
    expect(same.members.map((member) => member.userId)).toEqual(["u-eng", "u-qs", "u-pm"]);
    await expect(service.createConversation({ orgId: "org-1", viewer: pm, payload: { kind: "record", projectId: "p1", recordType: "photo", recordId: "x" } })).rejects.toMatchObject({ code: "CONVERSATION_RECORD_INVALID" });
    await expect(service.createConversation({ orgId: "org-1", viewer: pm, payload: { kind: "record", recordType: "rfi", recordId: "x" } })).rejects.toMatchObject({ code: "CONVERSATION_PROJECT_REQUIRED" });

    const shared = await service.sendMessage({ orgId: "org-1", viewer: pm, conversationId: thread.id, payload: { linkedRecord: { recordType: "submittal", recordId: "sub-3" } } });
    expect(shared.linkedRecord).toEqual({ recordType: "submittal", recordId: "sub-3", title: "Submittal SUB-3 – Rebar spacing", projectId: "p1", path: "/projects/p1/doc-control/submittals?recordId=sub-3&source=submittal" });
    expect((await service.getConversation({ orgId: "org-1", viewer: pm, conversationId: thread.id })).lastMessagePreview).toBe("Priya: Shared Submittal SUB-3 – Rebar spacing");
    await expect(service.sendMessage({ orgId: "org-1", viewer: viewer("u-out"), conversationId: thread.id, payload: { linkedRecord: { recordType: "rfi", recordId: "r" } } })).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    const member = await service.memberForEmail({ orgId: "org-1", conversationId: thread.id, userId: "u-qs" });
    expect(member).toMatchObject({ userId: "u-qs", conversation: { id: thread.id, projectId: "p1" } });
    expect(await service.memberForEmail({ orgId: "org-1", conversationId: thread.id, userId: "u-out" })).toBeNull();
  });
});
