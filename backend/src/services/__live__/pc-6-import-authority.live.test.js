/**
 * PC-6 import authority — POST /projects/:id/import/progress makes progress
 * only in the importer's own authority, proven against a real API process
 * and the real local Postgres (owner decision, security).
 *
 * Before: the import wrote APPROVED ActivityProgress rows directly
 * (prisma.activityProgress.createMany, approvedBy 'import'), gated only by
 * progress submission.submit — so a site engineer, who may submit but not
 * approve, could publish official progress and move earned value by upload.
 *
 * In a throwaway "LiveTest <uuid>" organisation: a five-activity P6 XER is
 * imported, approved and activated; one activity is allocated a BOQ item so
 * EV is a real figure; one activity requires evidence, one carries an open
 * ITP hold point, one is measured by quantity, one is not assigned to the
 * site engineer.
 *
 * - A site engineer (submit, no approve): the dry run says which rows would
 *   be SUBMITTED for this person, and — read from the writer's own rules,
 *   not assumed — which one would be kept as a draft (evidence required)
 *   and which one refused (not assigned); the import creates 'submitted' import
 *   submissions and ZERO ActivityProgress rows; the EV report is
 *   byte-identical before and after; the activity's official percentage is
 *   unchanged; the unassigned activity is refused by the writer's assignment
 *   rule and reported, the evidence-required one is kept as a draft, and the
 *   answer says nothing is official yet.
 * - Re-upload of the same file: every row already_pending, nothing written;
 *   the draft is said to await evidence, the others to await approval.
 * - A PM (approve): the dry run says which rows would be APPROVED and which
 *   two the evidence gate and the open hold point would hold; the import goes
 *   through the approval writer (submission approved, ActivityProgress with
 *   submissionId, approvedBy the PM, audit CREATED + APPROVED events); the
 *   evidence-required row and the open-hold-point row stay pending with the
 *   gate's reason; the quantity-method row is flagged methodMismatch; an
 *   approved row that already existed is byte-identical afterwards and the
 *   new figure is a new row.
 * - A member of another organisation: 404 PROJECT_NOT_FOUND, nothing written.
 * - The site engineer re-uploads the PM's figures: unchanged / already_pending,
 *   nothing written.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run test:live -- src/services/__live__/pc-6-import-authority.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const TASKS = [
  ["T1", "P100", "Excavate"],
  ["T2", "P200", "Blind (evidence required)"],
  ["T3", "P300", "Rebar (ITP hold point)"],
  ["T4", "P400", "Pour (quantity method)"],
  ["T5", "P500", "Cure (not assigned)"],
];

/**
 * A P6 XER carrying these percentages per task (0 for the schedule itself;
 * null leaves the task's phys_complete_pct cell empty — no percentage stated).
 */
const xerWith = (pcts) =>
  [
    "ERMHDR\t19.12",
    "%T\tPROJWBS",
    "%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num",
    "%R\tW1\t\tCIV\tCivil\t1",
    "%T\tTASK",
    "%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct",
    ...TASKS.map(
      ([id, code, name]) =>
        `%R\t${id}\t${code}\t${name}\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t${pcts[code] === null ? "" : (pcts[code] ?? 0)}`,
    ),
    "%T\tTASKPRED",
    "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt",
    "%R\tP1\tT2\tT1\tPR_FS\t0",
    "%E",
    "",
  ].join("\n");

const SITE_FILE = { P100: 10, P200: 20, P300: 30, P400: 40, P500: 50 };
const PM_FILE = { P100: 15, P200: 25, P300: 35, P400: 45, P500: 55 };

