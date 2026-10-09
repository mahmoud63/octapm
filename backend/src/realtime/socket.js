const { tokenEpochCurrent, verifyAccessToken } = require("../utils/tokens");
const { prisma } = require("../config/db");
const {
  assertProjectAccess,
} = require("../services/project-authorization.service");
const { subscribe } = require("../events/bus");

/**
 * Realtime transport over socket.io.
 *
 * Security model:
 * - Every socket must present a valid access token in the handshake
 *   (`auth.token` or an Authorization bearer header). No anonymous sockets.
 *   The token names an account, and the socket is honoured only while that
 *   account is active and in the token's organisation, with the role and
 *   standing it holds now — the same rule the REST layer applies (CX21-485);
 *   a deactivated or demoted person kept their old authority on the socket
 *   until the token expired (Phase 21D, CX21-491). The rule is applied again
 *   when a project room is joined, and the person's sockets are dropped when
 *   they are deactivated or their role changes (`disconnectMembership`, or
 *   `disconnectUser` when the identity itself is closed).
 * - A socket joins three rooms on connect (ENT-5, multi-tenant doc §3):
 *   `user:{id}` for the identity, `org:{orgId}` for the workspace it is
 *   connected in, and `member:{membershipId}` for the membership the token
 *   names. One person may be connected in two workspaces at once, from two
 *   devices or two tabs; the member room is what tells those sockets apart.
 *   Org rooms are only used for org-wide, non-record events (none today).
 * - Project rooms are joined on demand and only after the same project access
 *   check the REST layer uses (`assertProjectAccess`), so party-scoped users
 *   only receive events for projects they can already read.
 * - Record events are delivered to project rooms. Events addressed to people
 *   (notifications) are delivered to the recipient's member room in the
 *   workspace the event belongs to — never to the identity's user room, so a
 *   person connected in workspace B does not hear workspace A's notification.
 */

const DOMAIN_EVENT_NAME = "domain.event";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROOMS = Object.freeze({
  org: (orgId) => `org:${orgId}`,
  user: (userId) => `user:${userId}`,
  member: (memberKey) => `member:${memberKey}`,
  project: (projectId) => `project:${projectId}`,
});

/**
 * The key of a person's member room in one workspace: the membership id
 * when they have a row, or a legacy key made of the workspace and the person
 * for an account seeded before memberships (or a token minted before ENT-2,
 * which names no `mid`). Both sides — the socket on connect and the router at
 * broadcast — derive the key the same way, so a legacy person still receives
 * their notifications in the one workspace their User row names.
 */
const memberRoomKey = ({ membershipId = null, orgId, userId }) =>
  membershipId || `legacy:${orgId}:${userId}`;

const parseHandshakeToken = (socket) => {
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  const header =
    socket.handshake?.headers?.authorization ||
    socket.handshake?.headers?.Authorization;
  if (typeof header === "string") {
    const [scheme, token] = header.split(" ");
    if (scheme === "Bearer" && token) return token;
  }

  return null;
};

const socketError = (code, message) => {
  const error = new Error(message);
  error.data = { code };
  return error;
};

/**
 * The membership a token names, as it stands now — or null when it is gone,
 * suspended, the person inactive or the organisation not the token's. The
 * same resolver the REST layer uses (architecture doc §2.1 step 5): the
 * membership when there is one, the User columns for a person seeded before
 * memberships or a token minted before this wave (no `mid`).
 */
const accountStanding = async ({ userId, orgId, membershipId = null }) => {
  if (!userId || !prisma?.user?.findUnique) return null;
  const { resolveRequestPrincipal } = require("../services/membership.service");
  return resolveRequestPrincipal({ tx: prisma, userId, orgId, membershipId });
};

