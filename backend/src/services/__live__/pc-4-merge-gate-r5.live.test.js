/**
 * PC-4 merge gate, round 5 — the schedule lifecycle's refusals name the step
 * to take next, proven against a real API process and the real local
 * Postgres.
 *
 *   1. An approved revision that is still staged (an XER import approved
 *      but not activated) is refused a baseline with 409
 *      REVISION_NOT_ACTIVATED — "activate it on Schedule › Revisions" — and
 *      the setup readiness says the same: its baseline step's one blocker is
 *      the activation, its allocation step says to activate rather than to
 *      "generate or import a schedule", and neither says "No schedule
 *      activities exist". Once activated, the baseline locks.
 *   2. With an older revision active, an approved staged revision's
 *      baseline is refused the same way and writes nothing: before, it
 *      copied the ACTIVE revision's dates as baseline and marked the staged
 *      revision baselined. A revision a newer import superseded is refused
 *      with REVISION_NOT_CURRENT, which says to refresh and where.
 *   3. Reject and rollback without a reason, and activate without mappings,
 *      are refused with the reason itself as the message — in production
 *      too, where the details are dropped — never a bare "Validation failed".
 *
 * Projects 1 and 2 carry a one-row bill entered through the BOQ API: a
 * project with no BOQ is refused every baseline with BOQ_REQUIRED_FOR_BASELINE
 * before any schedule step (owner decision 2026-09-28; its own file is
 * pc-4-baseline-needs-boq), and project 1 maps it before the lock (D5).
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards; the only writes outside the API are to its own rows.
 *
 *   npm run test:live -- src/services/__live__/pc-4-merge-gate-r5.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { REVISION_NOT_ACTIVATED_MESSAGE } = require("../schedule.service");

const PRODUCTION = {
  NODE_ENV: "production",
  CORS_ALLOWED_ORIGINS: "https://app.octapm-live.test",
  REQUEST_LOG_FORMAT: "off",
  CLOUDFRONT_SHARED_SECRET: "",
};

/** A two-activity XER (an FS link between them), codes prefixed by `tag`. */
const xerFile = (tag) =>
  [
    "ERMHDR\t19.12",
    "%T\tPROJWBS",
    "%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num",
    "%R\tW1\t\tCIV\tCivil\t1",
    "%T\tTASK",
    "%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct",
    `%R\tT1\t${tag}100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0`,
    `%R\tT2\t${tag}200\tFrame\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0`,
    "%T\tTASKPRED",
    "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt",
    "%R\tP1\tT2\tT1\tPR_FS\t0",
    "%E",
    "",
  ].join("\n");

