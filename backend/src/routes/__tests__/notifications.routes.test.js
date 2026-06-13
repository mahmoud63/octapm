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
    next();
  },
}));

jest.mock("../../services/notification.service", () => mockNotificationService);

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
