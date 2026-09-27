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
    updateMany: jest.fn(async () => ({ count: 1 })),
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
    mockPrisma.pushSubscription.findMany.mockResolvedValue([device()]);
    await expect(service.sendTest({ userId: "user-1" })).rejects.toMatchObject({ code: "PUSH_NOT_CONFIGURED" });
  });

  it("registers a native device's Expo token on the same table and validates it", async () => {
    await expect(service.subscribe({ orgId: "org", userId: "user-1", subscription: { provider: "expo", token: "not-a-token", platform: "android" } })).rejects.toMatchObject({ code: "PUSH_TOKEN_INVALID" });
    await expect(service.subscribe({ orgId: "org", userId: "user-1", subscription: { provider: "expo", token: "ExponentPushToken[abc-123]", platform: "windows" } })).rejects.toMatchObject({ code: "PUSH_PLATFORM_INVALID" });
    const row = await service.subscribe({ orgId: "org", userId: "user-1", subscription: { provider: "expo", token: "ExponentPushToken[abc-123]", platform: "android" }, userAgent: "Pixel 8" });
    expect(mockPrisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: "ExponentPushToken[abc-123]" },
        create: expect.objectContaining({ endpoint: "ExponentPushToken[abc-123]", p256dh: "", auth: "", platform: "expo-android", userAgent: "Pixel 8", failureCount: 0 }),
      }),
    );
    expect(row).toMatchObject({ provider: "expo", endpoint: "ExponentPushToken[abc-123]", platform: "expo-android" });
  });

  it("sends native devices one Expo batch without VAPID keys, drops unregistered tokens and routes the record in the data", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    service.resetConfiguration();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "t1" }, { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }] }),
    }));
    global.fetch = fetchMock;
    mockPrisma.pushSubscription.findMany.mockResolvedValue([
      device({ id: "exp-1", endpoint: "ExponentPushToken[one]", p256dh: "", auth: "", platform: "expo-android" }),
      device({ id: "exp-2", endpoint: "ExponentPushToken[two]", p256dh: "", auth: "", platform: "expo-ios" }),
      device({ id: "web-1", endpoint: "https://push.example/browser" }),
    ]);
    const payload = service.payloadFor({ id: "n9", title: "RFI-004 answered", message: "See the answer", actionUrl: "/projects/p/rfi?recordId=r4", entityType: "rfi", entityId: "r4", projectId: "p", category: "workflow", priority: "high" });
    const result = await service.sendToUser({ userId: "user-1", payload, urgency: "high" });
    expect(result).toMatchObject({ sent: 1, failed: 1, removed: 1, skipped: false, provider: "expo" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(service.EXPO_PUSH_URL);
    const messages = JSON.parse(init.body);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ to: "ExponentPushToken[one]", title: "RFI-004 answered", priority: "high", data: { entityType: "rfi", entityId: "r4", projectId: "p", url: "/projects/p/rfi?recordId=r4" } });
    // The browser row is not sent without VAPID keys and is left alone.
    expect(mockWebPush.sendNotification).not.toHaveBeenCalled();
    expect(mockPrisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: "exp-2" } });
    expect(mockPrisma.pushSubscription.delete).not.toHaveBeenCalledWith({ where: { id: "web-1" } });
    expect(mockPrisma.pushSubscription.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "exp-1" }, data: expect.objectContaining({ failureCount: 0 }) }));

    // A pending attempt for that person is sent through Expo, not skipped as unconfigured.
    jest.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: "ok" }, { status: "ok" }] }) });
    mockPrisma.notificationDeliveryAttempt.findMany.mockResolvedValue([{ id: "att-9", userId: "user-1", attemptNumber: 1, notification: { id: "n9", orgId: "org", title: "t", message: "m", category: "workflow", priority: "normal" } }]);
    const processed = await service.processPendingPushDeliveries({ now: new Date("2026-09-18T10:00:00Z") });
    expect(processed).toMatchObject({ sent: 1, skipped: 0 });
    expect(mockPrisma.notificationDeliveryAttempt.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "att-9" }, data: expect.objectContaining({ status: "sent", provider: "expo" }) }));

    // When Expo itself is down the tokens are kept and the attempt fails for a retry.
    jest.clearAllMocks();
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    mockPrisma.notificationDeliveryAttempt.findMany.mockResolvedValue([{ id: "att-10", userId: "user-1", attemptNumber: 1, notification: { id: "n9", orgId: "org", title: "t", message: "m", category: "workflow", priority: "normal" } }]);
    const failed = await service.processPendingPushDeliveries({ now: new Date("2026-09-18T10:00:00Z") });
    expect(failed).toMatchObject({ failed: 1 });
    expect(mockPrisma.pushSubscription.delete).not.toHaveBeenCalled();
    expect(mockPrisma.notificationDeliveryAttempt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ channel: "push", attemptNumber: 2 }) }));
    delete global.fetch;
  });
});

