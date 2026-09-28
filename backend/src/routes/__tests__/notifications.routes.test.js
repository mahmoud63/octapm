const express = require("express");
const request = require("supertest");

const mockNotificationService = {
  CATEGORY_ORDER: [
    "assignment",
    "due",
    "overdue",
    "approval",
    "commercial",
    "quality",
    "safety",
    "task",
    "workflow",
  ],
  getNotificationSummary: jest.fn(),
  getUserPreferences: jest.fn(),
  updateUserPreferences: jest.fn(),
  listNotifications: jest.fn(),
  markAllRead: jest.fn(),
  processPendingEmailDeliveries: jest.fn(),
  runDueNotificationScan: jest.fn(),
  getNotificationForUser: jest.fn(),
  markNotificationRead: jest.fn(),
  archiveNotification: jest.fn(),
  retryNotificationEmail: jest.fn(),
};

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: "user-1",
      orgId: "org-1",
      role: req.get("x-role") || "site_engineer",
      email: "site@example.com",
    };
    // an API key acting as this person (CX21-494)
    if (req.get("x-api-key")) req.apiClient = { id: "key-1", scopes: ["*:read", "*:write"], projectIds: [] };
    next();
  },
}));

jest.mock("../../services/notification.service", () => mockNotificationService);
const mockPushService = {
  EXPO_TOKEN_PATTERN: /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/,
  isConfigured: jest.fn(() => false),
  getPublicKey: jest.fn(() => null),
  subscribe: jest.fn(async ({ subscription }) => ({ id: "sub-1", ...subscription })),
  unsubscribe: jest.fn(async () => ({ removed: 1 })),
  listSubscriptions: jest.fn(async () => ({ configured: false, items: [] })),
  sendTest: jest.fn(),
};
jest.mock("../../services/push.service", () => mockPushService);

const notificationsRouter = require("../notifications");

const notificationId = "11111111-1111-4111-8111-111111111111";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/notifications", notificationsRouter);
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

describe("notification routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists only the authenticated user's notifications", async () => {
    mockNotificationService.listNotifications.mockResolvedValue({
      rows: [],
      pagination: { limit: 25, nextCursor: null },
    });

    const res = await request(buildApp()).get(
      "/notifications?status=unread&category=approval",
    );

    expect(res.status).toBe(200);
    expect(mockNotificationService.listNotifications).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: "user-1",
      // The reader, so a stored row is re-rendered as they may receive it.
      viewer: expect.objectContaining({ id: "user-1", orgId: "org-1" }),
      query: expect.objectContaining({
        status: "unread",
        category: "approval",
      }),
    });
  });

  it("updates preferences for the authenticated user", async () => {
    mockNotificationService.updateUserPreferences.mockResolvedValue({
      preferences: [],
    });

    const res = await request(buildApp())
      .put("/notifications/preferences")
      .send({
        preferences: [
          {
            category: "approval",
            inAppEnabled: true,
            emailEnabled: false,
            dueSoonDays: 5,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(mockNotificationService.updateUserPreferences).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: "user-1",
      preferences: [
        {
          category: "approval",
          inAppEnabled: true,
          emailEnabled: false,
          dueSoonDays: 5,
        },
      ],
    });
  });

  it("marks a scoped notification as read", async () => {
    mockNotificationService.markNotificationRead.mockResolvedValue({
      id: notificationId,
      status: "read",
    });

    const res = await request(buildApp())
      .patch(`/notifications/${notificationId}/read`)
      .send({ read: true });

    expect(res.status).toBe(200);
    expect(mockNotificationService.markNotificationRead).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: "user-1",
      notificationId,
      read: true,
      viewer: expect.objectContaining({ id: "user-1", orgId: "org-1" }),
    });
  });

  it("limits due scans to PM and planning roles", async () => {
    mockNotificationService.runDueNotificationScan.mockResolvedValue({
      projects: 1,
      created: 2,
    });

    const denied = await request(buildApp())
      .post("/notifications/scan-due")
      .set("x-role", "site_engineer")
      .send({});

    expect(denied.status).toBe(403);
    expect(
      mockNotificationService.runDueNotificationScan,
    ).not.toHaveBeenCalled();

    const allowed = await request(buildApp())
      .post("/notifications/scan-due")
      .set("x-role", "pm")
      .send({ horizonDays: 7 });

    expect(allowed.status).toBe(201);
    expect(mockNotificationService.runDueNotificationScan).toHaveBeenCalledWith(
      {
        orgId: "org-1",
        projectId: null,
        horizonDays: 7,
      },
    );
  });
});

describe("Phase 21D — integrity (release challenge, ninth pass)", () => {
  it("MOBILE-M9: the field app registers an Expo push token on the subscription route and removes it by token", async () => {
    const app = buildApp();
    const registered = await request(app).post("/notifications/push/subscriptions").send({ provider: "expo", token: "ExponentPushToken[abc-123]", platform: "android", deviceName: "Pixel 8" });
    expect(registered.status).toBe(201);
    expect(mockPushService.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "user-1", subscription: { provider: "expo", token: "ExponentPushToken[abc-123]", platform: "android" }, userAgent: "Pixel 8" }),
    );
    expect((await request(app).post("/notifications/push/subscriptions").send({ provider: "expo", token: "not-a-token", platform: "android" })).status).toBe(400);
    expect((await request(app).post("/notifications/push/subscriptions").send({ provider: "expo", token: "ExponentPushToken[abc-123]", platform: "web" })).status).toBe(400);
    // A browser still needs its endpoint and keys.
    expect((await request(app).post("/notifications/push/subscriptions").send({ endpoint: "https://push.example/abc" })).status).toBe(400);
    const removed = await request(app).delete("/notifications/push/subscriptions").send({ token: "ExponentPushToken[abc-123]" });
    expect(removed.status).toBe(200);
    expect(mockPushService.unsubscribe).toHaveBeenCalledWith({ userId: "user-1", endpoint: "ExponentPushToken[abc-123]" });
  });

  it("CX21-494: a person's notifications, their summary and their preferences are not reached with an API key, whatever its scopes", async () => {
    const app = buildApp();
    for (const path of ["/notifications", "/notifications/summary", "/notifications/preferences", "/notifications/push/subscriptions"]) {
      const res = await request(app).get(path).set("x-api-key", "1");
      expect([path, res.status, res.body?.error?.code]).toEqual([path, 403, "API_KEY_FORBIDDEN"]);
    }
    const marked = await request(app).post("/notifications/mark-read").set("x-api-key", "1");
    expect(marked.status).toBe(403);
    expect(mockNotificationService.listNotifications).not.toHaveBeenCalled();
    expect(mockNotificationService.getNotificationSummary).not.toHaveBeenCalled();
    expect(mockNotificationService.markAllRead).not.toHaveBeenCalled();
    // the person still reaches their own
    mockNotificationService.listNotifications.mockResolvedValue({ rows: [], pagination: { hasMore: false, nextCursor: null } });
    expect((await request(app).get("/notifications")).status).toBe(200);
  });
});
