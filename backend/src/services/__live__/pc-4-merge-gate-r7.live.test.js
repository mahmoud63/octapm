/**
 * PC-4 merge gate, round 7 — the D5 sweep: every refusal and next step on
 * the schedule approval and baseline path names the action that resolves it
 * and a page that offers it, for every state a revision can be in. Proven
 * against a real API process and the real local Postgres, through the
 * product's own API; the matrix it walks is the one in
 * docs/project-controls/OCTAPM_PROJECT_SETUP_FLOW.md §8.
 *
 * The finding it closes: a staged revision (imported, not activated) whose
 * own logic failed was refused approval with "(Schedule › Gantt)" — a page
 * that shows only ACTIVE activities, empty in greenfield — and the review
 * panel said only "clear readiness blockers". No page edits a staged
 * revision: its fix is the corrected import (or regeneration), or the
 * rejection. An active revision's fix is the Gantt's edit or Recalculate
 * CPM; the read-only Critical Path tab is never named.
 *
 * Also here: the stale activation (REVISION_ALREADY_ACTIVE), the revision
 * staged beside a baselined one (reviewed on the Schedule page and named by
 * the setup readiness), the workspace home's official cutoff (an EV cutoff,
 * never a data date), and the lifecycle validation refusals in words.
 *
 * The greenfield walk starts with the no-bill refusal (BOQ_REQUIRED_FOR_BASELINE,
 * owner decision 2026-09-28), then enters a one-row bill through the BOQ API
 * and maps it once the revision is active, so every later state is judged on
 * the schedule alone.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards; the only writes outside the API are to its own rows.
 *
 *   npm run test:live -- src/services/__live__/pc-4-merge-gate-r7.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { REVISION_NOT_ACTIVATED_MESSAGE } = require("../schedule.service");

/** A two-activity XER; with `linked`, an FS link between them. */
const xer = ({ linked }) =>
  [
    "ERMHDR\t19.12",
    "%T\tPROJWBS",
    "%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num",
    "%R\tW1\t\tCIV\tCivil\t1",
    "%T\tTASK",
    "%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct",
    "%R\tT1\tG100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0",
    "%R\tT2\tG200\tPour\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0",
    ...(linked
      ? ["%T\tTASKPRED", "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt", "%R\tP1\tT2\tT1\tPR_FS\t0"]
      : []),
    "%E",
    "",
  ].join("\n");

// The words of the matrix (§8 of the setup-flow doc).
const STAGED_FIX_REVIEW =
  "A staged revision cannot be edited: correct the schedule at its source and import it again, or regenerate it from the BOQ (Schedule › Update Schedule) — the new revision replaces this one, or reject this revision (Schedule Review).";
const STAGED_FIX_DRAFT =
  "A staged revision cannot be edited: correct the schedule at its source and import it again, or regenerate it from the BOQ (Schedule › Update Schedule) — the new revision replaces this one.";
const NO_LINK = "Predecessor logic — at least one predecessor relationship is required";
const NOT_READY_STAGED = `Schedule readiness checks must pass before approval: ${NO_LINK}. ${STAGED_FIX_REVIEW}`;
const NOT_READY_ACTIVE_APPROVAL = `Schedule readiness checks must pass before approval: ${NO_LINK} (Schedule › Gantt › Edit).`;
const NOT_READY_ACTIVE_BASELINE = `Schedule readiness checks must pass before baseline lock: ${NO_LINK} (Schedule › Gantt › Edit).`;
const GANTT_FIX_TEXT =
  "Add or correct the activities' predecessor links on Schedule › Gantt › Edit (open an activity, Relationship Grid).";
// Places that cannot resolve a staged revision's blocker — or anything.
const DEAD_ENDS = /Schedule › Critical Path|Schedule › Activities|\(Schedule › Gantt\)/;