describe("ENT-5 — the push payload carries the workspace", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.resetWorkspaceCache();
    delete mockPrisma.organisation;
    delete mockPrisma.organizationMembership;
  });

  it("names the notification's workspace and the recipient's membership in it, per identity device", async () => {
    mockPrisma.organisation = { findUnique: jest.fn(async () => ({ slug: "acme" })) };
    mockPrisma.organizationMembership = { findFirst: jest.fn(async ({ where }) => (where.userId === "user-1" ? { id: "mem-1", status: "active" } : null)) };
    const notification = { id: "n1", orgId: "org-a", title: "t", message: "m", entityType: "rfi", entityId: "r1", projectId: "p", category: "workflow", priority: "normal" };
    const payload = await service.buildPushPayload({ notification, userId: "user-1" });
    expect(payload).toMatchObject({ orgId: "org-a", orgSlug: "acme", membershipId: "mem-1", entityType: "rfi", projectId: "p" });
    expect(mockPrisma.organizationMembership.findFirst).toHaveBeenCalledWith({ where: { orgId: "org-a", userId: "user-1" }, select: { id: true, status: true } });
    // Another recipient of the same workspace: the slug is remembered, the membership is theirs.
    const other = await service.buildPushPayload({ notification, userId: "user-2" });
    expect(other).toMatchObject({ orgId: "org-a", orgSlug: "acme", membershipId: null });
    expect(mockPrisma.organisation.findUnique).toHaveBeenCalledTimes(1);
    // The Expo message carries the three fields in its data.
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ data: [{ status: "ok" }] }) }));
    global.fetch = fetchMock;
    mockPrisma.pushSubscription.findMany.mockResolvedValue([device({ id: "exp-1", endpoint: "ExponentPushToken[one]", p256dh: "", auth: "", platform: "expo-android" })]);
    delete process.env.VAPID_PRIVATE_KEY;
    service.resetConfiguration();
    await service.sendToUser({ userId: "user-1", payload });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0].data).toMatchObject({ orgId: "org-a", orgSlug: "acme", membershipId: "mem-1" });
    delete global.fetch;
  });

  it("a recipient whose membership in the workspace is not active gets no payload, and a queued push is skipped (§11)", async () => {
    mockPrisma.organisation = { findUnique: jest.fn(async () => ({ slug: "acme" })) };
    mockPrisma.organizationMembership = { findFirst: jest.fn(async () => ({ id: "mem-gone", status: "suspended" })) };
    const notification = { id: "n3", orgId: "org-a", title: "t", message: "m", category: "workflow", priority: "normal" };
    expect(await service.buildPushPayload({ notification, userId: "user-1" })).toBeNull();
    expect(await service.workspaceFor({ orgId: "org-a", userId: "user-1" })).toMatchObject({ membershipId: null, revoked: true });
    mockPrisma.notificationDeliveryAttempt.findMany.mockResolvedValue([{ id: "att-30", userId: "user-1", attemptNumber: 1, notification }]);
    mockPrisma.notificationDeliveryAttempt.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.processPendingPushDeliveries({ now: new Date("2026-09-26T10:00:00Z") });
    expect(result).toMatchObject({ skipped: 1, sent: 0, processed: 1 });
    expect(mockPrisma.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.notificationDeliveryAttempt.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "att-30" }, data: expect.objectContaining({ status: "skipped", errorCode: "PUSH_RECIPIENT_NOT_MEMBER" }) }));
  });

  it("a client without the workspace models still gets the orgId", async () => {
    const payload = await service.buildPushPayload({ notification: { id: "n2", orgId: "org-b", title: "t", message: "m" }, userId: "user-1" });
    expect(payload).toMatchObject({ orgId: "org-b", orgSlug: null, membershipId: null });
  });
});
