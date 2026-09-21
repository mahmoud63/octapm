/**
 * Side effects that must happen once however many API tasks and schedulers
 * run: each case starts two real processes on the shared Postgres (see
 * shared-state-node.js), lets both read the same rows before either writes,
 * and checks what reached the outside world or the database.
 *
 * Everything is created inside a throwaway `LiveTest <uuid>` organisation and
 * removed afterwards. Fake email, push and Stripe endpoints listen on
 * 127.0.0.1 inside this test process.
 */
const crypto = require("crypto");
const http = require("http");
const webPush = require("web-push");
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  dropLiveOrg,
  freePort,
  liveDescribe,
  mintAccessToken,
  spawnNode,
} = require("../../__live__/helpers");

const NODE_ENTRY = "src/services/__live__/shared-state-node.js";
// Long enough that two processes started together have both read before
// either writes, short enough to keep the suite quick.
const HOLD_MS = "900";

/** A local HTTP endpoint that records every request body and answers `status`. */
const fakeEndpoint = async ({ status = 200, respond = null } = {}) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, headers: req.headers, raw });
      const answer = respond ? respond(req, raw) : { status, body: "{}" };
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(answer.body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { requests, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
};

const startNode = async (env = {}) => {
  const port = await freePort();
  const node = spawnNode(NODE_ENTRY, { env: { PORT: String(port), ...env } });
  // Generous: a cold start loads the whole app, and the machine is shared.
  await node.waitForOutput(/running on port/, 45_000);
  return { node, base: `http://127.0.0.1:${port}` };
};

/** Asks a node to run one scheduler function and resolves with its result. */
const call = (entry, name, args = {}) =>
  new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const onMessage = (message) => {
      if (message?.id !== id) return;
      entry.node.child.off("message", onMessage);
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    };
    entry.node.child.on("message", onMessage);
    entry.node.child.send({ id, call: name, args });
  });

const notificationFor = (live, index, extra = {}) =>
  prisma.notification.create({
    data: {
      orgId: live.org.id,
      recipientUserId: live.user.id,
      type: "workflow",
      category: "workflow",
      event: "live.shared_state",
      title: `Shared-state check ${index}`,
      message: "Delivered once, however many tasks try.",
      ...extra,
    },
  });

