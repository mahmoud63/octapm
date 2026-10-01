/**
 * PC-6 (core) — approval bundling: a quantity-method progress submission
 * bundles quantity entries, and the ONE writer of official progress
 * (progress.service approveProgressSubmissionWithClient) approves them,
 * proven against a real API process and the real local Postgres.
 *
 * In a throwaway "LiveTest <uuid>" organisation: a bill of three rows (two
 * concrete rows in m3, rebar in t), a programme of three activities — the
 * pour (quantity method; two approved allocations, 100 + 60 m3, so planned
 * = Σ = 160), the fixing (quantity method with a typed planned quantity and
 * evidence required), the wall (never configured: measured by the
 * default) and the slab (quantity method, nothing typed, nothing mapped:
 * the pre-PC-6 shape a client plans) — a PM, a site engineer (submit, not
 * approve; assigned to the pour) and a second organisation for the tenant
 * rule.
 *
 * - the submission's figures are DERIVED: installed = Σ bundled + Σ already
 *   approved entries, planned = Σ approved allocations; a client-sent
 *   quantityPlanned and quantityComplete are ignored and the answer says so;
 * - a bundled entry belongs to that submission (not edited under it, not
 *   bundled twice); an entry in another unit is refused; nothing official
 *   exists before approval and a submit-only person cannot approve;
 * - approve: exactly ONE new ActivityProgress row (pct = installed ÷ planned,
 *   the frozen quantities on it), the bundled entries approved with it in the
 *   same transaction, PROGRESS SOURCE provenance on the submission and on
 *   the activity, the EV report's row at that percentage, the audit trail;
 * - a second bundle (by date) writes a second row and leaves the first
 *   byte-identical; reject marks the entries rejected and writes nothing;
 * - two bundles on one activity approved at once are serialised (the
 *   activity row is held): the later official row carries Σ approved
 *   entries, never less than its own source data; the same submission
 *   approved twice at once answers idempotently;
 * - a bundle on an activity with nothing typed and nothing mapped is
 *   planned by the client and approved with that frozen figure (basis
 *   submission), not stuck pending;
 * - the evidence gate still holds a bundle (entries stay pending);
 * - planned from a typed method configuration (basis method_config);
 * - the method lock: 409 PROGRESS_METHOD_LOCKED on an activity with approved
 *   progress, except a row naming the method it is measured by — which is
 *   how setup readiness clears PROGRESS_METHODS_INCOMPLETE;
 * - the tenant 404 on every route.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run test:live -- src/services/__live__/pc-6-quantity-approval.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const progressService = require("../progress.service");

liveDescribe("PC-6: a quantity submission bundles entries and the one writer approves them", () => {
  let live;
  let other;
  let api;
  let project;
  let concreteA;
  let concreteB;
  let rebar;
  let pour;
  let fix;
  let wall;
  let slab;
  let site;
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const refused = (answer, status, code) => expect([answer.status, answer.body?.error?.code]).toEqual([status, code]);

  const activityIds = () => [pour.id, fix.id, wall.id, slab.id];
  const progressRows = async (activityId) =>
    prisma.activityProgress.findMany({ where: { activityId }, orderBy: { updatedAt: "asc" } });
  const entryRow = async (id) => prisma.quantityProgressEntry.findUnique({ where: { id } });
  const evRow = async (activityId) => {
    const answer = await api.get(at("/reports/ev"), bearer(live.token));
    ok(answer);
    // The breakdown names an activity by its code (the twenty largest budgets).
    const code = [pour, fix, wall, slab].find((row) => row.id === activityId).activityCode;
    return answer.body.data.activityBreakdown.find((row) => row.activityId === code);
  };
  const activityPayload = async (activityId, token = live.token) => {
    const answer = await api.get(at(`/activities/${activityId}`), bearer(token));
    ok(answer);
    return answer.body.data;
  };
  const readinessText = async () => {
    const answer = await api.get(at("/setup-readiness"), bearer(live.token));
    ok(answer);
    return JSON.stringify(answer.body.data);
  };
  const entry = async (payload, token = site.token) => {
    const answer = await api.post(at("/quantity-progress"), { status: "submitted", ...payload }, bearer(token));
    ok(answer, 201);
    return answer.body.data.entry;
  };
  const submit = async (activityId, payload, token = live.token) => api.post(at(`/activities/${activityId}/progress`), { method: "quantity", ...payload }, bearer(token));
  const approve = async (activityId, submissionId, token = live.token) => api.post(at(`/activities/${activityId}/progress-submissions/${submissionId}/approve`), {}, bearer(token));
  const reject = async (activityId, submissionId, reason, token = live.token) => api.post(at(`/activities/${activityId}/progress-submissions/${submissionId}/reject`), { reason }, bearer(token));

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DATABASE_CONNECTION_LIMIT: "4" }, { appOnly: true });
    project = await prisma.project.create({
      data: { orgId: live.org.id, currency: "USD", name: "LiveTest PC-6 quantity approval", timezone: "America/Chicago", startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    const tag = live.org.id.slice(0, 8);
    site = await createLiveUser(prisma, { orgId: live.org.id, name: "LiveTest site", email: `live-site-${tag}@octapm-live.test`, role: "site_engineer" });
    site.token = mintAccessToken(site);
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: site.id, role: "site_engineer", orgId: live.org.id } });

    const item = async (payload) => {
      const created = await api.post(at("/boq/items"), payload, bearer(live.token));
      ok(created, 201);
      return created.body.data.item;
    };
    concreteA = await item({ code: "1.1", description: "Concrete in strip footings", quantity: 300, unit: "m3", rate: 100 });
    concreteB = await item({ code: "1.2", description: "Concrete in pad footings", quantity: 120, unit: "Cu.M", rate: 150 });
    rebar = await item({ code: "1.3", description: "Reinforcement", quantity: 50, unit: "t", rate: 1000 });
    expect([concreteA.unitCode, concreteB.unitCode, rebar.unitCode]).toEqual(["m3", "m3", "t"]);

    const activity = async (payload) => {
      const created = await api.post(at("/activities"), payload, bearer(live.token));
      ok(created, 201);
      return created.body.data;
    };
    pour = await activity({ name: "Pour foundations", activityCode: "A100", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06", engineerIds: [live.user.id, site.id] });
    fix = await activity({ name: "Fix reinforcement", activityCode: "A110", duration: 6, startDate: "2026-01-26", endDate: "2026-02-01", engineerIds: [live.user.id] });
    wall = await activity({ name: "Blockwork", activityCode: "A120", duration: 10, startDate: "2026-02-09", endDate: "2026-02-20", engineerIds: [live.user.id] });
    slab = await activity({ name: "Ground slab", activityCode: "A130", duration: 4, startDate: "2026-02-23", endDate: "2026-02-26", engineerIds: [live.user.id] });

    for (const [boqItemId, quantity] of [[concreteA.id, 100], [concreteB.id, 60]]) {
      const created = await api.post(at("/activity-boq-allocations"), { boqItemId, activityId: pour.id, quantity }, bearer(live.token));
      ok(created, 201);
      for (const step of ["submit", "approve"]) ok(await api.post(at(`/activity-boq-allocations/${created.body.data.id}/${step}`), {}, bearer(live.token)));
    }
    // The pour is measured by quantity; nothing typed, so the allocations are the planned figure.
    ok(await api.request("PUT", at(`/activities/${pour.id}/progress-method`), { body: { method: "quantity", quantityUnit: "m3" }, headers: bearer(live.token) }));
    // The fixing: a typed planned quantity, and evidence before anything is approved.
    ok(await api.request("PUT", at(`/activities/${fix.id}/progress-method`), { body: { method: "quantity", plannedQuantity: 50, quantityUnit: "t", evidenceRequired: true }, headers: bearer(live.token) }));
    // The slab: measured by quantity, nothing typed, nothing mapped.
    ok(await api.request("PUT", at(`/activities/${slab.id}/progress-method`), { body: { method: "quantity", quantityUnit: "m3" }, headers: bearer(live.token) }));
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

  const ids = {};
  let firstRowFrozen;

  it("the site engineer records entries; nothing is official and the EV row reads 0", async () => {
    ids.e1 = (await entry({ activityId: pour.id, boqItemId: concreteA.id, quantity: 40, date: "2026-09-01", clientRequestId: "ap-1" })).id;
    ids.e2 = (await entry({ activityId: pour.id, boqItemId: concreteB.id, quantity: 20, unit: "cum", date: "2026-09-02", clientRequestId: "ap-2" })).id;
    ids.e3 = (await entry({ activityId: pour.id, boqItemId: concreteA.id, quantity: 40, date: "2026-09-08", clientRequestId: "ap-3" })).id;
    ids.e4 = (await entry({ activityId: pour.id, boqItemId: concreteA.id, quantity: 30, date: "2026-09-15", clientRequestId: "ap-4" })).id;
    // A draft in another unit (rebar, t) on the pour: named by id below, never taken by a date bundle (drafts are not).
    ids.e6 = (await entry({ activityId: pour.id, boqItemId: rebar.id, quantity: 2, date: "2026-09-03", clientRequestId: "ap-6", status: "draft" }, live.token)).id;
    expect(await prisma.activityProgress.count({ where: { activityId: { in: activityIds() } } })).toBe(0);
    expect(await evRow(pour.id)).toMatchObject({ pct: 0, ev: 0, progressStatus: "missing" });
  });

  it("a submission bundles the entries named: installed and planned are derived, the client's figures are ignored and the answer says so", async () => {
    const answer = await submit(pour.id, { entryIds: [ids.e1, ids.e2], quantityPlanned: 999, quantityComplete: 5, notes: "week 36" }, site.token);
    ok(answer, 200);
    const submission = answer.body.data.submission;
    ids.s1 = submission.id;
    expect(submission).toMatchObject({
      activityId: pour.id,
      method: "quantity",
      status: "submitted",
      pctComplete: 37.5,
      quantityComplete: 60,
      quantityPlanned: 160,
      quantityUnit: "m3",
      submittedBy: site.id,
      quantityEntryIds: expect.arrayContaining([ids.e1, ids.e2]),
      quantity: { installed: 60, planned: 160, unitCode: "m3", plannedBasis: "approved_allocations", installedBasis: "approved_entries", approvedBefore: 0, approvedEntries: 0, bundledEntries: 2, clientQuantityPlannedIgnored: true, pctComplete: 37.5 },
      progressSource: { source: "manual", submissionId: submission.id, dailyLogId: null, importDocumentId: null, submittedBy: site.id, approvedBy: null, approvedAt: null, entries: 2 },
    });
    expect(submission.quantityEntryIds).toHaveLength(2);
    for (const id of [ids.e1, ids.e2]) expect(await entryRow(id)).toMatchObject({ status: "submitted", submissionId: ids.s1, approvedBy: null, approvedAt: null });
    expect(await entryRow(ids.e3)).toMatchObject({ status: "submitted", submissionId: null });
    // Nothing official yet; the activity shows the pending figure and its provenance.
    expect(await prisma.activityProgress.count({ where: { activityId: pour.id } })).toBe(0);
    expect(await evRow(pour.id)).toMatchObject({ pct: 0, progressStatus: "missing" });
    const activity = await activityPayload(pour.id);
    expect([activity.pctComplete, activity.progressApprovalStatus, activity.progressSource]).toEqual([0, "submitted", null]);
    expect(activity.pendingProgress).toMatchObject({ id: ids.s1, quantityEntryIds: expect.arrayContaining([ids.e1, ids.e2]), progressSource: { submittedBy: site.id, entries: 2 } });
  });

  it("a bundled entry is the submission's: not edited under it, not bundled twice; an approved or foreign-unit entry is refused; a submit-only person cannot approve", async () => {
    refused(await api.request("PATCH", at(`/quantity-progress/${ids.e1}`), { body: { quantity: 41 }, headers: bearer(live.token) }), 409, "QUANTITY_ENTRY_BUNDLED");
    refused(await submit(pour.id, { entryIds: [ids.e1] }), 409, "QUANTITY_ENTRY_BUNDLED");
    refused(await submit(pour.id, { entryIds: [ids.e6] }), 400, "QUANTITY_UNIT_MISMATCH");
    refused(await submit(fix.id, { entryIds: [ids.e3], evidence: { notes: "bay 1" } }), 400, "QUANTITY_ENTRY_ACTIVITY_MISMATCH");
    refused(await submit(pour.id, { entryIds: ["00000000-0000-4000-8000-000000000000"] }), 404, "QUANTITY_ENTRY_NOT_FOUND");
    refused(await submit(pour.id, { bundleSubmittedThrough: "2026-08-31" }), 400, "QUANTITY_NO_ENTRIES_TO_BUNDLE");
    refused(await submit(wall.id, { method: "percent", pctComplete: 10, entryIds: [ids.e3] }), 400, "QUANTITY_BUNDLE_METHOD_MISMATCH");
    refused(await approve(pour.id, ids.s1, site.token), 403, "FORBIDDEN");
    expect(await prisma.activityProgress.count({ where: { activityId: { in: activityIds() } } })).toBe(0);
    expect(await prisma.progressSubmission.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("the PM approves: ONE new ActivityProgress row at installed ÷ planned, the entries approved in the same transaction, provenance everywhere, the EV row at that percentage", async () => {
    const answer = await approve(pour.id, ids.s1);
    ok(answer);
    expect(answer.body.data).toMatchObject({
      id: ids.s1,
      status: "approved",
      pctComplete: 37.5,
      quantityComplete: 60,
      quantityPlanned: 160,
      quantityUnit: "m3",
      reviewedBy: live.user.id,
      quantity: { installed: 60, planned: 160, plannedBasis: "approved_allocations", installedBasis: "approved_entries", bundledEntries: 2, approvedBefore: 0 },
      approvedProgressId: expect.any(String),
      progressSource: { source: "manual", submissionId: ids.s1, submittedBy: site.id, approvedBy: live.user.id, approvedAt: expect.any(String), entries: 2 },
    });
    const rows = await progressRows(pour.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ submissionId: ids.s1, pctComplete: 37.5, quantityComplete: 60, quantityPlanned: 160, quantityUnit: "m3", progressMethod: "quantity", source: "manual", status: "approved", approvedBy: live.user.id });
    expect(rows[0].approvedAt).toBeInstanceOf(Date);
    firstRowFrozen = JSON.stringify(rows[0]);
    for (const id of [ids.e1, ids.e2]) {
      const row = await entryRow(id);
      expect(row).toMatchObject({ status: "approved", submissionId: ids.s1, approvedBy: live.user.id });
      expect(row.approvedAt.toISOString()).toBe(rows[0].approvedAt.toISOString());
    }
    expect(await entryRow(ids.e3)).toMatchObject({ status: "submitted", submissionId: null, approvedBy: null });
    // The official figure, with its provenance, on the activity and in the EV report.
    const activity = await activityPayload(pour.id);
    expect([activity.pctComplete, activity.progressApprovalStatus, activity.approvedProgressSource]).toEqual([37.5, "approved", "manual"]);
    expect(activity.progressSource).toEqual({ source: "manual", installedBasis: "approved_entries", legacyFloor: false, submissionId: ids.s1, dailyLogId: null, dailyReportId: null, importDocumentId: null, submittedBy: site.id, submittedAt: expect.any(String), approvedBy: live.user.id, approvedAt: rows[0].approvedAt.toISOString(), entries: 2 });
    const ev = await evRow(pour.id);
    expect(ev).toMatchObject({ pct: 37.5, progressMethod: "quantity", progressStatus: "approved", status: "in_progress" });
    expect(ev.budget).toBe(100 * 100 + 60 * 150);
    expect(ev.ev).toBe(Number((ev.budget * 0.375).toFixed(2)));
    // The entry's own provenance and the audit trail: approved by whom, through which submission.
    const seen = await api.get(at(`/quantity-progress/${ids.e1}`), bearer(live.token));
    ok(seen);
    expect(seen.body.data.provenance).toMatchObject({ source: "manual", recordedBy: site.id, submissionId: ids.s1, official: true, approvedBy: live.user.id });
    const events = await prisma.auditEvent.findMany({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", entityId: ids.e1 }, orderBy: { occurredAt: "asc" } });
    expect(events.map((event) => [event.action, event.oldStatus, event.newStatus, event.actorId])).toEqual([["created", null, "submitted", site.id], ["approved", "submitted", "approved", live.user.id]]);
    const approvedEvent = await prisma.auditEvent.findFirst({ where: { orgId: live.org.id, entityType: "progress_submission", entityId: ids.s1, action: "approved" } });
    expect(approvedEvent.newSummaryJson).toMatchObject({ quantityInstalled: 60, quantityPlanned: 160, plannedBasis: "approved_allocations", quantityEntries: 2, approvedProgressId: rows[0].id });
    // Approving again is idempotent: no second row.
    ok(await approve(pour.id, ids.s1));
    expect(await progressRows(pour.id)).toHaveLength(1);
  });

  it("a second bundle by date takes the free submitted entries up to that day; installed adds the approved ones; the first approved row is byte-identical", async () => {
    const answer = await submit(pour.id, { bundleSubmittedThrough: "2026-09-10" });
    ok(answer, 200);
    const submission = answer.body.data.submission;
    ids.s2 = submission.id;
    expect(submission).toMatchObject({ pctComplete: 62.5, quantityComplete: 100, quantityPlanned: 160, quantityEntryIds: [ids.e3], quantity: { installed: 100, approvedBefore: 60, approvedEntries: 2, bundledEntries: 1 } });
    expect(await entryRow(ids.e4)).toMatchObject({ status: "submitted", submissionId: null });
    ok(await approve(pour.id, ids.s2));
    const rows = await progressRows(pour.id);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows[0])).toBe(firstRowFrozen);
    expect(rows[1]).toMatchObject({ submissionId: ids.s2, pctComplete: 62.5, quantityComplete: 100, quantityPlanned: 160, approvedBy: live.user.id });
    expect(await entryRow(ids.e3)).toMatchObject({ status: "approved", submissionId: ids.s2 });
    expect((await activityPayload(pour.id)).pctComplete).toBe(62.5);
    expect(await evRow(pour.id)).toMatchObject({ pct: 62.5, progressStatus: "approved" });
  });

  it("reject marks the bundled entries rejected with the reason and writes nothing official", async () => {
    const answer = await submit(pour.id, { entryIds: [ids.e4] }, site.token);
    ok(answer, 200);
    ids.s3 = answer.body.data.submission.id;
    expect(answer.body.data.submission).toMatchObject({ quantityComplete: 130, pctComplete: 81.25 });
    const rejected = await reject(pour.id, ids.s3, "Bay 4 was measured twice");
    ok(rejected);
    expect(rejected.body.data).toMatchObject({ status: "rejected", rejectionReason: "Bay 4 was measured twice", quantityEntryIds: [ids.e4] });
    expect(await entryRow(ids.e4)).toMatchObject({ status: "rejected", submissionId: ids.s3, rejectedBy: live.user.id, rejectionReason: "Bay 4 was measured twice", approvedBy: null });
    expect(await progressRows(pour.id)).toHaveLength(2);
    expect((await activityPayload(pour.id)).pctComplete).toBe(62.5);
    refused(await submit(pour.id, { entryIds: [ids.e4] }), 409, "QUANTITY_ENTRY_LOCKED");
    const events = await prisma.auditEvent.findMany({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", entityId: ids.e4 }, orderBy: { occurredAt: "asc" } });
    expect(events.map((event) => [event.action, event.newStatus, event.reason])).toEqual([["created", "submitted", null], ["rejected", "rejected", "Bay 4 was measured twice"]]);
  });

  it("two bundles on one activity approved at once are serialised: the later official row carries Σ approved entries, and the same submission approved twice at once is idempotent", async () => {
    ids.e8 = (await entry({ activityId: pour.id, boqItemId: concreteA.id, quantity: 10, date: "2026-09-16", clientRequestId: "ap-8" })).id;
    ids.e9 = (await entry({ activityId: pour.id, boqItemId: concreteA.id, quantity: 20, date: "2026-09-17", clientRequestId: "ap-9" })).id;
    const first = await submit(pour.id, { entryIds: [ids.e8] }, site.token);
    ok(first, 200);
    ids.s5 = first.body.data.submission.id;
    const second = await submit(pour.id, { entryIds: [ids.e9] }, site.token);
    ok(second, 200);
    ids.s6 = second.body.data.submission.id;
    // Each was put forward against the 100 m3 approved so far: 110 and 120.
    expect([first.body.data.submission.quantityComplete, second.body.data.submission.quantityComplete]).toEqual([110, 120]);
    expect(await progressRows(pour.id)).toHaveLength(2);

    const [a, b] = await Promise.all([approve(pour.id, ids.s5), approve(pour.id, ids.s6)]);
    ok(a);
    ok(b);
    const rows = await progressRows(pour.id);
    expect(rows).toHaveLength(4);
    expect(JSON.stringify(rows[0])).toBe(firstRowFrozen);
    // Whichever committed first read 100 + its own entry; the second read what the first wrote: 100 + 10 + 20.
    const installed = rows.slice(2).map((row) => row.quantityComplete).sort((x, y) => x - y);
    expect(installed[1]).toBe(130);
    expect([110, 120]).toContain(installed[0]);
    const latest = rows.slice(2).sort((x, y) => y.approvedAt - x.approvedAt)[0];
    expect(latest).toMatchObject({ quantityComplete: 130, quantityPlanned: 160, pctComplete: 81.25 });
    expect([a.body.data.quantityComplete, b.body.data.quantityComplete].sort((x, y) => x - y)).toEqual(installed);
    for (const id of [ids.e8, ids.e9]) expect(await entryRow(id)).toMatchObject({ status: "approved", approvedBy: live.user.id });
    // The official figure agrees with its own source data: Σ approved entries on the pour is 130 of 160.
    const approvedSum = (await prisma.quantityProgressEntry.findMany({ where: { activityId: pour.id, status: "approved" } })).reduce((sum, row) => sum + Number(row.quantity), 0);
    expect(approvedSum).toBe(130);
    expect((await activityPayload(pour.id)).pctComplete).toBe(81.25);
    expect(await evRow(pour.id)).toMatchObject({ pct: 81.25, progressStatus: "approved" });

    // The same submission approved twice at once: both answer, one row was added, none more.
    const [c, d] = await Promise.all([approve(pour.id, ids.s5), approve(pour.id, ids.s5)]);
    ok(c);
    ok(d);
    expect(await progressRows(pour.id)).toHaveLength(4);
    expect(JSON.stringify(await progressRows(pour.id))).toBe(JSON.stringify(rows));
  });

  it("planned from a typed method configuration (basis method_config); the evidence gate still holds the bundle and its entries", async () => {
    ids.e5 = (await entry({ activityId: fix.id, boqItemId: rebar.id, quantity: 10, date: "2026-09-04", clientRequestId: "ap-5" }, live.token)).id;
    refused(await submit(fix.id, { entryIds: [ids.e5] }), 400, "PROGRESS_EVIDENCE_REQUIRED");
    expect(await entryRow(ids.e5)).toMatchObject({ status: "submitted", submissionId: null });
    const draft = await submit(fix.id, { entryIds: [ids.e5], status: "draft", quantityPlanned: 75 });
    ok(draft, 200);
    ids.s4 = draft.body.data.submission.id;
    expect(draft.body.data.submission).toMatchObject({ status: "draft", pctComplete: 20, quantityComplete: 10, quantityPlanned: 50, quantityUnit: "t", quantity: { plannedBasis: "method_config", clientQuantityPlannedIgnored: true } });
    // A draft keeps its entries as they were, held by it.
    expect(await entryRow(ids.e5)).toMatchObject({ status: "submitted", submissionId: ids.s4 });
    refused(await approve(fix.id, ids.s4), 400, "PROGRESS_EVIDENCE_REQUIRED");
    expect(await entryRow(ids.e5)).toMatchObject({ status: "submitted", submissionId: ids.s4, approvedBy: null });
    expect(await prisma.activityProgress.count({ where: { activityId: fix.id } })).toBe(0);
    expect(await evRow(fix.id)).toMatchObject({ pct: 0, progressStatus: "missing" });
  });

  it("a bundle on an activity with nothing typed and nothing mapped is planned by the client and APPROVED with that frozen figure (basis submission)", async () => {
    const recorded = await api.post(at("/quantity-progress"), { status: "submitted", activityId: slab.id, boqItemId: concreteA.id, quantity: 5, date: "2026-09-05", clientRequestId: "ap-7" }, bearer(live.token));
    ok(recorded, 201);
    ids.e7 = recorded.body.data.entry.id;
    expect(recorded.body.data.warnings.map((warning) => warning.code)).toContain("QUANTITY_NO_APPROVED_ALLOCATION");
    // Without a planned figure from anywhere the bundle is refused as before, and the entry stays free.
    refused(await submit(slab.id, { entryIds: [ids.e7] }), 400, "PLANNED_QUANTITY_REQUIRED");
    expect(await entryRow(ids.e7)).toMatchObject({ status: "submitted", submissionId: null });
    const answer = await submit(slab.id, { entryIds: [ids.e7], quantityPlanned: 20 });
    ok(answer, 200);
    ids.s7 = answer.body.data.submission.id;
    expect(answer.body.data.submission).toMatchObject({ pctComplete: 25, quantityComplete: 5, quantityPlanned: 20, quantityUnit: "m3", quantity: { plannedBasis: "client", installedBasis: "approved_entries", bundledEntries: 1, clientQuantityPlannedIgnored: false } });
    expect(await entryRow(ids.e7)).toMatchObject({ status: "submitted", submissionId: ids.s7 });
    // The approval cannot derive a planned figure from the mapping; the one the submission was put forward with stands.
    const approved = await approve(slab.id, ids.s7);
    ok(approved);
    expect(approved.body.data).toMatchObject({ status: "approved", pctComplete: 25, quantityComplete: 5, quantityPlanned: 20, quantityUnit: "m3", quantity: { installed: 5, planned: 20, plannedBasis: "submission", installedBasis: "approved_entries", bundledEntries: 1 }, approvedProgressId: expect.any(String) });
    const rows = await progressRows(slab.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ submissionId: ids.s7, pctComplete: 25, quantityComplete: 5, quantityPlanned: 20, quantityUnit: "m3", progressMethod: "quantity", status: "approved", approvedBy: live.user.id });
    expect(await entryRow(ids.e7)).toMatchObject({ status: "approved", submissionId: ids.s7, approvedBy: live.user.id });
    expect((await activityPayload(slab.id)).pctComplete).toBe(25);
    expect(await evRow(slab.id)).toMatchObject({ pct: 25, progressMethod: "quantity", progressStatus: "approved" });
  });

  it("the method lock: an activity with approved progress keeps its method; a row naming that method is written, and clears PROGRESS_METHODS_INCOMPLETE", async () => {
    const put = (activityId, body) => api.request("PUT", at(`/activities/${activityId}/progress-method`), { body, headers: bearer(live.token) });
    const locked = await put(pour.id, { method: "percent" });
    refused(locked, 409, "PROGRESS_METHOD_LOCKED");
    expect(locked.body.error.details).toMatchObject({ activityId: pour.id, effectiveMethod: "quantity", effectiveMethodBasis: "method_config", requestedMethod: "percent", approvedProgressCount: 4 });
    refused(await put(pour.id, { method: "weighted_milestone", milestoneWeights: [{ id: "a", weight: 100 }] }), 409, "PROGRESS_METHOD_LOCKED");
    const same = await put(pour.id, { method: "quantity", quantityUnit: "m3", plannedQuantity: 200 });
    ok(same);
    expect(same.body.data).toMatchObject({ method: "quantity", plannedQuantity: 200 });
    // The wall is measured under the default: a percent submission approved, no method row.
    const pct = await submit(wall.id, { method: "percent", pctComplete: 40 });
    ok(pct, 200);
    ok(await approve(wall.id, pct.body.data.submission.id));
    expect(await prisma.activityProgressMethod.findFirst({ where: { activityId: wall.id } })).toBeNull();
    expect(await readinessText()).toContain("PROGRESS_METHODS_INCOMPLETE");
    const other = await put(wall.id, { method: "quantity", quantityUnit: "m2", plannedQuantity: 10 });
    refused(other, 409, "PROGRESS_METHOD_LOCKED");
    expect(other.body.error.details).toMatchObject({ effectiveMethod: "percent", effectiveMethodBasis: "approved_progress", approvedProgressCount: 1 });
    ok(await put(wall.id, { method: "percent", evidenceRequired: false }));
    expect(await prisma.activityProgressMethod.findFirst({ where: { activityId: wall.id } })).toMatchObject({ method: "percent" });
    expect(await readinessText()).not.toContain("PROGRESS_METHODS_INCOMPLETE");
    // The lock changed nothing official.
    expect(await progressRows(pour.id)).toHaveLength(4);
    expect(JSON.stringify((await progressRows(pour.id))[0])).toBe(firstRowFrozen);
  });

  it("a member of another organisation gets the tenant 404 on every route and writes nothing", async () => {
    const token = other.token;
    const before = JSON.stringify(await prisma.progressSubmission.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }));
    refused(await submit(pour.id, { entryIds: [ids.e4] }, token), 404, "PROJECT_NOT_FOUND");
    refused(await approve(fix.id, ids.s4, token), 404, "PROJECT_NOT_FOUND");
    refused(await reject(fix.id, ids.s4, "no", token), 404, "PROJECT_NOT_FOUND");
    refused(await api.request("PUT", at(`/activities/${wall.id}/progress-method`), { body: { method: "quantity" }, headers: bearer(token) }), 404, "PROJECT_NOT_FOUND");
    expect(JSON.stringify(await prisma.progressSubmission.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }))).toBe(before);
    expect(await prisma.activityProgress.count({ where: { activityId: { in: activityIds() } } })).toBe(6);
    // The writer's own tenant scope, below the route: the other organisation's id finds no project.
    const foreign = { orgId: other.org.id, projectId: project.id, activityId: fix.id, submissionId: ids.s4, userId: other.user.id };
    await expect(progressService.approveProgressSubmission(foreign)).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
    await expect(progressService.rejectProgressSubmission({ ...foreign, reason: "no" })).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
    await expect(progressService.createProgressSubmission({ ...foreign, activityId: pour.id, userRole: "pm", payload: { method: "quantity", entryIds: [ids.e4] } })).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
    expect(await entryRow(ids.e5)).toMatchObject({ status: "submitted", submissionId: ids.s4 });
    expect(await prisma.activityProgress.count({ where: { activityId: { in: activityIds() } } })).toBe(6);
  });
});