const authenticateSocket = async (socket, next) => {
  let payload;
  try {
    const token = parseHandshakeToken(socket);
    if (!token) {
      return next(socketError("AUTH_REQUIRED", "Missing access token"));
    }
    payload = verifyAccessToken(token);
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return next(socketError("TOKEN_EXPIRED", "Access token has expired"));
    }
    return next(socketError("INVALID_TOKEN", "Access token is invalid"));
  }

  try {
    const account = await accountStanding({ userId: payload.sub, orgId: payload.orgId, membershipId: payload.mid || null });
    if (!account) {
      return next(socketError("USER_INACTIVE", "This account is no longer active"));
    }
    // A token from before the identity's last credential event opens no socket (D-ID-1 Q6).
    if (!tokenEpochCurrent(payload, account)) {
      return next(socketError("SESSION_REVOKED", "This session has ended; sign in again"));
    }
    socket.data = socket.data || {};
    socket.data.user = {
      ...account,
      id: payload.sub,
      orgId: payload.orgId,
      role: account.role || payload.role,
      email: account.email || payload.email,
      name: account.name || payload.name,
      isCompanyAdmin: Boolean(account.isCompanyAdmin),
    };
    return next();
  } catch (error) {
    return next(socketError("AUTH_UNAVAILABLE", "The account could not be verified"));
  }
};

const ackSafely = (ack, payload) => {
  if (typeof ack === "function") ack(payload);
};

const handleProjectJoin = async (socket, payload, ack) => {
  const projectId = String(payload?.projectId || "").trim();
  const user = socket.data?.user;

  if (!user) {
    return ackSafely(ack, { ok: false, code: "AUTH_REQUIRED" });
  }
  if (!UUID_PATTERN.test(projectId)) {
    return ackSafely(ack, { ok: false, code: "VALIDATION_ERROR" });
  }

  try {
    // The account as it stands now decides, not the socket's copy of it (CX21-491).
    const account = await accountStanding({ userId: user.id, orgId: user.orgId, membershipId: user.membershipId || null });
    if (!account) {
      return ackSafely(ack, { ok: false, projectId, code: "USER_INACTIVE" });
    }
    // A socket opened before the identity's last credential event joins nothing
    // more, and goes (D-ID-1 Q6).
    if ((account.credentialEpoch ?? 0) !== (user.credentialEpoch ?? 0)) {
      ackSafely(ack, { ok: false, projectId, code: "SESSION_REVOKED" });
      socket.disconnect(true);
      return undefined;
    }
    await assertProjectAccess({
      orgId: user.orgId,
      projectId,
      userId: user.id,
      role: account.role || user.role,
      isCompanyAdmin: Boolean(account.isCompanyAdmin),
    });
    await socket.join(ROOMS.project(projectId));
    return ackSafely(ack, { ok: true, projectId });
  } catch (error) {
    return ackSafely(ack, {
      ok: false,
      projectId,
      code: error?.code || "PROJECT_ACCESS_DENIED",
    });
  }
};

const handleProjectLeave = async (socket, payload, ack) => {
  const projectId = String(payload?.projectId || "").trim();
  if (projectId) await socket.leave(ROOMS.project(projectId));
  return ackSafely(ack, { ok: true, projectId: projectId || null });
};

// ─── Member rooms for the recipients of an event ────────────────────────────

// A burst of events for one workspace (a workflow step notifying five people
// ten times) must not read the membership table once per event; the key is
// remembered for a minute, which is also how long a membership change takes
// to be reflected in routing — the sockets it drops are dropped at once by
// disconnectMembership, so nothing is delivered to a membership that is gone.
const MEMBER_KEY_TTL_MS = 60_000;
const memberKeyCache = new Map();

const rememberMemberKey = (orgId, userId, membershipId) =>
  memberKeyCache.set(`${orgId}:${userId}`, { membershipId, until: Date.now() + MEMBER_KEY_TTL_MS });

/**
 * The member room key of every recipient of an event in the event's
 * workspace: `Map<userId, memberKey>`. A recipient with no active membership
 * row gets the legacy key, which is the room a legacy socket joins; a client
 * that does not know the membership model (a test double) gets legacy keys
 * for everyone. Only publishers hand over user ids, so this lookup is what
 * keeps every one of them — twenty-odd services — routing to the workspace.
 */
