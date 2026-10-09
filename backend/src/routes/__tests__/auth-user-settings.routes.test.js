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

const mockUserSettingsService = {
  LANGUAGES: new Set(["en", "fr"]),
  THEMES: new Set(["light", "dark", "system"]),
  FONTS: new Set(["inter", "manrope", "system"]),
  DISPLAY_ITEMS: new Set(["dashboard", "projects", "tasks"]),
  getUserSettings: jest.fn(),
  updateAccountSettings: jest.fn(),
  updateAppearanceSettings: jest.fn(),
  updateDisplaySettings: jest.fn(),
  updateProfileSettings: jest.fn(),
};

jest.mock("../../services/auth.service", () => mockAuthService);
jest.mock(
  "../../services/user-settings.service",
  () => mockUserSettingsService,
);
jest.mock("../../middleware/auth", () => ({
  authenticate: (req, res, next) => {
    if (req.get("x-skip-auth") === "true") {
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
        },
      });
    }

    req.user = {
      id: "user-1",
      orgId: "org-1",
      role: "site_engineer",
      email: "site@example.com",
    };
    return next();
  },
  // The MFA routes' SSO-session guard (D-ID-1 Q2); not exercised here.
  requireCredentialSession: (_req, _res, next) => next(),
}));

const authRouter = require("../auth");

const settingsResponse = {
  user: {
    id: "user-1",
    orgId: "org-1",
    name: "Site User",
    email: "site@example.com",
    role: "site_engineer",
    status: "active",
  },
  profile: {
    username: "Site User",
    email: "site@example.com",
    bio: "",
    urls: [],
  },
  account: {
    name: "Site User",
    dob: null,
    language: "en",
  },
  appearance: {
    theme: "dark",
    font: "inter",
  },
  display: {
    items: ["dashboard", "projects"],
  },
};

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

describe("auth user settings routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns settings for the authenticated user only", async () => {
    mockUserSettingsService.getUserSettings.mockResolvedValue(settingsResponse);

    const res = await request(buildApp()).get("/auth/me/settings");

    expect(res.status).toBe(200);
    expect(mockUserSettingsService.getUserSettings).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: "user-1",
    });
    expect(res.body.data.profile.email).toBe("site@example.com");
  });

  it("updates account settings for the authenticated user only", async () => {
    mockUserSettingsService.updateAccountSettings.mockResolvedValue({
      ...settingsResponse,
      account: { name: "Updated User", dob: null, language: "fr" },
    });

    const res = await request(buildApp())
      .patch("/auth/me/account")
      .send({ name: "Updated User", dob: null, language: "fr" });

    expect(res.status).toBe(200);
    expect(mockUserSettingsService.updateAccountSettings).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: "user-1",
      payload: { name: "Updated User", dob: null, language: "fr" },
    });
  });

  it("denies unauthenticated settings updates", async () => {
    const res = await request(buildApp())
      .patch("/auth/me/display")
      .set("x-skip-auth", "true")
      .send({ items: ["dashboard"] });

    expect(res.status).toBe(401);
    expect(mockUserSettingsService.updateDisplaySettings).not.toHaveBeenCalled();
  });

  it("validates display payloads before saving", async () => {
    const res = await request(buildApp())
      .patch("/auth/me/display")
      .send({ items: ["bad-section"] });

    expect(res.status).toBe(400);
    expect(mockUserSettingsService.updateDisplaySettings).not.toHaveBeenCalled();
  });
});
