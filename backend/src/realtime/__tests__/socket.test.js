const mockVerifyAccessToken = jest.fn();
const mockAssertProjectAccess = jest.fn();
// The account the token names, as it stands now (CX21-491): active in org-1 unless a test says otherwise.
const mockPrisma = { user: { findUnique: jest.fn(async () => ({ id: "user-1", orgId: "org-1", status: "active", isCompanyAdmin: false })) } };
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

// The real credential-epoch comparison (D-ID-1 Q6); only the signature check is stubbed.
jest.mock("../../utils/tokens", () => ({
  ...jest.requireActual("../../utils/tokens"),
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
  deliverDomainEvent,
  disconnectMembership,
  disconnectStanding,
  disconnectUser,
  forgetMemberKeys,
  handleProjectJoin,
  memberRoomKey,
  resolveMemberKeys,
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

  it("accepts bearer headers and stores the user on the socket", async () => {
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

    await authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith();
    // The principal shape authenticate builds (membership doc §3); with no
    // membership row the User columns speak and membershipId is null.
    expect(socket.data.user).toEqual({
      id: "user-1",
      orgId: "org-1",
      role: "pm",
      email: "pm@example.com",
      name: "PM",
      isCompanyAdmin: false,
      isAdmin: false,
      isOwner: false,
      kind: "member",
      membershipId: null,
      orgKind: "company",
      orgSlug: null,
      credentialEpoch: 0,
    });
  });

  // Owner decision D-ID-1 Q6: a token minted before the identity's last
  // credential event (a reset, the identity closed) opens no socket.
  it("refuses a token minted before the identity's last credential event with SESSION_REVOKED", async () => {
    mockVerifyAccessToken.mockReturnValue({ sub: "user-1", orgId: "org-1", role: "pm", cep: 0 });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user-1", orgId: "org-1", status: "active", isCompanyAdmin: false, credentialEpoch: 1 });
    const socket = createFakeSocket({ auth: { token: "old-token" } });
    const next = jest.fn();

    await authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].data).toEqual({ code: "SESSION_REVOKED" });
    expect(socket.data.user).toBeUndefined();

    mockVerifyAccessToken.mockReturnValue({ sub: "user-1", orgId: "org-1", role: "pm", cep: 1 });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user-1", orgId: "org-1", status: "active", isCompanyAdmin: false, credentialEpoch: 1 });
    const current = createFakeSocket({ auth: { token: "new-token" } });
    const accepted = jest.fn();
    await authenticateSocket(current, accepted);
    expect(accepted).toHaveBeenCalledWith();
    expect(current.data.user).toMatchObject({ id: "user-1", credentialEpoch: 1 });
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
      isCompanyAdmin: false,
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

  // Codex D-ID-1 diff review #2: a socket opened before a reset (or an admin
  // factor reset) keeps its saved epoch; its next project join finds the
  // account's epoch moved, is refused SESSION_REVOKED and the socket goes.
  it("refuses a project join from a socket opened before the identity's last credential event, and disconnects it", async () => {
    mockAssertProjectAccess.mockResolvedValue({ id: PROJECT_ID });
    const socket = createFakeSocket();
    socket.data.user = { id: "user-1", orgId: "org-1", role: "pm", credentialEpoch: 0 };
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user-1", orgId: "org-1", status: "active", isCompanyAdmin: false, credentialEpoch: 1 });
    const ack = jest.fn();

    await handleProjectJoin(socket, { projectId: PROJECT_ID }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: false, projectId: PROJECT_ID, code: "SESSION_REVOKED" });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(mockAssertProjectAccess).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();

    // A socket at the account's current epoch joins as before.
    const current = createFakeSocket();
    current.data.user = { id: "user-1", orgId: "org-1", role: "pm", credentialEpoch: 1 };
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user-1", orgId: "org-1", status: "active", isCompanyAdmin: false, credentialEpoch: 1 });
    const joined = jest.fn();
    await handleProjectJoin(current, { projectId: PROJECT_ID }, joined);
    expect(joined).toHaveBeenCalledWith({ ok: true, projectId: PROJECT_ID });
    expect(current.disconnect).not.toHaveBeenCalled();
    expect(current.join).toHaveBeenCalledWith(ROOMS.project(PROJECT_ID));
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
  it("routes record events to the project room and notifications to the recipients' member rooms in the event's workspace", () => {
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

    // No membership model on this client: the legacy member key, which is
    // the room a socket without a membership joins — still one workspace.
    expect(emits.map((entry) => entry.room)).toEqual([
      ROOMS.project(PROJECT_ID),
      ROOMS.member(memberRoomKey({ orgId: "org-1", userId: "u1" })),
      ROOMS.member(memberRoomKey({ orgId: "org-1", userId: "u2" })),
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

  it("subscribes to the bus when attached and fans out published events", async () => {
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

    // The member rooms are resolved before the emit, so the fan-out lands a tick later.
    await new Promise((resolve) => setImmediate(resolve));
    expect(emits).toHaveLength(1);
    handle.unsubscribe();
  });

  it("joins org, user and member rooms on connection", () => {
    const { io } = createFakeIo();
    const handle = attachRealtime(io);
    const onConnection = io.on.mock.calls.find(
      ([name]) => name === "connection",
    )[1];
    const socket = createFakeSocket();
    socket.data.user = { id: "user-1", orgId: "org-1", role: "pm", membershipId: "mem-1" };

    onConnection(socket);

    expect(socket.join).toHaveBeenCalledWith(ROOMS.org("org-1"));
    expect(socket.join).toHaveBeenCalledWith(ROOMS.user("user-1"));
    expect(socket.join).toHaveBeenCalledWith(ROOMS.member("mem-1"));
    expect(socket.emit).toHaveBeenCalledWith(
      "realtime.ready",
      expect.objectContaining({ membershipId: "mem-1" }),
    );
    expect(socket.on).toHaveBeenCalledWith("project:join", expect.any(Function));
    expect(socket.emit).toHaveBeenCalledWith(
      "realtime.ready",
      expect.objectContaining({ userId: "user-1", orgId: "org-1" }),
    );
    handle.unsubscribe();
  });

  // Codex D-ID-1 diff review r2 #2: a handshake could read the account just
  // before a reset committed, miss the reset's disconnect sweep (the socket
  // was not in the person's rooms yet), then join them. Once in its rooms the
  // socket reads the account again and disconnects when it is gone or its
  // credential epoch is no longer the one the handshake saw.
  describe("re-reads the account once its rooms are joined (D-ID-1 Q6)", () => {
    const connect = (user) => {
      const { io } = createFakeIo();
      const handle = attachRealtime(io);
      const onConnection = io.on.mock.calls.find(([name]) => name === "connection")[1];
      const socket = createFakeSocket();
      socket.data.user = user;
      onConnection(socket);
      return { socket, handle };
    };
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    it("disconnects a socket whose handshake read the standing a credential event has since changed, after joining its rooms", async () => {
      // The handshake saw epoch 0; the reset committed before this read.
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user-1", orgId: "org-1", status: "active", isCompanyAdmin: false, credentialEpoch: 1 });
      const { socket, handle } = connect({ id: "user-1", orgId: "org-1", role: "pm", credentialEpoch: 0 });
      await settle();
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.findUnique.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...socket.join.mock.invocationCallOrder));
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      handle.unsubscribe();
    });

    it("disconnects a socket whose account is gone by the re-read", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      const { socket, handle } = connect({ id: "user-1", orgId: "org-1", role: "pm", credentialEpoch: 0 });
      await settle();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      handle.unsubscribe();
    });

    it("keeps a socket whose account still stands at the handshake's epoch", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user-1", orgId: "org-1", status: "active", isCompanyAdmin: false, credentialEpoch: 2 });
      const { socket, handle } = connect({ id: "user-1", orgId: "org-1", role: "pm", credentialEpoch: 2 });
      await settle();
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(socket.disconnect).not.toHaveBeenCalled();
      handle.unsubscribe();
    });
  });
});

describe("Phase 21D — integrity (release challenge, ninth pass)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("CX21-491: a deactivated or demoted account's still-valid token is refused at the handshake and at a project join, and a deactivation drops the person's sockets", async () => {
    mockVerifyAccessToken.mockReturnValue({ sub: "user-1", orgId: "org-1", role: "pm", email: "pm@example.com", name: "PM" });
    // deactivated: the handshake is refused although the token verifies
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user-1", orgId: "org-1", role: "pm", status: "inactive", isCompanyAdmin: false });
    const refused = jest.fn();
    await authenticateSocket(createFakeSocket({ auth: { token: "t" } }), refused);
    expect(refused.mock.calls[0][0].data).toEqual({ code: "USER_INACTIVE" });
    // demoted: the account's role reaches the socket, not the token's
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "user-1", orgId: "org-1", role: "site_engineer", status: "active", isCompanyAdmin: false });
    const socket = createFakeSocket({ auth: { token: "t" } });
    const accepted = jest.fn();
    await authenticateSocket(socket, accepted);
    expect(accepted).toHaveBeenCalledWith();
    expect(socket.data.user.role).toBe("site_engineer");
    // deactivated after connecting: the join is refused before the project is looked at
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    const ack = jest.fn();
    await handleProjectJoin(socket, { projectId: PROJECT_ID }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, projectId: PROJECT_ID, code: "USER_INACTIVE" });
    expect(mockAssertProjectAccess).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
    // and the deactivation itself drops every socket the person holds
    const disconnectSockets = jest.fn();
    const io = { in: jest.fn(() => ({ disconnectSockets })) };
    expect(disconnectUser(io, "user-1")).toBe(true);
    expect(io.in).toHaveBeenCalledWith(ROOMS.user("user-1"));
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });
});