liveDescribe("PC-4 merge gate round 7: every approval and baseline refusal names a step a page offers (D5 sweep)", () => {
  let live;
  let homeOrg;
  let api;
  const auth = () => ({ authorization: `Bearer ${live.token}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    // The workspace home aggregates every project of its organisation: its
    // test has an organisation of its own, with the one project it reads.
    homeOrg = await createLiveOrg(prisma);
    api = await startApi({
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      RATE_LIMIT_UPLOAD_MAX: "1000",
      DATABASE_CONNECTION_LIMIT: "4",
    });
  });

  afterAll(async () => {
    if (api) await api.stop();
    for (const org of [live, homeOrg]) {
      if (!org) continue;
      for (const model of ["projectDocument", "backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: org.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, org.org.id);
    }
    await prisma.$disconnect();
  });

  const newProject = async (name, extra = {}, owner = null) => {
    const who = owner || live;
    const auth = () => ({ authorization: `Bearer ${who.token}` });
    const project = await prisma.project.create({
      data: {
        orgId: who.org.id,
        currency: "USD",
        name: `LiveTest r7 ${name}`,
        startDate: new Date("2026-01-05"),
        endDate: new Date("2027-12-17"),
        ...extra,
      },
    });
    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    const post = async (route, body, expected = 200) => {
      const response = await api.post(at(route), body, auth());
      expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
      return response.body.data;
    };
    const refused = async (route, body = {}) => {
      const response = await api.post(at(route), body, auth());
      return { status: response.status, code: response.body?.error?.code, message: response.body?.error?.message };
    };
    const get = async (route) => {
      const response = await api.get(at(route), auth());
      expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
      return response.body.data;
    };
    const setup = () => get("/setup-readiness");
    const importXer = async (linked) => {
      const form = new FormData();
      form.append("file", new Blob([xer({ linked })], { type: "application/octet-stream" }), "schedule.xer");
      const response = await fetch(`${api.base}${at("/import/xer")}`, { method: "POST", headers: auth(), body: form });
      const body = await response.json();
      expect([response.status, body?.error, body?.data?.staged]).toEqual([201, undefined, true]);
      return body.data.revisionId;
    };
    // The bill, entered by hand through the BOQ API: no baseline is locked
    // without one (owner decision 2026-09-28, BOQ_REQUIRED_FOR_BASELINE).
    const enterBill = async () =>
      (await post("/boq/items", { code: "1.1", description: "Excavation", quantity: 10, unit: "m3", rate: 100 }, 201)).item;
    // ... and its value mapped to the first active activity, approved: the
    // coverage the lock needs once the revision is active (D5).
    const mapBill = async (item) => {
      const [first] = await prisma.activity.findMany({ where: { projectId: project.id, isActive: true }, orderBy: { sortOrder: "asc" } });
      const allocation = await post("/activity-boq-allocations", { boqItemId: item.id, activityId: first.id, quantity: 10 }, 201);
      for (const step of ["submit", "approve"]) await post(`/activity-boq-allocations/${allocation.id}/${step}`, {});
    };
    return { project, at, auth, post, refused, get, setup, importXer, enterBill, mapBill };
  };

  const stepOf = (readiness, key) => readiness.steps.find((step) => step.key === key);
  const checkOf = (readiness, key) => readiness.checks.find((check) => check.key === key);
  const blockerOf = (readiness, stepKey, code) => (stepOf(readiness, stepKey).blockers || []).find((row) => row.code === code);
  // No refusal or step in the whole walk names a page that cannot act.
  const seen = [];
  const noDeadEnd = (label, text) => {
    seen.push([label, text]);
    expect([label, DEAD_ENDS.test(String(text || ""))]).toEqual([label, false]);
  };
  const walkSetup = (label, readiness) => {
    for (const step of readiness.steps.filter((row) => ["schedule_approval", "baseline_readiness", "boq_allocation"].includes(row.key))) {
      for (const row of [...(step.blockers || []), ...(step.advisories || [])]) noDeadEnd(`${label} ${step.key} ${row.code}`, row.message);
    }
  };

  it("walks a greenfield project through every revision state: each refusal and next step names the action that resolves it and the page that offers it", async () => {
    const built = await newProject("greenfield walk");

    // ── No bill: the BOQ is the first step, named before the schedule
    // (owner decision 2026-09-28). The walk then goes on with a bill.
    expect(await built.refused("/schedule/baseline")).toEqual({
      status: 400,
      code: "BOQ_REQUIRED_FOR_BASELINE",
      message: "BOQ required before baseline lock: upload the BOQ (BOQ page), then map it to the schedule and lock the baseline.",
    });
    const item = await built.enterBill();

    // ── No revision: the Schedule page imports or generates one.
    const none = await built.refused("/schedule/baseline");
    expect(none).toEqual({
      status: 404,
      code: "REVISION_NOT_FOUND",
      message: "No schedule revision exists yet: import a P6/MSP schedule or generate one from the BOQ on the Schedule page.",
    });
    const empty = await built.setup();
    // The gates carry this blocker as the base derived it; its page — any
    // Schedule tab — shows the upload zone (import or generate) until a
    // revision exists.
    expect(blockerOf(empty, "schedule_approval", "NO_SCHEDULE_REVISION").message).toBe("No schedule revision is available.");
    expect(stepOf(empty, "schedule_approval").action).toEqual({ label: "Open Review", target: { module: "schedule", child: "revisions" } });
    expect(stepOf(empty, "baseline_readiness").action).toEqual({ label: "Lock Baseline", target: { module: "schedule", child: "revisions" } });
    walkSetup("no revision", empty);

    // ── Staged draft, its own logic failing (an XER with no relationships).
    const failing = await built.importXer(false);
    const draftSchedule = await built.get("/schedule");
    expect(draftSchedule.revision).toMatchObject({ id: failing, isActive: false, status: "draft" });
    expect(draftSchedule.activities).toEqual([]);
    expect(draftSchedule.candidateRevision).toBeNull();
    expect(checkOf(draftSchedule.revision.readiness, "predecessors")).toMatchObject({
      passed: false,
      fix: {
        where: "Schedule › Update Schedule",
        inline: false,
        permission: "schedule.create",
        next: "import a corrected schedule or regenerate it (Schedule › Update Schedule)",
        text: STAGED_FIX_DRAFT,
      },
    });
    const draftSetup = await built.setup();
    expect(blockerOf(draftSetup, "schedule_approval", "NO_APPROVED_SCHEDULE").message).toBe(
      `The schedule revision fails its own checks (Predecessor logic). ${STAGED_FIX_DRAFT}`,
    );
    expect(stepOf(draftSetup, "schedule_approval").action).toEqual({ label: "Open Review", target: { module: "schedule", child: "revisions" } });
    walkSetup("staged draft", draftSetup);
    expect(await built.refused(`/schedule/revisions/${failing}/approve`)).toEqual({
      status: 409,
      code: "INVALID_REVISION_STATUS",
      message: "This schedule revision is now Draft; it must be Under review before it can be approved. Refresh to see its current status.",
    });
    expect(await built.refused(`/schedule/revisions/${failing}/baseline`)).toEqual({
      status: 409,
      code: "INVALID_REVISION_STATUS",
      message: "This schedule revision is now Draft; it must be Approved before it can be baselined. Refresh to see its current status.",
    });

    // ── Staged, under review: the approval is refused with the corrected
    // import or the rejection — never the Gantt, empty in greenfield.
    await built.post(`/schedule/revisions/${failing}/submit-review`, {});
    const notReady = await built.refused(`/schedule/revisions/${failing}/approve`);
    expect(notReady).toEqual({ status: 400, code: "SCHEDULE_NOT_READY", message: NOT_READY_STAGED });
    noDeadEnd("staged approve", notReady.message);
    const reviewSchedule = await built.get("/schedule");
    expect(checkOf(reviewSchedule.revision.readiness, "predecessors").fix).toMatchObject({
      next: "import a corrected schedule or regenerate it (Schedule › Update Schedule), or reject this revision (Schedule Review)",
      text: STAGED_FIX_REVIEW,
    });
    const reviewSetup = await built.setup();
    expect(blockerOf(reviewSetup, "schedule_approval", "NO_APPROVED_SCHEDULE").message).toBe(
      `The schedule revision fails its own checks (Predecessor logic). ${STAGED_FIX_REVIEW}`,
    );
    walkSetup("staged under review", reviewSetup);

    // ── Rejected: the corrected import, or a resubmission.
    await built.post(`/schedule/revisions/${failing}/reject`, { reason: "LiveTest r7: no logic" });
    expect(await built.refused(`/schedule/revisions/${failing}/approve`)).toMatchObject({
      status: 409,
      code: "INVALID_REVISION_STATUS",
      message: "This schedule revision is now Rejected; it must be Under review before it can be approved. Refresh to see its current status.",
    });
    const rejectedSetup = await built.setup();
    expect(blockerOf(rejectedSetup, "schedule_approval", "NO_APPROVED_SCHEDULE").message).toBe(
      `The schedule revision fails its own checks (Predecessor logic). ${STAGED_FIX_DRAFT}`,
    );
    walkSetup("staged rejected", rejectedSetup);

    // ── The corrected import: a new staged draft; the rejected one is no
    // longer current.
    const revisionId = await built.importXer(true);
    expect(await built.refused(`/schedule/revisions/${failing}/submit-review`)).toEqual({
      status: 409,
      code: "REVISION_NOT_CURRENT",
      message:
        "This schedule revision is no longer current: only the active revision or the latest staged revision can move through review and baseline. Refresh to see the current revision (Schedule › Revisions).",
    });
    const cleanDraft = await built.setup();
    expect(blockerOf(cleanDraft, "schedule_approval", "NO_APPROVED_SCHEDULE").message).toBe(
      "Submit the schedule revision for review, then approve it (Schedule Review, on Schedule › Revisions).",
    );
    await built.post(`/schedule/revisions/${revisionId}/submit-review`, {});
    const cleanReview = await built.setup();
    expect(blockerOf(cleanReview, "schedule_approval", "NO_APPROVED_SCHEDULE").message).toBe(
      "Approve or reject the schedule revision under review (Schedule Review, on Schedule › Revisions).",
    );

    // ── Approved, staged: the activation, on Schedule › Revisions.
    await built.post(`/schedule/revisions/${revisionId}/approve`, {});
    expect(await built.refused(`/schedule/revisions/${revisionId}/baseline`)).toEqual({
      status: 409,
      code: "REVISION_NOT_ACTIVATED",
      message: REVISION_NOT_ACTIVATED_MESSAGE,
    });
    const approvedSetup = await built.setup();
    expect(stepOf(approvedSetup, "baseline_readiness").action).toEqual({ label: "Activate Revision", target: { module: "schedule", child: "revisions" } });
    walkSetup("staged approved", approvedSetup);

    // ── Activated. A second activation (the dialog left open while it was
    // activated elsewhere) is told where the revision stands.
    await built.post(`/schedule/revisions/${revisionId}/activate`, { mappings: [] });
    expect(await built.refused(`/schedule/revisions/${revisionId}/activate`, { mappings: [] })).toEqual({
      status: 409,
      code: "REVISION_ALREADY_ACTIVE",
      message:
        "This schedule revision is already active. Refresh Schedule › Revisions — the next step is to map the BOQ to its activities (Project Controls › Mapping) and lock the baseline.",
    });
    // The step it names: the bill mapped to the active activities (D5).
    await built.mapBill(item);
    const readyToLock = await built.setup();
    expect(stepOf(readyToLock, "baseline_readiness").action).toEqual({ label: "Lock Baseline", target: { module: "schedule", child: "revisions" } });

    // ── Active and approved, its logic broken behind the page (the link
    // removed on the Gantt): the baseline names the Gantt's edit — it edits
    // the active activities, which are this revision's now.
    const [g100, g200] = await prisma.activity.findMany({
      where: { projectId: built.project.id, isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    const unlink = await api.request("PATCH", built.at(`/activities/${g200.id}`), { body: { dependencies: [] }, headers: auth() });
    expect([unlink.status, unlink.body?.error]).toEqual([200, undefined]);
    const broken = await built.refused(`/schedule/revisions/${revisionId}/baseline`);
    expect(broken).toEqual({ status: 400, code: "SCHEDULE_NOT_READY", message: NOT_READY_ACTIVE_BASELINE });
    const brokenSetup = await built.setup();
    expect(blockerOf(brokenSetup, "baseline_readiness", "SCHEDULE_PREDECESSORS_FAILED").message).toBe(
      `At least one predecessor relationship is required. ${GANTT_FIX_TEXT}`,
    );
    expect(stepOf(brokenSetup, "baseline_readiness").action).toEqual({ label: "Correct the Schedule", target: { module: "schedule", child: "gantt" } });
    walkSetup("active approved, logic broken", brokenSetup);
    const relink = await api.request("PATCH", built.at(`/activities/${g200.id}`), {
      body: { dependencies: [{ predecessorId: g100.id, relationshipType: "FS", lagDays: 0 }] },
      headers: auth(),
    });
    expect([relink.status, relink.body?.error]).toEqual([200, undefined]);

    // ── Baselined: a second lock says a new baseline needs a new revision.
    const locked = await built.post(`/schedule/revisions/${revisionId}/baseline`, {});
    expect(locked.revision.status).toBe("baselined");
    expect(await built.refused(`/schedule/revisions/${revisionId}/baseline`)).toEqual({
      status: 409,
      code: "INVALID_REVISION_STATUS",
      message:
        "This schedule revision's baseline is already locked. A new baseline comes from a new revision: import or generate one (Schedule › Update Schedule), take it through review and activation, then lock its baseline. Refresh to see its current status.",
    });
    expect(await built.refused(`/schedule/revisions/${revisionId}/activate`, { mappings: [] })).toEqual({
      status: 409,
      code: "REVISION_ALREADY_ACTIVE",
      message: "This schedule revision is already active and its baseline is locked. Refresh Schedule › Revisions to see where it stands.",
    });

    // ── A revision staged beside the baselined one: the Schedule page
    // carries it with its own review, and the setup readiness names it.
    const beside = await built.importXer(false);
    const besideSchedule = await built.get("/schedule");
    expect(besideSchedule.revision).toMatchObject({ id: revisionId, isActive: true, status: "baselined" });
    expect(besideSchedule.candidateRevision).toMatchObject({ id: beside, isActive: false, status: "draft" });
    expect(checkOf(besideSchedule.candidateRevision.readiness, "predecessors").fix.text).toBe(STAGED_FIX_DRAFT);
    const besideSetup = await built.setup();
    const pending = (stepOf(besideSetup, "schedule_approval").advisories || []).find((row) => row.code === "STAGED_REVISION_PENDING");
    expect(pending).toMatchObject({
      severity: "advisory",
      message: `A newer schedule revision, "XER Import", is staged beside the active schedule and replaces it only once it is approved and activated. The schedule revision fails its own checks (Predecessor logic). ${STAGED_FIX_DRAFT}`,
    });
    expect(pending.items[0]).toMatchObject({ type: "schedule_revision", id: beside, missing: "Review" });
    expect(stepOf(besideSetup, "schedule_approval").status).toBe("complete");
    walkSetup("staged beside baselined", besideSetup);
    await built.post(`/schedule/revisions/${beside}/submit-review`, {});
    const besideRefusal = await built.refused(`/schedule/revisions/${beside}/approve`);
    expect(besideRefusal).toEqual({ status: 400, code: "SCHEDULE_NOT_READY", message: NOT_READY_STAGED });
    expect(await built.refused(`/schedule/revisions/${beside}/rollback`, { reason: "LiveTest r7" })).toEqual({
      status: 409,
      code: "REVISION_NOT_ACTIVE",
      message: "Only the active schedule revision can be rolled back, and this one is not active. Refresh Schedule › Revisions to see which revision is active.",
    });
    for (const [label, text] of seen) expect([label, typeof text]).toEqual([label, "string"]);
  });

  it("an active revision that is not approved yet (recorded before staging) is sent to the Gantt's edit, where its activities are", async () => {
    const built = await newProject("legacy active draft");
    const make = (code, sortOrder) =>
      prisma.activity.create({
        data: {
          projectId: built.project.id,
          name: `LiveTest ${code}`,
          activityCode: code,
          duration: 5,
          earlyStart: sortOrder * 5,
          earlyFinish: sortOrder * 5 + 5,
          lateStart: sortOrder * 5,
          lateFinish: sortOrder * 5 + 5,
          totalFloat: 0,
          isCritical: true,
          sortOrder,
          startDate: new Date(`2026-02-0${2 + sortOrder}`),
          endDate: new Date(`2026-02-1${2 + sortOrder}`),
        },
      });
    await make("L100", 0);
    await make("L200", 1);
    const revision = await prisma.scheduleRevision.create({
      data: { projectId: built.project.id, label: "Legacy", source: "manual", status: "draft", isActive: true, activityCount: 2, criticalCount: 2, activatedAt: new Date() },
    });
    const schedule = await built.get("/schedule");
    expect(checkOf(schedule.revision.readiness, "predecessors").fix).toMatchObject({
      where: "Schedule › Gantt › Edit",
      inline: true,
      permission: "schedule.update",
      text: GANTT_FIX_TEXT,
    });
    const setup = await built.setup();
    expect(blockerOf(setup, "schedule_approval", "NO_APPROVED_SCHEDULE").message).toBe(
      `The schedule revision fails its own checks (Predecessor logic). ${GANTT_FIX_TEXT}`,
    );
    walkSetup("active draft", setup);
    await built.post(`/schedule/revisions/${revision.id}/submit-review`, {});
    const refusal = await built.refused(`/schedule/revisions/${revision.id}/approve`);
    expect(refusal).toEqual({ status: 400, code: "SCHEDULE_NOT_READY", message: NOT_READY_ACTIVE_APPROVAL });
    noDeadEnd("active approve", refusal.message);
  });

  it("the lifecycle's validation refusals say what is wrong, in words, and a body that is not JSON says so", async () => {
    const built = await newProject("validation");
    const revisionId = await built.importXer(true);
    const long = "x".repeat(2100);
    expect(await built.refused(`/schedule/revisions/${revisionId}/approve`, { comment: long })).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "The approval comment can be at most 2,000 characters.",
    });
    expect(await built.refused(`/schedule/revisions/${revisionId}/submit-review`, { comment: long })).toMatchObject({
      message: "The review comment can be at most 2,000 characters.",
    });
    expect(await built.refused(`/schedule/revisions/${revisionId}/baseline`, { comment: long })).toMatchObject({
      message: "The baseline comment can be at most 2,000 characters.",
    });
    expect(await built.refused(`/schedule/revisions/${revisionId}/activate`, { mappings: [], unmappedRemovals: "x" })).toMatchObject({
      status: 400,
      message: 'Send "unmappedRemovals" as a list: one { oldActivityId, reason } for each active activity this revision leaves out.',
    });
    expect(await built.refused("/schedule/revisions/not-a-uuid/approve")).toMatchObject({
      status: 400,
      message: "The schedule revision id is not valid: refresh Schedule › Revisions and try again.",
    });
    expect(await built.refused("/boq/revisions/not-a-uuid/approve")).toMatchObject({
      status: 400,
      message: "The BOQ revision id is not valid: refresh the BOQ page and try again.",
    });
    const malformed = await fetch(`${api.base}${built.at(`/schedule/revisions/${revisionId}/approve`)}`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: "{bad",
    });
    const body = await malformed.json();
    expect([malformed.status, body.error.code, body.error.message]).toEqual([400, "VALIDATION_ERROR", "The request body is not valid JSON."]);
  });

  it("the workspace home's official cutoff is the latest EV cutoff, stated with its zone — never a project's data date", async () => {
    // A data date far ahead, and a reporting period whose cutoff has passed:
    // the home's official cutoff is that period's (the EV report's default
    // basis, D4), in the zone it ends in (UTC here), not the data date.
    const built = await newProject("home cutoff", { dataDate: new Date("2026-12-31T00:00:00.000Z") }, homeOrg);
    await built.post("/reports/periods", { code: "P08", periodStart: "2026-08-01", periodEnd: "2026-08-31", cutoffDate: "2026-08-31" }, 201);
    const ev = await built.get("/reports/ev");
    expect(ev.reporting.cutoffDate).toBe("2026-08-31T23:59:59.999Z");
    const home = await api.get("/api/v1/projects/workspace-dashboard", built.auth());
    expect([home.status, home.body?.error]).toEqual([200, undefined]);
    expect(home.body.data.dataFreshness).toMatchObject({
      cutoffDate: "2026-08-31T23:59:59.999Z",
      cutoffLocalDate: "2026-08-31",
      cutoffTimeZone: "UTC",
      cutoffTimeZoneSource: "utc",
      cutoffTimeZoneNote: "Project timezone is not configured; UTC is being used",
    });
    for (const kpi of home.body.data.officialKpis) expect([kpi.key, kpi.cutoffDate]).toEqual([kpi.key, "2026-08-31T23:59:59.999Z"]);
  });
});
