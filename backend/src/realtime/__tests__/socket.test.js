const mockVerifyAccessToken = jest.fn();
const mockAssertProjectAccess = jest.fn();

jest.mock("../../utils/tokens", () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));
jest.mock("../../services/project-authorization.service", () => ({
  assertProjectAccess: mockAssertProjectAccess,
}));

const bus = require("../../events/bus");
const {
  ROOMS,
  attachRealtime,
  authenticateSocket,
  broadcastDomainEvent,
  handleProjectJoin,
  targetRoomsFor,
} = require("../socket");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const createFakeSocket = ({ auth = {}, headers = {} } = {}) => ({
  handshake: { auth, headers },
  data: {},
  join: jest.fn().mockResolvedValue(undefined),
  leave: jest.fn().mockResolvedValue(undefined),
  emit: jest.fn(),
  on: jest.fn(),
  disconnect: jest.fn(),
});

const createFakeIo = () => {
  const emits = [];
  const io = {
    use: jest.fn(),
    on: jest.fn(),
    to: jest.fn((room) => ({
      emit: (name, payload) => emits.push({ room, name, payload }),
    })),
  };
  return { io, emits };
};

describe("realtime socket auth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects sockets without a token", () => {
    const next = jest.fn();
    authenticateSocket(createFakeSocket(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].data).toEqual({ code: "AUTH_REQUIRED" });
    expect(mockVerifyAccessToken).not.toHaveBeenCalled();
  });

  it("rejects invalid or expired tokens with stable codes", () => {
    const expired = new Error("jwt expired");
    expired.name = "TokenExpiredError";
    mockVerifyAccessToken.mockImplementationOnce(() => {
      throw expired;
    });
    const next = jest.fn();
    authenticateSocket(createFakeSocket({ auth: { token: "abc" } }), next);
    expect(next.mock.calls[0][0].data).toEqual({ code: "TOKEN_EXPIRED" });

    mockVerifyAccessToken.mockImplementationOnce(() => {
      throw new Error("bad");
    });
    const next2 = jest.fn();
    authenticateSocket(createFakeSocket({ auth: { token: "abc" } }), next2);
    expect(next2.mock.calls[0][0].data).toEqual({ code: "INVALID_TOKEN" });
  });

  it("accepts bearer headers and stores the user on the socket", () => {
    mockVerifyAccessToken.mockReturnValue({
      sub: "user-1",
      orgId: "org-1",
      role: "pm",
      email: "pm@example.com",
      name: "PM",
    });
    const socket = createFakeSocket({
      headers: { authorization: "Bearer token-1" },
    });
    const next = jest.fn();

    authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user).toEqual({
      id: "user-1",
      orgId: "org-1",
      role: "pm",
      email: "pm@example.com",
      name: "PM",
    });
  });
});

describe("realtime project rooms", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("joins a project room only after the project access check passes", async () => {
    mockAssertProjectAccess.mockResolvedValue({ id: PROJECT_ID });
    const socket = createFakeSocket();
    socket.data.user = { id: "user-1", orgId: "org-1", role: "site_engineer" };
    const ack = jest.fn();

    await handleProjectJoin(socket, { projectId: PROJECT_ID }, ack);

    expect(mockAssertProjectAccess).toHaveBeenCalledWith({
      orgId: "org-1",
      projectId: PROJECT_ID,
      userId: "user-1",
      role: "site_engineer",
    });
    expect(socket.join).toHaveBeenCalledWith(ROOMS.project(PROJECT_ID));
    expect(ack).toHaveBeenCalledWith({ ok: true, projectId: PROJECT_ID });
  });

  it("refuses to join when access is denied and reports the error code", async () => {
    const denied = new Error("nope");
    denied.code = "PROJECT_ACCESS_DENIED";
    mockAssertProjectAccess.mockRejectedValue(denied);
    const socket = createFakeSocket();
    socket.data.user = { id: "user-1", orgId: "org-1", role: "finance" };
    const ack = jest.fn();

    await handleProjectJoin(socket, { projectId: PROJECT_ID }, ack);

    expect(socket.join).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      projectId: PROJECT_ID,
      code: "PROJECT_ACCESS_DENIED",
    });
  });

  it("validates the project id before touching the database", async () => {
    const socket = createFakeSocket();
    socket.data.user = { id: "user-1", orgId: "org-1", role: "pm" };
    const ack = jest.fn();

    await handleProjectJoin(socket, { projectId: "not-a-uuid" }, ack);

    expect(mockAssertProjectAccess).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ ok: false, code: "VALIDATION_ERROR" });
  });
});

describe("realtime broadcast", () => {
  it("routes record events to the project room and notifications to user rooms", () => {
    const { io, emits } = createFakeIo();

    broadcastDomainEvent(
      io,
      bus.normalizeEvent({
        type: bus.EVENT_TYPES.RECORD_CHANGED,
        orgId: "org-1",
        projectId: PROJECT_ID,
        entityType: "rfi",
        entityId: "rfi-1",
        action: "updated",
      }),
    );
    broadcastDomainEvent(
      io,
      bus.normalizeEvent({
        type: bus.EVENT_TYPES.NOTIFICATION_CREATED,
        orgId: "org-1",
        projectId: PROJECT_ID,
        recipientUserIds: ["u1", "u2"],
      }),
    );

    expect(emits.map((entry) => entry.room)).toEqual([
      ROOMS.project(PROJECT_ID),
      ROOMS.user("u1"),
      ROOMS.user("u2"),
    ]);
    expect(emits[0].name).toBe("domain.event");
    expect(emits[0].payload).toEqual(
      expect.objectContaining({ entityType: "rfi", action: "updated" }),
    );
    expect(emits[0].payload.recipientUserIds).toBeUndefined();
  });

  it("drops events with no deliverable audience", () => {
    expect(
      targetRoomsFor(
        bus.normalizeEvent({ type: "record.changed", orgId: "org-1" }),
      ),
    ).toEqual([]);
  });

  it("subscribes to the bus when attached and fans out published events", () => {
    const { io, emits } = createFakeIo();
    const handle = attachRealtime(io);

    expect(io.use).toHaveBeenCalledWith(authenticateSocket);
    expect(io.on).toHaveBeenCalledWith("connection", expect.any(Function));

    bus.publish(
      {
        type: bus.EVENT_TYPES.RECORD_CHANGED,
        orgId: "org-1",
        projectId: PROJECT_ID,
        entityType: "location",
        entityId: "loc-1",
        action: "created",
      },
      { delayMs: 0 },
    );

    expect(emits).toHaveLength(1);
    handle.unsubscribe();
  });

  it("joins org and user rooms on connection", () => {
    const { io } = createFakeIo();
    const handle = attachRealtime(io);
    const onConnection = io.on.mock.calls.find(
      ([name]) => name === "connection",
    )[1];
    const socket = createFakeSocket();
    socket.data.user = { id: "user-1", orgId: "org-1", role: "pm" };

    onConnection(socket);

    expect(socket.join).toHaveBeenCalledWith(ROOMS.org("org-1"));
    expect(socket.join).toHaveBeenCalledWith(ROOMS.user("user-1"));
    expect(socket.on).toHaveBeenCalledWith("project:join", expect.any(Function));
    expect(socket.emit).toHaveBeenCalledWith(
      "realtime.ready",
      expect.objectContaining({ userId: "user-1", orgId: "org-1" }),
    );
    handle.unsubscribe();
  });
});
