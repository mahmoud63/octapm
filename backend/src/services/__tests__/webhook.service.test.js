const store = { subscriptions: [], deliveries: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some((clause) => matches(row, clause));
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("in" in expected) return expected.in.includes(row[key]);
      return matches(row[key] || {}, expected);
    }
    return row[key] === expected;
  });
const withIncludes = (row) => ({ ...row, subscription: store.subscriptions.find((item) => item.id === row.subscriptionId) || null, project: null, _count: { deliveries: store.deliveries.filter((item) => item.subscriptionId === row.id).length } });
const table = (rows, prefix) => ({
  findMany: jest.fn(async ({ where } = {}) => rows.filter((row) => matches(row, where)).map(withIncludes)),
  findFirst: jest.fn(async ({ where } = {}) => {
    const row = rows.find((item) => matches(item, where));
    return row ? withIncludes(row) : null;
  }),
  findUnique: jest.fn(async ({ where }) => {
    const row = rows.find((item) => item.id === where.id);
    return row ? withIncludes(row) : null;
  }),
  create: jest.fn(async ({ data }) => {
    const row = { id: nextId(prefix), createdAt: new Date(), updatedAt: new Date(), status: prefix === "sub" ? "active" : "pending", attempt: 0, failureCount: 0, ...data };
    rows.push(row);
    return withIncludes(row);
  }),
  update: jest.fn(async ({ where, data }) => {
    const row = rows.find((item) => item.id === where.id);
    Object.assign(row, data);
    return withIncludes(row);
  }),
  delete: jest.fn(async ({ where }) => {
    const index = rows.findIndex((item) => item.id === where.id);
    return rows.splice(index, 1)[0];
  }),
});
const mockPrisma = { webhookSubscription: table(store.subscriptions, "sub"), webhookDelivery: table(store.deliveries, "del"), project: { findFirst: jest.fn(async ({ where }) => ({ id: where.id })) } };
const mockAudit = { ENTITY_TYPES: { WEBHOOK: "webhook" }, ACTIONS: { CREATED: "created", UPDATED: "updated", DELETED: "deleted" }, recordEvent: jest.fn(async () => ({})) };
const mockJobs = { JOB_TYPES: { WEBHOOK_DELIVER: "webhook.deliver" }, enqueueJob: jest.fn(async ({ payload }) => ({ id: `job-${payload.deliveryId}` })) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { SYSTEM: "system" }, createNotifications: jest.fn(async () => ({ created: 1 })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../../jobs/job.service", () => mockJobs);
jest.mock("../notification.service", () => mockNotifications);

const dns = require("dns");
const bus = require("../../events/bus");
const service = require("../webhook.service");

// Saving a subscription resolves its host; these names answer from here.
const fakeDns = { "erp.example.com": [{ address: "93.184.215.14", family: 4 }], "intranet.example.com": [{ address: "10.20.30.40", family: 4 }], "split.example.com": [{ address: "93.184.215.14", family: 4 }, { address: "fd00:ec2::254", family: 6 }] };
jest.spyOn(dns, "lookup").mockImplementation((hostname, options, callback) => {
  if (fakeDns[hostname]) return callback(null, fakeDns[hostname]);
  return callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND", hostname }));
});

const actor = { id: "admin-1" };
const okResponse = (status = 200, text = "ok") => ({ status, text: async () => text });

describe("webhooks", () => {
  beforeEach(() => {
    store.subscriptions.length = 0;
    store.deliveries.length = 0;
    jest.clearAllMocks();
  });

  it("validates subscriptions and generates a secret shown once", async () => {
    await expect(service.createSubscription({ orgId: "org-1", actor, payload: { name: "ERP", url: "ftp://x", eventTypes: ["*"] } })).rejects.toMatchObject({ code: "WEBHOOK_URL_INVALID" });
    await expect(service.createSubscription({ orgId: "org-1", actor, payload: { name: "ERP", url: "https://erp.example.com/hook", eventTypes: ["rfi"] } })).rejects.toMatchObject({ code: "WEBHOOK_EVENT_PATTERN" });
    const created = await service.createSubscription({ orgId: "org-1", actor, payload: { name: "ERP", url: "https://erp.example.com/hook", eventTypes: ["RFI.*", "approval.decided"] } });
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.eventTypes).toEqual(["rfi.*", "approval.decided"]);
    const listed = await service.listSubscriptions({ orgId: "org-1" });
    expect(listed[0].secret).toBeNull();
    expect(listed[0].secretHint).toMatch(/^whsec_/);
  });

  it("refuses, at save, a target that is or resolves to a non-public address", async () => {
    const save = (url) => service.createSubscription({ orgId: "org-1", actor, payload: { name: "Inside", url, eventTypes: ["*"] } });
    await expect(save("https://169.254.169.254/latest/meta-data/")).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED", message: expect.stringContaining("169.254.169.254 is a link-local address") });
    await expect(save("https://[::ffff:127.0.0.1]/hook")).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED", message: expect.stringContaining("in IPv4-mapped form") });
    await expect(save("https://intranet.example.com/hook")).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED", message: expect.stringContaining("intranet.example.com resolves to 10.20.30.40, a private address") });
    await expect(save("https://split.example.com/hook")).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED", message: expect.stringContaining("fd00:ec2::254, a unique-local address") });
    await expect(save("https://nowhere.example.com/hook")).rejects.toMatchObject({ code: "WEBHOOK_URL_UNRESOLVED" });
    expect(store.subscriptions).toHaveLength(0);

    const sub = await save("https://erp.example.com/hook");
    await expect(service.updateSubscription({ orgId: "org-1", actor, subscriptionId: sub.id, payload: { url: "https://intranet.example.com/hook" } })).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED" });
    expect(store.subscriptions[0].url).toBe("https://erp.example.com/hook");
  });

  it("honours WEBHOOK_ALLOW_HTTP for loopback receivers only, and never under production", async () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, WEBHOOK_ALLOW_HTTP: process.env.WEBHOOK_ALLOW_HTTP };
    const save = (url) => service.createSubscription({ orgId: "org-1", actor, payload: { name: "Local", url, eventTypes: ["*"] } });
    try {
      process.env.WEBHOOK_ALLOW_HTTP = "true";
      await expect(save("http://127.0.0.1:4000/hook")).resolves.toMatchObject({ url: "http://127.0.0.1:4000/hook" });
      await expect(save("http://10.0.0.5/hook")).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED" });
      process.env.NODE_ENV = "production";
      await expect(save("http://127.0.0.1:4000/hook")).rejects.toMatchObject({ code: "WEBHOOK_URL_INVALID" });
      await expect(save("https://127.0.0.1:4000/hook")).rejects.toMatchObject({ code: "WEBHOOK_TARGET_REFUSED" });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("matches events by bus type or <entity>.<action> and honours project scope", () => {
    const rfiEvent = { type: "record.changed", orgId: "org-1", projectId: "p1", entityType: "rfi", action: "status_changed" };
    expect(service.subscriptionMatches({ eventTypes: ["rfi.*"], projectId: null }, rfiEvent)).toBe(true);
    expect(service.subscriptionMatches({ eventTypes: ["rfi.status_changed"], projectId: "p1" }, rfiEvent)).toBe(true);
    expect(service.subscriptionMatches({ eventTypes: ["rfi.created"], projectId: null }, rfiEvent)).toBe(false);
    expect(service.subscriptionMatches({ eventTypes: ["record.changed"], projectId: "p2" }, rfiEvent)).toBe(false);
    expect(service.subscriptionMatches({ eventTypes: ["*"], projectId: null }, { type: "job.progress", orgId: "org-1" })).toBe(true);
  });

  it("fans a bus event out to matching subscriptions and queues signed deliveries that retry up to five times", async () => {
    service.registerWebhookSubscriber();
    const sub = await service.createSubscription({ orgId: "org-1", actor, payload: { name: "ERP", url: "https://erp.example.com/hook", eventTypes: ["change_order.*"] } });
    await service.createSubscription({ orgId: "org-1", actor, payload: { name: "Other", url: "https://erp.example.com/other", eventTypes: ["rfi.*"] } });
    const event = bus.publish({ type: "record.changed", orgId: "org-1", projectId: "p1", entityType: "change_order", entityId: "co-1", action: "approved", actorId: "pm-1", payload: { newStatus: "approved" } }, { delayMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    service.unregisterWebhookSubscriber();
    expect(store.deliveries).toHaveLength(1);
    expect(store.deliveries[0]).toMatchObject({ subscriptionId: sub.id, eventId: event.id, eventType: "change_order.approved", status: "pending" });
    expect(mockJobs.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "webhook.deliver", maxAttempts: 5, payload: { deliveryId: store.deliveries[0].id } }));

    // first attempt: endpoint down → retryable failure
    const fetchImpl = jest.fn(async () => okResponse(503, "down"));
    await expect(service.runDeliveryJob({ job: { orgId: "org-1" }, payload: { deliveryId: store.deliveries[0].id }, fetchImpl })).rejects.toMatchObject({ retryable: true, code: "WEBHOOK_RETRY" });
    expect(store.deliveries[0]).toMatchObject({ attempt: 1, status: "failed", responseStatus: 503, error: "Endpoint answered 503" });
    expect(store.subscriptions[0].lastStatus).toBe("failed");

    // the request is signed over "<timestamp>.<body>" and carries the delivery headers
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://erp.example.com/hook");
    expect(request.headers["x-octapm-event"]).toBe("change_order.approved");
    expect(request.headers["x-octapm-delivery"]).toBe(store.deliveries[0].id);
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({ id: event.id, type: "record.changed", event: "change_order.approved", entity: { type: "change_order", id: "co-1" }, action: "approved", webhook: { subscriptionId: sub.id, attempt: 1 } });
    expect(service.verifySignature({ secret: sub.secret, header: request.headers["x-octapm-signature"], body: request.body })).toBe(true);
    expect(service.verifySignature({ secret: "wrong", header: request.headers["x-octapm-signature"], body: request.body })).toBe(false);
    expect(service.verifySignature({ secret: sub.secret, header: request.headers["x-octapm-signature"], body: request.body, now: Math.floor(Date.now() / 1000) + 3600 })).toBe(false);

    // second attempt succeeds
    const ok = jest.fn(async () => okResponse(202, "queued"));
    await expect(service.runDeliveryJob({ job: { orgId: "org-1" }, payload: { deliveryId: store.deliveries[0].id }, fetchImpl: ok })).resolves.toMatchObject({ delivered: true, attempt: 2, responseStatus: 202 });
    expect(store.deliveries[0]).toMatchObject({ status: "delivered", attempt: 2, error: null });
    expect(store.subscriptions[0]).toMatchObject({ lastStatus: "delivered", failureCount: 0 });
    await expect(service.runDeliveryJob({ job: { orgId: "org-1" }, payload: { deliveryId: store.deliveries[0].id }, fetchImpl: ok })).resolves.toEqual({ skipped: "delivered" });
  });

  it("marks a delivery dead after the fifth failure, counts it on the subscription and disables after ten dead in a row", async () => {
    const sub = await service.createSubscription({ orgId: "org-1", actor, payload: { name: "Flaky", url: "https://erp.example.com/hook", eventTypes: ["*"] } });
    const failing = jest.fn(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    });
    for (let round = 1; round <= 10; round += 1) {
      const delivery = await mockPrisma.webhookDelivery.create({ data: { orgId: "org-1", subscriptionId: sub.id, eventId: `evt-${round}`, eventType: "rfi.created", payloadJson: {} } });
      for (let attempt = 1; attempt <= 4; attempt += 1) await expect(service.runDeliveryJob({ job: { orgId: "org-1" }, payload: { deliveryId: delivery.id }, fetchImpl: failing })).rejects.toMatchObject({ retryable: true });
      await expect(service.runDeliveryJob({ job: { orgId: "org-1" }, payload: { deliveryId: delivery.id }, fetchImpl: failing })).rejects.toMatchObject({ retryable: false, code: "WEBHOOK_DEAD" });
      expect(store.deliveries.find((row) => row.id === delivery.id)).toMatchObject({ status: "dead", attempt: 5, error: "connect ECONNREFUSED" });
      expect(store.subscriptions[0].failureCount).toBe(round);
    }
    expect(store.subscriptions[0].status).toBe("disabled");
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "webhook.disabled", recipientRoles: ["pm"] }));
    await expect(service.redeliver({ orgId: "org-1", actor, deliveryId: store.deliveries[0].id })).rejects.toMatchObject({ code: "WEBHOOK_INACTIVE" });
    await service.updateSubscription({ orgId: "org-1", actor, subscriptionId: sub.id, payload: { status: "active" } });
    expect(store.subscriptions[0]).toMatchObject({ status: "active", failureCount: 0 });
    const redelivered = await service.redeliver({ orgId: "org-1", actor, deliveryId: store.deliveries[0].id });
    expect(redelivered.status).toBe("pending");
    expect(mockJobs.enqueueJob).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { deliveryId: redelivered.id } }));
  });

  it("sends a test event straight away", async () => {
    const sub = await service.createSubscription({ orgId: "org-1", actor, payload: { name: "Test", url: "https://erp.example.com/hook", eventTypes: ["rfi.*"] } });
    const fetchImpl = jest.fn(async () => okResponse(200));
    const result = await service.sendTest({ orgId: "org-1", actor, subscriptionId: sub.id, fetchImpl });
    expect(result).toMatchObject({ ok: true, delivered: true, delivery: expect.objectContaining({ eventType: "webhook.test", status: "delivered" }) });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ type: "webhook.test", payload: { message: "Test delivery from OctaPM" } });
  });
});
