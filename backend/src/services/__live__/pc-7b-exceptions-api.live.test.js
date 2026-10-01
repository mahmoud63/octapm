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

  // Everything the handoff must never touch, as stored: the change orders and
  // their links, the budget, the schedule, the bill and its allocations, the
  // commitments, progress (EV reads ActivityProgress only), the IPC, the cost
  // ledger, the budget / EV / health snapshots — and every OTHER exception of
  // the project, whole. `claimed` rows may change by their change event link
  // only (changeEventId, updatedAt); `skipped` rows are the ones a review
  // action is about and are compared by the caller.
  const footprint = async ({ claimed = [], skipped = [] } = {}) => {
    const where = { projectId: project.id };
    const all = (model, extra = where) => prisma[model].findMany({ where: extra, orderBy: { id: "asc" } });
    const tables = {
      changeOrders: all("changeOrder"),
      activityLinks: all("changeOrderActivityLink"),
      allocationLinks: all("changeOrderAllocationLink"),
      budgetLines: all("budgetLine"),
      budgetLineChanges: all("budgetLineChange"),
      budgetRevisions: all("budgetRevision"),
      activities: all("activity"),
      activityProgress: all("activityProgress", { activity: { projectId: project.id } }),
      costRecords: all("costRecord"),
      allocations: all("activityBoqAllocation"),
      boqItems: all("boqItem"),
      primeContracts: all("primeContract"),
      commitments: all("commitment"),
      ipcCertificates: all("ipcCertificate"),
      ipcItems: all("ipcItem"),
      costLedgerEntries: all("costLedgerEntry"),
      budgetSnapshots: all("budgetSnapshot"),
      evSnapshots: all("evPeriodSnapshot"),
      healthSnapshots: all("projectHealthSnapshot"),
      exceptions: all("projectException"),
    };
    const rows = Object.fromEntries(await Promise.all(Object.entries(tables).map(async ([name, query]) => [name, await query])));
    const claimedIds = new Set(claimed.map((row) => (typeof row === "string" ? row : row.id)));
    const skippedIds = new Set(skipped.map((row) => (typeof row === "string" ? row : row.id)));
    rows.exceptions = rows.exceptions
      .filter((row) => !skippedIds.has(row.id))
      .map((row) => (claimedIds.has(row.id) ? { ...row, changeEventId: "(claimed)", updatedAt: "(claimed)" } : row));
    return JSON.stringify(rows);
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

    const member = async (key, role, { noBoq = false, tools = null } = {}) => {
      const user = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${key}`, email: `live-pc7bx-${key.replace(/_/g, "")}-${tag}@octapm-live.test`, role });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: user.id, role, orgId: live.org.id } });
      if (noBoq || tools) {
        const template = await prisma.permissionTemplate.create({ data: { orgId: live.org.id, name: `LiveTest ${key} ${tag}`, baseRole: role, tools: { create: tools || [{ module: "boq", level: "none" }] } } });
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
    // PC-7b integration J: a cost controller who may not read change orders, and a
    // site engineer (no cost read, no BOQ) who may.
    await member("cost_noco", "cost_controller", { tools: [{ module: "change_order", level: "none" }] });
    await member("site_co", "site_engineer", { tools: [{ module: "boq", level: "none" }, { module: "change_order", level: "read_only" }] });
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
    // progress_stale (progress) only: not the allocation / BOQ item kinds, not
    // the mapped-item slip, not structure_missing (the dq rule states it
    // BOQ-derived), not the cost kinds.
    expect(idsOf(answer)).toEqual([ex.stale.id]);
    expect(answer.body.data.withheld.reason).toContain(BOQ_REASON);
    expect(answer.body.data.withheld.modules).toEqual(["boq", "cost", "change_order"]);
    expect(JSON.stringify(answer.body.data.withheld)).not.toMatch(/\d/);
    expect(JSON.stringify(answer.body)).not.toContain("LTSECRET");
    for (const id of [ex.qtyAlloc.id, ex.qtyBoq.id, ex.slip.id, ex.committed.id, ex.structure.id]) {
      refused(`get ${id}`, await api.get(at(`/controls/exceptions/${id}`), as(members.site_noboq)), 404, "EXCEPTION_NOT_FOUND");
    }
    // A filter that would match only withheld rows is an empty page with the marker, not "none".
    const filtered = await list(as(members.site_noboq), `?subject=activity:${ids.activity}&kind=schedule_slip_on_mapped_item`);
    ok("filtered", filtered);
    expect(filtered.body.data.data).toEqual([]);
    expect(filtered.body.data.withheld.modules).toEqual(["boq", "cost", "change_order"]);
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
    expect(idsOf(noBoq)).toEqual([ex.committed, ex.stale, ex.forecast].map((row) => row.id).sort());
    expect(noBoq.body.data.withheld).toEqual({ reason: BOQ_REASON, modules: ["boq"] });
    refused("cost_noboq structure_missing", await api.get(at(`/controls/exceptions/${ex.structure.id}`), as(members.cost_noboq)), 404, "EXCEPTION_NOT_FOUND");
  });

  it("change_order_possible_duplicate and orphan_change_link are read under change_order:read, not cost (PC-7b integration J)", async () => {
    const dup = await seedException({ kind: "change_order_possible_duplicate", severity: "info", subjectType: "change_order", subjectId: crypto.randomUUID(), secondarySubjectType: "change_order", secondarySubjectId: crypto.randomUUID(), measured: 2, limit: 1 });
    const orphan = await seedException({ kind: "orphan_change_link", severity: "warning", subjectType: "budget_revision", subjectId: crypto.randomUUID(), measured: 1, limit: 0 });
    const kinds = "?kind=change_order_possible_duplicate,orphan_change_link";
    try {
      expect(idsOf(await list(pm(), kinds))).toEqual([dup.id, orphan.id].sort());
      expect((await api.get(at(`/controls/exceptions/${dup.id}`), pm())).body.data.module).toBe("change_order");
      // Cost read without change_order read: neither is given; the marker names the module.
      const noCo = await list(as(members.cost_noco), kinds);
      ok("cost_noco", noCo);
      expect(noCo.body.data.data).toEqual([]);
      expect(noCo.body.data.withheld.modules).toEqual(["change_order"]);
      for (const row of [dup, orphan]) refused(`cost_noco get ${row.kind}`, await api.get(at(`/controls/exceptions/${row.id}`), as(members.cost_noco)), 404, "EXCEPTION_NOT_FOUND");
      // change_order read without cost read: both are given (neither is BOQ-derived).
      const co = await list(as(members.site_co), kinds);
      ok("site_co", co);
      expect(idsOf(co)).toEqual([dup.id, orphan.id].sort());
      expect(co.body.data.withheld.modules).toEqual(["boq", "cost"]);
      // The tile: open dup + orphan are counted for the change-order reader, not for the cost controller without it.
      const tileCo = await api.get("/api/v1/projects/workspace-dashboard", as(members.site_co));
      const tileNoCo = await api.get("/api/v1/projects/workspace-dashboard", as(members.cost_noco));
      const tilePm = await api.get("/api/v1/projects/workspace-dashboard", pm());
      // Open on the project now: the seven seeded rows and these two. The PM counts 9; the cost controller
      // without change_order read 7 (every BOQ and money kind, none of these two); the site engineer who reads
      // change orders 3 (progress_stale and these two — the slip and structure_missing are BOQ-derived).
      expect([tilePm.body.data.openExceptions.total, tileNoCo.body.data.openExceptions.total, tileCo.body.data.openExceptions.total]).toEqual([9, 7, 3]);
      expect(tileNoCo.body.data.openExceptions.withheld.modules).toEqual(["change_order"]);
      // The history goes where the exception goes: a dismissal of the orphan link is not in the cost controller's audit.
      ok("pm dismiss orphan", await api.post(at(`/controls/exceptions/${orphan.id}/dismiss`), { reason: "LiveTest J" }, pm()));
      const auditIds = async (headers) => new Set((await api.get(at("/audit?entityType=project_exception&limit=100"), headers)).body.data.events.map((event) => event.entityId || event.recordId));
      expect((await auditIds(pm())).has(orphan.id)).toBe(true);
      expect((await auditIds(as(members.cost_noco))).has(orphan.id)).toBe(false);
    } finally {
      await prisma.auditEvent.deleteMany({ where: { orgId: live.org.id, entityId: { in: [dup.id, orphan.id] } } });
      await prisma.projectException.deleteMany({ where: { id: { in: [dup.id, orphan.id] } } });
    }
  });

  it("GET …/controls/exceptions/summary counts, per severity, the open (and in change) exceptions each caller may read — BOQ-derived withheld with a marker, never counted (PC-7b integration N)", async () => {
    const summary = (headers) => api.get(at("/controls/exceptions/summary"), headers);
    const pmSummary = await summary(pm());
    ok("pm summary", pmSummary);
    // All seven seeded rows are open: critical qtyAlloc + committed, warning qtyBoq + slip + forecast, info stale + structure.
    expect(pmSummary.body.data).toMatchObject({ total: 7, bySeverity: { critical: 2, warning: 3, info: 2 }, open: { total: 7 }, inChange: { total: 0, bySeverity: { critical: 0, warning: 0, info: 0 } } });
    expect(pmSummary.body.data).not.toHaveProperty("withheld");
    // A cost controller without boq:read: committed, forecast and stale only.
    const noBoq = await summary(as(members.cost_noboq));
    ok("cost_noboq summary", noBoq);
    expect(noBoq.body.data).toMatchObject({ total: 3, bySeverity: { critical: 1, warning: 1, info: 1 }, withheld: { reason: BOQ_REASON, modules: ["boq"] } });
    // A site engineer without boq:read: progress_stale only; the marker carries no figure.
    const site = await summary(as(members.site_noboq));
    ok("site summary", site);
    expect(site.body.data).toMatchObject({ total: 1, bySeverity: { critical: 0, warning: 0, info: 1 } });
    expect(site.body.data.withheld.modules).toEqual(["boq", "cost", "change_order"]);
    expect(JSON.stringify(site.body.data.withheld)).not.toMatch(/\d/);
    // Another organisation's member: the project is not theirs.
    expect((await summary(as(members.other_pm))).status).toBe(404);
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

    // The three rows acted on are compared below; every other row and table is byte-identical.
    const reviewScope = { skipped: [ex.committed, ex.structure, ex.forecast] };
    const before = await footprint(reviewScope);
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
    expect(await footprint(reviewScope)).toBe(before);

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
    // The two exceptions raised may change by their change-event link only.
    const claims = { claimed: [ex.qtyAlloc, ex.committed] };

    const before = await footprint(claims);
    const events = await prisma.changeEvent.count({ where: { projectId: project.id } });
    const raised = await api.post(at(`/controls/exceptions/${ex.qtyAlloc.id}/raise-change-event`), { origin: "manual", rfiId: ex.qtyAlloc.id }, pm());
    ok("raise", raised, 201);
    expect(await prisma.changeEvent.count({ where: { projectId: project.id } })).toBe(events + 1);
    expect(await footprint(claims)).toBe(before);

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
    expect(await footprint(claims)).toBe(before);
    ids.raisedEvent = event.id;
  });

  it("the summary counts an exception in change with the open ones, and no longer counts a snoozed or dismissed one", async () => {
    const answer = await api.get(at("/controls/exceptions/summary"), pm());
    ok("summary after raise", answer);
    // In change: qtyAlloc (critical) and committed (critical). Open: qtyBoq, slip (warning), stale (info). Snoozed structure, dismissed forecast: not counted.
    expect(answer.body.data).toMatchObject({ total: 5, bySeverity: { critical: 2, warning: 2, info: 1 }, open: { total: 3, bySeverity: { critical: 0, warning: 2, info: 1 } }, inChange: { total: 2, bySeverity: { critical: 2, warning: 0, info: 0 } } });
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

  it("a line's budget line must be this project's: another project's or organisation's is 400 on every raise and on a plain create, and nothing is written", async () => {
    const foreignCode = await prisma.costCode.create({ data: { orgId: other.org.id, code: `LT7XO-${tag}`, name: "LiveTest other org code" } });
    const foreignLine = await prisma.budgetLine.create({ data: { orgId: other.org.id, projectId: otherProject.id, costCodeId: foreignCode.id, description: "LiveTest other org line" } });
    await prisma.projectCostCode.create({ data: { orgId: live.org.id, projectId: project2.id, costCodeId: ids.costCode } });
    const siblingLine = await prisma.budgetLine.create({ data: { orgId: live.org.id, projectId: project2.id, costCodeId: ids.costCode, description: "LiveTest second project line" } });
    const rfi = await prisma.rfi.create({ data: { projectId: project.id, ref: "RFI-LT7B", subject: "LiveTest budget line probe" } });

    const before = await footprint();
    const events = await prisma.changeEvent.count({ where: { orgId: { in: [live.org.id, other.org.id] } } });
    const lineCount = await prisma.changeEventLine.count({ where: { orgId: { in: [live.org.id, other.org.id] } } });
    for (const [label, budgetLineId] of [["other org", foreignLine.id], ["other project", siblingLine.id]]) {
      const lines = [{ description: "LiveTest line", budgetLineId }];
      refused(`exception ${label}`, await api.post(at(`/controls/exceptions/${ex.stale.id}/raise-change-event`), { lines }, pm()), 400, "CHANGE_EVENT_BUDGET_LINE_INVALID");
      refused(`rfi ${label}`, await api.post(at(`/rfi/${rfi.id}/raise-change-event`), { lines }, pm()), 400, "CHANGE_EVENT_BUDGET_LINE_INVALID");
      refused(`plain ${label}`, await api.post(at("/change-events"), { title: "LiveTest probe", lines }, pm()), 400, "CHANGE_EVENT_BUDGET_LINE_INVALID");
    }
    expect(await prisma.changeEvent.count({ where: { orgId: { in: [live.org.id, other.org.id] } } })).toBe(events);
    expect(await prisma.changeEventLine.count({ where: { orgId: { in: [live.org.id, other.org.id] } } })).toBe(lineCount);
    expect(await prisma.changeEvent.count({ where: { rfiId: rfi.id } })).toBe(0);
    expect(await footprint()).toBe(before);
    // This project's own budget line is taken.
    const own = await api.post(at("/change-events"), { title: "LiveTest own line", lines: [{ description: "LiveTest line", budgetLineId: ids.budgetLine }] }, pm());
    ok("own budget line", own, 201);
    expect(own.body.data.lines[0]).toMatchObject({ budgetLineId: ids.budgetLine });
  });

  it("two raises of one exception at once: exactly one draft change event, the other 409, nothing else written", async () => {
    const race = await seedException({ kind: "actual_over_committed", severity: "warning", subjectType: "commitment", subjectId: crypto.randomUUID(), measured: 7, limit: 6 });
    const scope = { claimed: [race] };
    const before = await footprint(scope);
    const events = await prisma.changeEvent.count({ where: { projectId: project.id } });
    const answers = await Promise.all([1, 2].map(() => api.post(at(`/controls/exceptions/${race.id}/raise-change-event`), {}, pm())));
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    const lost = answers.find((answer) => answer.status === 409);
    expect(lost.body.error.code).toBe("EXCEPTION_IN_CHANGE");
    const won = answers.find((answer) => answer.status === 201);
    expect(await prisma.changeEvent.count({ where: { projectId: project.id } })).toBe(events + 1);
    expect(await prisma.changeEvent.count({ where: { exceptionId: race.id } })).toBe(1);
    expect((await prisma.projectException.findUnique({ where: { id: race.id } })).changeEventId).toBe(won.body.data.changeEvent.id);
    expect(await footprint(scope)).toBe(before);
    ex.race = race;
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
    // Open now: stale (info), slip (warning). In change: qtyAlloc, qtyBoq, committed, race. Snoozed: structure. Dismissed: forecast.
    expect(full.body.data.openExceptions).toMatchObject({ total: 2, bySeverity: { critical: 0, warning: 1, info: 1 }, inChange: 4, snoozed: 1 });
    expect(full.body.data.openExceptions).not.toHaveProperty("withheld");
    const site = await api.get("/api/v1/projects/workspace-dashboard", as(members.site_noboq));
    ok("site dashboard", site);
    // The stale info only; the snoozed structure_missing is BOQ-derived, not counted.
    expect(site.body.data.openExceptions).toMatchObject({ total: 1, bySeverity: { critical: 0, warning: 0, info: 1 }, inChange: 0, snoozed: 0 });
    expect(site.body.data.openExceptions.withheld.modules).toEqual(["boq", "cost", "change_order"]);
    expect(site.body.data.openExceptions.withheld.reason).toContain(BOQ_REASON);
    const otherOrg = await api.get("/api/v1/projects/workspace-dashboard", as(members.other_pm));
    ok("other org dashboard", otherOrg);
    expect(otherOrg.body.data.openExceptions).toMatchObject({ total: 1, bySeverity: { critical: 1, warning: 0, info: 0 } });
  });

  it("the tile's and the notice's per-project access fails closed: a view whose template did not attach is resolved again, and a lookup that fails counts nothing", async () => {
    const exceptionService = require("../exception.service");
    const templates = require("../permission-template.service");
    const { requestForProject } = require("../../middleware/project-access");
    const { resolveRequestPrincipal } = require("../membership.service");
    const { exceptionAccess } = require("../../utils/boq-figures");
    const principal = await resolveRequestPrincipal({ userId: members.cost_noboq.id, orgId: live.org.id });
    const view = await requestForProject({ user: principal }, project.id);
    expect(view.projectAccess.template).toBeTruthy();
    expect(await exceptionService.exceptionAccessForView(view)).toMatchObject({ boq: false, modules: { cost: true } });
    // As requestForProject leaves it when its template lookup fails (swallowed):
    // the role's defaults read the BOQ — the over-count the tile must not make.
    const unattached = { ...view, projectAccess: { ...view.projectAccess, template: undefined, templateSource: undefined } };
    expect(exceptionAccess(unattached).boq).toBe(true);
    expect(await exceptionService.exceptionAccessForView(unattached)).toMatchObject({ boq: false, modules: { cost: true } });
    const spy = jest.spyOn(templates, "resolveTemplateContext").mockRejectedValueOnce(new Error("LiveTest: template lookup failed"));
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await exceptionService.exceptionAccessForView(unattached)).toBeNull();
    } finally {
      spy.mockRestore();
      quiet.mockRestore();
    }
    // A member with no template keeps the role's own access.
    const qsView = await requestForProject({ user: await resolveRequestPrincipal({ userId: members.qs.id, orgId: live.org.id }) }, project.id);
    expect(await exceptionService.exceptionAccessForView(qsView)).toMatchObject({ boq: true, modules: { cost: true } });
    expect(await exceptionService.exceptionAccessForView({ ...qsView, user: null })).toBeNull();
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

  // The bridge: the engine tells its evaluation listeners which rows opened
  // or escalated; registerExceptionNotifier hands them to notifyOpened.
  describe("the engine → notice bridge (registerExceptionNotifier)", () => {
    let project3;
    const exceptionService = () => require("../exception.service");
    const notices = async (projectId) =>
      prisma.notification.findMany({ where: { orgId: live.org.id, projectId, entityType: "project_exception" }, select: { entityId: true, recipientUserId: true } });
    const pairs = (rows) => rows.map((row) => `${row.entityId}:${row.recipientUserId}`).sort();

    beforeAll(async () => {
      project3 = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-7b engine bridge", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") } });
      for (const user of [members.pm_member, members.qs]) {
        await prisma.projectAssignment.create({ data: { projectId: project3.id, userId: user.id, role: user.role, orgId: live.org.id } });
      }
    });

    it("registers one listener, stands down with EXCEPTIONS_ENGINE_ENABLED=false, and passes opened + escalated rows to the notice", async () => {
      const listeners = [];
      const engine = { registerEvaluationListener: (listener) => { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1); } };
      const quiet = { log: () => {} };
      exceptionService().registerExceptionNotifier({ env: { EXCEPTIONS_ENGINE_ENABLED: "false" }, engine, logger: quiet });
      expect(listeners).toHaveLength(0);
      const off = exceptionService().registerExceptionNotifier({ env: { EXCEPTIONS_ENGINE_ENABLED: "true" }, engine, logger: quiet });
      exceptionService().registerExceptionNotifier({ env: { EXCEPTIONS_ENGINE_ENABLED: "true" }, engine, logger: quiet });
      expect(listeners).toHaveLength(1);
      try {
        const opened = await seedException({ projectId: project3.id, kind: "committed_over_budget", severity: "critical", subjectType: "budget_line", subjectId: crypto.randomUUID(), measured: 3, limit: 2 });
        const escalated = await seedException({ projectId: project3.id, kind: "actual_over_committed", severity: "critical", subjectType: "commitment", subjectId: crypto.randomUUID(), measured: 3, limit: 2 });
        const warning = await seedException({ projectId: project3.id, kind: "forecast_over_revised", severity: "warning", subjectType: "project", subjectId: project3.id, measured: 3, limit: 2 });
        // The payload as the engine sends it (rowSummary rows).
        const summary = (row, change) => ({ id: row.id, change, kind: row.kind, severity: row.severity, subjectType: row.subjectType, subjectId: row.subjectId, snoozed: false });
        await listeners[0]({ orgId: live.org.id, projectId: project3.id, trigger: "test", opened: [summary(opened, "open"), summary(warning, "open")], escalated: [summary(escalated, "escalate")] });
        await listeners[0]({ orgId: live.org.id, projectId: project3.id, trigger: "test", opened: [summary(opened, "open")], escalated: [summary(escalated, "escalate")] });
        const told = await notices(project3.id);
        expect(pairs(told)).toEqual(pairs([opened, escalated].flatMap((row) => [members.pm_member, members.qs].map((user) => ({ entityId: row.id, recipientUserId: user.id })))));
      } finally {
        off();
      }
      expect(listeners).toHaveLength(0);
    });

    // With the engine merged: a real evaluation of a LiveTest project (one
    // stub rule, so nothing else of the project is touched) notifies through
    // the bridge — the critical opening once, the warning never until it
    // escalates, then once; an unchanged re-evaluation tells nobody.
    // The engine is on the base (PC-7b merged): this case always runs.
    it("evaluateProject's openings and escalations reach the PM and QS once each", async () => {
      // eslint-disable-next-line global-require
      const engine = require("../exception-engine.service");
      await prisma.notification.deleteMany({ where: { orgId: live.org.id, projectId: project3.id } });
      await prisma.projectException.deleteMany({ where: { orgId: live.org.id, projectId: project3.id } });
      const off = exceptionService().registerExceptionNotifier({ env: { EXCEPTIONS_ENGINE_ENABLED: "true" }, engine, logger: { log: () => {} } });
      const subjects = { critical: crypto.randomUUID(), rising: crypto.randomUUID() };
      let risingSeverity = "warning";
      const rule = {
        kind: "committed_over_budget",
        severity: "warning",
        subjectType: "budget_line",
        module: "cost",
        boqDerived: false,
        evaluate: async () => [
          { subjectType: "budget_line", subjectId: subjects.critical, severity: "critical", measured: { value: 1500, basis: "LiveTest stub: committed" }, limit: { value: 1000, basis: "LiveTest stub: revised budget" } },
          { subjectType: "budget_line", subjectId: subjects.rising, severity: risingSeverity, measured: { value: 1100, basis: "LiveTest stub: committed" }, limit: { value: 1000, basis: "LiveTest stub: revised budget" } },
        ],
      };
      const evaluate = () => engine.evaluateProject({ orgId: live.org.id, projectId: project3.id, trigger: "test", rules: [rule], logger: { log: () => {} } });
      try {
        const first = await evaluate();
        expect(first.opened).toBe(2);
        const rows = await prisma.projectException.findMany({ where: { projectId: project3.id }, select: { id: true, subjectId: true } });
        const idOf = (subjectId) => rows.find((row) => row.subjectId === subjectId).id;
        const expectTold = async (subjectIds) =>
          expect(pairs(await notices(project3.id))).toEqual(pairs(subjectIds.flatMap((subjectId) => [members.pm_member, members.qs].map((user) => ({ entityId: idOf(subjectId), recipientUserId: user.id })))));
        await expectTold([subjects.critical]);
        await evaluate();
        await expectTold([subjects.critical]);
        risingSeverity = "critical";
        await evaluate();
        await expectTold([subjects.critical, subjects.rising]);
        await evaluate();
        await expectTold([subjects.critical, subjects.rising]);
        // Only this LiveTest project's rows were written.
        expect(await prisma.projectException.count({ where: { orgId: live.org.id, projectId: project3.id } })).toBe(2);
      } finally {
        off();
      }
    });
  });
});
