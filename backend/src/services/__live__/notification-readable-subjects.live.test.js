/**
 * A notification never names its record by a raw database id — proven
 * against a real API process and the real local Postgres (owner,
 * 2026-09-28: the field app's Notifications screen read "BOQ allocation
 * 0766b8b4-d88d-45e1-b1fc-8423788b1bfb needs approval").
 *
 *   An allocation whose activity has a code is "BOQ allocation for Activity
 *   A120 needs approval"; one whose activity has none is named by its BOQ
 *   row's description. A project manager whose template takes the BOQ away
 *   (utils/boq-figures) receives no allocation notice at all
 *   (notification-boq-readers.live.test.js).
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
    // The project manager without BOQ read is not told of the bill's records at all.
    expect(fresh(await inbox(people.noBoqPm)).map((row) => row.title)).toEqual([]);
    // The reviewer approved; the admin, who submitted it, hears of it.
    const admin = (await inbox(people.admin)).filter((row) => row.entityId === id);
    expect(admin.map((row) => row.title)).toEqual(["BOQ allocation for Activity A120 approved"]);
    expect(admin[0].message).toBe("BOQ allocation: Activity A120. Status moved to approved.");
  });

  it("an allocation with no activity code: its BOQ row's description for a reader of the BOQ, nothing for anyone else", async () => {
    const id = records.uncodedAllocation.id;
    const newest = (rows) => rows.filter((row) => row.entityId === id && row.event === "workflow.submitted");
    const reviewer = newest(await inbox(people.reviewer));
    const noBoq = newest(await inbox(people.noBoqPm));
    expect(reviewer.map((row) => [row.title, row.message])).toEqual([
      ["BOQ allocation for Rebar to Foundations needs approval", "BOQ allocation: Rebar to Foundations. Status moved to submitted."],
    ]);
    expect(noBoq).toEqual([]);
    // Not written for them at all: nothing is hidden in the browser.
    const stored = await prisma.notification.findMany({
      where: { orgId: live.org.id, entityId: id, event: "workflow.submitted", recipientUserId: people.noBoqPm.id },
      select: { title: true, message: true },
    });
    expect(stored).toEqual([]);
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
    // The same kind of row stored for the member who may not read the BOQ is
    // left out of what they read (and, below, left as it was stored).
    expect((await inbox(people.noBoqPm)).map((row) => row.id)).not.toContain(legacyRows.uncodedForNoBoq.id);

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

  it("a cost loading rejected with a reason is rejected — its reason stored, its workflow event recorded, and its submitter told 'Cost loading for Activity A120 rejected'", async () => {
    // Last in this file, so no earlier answer moves: a second loading on the
    // coded activity, submitted by the admin and rejected by the reviewer.
    // (Before the fix every reject answered 500 "rejectedReason is not
    // defined" and wrote nothing.)
    const base = `/projects/${project.id}/reports/cost-loading`;
    const loading = await ok(people.admin, "POST", base, { activityId: records.coded.id, plannedDate: "2026-02-13", plannedValue: 500 }, 201);
    await ok(people.admin, "POST", `${base}/${loading.id}/submit`, {});
    const rejected = await ok(people.reviewer, "POST", `${base}/${loading.id}/reject`, { reason: "Wrong period" });
    expect([rejected.id, rejected.status, rejected.rejectedBy, rejected.rejectedReason]).toEqual([loading.id, "rejected", people.reviewer.id, "Wrong period"]);
    // Stored: the one row, by its key.
    const stored = await prisma.activityCostLoading.findUnique({ where: { id: loading.id }, select: { status: true, rejectedBy: true, rejectedReason: true, rejectedAt: true } });
    expect([stored.status, stored.rejectedBy, stored.rejectedReason, stored.rejectedAt instanceof Date]).toEqual(["rejected", people.reviewer.id, "Wrong period", true]);
    // The workflow records the decision with its reason.
    const events = await prisma.approvalWorkflowEvent.findMany({
      where: { orgId: live.org.id, recordId: loading.id, toStatus: "rejected" },
      select: { fromStatus: true, toStatus: true, reason: true },
    });
    expect(events).toEqual([{ fromStatus: "submitted", toStatus: "rejected", reason: "Wrong period" }]);
    // The admin, who submitted it, hears of it — in words.
    const heard = (await inbox(people.admin)).filter((row) => row.entityId === loading.id && row.event === "workflow.rejected");
    expect(heard.map((row) => row.title)).toEqual(["Cost loading for Activity A120 rejected"]);
    expect([heard[0].title, heard[0].message]).toEqual([expect.not.stringMatching(IDENTIFIER), expect.not.stringMatching(IDENTIFIER)]);
  });

  it("a mention on a cost record is written naming the record by its activity — 'Cost record for Activity A120' — never its id, in the stored row as in what is read", async () => {
    // Last in this file. The admin's cost record on the coded activity, and
    // a comment on it mentioning the reviewer.
    const record = await ok(people.admin, "POST", `/projects/${project.id}/cost/activity/${records.coded.id}`, { committed: 0, forecast: 0 }, 201);
    await ok(people.admin, "POST", `/projects/${project.id}/comments`, {
      recordType: "cost_record",
      recordId: record.id,
      body: "Please check the committed figure",
      mentionUserIds: [people.reviewer.id],
    }, 201);
    // Stored: the words, written as they are read — no identifier to strip.
    const stored = await prisma.notification.findMany({
      where: { orgId: live.org.id, recipientUserId: people.reviewer.id, entityType: "cost_record" },
      select: { title: true, message: true },
    });
    const onRecord = stored.filter((row) => row.title.includes("Cost record"));
    expect(onRecord.length).toBeGreaterThanOrEqual(1);
    for (const row of onRecord) {
      expect([row.title, IDENTIFIER.test(row.title), IDENTIFIER.test(row.message)]).toEqual([row.title, false, false]);
      expect(row.title).toMatch(/mentioned you on Cost record for Activity A120$/);
    }
    // ... and read the same through the API.
    const read = (await inbox(people.reviewer)).filter((row) => row.title.includes("Cost record"));
    expect(read.map((row) => row.title).sort()).toEqual(onRecord.map((row) => row.title).sort());
  });

  it("a mention on a progress submission is written naming it by its activity — 'Progress submission for Activity A120' — never its id", async () => {
    // Last in this file. The admin submits progress on the coded activity
    // and mentions the reviewer on the submission.
    await ok(people.admin, "POST", `/projects/${project.id}/activities/${records.coded.id}/progress`, { pctComplete: 20 });
    const submission = await prisma.progressSubmission.findFirst({
      where: { projectId: project.id, activityId: records.coded.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    expect(submission).not.toBeNull();
    await ok(people.admin, "POST", `/projects/${project.id}/comments`, {
      recordType: "progress_submission",
      recordId: submission.id,
      body: "Please check the quantity",
      mentionUserIds: [people.reviewer.id],
    }, 201);
    const stored = await prisma.notification.findMany({
      where: { orgId: live.org.id, recipientUserId: people.reviewer.id, entityType: "progress_submission", entityId: submission.id },
      select: { title: true, message: true },
    });
    expect(stored.length).toBeGreaterThanOrEqual(1);
    for (const row of stored) {
      expect([row.title, IDENTIFIER.test(row.title), IDENTIFIER.test(row.message)]).toEqual([row.title, false, false]);
      expect(row.title).toMatch(/on Progress submission for Activity A120$/);
    }
    const read = (await inbox(people.reviewer)).filter((row) => row.entityId === submission.id);
    expect(read.map((row) => row.title).sort()).toEqual(stored.map((row) => row.title).sort());
  });

  it("a reviewer's reason that names another record by its id reads back without that id — never with this record's name in its place — and the stored row is left as written", async () => {
    // Last in this file. The reviewer rejects the uncoded allocation (still
    // submitted), saying it duplicates the coded one — by its id.
    const other = records.codedAllocation.id;
    const id = records.uncodedAllocation.id;
    await ok(people.reviewer, "POST", `/projects/${project.id}/activity-boq-allocations/${id}/reject`, { reason: `Duplicate of allocation ${other}` });
    const stored = await prisma.notification.findMany({
      where: { orgId: live.org.id, recipientUserId: people.admin.id, entityId: id, event: "workflow.rejected" },
      select: { id: true, message: true },
    });
    expect(stored.length).toBe(1);
    // The reason is stored as the reviewer wrote it.
    expect(stored[0].message).toContain(`Duplicate of allocation ${other}`);
    const [heard] = (await inbox(people.admin)).filter((row) => row.id === stored[0].id);
    expect(heard.title).toBe("BOQ allocation for Rebar to Foundations rejected");
    // The id is taken out; the allocation is not said to duplicate itself.
    expect(heard.message).not.toMatch(IDENTIFIER);
    expect(heard.message).not.toContain("Duplicate of allocation Rebar to Foundations");
    expect(heard.message).toMatch(/^BOQ allocation: Rebar to Foundations. .*Duplicate of allocation.?$/);
    const one = await ok(people.admin, "GET", `/notifications/${stored[0].id}`);
    expect(one.message).toBe(heard.message);
    // Reading never rewrites the row.
    expect(await prisma.notification.findUnique({ where: { id: stored[0].id }, select: { message: true } })).toEqual({ message: stored[0].message });
  });

  it("paging the list returns every notification exactly once — none lost at a page boundary", async () => {
    // A list no longer than a page proves nothing: someone's must cross
    // several boundaries.
    let longest = 0;
    for (const person of Object.values(people)) {
      const all = (await inbox(person)).map((row) => row.id);
      longest = Math.max(longest, all.length);
      for (const limit of [1, 2, 3]) {
        const seen = [];
        let cursor = null;
        for (let guard = 0; guard < 200; guard += 1) {
          const page = await ok(person, "GET", `/notifications?status=all&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
          seen.push(...page.rows.map((row) => row.id));
          if (!page.pagination.nextCursor) break;
          cursor = page.pagination.nextCursor;
        }
        expect([person.id, limit, seen]).toEqual([person.id, limit, all]);
      }
    }
    expect(longest).toBeGreaterThan(3);
  });
});