liveDescribe("PC-6: a progress import makes progress only in the importer's own authority", () => {
  let live;
  let other;
  let api;
  let project;
  let siteEngineer;
  const byCode = {};
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const at = (route) => `/api/v1/projects/${project.id}${route}`;
  const ok = (answer, status = 200) => expect([answer.status, answer.body?.error]).toEqual([status, undefined]);

  const upload = async (token, content, { dryRun = false, projectId = null } = {}) => {
    const form = new FormData();
    form.append("file", new Blob([content], { type: "application/octet-stream" }), "progress.xer");
    form.append("format", "xer");
    const route = `/api/v1/projects/${projectId || project.id}/import/progress${dryRun ? "?dryRun=true" : ""}`;
    const response = await fetch(`${api.base}${route}`, { method: "POST", headers: bearer(token), body: form });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const rowsByCode = (data) => Object.fromEntries(data.rows.map((row) => [row.p6ActivityId, row]));

  /** Everything the import could have written, as one string. */
  const footprint = async () => {
    const activityIds = Object.values(byCode);
    return JSON.stringify({
      progress: await prisma.activityProgress.findMany({ where: { activityId: { in: activityIds } }, orderBy: [{ activityId: "asc" }, { updatedAt: "asc" }] }),
      submissions: await prisma.progressSubmission.findMany({ where: { projectId: project.id }, orderBy: [{ activityId: "asc" }, { createdAt: "asc" }] }),
      documents: await prisma.projectDocument.count({ where: { projectId: project.id, documentType: "progress_import" } }),
    });
  };
  const officialPct = async (code) => {
    const answer = await api.get(at(`/activities/${byCode[code]}`), bearer(live.token));
    ok(answer);
    return [answer.body.data.pctComplete, answer.body.data.approvedProgressSource, answer.body.data.progressApprovalStatus];
  };
  const evReport = async () => {
    const answer = await api.get(at("/reports/ev"), bearer(live.token));
    ok(answer);
    // The report is computed "now": only the instant it was asked at may differ.
    const { reporting, ...rest } = answer.body.data;
    return JSON.stringify(rest);
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    other = await createLiveOrg(prisma);
    expect((await prisma.organisation.findUnique({ where: { id: live.org.id } })).name).toMatch(/^LiveTest [0-9a-f-]{36}$/);
    api = await startApi({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", RATE_LIMIT_UPLOAD_MAX: "1000", DATABASE_CONNECTION_LIMIT: "4" }, { appOnly: true });
    project = await prisma.project.create({
      data: { orgId: live.org.id, currency: "USD", name: "LiveTest PC-6 import authority", startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });

    // The programme: imported, approved, activated.
    const form = new FormData();
    form.append("file", new Blob([xerWith({})], { type: "application/octet-stream" }), "schedule.xer");
    const imported = await fetch(`${api.base}${at("/import/xer")}`, { method: "POST", headers: bearer(live.token), body: form });
    const body = await imported.json();
    expect([imported.status, body?.error, body?.data?.staged]).toEqual([201, undefined, true]);
    for (const step of ["submit-review", "approve"]) ok(await api.post(at(`/schedule/revisions/${body.data.revisionId}/${step}`), {}, bearer(live.token)));
    ok(await api.post(at(`/schedule/revisions/${body.data.revisionId}/activate`), { mappings: [] }, bearer(live.token)));
    const active = await prisma.activity.findMany({ where: { projectId: project.id, isActive: true }, select: { id: true, p6ActivityId: true } });
    for (const row of active) byCode[row.p6ActivityId] = row.id;
    expect(Object.keys(byCode).sort()).toEqual(["P100", "P200", "P300", "P400", "P500"]);

    // A real earned value: P100 is allocated 100 m3 at 100 = 10,000.
    const item = await api.post(at("/boq/items"), { code: "1.1", description: "Concrete", quantity: 300, unit: "m3", rate: 100 }, bearer(live.token));
    ok(item, 201);
    const allocation = await api.post(at("/activity-boq-allocations"), { boqItemId: item.body.data.item.id, activityId: byCode.P100, quantity: 100 }, bearer(live.token));
    ok(allocation, 201);
    for (const step of ["submit", "approve"]) ok(await api.post(at(`/activity-boq-allocations/${allocation.body.data.id}/${step}`), {}, bearer(live.token)));

    // The gates: P200 needs evidence, P300 has an open ITP hold point, P400 is measured by quantity.
    ok(await api.request("PUT", at(`/activities/${byCode.P200}/progress-method`), { body: { method: "percent", evidenceRequired: true }, headers: bearer(live.token) }));
    ok(await api.request("PUT", at(`/activities/${byCode.P400}/progress-method`), { body: { method: "quantity", plannedQuantity: 200, quantityUnit: "m3" }, headers: bearer(live.token) }));
    const template = await prisma.formTemplate.create({ data: { orgId: live.org.id, projectId: project.id, type: "itp", name: "LiveTest ITP" } });
    const section = await prisma.formSection.create({ data: { templateId: template.id, title: "Before the pour" } });
    await prisma.formItem.create({ data: { templateId: template.id, sectionId: section.id, label: "Rebar cover verified", responseType: "pass_fail", isHoldPoint: true, inspectionPointType: "hold" } });
    await prisma.formInstance.create({
      data: { orgId: live.org.id, projectId: project.id, templateId: template.id, number: 1, ref: "ITP-001", type: "itp", title: "Rebar inspection", status: "scheduled", activityId: byCode.P300 },
    });

    // The site engineer: submit but not approve; assigned to every activity but P500.
    siteEngineer = await createLiveUser(prisma, { orgId: live.org.id, name: "LiveTest site engineer", email: `live-site-${live.org.id.slice(0, 8)}@octapm-live.test`, role: "site_engineer" });
    siteEngineer.token = mintAccessToken(siteEngineer);
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: siteEngineer.id, role: "site_engineer", orgId: live.org.id } });
    for (const code of ["P100", "P200", "P300", "P400"]) await prisma.activityAssignment.create({ data: { activityId: byCode[code], userId: siteEngineer.id } });
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, other]) {
      if (!org) continue;
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "recordHistorySnapshot", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  it("a site engineer (submit, no approve): pending submissions, zero ActivityProgress rows, EV and the official figure unchanged", async () => {
    expect(await prisma.activityProgress.count({ where: { activityId: { in: Object.values(byCode) } } })).toBe(0);
    const evBefore = await evReport();
    const before = await footprint();

    // The dry run states the outcome for this person — read from the writer's
    // rules, so the evidence-required row and the unassigned row are not
    // promised as submissions — and writes nothing.
    const preview = await upload(siteEngineer.token, xerWith(SITE_FILE), { dryRun: true });
    ok(preview);
    expect(preview.body.data).toMatchObject({ dryRun: true, authority: { canApprove: false, outcome: "submitted" }, matched: 5, notMatched: 0, wouldSubmit: 3, wouldApprove: 0, wouldHold: 1, wouldRefuse: 1, updated: 0 });
    expect(preview.body.data.message).toBe("Dry run: nothing was written. For you 3 rows would be submitted for approval — not official until an approver approves them; 1 would be kept as draft (evidence required), 1 would be refused, 0 already official, 0 already pending, 0 skipped (no percentage), 0 not matched.");
    const previewed = rowsByCode(preview.body.data);
    expect(["P100", "P300", "P400"].map((code) => previewed[code].status)).toEqual(["submit", "submit", "submit"]);
    expect(previewed.P200).toMatchObject({ status: "hold", reason: { code: "PROGRESS_EVIDENCE_REQUIRED", message: "This activity requires evidence before progress can be submitted; the row would be kept as a draft" } });
    expect(previewed.P500).toMatchObject({ status: "refuse", reason: { code: "ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED" } });
    // The plan's working fields never reach the answer.
    for (const row of Object.values(previewed)) expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["expected", "evidenceRequired"]));
    expect(await footprint()).toBe(before);

    const answer = await upload(siteEngineer.token, xerWith(SITE_FILE));
    ok(answer);
    const data = answer.body.data;
    expect(data).toMatchObject({ dryRun: false, authority: { canApprove: false, outcome: "submitted" }, matched: 5, notMatched: 0, submitted: 3, draft: 1, approved: 0, pending: 0, refused: 1, updated: 0 });
    expect(data.message).toBe("3 rows submitted for approval — not official until approved; 1 kept as draft (evidence required), 1 refused, 0 already official, 0 already pending, 0 skipped (no percentage), 0 not matched.");
    const rows = rowsByCode(data);
    expect(rows.P100).toMatchObject({ status: "submitted", pctComplete: 10, officialPctComplete: null, activityMethod: "percent", methodMismatch: false, progressId: null, reason: null });
    expect(rows.P200).toMatchObject({ status: "draft", pctComplete: 20, reason: { code: "PROGRESS_EVIDENCE_REQUIRED" } });
    expect(rows.P300).toMatchObject({ status: "submitted", pctComplete: 30 });
    expect(rows.P400).toMatchObject({ status: "submitted", pctComplete: 40, activityMethod: "quantity", methodMismatch: true });
    expect(rows.P500).toMatchObject({ status: "refused", submissionId: null, reason: { code: "ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED" } });

    // What is in the database: submissions in the site engineer's name, no official row.
    const submissions = await prisma.progressSubmission.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } });
    expect(submissions.map((row) => [row.activityId, row.status, row.source, row.method, row.pctComplete, row.submittedBy])).toEqual([
      [byCode.P100, "submitted", "import", "percent", 10, siteEngineer.id],
      [byCode.P200, "draft", "import", "percent", 20, null],
      [byCode.P300, "submitted", "import", "percent", 30, siteEngineer.id],
      [byCode.P400, "submitted", "import", "percent", 40, siteEngineer.id],
    ]);
    expect(submissions.map((row) => row.id).sort()).toEqual([rows.P100, rows.P200, rows.P300, rows.P400].map((row) => row.submissionId).sort());
    expect(await prisma.activityProgress.count({ where: { activityId: { in: Object.values(byCode) } } })).toBe(0);
    expect(await evReport()).toBe(evBefore);
    expect(await officialPct("P100")).toEqual([0, null, "submitted"]);
    expect(await officialPct("P500")).toEqual([0, null, "missing"]);
    // The upload is kept as the import's source document.
    expect(await prisma.projectDocument.count({ where: { projectId: project.id, id: data.document.documentId } })).toBe(1);
  });

  it("re-upload of the same file by the same person: every row already pending, nothing written", async () => {
    const before = await footprint();
    const answer = await upload(siteEngineer.token, xerWith(SITE_FILE));
    ok(answer);
    expect(answer.body.data).toMatchObject({ matched: 5, submitted: 0, draft: 0, approved: 0, alreadyPending: 4, refused: 1, updated: 0 });
    const rows = rowsByCode(answer.body.data);
    // Where each waits: the draft for evidence (it is not in the approval queue), the rest for approval.
    for (const code of ["P100", "P300", "P400"]) expect(rows[code]).toMatchObject({ status: "already_pending", waitingStatus: "submitted", reason: { code: "PROGRESS_ALREADY_PENDING", message: `An import submission at ${SITE_FILE[code]}% is already awaiting approval; no second submission` } });
    expect(rows.P200).toMatchObject({ status: "already_pending", waitingStatus: "draft", reason: { code: "PROGRESS_ALREADY_PENDING", message: "An import submission at 20% is already kept as a draft awaiting evidence; no second submission" } });
    expect(rows.P500).toMatchObject({ status: "refused", waitingStatus: null, reason: { code: "ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED" } });
    // Only the source document differs: no submission, no progress row.
    expect(JSON.parse(await footprint())).toEqual({ ...JSON.parse(before), documents: JSON.parse(before).documents + 1 });
  });
  it("a PM (approve): approved through the writer and its gates; a refused row stays pending with the reason; an existing approved row is never rewritten", async () => {
    // An official figure first, made the ordinary way: the PM approves the site engineer's P100 submission.
    const pending = await prisma.progressSubmission.findFirst({ where: { activityId: byCode.P100, status: "submitted" } });
    ok(await api.post(at(`/activities/${byCode.P100}/progress-submissions/${pending.id}/approve`), {}, bearer(live.token)));
    const existing = await prisma.activityProgress.findMany({ where: { activityId: byCode.P100 } });
    expect(existing).toHaveLength(1);
    expect(await officialPct("P100")).toEqual([10, "import", "approved"]);
    const existingRow = JSON.stringify(existing[0]);

    const preview = await upload(live.token, xerWith(PM_FILE), { dryRun: true });
    ok(preview);
    expect(preview.body.data).toMatchObject({ dryRun: true, authority: { canApprove: true, outcome: "approved" }, matched: 5, wouldSubmit: 0, wouldApprove: 3, wouldHold: 2, wouldRefuse: 0, updated: 0 });
    expect(preview.body.data.message).toBe("Dry run: nothing was written. For you 3 rows would be submitted and approved through the progress approval gates; 2 would be left pending (evidence required, ITP hold point open), 0 would be refused, 0 already official, 0 already pending, 0 skipped (no percentage), 0 not matched. 2 older pending import submissions at another figure left in the approval queue (superseded pending) — reject them there.");
    const previewed = rowsByCode(preview.body.data);
    expect(["P100", "P400", "P500"].map((code) => previewed[code].status)).toEqual(["approve", "approve", "approve"]);
    expect(previewed.P200).toMatchObject({ status: "hold", reason: { code: "PROGRESS_EVIDENCE_REQUIRED", message: "This activity requires evidence before progress can be approved; the row would be left pending" } });
    expect(previewed.P300).toMatchObject({ status: "hold", reason: { code: "ITP_HOLD_POINT_OPEN", message: "1 ITP hold point on this activity has not passed (ITP-001: Rebar cover verified — pending); the row would be left pending" } });
    expect(await prisma.progressSubmission.count({ where: { projectId: project.id } })).toBe(4);

    const auditBefore = await prisma.auditEvent.count({ where: { projectId: project.id, entityType: "progress_submission" } });
    const answer = await upload(live.token, xerWith(PM_FILE));
    ok(answer);
    const data = answer.body.data;
    expect(data).toMatchObject({ dryRun: false, authority: { canApprove: true, outcome: "approved" }, matched: 5, approved: 3, pending: 2, submitted: 0, refused: 0, updated: 3 });
    expect(data.message).toBe("3 rows approved through the progress approval gates, 2 left pending (a gate refused), 0 refused, 0 already official, 0 already pending, 0 skipped (no percentage), 0 not matched. 2 older pending import submissions at another figure left in the approval queue (superseded pending) — reject them there.");
    const rows = rowsByCode(data);
    expect(rows.P100).toMatchObject({ status: "approved", pctComplete: 15, officialPctComplete: 10, reason: null });
    expect(rows.P200).toMatchObject({ status: "pending", pctComplete: 25, reason: { code: "PROGRESS_EVIDENCE_REQUIRED" }, progressId: null });
    expect(rows.P300).toMatchObject({ status: "pending", pctComplete: 35, reason: { code: "ITP_HOLD_POINT_OPEN" }, progressId: null });
    expect(rows.P300.reason.message).toMatch(/^1 ITP hold point on this activity has not passed \(ITP-001: Rebar cover verified — pending\)/);
    expect(rows.P400).toMatchObject({ status: "approved", pctComplete: 45, activityMethod: "quantity", methodMismatch: true, approvesPending: false });
    expect(rows.P500).toMatchObject({ status: "approved", pctComplete: 55, approvesPending: false, superseded: null });

    // The site engineer's differing figures on P300 and P400 are still in the
    // queue, untouched, and the answer names them so the PM can reject them;
    // the P200 draft is not in the queue and is not reported.
    const siteRows = Object.fromEntries((await prisma.progressSubmission.findMany({ where: { projectId: project.id, submittedBy: siteEngineer.id, status: "submitted" } })).map((row) => [row.activityId, row]));
    expect(rows.P300.superseded).toEqual({ submissionId: siteRows[byCode.P300].id, pctComplete: 30 });
    expect(rows.P400.superseded).toEqual({ submissionId: siteRows[byCode.P400].id, pctComplete: 40 });
    expect(data.supersededPending).toBe(2);
    expect(data.supersededPendingSubmissions).toEqual([
      { activityId: byCode.P300, p6ActivityId: "P300", name: "Rebar (ITP hold point)", submissionId: siteRows[byCode.P300].id, pctComplete: 30, importedPctComplete: 35 },
      { activityId: byCode.P400, p6ActivityId: "P400", name: "Pour (quantity method)", submissionId: siteRows[byCode.P400].id, pctComplete: 40, importedPctComplete: 45 },
    ]);
    expect(rows.P200.superseded).toBeNull();
    expect(preview.body.data.supersededPendingSubmissions).toEqual(data.supersededPendingSubmissions);
    for (const code of ["P300", "P400"]) expect(await prisma.progressSubmission.findUnique({ where: { id: siteRows[byCode[code]].id } })).toMatchObject({ status: "submitted", pctComplete: SITE_FILE[code], reviewedBy: null });

    // Through the writer: each approved row is an ActivityProgress with its
    // submission, approved by the PM, with the submission's audit trail.
    for (const code of ["P100", "P400", "P500"]) {
      const progress = await prisma.activityProgress.findUnique({ where: { id: rows[code].progressId } });
      expect(progress).toMatchObject({ activityId: byCode[code], submissionId: rows[code].submissionId, pctComplete: rows[code].pctComplete, status: "approved", approvedBy: live.user.id, source: "import", progressMethod: "percent" });
      const submission = await prisma.progressSubmission.findUnique({ where: { id: rows[code].submissionId } });
      expect(submission).toMatchObject({ status: "approved", source: "import", submittedBy: live.user.id, reviewedBy: live.user.id });
      const trail = await prisma.auditEvent.findMany({ where: { entityType: "progress_submission", entityId: rows[code].submissionId }, orderBy: { occurredAt: "asc" } });
      expect(trail.map((event) => [event.action, event.actorId])).toEqual([["created", live.user.id], ["approved", live.user.id]]);
    }
    expect(await prisma.auditEvent.count({ where: { projectId: project.id, entityType: "progress_submission" } })).toBe(auditBefore + 3 * 2 + 2 * 1);
    // The refused rows wait: no ActivityProgress, the submission open.
    expect(await prisma.progressSubmission.findUnique({ where: { id: rows.P200.submissionId } })).toMatchObject({ status: "draft", pctComplete: 25 });
    expect(await prisma.progressSubmission.findUnique({ where: { id: rows.P300.submissionId } })).toMatchObject({ status: "submitted", pctComplete: 35 });
    expect(await prisma.activityProgress.count({ where: { activityId: { in: [byCode.P200, byCode.P300] } } })).toBe(0);
    // Never rewritten: the earlier approved row is byte-identical; the new figure is a new row.
    const p100 = await prisma.activityProgress.findMany({ where: { activityId: byCode.P100 }, orderBy: { approvedAt: "asc" } });
    expect(p100).toHaveLength(2);
    expect(JSON.stringify(p100[0])).toBe(existingRow);
    expect(p100[1].pctComplete).toBe(15);
    expect(await officialPct("P100")).toEqual([15, "import", "approved"]);
    // Nothing was written by anyone but the writer: no row without a submission, none approved by 'import'.
    expect(await prisma.activityProgress.count({ where: { activityId: { in: Object.values(byCode) }, OR: [{ submissionId: null }, { approvedBy: "import" }] } })).toBe(0);
  });

  it("a member of another organisation gets the tenant 404 and writes nothing", async () => {
    const before = await footprint();
    const answer = await upload(other.token, xerWith(PM_FILE));
    expect([answer.status, answer.body?.error?.code]).toEqual([404, "PROJECT_NOT_FOUND"]);
    expect(await footprint()).toBe(before);
  });

  it("the site engineer re-uploads the PM's figures: already official or already pending, nothing written", async () => {
    const before = await footprint();
    const answer = await upload(siteEngineer.token, xerWith(PM_FILE));
    ok(answer);
    expect(answer.body.data).toMatchObject({ matched: 5, submitted: 0, draft: 0, approved: 0, unchanged: 3, alreadyPending: 2, refused: 0, updated: 0 });
    const rows = rowsByCode(answer.body.data);
    expect(rows.P100).toMatchObject({ status: "unchanged", officialPctComplete: 15, reason: { code: "PROGRESS_ALREADY_OFFICIAL" } });
    expect(rows.P400).toMatchObject({ status: "unchanged", officialPctComplete: 45 });
    expect(rows.P200).toMatchObject({ status: "already_pending" });
    expect(rows.P300).toMatchObject({ status: "already_pending" });
    // P500: the PM's 55% is already official, so nothing needs writing and the assignment rule is never reached.
    expect(rows.P500).toMatchObject({ status: "unchanged", officialPctComplete: 55 });
    expect(JSON.parse(await footprint())).toEqual({ ...JSON.parse(before), documents: JSON.parse(before).documents + 1 });
  });

  // Officially now: P100 15, P400 45, P500 55; P200 and P300 have no approved
  // progress (they stand at 0%) with import submissions waiting — P200 drafts
  // at 20 and 25, P300 submitted at 30 (site engineer) and 35 (PM); P400 also
  // keeps the site engineer's submitted 40.

  it("a full-programme export: a 0% row for an activity with no approved progress and a row already at the official figure are unchanged, a row without a percentage is skipped — nothing written, EV byte-identical", async () => {
    // Every figure the file carries is the activity's current official
    // figure: 0% where nothing is approved, the approved figure elsewhere.
    const programme = { P100: 15, P200: 0, P300: 0, P400: 45, P500: 55 };
    // For either person: a submit-only one and an approver alike.
    for (const token of [siteEngineer.token, live.token]) {
      const evBefore = await evReport();
      const before = await footprint();
      const preview = await upload(token, xerWith(programme), { dryRun: true });
      ok(preview);
      expect(preview.body.data).toMatchObject({ dryRun: true, matched: 5, notMatched: 0, wouldSubmit: 0, wouldApprove: 0, wouldHold: 0, wouldRefuse: 0, unchanged: 5, alreadyPending: 0, skipped: 0, supersededPending: 0 });
      const answer = await upload(token, xerWith(programme));
      ok(answer);
      expect(answer.body.data).toMatchObject({ dryRun: false, matched: 5, submitted: 0, draft: 0, approved: 0, pending: 0, unchanged: 5, alreadyPending: 0, skipped: 0, refused: 0, supersededPending: 0, updated: 0 });
      const rows = rowsByCode(answer.body.data);
      expect(rows.P200).toMatchObject({ status: "unchanged", pctComplete: 0, officialPctComplete: null, submissionId: null, reason: { code: "PROGRESS_ALREADY_OFFICIAL", message: "No approved progress yet, so the activity already stands at 0%; nothing written" } });
      expect(rows.P300).toMatchObject({ status: "unchanged", pctComplete: 0, officialPctComplete: null, submissionId: null });
      expect(rows.P100).toMatchObject({ status: "unchanged", pctComplete: 15, officialPctComplete: 15, reason: { code: "PROGRESS_ALREADY_OFFICIAL", message: "Already the official figure (15%); nothing written" } });
      // Nothing in the queue, nothing official, EV as it was.
      expect(JSON.parse(await footprint())).toEqual({ ...JSON.parse(before), documents: JSON.parse(before).documents + 1 });
      expect(await evReport()).toBe(evBefore);
    }
    expect(await prisma.progressSubmission.count({ where: { projectId: project.id, pctComplete: 0 } })).toBe(0);
    expect(await prisma.activityProgress.count({ where: { activityId: { in: Object.values(byCode) }, pctComplete: 0 } })).toBe(0);

    // A row that names the activity without a percentage is skipped with its
    // reason, for a submit-only person and for an approver alike; the others
    // are read as before.
    const before = await footprint();
    for (const token of [siteEngineer.token, live.token]) {
      const answer = await upload(token, xerWith({ ...programme, P200: null, P500: null }));
      ok(answer);
      expect(answer.body.data).toMatchObject({ matched: 5, unchanged: 3, skipped: 2, submitted: 0, approved: 0, pending: 0, refused: 0, updated: 0 });
      const rows = rowsByCode(answer.body.data);
      expect(rows.P200).toMatchObject({ status: "skipped", pctComplete: null, submissionId: null, reason: { code: "PROGRESS_PERCENT_MISSING", message: "The file names this activity without a percentage; nothing written" } });
      expect(rows.P500).toMatchObject({ status: "skipped", pctComplete: null, officialPctComplete: 55 });
      expect(answer.body.data.message).toMatch(/, 3 already official, 0 already pending, 2 skipped \(no percentage\), 0 not matched\.$/);
    }
    const preview = await upload(live.token, xerWith({ ...programme, P200: null }), { dryRun: true });
    ok(preview);
    expect(preview.body.data).toMatchObject({ dryRun: true, skipped: 1, unchanged: 4, wouldApprove: 0 });
    expect(rowsByCode(preview.body.data).P200).toMatchObject({ status: "skipped", reason: { code: "PROGRESS_PERCENT_MISSING" } });
    expect(JSON.parse(await footprint())).toEqual({ ...JSON.parse(before), documents: JSON.parse(before).documents + 2 });
  });

  it("an approver's import of a figure already pending in someone else's import submission approves that submission — through the writer, so an open hold point still leaves it pending", async () => {
    // The site engineer's new figure for P100 waits in the queue.
    const staged = await upload(siteEngineer.token, xerWith({ P100: 60, P200: 0, P300: 0, P400: 45, P500: 55 }));
    ok(staged);
    expect(staged.body.data).toMatchObject({ submitted: 1, unchanged: 4 });
    const pendingP100 = await prisma.progressSubmission.findUnique({ where: { id: rowsByCode(staged.body.data).P100.submissionId } });
    expect(pendingP100).toMatchObject({ status: "submitted", pctComplete: 60, submittedBy: siteEngineer.id });
    const pendingP300 = await prisma.progressSubmission.findFirst({ where: { activityId: byCode.P300, status: "submitted", pctComplete: 30 } });
    expect(pendingP300.submittedBy).toBe(siteEngineer.id);
    const submissionsBefore = await prisma.progressSubmission.count({ where: { projectId: project.id } });
    const progressBefore = await prisma.activityProgress.count({ where: { activityId: { in: Object.values(byCode) } } });

    // The PM's file carries the same figures: P100 60 (pending, no gate) and P300 30 (pending, hold point open).
    const file = { P100: 60, P200: 0, P300: 30, P400: 45, P500: 55 };
    const preview = await upload(live.token, xerWith(file), { dryRun: true });
    ok(preview);
    expect(preview.body.data).toMatchObject({ dryRun: true, wouldApprove: 1, wouldHold: 1, wouldRefuse: 0, unchanged: 3, alreadyPending: 0, supersededPending: 0 });
    expect(preview.body.data.message).toBe("Dry run: nothing was written. For you 1 row would be submitted and approved through the progress approval gates (1 of them already pending at the same figure, to be approved as it stands); 1 would be left pending (ITP hold point open), 0 would be refused, 3 already official, 0 already pending, 0 skipped (no percentage), 0 not matched.");
    const previewed = rowsByCode(preview.body.data);
    expect(previewed.P100).toMatchObject({ status: "approve", approvesPending: true, submissionId: pendingP100.id, waitingStatus: "submitted", superseded: null, reason: null });
    expect(previewed.P300).toMatchObject({ status: "hold", approvesPending: true, submissionId: pendingP300.id, reason: { code: "ITP_HOLD_POINT_OPEN" } });
    expect(await prisma.progressSubmission.count({ where: { projectId: project.id } })).toBe(submissionsBefore);

    const answer = await upload(live.token, xerWith(file));
    ok(answer);
    expect(answer.body.data).toMatchObject({ approved: 1, pending: 1, submitted: 0, unchanged: 3, alreadyPending: 0, refused: 0, supersededPending: 0, updated: 1 });
    expect(answer.body.data.message).toBe("1 row approved through the progress approval gates (1 of them already pending at the same figure, approved as it stood), 1 left pending (a gate refused), 0 refused, 3 already official, 0 already pending, 0 skipped (no percentage), 0 not matched.");
    const rows = rowsByCode(answer.body.data);
    expect(rows.P100).toMatchObject({ status: "approved", approvesPending: true, submissionId: pendingP100.id, pctComplete: 60, officialPctComplete: 15, reason: null });
    expect(rows.P300).toMatchObject({ status: "pending", approvesPending: true, submissionId: pendingP300.id, progressId: null, reason: { code: "ITP_HOLD_POINT_OPEN" } });

    // No second submission: the site engineer's own row is the one approved,
    // by the PM, with one ActivityProgress row and the writer's audit event.
    expect(await prisma.progressSubmission.count({ where: { projectId: project.id } })).toBe(submissionsBefore);
    expect(await prisma.progressSubmission.findUnique({ where: { id: pendingP100.id } })).toMatchObject({ status: "approved", pctComplete: 60, submittedBy: siteEngineer.id, reviewedBy: live.user.id });
    expect(await prisma.activityProgress.count({ where: { activityId: { in: Object.values(byCode) } } })).toBe(progressBefore + 1);
    expect(await prisma.activityProgress.findUnique({ where: { id: rows.P100.progressId } })).toMatchObject({ activityId: byCode.P100, submissionId: pendingP100.id, pctComplete: 60, status: "approved", approvedBy: live.user.id, source: "import" });
    const trail = await prisma.auditEvent.findMany({ where: { entityType: "progress_submission", entityId: pendingP100.id }, orderBy: { occurredAt: "asc" } });
    expect(trail.map((event) => [event.action, event.actorId])).toEqual([["created", siteEngineer.id], ["approved", live.user.id]]);
    expect(await officialPct("P100")).toEqual([60, "import", "approved"]);
    // The gate held P300: the site engineer's row still waits, nothing official.
    expect(await prisma.progressSubmission.findUnique({ where: { id: pendingP300.id } })).toMatchObject({ status: "submitted", pctComplete: 30, reviewedBy: null });
    expect(await prisma.activityProgress.count({ where: { activityId: byCode.P300 } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityType: "progress_submission", entityId: pendingP300.id, action: "approved" } })).toBe(0);
  });

  it("an approver's differing figure: a new submission is approved and the older pending one is left in the queue and reported as superseded pending, never rejected or deleted", async () => {
    // P400: official 45, the site engineer's 40 still submitted.
    const older = await prisma.progressSubmission.findFirst({ where: { activityId: byCode.P400, status: "submitted", pctComplete: 40 } });
    expect(older.submittedBy).toBe(siteEngineer.id);
    const olderRow = JSON.stringify(older);
    const submissionsBefore = await prisma.progressSubmission.count({ where: { projectId: project.id } });

    const file = { P100: 60, P200: 0, P300: 0, P400: 70, P500: 55 };
    const preview = await upload(live.token, xerWith(file), { dryRun: true });
    ok(preview);
    expect(preview.body.data).toMatchObject({ wouldApprove: 1, unchanged: 4, supersededPending: 1 });
    expect(rowsByCode(preview.body.data).P400).toMatchObject({ status: "approve", approvesPending: false, submissionId: null, superseded: { submissionId: older.id, pctComplete: 40 } });

    const answer = await upload(live.token, xerWith(file));
    ok(answer);
    const data = answer.body.data;
    expect(data).toMatchObject({ approved: 1, pending: 0, unchanged: 4, alreadyPending: 0, supersededPending: 1, updated: 1 });
    expect(data.message).toBe("1 row approved through the progress approval gates, 0 left pending (a gate refused), 0 refused, 4 already official, 0 already pending, 0 skipped (no percentage), 0 not matched. 1 older pending import submission at another figure left in the approval queue (superseded pending) — reject it there.");
    expect(data.supersededPendingSubmissions).toEqual([{ activityId: byCode.P400, p6ActivityId: "P400", name: "Pour (quantity method)", submissionId: older.id, pctComplete: 40, importedPctComplete: 70 }]);
    const row = rowsByCode(data).P400;
    expect(row).toMatchObject({ status: "approved", pctComplete: 70, officialPctComplete: 45, approvesPending: false, superseded: { submissionId: older.id, pctComplete: 40 } });
    expect(row.submissionId).not.toBe(older.id);
    // The new figure is official through a new submission; the older one is byte-identical.
    expect(await prisma.progressSubmission.count({ where: { projectId: project.id } })).toBe(submissionsBefore + 1);
    expect(await prisma.progressSubmission.findUnique({ where: { id: row.submissionId } })).toMatchObject({ status: "approved", pctComplete: 70, submittedBy: live.user.id, reviewedBy: live.user.id });
    expect(JSON.stringify(await prisma.progressSubmission.findUnique({ where: { id: older.id } }))).toBe(olderRow);
    // Official 70; the activity still says a submission waits — the superseded one, for the PM to reject.
    expect(await officialPct("P400")).toEqual([70, "import", "submitted"]);
    // The submit-only person, with the same figure now official: unchanged; the queue is not touched.
    const again = await upload(siteEngineer.token, xerWith(file));
    ok(again);
    expect(again.body.data).toMatchObject({ unchanged: 5, submitted: 0, supersededPending: 0 });
    expect(JSON.stringify(await prisma.progressSubmission.findUnique({ where: { id: older.id } }))).toBe(olderRow);
  });
});