liveDescribe("side effects happen once across API tasks", () => {
  const cleanups = [];
  const nodes = [];
  let live;

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
  });

  afterEach(async () => {
    await Promise.all(nodes.splice(0).map((entry) => entry.node.kill()));
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  afterAll(async () => {
    if (live) await dropLiveOrg(prisma, live.org.id);
    await prisma.$disconnect();
  });

  it("email: two processes retrying the same pending deliveries send each one once", async () => {
    const webhook = await fakeEndpoint({ status: 200 });
    cleanups.push(webhook.close);
    const env = {
      EMAIL_WEBHOOK_URL: `http://127.0.0.1:${webhook.port}/send`,
      LIVE_HOLD_AFTER_READ_MS: HOLD_MS,
      LIVE_HOLD_MODELS: "notificationDeliveryAttempt",
    };
    const [a, b] = await Promise.all([startNode(env), startNode(env)]);
    nodes.push(a, b);

    const ids = [];
    for (let index = 1; index <= 3; index += 1) {
      const notification = await notificationFor(live, index);
      ids.push(notification.id);
      await prisma.notificationDeliveryAttempt.create({
        data: { notificationId: notification.id, orgId: live.org.id, userId: live.user.id, channel: "email", status: "pending", attemptNumber: 1 },
      });
    }

    // The real route, on both tasks at once, as two browser tabs or two
    // schedulers would reach it.
    const retry = (entry) =>
      fetch(`${entry.base}/api/v1/notifications/deliveries/retry`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${live.token}` },
        body: JSON.stringify({ limit: 25 }),
      }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const [fromA, fromB] = await Promise.all([retry(a), retry(b)]);
    expect([fromA.status, fromB.status]).toEqual([200, 200]);

    const delivered = webhook.requests
      .map((request) => JSON.parse(request.raw.toString("utf8")))
      .filter((payload) => ids.includes(payload.metadata?.notificationId));
    expect(delivered.map((payload) => payload.metadata.notificationId).sort()).toEqual([...ids].sort());
    expect(fromA.body.data.sent + fromB.body.data.sent).toBe(3);

    const attempts = await prisma.notificationDeliveryAttempt.findMany({ where: { notificationId: { in: ids } } });
    expect(attempts.map((row) => row.status)).toEqual(["sent", "sent", "sent"]);
  });

  it("push: two processes flushing the same pending pushes reach the device once each", async () => {
    const pushService = await fakeEndpoint({ status: 201 });
    cleanups.push(pushService.close);
    const vapid = webPush.generateVAPIDKeys();
    const device = crypto.createECDH("prime256v1");
    device.generateKeys();
    const subscription = await prisma.pushSubscription.create({
      data: {
        orgId: live.org.id,
        userId: live.user.id,
        endpoint: `https://127.0.0.1:${pushService.port}/push/${crypto.randomUUID()}`,
        p256dh: device.getPublicKey().toString("base64url"),
        auth: crypto.randomBytes(16).toString("base64url"),
      },
    });
    cleanups.push(() => prisma.pushSubscription.deleteMany({ where: { id: subscription.id } }));

    const env = {
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:live@octapm-live.test",
      EXPO_PUSH_ENABLED: "false",
      LIVE_HTTPS_TO_HTTP: "1",
      LIVE_HOLD_AFTER_READ_MS: HOLD_MS,
      LIVE_HOLD_MODELS: "notificationDeliveryAttempt",
    };
    const [a, b] = await Promise.all([startNode(env), startNode(env)]);
    nodes.push(a, b);

    const ids = [];
    for (let index = 1; index <= 3; index += 1) {
      const notification = await notificationFor(live, `push-${index}`);
      ids.push(notification.id);
      await prisma.notificationDeliveryAttempt.create({
        data: { notificationId: notification.id, orgId: live.org.id, userId: live.user.id, channel: "push", status: "pending", attemptNumber: 1 },
      });
    }

    const [fromA, fromB] = await Promise.all([call(a, "push", { userId: live.user.id }), call(b, "push", { userId: live.user.id })]);
    expect(pushService.requests.length).toBe(3);
    expect(pushService.requests.every((request) => request.method === "POST" && request.headers["content-encoding"] === "aes128gcm")).toBe(true);
    expect(fromA.sent + fromB.sent).toBe(3);

    const attempts = await prisma.notificationDeliveryAttempt.findMany({ where: { notificationId: { in: ids } } });
    expect(attempts.map((row) => [row.status, row.provider])).toEqual([["sent", "web-push"], ["sent", "web-push"], ["sent", "web-push"]]);
  });

  it("report schedule: two schedulers reading the same due schedule create one run", async () => {
    const env = { LIVE_HOLD_AFTER_READ_MS: HOLD_MS, LIVE_HOLD_MODELS: "reportSchedule" };
    const [a, b] = await Promise.all([startNode(env), startNode(env)]);
    nodes.push(a, b);

    const report = await prisma.reportDefinition.create({
      data: { orgId: live.org.id, name: `Shared-state ${crypto.randomUUID().slice(0, 8)}`, source: "rfi", columnsJson: ["ref"], createdBy: live.user.id },
    });
    // Due in 2001, and asked about in 2001: no real schedule is that old, so
    // the scan sees this one only.
    const schedule = await prisma.reportSchedule.create({
      data: { orgId: live.org.id, reportId: report.id, frequency: "daily", hour: 7, nextRunAt: new Date("2001-01-01T07:00:00Z"), createdBy: live.user.id },
    });
    cleanups.push(() => prisma.reportSchedule.updateMany({ where: { id: schedule.id }, data: { enabled: false } }));

    const now = "2001-01-02T00:00:00.000Z";
    const [fromA, fromB] = await Promise.all([call(a, "reportSchedules", { now }), call(b, "reportSchedules", { now })]);
    expect(fromA.due + fromB.due).toBe(2); // both read it
    expect(await prisma.reportRun.count({ where: { scheduleId: schedule.id } })).toBe(1);
    expect(fromA.queued.length + fromB.queued.length).toBe(1);
    const after = await prisma.reportSchedule.findUnique({ where: { id: schedule.id } });
    expect(after.nextRunAt.toISOString()).toBe("2001-01-02T07:00:00.000Z");
  });

  it("workflow escalation: two scans of the same overdue step raise the level once", async () => {
    const env = { LIVE_HOLD_AFTER_READ_MS: HOLD_MS, LIVE_HOLD_MODELS: "workflowStepAssignment" };
    const [a, b] = await Promise.all([startNode(env), startNode(env)]);
    nodes.push(a, b);

    const second = await prisma.user.create({
      data: { orgId: live.org.id, name: "Live Reviewer", email: `live-reviewer-${crypto.randomUUID()}@octapm-live.test`, passwordHash: "x", role: "qs" },
    });
    const project = await prisma.project.create({ data: { orgId: live.org.id, name: "Escalation check" } });
    const steps = [{ key: "pm_approval", name: "PM approval", days: 1, assignees: [{ type: "role", role: "pm" }], escalateRoles: ["pm"] }];
    const template = await prisma.workflowTemplate.create({
      data: { orgId: live.org.id, projectId: project.id, tool: "change_order", name: `Live ${crypto.randomUUID().slice(0, 8)}`, stepsJson: steps, startStep: "pm_approval" },
    });
    const instance = await prisma.workflowInstance.create({
      data: { orgId: live.org.id, projectId: project.id, templateId: template.id, tool: "change_order", recordId: crypto.randomUUID(), recordRef: "CO-LIVE", recordTitle: "Escalation check", currentStepKey: "pm_approval", stepsJson: steps },
    });
    const overdue = (userId) => ({ orgId: live.org.id, projectId: project.id, instanceId: instance.id, stepKey: "pm_approval", stepName: "PM approval", userId, dueAt: new Date("2001-01-01T00:00:00Z") });
    await prisma.workflowStepAssignment.createMany({ data: [overdue(live.user.id), overdue(second.id)] });

    const now = "2001-01-03T00:00:00.000Z";
    const [fromA, fromB] = await Promise.all([call(a, "escalation", { now }), call(b, "escalation", { now })]);
    expect(fromA.scanned + fromB.scanned).toBe(4); // both scans read both rows

    const after = await prisma.workflowInstance.findUnique({ where: { id: instance.id } });
    expect(after.escalationLevel).toBe(1);
    const events = await prisma.approvalWorkflowEvent.count({ where: { recordId: instance.recordId, action: "workflow.escalated" } });
    expect(events).toBe(1);
    expect(fromA.escalated + fromB.escalated).toBe(2); // each row handled by one scan
    const rows = await prisma.workflowStepAssignment.findMany({ where: { instanceId: instance.id } });
    expect(rows.every((row) => row.escalatedAt)).toBe(true);
  });

  it("daily log: two schedulers passing the send time queue the distribution once", async () => {
    const env = { LIVE_HOLD_AFTER_READ_MS: HOLD_MS, LIVE_HOLD_MODELS: "dailyLog", LIVE_SCOPE_ORG_ID: live.org.id };
    const [a, b] = await Promise.all([startNode(env), startNode(env)]);
    nodes.push(a, b);

    const now = new Date();
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: "Distribution check", status: "active", timezone: "UTC", dailyLogSettingsJson: { autoDistributeAt: "00:00" } },
    });
    const log = await prisma.dailyLog.create({
      data: { orgId: live.org.id, projectId: project.id, date: new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`), summary: "Slab poured on level 3." },
    });

    const [fromA, fromB] = await Promise.all([
      call(a, "dailyLogDistribution", { now: now.toISOString() }),
      call(b, "dailyLogDistribution", { now: now.toISOString() }),
    ]);
    expect([...fromA.queued, ...fromB.queued]).toEqual([{ projectId: project.id, date: now.toISOString().slice(0, 10) }]);
    const after = await prisma.dailyLog.findUnique({ where: { id: log.id } });
    expect(after.autoDistributeQueuedFor).not.toBeNull();
  });

  it("accounting: an organisation with a poll already running gets no second poll", async () => {
    const env = { LIVE_SCOPE_ORG_ID: live.org.id };
    const [a, b] = await Promise.all([startNode(env), startNode(env)]);
    nodes.push(a, b);

    await prisma.accountingConnection.create({ data: { orgId: live.org.id, provider: "qbo", status: "connected" } });
    // A poll already running on some worker. `running` rows are never claimed
    // by a job worker, so nothing polls the provider during this test.
    const running = await prisma.backgroundJob.create({
      data: { orgId: live.org.id, type: "accounting.poll", status: "running", lockedBy: "live-test", lockedAt: new Date(), heartbeatAt: new Date(), payloadJson: { orgId: live.org.id } },
    });
    const clearJobs = () => prisma.backgroundJob.deleteMany({ where: { orgId: live.org.id } });
    cleanups.push(clearJobs);

    const [fromA, fromB] = await Promise.all([call(a, "accountingPoll"), call(b, "accountingPoll")]);
    const jobs = await prisma.backgroundJob.findMany({ where: { orgId: live.org.id, type: "accounting.poll" }, select: { id: true, status: true } });
    // Anything queued by mistake is removed at once, before a worker claims it.
    await prisma.backgroundJob.deleteMany({ where: { orgId: live.org.id, status: "queued" } });
    expect(jobs).toEqual([{ id: running.id, status: "running" }]);
    expect(fromA.queued + fromB.queued).toBe(0);
  });

  it("permissions: a tool revoked through task B is refused on task A at once", async () => {
    const [a, b] = await Promise.all([startNode(), startNode()]);
    nodes.push(a, b);

    const project = await prisma.project.create({ data: { orgId: live.org.id, name: "Permission check" } });
    const member = await prisma.user.create({
      data: { orgId: live.org.id, name: "Live Member", email: `live-member-${crypto.randomUUID()}@octapm-live.test`, passwordHash: "x", role: "pm", isCompanyAdmin: false },
    });
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `Live schedule reader ${crypto.randomUUID().slice(0, 8)}`, kind: "internal", baseRole: "pm", tools: { create: [{ module: "schedule", level: "read_only" }] } },
    });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id } });

    const memberToken = mintAccessToken(member);
    const listActivities = () =>
      fetch(`${a.base}/api/v1/projects/${project.id}/activities`, { headers: { authorization: `Bearer ${memberToken}` } }).then((response) => response.status);

    // Warm task A's cache, and use it once.
    expect(await listActivities()).toBe(200);
    expect(await listActivities()).toBe(200);

    const revoke = await fetch(`${b.base}/api/v1/permissions/templates/${template.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${live.token}` },
      body: JSON.stringify({ tools: [{ module: "schedule", level: "none" }] }),
    });
    expect(revoke.status).toBe(200);

    expect(await listActivities()).toBe(403);
  });

  it("billing: cancelling still succeeds when the confirmation email fails", async () => {
    const webhook = await fakeEndpoint({ status: 500 });
    const stripe = await fakeEndpoint({
      respond: (req) => {
        const id = decodeURIComponent(req.url.split("/").pop());
        return { status: 200, body: JSON.stringify({ id, object: "subscription", status: "active", cancel_at_period_end: true }) };
      },
    });
    cleanups.push(webhook.close, stripe.close);
    const env = {
      EMAIL_WEBHOOK_URL: `http://127.0.0.1:${webhook.port}/send`,
      STRIPE_SECRET_KEY: "sk_test_livesharedstate",
      LIVE_STRIPE_PORT: String(stripe.port),
    };
    const [a] = await Promise.all([startNode(env)]);
    nodes.push(a);

    await prisma.subscription.update({ where: { orgId: live.org.id }, data: { status: "active", stripeSubscriptionId: "sub_live_shared_state", cancelAtPeriodEnd: false } });

    const response = await fetch(`${a.base}/api/v1/billing/cancel`, { method: "POST", headers: { authorization: `Bearer ${live.token}` } });
    const body = await response.json();
    expect({ status: response.status, code: body.error?.code }).toEqual({ status: 200, code: undefined });

    expect(stripe.requests.map((request) => [request.method, request.url])).toEqual([["POST", "/v1/subscriptions/sub_live_shared_state"]]);
    expect(stripe.requests[0].raw.toString("utf8")).toContain("cancel_at_period_end=true");
    expect(webhook.requests).toHaveLength(1); // the email was attempted, and failed
    const after = await prisma.subscription.findUnique({ where: { orgId: live.org.id } });
    expect(after).toMatchObject({ status: "canceled", cancelAtPeriodEnd: true });
    await a.node.waitForOutput(/cancellation confirmation email failed/);
  });
});
