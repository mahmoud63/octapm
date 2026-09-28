/**
 * A notice about one of the bill's own records reaches only a person who may
 * read the BOQ — proven against a real API process and the real local
 * Postgres (owner, 2026-09-28: a member without boq:read must not receive BOQ
 * allocation counts or any other BOQ/mapping-derived information).
 *
 *   The closure review found a project manager whose template sets BOQ to
 *   none receiving "BOQ allocation for Activity C900 needs approval" for
 *   every submitted allocation: a per-activity mapping badge and a running
 *   count of allocations, asking them to approve what answers them 403.
 *
 *   Now: the BOQ reader is asked to approve; the project manager without BOQ
 *   read is told nothing — no row is written for them, so no badge, no
 *   email, no push. A row stored for them before the rule is left out of
 *   their list, their summary and its unread count, cannot be opened, read
 *   or archived (404), and is untouched by mark-all-read; every other
 *   notification of theirs is as it was. No stored row is rewritten.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/notification-boq-readers.live.test.js
 */
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

liveDescribe("a BOQ record's notification reaches only a reader of the BOQ", () => {
  let live;
  let api;
  let project;
  const people = {};
  const records = {};
  const stored = {};
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });

  const call = (user, method, route, body) => api.request(method, `/api/v1${route}`, { body, headers: as(user) });
  const ok = async (user, method, route, body, status = 200) => {
    const response = await call(user, method, route, body);
    expect([method, route, response.status, response.body?.error]).toEqual([method, route, status, undefined]);
    return response.body.data;
  };
  const inbox = async (user) => (await ok(user, "GET", "/notifications?status=all&limit=100")).rows;
  const boqRows = (rows) => rows.filter((row) => ["activity_boq_allocation", "boq_revision"].includes(row.entityType));

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    const org = await prisma.organisation.findUnique({ where: { id: live.org.id }, select: { name: true } });
    expect(org.name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" });
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest BOQ notice readers", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    people.admin = live.user;
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: live.user.id, role: "pm", orgId: live.org.id } });

    // Two more project managers, both addressed by an approval request: one
    // reads the BOQ, the other's template sets BOQ to none.
    const tag = Date.now();
    for (const [key, noBoq] of [["reviewer", false], ["noBoqPm", true]]) {
      const user = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-boqnotice-${key.toLowerCase()}-${tag}@octapm-live.test`,
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
      people[key] = user;
    }

    const base = `/projects/${project.id}`;
    records.item = (await ok(people.admin, "POST", `${base}/boq/items`, { code: "9.1", description: "Blinding concrete", quantity: 10, unit: "m3", rate: 100 }, 201)).item;
    records.activity = await ok(
      people.admin,
      "POST",
      `${base}/activities`,
      { name: "Blinding", activityCode: "C900", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06", engineerIds: [people.admin.id] },
      201,
    );

    // Rows as they were stored before the rule, for the member without BOQ
    // read (an allocation's and a BOQ revision's) and one of theirs about
    // something else; and the reviewer's own stored allocation row.
    const row = (recipient, entityType, entityId, title) => ({
      orgId: live.org.id,
      projectId: project.id,
      recipientUserId: recipient.id,
      type: "workflow",
      category: "approval",
      event: "workflow.submitted",
      title,
      message: `${title}. Status moved to submitted.`,
      priority: "high",
      inAppVisible: true,
      actionUrl: `/projects/${project.id}?recordId=${entityId}&source=${entityType}`,
      entityType,
      entityId,
      metadataJson: { action: "submitted", toStatus: "submitted", recordId: entityId, recordType: entityType },
    });
    stored.allocation = await prisma.notification.create({
      data: row(people.noBoqPm, "activity_boq_allocation", records.item.id, "BOQ allocation for Activity C900 needs approval"),
    });
    stored.revision = await prisma.notification.create({
      data: row(people.noBoqPm, "boq_revision", records.item.id, "BOQ revision Rev 1 needs approval"),
    });
    stored.other = await prisma.notification.create({
      data: row(people.noBoqPm, "schedule_revision", records.activity.id, "Schedule revision Rev 2 needs approval"),
    });
    stored.reviewers = await prisma.notification.create({
      data: row(people.reviewer, "activity_boq_allocation", records.item.id, "BOQ allocation for Activity C900 needs approval"),
    });

    // The admin maps the bill row to the activity and submits it.
    const allocations = `${base}/activity-boq-allocations`;
    records.allocation = await ok(people.admin, "POST", allocations, { boqItemId: records.item.id, activityId: records.activity.id, quantity: 10 }, 201);
    await ok(people.admin, "POST", `${allocations}/${records.allocation.id}/submit`, {});
  }, 120_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("the premise: the one member may not read the BOQ nor approve an allocation; the reviewer may", async () => {
    expect((await call(people.noBoqPm, "GET", `/projects/${project.id}/boq`)).status).toBe(403);
    expect((await call(people.noBoqPm, "GET", `/projects/${project.id}/activity-boq-allocations/coverage`)).status).toBe(403);
    expect((await call(people.reviewer, "GET", `/projects/${project.id}/boq`)).status).toBe(200);
  });

  it("a submitted allocation asks the BOQ reader to approve it, and tells the member without BOQ read nothing", async () => {
    const reviewer = (await inbox(people.reviewer)).filter((row) => row.entityId === records.allocation.id);
    expect(reviewer.map((row) => row.title)).toEqual(["BOQ allocation for Activity C900 needs approval"]);

    // Nothing through the API…
    const noBoq = await inbox(people.noBoqPm);
    expect(noBoq.filter((row) => row.entityId === records.allocation.id)).toEqual([]);
    // …because nothing was written for them: no row, so no badge, email or push.
    const written = await prisma.notification.findMany({
      where: { orgId: live.org.id, recipientUserId: people.noBoqPm.id, entityId: records.allocation.id },
      select: { id: true },
    });
    expect(written).toEqual([]);
  });

  it("a row stored before the rule is left out of their list and summary — the rest of theirs is not", async () => {
    const rows = await inbox(people.noBoqPm);
    expect(boqRows(rows)).toEqual([]);
    expect(rows.map((row) => row.id)).toEqual([stored.other.id]);

    const summary = await ok(people.noBoqPm, "GET", "/notifications/summary");
    expect([summary.unread, summary.read, summary.archived]).toEqual([1, 0, 0]);
    expect(summary.recent.map((row) => row.id)).toEqual([stored.other.id]);
    for (const status of ["unread", "active", "read", "archived"]) {
      const listed = (await ok(people.noBoqPm, "GET", `/notifications?status=${status}&limit=100`)).rows;
      expect([status, boqRows(listed)]).toEqual([status, []]);
    }

    // The reviewer still reads their own stored allocation row.
    expect((await inbox(people.reviewer)).map((row) => row.id)).toContain(stored.reviewers.id);
  });

  it("such a row cannot be opened, marked read or archived: it answers 404 as if it did not exist", async () => {
    for (const id of [stored.allocation.id, stored.revision.id]) {
      for (const [method, route, body] of [
        ["GET", `/notifications/${id}`],
        ["PATCH", `/notifications/${id}/read`, { read: true }],
        ["PATCH", `/notifications/${id}/archive`, {}],
        ["POST", `/notifications/${id}/retry-email`, {}],
      ]) {
        const response = await call(people.noBoqPm, method, route, body);
        expect([method, route, response.status, response.body?.error?.code]).toEqual([method, route, 404, "NOTIFICATION_NOT_FOUND"]);
      }
    }
    // Their other notification opens as before.
    expect((await ok(people.noBoqPm, "GET", `/notifications/${stored.other.id}`)).id).toBe(stored.other.id);
  });

  it("the reviewer's approval tells the submitter, and still not the member without BOQ read", async () => {
    await ok(people.reviewer, "POST", `/projects/${project.id}/activity-boq-allocations/${records.allocation.id}/approve`, {});
    const admin = (await inbox(people.admin)).filter((row) => row.entityId === records.allocation.id);
    expect(admin.map((row) => row.title)).toEqual(["BOQ allocation for Activity C900 approved"]);
    expect(
      await prisma.notification.count({
        where: { orgId: live.org.id, recipientUserId: people.noBoqPm.id, entityType: { in: ["activity_boq_allocation", "boq_revision"] } },
      }),
    ).toBe(2); // the two rows stored before the rule, and nothing since
  });

  it("mark-all-read reads what they read and leaves the hidden rows as they were; no stored row is rewritten", async () => {
    const marked = await ok(people.noBoqPm, "POST", "/notifications/mark-read", {});
    expect(marked.updated).toBe(1);
    const after = await prisma.notification.findUnique({ where: { id: stored.other.id }, select: { readAt: true } });
    expect(after.readAt).toBeInstanceOf(Date);
    expect((await ok(people.noBoqPm, "GET", "/notifications/summary")).unread).toBe(0);

    for (const key of ["allocation", "revision", "reviewers"]) {
      const row = await prisma.notification.findUnique({ where: { id: stored[key].id }, select: ROW_FIELDS });
      expect([key, row]).toEqual([key, Object.fromEntries(Object.keys(ROW_FIELDS).map((field) => [field, stored[key][field]]))]);
    }
  });
});