describe("Phase 21D — integrity (release challenge, eleventh pass)", () => {
  it("CX21-523: a record event reaches the project room without the record's figures; an event addressed to people keeps its payload", () => {
    const { io, emits } = createFakeIo();
    broadcastDomainEvent(
      io,
      bus.normalizeEvent({
        type: bus.EVENT_TYPES.RECORD_CHANGED,
        orgId: "org-1",
        projectId: PROJECT_ID,
        entityType: "cost_record",
        entityId: "cr-1",
        action: "updated",
        payload: { oldStatus: null, newStatus: null, summary: { budget: 1000, committed: 250, actual: 400, material: 7 } },
      }),
    );
    broadcastDomainEvent(
      io,
      bus.normalizeEvent({
        type: bus.EVENT_TYPES.NOTIFICATION_CREATED,
        orgId: "org-1",
        projectId: PROJECT_ID,
        recipientUserIds: ["u1"],
        payload: { summary: { title: "Approved" } },
      }),
    );
    expect(emits[0].room).toBe(ROOMS.project(PROJECT_ID));
    expect(emits[0].payload.entityType).toBe("cost_record");
    expect(emits[0].payload.payload.summary).toBeUndefined();
    expect(JSON.stringify(emits[0].payload)).not.toMatch(/budget|committed|actual/);
    expect(emits[1].room).toBe(ROOMS.member(memberRoomKey({ orgId: "org-1", userId: "u1" })));
    expect(emits[1].payload.payload.summary).toEqual({ title: "Approved" });
  });
});

