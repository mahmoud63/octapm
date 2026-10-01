/**
 * PC-6 (integration) — the submission's method is the ACTIVITY'S, never the
 * client's, proven against a real API process and the real local Postgres.
 *
 * The review finding: the client picked the submission's method, so on a
 * quantity-configured activity a submitter could send { method: 'percent',
 * pctComplete: 90 } and bypass the whole PC-6 derivation — the approver then
 * approved a 90% row with zero entries behind it.
 *
 * In a throwaway "LiveTest <uuid>" organisation: a bill of one row, a
 * programme of two activities — the pour (configured quantity; one approved
 * allocation of 100 m3) and the wall (never configured: measured by the
 * default) — a PM and a site engineer assigned to both.
 *
 * - a percent (or milestone) submission on the pour is 409
 *   PROGRESS_METHOD_MISMATCH naming both methods, on POST
 *   /activities/{id}/progress, on bulk-progress and on the daily report's
 *   legacy path; nothing is written and the EV report is byte-identical;
 * - a submission naming no method takes the activity's (quantity, derived
 *   from its entries); one naming the configured method is accepted;
 * - the wall, with no configured method, accepts the client's method as
 *   before.
 *
 * The legacy typed-quantity floor (integration item 2; finding: "on an
 * activity approved the legacy way — typed quantityComplete, no entries —
 * the FIRST bundle approved after PC-6 derives installed = Σ approved
 * entries + bundle and discards the previously official installed quantity:
 * official progress regresses 60% → 10%"):
 * - the slab stands at a seeded pre-PC-6 row (60 of 100, no entries): a
 *   bundle of 10 derives 70 (basis legacy_typed_floor, the floor named), the
 *   official row says so in its note and PROGRESS SOURCE, the legacy row is
 *   byte-identical, the next bundle still carries it (75);
 * - the kerb (one allocated item): a typed quantityComplete — the mobile
 *   ProgressSheet's shape — is accepted while no entry exists and its
 *   approval mints ONE approved entry (source 'submission', the typed figure
 *   as a delta over the official floor), so the activity has one truth from
 *   then on; a typed figure once entries exist is 409
 *   QUANTITY_ENTRIES_REQUIRED;
 * - the second slab: a typed figure below the official one mints nothing
 *   (the approved row stands as approved) and is the floor of the next
 *   bundle.
 *
 * The rule holds in the one writer too (verification finding: "the method
 * bypass still works by ordering — a percent submission put forward while
 * the activity is unconfigured stays approvable after the planner
 * configures it as quantity; the approver approves a 90% row with zero
 * entries, and the first bundle afterwards regresses it 90% → 10%"):
 * - the late pour: a percent submission is pending, the planner configures
 *   quantity (allowed: nothing is approved yet), and the approval is 409
 *   PROGRESS_METHOD_MISMATCH naming both methods and the submission; nothing
 *   official, EV byte-identical; rejected, the site records entries and the
 *   only official row is the derived one.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run test:live -- src/services/__live__/pc-6-method-authority.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("PC-6: the submission's method is the activity's effective method", () => {
  let live;
  let api;
  let project;
  let concrete;
  let pour;
  let wall;
  let slab;
  let slab2;
  let kerb;
  let late;
  let site;
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);
  const refused = (answer, status, code) => expect([answer.status, answer.body?.error?.code]).toEqual([status, code]);

  const submit = async (activityId, payload, token = live.token) => api.post(at(`/activities/${activityId}/progress`), payload, bearer(token));
  const approve = async (activityId, submissionId, token = live.token) => api.post(at(`/activities/${activityId}/progress-submissions/${submissionId}/approve`), {}, bearer(token));
  const entry = async (payload, token = site.token) => {
    const answer = await api.post(at("/quantity-progress"), { status: "submitted", ...payload }, bearer(token));
    ok(answer, 201);
    return answer.body.data.entry;
  };
  const progressRows = async (activityId) => prisma.activityProgress.findMany({ where: { activityId }, orderBy: { updatedAt: "asc" } });
  const evReport = async () => {
    const answer = await api.get(at("/reports/ev"), bearer(live.token));
    ok(answer);
    const { reporting, ...rest } = answer.body.data;
    return JSON.stringify(rest);
  };
  const footprint = async () =>
    JSON.stringify({
      submissions: await prisma.progressSubmission.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
      progress: await prisma.activityProgress.findMany({ where: { activity: { projectId: project.id } }, orderBy: { updatedAt: "asc" } }),
      reports: await prisma.dailyReport.count({ where: { projectId: project.id } }),
      entries: await prisma.quantityProgressEntry.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
    });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DATABASE_CONNECTION_LIMIT: "4" }, { appOnly: true });
    project = await prisma.project.create({
      data: { orgId: live.org.id, currency: "USD", name: "LiveTest PC-6 method authority", timezone: "America/Chicago", startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    const tag = live.org.id.slice(0, 8);
    site = await createLiveUser(prisma, { orgId: live.org.id, name: "LiveTest site", email: `live-site-ma-${tag}@octapm-live.test`, role: "site_engineer" });
    site.token = mintAccessToken(site);
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: site.id, role: "site_engineer", orgId: live.org.id } });

    const item = await api.post(at("/boq/items"), { code: "1.1", description: "Concrete in strip footings", quantity: 500, unit: "m3", rate: 100 }, bearer(live.token));
    ok(item, 201);
    concrete = item.body.data.item;
    const activity = async (payload) => {
      const created = await api.post(at("/activities"), payload, bearer(live.token));
      ok(created, 201);
      return created.body.data;
    };
    pour = await activity({ name: "Pour foundations", activityCode: "A100", duration: 5, startDate: "2026-02-02", endDate: "2026-02-06", engineerIds: [live.user.id, site.id] });
    wall = await activity({ name: "Blockwork", activityCode: "A120", duration: 10, startDate: "2026-02-09", endDate: "2026-02-20", engineerIds: [live.user.id, site.id] });
    slab = await activity({ name: "Ground slab (legacy)", activityCode: "A130", duration: 4, startDate: "2026-02-23", endDate: "2026-02-26", engineerIds: [live.user.id, site.id] });
    slab2 = await activity({ name: "Roof slab (legacy, typed below)", activityCode: "A140", duration: 4, startDate: "2026-03-02", endDate: "2026-03-05", engineerIds: [live.user.id, site.id] });
    kerb = await activity({ name: "Kerbs (typed)", activityCode: "A150", duration: 2, startDate: "2026-03-09", endDate: "2026-03-10", engineerIds: [live.user.id, site.id] });
    late = await activity({ name: "Late pour (configured after a percent submission)", activityCode: "A160", duration: 3, startDate: "2026-03-16", endDate: "2026-03-18", engineerIds: [live.user.id, site.id] });
    for (const [row, quantity, configured = true] of [[pour, 100], [slab, 100], [slab2, 100], [kerb, 50], [late, 100, false]]) {
      const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: concrete.id, activityId: row.id, quantity }, bearer(live.token));
      ok(allocation, 201);
      for (const step of ["submit", "approve"]) ok(await api.post(at(`/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, bearer(live.token)));
      if (configured) ok(await api.request("PUT", at(`/activities/${row.id}/progress-method`), { body: { method: "quantity", quantityUnit: "m3" }, headers: bearer(live.token) }));
    }
    // The pre-PC-6 state, exactly as the database holds it: an approved row
    // typed the legacy way — a quantityComplete, no submission, no entry.
    for (const row of [slab, slab2]) {
      await prisma.activityProgress.create({
        data: { activityId: row.id, pctComplete: 60, progressMethod: "quantity", source: "mobile", quantityComplete: 60, quantityPlanned: 100, quantityUnit: "m3", status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-08-01T12:00:00.000Z") },
      });
    }
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["backgroundJob", "outboundEvent", "recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  const ids = {};

  it("a percent submission on a quantity-configured activity is 409 PROGRESS_METHOD_MISMATCH on every path; nothing is written and EV is byte-identical", async () => {
    const evBefore = await evReport();
    const before = await footprint();
    const direct = await submit(pour.id, { method: "percent", pctComplete: 90 }, site.token);
    refused(direct, 409, "PROGRESS_METHOD_MISMATCH");
    expect(direct.body.error.details).toEqual({ activityId: pour.id, effectiveMethod: "quantity", effectiveMethodBasis: "method_config", requestedMethod: "percent" });
    expect(direct.body.error.message).toMatch(/measured by quantity; a percent submission is not recorded against it/);
    refused(await submit(pour.id, { progressMethod: "percent", pctComplete: 90 }), 409, "PROGRESS_METHOD_MISMATCH");
    refused(await submit(pour.id, { method: "weighted_milestone", milestones: [{ id: "a", weight: 100, complete: true }] }), 409, "PROGRESS_METHOD_MISMATCH");
    refused(await submit(pour.id, { method: "manual", pctComplete: 50, notes: "typed" }), 409, "PROGRESS_METHOD_MISMATCH");
    // bulk-progress: the same writer, the same answer.
    refused(await api.post(at("/activities/bulk-progress"), { updates: [{ activityId: pour.id, method: "percent", pctComplete: 90 }] }, bearer(site.token)), 409, "PROGRESS_METHOD_MISMATCH");
    // The daily report's legacy path names percent for its pctProgress: refused on the pour, the report not kept either.
    const report = await api.post(at("/daily-reports"), { activityId: pour.id, date: "2026-02-03", pctProgress: 90, notes: "LiveTest" }, bearer(site.token));
    refused(report, 409, "PROGRESS_METHOD_MISMATCH");
    expect(await footprint()).toBe(before);
    expect(await evReport()).toBe(evBefore);
    expect(await prisma.progressSubmission.count({ where: { projectId: project.id } })).toBe(0);
    expect(await progressRows(pour.id)).toHaveLength(0);
  });

  it("a submission naming no method takes the activity's (quantity, derived from its entries); naming the configured method is accepted", async () => {
    ids.e1 = (await entry({ activityId: pour.id, boqItemId: concrete.id, quantity: 25, date: "2026-02-03", clientRequestId: "ma-1" })).id;
    const unnamed = await submit(pour.id, { entryIds: [ids.e1], pctComplete: 90 }, site.token);
    ok(unnamed, 200);
    expect(unnamed.body.data.submission).toMatchObject({ method: "quantity", pctComplete: 25, quantityComplete: 25, quantityPlanned: 100, quantity: { plannedBasis: "approved_allocations", installedBasis: "approved_entries" } });
    ids.s1 = unnamed.body.data.submission.id;
    ok(await approve(pour.id, ids.s1));
    expect(await progressRows(pour.id)).toHaveLength(1);
    expect((await progressRows(pour.id))[0]).toMatchObject({ progressMethod: "quantity", pctComplete: 25, quantityComplete: 25 });
    ids.e2 = (await entry({ activityId: pour.id, boqItemId: concrete.id, quantity: 15, date: "2026-02-04", clientRequestId: "ma-2" })).id;
    const named = await submit(pour.id, { method: "quantity", entryIds: [ids.e2] }, site.token);
    ok(named, 200);
    expect(named.body.data.submission).toMatchObject({ method: "quantity", pctComplete: 40, quantityComplete: 40 });
    // Still refused after official progress exists: the configured method, not the client's.
    refused(await submit(pour.id, { method: "percent", pctComplete: 90 }), 409, "PROGRESS_METHOD_MISMATCH");
    expect(await progressRows(pour.id)).toHaveLength(1);
  });

  it("an activity with no configured method accepts the client's method as before", async () => {
    expect(await prisma.activityProgressMethod.findFirst({ where: { activityId: wall.id } })).toBeNull();
    const pct = await submit(wall.id, { method: "percent", pctComplete: 40 }, site.token);
    ok(pct, 200);
    expect(pct.body.data.submission).toMatchObject({ method: "percent", pctComplete: 40 });
    const manual = await submit(wall.id, { method: "manual", pctComplete: 45, notes: "typed with reason" }, site.token);
    ok(manual, 200);
    expect(manual.body.data.submission).toMatchObject({ method: "manual", pctComplete: 45 });
    const bulk = await api.post(at("/activities/bulk-progress"), { updates: [{ activityId: wall.id, pctComplete: 50 }] }, bearer(site.token));
    ok(bulk, 200);
    expect(bulk.body.data.submissions[0]).toMatchObject({ method: "percent", pctComplete: 50 });
    // The legacy daily report on the wall: a percent submission linked to it, as before.
    const report = await api.post(at("/daily-reports"), { activityId: wall.id, date: "2026-02-10", pctProgress: 55, notes: "LiveTest" }, bearer(site.token));
    ok(report, 201);
    expect(await prisma.progressSubmission.findFirst({ where: { dailyReportId: report.body.data.id } })).toMatchObject({ method: "percent", pctComplete: 55, source: "daily_report" });
  });

  const activityPayload = async (activityId) => {
    const answer = await api.get(at(`/activities/${activityId}`), bearer(live.token));
    ok(answer);
    return answer.body.data;
  };
  const evRow = async (row) => {
    const answer = await api.get(at("/reports/ev"), bearer(live.token));
    ok(answer);
    return answer.body.data.activityBreakdown.find((line) => line.activityId === row.activityCode);
  };

  it("the legacy floor: the first bundle after PC-6 on an activity approved the legacy way derives from the official figure, never 60% → 10%; the row and PROGRESS SOURCE say so; the next bundle still carries it", async () => {
    const legacy = await prisma.activityProgress.findFirst({ where: { activityId: slab.id } });
    const legacyFrozen = JSON.stringify(legacy);
    expect((await activityPayload(slab.id)).pctComplete).toBe(60);
    expect(await evRow(slab)).toMatchObject({ pct: 60, progressStatus: "approved" });
    ids.f1 = (await entry({ activityId: slab.id, boqItemId: concrete.id, quantity: 10, date: "2026-10-01", clientRequestId: "ma-f1" })).id;
    const bundle = await submit(slab.id, { entryIds: [ids.f1] }, site.token);
    ok(bundle, 200);
    expect(bundle.body.data.submission).toMatchObject({
      pctComplete: 70,
      quantityComplete: 70,
      quantityPlanned: 100,
      quantity: { installed: 70, approvedBefore: 0, bundledEntries: 1, installedBasis: "legacy_typed_floor", legacyFloor: { quantity: 60, unitCode: "m3", progressId: legacy.id, approvedAt: legacy.approvedAt.toISOString(), note: expect.stringMatching(/carried as the floor/) } },
    });
    const approved = await approve(slab.id, bundle.body.data.submission.id);
    ok(approved);
    expect(approved.body.data).toMatchObject({ status: "approved", pctComplete: 70, quantityComplete: 70, quantity: { installed: 70, installedBasis: "legacy_typed_floor", legacyFloor: { quantity: 60, progressId: legacy.id } }, progressSource: { installedBasis: "legacy_typed_floor", legacyFloor: true, entries: 1 } });
    const rows = await progressRows(slab.id);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows[0])).toBe(legacyFrozen);
    expect(rows[1]).toMatchObject({ pctComplete: 70, quantityComplete: 70, quantityPlanned: 100, quantityUnit: "m3", progressMethod: "quantity", status: "approved" });
    // The note carries the floor's trace and no figure.
    expect(rows[1].notes).toBe("Legacy typed quantity carried as the floor of the installed figure (PC-6)");
    expect(rows[1].notes).not.toMatch(/\b(60|70|100)\b/);
    const payload = await activityPayload(slab.id);
    expect(payload.pctComplete).toBe(70);
    expect(payload.progressSource).toMatchObject({ installedBasis: "legacy_typed_floor", legacyFloor: true, submissionId: bundle.body.data.submission.id, entries: 1 });
    expect(await evRow(slab)).toMatchObject({ pct: 70, progressStatus: "approved" });
    const event = await prisma.auditEvent.findFirst({ where: { orgId: live.org.id, entityType: "progress_submission", entityId: bundle.body.data.submission.id, action: "approved" } });
    expect(event.newSummaryJson).toMatchObject({ quantityInstalled: 70, installedBasis: "legacy_typed_floor", legacyFloor: { quantity: 60, progressId: legacy.id } });
    // The next bundle: Σ approved entries is 10, the official figure 70 — the floor persists: 75.
    ids.f2 = (await entry({ activityId: slab.id, boqItemId: concrete.id, quantity: 5, date: "2026-10-02", clientRequestId: "ma-f2" })).id;
    const next = await submit(slab.id, { entryIds: [ids.f2] }, site.token);
    ok(next, 200);
    expect(next.body.data.submission).toMatchObject({ pctComplete: 75, quantityComplete: 75, quantity: { approvedBefore: 10, installedBasis: "legacy_typed_floor", legacyFloor: { quantity: 70, progressId: rows[1].id } } });
    ok(await approve(slab.id, next.body.data.submission.id));
    expect((await activityPayload(slab.id)).pctComplete).toBe(75);
    expect(JSON.stringify((await progressRows(slab.id))[0])).toBe(legacyFrozen);
    // A typed figure now that entries exist: refused, the entries are the truth.
    refused(await submit(slab.id, { quantityComplete: 80 }, site.token), 409, "QUANTITY_ENTRIES_REQUIRED");
  });

  it("a typed quantityComplete (the mobile shape) is still accepted while the activity has no entry; its approval mints ONE approved entry so there is one truth from then on; a typed figure once entries exist is 409 QUANTITY_ENTRIES_REQUIRED", async () => {
    expect(await prisma.quantityProgressEntry.count({ where: { activityId: kerb.id } })).toBe(0);
    const typed = await submit(kerb.id, { method: "quantity", quantityComplete: 20, source: "mobile" }, site.token);
    ok(typed, 200);
    expect(typed.body.data.submission).toMatchObject({ pctComplete: 40, quantityComplete: 20, quantityPlanned: 50, quantityUnit: "m3", quantity: { installedBasis: "client", plannedBasis: "approved_allocations" }, progressSource: { installedBasis: "client", entries: 0 } });
    const approved = await approve(kerb.id, typed.body.data.submission.id);
    ok(approved);
    expect(approved.body.data).toMatchObject({
      status: "approved",
      pctComplete: 40,
      quantityComplete: 20,
      quantity: { installed: 20, installedBasis: "client", mintedEntry: { boqItemId: concrete.id, quantity: 20, unitCode: "m3", officialBefore: 0 }, mintSkipped: null },
      progressSource: { installedBasis: "client", legacyFloor: false, entries: 1 },
    });
    const mintedId = approved.body.data.quantity.mintedEntry.id;
    expect(approved.body.data.quantityEntryIds).toEqual([mintedId]);
    const minted = await prisma.quantityProgressEntry.findUnique({ where: { id: mintedId } });
    expect(minted).toMatchObject({ activityId: kerb.id, boqItemId: concrete.id, unitCode: "m3", source: "submission", status: "approved", submissionId: typed.body.data.submission.id, approvedBy: live.user.id, createdBy: site.id, clientRequestId: `submission:${typed.body.data.submission.id}` });
    expect(Number(minted.quantity)).toBe(20);
    expect(minted.approvedAt.toISOString()).toBe((await progressRows(kerb.id))[0].approvedAt.toISOString());
    expect(await prisma.quantityProgressEntry.count({ where: { activityId: kerb.id } })).toBe(1);
    // The entry is in the ledger with its provenance, and the activity's installed quantity reads it.
    const seen = await api.get(at(`/quantity-progress/${mintedId}`), bearer(live.token));
    ok(seen);
    expect(seen.body.data).toMatchObject({ source: "submission", status: "approved", quantity: 20, provenance: { source: "submission", recordedBy: site.id, submissionId: typed.body.data.submission.id, official: true, approvedBy: live.user.id } });
    const quantities = await api.get(at(`/activities/${kerb.id}/quantities`), bearer(live.token));
    ok(quantities);
    expect(quantities.body.data.figures.installed).toMatchObject({ value: 20, unitCode: "m3" });
    expect(await evRow(kerb)).toMatchObject({ pct: 40, progressStatus: "approved" });
    const trail = await prisma.auditEvent.findMany({ where: { orgId: live.org.id, entityType: "quantity_progress_entry", entityId: mintedId } });
    expect(trail.map((event) => [event.action, event.newStatus, event.summaryJson?.transition])).toEqual([["created", "approved", "quantity_entry.mint_from_typed_submission"]]);
    // Approving again mints nothing more (idempotent).
    ok(await approve(kerb.id, typed.body.data.submission.id));
    expect(await prisma.quantityProgressEntry.count({ where: { activityId: kerb.id } })).toBe(1);
    // From here on the entries are the truth: a bundle adds to the minted one; a typed figure is refused.
    ids.k1 = (await entry({ activityId: kerb.id, boqItemId: concrete.id, quantity: 5, date: "2026-10-01", clientRequestId: "ma-k1" })).id;
    const bundle = await submit(kerb.id, { entryIds: [ids.k1] }, site.token);
    ok(bundle, 200);
    expect(bundle.body.data.submission).toMatchObject({ pctComplete: 50, quantityComplete: 25, quantity: { approvedBefore: 20, installedBasis: "approved_entries" } });
    const typedAgain = await submit(kerb.id, { quantityComplete: 30 }, site.token);
    refused(typedAgain, 409, "QUANTITY_ENTRIES_REQUIRED");
    expect(typedAgain.body.error.details).toEqual({ activityId: kerb.id, entries: 2 });
    refused(await api.post(at("/activities/bulk-progress"), { updates: [{ activityId: kerb.id, quantityComplete: 30 }] }, bearer(site.token)), 409, "QUANTITY_ENTRIES_REQUIRED");
  });

  it("a typed figure below the official one mints nothing and lowers nothing by derivation: the approved row stands as approved and is the floor of the next bundle", async () => {
    const legacy = await prisma.activityProgress.findFirst({ where: { activityId: slab2.id } });
    const typed = await submit(slab2.id, { quantityComplete: 50 }, site.token);
    ok(typed, 200);
    const approved = await approve(slab2.id, typed.body.data.submission.id);
    ok(approved);
    expect(approved.body.data).toMatchObject({ pctComplete: 50, quantityComplete: 50, quantity: { mintedEntry: null, mintSkipped: { typed: 50, officialBefore: 60, reason: expect.stringMatching(/does not exceed/) } } });
    expect(await prisma.quantityProgressEntry.count({ where: { activityId: slab2.id } })).toBe(0);
    expect(JSON.stringify(await prisma.activityProgress.findUnique({ where: { id: legacy.id } }))).toBe(JSON.stringify(legacy));
    expect((await activityPayload(slab2.id)).pctComplete).toBe(50);
    // The next bundle derives from the latest official figure (50), not from Σ entries (0).
    ids.r1 = (await entry({ activityId: slab2.id, boqItemId: concrete.id, quantity: 10, date: "2026-10-01", clientRequestId: "ma-r1" })).id;
    const bundle = await submit(slab2.id, { entryIds: [ids.r1] }, site.token);
    ok(bundle, 200);
    expect(bundle.body.data.submission).toMatchObject({ pctComplete: 60, quantityComplete: 60, quantity: { approvedBefore: 0, installedBasis: "legacy_typed_floor", legacyFloor: { quantity: 50 } } });
  });

  it("the one writer holds the method rule: a percent submission pending from before the activity was configured quantity is 409 PROGRESS_METHOD_MISMATCH at approval — nothing official, EV byte-identical; rejected, the site records entries", async () => {
    expect(await prisma.activityProgressMethod.findFirst({ where: { activityId: late.id } })).toBeNull();
    const stale = await submit(late.id, { method: "percent", pctComplete: 90 }, site.token);
    ok(stale, 200);
    expect(stale.body.data.submission).toMatchObject({ method: "percent", pctComplete: 90, status: "submitted" });
    const staleId = stale.body.data.submission.id;
    // The planner configures quantity while it waits: allowed, the method lock reads approved progress only.
    ok(await api.request("PUT", at(`/activities/${late.id}/progress-method`), { body: { method: "quantity", quantityUnit: "m3" }, headers: bearer(live.token) }));
    const evBefore = await evReport();
    const before = await footprint();
    const refusal = await approve(late.id, staleId);
    refused(refusal, 409, "PROGRESS_METHOD_MISMATCH");
    expect(refusal.body.error.details).toEqual({ activityId: late.id, effectiveMethod: "quantity", effectiveMethodBasis: "method_config", requestedMethod: "percent", submissionId: staleId });
    expect(refusal.body.error.message).toMatch(/measured by quantity; a percent submission is not approved against it/);
    expect(await footprint()).toBe(before);
    expect(await evReport()).toBe(evBefore);
    expect(await progressRows(late.id)).toHaveLength(0);
    expect(await prisma.progressSubmission.findUnique({ where: { id: staleId } })).toMatchObject({ status: "submitted", reviewedBy: null });
    // The way out: the approver rejects it and the site records what was installed.
    ok(await api.post(at(`/activities/${late.id}/progress-submissions/${staleId}/reject`), { reason: "The activity is measured by quantity; record entries" }, bearer(live.token)));
    ids.l1 = (await entry({ activityId: late.id, boqItemId: concrete.id, quantity: 10, date: "2026-03-16", clientRequestId: "ma-l1" })).id;
    const bundle = await submit(late.id, { entryIds: [ids.l1] }, site.token);
    ok(bundle, 200);
    ok(await approve(late.id, bundle.body.data.submission.id));
    const rows = await progressRows(late.id);
    expect(rows.map((row) => [Number(row.pctComplete), row.progressMethod, row.quantityComplete === null ? null : Number(row.quantityComplete)])).toEqual([[10, "quantity", 10]]);
    expect((await activityPayload(late.id)).pctComplete).toBe(10);
  });
});
