const { verifyAccessToken } = require("../utils/tokens");
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
 *   they are deactivated or their role changes (`disconnectUser`).
 * - A socket joins its own `user:{id}` room and the `org:{id}` room on connect.
 *   Org rooms are only used for org-wide, non-record events (none today).
 * - Project rooms are joined on demand and only after the same project access
 *   check the REST layer uses (`assertProjectAccess`), so party-scoped users
 *   only receive events for projects they can already read.
 * - Record events are delivered to project rooms; notification events are
 *   delivered to the recipient user rooms only.
 */

const DOMAIN_EVENT_NAME = "domain.event";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROOMS = Object.freeze({
  org: (orgId) => `org:${orgId}`,
  user: (userId) => `user:${userId}`,
  project: (projectId) => `project:${projectId}`,
});

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

/** The account a token names, as it stands now — or null when it is gone, inactive or in another organisation. */
const accountStanding = async ({ userId, orgId }) => {
  if (!userId || !prisma?.user?.findUnique) return null;
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, orgId: true, role: true, status: true, isCompanyAdmin: true },
  });
  if (!account || account.orgId !== orgId || account.status !== "active") return null;
  return account;
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
    const account = await accountStanding({ userId: payload.sub, orgId: payload.orgId });
    if (!account) {
      return next(socketError("USER_INACTIVE", "This account is no longer active"));
    }
    socket.data = socket.data || {};
    socket.data.user = {
      id: payload.sub,
      orgId: payload.orgId,
      role: account.role || payload.role,
      email: payload.email,
      name: payload.name,
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
    const account = await accountStanding({ userId: user.id, orgId: user.orgId });
    if (!account) {
      return ackSafely(ack, { ok: false, projectId, code: "USER_INACTIVE" });
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

const targetRoomsFor = (event) => {
  if (!event) return [];
  if (event.recipientUserIds?.length) {
    return event.recipientUserIds.map((userId) => ROOMS.user(userId));
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

const broadcastDomainEvent = (io, event) => {
  const rooms = targetRoomsFor(event);
  if (!rooms.length) return 0;

  const message = serializeForClient(event);
  for (const room of rooms) {
    io.to(room).emit(DOMAIN_EVENT_NAME, message);
  }
  return rooms.length;
};

/** Drops every socket a person holds — on deactivation or a role change, so the next connection carries the account as it is now (CX21-491). */
const disconnectUser = (io, userId) => {
  if (!io?.in || !userId) return false;
  const room = io.in(ROOMS.user(userId));
  if (typeof room?.disconnectSockets !== "function") return false;
  room.disconnectSockets(true);
  return true;
};

const attachRealtime = (io) => {
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const user = socket.data?.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    socket.join(ROOMS.org(user.orgId));
    socket.join(ROOMS.user(user.id));

    socket.on("project:join", (payload, ack) =>
      handleProjectJoin(socket, payload, ack),
    );
    socket.on("project:leave", (payload, ack) =>
      handleProjectLeave(socket, payload, ack),
    );
    socket.emit("realtime.ready", {
      userId: user.id,
      orgId: user.orgId,
      connectedAt: new Date().toISOString(),
    });
  });

  const unsubscribe = subscribe((event) => {
    try {
      broadcastDomainEvent(io, event);
    } catch (error) {
      console.error("[realtime] broadcast failure", error);
    }
  });

  return {
    broadcast: (event) => broadcastDomainEvent(io, event),
    unsubscribe,
  };
};

module.exports = {
  DOMAIN_EVENT_NAME,
  ROOMS,
  attachRealtime,
  authenticateSocket,
  broadcastDomainEvent,
  disconnectUser,
  handleProjectJoin,
  handleProjectLeave,
  targetRoomsFor,
};
