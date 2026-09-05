const mockPrisma = {
  pushSubscription: {
    upsert: jest.fn(async ({ create }) => ({ id: "sub-1", ...create, createdAt: new Date() })),
    deleteMany: jest.fn(async () => ({ count: 1 })),
    findMany: jest.fn(async () => []),
    update: jest.fn(async () => ({})),
    delete: jest.fn(async () => ({})),
  },
  notificationDeliveryAttempt: {
    findMany: jest.fn(async () => []),
    update: jest.fn(async () => ({})),
    create: jest.fn(async () => ({})),
  },
};
const mockWebPush = { setVapidDetails: jest.fn(), sendNotification: jest.fn(async () => ({ statusCode: 201 })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("web-push", () => mockWebPush, { virtual: true });

const service = require("../push.service");

const device = (overrides = {}) => ({ id: "sub-1", userId: "user-1", endpoint: "https://push.example/abc", p256dh: "p", auth: "a", failureCount: 0, ...overrides });

describe("push service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VAPID_PUBLIC_KEY = "public-key";
    process.env.VAPID_PRIVATE_KEY = "private-key";
    process.env.VAPID_SUBJECT = "mailto:ops@example.com";
    service.resetConfiguration();
  });

  it("reports the public key only when both VAPID keys are set", () => {
    expect(service.isConfigured()).toBe(true);
    expect(service.getPublicKey()).toBe("public-key");
    expect(mockWebPush.setVapidDetails).toHaveBeenCalledWith("mailto:ops@example.com", "public-key", "private-key");
    delete process.env.VAPID_PRIVATE_KEY;
    service.resetConfiguration();
    expect(service.isConfigured()).toBe(false);
    expect(service.getPublicKey()).toBeNull();
  });

  it("validates and upserts a browser subscription by endpoint", async () => {
    await expect(service.subscribe({ orgId: "org", userId: "user-1", subscription: { endpoint: "http://insecure", keys: { p256dh: "p", auth: "a" } } })).rejects.toMatchObject({ code: "PUSH_ENDPOINT_INVALID" });
    await expect(service.subscribe({ orgId: "org", userId: "user-1", subscription: { endpoint: "https://push.example/abc", keys: { p256dh: "p" } } })).rejects.toMatchObject({ code: "PUSH_KEYS_REQUIRED" });
    const row = await service.subscribe({ orgId: "org", userId: "user-1", subscription: { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" });
    expect(mockPrisma.pushSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { endpoint: "https://push.example/abc" }, create: expect.objectContaining({ platform: "ios", failureCount: 0 }) }));
    expect(row.endpoint).toBe("https://push.example/abc");
  });

  it("sends to every device and drops endpoints the push service says are gone", async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([device(), device({ id: "sub-2", endpoint: "https://push.example/gone" })]);
    mockWebPush.sendNotification.mockImplementation(async (subscription) => {
      if (subscription.endpoint.endsWith("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });
    const result = await service.sendToUser({ userId: "user-1", payload: { title: "Hi", body: "there", url: "/x" } });
    expect(result).toMatchObject({ sent: 1, failed: 1, removed: 1 });
    expect(mockPrisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: "sub-2" } });
    expect(mockWebPush.sendNotification).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "https://push.example/abc" }), JSON.stringify({ title: "Hi", body: "there", url: "/x" }), expect.objectContaining({ TTL: expect.any(Number) }));
  });

  it("processes pending push attempts: sent, retried, and skipped without keys", async () => {
    const now = new Date("2026-09-06T10:00:00Z");
    const notification = { id: "n1", orgId: "org", title: "PL-001 assigned", message: "Fix the door", actionUrl: "/projects/p/quality/defects", entityType: "punch_item", entityId: "pi-1", category: "assignment", priority: "high" };
    mockPrisma.notificationDeliveryAttempt.findMany.mockResolvedValue([{ id: "att-1", userId: "user-1", attemptNumber: 1, notification }]);
    mockPrisma.pushSubscription.findMany.mockResolvedValue([device()]);
    mockWebPush.sendNotification.mockResolvedValue({ statusCode: 201 });
    let result = await service.processPendingPushDeliveries({ now });
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(mockPrisma.notificationDeliveryAttempt.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "att-1" }, data: expect.objectContaining({ status: "sent", provider: "web-push" }) }));
    expect(mockWebPush.sendNotification).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('"tag":"punch_item:pi-1"'), expect.objectContaining({ urgency: "high" }));

    jest.clearAllMocks();
    mockPrisma.notificationDeliveryAttempt.findMany.mockResolvedValue([{ id: "att-2", userId: "user-1", attemptNumber: 1, notification }]);
    mockPrisma.pushSubscription.findMany.mockResolvedValue([device()]);
    mockWebPush.sendNotification.mockRejectedValue(Object.assign(new Error("Service unavailable"), { statusCode: 503 }));
    result = await service.processPendingPushDeliveries({ now });
    expect(result).toMatchObject({ failed: 1 });
    expect(mockPrisma.notificationDeliveryAttempt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ channel: "push", attemptNumber: 2 }) }));

    jest.clearAllMocks();
    delete process.env.VAPID_PUBLIC_KEY;
    service.resetConfiguration();
    mockPrisma.notificationDeliveryAttempt.findMany.mockResolvedValue([{ id: "att-3", userId: "user-1", attemptNumber: 1, notification }]);
    result = await service.processPendingPushDeliveries({ now });
    expect(result).toMatchObject({ skipped: 1 });
    expect(mockPrisma.notificationDeliveryAttempt.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "skipped", errorCode: "PUSH_NOT_CONFIGURED" }) }));
  });

  it("refuses a test push when not configured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    service.resetConfiguration();
    await expect(service.sendTest({ userId: "user-1" })).rejects.toMatchObject({ code: "PUSH_NOT_CONFIGURED" });
  });
});
