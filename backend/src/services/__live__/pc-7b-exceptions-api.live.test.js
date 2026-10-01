/**
 * PC-7b — the project exceptions API and the change-event handoff, proven
 * against a real API process and the real local Postgres.
 *
 * Exception rows are seeded DIRECTLY (the engine that derives them is another
 * track): this suite proves what the API does with them. A member reads only
 * the kinds of the modules they may read, and no BOQ-derived exception
 * without boq:read — withheld whole, with a marker and never a count; every
 * action is explicit, permission-checked and audited; "Raise change event"
 * creates exactly ONE draft change event (status open, amount blank) with the
 * typed link and writes nothing else (change orders, budget lines and
 * revisions, activities, cost records byte-identical); associate refuses
 * another project's event; another organisation is 404. The workspace
 * dashboard counts only what the caller may read, and a newly opened
 * critical exception notifies the project's PM and QS once.
 *
 * Everything lives in throwaway "LiveTest <uuid>" organisations dropped
 * afterwards. The exception engine's trigger and tick are switched off in the
 * spawned API (EXCEPTIONS_ENGINE_ENABLED=false).
 *
 *   npm run test:live -- src/services/__live__/pc-7b-exceptions-api.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const {
  createLiveOrg,
  createLiveUser,
  dropLiveOrg,
  liveDescribe,
  mintAccessToken,
} = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const BOQ_REASON =
  "Exceptions on the BOQ's items and allocations, and those measured from the BOQ's quantities or its mapping, are available only to members who may read the BOQ";

liveDescribe("PC-7b: the project exceptions API and the change-event handoff", () => {
  let live;
  let other;
  let api;
  let project;
  let project2;
  let otherProject;
  const ex = {};
  const members = {};
  const ids = {};
  const tag = Date.now();
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const pm = () => ({ authorization: `Bearer ${live.token}` });
  const at = (route, p = project) => `/api/v1/projects/${p.id}${route}`;
  const ok = (label, answer, status = 200) => expect([label, answer.status, answer.body?.error]).toEqual([label, status, undefined]);
  const refused = (label, answer, status, code) => expect([label, answer.status, answer.body?.error?.code]).toEqual([label, status, code]);
  const list = async (headers, qs = "") => api.get(at(`/controls/exceptions${qs}`), headers);
  const idsOf = (answer) => answer.body.data.data.map((row) => row.id).sort();

  // Everything the handoff must never touch, as stored.
  const footprint = async () => {
    const where = { projectId: project.id };
    const [changeOrders, activityLinks, allocationLinks, budgetLines, budgetLineChanges, budgetRevisions, activities, costRecords, allocations, boqItems, primeContracts] = await Promise.all([
      prisma.changeOrder.findMany({ where, orderBy: { id: "asc" } }),
      prisma.changeOrderActivityLink.findMany({ where, orderBy: { id: "asc" } }),
      prisma.changeOrderAllocationLink.findMany({ where, orderBy: { id: "asc" } }),
      prisma.budgetLine.findMany({ where, orderBy: { id: "asc" } }),
      prisma.budgetLineChange.findMany({ where, orderBy: { id: "asc" } }),
      prisma.budgetRevision.findMany({ where, orderBy: { id: "asc" } }),
      prisma.activity.findMany({ where, orderBy: { id: "asc" } }),
      prisma.costRecord.findMany({ where, orderBy: { id: "asc" } }),
      prisma.activityBoqAllocation.findMany({ where, orderBy: { id: "asc" } }),
      prisma.boqItem.findMany({ where, orderBy: { id: "asc" } }),
      prisma.primeContract.findMany({ where, orderBy: { id: "asc" } }),
    ]);
    return JSON.stringify({ changeOrders, activityLinks, allocationLinks, budgetLines, budgetLineChanges, budgetRevisions, activities, costRecords, allocations, boqItems, primeContracts });
  };

  const seedException = (data) =>
    prisma.projectException.create({
      data: {
        orgId: data.orgId || live.org.id,
        projectId: data.projectId || project.id,
        measuredBasis: "seeded: owning service basis (measured)",
        limitBasis: "seeded: owning service basis (limit)",
        ...data,
      },
    });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4", EXCEPTIONS_ENGINE_ENABLED: "false" });
    project = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-7b exceptions", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") } });
    project2 = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-7b second project", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") } });
    otherProject = await prisma.project.create({ data: { orgId: other.org.id, name: "LiveTest PC-7b other org", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") } });

    const member = async (key, role, { noBoq = false } = {}) => {
      const user = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${key}`, email: `live-pc7bx-${key.replace(/_/g, "")}-${tag}@octapm-live.test`, role });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: user.id, role, orgId: live.org.id } });
      if (noBoq) {
        const template = await prisma.permissionTemplate.create({ data: { orgId: live.org.id, name: `LiveTest ${key} ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } } });
        await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: user.id, templateId: template.id } });
      }
      members[key] = user;
    };
    await member("site_noboq", "site_engineer", { noBoq: true });
    await member("cost", "cost_controller");
    await member("cost_noboq", "cost_controller", { noBoq: true });
    await member("pm_member", "pm");
    await member("qs", "qs");
    await member("qs_noboq", "qs", { noBoq: true });
    const otherPm = await createLiveUser(prisma, { orgId: other.org.id, name: "LiveTest other pm", email: `live-pc7bx-otherpm-${tag}@octapm-live.test`, role: "pm" });
    members.other_pm = otherPm;

    // The bill, an activity, an approved allocation.
    const item = await api.post(at("/boq/items"), { code: "X7.1", description: "LTSECRET over-installed piling", quantity: 40, unit: "m", rate: 31.17 }, pm());
    ok("boq item", item, 201);
    ids.boqItem = item.body.data.item.id;
    const activity = await api.post(at("/activities"), { engineerIds: [live.user.id], name: "LiveTest activity PC7BX", activityCode: "P7X1", duration: 3, startDate: "2026-02-02", endDate: "2026-02-04" }, pm());
    ok("activity", activity, 201);
    ids.activity = activity.body.data.id;
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: ids.boqItem, activityId: ids.activity, quantity: 40 }, pm());
    ok("allocation", allocation, 201);
    ids.allocation = allocation.body.data.id;
    for (const step of ["submit", "approve"]) ok(`allocation ${step}`, await api.post(at(`/activity-boq-allocations/${ids.allocation}/${step}`), {}, pm()));

    // A location, a cost code on the project, a budget line.
    ids.location = crypto.randomUUID();
    await prisma.location.create({ data: { id: ids.location, orgId: live.org.id, projectId: project.id, name: "LiveTest Zone A", path: ids.location } });
    const costCode = await prisma.costCode.create({ data: { orgId: live.org.id, code: `LT7X-${tag}`, name: "LiveTest concrete" } });
    ids.costCode = costCode.id;
    await prisma.projectCostCode.create({ data: { orgId: live.org.id, projectId: project.id, costCodeId: costCode.id } });
    const budgetLine = await prisma.budgetLine.create({ data: { orgId: live.org.id, projectId: project.id, costCodeId: costCode.id, description: "LiveTest concrete works" } });
    ids.budgetLine = budgetLine.id;

    // The exceptions, as the engine would write them.
    ex.qtyAlloc = await seedException({ kind: "quantity_over_allocation", severity: "critical", subjectType: "allocation", subjectId: ids.allocation, measured: 45, limit: 40, unitCode: "m", locationId: ids.location });
    ex.qtyBoq = await seedException({ kind: "quantity_over_boq", severity: "warning", subjectType: "boq_item", subjectId: ids.boqItem, measured: 45, limit: 40, unitCode: "m" });
    ex.committed = await seedException({ kind: "committed_over_budget", severity: "critical", subjectType: "budget_line", subjectId: ids.budgetLine, costCodeId: ids.costCode, measured: 1200, limit: 1000 });
    ex.stale = await seedException({ kind: "progress_stale", severity: "info", subjectType: "activity", subjectId: ids.activity, measured: 30, limit: 14, unitCode: "d" });
    ex.slip = await seedException({ kind: "schedule_slip_on_mapped_item", severity: "warning", subjectType: "activity", subjectId: ids.activity, measured: 12, limit: 5, unitCode: "d" });
    ex.structure = await seedException({ kind: "structure_missing", severity: "info", subjectType: "activity", subjectId: ids.activity, measured: 1, limit: 0 });
    ex.forecast = await seedException({ kind: "forecast_over_revised", severity: "warning", subjectType: "project", subjectId: project.id, measured: 5000, limit: 4000 });
    ex.otherOrg = await seedException({ orgId: other.org.id, projectId: otherProject.id, kind: "committed_over_budget", severity: "critical", subjectType: "project", subjectId: otherProject.id, measured: 2, limit: 1 });
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, other]) {
      if (!org) continue;
      for (const model of ["notification", "projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  it("a PM reads every kind, serialized per the contract, with no withheld marker", async () => {
    const answer = await list(pm());
    ok("list", answer);
    expect(idsOf(answer)).toEqual([ex.qtyAlloc, ex.qtyBoq, ex.committed, ex.stale, ex.slip, ex.structure, ex.forecast].map((row) => row.id).sort());
    expect(answer.body.data).not.toHaveProperty("withheld");
    const row = answer.body.data.data.find((item) => item.id === ex.qtyAlloc.id);
    expect(row).toMatchObject({
      kind: "quantity_over_allocation",
      severity: "critical",
      status: "open",
      module: "boq",
      subject: { type: "allocation", id: ids.allocation, label: "X7.1 → P7X1 LiveTest activity PC7BX" },
      measured: { value: 45, unitCode: "m", basis: "seeded: owning service basis (measured)" },
      limit: { value: 40, unitCode: "m", basis: "seeded: owning service basis (limit)" },
      review: null,
      changeEvent: null,
      actions: { review: true, snooze: true, dismiss: true, raiseChangeEvent: true, associateChangeEvent: true },
    });
    expect(row.group.location).toMatchObject({ id: ids.location, name: "LiveTest Zone A" });
    const committed = answer.body.data.data.find((item) => item.id === ex.committed.id);
    expect(committed.group.costCode).toMatchObject({ id: ids.costCode, code: `LT7X-${tag}` });
    expect(committed.subject.label).toBe(`LT7X-${tag} LiveTest concrete works`);
    const one = await api.get(at(`/controls/exceptions/${ex.qtyAlloc.id}`), pm());
    ok("get", one);
    expect(one.body.data).toEqual(row);
  });

  it("a site engineer without boq:read sees no BOQ-derived exception and no money kind — withheld whole, a marker, never a count", async () => {
    const answer = await list(as(members.site_noboq), "?status=all");
    ok("list", answer);
    // progress_stale (progress) and structure_missing (schedule) only: not the
    // allocation / BOQ item kinds, not the mapped-item slip, not the cost kinds.
    expect(idsOf(answer)).toEqual([ex.stale.id, ex.structure.id].sort());
    expect(answer.body.data.withheld.reason).toContain(BOQ_REASON);
    expect(answer.body.data.withheld.modules).toEqual(["boq", "cost"]);
    expect(JSON.stringify(answer.body.data.withheld)).not.toMatch(/\d/);
    expect(JSON.stringify(answer.body)).not.toContain("LTSECRET");
    for (const id of [ex.qtyAlloc.id, ex.qtyBoq.id, ex.slip.id, ex.committed.id]) {
      refused(`get ${id}`, await api.get(at(`/controls/exceptions/${id}`), as(members.site_noboq)), 404, "EXCEPTION_NOT_FOUND");
    }
    // A filter that would match only withheld rows is an empty page with the marker, not "none".
    const filtered = await list(as(members.site_noboq), `?subject=activity:${ids.activity}&kind=schedule_slip_on_mapped_item`);
    ok("filtered", filtered);
    expect(filtered.body.data.data).toEqual([]);
    expect(filtered.body.data.withheld.modules).toEqual(["boq", "cost"]);
  });

  it("a cost controller sees the money kinds; without boq:read only the money kinds not built from the bill", async () => {
    const cost = await list(as(members.cost));
    ok("cost list", cost);
    expect(idsOf(cost)).toEqual([ex.qtyAlloc, ex.qtyBoq, ex.committed, ex.stale, ex.slip, ex.structure, ex.forecast].map((row) => row.id).sort());
    expect(cost.body.data).not.toHaveProperty("withheld");
    const committed = cost.body.data.data.find((row) => row.id === ex.committed.id);
    // cost:update reviews; no change_event:create, so no handoff.
    expect(committed.actions).toEqual({ review: true, snooze: true, dismiss: true, raiseChangeEvent: false, associateChangeEvent: false });
    // boq read but not boq update, no change_event update: no review on a BOQ kind.
    expect(cost.body.data.data.find((row) => row.id === ex.qtyBoq.id).actions.review).toBe(false);

    const noBoq = await list(as(members.cost_noboq));
    ok("cost_noboq list", noBoq);
    expect(idsOf(noBoq)).toEqual([ex.committed, ex.stale, ex.structure, ex.forecast].map((row) => row.id).sort());
    expect(noBoq.body.data.withheld).toEqual({ reason: BOQ_REASON, modules: ["boq"] });
  });

  it("filters by status, kind, severity and subject, and walks every page of the cursor once", async () => {
    const critical = await list(pm(), "?severity=critical");
    expect(idsOf(critical)).toEqual([ex.qtyAlloc.id, ex.committed.id].sort());
    const kinds = await list(pm(), "?kind=progress_stale,structure_missing");
    expect(idsOf(kinds)).toEqual([ex.stale.id, ex.structure.id].sort());
    // The activity's own exceptions and its allocation's.
    const activity = await list(pm(), `?subject=activity:${ids.activity}`);
    expect(idsOf(activity)).toEqual([ex.qtyAlloc.id, ex.stale.id, ex.slip.id, ex.structure.id].sort());
    const boqItem = await list(pm(), `?subjectType=boq_item&subjectId=${ids.boqItem}`);
    expect(idsOf(boqItem)).toEqual([ex.qtyAlloc.id, ex.qtyBoq.id].sort());
    const seen = [];
    let cursor = null;
    for (let page = 0; page < 10; page += 1) {
      const answer = await list(pm(), `?status=all&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      ok(`page ${page}`, answer);
      seen.push(...answer.body.data.data.map((row) => row.id));
      cursor = answer.body.data.pagination.nextCursor;
      if (!cursor) break;
    }
    expect(seen.length).toBe(7);
    expect(new Set(seen).size).toBe(7);
    refused("bad status", await list(pm(), "?status=bogus"), 400, "VALIDATION_ERROR");
  });

  it("review, snooze and dismiss: explicit, permission-checked, audited, and the dismissal keeps its fingerprint", async () => {
    // A site engineer may read progress_stale but update neither progress nor change events.
    refused("site review", await api.post(at(`/controls/exceptions/${ex.stale.id}/review`), { note: "seen" }, as(members.site_noboq)), 403, "FORBIDDEN");
    // An unreadable one is not said to exist, whatever the action.
    refused("site review hidden", await api.post(at(`/controls/exceptions/${ex.qtyAlloc.id}/review`), { note: "seen" }, as(members.site_noboq)), 404, "EXCEPTION_NOT_FOUND");
    refused("site dismiss hidden", await api.post(at(`/controls/exceptions/${ex.committed.id}/dismiss`), { reason: "x" }, as(members.site_noboq)), 404, "EXCEPTION_NOT_FOUND");
    refused("empty note", await api.post(at(`/controls/exceptions/${ex.committed.id}/review`), { note: " " }, as(members.cost)), 400, "VALIDATION_ERROR");

    const before = await footprint();
    const reviewed = await api.post(at(`/controls/exceptions/${ex.committed.id}/review`), { note: "LiveTest: commitment CO pending" }, as(members.cost));
    ok("review", reviewed);
    expect(reviewed.body.data.review).toMatchObject({ reviewedBy: members.cost.id, reviewedByName: "LiveTest cost", note: "LiveTest: commitment CO pending" });
    expect(reviewed.body.data.status).toBe("open");

    refused("snooze in the past", await api.post(at(`/controls/exceptions/${ex.structure.id}/snooze`), { until: "2020-01-01T00:00:00Z", reason: "later" }, pm()), 400, "EXCEPTION_SNOOZE_INVALID");
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const snoozed = await api.post(at(`/controls/exceptions/${ex.structure.id}/snooze`), { until, reason: "WBS import next week" }, pm());
    ok("snooze", snoozed);
    expect(snoozed.body.data).toMatchObject({ status: "snoozed", snooze: { until, by: live.user.id, reason: "WBS import next week" } });
    expect(snoozed.body.data.actions).toMatchObject({ snooze: true, dismiss: true, raiseChangeEvent: true });

    const dismissed = await api.post(at(`/controls/exceptions/${ex.forecast.id}/dismiss`), { reason: "Known: owner-funded allowance" }, pm());
    ok("dismiss", dismissed);
    expect(dismissed.body.data).toMatchObject({ status: "dismissed", dismissal: { reason: "Known: owner-funded allowance", by: live.user.id } });
    expect(dismissed.body.data.actions).toEqual({ review: false, snooze: false, dismiss: false, raiseChangeEvent: false, associateChangeEvent: false });
    const stored = await prisma.projectException.findUnique({ where: { id: ex.forecast.id } });
    expect(stored.resolvedAt).not.toBeNull();
    expect(stored.resolvedReason).toBe("dismissed:Known: owner-funded allowance");
    expect(stored.dataJson.dismissedFingerprint).toMatchObject({ measured: 5000, limit: 4000 });
    refused("dismiss twice", await api.post(at(`/controls/exceptions/${ex.forecast.id}/dismiss`), { reason: "again" }, pm()), 409, "EXCEPTION_NOT_OPEN");
    refused("snooze dismissed", await api.post(at(`/controls/exceptions/${ex.forecast.id}/snooze`), { until, reason: "x" }, pm()), 409, "EXCEPTION_NOT_OPEN");
    expect(idsOf(await list(pm(), "?status=dismissed"))).toEqual([ex.forecast.id]);
    expect(idsOf(await list(pm(), "?status=snoozed"))).toEqual([ex.structure.id]);
    expect(idsOf(await list(pm()))).not.toContain(ex.forecast.id);
    // The review actions change nothing but the exception.
    expect(await footprint()).toBe(before);

    const audit = await prisma.auditEvent.findMany({ where: { orgId: live.org.id, entityType: "project_exception" }, orderBy: { occurredAt: "asc" } });
    expect(audit.map((event) => [event.entityId, event.action, event.newStatus])).toEqual([
      [ex.committed.id, "updated", null],
      [ex.structure.id, "status_changed", "snoozed"],
      [ex.forecast.id, "status_changed", "dismissed"],
    ]);
    // No figure in any summary.
    for (const event of audit) expect(JSON.stringify(event.summaryJson)).not.toMatch(/1200|1000|5000|4000/);
  });

  it("raise change event: ONE draft change event, prefilled, amount blank, the typed link — and nothing else written", async () => {
    refused("no change_event:create", await api.post(at(`/controls/exceptions/${ex.qtyAlloc.id}/raise-change-event`), {}, as(members.cost)), 403, "FORBIDDEN");
    const prefill = await api.get(at(`/controls/exceptions/${ex.qtyAlloc.id}/change-event-prefill`), pm());
    ok("prefill", prefill);
    expect(prefill.body.data.links).toEqual({ exceptionId: ex.qtyAlloc.id });

    const before = await footprint();
    const events = await prisma.changeEvent.count({ where: { projectId: project.id } });
    const raised = await api.post(at(`/controls/exceptions/${ex.qtyAlloc.id}/raise-change-event`), { origin: "manual", rfiId: ex.qtyAlloc.id }, pm());
    ok("raise", raised, 201);
    expect(await prisma.changeEvent.count({ where: { projectId: project.id } })).toBe(events + 1);
    expect(await footprint()).toBe(before);

    const event = raised.body.data.changeEvent;
    expect(event).toMatchObject({ status: "open", origin: "exception", activityId: ids.activity, locationId: ids.location, romAmount: 0, totals: { rom: 0, quoted: null, estimate: 0 }, changeOrderId: null });
    expect(event.sourceLinks).toEqual([{ type: "project_exception", id: ex.qtyAlloc.id, path: null }]);
    expect(event.lines).toHaveLength(1);
    expect(event.lines[0]).toMatchObject({ activityId: ids.activity, quantity: 5, unit: "m", unitCost: 0, romAmount: 0, quotedAmount: null });
    // The change event is the commercial module's record: no BOQ item's words in it.
    expect(JSON.stringify(event)).not.toMatch(/LTSECRET|X7\.1/);
    const row = await prisma.changeEvent.findUnique({ where: { id: event.id } });
    expect(row).toMatchObject({ exceptionId: ex.qtyAlloc.id, rfiId: null, origin: "exception", status: "open" });
    expect(Number(row.romAmount)).toBe(0);
    expect(raised.body.data.exception).toMatchObject({ id: ex.qtyAlloc.id, status: "in_change", changeEvent: { id: event.id, ref: event.ref, status: "open" } });
    expect(raised.body.data.exception.actions).toMatchObject({ raiseChangeEvent: false, associateChangeEvent: false, dismiss: false, review: true });

    // Once: a second raise is refused and writes nothing.
    refused("raise twice", await api.post(at(`/controls/exceptions/${ex.qtyAlloc.id}/raise-change-event`), {}, pm()), 409, "EXCEPTION_IN_CHANGE");
    refused("dismiss in change", await api.post(at(`/controls/exceptions/${ex.qtyAlloc.id}/dismiss`), { reason: "x" }, pm()), 409, "EXCEPTION_IN_CHANGE");
    expect(await prisma.changeEvent.count({ where: { projectId: project.id } })).toBe(events + 1);
    expect(idsOf(await list(pm(), "?status=in_change"))).toEqual([ex.qtyAlloc.id]);

    // A money kind: the budget line and its cost code on the line; the QS's own title over the prefill.
    const money = await api.post(at(`/controls/exceptions/${ex.committed.id}/raise-change-event`), { title: "LiveTest commitment overrun" }, pm());
    ok("raise money", money, 201);
    expect(money.body.data.changeEvent).toMatchObject({ title: "LiveTest commitment overrun", origin: "exception", romAmount: 0 });
    expect(money.body.data.changeEvent.lines[0]).toMatchObject({ budgetLineId: ids.budgetLine, costCodeId: ids.costCode, quantity: 1, romAmount: 0 });
    expect(await footprint()).toBe(before);
    ids.raisedEvent = event.id;
  });

  it("associate: an event of the same project only; another project's or organisation's is refused", async () => {
    const elsewhere = await api.post(at("/change-events", project2), { title: "LiveTest other project event" }, pm());
    ok("project2 event", elsewhere, 201);
    const otherOrgEvent = await prisma.changeEvent.create({ data: { orgId: other.org.id, projectId: otherProject.id, number: 1, ref: "CE-001", title: "LiveTest other org event" } });
    refused("other project", await api.post(at(`/controls/exceptions/${ex.qtyBoq.id}/associate-change-event`), { changeEventId: elsewhere.body.data.id }, pm()), 404, "CHANGE_EVENT_NOT_FOUND");
    refused("other org", await api.post(at(`/controls/exceptions/${ex.qtyBoq.id}/associate-change-event`), { changeEventId: otherOrgEvent.id }, pm()), 404, "CHANGE_EVENT_NOT_FOUND");
    refused("no create", await api.post(at(`/controls/exceptions/${ex.qtyBoq.id}/associate-change-event`), { changeEventId: ids.raisedEvent }, as(members.cost)), 403, "FORBIDDEN");
    expect((await prisma.projectException.findUnique({ where: { id: ex.qtyBoq.id } })).changeEventId).toBeNull();

    const associated = await api.post(at(`/controls/exceptions/${ex.qtyBoq.id}/associate-change-event`), { changeEventId: ids.raisedEvent }, pm());
    ok("associate", associated);
    expect(associated.body.data).toMatchObject({ status: "in_change", changeEvent: { id: ids.raisedEvent } });
    // The association does not make the event "raised from" this exception.
    expect((await prisma.changeEvent.findUnique({ where: { id: ids.raisedEvent } })).exceptionId).toBe(ex.qtyAlloc.id);
  });

  it("raise change event from an RFI, daily log, NCR, punch item, drawing revision, submittal and meeting action: one shared helper, the typed link", async () => {
    const rfi = await prisma.rfi.create({ data: { projectId: project.id, ref: "RFI-LT7", subject: "LiveTest pile toe level", activityId: ids.activity, locationId: ids.location } });
    const dailyLog = await prisma.dailyLog.create({ data: { orgId: live.org.id, projectId: project.id, date: new Date("2026-03-04") } });
    const ncr = await prisma.ncrRecord.create({ data: { projectId: project.id, ref: "NCR-LT7", severity: "minor", description: "LiveTest honeycombing", activityId: ids.activity } });
    const punch = await prisma.punchItem.create({ data: { orgId: live.org.id, projectId: project.id, number: 1, ref: "PI-LT7", title: "LiveTest chipped edge", locationId: ids.location } });
    const document = await prisma.projectDocument.create({ data: { orgId: live.org.id, projectId: project.id, documentType: "drawing", originalName: "a.pdf", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, sha256: "0".repeat(64), storageProvider: "local", objectKey: `lt-${tag}`, storageKey: `lt-${tag}-${crypto.randomUUID()}` } });
    const revision = await prisma.sheetRevision.create({ data: { orgId: live.org.id, projectId: project.id, documentId: document.id, number: "A-101", title: "Pile layout", revision: "B" } });
    const submittal = await prisma.submittal.create({ data: { projectId: project.id, ref: "SUB-LT7", title: "LiveTest rebar shop drawings", activityId: ids.activity } });
    const meeting = await prisma.meeting.create({ data: { orgId: live.org.id, projectId: project.id, meetingNumber: "LT-1", title: "LiveTest progress meeting" } });
    const action = await prisma.meetingActionItem.create({ data: { orgId: live.org.id, projectId: project.id, meetingId: meeting.id, itemNumber: "1", title: "LiveTest confirm extra piles", dueDate: new Date("2026-03-10") } });

    const cases = [
      ["rfi", rfi.id, "rfiId", "rfi", "rfi", "RFI-LT7 LiveTest pile toe level", { activityId: ids.activity, locationId: ids.location }],
      ["daily-logs", dailyLog.id, "dailyLogId", "daily_log", "daily_log", "Daily log 2026-03-04", {}],
      ["ncr", ncr.id, "ncrId", "observation", "ncr", "NCR-LT7 LiveTest honeycombing", { activityId: ids.activity }],
      ["punch", punch.id, "punchItemId", "observation", "punch_item", "PI-LT7 LiveTest chipped edge", { locationId: ids.location }],
      ["drawings/sheets/revisions", revision.id, "drawingRevisionId", "other", "sheet_revision", "Drawing A-101 Pile layout rev B", {}],
      ["submittals", submittal.id, "submittalId", "submittal", "submittal", "SUB-LT7 LiveTest rebar shop drawings", { activityId: ids.activity }],
      ["meetings/action-items", action.id, "meetingActionItemId", "meeting", "meeting_action", "Meeting action: LiveTest confirm extra piles", {}],
    ];
    const before = await footprint();
    for (const [mount, id, field, origin, type, title, refs] of cases) {
      const prefill = await api.get(at(`/${mount}/${id}/change-event-prefill`), pm());
      ok(`prefill ${mount}`, prefill);
      expect(prefill.body.data).toMatchObject({ prefill: { title, origin, romAmount: 0, lines: [] }, links: { [field]: id } });
      const raised = await api.post(at(`/${mount}/${id}/raise-change-event`), {}, pm());
      ok(`raise ${mount}`, raised, 201);
      expect(raised.body.data).toMatchObject({ title, origin, status: "open", romAmount: 0, ...refs });
      expect(raised.body.data.sourceLinks).toEqual([expect.objectContaining({ type, id })]);
      const stored = await prisma.changeEvent.findUnique({ where: { id: raised.body.data.id } });
      expect(stored[field]).toBe(id);
      for (const otherField of ["rfiId", "dailyLogId", "ncrId", "punchItemId", "drawingRevisionId", "submittalId", "meetingActionItemId", "exceptionId"].filter((name) => name !== field)) expect([field, otherField, stored[otherField]]).toEqual([field, otherField, null]);
    }
    expect(await footprint()).toBe(before);
    // The source module's read and change_event:create are both needed.
    refused("cost rfi raise", await api.post(at(`/rfi/${rfi.id}/raise-change-event`), {}, as(members.cost)), 403, "FORBIDDEN");
    // Another project's record is not found through this project.
    const rfi2 = await prisma.rfi.create({ data: { projectId: project2.id, ref: "RFI-LT8", subject: "LiveTest elsewhere" } });
    refused("other project's rfi", await api.post(at(`/rfi/${rfi2.id}/raise-change-event`), {}, pm()), 404, "CHANGE_EVENT_SOURCE_NOT_FOUND");
    // The source module's own routes are untouched by the mount.
    ok("rfi list still served", await api.get(at("/rfi"), pm()));
  });

  it("tenancy: another organisation's project and exception are 404", async () => {
    expect((await api.get(at("/controls/exceptions"), as(members.other_pm))).status).toBe(404);
    expect((await api.get(at("/controls/exceptions", otherProject), pm())).status).toBe(404);
    refused("other org's exception id", await api.get(at(`/controls/exceptions/${ex.otherOrg.id}`), pm()), 404, "EXCEPTION_NOT_FOUND");
    refused("other org's exception action", await api.post(at(`/controls/exceptions/${ex.otherOrg.id}/dismiss`), { reason: "x" }, pm()), 404, "EXCEPTION_NOT_FOUND");
    expect((await prisma.projectException.findUnique({ where: { id: ex.otherOrg.id } })).resolvedAt).toBeNull();
  });

  it("the audit history withholds the exceptions a member may not read", async () => {
    const all = await api.get(at("/audit?entityType=project_exception&limit=100"), pm());
    ok("pm audit", all);
    const pmIds = new Set(all.body.data.events.map((event) => event.entityId || event.recordId));
    expect(pmIds.has(ex.qtyAlloc.id)).toBe(true);
    expect(pmIds.has(ex.committed.id)).toBe(true);
    const noBoq = await api.get(at("/audit?entityType=project_exception&limit=100"), as(members.cost_noboq));
    ok("cost_noboq audit", noBoq);
    const seen = new Set(noBoq.body.data.events.map((event) => event.entityId || event.recordId));
    expect(seen.has(ex.qtyAlloc.id)).toBe(false);
    expect(seen.has(ex.qtyBoq.id)).toBe(false);
    expect(seen.has(ex.committed.id)).toBe(true);
  });

  it("the workspace dashboard counts, org-wide, only the open exceptions the caller may read — and says when some are not counted", async () => {
    const full = await api.get("/api/v1/projects/workspace-dashboard", pm());
    ok("pm dashboard", full);
    // Open now: stale (info), slip (warning). In change: qtyAlloc, qtyBoq, committed. Snoozed: structure. Dismissed: forecast.
    expect(full.body.data.openExceptions).toMatchObject({ total: 2, bySeverity: { critical: 0, warning: 1, info: 1 }, inChange: 3, snoozed: 1 });
    expect(full.body.data.openExceptions).not.toHaveProperty("withheld");
    const site = await api.get("/api/v1/projects/workspace-dashboard", as(members.site_noboq));
    ok("site dashboard", site);
    expect(site.body.data.openExceptions).toMatchObject({ total: 1, bySeverity: { critical: 0, warning: 0, info: 1 }, inChange: 0, snoozed: 1 });
    expect(site.body.data.openExceptions.withheld.modules).toEqual(["boq", "cost"]);
    expect(site.body.data.openExceptions.withheld.reason).toContain(BOQ_REASON);
    const otherOrg = await api.get("/api/v1/projects/workspace-dashboard", as(members.other_pm));
    ok("other org dashboard", otherOrg);
    expect(otherOrg.body.data.openExceptions).toMatchObject({ total: 1, bySeverity: { critical: 1, warning: 0, info: 0 } });
  });

  it("a newly opened critical exception notifies the project's PM and QS once, each only of what they may read; a snoozed one is not notified", async () => {
    const exceptionService = require("../exception.service");
    const boqCritical = await seedException({ kind: "quantity_over_boq", severity: "critical", subjectType: "boq_item", subjectId: ids.boqItem, secondarySubjectType: "activity", secondarySubjectId: ids.activity, measured: 50, limit: 40, unitCode: "m" });
    const moneyCritical = await seedException({ kind: "actual_over_committed", severity: "critical", subjectType: "project", subjectId: project.id, measured: 9, limit: 8 });
    const snoozedCritical = await seedException({ kind: "forecast_over_revised", severity: "critical", subjectType: "budget_line", subjectId: ids.budgetLine, measured: 3, limit: 2, snoozedUntil: new Date(Date.now() + 86_400_000) });
    const first = await exceptionService.notifyOpenedCritical({ orgId: live.org.id, projectId: project.id });
    const second = await exceptionService.notifyOpenedCritical({ orgId: live.org.id, projectId: project.id });
    expect(second.notified).toBe(0);
    const rows = await prisma.notification.findMany({ where: { orgId: live.org.id, entityType: "project_exception" }, select: { entityId: true, recipientUserId: true, category: true, title: true, message: true } });
    const byException = (id) => rows.filter((row) => row.entityId === id).map((row) => row.recipientUserId).sort();
    expect(byException(boqCritical.id)).toEqual([members.pm_member.id, members.qs.id].sort());
    expect(byException(moneyCritical.id)).toEqual([members.pm_member.id, members.qs.id, members.qs_noboq.id].sort());
    expect(byException(snoozedCritical.id)).toEqual([]);
    // In change (qtyAlloc, committed): not notified.
    expect(byException(ex.qtyAlloc.id)).toEqual([]);
    expect(byException(ex.committed.id)).toEqual([]);
    expect(first.notified).toBe(rows.length);
    for (const row of rows) {
      expect(row.category).toBe("commercial");
      expect(`${row.title} ${row.message}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });
});
