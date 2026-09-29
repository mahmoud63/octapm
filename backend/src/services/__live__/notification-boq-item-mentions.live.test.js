/**
 * A comment or @mention on a BOQ item reaches only a person who may read the
 * BOQ — proven against a real API process, real sockets and the real local
 * Postgres (owner F1, 2026-09-28: boq_item joins the BOQ-record notification
 * rule).
 *
 *   Before: a project manager whose template sets BOQ to none, @mentioned on
 *   a BOQ row, was told "… mentioned you on BOQ item 9.1 – Blinding
 *   concrete" in-app, by email, by push and by the realtime badge — the
 *   row's code and description, which the BOQ page refuses them.
 *
 *   Now: both people are mentioned and both mentions are saved; only the BOQ
 *   reader is notified (list, summary, email and push queue, realtime). The
 *   author's answer names the other ("Saved. Not notified (no BOQ access):
 *   …"), names only. A mention row stored for the member without BOQ read
 *   before the rule is left out of their list, summary and actions, and is
 *   never rewritten.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/notification-boq-item-mentions.live.test.js
 */
const crypto = require("crypto");
const { io: connectSocket } = require("socket.io-client");
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  createLiveUser,
  dropLiveOrg,
  liveDescribe,
  mintAccessToken,
} = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const ROW_FIELDS = { title: true, message: true, readAt: true, archivedAt: true, actionUrl: true, entityType: true, entityId: true };

