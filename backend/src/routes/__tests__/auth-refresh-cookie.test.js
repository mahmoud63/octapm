const express = require("express");
const request = require("supertest");

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
  getProfile: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  getInvitationPreview: jest.fn(),
  acceptInvitation: jest.fn(),
};

jest.mock("../../services/auth.service", () => mockAuthService);

const authRouter = require("../auth");

const user = {
  id: "user-1",
  orgId: "org-1",
  name: "Project Manager",
  email: "pm@example.com",
  phone: null,
  role: "pm",
  status: "active",
};

const sessionResult = (refreshToken = "refresh-token-1") => ({
  user,
  tokens: {
    accessToken: "access-token-1",
    tokenType: "Bearer",
    expiresIn: 900,
  },
  refreshToken,
  refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || "INTERNAL_ERROR",
        message: err.message,
        details: err.details,
      },
    }),
  );
  return app;
}

describe("auth refresh cookie security contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "test";
  });

  it("sets a httpOnly refresh cookie and does not leak refresh tokens in the login response body", async () => {
    mockAuthService.login.mockResolvedValue(
      sessionResult("refresh-token-login"),
    );

    const res = await request(buildApp()).post("/auth/login").send({
      email: "pm@example.com",
      password: "Password1",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.tokens).toEqual({
      accessToken: "access-token-1",
      tokenType: "Bearer",
      expiresIn: 900,
    });
    expect(res.body.data.tokens.refreshToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();

    const setCookie = res.get("Set-Cookie") || [];
    expect(setCookie.join(";")).toContain(
      "pmc_refresh_token=refresh-token-login",
    );
    expect(setCookie.join(";")).toContain("HttpOnly");
    expect(setCookie.join(";")).toContain("SameSite=Lax");
  });

  it("refreshes from the httpOnly cookie, rotates the cookie, and rejects body-only refresh tokens", async () => {
    mockAuthService.refresh.mockResolvedValue(
      sessionResult("refresh-token-rotated"),
    );

    const bodyOnly = await request(buildApp())
      .post("/auth/refresh")
      .send({ refreshToken: "body-token" });

    expect(bodyOnly.status).toBe(401);
    expect(mockAuthService.refresh).not.toHaveBeenCalled();

    const res = await request(buildApp())
      .post("/auth/refresh")
      .set("Cookie", ["pmc_refresh_token=refresh-token-original"])
      .send({});

    expect(res.status).toBe(200);
    expect(mockAuthService.refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: "refresh-token-original",
      }),
    );
    expect(res.body.data.tokens.refreshToken).toBeUndefined();
    expect(res.get("Set-Cookie").join(";")).toContain(
      "pmc_refresh_token=refresh-token-rotated",
    );
  });

  it("revokes the refresh session and clears the cookie on logout", async () => {
    mockAuthService.logout.mockResolvedValue({ revoked: true });

    const res = await request(buildApp())
      .post("/auth/logout")
      .set("Cookie", ["pmc_refresh_token=refresh-token-original"])
      .send({});

    expect(res.status).toBe(200);
    expect(mockAuthService.logout).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: "refresh-token-original",
      }),
    );
    expect(res.body).toEqual({
      success: true,
      data: { revoked: true },
    });
    expect(res.get("Set-Cookie").join(";")).toContain("pmc_refresh_token=;");
    expect(res.get("Set-Cookie").join(";")).toContain("HttpOnly");
    expect(res.get("Set-Cookie").join(";")).toContain("Max-Age=0");
  });

  it("requests and completes password resets through public auth endpoints", async () => {
    mockAuthService.requestPasswordReset.mockResolvedValue({ sent: true });
    mockAuthService.resetPassword.mockResolvedValue({ reset: true });

    const forgot = await request(buildApp())
      .post("/auth/forgot-password")
      .send({ email: "PM@EXAMPLE.COM" });

    expect(forgot.status).toBe(200);
    expect(forgot.body).toEqual({
      success: true,
      data: { sent: true },
    });
    expect(mockAuthService.requestPasswordReset).toHaveBeenCalledWith(
      { email: "pm@example.com" },
      expect.objectContaining({ ipAddress: expect.any(String) }),
    );

    const reset = await request(buildApp())
      .post("/auth/reset-password")
      .send({ token: "a".repeat(32), password: "Password1" });

    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({
      success: true,
      data: { reset: true },
    });
    expect(mockAuthService.resetPassword).toHaveBeenCalledWith(
      { token: "a".repeat(32), password: "Password1" },
      expect.objectContaining({ ipAddress: expect.any(String) }),
    );
  });

  // Codex D-ID-1 diff review #2: a reset ends the identity's live sockets too.
  // The service names whose sessions ended; the route drops that identity's
  // sockets and answers without the name.
  it("drops the identity's live sockets after a reset, and leaves endedSessionsOf out of the answer", async () => {
    const { ROOMS } = require("../../realtime/socket");
    mockAuthService.resetPassword.mockResolvedValue({ reset: true, endedSessionsOf: "user-1" });
    const disconnectSockets = jest.fn();
    const io = { in: jest.fn(() => ({ disconnectSockets })) };
    const app = buildApp();
    app.set("io", io);

    const reset = await request(app)
      .post("/auth/reset-password")
      .send({ token: "a".repeat(32), password: "Password1" });

    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ success: true, data: { reset: true } });
    expect(io.in).toHaveBeenCalledWith(ROOMS.user("user-1"));
    expect(disconnectSockets).toHaveBeenCalledWith(true);

    // A refused reset drops nobody.
    const { HttpError } = require("../../utils/http-error");
    io.in.mockClear();
    mockAuthService.resetPassword.mockRejectedValue(new HttpError(400, "PASSWORD_RESET_TOKEN_INVALID", "invalid"));
    const refused = await request(app)
      .post("/auth/reset-password")
      .send({ token: "a".repeat(32), password: "Password1" });
    expect(refused.status).toBe(400);
    expect(io.in).not.toHaveBeenCalled();
  });

  it("previews and accepts invitations without leaking refresh tokens in JSON", async () => {
    mockAuthService.getInvitationPreview.mockResolvedValue({
      email: "invited@example.com",
      role: "site_engineer",
      org: { id: "org-1", name: "Octa Builders" },
      project: null,
      expiresAt: new Date().toISOString(),
      existingUser: false,
      requiresPassword: true,
    });
    mockAuthService.acceptInvitation.mockResolvedValue(
      sessionResult("refresh-token-invite"),
    );

    const token = "b".repeat(32);
    const preview = await request(buildApp()).get(`/auth/invitations/${token}`);

    expect(preview.status).toBe(200);
    expect(preview.body.data.email).toBe("invited@example.com");
    expect(mockAuthService.getInvitationPreview).toHaveBeenCalledWith({
      token,
    });

    const accepted = await request(buildApp())
      .post("/auth/invitations/accept")
      .send({
        token,
        name: "Invited User",
        password: "Password1",
      });

    expect(accepted.status).toBe(200);
    expect(accepted.body.data.refreshToken).toBeUndefined();
    expect(accepted.body.data.tokens.refreshToken).toBeUndefined();
    expect(accepted.get("Set-Cookie").join(";")).toContain(
      "pmc_refresh_token=refresh-token-invite",
    );
  });
});
