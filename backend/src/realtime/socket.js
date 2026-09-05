const { verifyAccessToken } = require("../utils/tokens");
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

const authenticateSocket = (socket, next) => {
  try {
    const token = parseHandshakeToken(socket);
    if (!token) {
      return next(socketError("AUTH_REQUIRED", "Missing access token"));
    }

    const payload = verifyAccessToken(token);
    socket.data = socket.data || {};
    socket.data.user = {
      id: payload.sub,
      orgId: payload.orgId,
      role: payload.role,
      email: payload.email,
      name: payload.name,
    };
    return next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return next(socketError("TOKEN_EXPIRED", "Access token has expired"));
    }
    return next(socketError("INVALID_TOKEN", "Access token is invalid"));
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
    await assertProjectAccess({
      orgId: user.orgId,
      projectId,
      userId: user.id,
      role: user.role,
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
  payload: event.payload || {},
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
  handleProjectJoin,
  handleProjectLeave,
  targetRoomsFor,
};