const resolveMemberKeys = async (event) => {
  const keys = new Map();
  const recipients = event?.recipientUserIds || [];
  if (!recipients.length || !event.orgId) return keys;
  const now = Date.now();
  const missing = [];
  for (const userId of recipients) {
    const cached = memberKeyCache.get(`${event.orgId}:${userId}`);
    if (cached && cached.until > now) keys.set(userId, memberRoomKey({ membershipId: cached.membershipId, orgId: event.orgId, userId }));
    else missing.push(userId);
  }
  if (missing.length && typeof prisma?.organizationMembership?.findMany === "function") {
    let rows = [];
    try {
      rows = await prisma.organizationMembership.findMany({
        where: { orgId: event.orgId, userId: { in: missing }, status: "active" },
        select: { id: true, userId: true },
      });
    } catch (error) {
      console.error("[realtime] membership lookup failed; routing to legacy member rooms", error);
    }
    const byUser = new Map(rows.map((row) => [row.userId, row.id]));
    for (const userId of missing) {
      const membershipId = byUser.get(userId) || null;
      rememberMemberKey(event.orgId, userId, membershipId);
      keys.set(userId, memberRoomKey({ membershipId, orgId: event.orgId, userId }));
    }
  } else {
    for (const userId of missing) keys.set(userId, memberRoomKey({ orgId: event.orgId, userId }));
  }
  return keys;
};

/** Test hook and the disconnect path: forget a remembered key so the next event reads the row again. */
const forgetMemberKeys = (orgId = null, userId = null) => {
  if (!orgId) return memberKeyCache.clear();
  if (!userId) {
    for (const key of [...memberKeyCache.keys()]) if (key.startsWith(`${orgId}:`)) memberKeyCache.delete(key);
    return undefined;
  }
  return memberKeyCache.delete(`${orgId}:${userId}`);
};

/**
 * The rooms an event is delivered to. An event addressed to people goes to
 * each recipient's member room in the event's workspace (`memberKeys` from
 * resolveMemberKeys; a recipient it does not name gets the legacy key, so a
 * caller that resolved nothing still routes within the workspace). A record
 * event goes to its project room.
 */
const targetRoomsFor = (event, memberKeys = new Map()) => {
  if (!event) return [];
  if (event.recipientUserIds?.length) {
    return event.recipientUserIds.map((userId) =>
      ROOMS.member(memberKeys.get(userId) || memberRoomKey({ orgId: event.orgId, userId })),
    );
  }
  if (event.projectId) return [ROOMS.project(event.projectId)];
  return [];
};

// A record event tells a project room that a record changed — which one,
// what happened — and nothing of its figures: every member of the room
// received a cost record's budget, committed and actual whether or not they
// may read cost, so the summary stays behind and each subscriber refetches
// what it may read (Phase 21D, CX21-523). Events addressed to people
// (notifications) keep their payload; they were built for those people.
const clientPayload = (event) => {
  const payload = event.payload || {};
  if (event.recipientUserIds?.length) return payload;
  const { summary, ...rest } = payload;
  return rest;
};

const serializeForClient = (event) => ({
  id: event.id,
  type: event.type,
  orgId: event.orgId,
  projectId: event.projectId,
  entityType: event.entityType,
  entityId: event.entityId,
  action: event.action,
  actorId: event.actorId,
  occurredAt: event.occurredAt,
  payload: clientPayload(event),
});

const broadcastDomainEvent = (io, event, memberKeys = new Map()) => {
  const rooms = targetRoomsFor(event, memberKeys);
  if (!rooms.length) return 0;

  const message = serializeForClient(event);
  for (const room of rooms) {
    io.to(room).emit(DOMAIN_EVENT_NAME, message);
  }
  return rooms.length;
};

/** Resolves the recipients' member rooms, then broadcasts. What the bus subscription runs. */
const deliverDomainEvent = async (io, event) => broadcastDomainEvent(io, event, await resolveMemberKeys(event));

/** Drops every socket a person holds, in every workspace — when the identity itself is closed (User.status, membership doc §5.1). */
const disconnectUser = (io, userId) => {
  if (!io?.in || !userId) return false;
  const room = io.in(ROOMS.user(userId));
  if (typeof room?.disconnectSockets !== "function") return false;
  room.disconnectSockets(true);
  return true;
};