liveDescribe("PC-4 merge gate round 5: the schedule lifecycle names the next step", () => {
  let live;
  let api;
  const auth = () => ({ authorization: `Bearer ${live.token}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      DATABASE_CONNECTION_LIMIT: "4",
    });
  });

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

  const newProject = async (name) => {
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest r5 ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    const post = async (route, body, expected = 200) => {
      const response = await api.post(at(route), body, auth());
      expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
      return response.body.data;
    };
    const refused = async (route, body) => {
      const response = await api.post(at(route), body, auth());
      return { status: response.status, code: response.body?.error?.code, message: response.body?.error?.message };
    };
    const get = async (route) => {
      const response = await api.get(route.startsWith("/api/") ? route : at(route), auth());
      expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
      return response.body.data;
    };
    const importXer = async (tag) => {
      const form = new FormData();
      form.append("file", new Blob([xerFile(tag)], { type: "application/octet-stream" }), `${tag}.xer`);
      const response = await fetch(`${api.base}${at("/import/xer")}`, { method: "POST", headers: auth(), body: form });
      const imported = await response.json();
      expect([response.status, imported.error]).toEqual([201, undefined]);
      expect(imported.data).toMatchObject({ staged: true, imported: 2 });
      expect(typeof imported.data.revisionId).toBe("string");
      return imported.data.revisionId;
    };
    const approve = async (revisionId) => {
      await post(`/schedule/revisions/${revisionId}/submit-review`, {});
      await post(`/schedule/revisions/${revisionId}/approve`, {});
    };
    const setup = () => get(`/api/v1/projects/${project.id}/setup-readiness`);
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
    return { project, at, post, refused, get, importXer, approve, setup, enterBill, mapBill };
  };

  const stepOf = (readiness, key) => readiness.steps.find((step) => step.key === key);
  const everyMessage = (readiness) =>
    [
      ...readiness.steps.flatMap((step) => [...(step.blockers || []), ...(step.warnings || [])].map((row) => row.message)),
      ...(readiness.gates.baseline.blockers || []).map((row) => row.message),
      readiness.gates.baseline.message,
    ].join(" | ");

  it("1. approved but not activated: the baseline refusal and the setup readiness say to activate on Schedule › Revisions; once activated, the baseline locks", async () => {
    const built = await newProject("staged approved");
    const item = await built.enterBill();
    const revisionId = await built.importXer("A");
    await built.approve(revisionId);
    expect(await prisma.activity.count({ where: { projectId: built.project.id, isActive: true } })).toBe(0);

    // The setup readiness: the one baseline blocker is the activation.
    const before = await built.setup();
    const baselineStep = stepOf(before, "baseline_readiness");
    expect(baselineStep.blockers.map((row) => [row.code, row.message])).toEqual([
      ["REVISION_NOT_ACTIVATED", REVISION_NOT_ACTIVATED_MESSAGE],
    ]);
    expect(baselineStep.blockers[0].items.map((item) => [item.type, item.id, item.missing])).toEqual([
      ["schedule_revision", revisionId, "Activation"],
    ]);
    expect(baselineStep.action.label).toBe("Activate Revision");
    expect(before.gates.baseline).toMatchObject({
      ready: false,
      message: "Activate the approved schedule revision (Schedule › Revisions) before locking the baseline.",
    });
    expect(before.gates.baseline.blockers.map((row) => row.code)).toContain("REVISION_NOT_ACTIVATED");
    const waiting = stepOf(before, "boq_allocation").blockers.find((row) => row.code === "ALLOCATION_WAITING_FOR_SCHEDULE");
    expect(waiting.message).toBe("Activate the approved schedule revision (Schedule › Revisions) before mapping allocations to its activities.");
    const said = everyMessage(before);
    expect(said).not.toContain("No schedule activities exist");
    expect(said).not.toContain("Generate or import a schedule");
    expect(said).not.toContain("Schedule is ready for baseline lock");

    // The server refuses the baseline with the step to take — both routes.
    for (const [route, body] of [[`/schedule/revisions/${revisionId}/baseline`, {}], ["/schedule/baseline", {}]]) {
      expect(await built.refused(route, body)).toEqual({ status: 409, code: "REVISION_NOT_ACTIVATED", message: REVISION_NOT_ACTIVATED_MESSAGE });
    }
    expect((await prisma.scheduleRevision.findUnique({ where: { id: revisionId } })).status).toBe("approved");

    // Activated (and the bill mapped to it, D5), the refusal is gone and the
    // baseline locks its two activities.
    await built.post(`/schedule/revisions/${revisionId}/activate`, { mappings: [] });
    await built.mapBill(item);
    const after = await built.setup();
    expect(everyMessage(after)).not.toContain(REVISION_NOT_ACTIVATED_MESSAGE);
    expect(stepOf(after, "baseline_readiness").action.label).toBe("Lock Baseline");
    const locked = await built.post(`/schedule/revisions/${revisionId}/baseline`, {});
    expect(locked.locked).toBe(2);
    expect(locked.revision.status).toBe("baselined");
  });

  it("2. with an older revision active, a staged approved revision's baseline is refused and writes nothing; a superseded one is told to refresh", async () => {
    const built = await newProject("active and staged");
    await built.enterBill();
    const first = await built.importXer("A");
    await built.approve(first);
    await built.post(`/schedule/revisions/${first}/activate`, { mappings: [] });
    const activeIds = (await prisma.activity.findMany({ where: { projectId: built.project.id, isActive: true }, select: { id: true } })).map((row) => row.id);
    expect(activeIds).toHaveLength(2);

    const second = await built.importXer("B");
    expect(second).not.toBe(first);
    await built.approve(second);
    expect(await built.refused(`/schedule/revisions/${second}/baseline`, {})).toEqual({
      status: 409,
      code: "REVISION_NOT_ACTIVATED",
      message: REVISION_NOT_ACTIVATED_MESSAGE,
    });
    // Nothing written: the active activities carry no baseline, the staged
    // revision is still approved.
    const activeRows = await prisma.activity.findMany({ where: { id: { in: activeIds } }, select: { baselineStart: true, baselineFinish: true } });
    expect(activeRows).toEqual([
      { baselineStart: null, baselineFinish: null },
      { baselineStart: null, baselineFinish: null },
    ]);
    expect((await prisma.scheduleRevision.findUnique({ where: { id: second } })).status).toBe("approved");

    // A newer import supersedes the approved staged revision: a stale page's
    // step on it is told to refresh, and where the current revision is.
    const third = await built.importXer("C");
    expect(third).not.toBe(second);
    const stale = await built.refused(`/schedule/revisions/${second}/baseline`, {});
    expect(stale).toEqual({
      status: 409,
      code: "REVISION_NOT_CURRENT",
      message:
        "This schedule revision is no longer current: only the active revision or the latest staged revision can move through review and baseline. Refresh to see the current revision (Schedule › Revisions).",
    });
  });

  const expectReasons = async (server, projectId, headers, production) => {
    const unknownRevision = crypto.randomUUID();
    const at = (step) => `/api/v1/projects/${projectId}/schedule/revisions/${unknownRevision}/${step}`;
    const cases = [
      ["reject", {}, "A rejection reason is required."],
      ["reject", { reason: "   " }, "A rejection reason is required."],
      ["reject", { reason: "x".repeat(2001) }, "The rejection reason can be at most 2,000 characters."],
      ["rollback", { reason: "" }, "A rollback reason is required."],
      ["rollback", {}, "A rollback reason is required."],
      [
        "activate",
        {},
        'Activation needs the activity mappings: send "mappings" as a list pairing each active activity with its activity in this revision (an empty list when no schedule is active yet).',
      ],
      [
        "activate",
        { mappings: [{ oldActivityId: "old-1" }] },
        "Each activity mapping needs both the active activity (oldActivityId) and its activity in this revision (newActivityKey).",
      ],
    ];
    for (const [step, body, message] of cases) {
      const response = await server.post(at(step), body, headers);
      expect([step, body, response.status, response.body?.error?.code, response.body?.error?.message]).toEqual([
        step,
        body,
        400,
        "VALIDATION_ERROR",
        message,
      ]);
      if (production) expect(response.body.error.details).toBeUndefined();
    }
  };

  it("3. reject, rollback and activate refusals give the reason, not a bare 'Validation failed' — in development and in production", async () => {
    const built = await newProject("validation reasons");
    await expectReasons(api, built.project.id, auth(), false);
    const production = await startApi({ ...PRODUCTION, DATABASE_CONNECTION_LIMIT: "2" }, { appOnly: true });
    try {
      await expectReasons(production, built.project.id, auth(), true);
    } finally {
      await production.stop();
    }
  });
});
