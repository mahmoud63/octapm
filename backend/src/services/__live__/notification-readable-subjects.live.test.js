/**
 * A notification never names its record by a raw database id — proven
 * against a real API process and the real local Postgres (owner,
 * 2026-09-28: the field app's Notifications screen read "BOQ allocation
 * 0766b8b4-d88d-45e1-b1fc-8423788b1bfb needs approval").
 *
 *   An allocation whose activity has a code is "BOQ allocation for Activity
 *   A120 needs approval"; one whose activity has none is named by its BOQ
 *   row's description for a reader of the BOQ, and by its kind alone for a
 *   project manager whose template takes the BOQ away (utils/boq-figures).
 *   A cost loading is named by its activity's code.
 *
 *   A row stored before the rule (title "<kind> <uuid> …", message
 *   "<kind>: Workflow record. …" — the shape of the 714 rows in the shared
 *   database) reads back through the API in words, and the stored row is
 *   left exactly as it was.
 *
 *   A regex sweep over every notification every person in the organisation
 *   receives — the list, the summary, each notification on its own — finds
 *   no UUID-shaped token in a title or a message. The link is untouched: it
 *   still carries the record's id, is the record's workspace path, and the
 *   record it names is in that project.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation that is
 * dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/notification-readable-subjects.live.test.js
 */
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  createLiveUser,
  dropLiveOrg,
  liveDescribe,
  mintAccessToken,
} = require("../../__live__/helpers");
const { recordWorkspacePath, workspacePath, workspaceSegment } = require("../../utils/record-links");
const { startApi } = require("./auth-live-kit");

const IDENTIFIER = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

