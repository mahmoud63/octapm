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
  completeMfaLogin: jest.fn(),
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

const expiresAt = new Date("2030-01-01T00:00:00.000Z");
const sessionResult = (refreshToken = "refresh-token-1") => ({
  user,
  tokens: { accessToken: "access-token-1", tokenType: "Bearer", expiresIn: 900 },
  refreshToken,
  refreshTokenExpiresAt: expiresAt,
});

const NATIVE = { "X-OctaPM-Client": "mobile" };
const LONG_TOKEN = "refresh-token-that-is-comfortably-long-enough";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL_ERROR", message: err.message, details: err.details },
    }),
  );
  return app;
}

/**
 * The native-client session contract.
 *
 * A native app cannot keep an httpOnly cookie in its keychain, so when a
 * request identifies itself with X-OctaPM-Client: mobile the refresh token
 * travels in the body. Everything about the browser flow stays as it was: the
 * first block here is the proof.
 */
describe("native client session contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "test";
  });

  describe("the browser flow is unchanged", () => {
    it("still sets the httpOnly cookie and keeps the refresh token out of the body", async () => {
      mockAuthService.login.mockResolvedValue(sessionResult("cookie-token"));
      const res = await request(buildApp()).post("/auth/login").send({ email: "pm@example.com", password: "Password1" });
      expect(res.status).toBe(200);
      expect(res.headers["set-cookie"]?.join(";")).toMatch(/pmc_refresh_token=cookie-token/);
      expect(res.headers["set-cookie"]?.join(";")).toMatch(/HttpOnly/);
      expect(res.body.data.tokens.refreshToken).toBeUndefined();
      expect(res.body.data.tokens.refreshTokenExpiresAt).toBeUndefined();
      expect(mockAuthService.login).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ client: "web" }));
    });

    it("refuses a refresh token in the body from a browser, and still reads the cookie", async () => {
      mockAuthService.refresh.mockResolvedValue(sessionResult("rotated"));
      const noCookie = await request(buildApp()).post("/auth/refresh").send({ refreshToken: LONG_TOKEN });
      expect(noCookie.status).toBe(401);
      expect(noCookie.body.error.code).toBe("REFRESH_SESSION_REQUIRED");
      expect(mockAuthService.refresh).not.toHaveBeenCalled();

      const withCookie = await request(buildApp()).post("/auth/refresh").set("Cookie", "pmc_refresh_token=from-cookie").send({});
      expect(withCookie.status).toBe(200);
      expect(mockAuthService.refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: "from-cookie", client: "web" }));
      expect(withCookie.headers["set-cookie"]?.join(";")).toMatch(/pmc_refresh_token=rotated/);
      expect(withCookie.body.data.tokens.refreshToken).toBeUndefined();
    });
  });

  describe("a native client", () => {
    it("receives the refresh token in the body and no cookie at all", async () => {
      mockAuthService.login.mockResolvedValue(sessionResult("native-token"));
      const res = await request(buildApp()).post("/auth/login").set(NATIVE).send({ email: "pm@example.com", password: "Password1" });
      expect(res.status).toBe(200);
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(res.body.data.tokens).toEqual({
        accessToken: "access-token-1",
        tokenType: "Bearer",
        expiresIn: 900,
        refreshToken: "native-token",
        refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
      });
      expect(mockAuthService.login).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ client: "mobile" }));
    });

    it("presents the refresh token in the body and gets the rotated one back the same way", async () => {
      mockAuthService.refresh.mockResolvedValue(sessionResult("native-rotated"));
      const res = await request(buildApp()).post("/auth/refresh").set(NATIVE).send({ refreshToken: LONG_TOKEN });
      expect(res.status).toBe(200);
      expect(mockAuthService.refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: LONG_TOKEN, client: "mobile" }));
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(res.body.data.tokens.refreshToken).toBe("native-rotated");
    });

    it("is not allowed to fall back to a cookie", async () => {
      const res = await request(buildApp()).post("/auth/refresh").set(NATIVE).set("Cookie", "pmc_refresh_token=from-cookie").send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("REFRESH_SESSION_REQUIRED");
      expect(mockAuthService.refresh).not.toHaveBeenCalled();
    });

    it("rejects a malformed refresh token before it reaches the service", async () => {
      const res = await request(buildApp()).post("/auth/refresh").set(NATIVE).send({ refreshToken: "short" });
      expect(res.status).toBe(400);
      expect(mockAuthService.refresh).not.toHaveBeenCalled();
    });

    it("logs out by presenting the token, and the service is told which channel it came from", async () => {
      mockAuthService.logout.mockResolvedValue({ revoked: true });
      const res = await request(buildApp()).post("/auth/logout").set(NATIVE).send({ refreshToken: LONG_TOKEN });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ revoked: true });
      expect(mockAuthService.logout).toHaveBeenCalledWith({ refreshToken: LONG_TOKEN, client: "mobile" });
    });

    it("cannot use the header to change who it is: the same access token guards /auth/me", async () => {
      const res = await request(buildApp()).get("/auth/me").set(NATIVE);
      expect(res.status).toBe(401);
      expect(mockAuthService.getProfile).not.toHaveBeenCalled();
    });

    it("gets the same treatment on the second factor and on invitations", async () => {
      mockAuthService.completeMfaLogin.mockResolvedValue(sessionResult("after-mfa"));
      const mfa = await request(buildApp()).post("/auth/mfa/verify").set(NATIVE).send({ mfaToken: "mfa-token-long-enough-to-pass", code: "123456" });
      expect(mfa.status).toBe(200);
      expect(mfa.headers["set-cookie"]).toBeUndefined();
      expect(mfa.body.data.tokens.refreshToken).toBe("after-mfa");

      mockAuthService.acceptInvitation.mockResolvedValue(sessionResult("after-invite"));
      const invite = await request(buildApp()).post("/auth/invitations/accept").set(NATIVE).send({ token: "invitation-token-long-enough", name: "New Person", password: "Password1" });
      expect(invite.status).toBe(200);
      expect(invite.headers["set-cookie"]).toBeUndefined();
      expect(invite.body.data.tokens.refreshToken).toBe("after-invite");
    });
  });
});
