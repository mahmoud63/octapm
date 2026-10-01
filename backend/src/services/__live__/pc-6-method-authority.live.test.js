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
 * The installed view names the floor (verification finding: "after a
 * floored approval the official row says 75 of 100 while the quantity views
 * and the register's installedQuantity say 15 — Σ approved entries — with
 * nothing linking them"): on the slab the quantity view, the register and
 * the activity detail keep installed at 15 and state the official installed
 * figure (75 m3, officialInstalled) with why they differ; an activity with
 * no floor says nothing of one; a member without boq:read is given neither
 * figure nor the sentence; no row and no EV figure moves.
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
 * A quantity submission states a quantity (verification finding: "on a
 * quantity-configured activity a submission that bundles no entries and
 * types no quantity — { pctComplete: 90 } — is accepted as a quantity
 * submission at 0%; approved, it writes an official 0% row with nothing
 * behind it: 25% → 0%"):
 * - the screed: { pctComplete: 90 } with or without the method named, as a
 *   draft and through bulk-progress, is 400 QUANTITY_NO_ENTRIES_TO_BUNDLE
 *   while the activity has no entry and 409 QUANTITY_ENTRIES_REQUIRED once
 *   it has; nothing written, EV byte-identical, the official 25% stands;
 *   one already in the queue (as the database would hold it from before the
 *   rule) is refused by the writer the same way and can only be rejected.
 *
 * A refused batch writes nothing (verification finding: "bulk-progress
 * writes submissions one at a time outside a transaction; a mixed batch
 * answers 409 for the whole call after the earlier updates were written,
 * and a client that retries duplicates them"): a batch whose second update
 * is refused leaves no submission of the first; the refusal names the
 * update; a clean batch writes every update.
 *
 * The history is under the BOQ rule (verification finding: "GET /audit gives
 * members without boq:read the per-BOQ-item quantities the ledger withholds —
 * the entry events' boqItemId, quantity and unitCode, the submission events'
 * quantityInstalled and quantityPlanned, the mint event's typed and
 * officialBefore, the legacyFloor block of a floored approval"): a cost
 * controller on a boq:none template reads every entry and submission event
 * of the suite — the typed mint, the floored approvals, the skipped mint —
 * with its transition, status, source and provenance and none of those
 * figures (boqWithheld names what was left out); the PM's history is whole.
 *
 * The milestone method is respected like quantity (integration decision
 * under the owner rule "the activity's method is respected"): on an
 * activity configured weighted_milestone with weighted milestones, a
 * percentage with no milestone state — named or not, through bulk-progress
 * too — is 400 MILESTONES_REQUIRED, never recorded at a figure worked from
 * the configuration; one already in the queue is refused by the writer;
 * a submission stating its milestones is recorded and approved at their
 * weighted figure.
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
  let screed;
  let milestones;
  let site;
  let auditor;
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
    // Reads the project's history (audit:read) and the cost module, not the BOQ.
    auditor = await createLiveUser(prisma, { orgId: live.org.id, name: "LiveTest cost, no BOQ", email: `live-audit-ma-${tag}@octapm-live.test`, role: "cost_controller" });
    auditor.token = mintAccessToken(auditor);
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: auditor.id, role: "cost_controller", orgId: live.org.id } });
    const noBoq = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest cost controller, no BOQ ${tag}`, baseRole: "cost_controller", tools: { create: [{ module: "boq", level: "none" }] } },
    });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: auditor.id, templateId: noBoq.id } });

    const item = await api.post(at("/boq/items"), { code: "1.1", description: "Concrete in strip footings", quantity: 900, unit: "m3", rate: 100 }, bearer(live.token));
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
    screed = await activity({ name: "Screed (a quantity submission states a quantity)", activityCode: "A170", duration: 3, startDate: "2026-03-23", endDate: "2026-03-25", engineerIds: [live.user.id, site.id] });
    milestones = await activity({ name: "Steel erection (weighted milestones)", activityCode: "A180", duration: 5, startDate: "2026-03-30", endDate: "2026-04-03", engineerIds: [live.user.id, site.id] });
    for (const [row, quantity, configured = true] of [[pour, 100], [slab, 100], [slab2, 100], [kerb, 50], [late, 100, false], [screed, 100]]) {
      const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: concrete.id, activityId: row.id, quantity }, bearer(live.token));
      ok(allocation, 201);
      for (const step of ["submit", "approve"]) ok(await api.post(at(`/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, bearer(live.token)));
      if (configured) ok(await api.request("PUT", at(`/activities/${row.id}/progress-method`), { body: { method: "quantity", quantityUnit: "m3" }, headers: bearer(live.token) }));
    }
    ok(await api.request("PUT", at(`/activities/${milestones.id}/progress-method`), { body: { method: "weighted_milestone", milestoneWeights: [{ id: "columns", name: "Columns", weight: 40 }, { id: "beams", name: "Beams", weight: 60 }] }, headers: bearer(live.token) }));
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

  it("the installed view names the legacy floor: Σ approved entries (15) and the official installed figure (75) are both stated, with why they differ — on the quantity view, the register and the activity detail; neither figure moves, and a member without boq:read is given neither", async () => {
    const OFFICIAL = { value: 75, unitCode: "m3", basis: "official figure of the latest approved progress, carrying a legacy typed quantity as its floor" };
    const WHY = /Σ approved entries is below the official installed figure \(officialInstalled\) because earlier progress was typed, not entered/;
    const NOTE = /officialInstalled|typed, not entered|legacy typed quantity as its floor/;
    const REGISTER_BASIS = "Σ approved quantity progress entries per BOQ item (only approval counts)";
    const frozen = async () =>
      JSON.stringify({
        progress: await prisma.activityProgress.findMany({ where: { activity: { projectId: project.id } }, orderBy: { updatedAt: "asc" } }),
        entries: await prisma.quantityProgressEntry.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
      });
    const before = await frozen();
    const evBefore = await evReport();
    const official = (await progressRows(slab.id)).at(-1);
    expect(official).toMatchObject({ pctComplete: 75, quantityComplete: 75, quantityUnit: "m3", notes: "Legacy typed quantity carried as the floor of the installed figure (PC-6)" });

    // The quantity view: installed is still Σ approved entries — 15 — and it now states the official figure and why they differ.
    const view = await api.get(at(`/activities/${slab.id}/quantities`), bearer(live.token));
    ok(view);
    expect(view.body.data.progress.pctComplete.value).toBe(75);
    expect(view.body.data.figures.installed).toMatchObject({ value: 15, unitCode: "m3", truth: "derived", officialInstalled: { ...OFFICIAL, derivedFrom: [{ type: "activity_progress", id: official.id }], approvedAt: official.approvedAt.toISOString() } });
    expect(view.body.data.figures.installed.basis).toMatch(WHY);
    // The floor is the activity's: the item's own figure is Σ its approved entries, as it was.
    const [itemBlock] = view.body.data.items;
    expect(itemBlock.figures.installed).toMatchObject({ value: 15, unitCode: "m3" });
    expect(itemBlock.figures.installed.officialInstalled).toBeUndefined();
    const itemView = await api.get(at(`/boq/items/${concrete.id}/quantities`), bearer(live.token));
    ok(itemView);
    expect(JSON.stringify(itemView.body.data)).not.toMatch(NOTE);

    // The register, one activity and the list: the per-item lines as they were, the official figure beside them.
    const single = await activityPayload(slab.id);
    expect(single).toMatchObject({
      pctComplete: 75,
      progressSource: { installedBasis: "legacy_typed_floor", legacyFloor: true },
      installedQuantity: { installed: [{ boqItemId: concrete.id, unitCode: "m3", quantity: 15, entries: 2 }], officialInstalled: OFFICIAL },
    });
    expect(single.installedQuantity.basis).toBe(
      `${REGISTER_BASIS}. Σ approved entries is below the official installed figure (officialInstalled) because earlier progress was typed, not entered: the latest approved progress carries that legacy typed quantity as its floor`,
    );
    const list = await api.get(at("/activities"), bearer(live.token));
    ok(list);
    const listed = new Map(list.body.data.map((row) => [row.id, row]));
    expect(listed.get(slab.id).installedQuantity).toMatchObject({ installed: [{ quantity: 15, unitCode: "m3" }], officialInstalled: OFFICIAL, basis: single.installedQuantity.basis });

    // The activity detail's progress section: the same figure, the same note.
    const detail = await api.get(at(`/activities/${slab.id}/detail`), bearer(live.token));
    ok(detail);
    expect(detail.body.data.sections.progress.pctComplete.value).toBe(75);
    expect(detail.body.data.sections.progress.installedQuantity).toMatchObject({ value: 15, unitCode: "m3", officialInstalled: OFFICIAL });
    expect(detail.body.data.sections.progress.installedQuantity.basis).toMatch(WHY);

    // An activity whose official figure is its entries (the kerb: 20 typed once and minted) says nothing of a floor.
    const kerbView = await api.get(at(`/activities/${kerb.id}/quantities`), bearer(live.token));
    ok(kerbView);
    expect(kerbView.body.data.figures.installed).toMatchObject({ value: 20, unitCode: "m3" });
    expect(JSON.stringify(kerbView.body.data)).not.toMatch(NOTE);
    expect(listed.get(kerb.id).installedQuantity).toMatchObject({ installed: [{ quantity: 20 }], basis: REGISTER_BASIS });
    expect(JSON.stringify(listed.get(kerb.id))).not.toMatch(NOTE);
    expect(JSON.stringify(listed.get(pour.id))).not.toMatch(NOTE);

    // The member who may not read the BOQ: the official percentage and its source stay; the installed figure, the
    // official installed figure and the sentence linking them are withheld together — on every one of the reads.
    const hiddenView = await api.get(at(`/activities/${slab.id}/quantities`), bearer(auditor.token));
    ok(hiddenView);
    expect(hiddenView.body.data).toMatchObject({ withheld: true, figures: { installed: { value: null, withheld: true, notAvailable: { reason: expect.stringContaining("may read the BOQ") } } } });
    const hiddenSingle = await api.get(at(`/activities/${slab.id}`), bearer(auditor.token));
    ok(hiddenSingle);
    expect(hiddenSingle.body.data).toMatchObject({ pctComplete: 75, progressSource: { installedBasis: "legacy_typed_floor", legacyFloor: true }, installedQuantity: { withheld: { reason: expect.stringContaining("may read the BOQ") } } });
    expect(Object.keys(hiddenSingle.body.data.installedQuantity)).toEqual(["withheld"]);
    const hiddenList = await api.get(at("/activities"), bearer(auditor.token));
    ok(hiddenList);
    expect(hiddenList.body.data.find((row) => row.id === slab.id).installedQuantity).toEqual(hiddenSingle.body.data.installedQuantity);
    const hiddenDetail = await api.get(at(`/activities/${slab.id}/detail`), bearer(auditor.token));
    ok(hiddenDetail);
    for (const answer of [hiddenView, hiddenSingle, hiddenList, hiddenDetail]) expect(JSON.stringify(answer.body.data)).not.toMatch(NOTE);
    if (hiddenDetail.body.data.sections.progress.allowed) {
      expect(hiddenDetail.body.data.sections.progress.installedQuantity).toMatchObject({ value: null, withheld: true });
      expect(hiddenDetail.body.data.sections.progress.installedQuantity.officialInstalled).toBeUndefined();
    }

    // Reads only: no official row, no entry and no EV figure moved.
    expect(await frozen()).toBe(before);
    expect(await evReport()).toBe(evBefore);
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

  it("a quantity submission states a quantity: one that bundles no entry and types no figure is refused — 400 QUANTITY_NO_ENTRIES_TO_BUNDLE, 409 QUANTITY_ENTRIES_REQUIRED once entries exist — never recorded at 0%; the writer refuses one already in the queue; the official 25% stands", async () => {
    const evEmpty = await evReport();
    const empty = await footprint();
    // No entry yet: a percentage with no method named takes the activity's (quantity) and states no quantity.
    const bare = await submit(screed.id, { pctComplete: 90 }, site.token);
    refused(bare, 400, "QUANTITY_NO_ENTRIES_TO_BUNDLE");
    expect(bare.body.error.details).toMatchObject({ activityId: screed.id });
    expect(bare.body.error.message).toMatch(/bundles quantity entries .* or states a typed quantityComplete/);
    refused(await submit(screed.id, { method: "quantity", pctComplete: 90 }, site.token), 400, "QUANTITY_NO_ENTRIES_TO_BUNDLE");
    refused(await submit(screed.id, { pctComplete: 90, status: "draft" }, site.token), 400, "QUANTITY_NO_ENTRIES_TO_BUNDLE");
    refused(await submit(screed.id, { quantityPlanned: 100, quantityUnit: "m3" }, site.token), 400, "QUANTITY_NO_ENTRIES_TO_BUNDLE");
    refused(await api.post(at("/activities/bulk-progress"), { updates: [{ activityId: screed.id, pctComplete: 90 }] }, bearer(site.token)), 400, "QUANTITY_NO_ENTRIES_TO_BUNDLE");
    expect(await footprint()).toBe(empty);
    expect(await evReport()).toBe(evEmpty);
    // An official 25 of 100 through entries.
    ids.q1 = (await entry({ activityId: screed.id, boqItemId: concrete.id, quantity: 25, date: "2026-03-23", clientRequestId: "ma-q1" })).id;
    const first = await submit(screed.id, { entryIds: [ids.q1] }, site.token);
    ok(first, 200);
    ok(await approve(screed.id, first.body.data.submission.id));
    expect((await activityPayload(screed.id)).pctComplete).toBe(25);
    const evBefore = await evReport();
    const before = await footprint();
    // Entries exist: the same payloads now say so.
    const again = await submit(screed.id, { pctComplete: 90 }, site.token);
    refused(again, 409, "QUANTITY_ENTRIES_REQUIRED");
    expect(again.body.error.details).toEqual({ activityId: screed.id, entries: 1 });
    refused(await submit(screed.id, { method: "quantity", pctComplete: 90 }, site.token), 409, "QUANTITY_ENTRIES_REQUIRED");
    refused(await api.post(at("/activities/bulk-progress"), { updates: [{ activityId: screed.id, pctComplete: 90 }] }, bearer(site.token)), 409, "QUANTITY_ENTRIES_REQUIRED");
    expect(await footprint()).toBe(before);
    expect(await evReport()).toBe(evBefore);
    // One already in the queue, as the database would hold it from before the rule: the writer refuses it.
    const queued = await prisma.progressSubmission.create({
      data: { projectId: project.id, activityId: screed.id, method: "quantity", source: "manual", pctComplete: 0, quantityComplete: null, quantityPlanned: 100, quantityUnit: "m3", status: "submitted", submittedBy: site.id, submittedAt: new Date(), createdBy: site.id },
    });
    const held = await footprint();
    const refusal = await approve(screed.id, queued.id);
    refused(refusal, 409, "QUANTITY_ENTRIES_REQUIRED");
    expect(refusal.body.error.details).toEqual({ activityId: screed.id, entries: 1, submissionId: queued.id });
    expect(await footprint()).toBe(held);
    expect(await evReport()).toBe(evBefore);
    expect((await progressRows(screed.id)).map((row) => [Number(row.pctComplete), Number(row.quantityComplete)])).toEqual([[25, 25]]);
    expect((await activityPayload(screed.id)).pctComplete).toBe(25);
    ok(await api.post(at(`/activities/${screed.id}/progress-submissions/${queued.id}/reject`), { reason: "A quantity submission states a quantity; bundle the entries" }, bearer(live.token)));
    expect((await activityPayload(screed.id)).pctComplete).toBe(25);
  });

  it("bulk-progress is one transaction: a batch with one refused update writes nothing — the refusal names the update — and a retry duplicates nothing; a clean batch writes every update", async () => {
    const evBefore = await evReport();
    const before = await footprint();
    const wallBefore = await prisma.progressSubmission.count({ where: { activityId: wall.id } });
    const bulk = (updates) => api.post(at("/activities/bulk-progress"), { updates }, bearer(site.token));
    // The wall (unconfigured) first, then the pour (measured by quantity): the second is refused.
    const mixed = await bulk([{ activityId: wall.id, method: "percent", pctComplete: 11 }, { activityId: pour.id, method: "percent", pctComplete: 90 }]);
    refused(mixed, 409, "PROGRESS_METHOD_MISMATCH");
    expect(mixed.body.error.details).toEqual({ activityId: pour.id, effectiveMethod: "quantity", effectiveMethodBasis: "method_config", requestedMethod: "percent", batch: { index: 1, activityId: pour.id, updates: 2, written: 0 } });
    expect(await prisma.progressSubmission.count({ where: { activityId: wall.id } })).toBe(wallBefore);
    expect(await footprint()).toBe(before);
    // The retry a client would make: still nothing.
    refused(await bulk([{ activityId: wall.id, method: "percent", pctComplete: 11 }, { activityId: pour.id, method: "percent", pctComplete: 90 }]), 409, "PROGRESS_METHOD_MISMATCH");
    // Another refusal of the writer, later in a longer batch: the same.
    const hollow = await bulk([{ activityId: wall.id, pctComplete: 12 }, { activityId: wall.id, pctComplete: 13 }, { activityId: screed.id, pctComplete: 90 }]);
    refused(hollow, 409, "QUANTITY_ENTRIES_REQUIRED");
    expect(hollow.body.error.details).toMatchObject({ activityId: screed.id, batch: { index: 2, activityId: screed.id, updates: 3, written: 0 } });
    expect(await footprint()).toBe(before);
    // An update naming an activity that is not in the project is not skipped: 404, named, nothing written.
    const stranger = require("crypto").randomUUID();
    const unknown = await bulk([{ activityId: wall.id, pctComplete: 14 }, { activityId: stranger, pctComplete: 50 }]);
    refused(unknown, 404, "ACTIVITY_NOT_FOUND");
    expect(unknown.body.error.details).toEqual({ batch: { index: 1, activityId: stranger, updates: 2, written: 0 } });
    expect(unknown.body.error.message).toMatch(/Update 2 of 2 names an activity that is not in this project; nothing was written/);
    expect(await footprint()).toBe(before);
    expect(await evReport()).toBe(evBefore);
    // A clean batch writes every update, in order.
    const clean = await bulk([{ activityId: wall.id, pctComplete: 12 }, { activityId: wall.id, method: "manual", pctComplete: 13, notes: "typed" }]);
    ok(clean, 200);
    expect(clean.body.data.submitted).toBe(2);
    expect(clean.body.data.submissions.map((row) => [row.activityId, row.method, row.pctComplete, row.status])).toEqual([[wall.id, "percent", 12, "submitted"], [wall.id, "manual", 13, "submitted"]]);
    expect(await prisma.progressSubmission.count({ where: { activityId: wall.id } })).toBe(wallBefore + 2);
    expect(await evReport()).toBe(evBefore);
  });

  it("GET /audit for a member who may not read the BOQ: every quantity-entry and submission event keeps its transition, status and provenance and carries no per-item quantity, item, allocation, typed figure or floor — the typed mint, the floored approvals and the skipped mint included; the PM's history is whole", async () => {
    const history = async (token, entityType) => {
      const answer = await api.get(at(`/audit?entityType=${entityType}&limit=100&order=desc`), bearer(token));
      ok(answer);
      expect(answer.body.data.nextCursor ?? null).toBeNull();
      return answer.body.data.events;
    };
    const PARTS = ["summary", "oldSummary", "newSummary", "metadata"];
    const ENTRY_KEYS = ["quantity", "unitCode", "boqItemId", "allocationId", "typed", "officialBefore"];
    const SUBMISSION_KEYS = ["quantityInstalled", "quantityPlanned", "quantityUnit", "legacyFloor"];
    const carried = (events, keys) =>
      events.flatMap((event) => PARTS.flatMap((part) => keys.filter((key) => event[part] && Object.prototype.hasOwnProperty.call(event[part], key)).map((key) => `${event.summary?.transition}:${part}.${key}`)));
    const byTransition = (events, transition) => events.filter((event) => event.summary?.transition === transition);

    // The PM reads the BOQ: the history is whole — and it does carry the figures (so the scan below has teeth).
    const fullEntries = await history(live.token, "quantity_progress_entry");
    const fullSubmissions = await history(live.token, "progress_submission");
    const [fullMint] = byTransition(fullEntries, "quantity_entry.mint_from_typed_submission");
    expect(fullMint).toMatchObject({ newStatus: "approved", summary: { boqItemId: concrete.id, quantity: 20, unitCode: "m3", typed: 20, officialBefore: 0 }, newSummary: { boqItemId: concrete.id, quantity: 20 } });
    expect(fullMint.boqWithheld).toBeUndefined();
    const fullFloored = fullSubmissions.filter((event) => event.newSummary?.legacyFloor);
    expect(fullFloored.map((event) => event.newSummary.legacyFloor.quantity).sort((a, b) => a - b)).toEqual([60, 70]);
    expect(fullSubmissions.filter((event) => event.newSummary?.mintSkipped).map((event) => event.newSummary.mintSkipped)).toEqual([expect.objectContaining({ typed: 50, officialBefore: 60 })]);
    expect(carried(fullEntries, ENTRY_KEYS).length).toBeGreaterThan(20);
    expect(carried(fullSubmissions, SUBMISSION_KEYS).length).toBeGreaterThan(20);
    expect(fullSubmissions.some((event) => event.boqWithheld)).toBe(false);

    // The cost controller on a boq:none template: the same events, none of the figures.
    const entries = await history(auditor.token, "quantity_progress_entry");
    const submissions = await history(auditor.token, "progress_submission");
    expect(entries.map((event) => event.id)).toEqual(fullEntries.map((event) => event.id));
    expect(submissions.map((event) => event.id)).toEqual(fullSubmissions.map((event) => event.id));
    expect(carried(entries, ENTRY_KEYS)).toEqual([]);
    expect(carried(submissions, SUBMISSION_KEYS)).toEqual([]);
    expect(JSON.stringify([entries, submissions])).not.toContain(concrete.id);
    for (const event of entries) {
      expect(event).toMatchObject({ entityType: "quantity_progress_entry", action: expect.any(String), actorId: expect.any(String), summary: { transition: expect.stringMatching(/^quantity_entry\./), activityId: expect.any(String), source: expect.any(String), status: expect.any(String) }, boqWithheld: { keys: expect.arrayContaining(["quantity", "unitCode", "boqItemId"]), reason: expect.stringContaining("may read the BOQ") } });
    }
    // The mint: who, when, what happened and for which submission — not how much of which item.
    const [mint] = byTransition(entries, "quantity_entry.mint_from_typed_submission");
    expect(mint).toMatchObject({ id: fullMint.id, action: "created", newStatus: "approved", summary: { activityId: kerb.id, source: "submission", status: "approved", submissionId: fullMint.summary.submissionId }, boqWithheld: { keys: expect.arrayContaining(["typed", "officialBefore"]) } });
    // The floored approvals: the percentage, the method, the bases and the official row stay; the floor's figures do not.
    const floored = submissions.filter((event) => fullFloored.some((full) => full.id === event.id));
    expect(floored).toHaveLength(2);
    for (const event of floored) {
      expect(event).toMatchObject({ action: "approved", newStatus: "approved", newSummary: { pctComplete: expect.any(Number), method: "quantity", installedBasis: "legacy_typed_floor", plannedBasis: "approved_allocations", quantityEntries: 1, approvedProgressId: expect.any(String) }, summary: { transition: "submission.approve" }, boqWithheld: { keys: expect.arrayContaining(["quantityInstalled", "quantityPlanned", "quantityUnit", "legacyFloor"]), reason: expect.stringContaining("may read the BOQ") } });
    }
    // The skipped mint says that it was skipped, not the typed and official figures it compared.
    const skipped = submissions.filter((event) => event.newSummary && event.newSummary.mintSkipped);
    expect(skipped.map((event) => event.newSummary.mintSkipped)).toEqual([{ withheld: true }]);
    expect(skipped[0].boqWithheld.keys).toContain("mintSkipped");
    // A percent submission's events carry no quantity figure and are the same objects' content for both readers.
    const percentIds = new Set(fullSubmissions.filter((event) => (event.newSummary || event.summary)?.method === "percent").map((event) => event.id));
    expect(percentIds.size).toBeGreaterThan(0);
    for (const event of submissions.filter((row) => percentIds.has(row.id))) expect(event).toEqual(fullSubmissions.find((row) => row.id === event.id));
  });
  it("the milestone method is respected like quantity: a percentage with no milestone state is 400 MILESTONES_REQUIRED on every path, never recorded at a figure worked from the configuration; the writer refuses one in the queue; a submission stating its milestones is recorded and approved at their weighted figure", async () => {
    const evBefore = await evReport();
    const before = await footprint();
    const configured = [{ id: "columns", name: "Columns" }, { id: "beams", name: "Beams" }];
    for (const payload of [{ pctComplete: 60 }, { method: "weighted_milestone", pctComplete: 60 }, { pctComplete: 60, status: "draft" }, { method: "weighted_milestone", milestones: [] }]) {
      const answer = await submit(milestones.id, payload, site.token);
      refused(answer, 400, "MILESTONES_REQUIRED");
      expect(answer.body.error.details).toEqual({ activityId: milestones.id, method: "weighted_milestone", milestones: configured });
      expect(answer.body.error.message).toMatch(/measured by weighted milestones \(2 configured\).*a percentage is not a milestone state/);
    }
    const bulk = await api.post(at("/activities/bulk-progress"), { updates: [{ activityId: wall.id, pctComplete: 15 }, { activityId: milestones.id, pctComplete: 60 }] }, bearer(site.token));
    refused(bulk, 400, "MILESTONES_REQUIRED");
    expect(bulk.body.error.details.batch).toEqual({ index: 1, activityId: milestones.id, updates: 2, written: 0 });
    // The percent method names itself: not the activity's, refused as before.
    refused(await submit(milestones.id, { method: "percent", pctComplete: 60 }, site.token), 409, "PROGRESS_METHOD_MISMATCH");
    expect(await footprint()).toBe(before);
    expect(await evReport()).toBe(evBefore);

    // One in the queue from before the rule (as the database would hold it): the writer refuses it; nothing official.
    const queued = await prisma.progressSubmission.create({
      data: { projectId: project.id, activityId: milestones.id, method: "weighted_milestone", source: "manual", pctComplete: 0, milestoneProgressJson: null, status: "submitted", submittedBy: site.id, submittedAt: new Date(), createdBy: site.id },
    });
    const held = await footprint();
    const refusedApproval = await approve(milestones.id, queued.id);
    refused(refusedApproval, 400, "MILESTONES_REQUIRED");
    expect(refusedApproval.body.error.details).toMatchObject({ activityId: milestones.id, submissionId: queued.id });
    expect(await footprint()).toBe(held);
    expect(await progressRows(milestones.id)).toHaveLength(0);
    ok(await api.post(at(`/activities/${milestones.id}/progress-submissions/${queued.id}/reject`), { reason: "LiveTest: states no milestone" }, bearer(live.token)));

    // Stated: recorded and approved at the weighted figure (columns 40 + half the beams 30 = 70).
    const stated = await submit(milestones.id, { milestones: [{ id: "columns", complete: true }, { id: "beams", pctComplete: 50 }] }, site.token);
    ok(stated, 200);
    expect(stated.body.data.submission).toMatchObject({ method: "weighted_milestone", pctComplete: 70 });
    ok(await approve(milestones.id, stated.body.data.submission.id));
    expect((await progressRows(milestones.id)).map((row) => [row.progressMethod, row.pctComplete])).toEqual([["weighted_milestone", 70]]);
  });
});