liveDescribe("a notification names its record in words, never by its database id", () => {
  let live;
  let api;
  let project;
  let org;
  const people = {};
  const records = {};
  const legacyRows = {};
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });

  const call = async (user, method, route, body) => {
    const response = await api.request(method, `/api/v1${route}`, { body, headers: as(user) });
    return response;
  };
  const ok = async (user, method, route, body, status = 200) => {
    const response = await call(user, method, route, body);
    expect([method, route, response.status, response.body?.error]).toEqual([method, route, status, undefined]);
    return response.body.data;
  };
  const inbox = async (user) => (await ok(user, "GET", "/notifications?status=all&limit=100")).rows;
  const titled = (rows, entityId) => rows.filter((row) => row.entityId === entityId).map((row) => row.title).sort();

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    org = await prisma.organisation.findUnique({ where: { id: live.org.id }, select: { id: true, slug: true, name: true } });
    expect(org.name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" });
    project = await prisma.project.create({
      data: { orgId: live.org.id, name: "LiveTest readable notifications", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    people.admin = live.user;
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: live.user.id, role: "pm", orgId: live.org.id } });

    // Two more project managers: one who reads the BOQ, and one whose
    // template takes the BOQ tool away.
    const tag = Date.now();
    for (const [key, noBoq] of [["reviewer", false], ["noBoqPm", true]]) {
      const user = await createLiveUser(prisma, {
        orgId: live.org.id,
        name: `LiveTest ${key}`,
        email: `live-notif-${key.toLowerCase()}-${tag}@octapm-live.test`,
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
    const item = async (code, description) =>
      (await ok(people.admin, "POST", `${base}/boq/items`, { code, description, quantity: 10, unit: "m3", rate: 100 }, 201)).item;
    const activity = async (payload) =>
      ok(people.admin, "POST", `${base}/activities`, { duration: 5, startDate: "2026-02-02", endDate: "2026-02-06", engineerIds: [people.admin.id], ...payload }, 201);
    records.concrete = await item("1.1", "Concrete Foundations");
    records.rebar = await item("1.2", "Rebar to Foundations");
    records.coded = await activity({ name: "Pour foundations", activityCode: "A120" });
    records.uncoded = await activity({ name: "Fix rebar" });
    expect(records.uncoded.activityCode ?? null).toBeNull();

    // Allocation 1 (coded activity): the admin submits, the reviewer approves.
    const allocations = `${base}/activity-boq-allocations`;
    records.codedAllocation = await ok(people.admin, "POST", allocations, { boqItemId: records.concrete.id, activityId: records.coded.id, quantity: 10 }, 201);
    await ok(people.admin, "POST", `${allocations}/${records.codedAllocation.id}/submit`, {});
    await ok(people.reviewer, "POST", `${allocations}/${records.codedAllocation.id}/approve`, {});
    // Allocation 2 (activity with no code): submitted, awaiting approval.
    records.uncodedAllocation = await ok(people.admin, "POST", allocations, { boqItemId: records.rebar.id, activityId: records.uncoded.id, quantity: 10 }, 201);
    await ok(people.admin, "POST", `${allocations}/${records.uncodedAllocation.id}/submit`, {});
    // A cost loading on the coded activity, submitted.
    records.loading = await ok(people.admin, "POST", `${base}/reports/cost-loading`, { activityId: records.coded.id, plannedDate: "2026-02-06", plannedValue: 1000 }, 201);
    await ok(people.admin, "POST", `${base}/reports/cost-loading/${records.loading.id}/submit`, {});

    // Rows as they were stored before the rule, for the reviewer and for the
    // project manager who may not read the BOQ.
    const legacy = (recipient, recordType, record, label, action) => ({
      orgId: live.org.id,
      projectId: project.id,
      recipientUserId: recipient.id,
      type: "workflow",
      category: "approval",
      event: `workflow.${action}`,
      title: `${label} ${record.id} ${action === "submitted" ? "needs approval" : action}`,
      message: `${label}: Workflow record. Status moved to ${action}.`,
      priority: "high",
      inAppVisible: true,
      actionUrl: `/projects/${project.id}?recordId=${record.id}&source=${recordType}`,
      entityType: recordType,
      entityId: record.id,
      metadataJson: { action, toStatus: action, recordId: record.id, recordType },
    });
    legacyRows.allocation = await prisma.notification.create({
      data: legacy(people.reviewer, "activity_boq_allocation", records.codedAllocation, "BOQ allocation", "submitted"),
    });
    legacyRows.uncodedForReviewer = await prisma.notification.create({
      data: legacy(people.reviewer, "activity_boq_allocation", records.uncodedAllocation, "BOQ allocation", "approved"),
    });
    legacyRows.uncodedForNoBoq = await prisma.notification.create({
      data: legacy(people.noBoqPm, "activity_boq_allocation", records.uncodedAllocation, "BOQ allocation", "approved"),
    });
    legacyRows.loading = await prisma.notification.create({
      data: legacy(people.reviewer, "activity_cost_loading", records.loading, "Cost loading", "approved"),
    });
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

  it("the member without BOQ read really may not read the BOQ (the premise)", async () => {
    expect((await call(people.noBoqPm, "GET", `/projects/${project.id}/boq`)).status).toBe(403);
    expect((await call(people.reviewer, "GET", `/projects/${project.id}/boq`)).status).toBe(200);
  });

  it("an allocation with an activity code: 'BOQ allocation for Activity A120 needs approval' / '… approved'", async () => {
    const id = records.codedAllocation.id;
    const fresh = (rows) => rows.filter((row) => row.entityId === id && !row.id.startsWith(legacyRows.allocation.id));
    expect(fresh(await inbox(people.reviewer)).map((row) => row.title)).toContain("BOQ allocation for Activity A120 needs approval");
    expect(fresh(await inbox(people.noBoqPm)).map((row) => row.title)).toEqual(["BOQ allocation for Activity A120 needs approval"]);
    // The reviewer approved; the admin, who submitted it, hears of it.
    const admin = (await inbox(people.admin)).filter((row) => row.entityId === id);
    expect(admin.map((row) => row.title)).toEqual(["BOQ allocation for Activity A120 approved"]);
    expect(admin[0].message).toBe("BOQ allocation: Activity A120. Status moved to approved.");
  });

  it("an allocation with no activity code: its BOQ row's description for a reader of the BOQ, its kind for anyone else", async () => {
    const id = records.uncodedAllocation.id;
    const newest = (rows) => rows.filter((row) => row.entityId === id && row.event === "workflow.submitted");
    const reviewer = newest(await inbox(people.reviewer));
    const noBoq = newest(await inbox(people.noBoqPm));
    expect(reviewer.map((row) => [row.title, row.message])).toEqual([
      ["BOQ allocation for Rebar to Foundations needs approval", "BOQ allocation: Rebar to Foundations. Status moved to submitted."],
    ]);
    expect(noBoq.map((row) => [row.title, row.message])).toEqual([
      ["BOQ allocation needs approval", "BOQ allocation needs approval. Status moved to submitted."],
    ]);
    // Stored that way, per recipient: nothing is hidden in the browser.
    const stored = await prisma.notification.findMany({
      where: { orgId: live.org.id, entityId: id, event: "workflow.submitted", recipientUserId: people.noBoqPm.id },
      select: { title: true, message: true },
    });
    expect(stored).toEqual([{ title: "BOQ allocation needs approval", message: "BOQ allocation needs approval. Status moved to submitted." }]);
  });

  it("a cost loading is named by its activity's code", async () => {
    const titles = titled(await inbox(people.reviewer), records.loading.id);
    expect(titles).toContain("Cost loading for Activity A120 needs approval");
  });

  it("a row stored before the rule reads back in words through the list, the summary and on its own — and is not rewritten", async () => {
    const rows = await inbox(people.reviewer);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect([byId.get(legacyRows.allocation.id).title, byId.get(legacyRows.allocation.id).message]).toEqual([
      "BOQ allocation for Activity A120 needs approval",
      "BOQ allocation: Activity A120. Status moved to submitted.",
    ]);
    expect(byId.get(legacyRows.uncodedForReviewer.id).title).toBe("BOQ allocation for Rebar to Foundations approved");
    expect(byId.get(legacyRows.loading.id).title).toBe("Cost loading for Activity A120 approved");
    expect(byId.get(legacyRows.loading.id).message).toBe("Cost loading: Activity A120. Status moved to approved.");
    // The same row for the member who may not read the BOQ names it by its kind.
    const noBoq = (await inbox(people.noBoqPm)).find((row) => row.id === legacyRows.uncodedForNoBoq.id);
    expect([noBoq.title, noBoq.message]).toEqual(["BOQ allocation approved", "BOQ allocation approved. Status moved to approved."]);

    const one = await ok(people.reviewer, "GET", `/notifications/${legacyRows.allocation.id}`);
    expect(one.title).toBe("BOQ allocation for Activity A120 needs approval");
    const read = await ok(people.reviewer, "PATCH", `/notifications/${legacyRows.loading.id}/read`, { read: true });
    expect(read.title).toBe("Cost loading for Activity A120 approved");

    // The link is the row's own.
    expect(one.actionUrl).toBe(legacyRows.allocation.actionUrl);
    expect(one.entityId).toBe(records.codedAllocation.id);

    // The stored rows are exactly as they were written.
    for (const row of Object.values(legacyRows)) {
      const stored = await prisma.notification.findUnique({ where: { id: row.id }, select: { title: true, message: true, actionUrl: true } });
      expect(stored).toEqual({ title: row.title, message: row.message, actionUrl: row.actionUrl });
      expect(stored.title).toMatch(IDENTIFIER);
    }
  });

  it("no notification anyone in the organisation receives carries a UUID in its title or message", async () => {
    let swept = 0;
    for (const person of Object.values(people)) {
      const rows = await inbox(person);
      const summary = await ok(person, "GET", "/notifications/summary");
      const each = await Promise.all(rows.map((row) => ok(person, "GET", `/notifications/${row.id}`)));
      for (const row of [...rows, ...summary.recent, ...each]) {
        expect([row.id, row.title]).toEqual([row.id, expect.not.stringMatching(IDENTIFIER)]);
        expect([row.id, row.message]).toEqual([row.id, expect.not.stringMatching(IDENTIFIER)]);
        expect(`${row.title} ${row.message}`).not.toContain("Workflow record");
        swept += 1;
      }
    }
    // The sweep read the workflow notifications of all three people.
    expect(swept).toBeGreaterThanOrEqual(12);
  });

  it("the link still opens the record: unchanged, the record's workspace path, and the record is in that project", async () => {
    const workflowRows = [];
    for (const person of Object.values(people)) {
      for (const row of await inbox(person)) if (row.event.startsWith("workflow.")) workflowRows.push(row);
    }
    expect(workflowRows.length).toBeGreaterThanOrEqual(8);
    const legacyIds = new Set(Object.values(legacyRows).map((row) => row.id));
    for (const row of workflowRows) {
      expect(row.actionUrl).toContain(`recordId=${row.entityId}`);
      if (legacyIds.has(row.id)) continue; // stored before the workspace segment; the web redirects it
      // The link as it was before this change: the project, with the record
      // pre-selected by id and type.
      expect(row.actionUrl).toBe(
        `/o/${encodeURIComponent(workspaceSegment(org))}/projects/${project.id}?recordId=${row.entityId}&source=${row.entityType}`,
      );
      expect(row.actionUrl).toBe(
        workspacePath(
          recordWorkspacePath({ projectId: project.id, recordType: row.entityType, recordId: row.entityId }),
          workspaceSegment(org),
        ),
      );
      const model = row.entityType === "activity_boq_allocation" ? prisma.activityBoqAllocation : prisma.activityCostLoading;
      expect(await model.findFirst({ where: { id: row.entityId, projectId: project.id }, select: { id: true } })).toEqual({ id: row.entityId });
    }
  });
});