liveDescribe("a comment or mention on a BOQ item reaches only a reader of the BOQ (F1)", () => {
  let live;
  let api;
  let project;
  const people = {};
  const records = {};
  const stored = {};
  const sockets = [];
  const heard = { reviewer: [], noBoqPm: [] };

  const tokenOf = (user) => mintAccessToken({ ...user, membershipId: user.membership?.id || null });
  const as = (user) => ({ authorization: `Bearer ${tokenOf(user)}` });
  const call = (user, method, route, body) => api.request(method, `/api/v1${route}`, { body, headers: as(user) });
  const ok = async (user, method, route, body, status = 200) => {
    const response = await call(user, method, route, body);
    expect([method, route, response.status, response.body?.error]).toEqual([method, route, status, undefined]);
    return response.body.data;
  };
  const inbox = async (user) => (await ok(user, "GET", "/notifications?status=all&limit=100")).rows;
  const aboutItem = (rows) => rows.filter((row) => row.entityType === "boq_item");

  const openSocket = (user) =>
    new Promise((resolve, reject) => {
      const socket = connectSocket(api.base, { transports: ["websocket"], reconnection: false, auth: { token: tokenOf(user) } });
      const timer = setTimeout(() => reject(new Error("socket not ready within 8 s")), 8_000);
      socket.once("realtime.ready", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      sockets.push(socket);
    });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    const org = await prisma.organisation.findUnique({ where: { id: live.org.id }, select: { name: true } });
    expect(org.name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({
      DATABASE_CONNECTION_LIMIT: "4",
      EXPO_PUSH_ENABLED: "false",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
    });
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest BOQ item mentions", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    people.admin = { ...live.user, membership: live.membership };
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: live.user.id, role: "pm", orgId: live.org.id } });

    // Two project managers on the project: one reads the BOQ, the other's
    // template sets BOQ to none.
    const tag = Date.now();
    for (const [key, name, noBoq] of [["reviewer", "Rana Reader", false], ["noBoqPm", "Omar Ali", true]]) {
      const user = await createLiveUser(prisma, {
        orgId: live.org.id,
        name,
        email: `live-boqmention-${key.toLowerCase()}-${tag}@octapm-live.test`,
        role: "pm",
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: user.id, role: "pm", orgId: live.org.id } });
      if (noBoq) {
        const template = await prisma.permissionTemplate.create({
          data: { orgId: live.org.id, name: `LiveTest pm, no BOQ ${tag}`, baseRole: "pm", tools: { create: [{ module: "boq", level: "none" }] } },
        });
        await prisma.projectUserPermission.create({
          data: { orgId: live.org.id, projectId: project.id, userId: user.id, templateId: template.id },
        });
      }
      // A device each, so a push attempt would be queued for a recipient.
      // Expo is switched off in the API process: nothing leaves.
      await prisma.pushSubscription.create({
        data: { orgId: live.org.id, userId: user.id, endpoint: `ExponentPushToken[live-${crypto.randomUUID()}]`, p256dh: "", auth: "", platform: "expo-android" },
      });
      people[key] = user;
    }

    const base = `/projects/${project.id}`;
    records.item = (await ok(people.admin, "POST", `${base}/boq/items`, { code: "9.1", description: "Blinding concrete", quantity: 10, unit: "m3", rate: 100 }, 201)).item;

    // A mention row as it was stored before the rule, for the member without
    // BOQ read, and one of theirs about something else.
    const row = (entityType, entityId, title, message) => ({
      orgId: live.org.id,
      projectId: project.id,
      recipientUserId: people.noBoqPm.id,
      actorId: people.admin.id,
      type: "comment",
      category: "mention",
      event: "comment.mentioned",
      title,
      message,
      priority: "normal",
      inAppVisible: true,
      actionUrl: `/projects/${project.id}/boq?recordId=${entityId}&source=${entityType}`,
      entityType,
      entityId,
      metadataJson: { recordType: entityType, recordId: entityId },
    });
    stored.legacy = await prisma.notification.create({
      data: row("boq_item", records.item.id, "Live Test Admin mentioned you on BOQ item 9.1 – Blinding concrete", "is this rate right?"),
    });
    stored.other = await prisma.notification.create({
      data: row("project", project.id, "Live Test Admin mentioned you on Project LiveTest BOQ item mentions", "kick-off on Monday"),
    });

    // Both listen for their realtime badge before the comment is written.
    for (const key of ["reviewer", "noBoqPm"]) {
      const socket = await openSocket(people[key]);
      socket.on("domain.event", (event) => heard[key].push(event));
    }
  }, 120_000);

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    if (api) await api.stop();
    if (live) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("the premise: the one member may not read the BOQ; the reviewer may", async () => {
    expect((await call(people.noBoqPm, "GET", `/projects/${project.id}/boq`)).status).toBe(403);
    expect((await call(people.reviewer, "GET", `/projects/${project.id}/boq`)).status).toBe(200);
  });

  it("both mentions are saved, only the BOQ reader is notified, and the author is told who was not", async () => {
    const comment = await ok(
      people.admin,
      "POST",
      `/projects/${project.id}/comments`,
      {
        recordType: "boq_item",
        recordId: records.item.id,
        body: "@Rana Reader @Omar Ali is the blinding rate right?",
        mentionUserIds: [people.reviewer.id, people.noBoqPm.id],
      },
      201,
    );
    records.comment = comment;

    // The comment and both mentions are saved.
    expect(comment.mentions.map((mention) => mention.userId).sort()).toEqual([people.reviewer.id, people.noBoqPm.id].sort());
    expect(await prisma.commentMention.count({ where: { commentId: comment.id } })).toBe(2);

    // The author's answer names the one not notified — a name, no figure.
    expect(comment.notNotified).toEqual({
      reason: "NO_BOQ_ACCESS",
      people: [{ userId: people.noBoqPm.id, name: "Omar Ali" }],
      message: "Saved. Not notified (no BOQ access): Omar Ali.",
    });

    // The reader: one mention notice, with its email and push queued.
    const reviewerRows = aboutItem(await inbox(people.reviewer));
    expect(reviewerRows.map((row) => [row.category, row.title])).toEqual([["mention", "Live Test Admin mentioned you on BOQ item 9.1 – Blinding concrete"]]);
    const reviewerAttempts = await prisma.notificationDeliveryAttempt.findMany({
      where: { orgId: live.org.id, userId: people.reviewer.id },
      select: { channel: true },
    });
    expect(reviewerAttempts.map((attempt) => attempt.channel)).toContain("push");

    // The member without BOQ read: no row written, so no email or push queued.
    const written = await prisma.notification.findMany({
      where: { orgId: live.org.id, recipientUserId: people.noBoqPm.id, entityId: records.item.id },
      select: { id: true },
    });
    expect(written.map((row) => row.id)).toEqual([stored.legacy.id]); // only the row stored before the rule
    expect(await prisma.notificationDeliveryAttempt.count({ where: { orgId: live.org.id, userId: people.noBoqPm.id } })).toBe(0);
  });

  it("the realtime badge reaches the reader and not the member without BOQ read", async () => {
    const badge = (events) => events.filter((event) => event.type === "notification.created" && event.entityType === "boq_item");
    const deadline = Date.now() + 5_000;
    while (!badge(heard.reviewer).length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(badge(heard.reviewer)).toHaveLength(1);
    // The reader's badge arrived; the other would have arrived with it.
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(badge(heard.noBoqPm)).toEqual([]);
  });

  it("a mention row stored before the rule is left out of their list, summary and actions — the rest of theirs is not", async () => {
    const rows = await inbox(people.noBoqPm);
    expect(aboutItem(rows)).toEqual([]);
    expect(rows.map((row) => row.id)).toEqual([stored.other.id]);

    const summary = await ok(people.noBoqPm, "GET", "/notifications/summary");
    expect([summary.unread, summary.read, summary.archived]).toEqual([1, 0, 0]);
    expect(summary.recent.map((row) => row.id)).toEqual([stored.other.id]);

    for (const [method, route, body] of [
      ["GET", `/notifications/${stored.legacy.id}`],
      ["PATCH", `/notifications/${stored.legacy.id}/read`, { read: true }],
      ["PATCH", `/notifications/${stored.legacy.id}/archive`, {}],
    ]) {
      const response = await call(people.noBoqPm, method, route, body);
      expect([method, route, response.status, response.body?.error?.code]).toEqual([method, route, 404, "NOTIFICATION_NOT_FOUND"]);
    }

    const marked = await ok(people.noBoqPm, "POST", "/notifications/mark-read", {});
    expect(marked.updated).toBe(1);
    const legacy = await prisma.notification.findUnique({ where: { id: stored.legacy.id }, select: ROW_FIELDS });
    expect(legacy).toEqual(Object.fromEntries(Object.keys(ROW_FIELDS).map((field) => [field, stored.legacy[field]])));
  });

  it("an edit that adds a mention answers the same way, and a follower without BOQ read hears nothing of later comments", async () => {
    // The member without BOQ read follows the item (they were mentioned):
    // a reply there tells them nothing.
    const reply = await ok(people.reviewer, "POST", `/projects/${project.id}/comments`, { recordType: "boq_item", recordId: records.item.id, body: "Rate checked." }, 201);
    expect(reply).not.toHaveProperty("notNotified");
    const admin = aboutItem(await inbox(people.admin));
    expect(admin.map((row) => row.event)).toEqual(["comment.created"]);
    expect(aboutItem(await inbox(people.noBoqPm))).toEqual([]);

    // Removing and re-adding the mention on an edit names them again.
    const edited = await ok(people.admin, "PATCH", `/projects/${project.id}/comments/${records.comment.id}`, { mentionUserIds: [people.reviewer.id] });
    expect(edited).not.toHaveProperty("notNotified");
    const readded = await ok(people.admin, "PATCH", `/projects/${project.id}/comments/${records.comment.id}`, { mentionUserIds: [people.reviewer.id, people.noBoqPm.id] });
    expect(readded.notNotified?.message).toBe("Saved. Not notified (no BOQ access): Omar Ali.");
    expect(
      await prisma.notification.count({ where: { orgId: live.org.id, recipientUserId: people.noBoqPm.id, entityType: "boq_item" } }),
    ).toBe(1); // still only the row stored before the rule
  });
});
