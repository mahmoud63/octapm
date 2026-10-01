/**
 * PC-6 (core) — quantity progress entries: the pending layer of installed
 * quantity, proven against a real API process and the real local Postgres.
 *
 * In a throwaway "LiveTest <uuid>" organisation: a bill of two rows
 * (concrete in m3, rebar in t), a programme of two activities (the pour,
 * assigned to the site engineer; the fixing, not), one approved allocation
 * (100 m3 of concrete on the pour), and four people — the PM, a site
 * engineer (submit, not approve), a cost controller (progress read, no
 * submit) and a site engineer whose permission template takes the BOQ tool
 * away. A second organisation stands for the tenant rule.
 *
 * - create (draft, submitted), in the item's unit or an alias of it; a
 *   foreign unit, a negative quantity and a missing date are refused and
 *   nothing is written;
 * - the same clientRequestId twice: one row (201, then 200 replayed) — and
 *   the database refuses a second row by itself (P2002);
 * - the site-engineer assignment rule; a PM records on any activity;
 * - over-allocation and no-allocation: accepted, with a raw-comparison warning;
 * - list filters (activity, item, status, source, date range);
 * - patch / delete by the creator or an approver, never by another member,
 *   never of an approved entry; submit (draft → submitted), idempotent;
 * - a member without progress submit cannot record; another organisation's
 *   member gets the tenant 404 on every route;
 * - a member who may not read the BOQ sees that entries exist, their status,
 *   date and provenance — never a quantity, a unit, an item or an allocation;
 * - the read helpers (installedByActivity / installedByBoqItem at a cutoff,
 *   plannedQuantityFor: typed config, else Σ approved allocations);
 * - and throughout: ZERO ActivityProgress rows, the activity's official
 *   percentage and the EV report byte-identical — nothing here is official.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run test:live -- src/services/__live__/pc-6-quantity-entries.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const quantityProgressService = require("../quantity-progress.service");

liveDescribe("PC-6: quantity progress entries are recorded, never official by themselves", () => {
  let live;
  let other;
  let api;
  let project;
  let concrete;
  let rebar;
  let pour;
  let fix;
  let allocation;
  const members = {};
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const refused = (answer, status, code) => expect([answer.status, answer.body?.error?.code]).toEqual([status, code]);
  const entriesOf = (answer) => answer.body.data.entries;

  const activityIds = () => [pour.id, fix.id];
  const officialFootprint = async () =>
    JSON.stringify({
      progress: await prisma.activityProgress.findMany({ where: { activityId: { in: activityIds() } } }),
      submissions: await prisma.progressSubmission.findMany({ where: { projectId: project.id } }),
    });
  const evReport = async () => {
    const answer = await api.get(at("/reports/ev"), bearer(live.token));
    ok(answer);
    const { reporting, ...rest } = answer.body.data;
    return JSON.stringify(rest);
  };
  const officialPct = async (activityId) => {
    const answer = await api.get(at(`/activities/${activityId}`), bearer(live.token));
    ok(answer);
    return [answer.body.data.pctComplete, answer.body.data.progressApprovalStatus];
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DATABASE_CONNECTION_LIMIT: "4" }, { appOnly: true });
    project = await prisma.project.create({
      data: { orgId: live.org.id, currency: "USD", name: "LiveTest PC-6 quantity entries", timezone: "America/Chicago", startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    const tag = live.org.id.slice(0, 8);
    for (const [key, role, template] of [
      ["siteEngineer", "site_engineer", false],
      ["costController", "cost_controller", false],
      ["noBoq", "site_engineer", true],
    ]) {
      const member = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${key}`, email: `live-${key.toLowerCase()}-${tag}@octapm-live.test`, role });
      member.token = mintAccessToken(member);
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role, orgId: live.org.id } });
      if (template) {
        const row = await prisma.permissionTemplate.create({
          data: { orgId: live.org.id, name: `LiveTest ${role}, no BOQ ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } },
        });
        await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: row.id } });
      }
      members[key] = member;
    }

    const item = async (payload) => {
      const created = await api.post(at("/boq/items"), payload, bearer(live.token));
      ok(created, 201);
      return created.body.data.item;
    };
    concrete = await item({ code: "1.1", description: "Concrete in foundations", quantity: 300, unit: "Cu.M", rate: 100 });
    rebar = await item({ code: "1.2", description: "Reinforcement", quantity: 50, unit: "t", rate: 1000 });
    expect([concrete.unitCode, rebar.unitCode]).toEqual(["m3", "t"]);

    const activity = async (payload) => {
      const created = await api.post(at("/activities"), payload, bearer(live.token));
      ok(created, 201);
      return created.body.data;
    };
    pour = await activity({ name: "Pour foundations", activityCode: "A100", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06", engineerIds: [live.user.id, members.siteEngineer.id, members.noBoq.id] });
    fix = await activity({ name: "Fix reinforcement", activityCode: "A110", duration: 6, startDate: "2026-01-26", endDate: "2026-02-01", engineerIds: [live.user.id] });

    const created = await api.post(at("/activity-boq-allocations"), { boqItemId: concrete.id, activityId: pour.id, quantity: 100 }, bearer(live.token));
    ok(created, 201);
    allocation = created.body.data;
    for (const step of ["submit", "approve"]) ok(await api.post(at(`/activity-boq-allocations/${allocation.id}/${step}`), {}, bearer(live.token)));
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, other]) {
      if (!org) continue;
      for (const model of ["backgroundJob", "outboundEvent", "recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  let evBefore;
  let footprintBefore;
  const ids = {};

  it("nothing is recorded yet, and nothing official exists", async () => {
    evBefore = await evReport();
    footprintBefore = await officialFootprint();
    expect(await prisma.activityProgress.count({ where: { activityId: { in: activityIds() } } })).toBe(0);
    const list = await api.get(at("/quantity-progress"), bearer(live.token));
    ok(list);
    expect(list.body.data).toEqual([]);
  });

  it("a site engineer records a draft in an alias of the item's unit: stored under the unit code, with PROGRESS SOURCE provenance, and nothing becomes official", async () => {
    const answer = await api.post(at("/quantity-progress"), { activityId: pour.id, boqItemId: concrete.id, quantity: "40.1234", unit: "cum", date: "2026-09-01", note: "north strip", clientRequestId: "cr-1" }, bearer(members.siteEngineer.token));
    ok(answer, 201);
    expect(answer.body.data).toMatchObject({ created: 1, replayed: 0, warnings: [] });
    const entry = answer.body.data.entry;
    ids.siteDraft = entry.id;
    expect(entry).toMatchObject({
      projectId: project.id,
      activityId: pour.id,
      boqItemId: concrete.id,
      quantity: 40.123,
      unitCode: "m3",
      date: "2026-09-01",
      source: "manual",
      status: "draft",
      note: "north strip",
      clientRequestId: "cr-1",
      createdBy: members.siteEngineer.id,
      replayed: false,
      provenance: { source: "manual", recordedBy: members.siteEngineer.id, official: false, approvedBy: null, approvedAt: null, submissionId: null, dailyLogId: null },
      activity: { id: pour.id, name: "Pour foundations", code: "A100" },
      boqItem: { id: concrete.id, code: "1.1", unit: "Cu.M", unitCode: "m3" },
    });
    const row = await prisma.quantityProgressEntry.findUnique({ where: { id: entry.id } });
    expect([row.orgId, row.projectId, row.quantity.toString(), row.unitCode, row.status]).toEqual([live.org.id, project.id, "40.123", "m3", "draft"]);
    expect(await prisma.activityProgress.count({ where: { activityId: { in: activityIds() } } })).toBe(0);
    expect(await officialPct(pour.id)).toEqual([0, "missing"]);
    const events = await prisma.auditEvent.findMany({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", entityId: entry.id } });
    expect(events.map((event) => [event.action, event.newStatus, event.actorId])).toEqual([["created", "draft", members.siteEngineer.id]]);
  });

  it("the same clientRequestId again answers the entry it made (200, replayed) — and the database itself refuses a second row", async () => {
    const answer = await api.post(at("/quantity-progress"), { activityId: pour.id, boqItemId: concrete.id, quantity: 999, unit: "m3", date: "2026-09-02", clientRequestId: "cr-1" }, bearer(members.siteEngineer.token));
    ok(answer, 200);
    expect(answer.body.data).toMatchObject({ created: 0, replayed: 1 });
    expect(answer.body.data.entry).toMatchObject({ id: ids.siteDraft, quantity: 40.123, date: "2026-09-01", replayed: true });
    expect(await prisma.quantityProgressEntry.count({ where: { projectId: project.id, clientRequestId: "cr-1" } })).toBe(1);
    await expect(
      prisma.quantityProgressEntry.create({
        data: { orgId: live.org.id, projectId: project.id, activityId: pour.id, boqItemId: concrete.id, unitCode: "m3", quantity: 1, date: new Date("2026-09-01"), clientRequestId: "cr-1" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.quantityProgressEntry.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("a batch with a shared clientRequestId replays per entry", async () => {
    const batch = { clientRequestId: "batch-1", status: "submitted", entries: [
      { activityId: pour.id, boqItemId: concrete.id, quantity: 10, date: "2026-09-03" },
      { activityId: pour.id, boqItemId: concrete.id, quantity: 5.5, date: "2026-09-03", unit: "M3" },
    ] };
    const first = await api.post(at("/quantity-progress"), batch, bearer(members.siteEngineer.token));
    ok(first, 201);
    expect(first.body.data).toMatchObject({ created: 2, replayed: 0 });
    expect(entriesOf(first).map((row) => [row.clientRequestId, row.status, row.quantity])).toEqual([["batch-1:0", "submitted", 10], ["batch-1:1", "submitted", 5.5]]);
    ids.batch = entriesOf(first).map((row) => row.id);
    const again = await api.post(at("/quantity-progress"), batch, bearer(members.siteEngineer.token));
    ok(again, 200);
    expect(again.body.data).toMatchObject({ created: 0, replayed: 2 });
    expect(entriesOf(again).map((row) => row.id)).toEqual(ids.batch);
    expect(await prisma.quantityProgressEntry.count({ where: { projectId: project.id } })).toBe(3);
  });

  it("a foreign unit, a negative quantity, a missing date and a wrong allocation are refused and nothing is written", async () => {
    const before = await prisma.quantityProgressEntry.count({ where: { projectId: project.id } });
    const base = { activityId: pour.id, boqItemId: concrete.id, quantity: 1, date: "2026-09-04" };
    refused(await api.post(at("/quantity-progress"), { ...base, unit: "m2" }, bearer(live.token)), 400, "QUANTITY_UNIT_MISMATCH");
    refused(await api.post(at("/quantity-progress"), { ...base, unit: "litre" }, bearer(live.token)), 400, "QUANTITY_UNIT_MISMATCH");
    refused(await api.post(at("/quantity-progress"), { ...base, quantity: -1 }, bearer(live.token)), 400, "VALIDATION_ERROR");
    refused(await api.post(at("/quantity-progress"), { ...base, date: undefined }, bearer(live.token)), 400, "VALIDATION_ERROR");
    refused(await api.post(at("/quantity-progress"), { ...base, boqItemId: rebar.id, allocationId: allocation.id }, bearer(live.token)), 400, "QUANTITY_ALLOCATION_MISMATCH");
    refused(await api.post(at("/quantity-progress"), { ...base, status: "approved" }, bearer(live.token)), 400, "VALIDATION_ERROR");
    expect(await prisma.quantityProgressEntry.count({ where: { projectId: project.id } })).toBe(before);
  });

  it("the site-engineer assignment rule is the progress submission's own; a PM records on any activity, warned when the activity has no approved allocation of the item", async () => {
    refused(await api.post(at("/quantity-progress"), { activityId: fix.id, boqItemId: rebar.id, quantity: 2, date: "2026-09-04" }, bearer(members.siteEngineer.token)), 403, "ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED");
    const answer = await api.post(at("/quantity-progress"), { activityId: fix.id, boqItemId: rebar.id, quantity: 2, unit: "tonne", date: "2026-09-04", allocationId: null }, bearer(live.token));
    ok(answer, 201);
    ids.pmFix = answer.body.data.entry.id;
    expect(answer.body.data.entry).toMatchObject({ unitCode: "t", quantity: 2, status: "draft" });
    expect(answer.body.data.warnings).toEqual([expect.objectContaining({ code: "QUANTITY_NO_APPROVED_ALLOCATION", activityId: fix.id, boqItemId: rebar.id, entryId: ids.pmFix })]);
  });

  it("an entry past the approved allocation is accepted with a raw comparison — no block, no exception row", async () => {
    // The fixture stands in for approval (the approval writer is the progress
    // submission's and is proven with it): 40.123 m3 approved on the pour.
    await prisma.quantityProgressEntry.update({ where: { id: ids.siteDraft }, data: { status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-09-05T12:00:00Z") } });
    const answer = await api.post(at("/quantity-progress"), { activityId: pour.id, boqItemId: concrete.id, quantity: 70, date: "2026-09-06", allocationId: allocation.id }, bearer(live.token));
    ok(answer, 201);
    ids.pmOver = answer.body.data.entry.id;
    expect(answer.body.data.warnings).toEqual([
      expect.objectContaining({ code: "QUANTITY_OVER_ALLOCATION", entryId: ids.pmOver, activityId: pour.id, boqItemId: concrete.id, allocationQuantity: 100, approvedQuantity: 40.123, entryQuantity: 70, wouldBe: 110.123 }),
    ]);
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.pmOver } })).toMatchObject({ status: "draft", allocationId: allocation.id });
  });

  it("the list filters by activity, item, status, source and the day the work was done; the figures are the stored Decimal", async () => {
    const all = await api.get(at("/quantity-progress"), bearer(live.token));
    ok(all);
    expect(all.body.data).toHaveLength(5);
    expect(all.body.data.map((row) => row.date)).toEqual(["2026-09-06", "2026-09-04", "2026-09-03", "2026-09-03", "2026-09-01"]);
    const byActivity = await api.get(at(`/quantity-progress?activityId=${fix.id}`), bearer(live.token));
    ok(byActivity);
    expect(byActivity.body.data.map((row) => row.id)).toEqual([ids.pmFix]);
    const byItemAndStatus = await api.get(at(`/quantity-progress?boqItemId=${concrete.id}&status=submitted`), bearer(live.token));
    ok(byItemAndStatus);
    expect(byItemAndStatus.body.data.map((row) => row.id).sort()).toEqual([...ids.batch].sort());
    const byDays = await api.get(at("/quantity-progress?from=2026-09-02&to=2026-09-04&source=manual"), bearer(live.token));
    ok(byDays);
    expect(byDays.body.data.map((row) => row.date)).toEqual(["2026-09-04", "2026-09-03", "2026-09-03"]);
    refused(await api.get(at("/quantity-progress?status=official"), bearer(live.token)), 400, "VALIDATION_ERROR");
  });

  it("patch and delete are the creator's or an approver's; an approved entry is history", async () => {
    const [submittedA] = ids.batch;
    // The site engineer edits their own submitted entry.
    const mine = await api.request("PATCH", at(`/quantity-progress/${submittedA}`), { body: { quantity: 12, note: "re-measured" }, headers: bearer(members.siteEngineer.token) });
    ok(mine);
    expect(mine.body.data.entry).toMatchObject({ id: submittedA, quantity: 12, note: "re-measured", status: "submitted" });
    expect(mine.body.data.warnings).toEqual([]);
    // Not the PM's entry.
    refused(await api.request("PATCH", at(`/quantity-progress/${ids.pmFix}`), { body: { quantity: 3 }, headers: bearer(members.siteEngineer.token) }), 403, "QUANTITY_ENTRY_FORBIDDEN");
    refused(await api.request("DELETE", at(`/quantity-progress/${ids.pmFix}`), { headers: bearer(members.siteEngineer.token) }), 403, "QUANTITY_ENTRY_FORBIDDEN");
    // The PM, an approver, edits the site engineer's — in an alias of the unit.
    const theirs = await api.request("PATCH", at(`/quantity-progress/${submittedA}`), { body: { unit: "cubic metre", date: "2026-09-02" }, headers: bearer(live.token) });
    ok(theirs);
    expect(theirs.body.data.entry).toMatchObject({ unitCode: "m3", date: "2026-09-02", quantity: 12 });
    refused(await api.request("PATCH", at(`/quantity-progress/${submittedA}`), { body: { unit: "m2" }, headers: bearer(live.token) }), 400, "QUANTITY_UNIT_MISMATCH");
    refused(await api.request("PATCH", at(`/quantity-progress/${submittedA}`), { body: { activityId: fix.id }, headers: bearer(live.token) }), 400, "QUANTITY_ENTRY_IMMUTABLE_FIELD");
    // The approved entry is not changed or removed, by anyone.
    refused(await api.request("PATCH", at(`/quantity-progress/${ids.siteDraft}`), { body: { quantity: 1 }, headers: bearer(live.token) }), 409, "QUANTITY_ENTRY_LOCKED");
    refused(await api.request("DELETE", at(`/quantity-progress/${ids.siteDraft}`), { headers: bearer(live.token) }), 409, "QUANTITY_ENTRY_LOCKED");
    // The PM removes the over-allocation draft.
    const removed = await api.request("DELETE", at(`/quantity-progress/${ids.pmOver}`), { headers: bearer(live.token) });
    ok(removed);
    expect(removed.body.data).toEqual({ deleted: true, id: ids.pmOver });
    expect(await prisma.quantityProgressEntry.findUnique({ where: { id: ids.pmOver } })).toBeNull();
    refused(await api.get(at(`/quantity-progress/${ids.pmOver}`), bearer(live.token)), 404, "QUANTITY_ENTRY_NOT_FOUND");
    const events = await prisma.auditEvent.findMany({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", entityId: ids.pmOver }, orderBy: { occurredAt: "asc" } });
    expect(events.map((event) => event.action)).toEqual(["created", "deleted"]);
  });

  it("submit moves a draft to submitted, once; the assignment rule applies to the person submitting", async () => {
    refused(await api.post(at(`/quantity-progress/${ids.pmFix}/submit`), {}, bearer(members.siteEngineer.token)), 403, "QUANTITY_ENTRY_FORBIDDEN");
    const first = await api.post(at(`/quantity-progress/${ids.pmFix}/submit`), {}, bearer(live.token));
    ok(first);
    expect(first.body.data).toMatchObject({ submitted: true, entry: { id: ids.pmFix, status: "submitted", provenance: { official: false } } });
    const again = await api.post(at(`/quantity-progress/${ids.pmFix}/submit`), {}, bearer(live.token));
    ok(again);
    expect(again.body.data).toMatchObject({ submitted: false, entry: { status: "submitted" } });
    refused(await api.post(at(`/quantity-progress/${ids.siteDraft}/submit`), {}, bearer(live.token)), 409, "QUANTITY_ENTRY_NOT_SUBMITTABLE");
    const events = await prisma.auditEvent.findMany({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", entityId: ids.pmFix }, orderBy: { occurredAt: "asc" } });
    expect(events.map((event) => [event.action, event.oldStatus, event.newStatus])).toEqual([["created", null, "draft"], ["status_changed", "draft", "submitted"]]);
  });

  it("a member without progress submit reads but cannot record, edit, remove or submit", async () => {
    const token = members.costController.token;
    ok(await api.get(at("/quantity-progress"), bearer(token)));
    refused(await api.post(at("/quantity-progress"), { activityId: pour.id, boqItemId: concrete.id, quantity: 1, date: "2026-09-04" }, bearer(token)), 403, "FORBIDDEN");
    refused(await api.request("PATCH", at(`/quantity-progress/${ids.batch[0]}`), { body: { quantity: 1 }, headers: bearer(token) }), 403, "FORBIDDEN");
    refused(await api.request("DELETE", at(`/quantity-progress/${ids.batch[0]}`), { headers: bearer(token) }), 403, "FORBIDDEN");
    refused(await api.post(at(`/quantity-progress/${ids.batch[0]}/submit`), {}, bearer(token)), 403, "FORBIDDEN");
  });

  it("a member of another organisation gets the tenant 404 on every route, and writes nothing", async () => {
    const before = await prisma.quantityProgressEntry.count({ where: { projectId: project.id } });
    const token = other.token;
    refused(await api.get(at("/quantity-progress"), bearer(token)), 404, "PROJECT_NOT_FOUND");
    refused(await api.post(at("/quantity-progress"), { activityId: pour.id, boqItemId: concrete.id, quantity: 1, date: "2026-09-04" }, bearer(token)), 404, "PROJECT_NOT_FOUND");
    refused(await api.get(at(`/quantity-progress/${ids.batch[0]}`), bearer(token)), 404, "PROJECT_NOT_FOUND");
    refused(await api.request("PATCH", at(`/quantity-progress/${ids.batch[0]}`), { body: { quantity: 1 }, headers: bearer(token) }), 404, "PROJECT_NOT_FOUND");
    refused(await api.request("DELETE", at(`/quantity-progress/${ids.batch[0]}`), { headers: bearer(token) }), 404, "PROJECT_NOT_FOUND");
    refused(await api.post(at(`/quantity-progress/${ids.batch[0]}/submit`), {}, bearer(token)), 404, "PROJECT_NOT_FOUND");
    expect(await prisma.quantityProgressEntry.count({ where: { projectId: project.id } })).toBe(before);
    // The service's own tenant scope, below the route: the other organisation's id finds nothing.
    await expect(quantityProgressService.listEntries({ orgId: other.org.id, projectId: project.id })).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
    await expect(quantityProgressService.getEntry({ orgId: other.org.id, projectId: project.id, entryId: ids.batch[0] })).rejects.toMatchObject({ status: 404 });
  });

  it("a member who may not read the BOQ sees that entries exist, their status, date and provenance — never a quantity, a unit, an item or an allocation", async () => {
    const token = members.noBoq.token;
    const list = await api.get(at("/quantity-progress"), bearer(token));
    ok(list);
    expect(list.body.data).toHaveLength(4);
    for (const row of list.body.data) {
      for (const key of ["quantity", "unitCode", "boqItemId", "boqItem", "allocationId"]) expect(row).not.toHaveProperty(key);
      expect(row).toMatchObject({ activityId: expect.any(String), status: expect.any(String), date: expect.any(String), provenance: { source: "manual", recordedBy: expect.any(String) }, boqWithheld: { keys: ["quantity", "unitCode", "boqItemId", "boqItem", "allocationId"], reason: expect.stringMatching(/may read the BOQ/) } });
    }
    // No figure, no key carrying one (the keys are named only inside boqWithheld), no item or allocation id, no unit.
    expect(JSON.stringify(list.body.data)).not.toMatch(new RegExp(`40\\.123|"quantity":|"unitCode":|"boqItemId":|"allocationId":|${concrete.id}|${rebar.id}|${allocation.id}|"m3"`));
    // Their own write is answered the same way — figures withheld, warnings reduced to their code.
    const written = await api.post(at("/quantity-progress"), { activityId: pour.id, boqItemId: concrete.id, quantity: 80, unit: "m3", date: "2026-09-07", clientRequestId: "nb-1" }, bearer(token));
    ok(written, 201);
    expect(written.body.data.entry).not.toHaveProperty("quantity");
    expect(written.body.data.entry).toMatchObject({ status: "draft", createdBy: members.noBoq.id, boqWithheld: expect.any(Object) });
    expect(written.body.data.warnings).toEqual([{ code: "QUANTITY_OVER_ALLOCATION", entryId: written.body.data.entry.id, activityId: pour.id, boqWithheld: expect.objectContaining({ keys: expect.arrayContaining(["allocationQuantity", "wouldBe"]) }) }]);
    const one = await api.get(at(`/quantity-progress/${written.body.data.entry.id}`), bearer(token));
    ok(one);
    expect(one.body.data).not.toHaveProperty("quantity");
    // The row itself holds the figure: a BOQ reader sees it.
    const asPm = await api.get(at(`/quantity-progress/${written.body.data.entry.id}`), bearer(live.token));
    ok(asPm);
    expect(asPm.body.data).toMatchObject({ quantity: 80, unitCode: "m3", boqItemId: concrete.id });
    ids.noBoq = written.body.data.entry.id;
  });

  it("the read helpers: installed is Σ approved entries only, at a cutoff; planned is the typed figure, else Σ approved allocations", async () => {
    const args = { orgId: live.org.id, projectId: project.id };
    const byActivity = await quantityProgressService.installedByActivity(args);
    expect([...byActivity.keys()]).toEqual([pour.id]);
    expect(byActivity.get(pour.id)).toMatchObject({ installed: [{ boqItemId: concrete.id, unitCode: "m3", quantity: 40.123, entries: 1 }], lastApprovedAt: "2026-09-05T12:00:00.000Z" });
    const byItem = await quantityProgressService.installedByBoqItem({ ...args, boqItemIds: [concrete.id, rebar.id] });
    expect(byItem.get(concrete.id)).toMatchObject({ quantity: 40.123, unitCode: "m3", entries: 1 });
    expect(byItem.has(rebar.id)).toBe(false);
    // The cutoff is the end of that day in the project's zone (America/Chicago): the 4th excludes a 12:00Z approval on the 5th, the 5th includes it.
    expect((await quantityProgressService.installedByBoqItem({ ...args, cutoffDate: "2026-09-04" })).size).toBe(0);
    expect((await quantityProgressService.installedByBoqItem({ ...args, cutoffDate: "2026-09-05" })).get(concrete.id)).toMatchObject({ quantity: 40.123, asOf: "2026-09-06T04:59:59.999Z" });
    expect((await quantityProgressService.installedByActivity({ ...args, cutoffDate: new Date("2026-09-05T11:59:59Z") })).size).toBe(0);
    // Planned: the pour's approved allocation (100 m3) until a figure is typed on the method.
    await expect(quantityProgressService.plannedQuantityFor({ ...args, activityId: pour.id })).resolves.toMatchObject({ planned: 100, unitCode: "m3", basis: "approved_allocations", allocationIds: [allocation.id] });
    await expect(quantityProgressService.plannedQuantityFor({ ...args, activityId: fix.id })).resolves.toMatchObject({ planned: null, basis: "none" });
    ok(await api.request("PUT", at(`/activities/${pour.id}/progress-method`), { body: { method: "quantity", plannedQuantity: 250, quantityUnit: "m3" }, headers: bearer(live.token) }));
    await expect(quantityProgressService.plannedQuantityFor({ ...args, activityId: pour.id })).resolves.toEqual({ planned: 250, unitCode: "m3", basis: "method_config", method: "quantity" });
    // The method row is this test's own fixture: taken away again, the allocations decide once more
    // (and the EV report compared at the end sees the project as it stood).
    await prisma.activityProgressMethod.deleteMany({ where: { projectId: project.id, activityId: pour.id } });
    await expect(quantityProgressService.plannedQuantityFor({ ...args, activityId: pour.id })).resolves.toMatchObject({ planned: 100, basis: "approved_allocations" });
    // Another organisation's id reaches none of it.
    await expect(quantityProgressService.installedByBoqItem({ orgId: other.org.id, projectId: project.id })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("through all of it nothing became official: zero ActivityProgress rows, the official percentage and the EV report byte-identical", async () => {
    expect(await prisma.quantityProgressEntry.count({ where: { projectId: project.id } })).toBe(5);
    expect(await prisma.activityProgress.count({ where: { activityId: { in: activityIds() } } })).toBe(0);
    expect(await officialFootprint()).toBe(footprintBefore);
    expect(await officialPct(pour.id)).toEqual([0, "missing"]);
    expect(await evReport()).toBe(evBefore);
  });
});
