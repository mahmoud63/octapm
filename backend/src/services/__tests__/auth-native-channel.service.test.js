const jwt = require("jsonwebtoken");

const mockTx = {
  refreshSession: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(),
  refreshSession: { updateMany: jest.fn() },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const authService = require("../auth.service");
const { createRefreshToken, hashRefreshToken } = require("../../utils/tokens");

const activeUser = {
  id: "user-1",
  orgId: "org-1",
  name: "Project Manager",
  email: "pm@example.com",
  phone: null,
  role: "pm",
  status: "active",
};

const liveSession = (token, id = "session-1") => ({
  id,
  userId: activeUser.id,
  orgId: activeUser.orgId,
  tokenHash: hashRefreshToken(token),
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  revokedAt: null,
  replacedBySessionId: null,
  user: activeUser,
});

/**
 * A refresh token belongs to the channel it was issued on. A native token is
 * rotated into another native token; presented as a cookie it is refused and
 * its family revoked; and tokens minted before the claim existed still work
 * for the browser they were issued to.
 */
describe("refresh token channel binding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = "access-secret-with-at-least-32-characters";
    process.env.JWT_REFRESH_SECRET = "refresh-secret-with-at-least-32-characters";
    process.env.JWT_EXPIRY = "15m";
    process.env.JWT_REFRESH_EXPIRY = "7d";
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockTx));
    mockTx.refreshSession.create.mockImplementation(async ({ data }) => data);
    mockTx.refreshSession.update.mockResolvedValue({});
    mockTx.refreshSession.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.refreshSession.updateMany.mockResolvedValue({ count: 1 });
  });

  it("mints a native token with the channel claim and stores only its hash", async () => {
    const token = createRefreshToken(activeUser, "session-1", "mobile");
    expect(jwt.decode(token).cli).toBe("mobile");
    expect(jwt.decode(createRefreshToken(activeUser, "session-2")).cli).toBe("web");
    expect(token).not.toBe(hashRefreshToken(token));
  });

  it("rotates a native token into another native token", async () => {
    const original = createRefreshToken(activeUser, "session-1", "mobile");
    mockTx.refreshSession.findUnique.mockResolvedValue(liveSession(original));

    const result = await authService.refresh({ refreshToken: original, client: "mobile", userAgent: "OctaPM/1.0", ipAddress: "10.0.0.2" });

    expect(jwt.decode(result.refreshToken).cli).toBe("mobile");
    expect(result.refreshToken).not.toBe(original);
    const stored = mockTx.refreshSession.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(hashRefreshToken(result.refreshToken));
    expect(stored.tokenHash).not.toContain(result.refreshToken);
    expect(mockTx.refreshSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "session-1" }, data: expect.objectContaining({ replacedBySessionId: stored.id }) }),
    );
  });

  it("refuses a native token presented through the cookie path, and revokes the family", async () => {
    const native = createRefreshToken(activeUser, "session-1", "mobile");
    mockTx.refreshSession.findUnique.mockResolvedValue({ ...liveSession(native), replacedBySessionId: "session-0" });

    await expect(authService.refresh({ refreshToken: native, client: "web" })).rejects.toMatchObject({
      status: 401,
      code: "REFRESH_TOKEN_CHANNEL_MISMATCH",
    });
    expect(mockPrisma.refreshSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["session-1", "session-0"] } }) }),
    );
    expect(mockTx.refreshSession.create).not.toHaveBeenCalled();
  });

  it("refuses a browser token presented by a native client the same way", async () => {
    const web = createRefreshToken(activeUser, "session-1");
    mockTx.refreshSession.findUnique.mockResolvedValue(liveSession(web));
    await expect(authService.refresh({ refreshToken: web, client: "mobile" })).rejects.toMatchObject({ code: "REFRESH_TOKEN_CHANNEL_MISMATCH" });
    expect(mockTx.refreshSession.create).not.toHaveBeenCalled();
  });

  it("still honours a browser token minted before the claim existed", async () => {
    const legacy = jwt.sign({ sub: activeUser.id, orgId: activeUser.orgId, role: "pm", type: "refresh" }, process.env.JWT_REFRESH_SECRET, { expiresIn: "7d", jwtid: "session-1" });
    mockTx.refreshSession.findUnique.mockResolvedValue(liveSession(legacy));
    const result = await authService.refresh({ refreshToken: legacy });
    expect(jwt.decode(result.refreshToken).cli).toBe("web");
  });

  it("still detects a replayed native token and revokes the whole family", async () => {
    const replayed = createRefreshToken(activeUser, "session-1", "mobile");
    mockTx.refreshSession.findUnique.mockResolvedValue({ ...liveSession(replayed), revokedAt: new Date(), replacedBySessionId: "session-2" });
    await expect(authService.refresh({ refreshToken: replayed, client: "mobile" })).rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSED" });
    expect(mockPrisma.refreshSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["session-1", "session-2"] } }) }),
    );
  });

  it("refuses to refresh a disabled user, on either channel", async () => {
    const token = createRefreshToken(activeUser, "session-1", "mobile");
    mockTx.refreshSession.findUnique.mockResolvedValue({ ...liveSession(token), user: { ...activeUser, status: "disabled" } });
    await expect(authService.refresh({ refreshToken: token, client: "mobile" })).rejects.toMatchObject({ status: 401 });
  });

  it("logs out only on the channel the token was issued to", async () => {
    const native = createRefreshToken(activeUser, "session-1", "mobile");
    mockPrisma.refreshSession.updateMany.mockResolvedValue({ count: 1 });
    await expect(authService.logout({ refreshToken: native, client: "web" })).resolves.toEqual({ revoked: false });
    expect(mockPrisma.refreshSession.updateMany).not.toHaveBeenCalled();
    await expect(authService.logout({ refreshToken: native, client: "mobile" })).resolves.toEqual({ revoked: true });
    expect(mockPrisma.refreshSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "session-1", tokenHash: hashRefreshToken(native) }) }),
    );
  });
});