describe("ENT-5 — rooms keyed by membership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    forgetMemberKeys();
    delete mockPrisma.organizationMembership;
  });

  it("a notification reaches the recipient's member room in its workspace, never the user room across workspaces", async () => {
    mockPrisma.organizationMembership = {
      findMany: jest.fn(async ({ where }) => (where.orgId === "org-a" ? [{ id: "mem-a", userId: "u1" }] : [])),
      findFirst: jest.fn(),
    };
    const { io, emits } = createFakeIo();
    const inA = bus.normalizeEvent({ type: bus.EVENT_TYPES.NOTIFICATION_CREATED, orgId: "org-a", recipientUserIds: ["u1", "u2"] });
    const keys = await resolveMemberKeys(inA);
    expect(keys.get("u1")).toBe("mem-a");
    // u2 has no active membership in org-a: the legacy key, still scoped to org-a.
    expect(keys.get("u2")).toBe(memberRoomKey({ orgId: "org-a", userId: "u2" }));
    await deliverDomainEvent(io, inA);
    expect(emits.map((entry) => entry.room)).toEqual([ROOMS.member("mem-a"), ROOMS.member("legacy:org-a:u2")]);
    expect(emits.map((entry) => entry.room)).not.toContain(ROOMS.user("u1"));
    // The same person in org-b: their org-b membership is looked up, the org-a key is not reused.
    await deliverDomainEvent(io, bus.normalizeEvent({ type: bus.EVENT_TYPES.NOTIFICATION_CREATED, orgId: "org-b", recipientUserIds: ["u1"] }));
    expect(emits[2].room).toBe(ROOMS.member("legacy:org-b:u1"));
    // The key is remembered for a minute: a second event in org-a reads no row.
    mockPrisma.organizationMembership.findMany.mockClear();
    await deliverDomainEvent(io, inA);
    expect(mockPrisma.organizationMembership.findMany).not.toHaveBeenCalled();
  });

  it("disconnectMembership drops one membership's sockets; disconnectStanding picks the room from the rows as they stand", async () => {
    const disconnectSockets = jest.fn();
    const io = { in: jest.fn(() => ({ disconnectSockets })) };
    expect(disconnectMembership(io, "mem-a")).toBe(true);
    expect(io.in).toHaveBeenCalledWith(ROOMS.member("mem-a"));
    expect(disconnectSockets).toHaveBeenCalledWith(true);

    // A membership change: only that membership's room.
    io.in.mockClear();
    mockPrisma.user.findUnique.mockResolvedValueOnce({ status: "active" });
    mockPrisma.organizationMembership = { findFirst: jest.fn(async () => ({ id: "mem-a" })), findMany: jest.fn(async () => []) };
    expect(await disconnectStanding(io, { orgId: "org-a", userId: "u1" })).toEqual({ dropped: "membership", membershipId: "mem-a" });
    expect(io.in).toHaveBeenCalledTimes(1);
    expect(io.in).toHaveBeenCalledWith(ROOMS.member("mem-a"));

    // The identity closed (its last workspace deactivated it): every socket, in every workspace.
    io.in.mockClear();
    mockPrisma.user.findUnique.mockResolvedValueOnce({ status: "inactive" });
    expect(await disconnectStanding(io, { orgId: "org-a", userId: "u1" })).toEqual({ dropped: "user" });
    expect(io.in).toHaveBeenCalledWith(ROOMS.user("u1"));

    // No membership row (a workspace seeded before memberships): the legacy member room of that workspace.
    io.in.mockClear();
    mockPrisma.user.findUnique.mockResolvedValueOnce({ status: "active" });
    mockPrisma.organizationMembership.findFirst.mockResolvedValueOnce(null);
    expect(await disconnectStanding(io, { orgId: "org-a", userId: "u1" })).toEqual({ dropped: "legacy" });
    expect(io.in).toHaveBeenCalledWith(ROOMS.member("legacy:org-a:u1"));
  });
});