/**
 * Drops the sockets of one membership and no other: a role change or a
 * suspension in workspace A ends A's sockets, and the same person's socket in
 * workspace B stays connected (ENT-5). The next connection in A carries the
 * membership as it is now (CX21-491).
 */
const disconnectMembership = (io, membershipId) => {
  if (!io?.in || !membershipId) return false;
  const room = io.in(ROOMS.member(membershipId));
  if (typeof room?.disconnectSockets !== "function") return false;
  room.disconnectSockets(true);
  return true;
};

/**
 * What user management calls after a change of standing (routes/users.js):
 * the identity closed → every socket goes; a membership row → that
 * membership's sockets; no row (a workspace seeded before memberships) →
 * the person's sockets, which is all such a workspace can address. Reads the
 * rows as they are after the change, so the caller does not have to know
 * which of the three it made.
 */
const disconnectStanding = async (io, { orgId, userId }) => {
  if (!io?.in || !orgId || !userId) return { dropped: "none" };
  forgetMemberKeys(orgId, userId);
  const account = prisma?.user?.findUnique
    ? await prisma.user.findUnique({ where: { id: userId }, select: { status: true } }).catch(() => null)
    : null;
  if (account && account.status !== "active") {
    disconnectUser(io, userId);
    return { dropped: "user" };
  }
  const membership = prisma?.organizationMembership?.findFirst
    ? await prisma.organizationMembership.findFirst({ where: { orgId, userId }, select: { id: true } }).catch(() => null)
    : null;
  if (membership) {
    disconnectMembership(io, membership.id);
    return { dropped: "membership", membershipId: membership.id };
  }
  disconnectMembership(io, memberRoomKey({ orgId, userId }));
  return { dropped: "legacy" };
};

/**
 * Relays this process's domain events to socket rooms. With a cluster adapter
 * the emit reaches sockets on every task, so a process that serves no sockets
 * of its own (the job worker) still calls this to reach the people waiting on
 * its events. Returns the unsubscribe function.
 */
const subscribeBroadcasts = (io) =>
  subscribe((event) => {
    deliverDomainEvent(io, event).catch((error) => {
      console.error("[realtime] broadcast failure", error);
    });
  });

const attachRealtime = (io) => {
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const user = socket.data?.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    const memberKey = memberRoomKey({ membershipId: user.membershipId || null, orgId: user.orgId, userId: user.id });
    socket.join(ROOMS.org(user.orgId));
    socket.join(ROOMS.user(user.id));
    socket.join(ROOMS.member(memberKey));
    // The handshake read the account a moment ago. A credential event that
    // committed since then swept the person's sockets before this one was in
    // their room, so it is checked once more now that it is: an event before
    // this read is caught here, one after it reaches the socket through the
    // room (D-ID-1 Q6).
    accountStanding({ userId: user.id, orgId: user.orgId, membershipId: user.membershipId || null })
      .then((account) => {
        if (!account || (account.credentialEpoch ?? 0) !== (user.credentialEpoch ?? 0)) socket.disconnect(true);
      })
      .catch(() => socket.disconnect(true));

    socket.on("project:join", (payload, ack) =>
      handleProjectJoin(socket, payload, ack),
    );
    socket.on("project:leave", (payload, ack) =>
      handleProjectLeave(socket, payload, ack),
    );
    socket.emit("realtime.ready", {
      userId: user.id,
      orgId: user.orgId,
      membershipId: user.membershipId || null,
      connectedAt: new Date().toISOString(),
    });
  });

  const unsubscribe = subscribeBroadcasts(io);

  return {
    broadcast: (event) => deliverDomainEvent(io, event),
    unsubscribe,
  };
};

module.exports = {
  DOMAIN_EVENT_NAME,
  ROOMS,
  attachRealtime,
  authenticateSocket,
  broadcastDomainEvent,
  deliverDomainEvent,
  disconnectMembership,
  disconnectStanding,
  disconnectUser,
  forgetMemberKeys,
  handleProjectJoin,
  handleProjectLeave,
  memberRoomKey,
  resolveMemberKeys,
  subscribeBroadcasts,
  targetRoomsFor,
};
