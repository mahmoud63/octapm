/**
 * Owner decision (2026-09-28): in integrated Project Controls the SERVER
 * refuses a schedule baseline lock on a project with no BOQ. The steps run
 * project structure -> BOQ -> schedule -> mapping -> validation -> baseline
 * lock; the UI already refused (the setup baseline gate, the review panel's
 * "Next: upload the BOQ (BOQ page), then lock baseline"), and the API now
 * says the same to a direct call:
 *
 *   400 BOQ_REQUIRED_FOR_BASELINE — "BOQ required before baseline lock:
 *   upload the BOQ (BOQ page), then map it to the schedule and lock the
 *   baseline."
 *
 * on both baseline routes (POST /schedule/baseline and POST
 * /schedule/revisions/:id/baseline — the only two that mark a revision
 * baselined or copy baseline dates), for the PM and for a planning engineer
 * granted the lock by a permission template, at every stage of the schedule
 * (no revision, draft, approved but staged, active and otherwise ready),
 * named before the schedule refusal that stage would give — and nothing is
 * written. Once the bill exists the next step is the mapping (D5), and once
 * it is mapped the planning engineer locks. A baseline locked before the rule
 * is left exactly as it was.
 *
 * Proven against a real API process and the real local Postgres, through the
 * product's own API. Everything lives in a throwaway "LiveTest <uuid>"
 * organisation dropped afterwards; the only writes outside the API are the
 * fixtures of its own projects (the pre-rule baseline, the member and the
 * template).
 *
 *   npm run test:live -- src/services/__live__/pc-4-baseline-needs-boq.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const BOQ_REQUIRED = {
  status: 400,
  code: "BOQ_REQUIRED_FOR_BASELINE",
  message: "BOQ required before baseline lock: upload the BOQ (BOQ page), then map it to the schedule and lock the baseline.",
};

/** A two-activity XER (an FS link between them). */
const XER = [
  "ERMHDR\t19.12",
  "%T\tPROJWBS",
  "%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num",
  "%R\tW1\t\tCIV\tCivil\t1",
  "%T\tTASK",
  "%F\ttask_id\ttask_code\ttask_name\twbs_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tearly_start_date\tearly_end_date\tlate_start_date\tlate_end_date\ttotal_float_hr_cnt\tphys_complete_pct",
  "%R\tT1\tG100\tExcavate\tW1\t40\t40\t2026-02-02 08:00\t2026-02-06 17:00\t2026-02-02 08:00\t2026-02-06 17:00\t0\t0",
  "%R\tT2\tG200\tPour\tW1\t80\t80\t2026-02-09 08:00\t2026-02-20 17:00\t2026-02-09 08:00\t2026-02-20 17:00\t0\t0",
  "%T\tTASKPRED",
  "%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt",
  "%R\tP1\tT2\tT1\tPR_FS\t0",
  "%E",
  "",
].join("\n");

liveDescribe("PC-4: no schedule baseline without a BOQ (owner decision 2026-09-28)", () => {
  let live;
  let api;
  let planner;
  const pmAuth = () => ({ authorization: `Bearer ${live.token}` });
  const plannerAuth = () => ({ authorization: `Bearer ${mintAccessToken(planner)}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      RATE_LIMIT_UPLOAD_MAX: "1000",
      DATABASE_CONNECTION_LIMIT: "4",
    });
    planner = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest baseline planner",
      email: `live-baseline-planner-${Date.now()}@octapm-live.test`,
      role: "planning_eng",
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
      data: { orgId: live.org.id, currency: "USD", name: `LiveTest baseline-boq ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    // The planning engineer may lock this project's baseline: a template
    // with the schedule at admin level (the default policy gives the lock to
    // the PM alone).
    const template = await prisma.permissionTemplate.create({
      data: {
        orgId: live.org.id,
        name: `LiveTest baseline planner ${name} ${Date.now()}`,
        baseRole: "planning_eng",
        tools: { create: [{ module: "schedule", level: "admin" }] },
      },
    });
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: planner.id, role: "planning_eng", orgId: live.org.id } });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: planner.id, templateId: template.id } });

    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    const post = async (route, body, expected = 200, headers = pmAuth()) => {
      const response = await api.post(at(route), body, headers);
      expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
      return response.body.data;
    };
    const refused = async (route, body = {}, headers = pmAuth()) => {
      const response = await api.post(at(route), body, headers);
      return { status: response.status, code: response.body?.error?.code, message: response.body?.error?.message };
    };
    const get = async (route) => {
      const response = await api.get(at(route), pmAuth());
      expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
      return response.body.data;
    };
    const importXer = async () => {
      const form = new FormData();
      form.append("file", new Blob([XER], { type: "application/octet-stream" }), "schedule.xer");
      const response = await fetch(`${api.base}${at("/import/xer")}`, { method: "POST", headers: pmAuth(), body: form });
      const body = await response.json();
      expect([response.status, body?.error, body?.data?.staged]).toEqual([201, undefined, true]);
      return body.data.revisionId;
    };
    return { project, at, post, refused, get, importXer };
  };

  // Both routes, as each member who may lock: every one is refused alike.
  const expectBoqRequired = async (built, label, revisionId) => {
    const routes = [
      ...(revisionId ? [[`/schedule/revisions/${revisionId}/baseline`, {}]] : []),
      ["/schedule/baseline", revisionId ? { revisionId } : {}],
      ["/schedule/baseline", {}],
    ];
    for (const [who, headers] of [["pm", pmAuth()], ["planner", plannerAuth()]]) {
      for (const [route, body] of routes) {
        expect([label, who, route, await built.refused(route, body, headers)]).toEqual([label, who, route, BOQ_REQUIRED]);
      }
    }
  };

  // What a lock writes, read straight from the rows: none of it may appear.
  const lockWrites = async (projectId) => ({
    baselinedRevisions: await prisma.scheduleRevision.count({ where: { projectId, OR: [{ status: "baselined" }, { NOT: { baselinedAt: null } }] } }),
    supersededRevisions: await prisma.scheduleRevision.count({ where: { projectId, status: "superseded" } }),
    baselineDates: await prisma.activity.count({ where: { projectId, OR: [{ NOT: { baselineStart: null } }, { NOT: { baselineFinish: null } }] } }),
    lockAudits: await prisma.auditEvent.count({ where: { orgId: live.org.id, projectId, action: "baseline_locked" } }),
    lockWorkflow: await prisma.approvalWorkflowEvent.count({ where: { orgId: live.org.id, projectId, toStatus: { in: ["baselined", "superseded"] } } }),
  });
  const NOTHING = { baselinedRevisions: 0, supersededRevisions: 0, baselineDates: 0, lockAudits: 0, lockWorkflow: 0 };

  it("a project with no BOQ is refused the baseline on both routes, for the PM and a planner granted the lock, at every schedule stage, and nothing is written; with a bill the next step is the mapping, then the lock", async () => {
    const built = await newProject("greenfield");
    const projectId = built.project.id;
    expect(await prisma.boqItem.count({ where: { projectId } })).toBe(0);

    // A member who may not lock is still refused for that first.
    const outsider = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest baseline QS",
      email: `live-baseline-qs-${Date.now()}@octapm-live.test`,
      role: "qs",
    });
    await prisma.projectAssignment.create({ data: { projectId, userId: outsider.id, role: "qs", orgId: live.org.id } });
    const qs = await built.refused("/schedule/baseline", {}, { authorization: `Bearer ${mintAccessToken(outsider)}` });
    expect([qs.status, qs.code]).toEqual([403, "FORBIDDEN"]);

    // ── No revision: the BOQ, not "No schedule revision exists yet".
    await expectBoqRequired(built, "no revision", null);

    // ── A staged draft: the BOQ, not "must be Approved".
    const revisionId = await built.importXer();
    await expectBoqRequired(built, "staged draft", revisionId);

    // ── Approved, staged: the BOQ, not REVISION_NOT_ACTIVATED.
    for (const step of ["submit-review", "approve"]) await built.post(`/schedule/revisions/${revisionId}/${step}`, {});
    await expectBoqRequired(built, "staged approved", revisionId);

    // ── Active and approved, its own logic sound: the D5 coverage check
    // passes on an empty bill, and the lock is still refused for the bill.
    await built.post(`/schedule/revisions/${revisionId}/activate`, { mappings: [] });
    const readiness = (await built.get("/schedule")).revision.readiness;
    expect([readiness.ready, readiness.baselineReady]).toEqual([true, true]);
    await expectBoqRequired(built, "active approved", revisionId);

    // Nothing is written by any of those refusals: the revision is approved
    // and unbaselined, no activity carries a baseline date, no lock is
    // audited or recorded in the approval workflow.
    expect(await lockWrites(projectId)).toEqual(NOTHING);
    const row = await prisma.scheduleRevision.findUnique({ where: { id: revisionId } });
    expect([row.status, row.isActive, row.baselinedBy, row.baselinedAt, row.baselineComment]).toEqual(["approved", true, null, null, null]);
    // The setup readiness agrees: the baseline gate is not ready.
    expect((await built.get("/setup-readiness")).gates.baseline.ready).toBe(false);

    // ── The bill, entered by hand through the BOQ API: the refusal moves on
    // to the next step, the mapping (D5) — still nothing written.
    const item = (await built.post("/boq/items", { code: "1.1", description: "Excavation", quantity: 10, unit: "m3", rate: 100 }, 201)).item;
    const coverage = await built.refused("/schedule/baseline", {});
    expect([coverage.status, coverage.code]).toEqual([400, "SCHEDULE_NOT_READY"]);
    expect(coverage.message).toContain("BOQ allocations");
    expect(coverage.message).toContain("Project Controls › Mapping");
    expect(await lockWrites(projectId)).toEqual(NOTHING);

    // ── Mapped and approved: the planning engineer granted the lock locks it.
    const [first] = await prisma.activity.findMany({ where: { projectId, isActive: true }, orderBy: { sortOrder: "asc" } });
    const allocation = await built.post("/activity-boq-allocations", { boqItemId: item.id, activityId: first.id, quantity: 10 }, 201);
    for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${allocation.id}/${step}`, {});
    const locked = await built.post(`/schedule/revisions/${revisionId}/baseline`, {}, 200, plannerAuth());
    expect([locked.locked, locked.revision.status]).toEqual([2, "baselined"]);
    expect(await prisma.activity.count({ where: { projectId, isActive: true, baselineStart: null } })).toBe(0);
  });

  it("a baseline locked before the rule, on a project with no BOQ, is left exactly as it was", async () => {
    const built = await newProject("pre-rule baseline");
    const projectId = built.project.id;
    // The pre-rule state, as the lock of that time wrote it.
    const baselinedAt = new Date("2026-03-02T10:00:00.000Z");
    const revision = await prisma.scheduleRevision.create({
      data: {
        projectId,
        label: "LiveTest pre-rule baseline",
        source: "manual",
        status: "baselined",
        isActive: true,
        activityCount: 1,
        criticalCount: 1,
        activatedAt: baselinedAt,
        baselinedBy: live.user.id,
        baselinedAt,
      },
    });
    const activity = await prisma.activity.create({
      data: {
        projectId,
        name: "LiveTest pre-rule activity",
        activityCode: "L100",
        duration: 5,
        earlyStart: 0,
        earlyFinish: 5,
        lateStart: 0,
        lateFinish: 5,
        totalFloat: 0,
        isCritical: true,
        sortOrder: 0,
        baselineStart: 0,
        baselineFinish: 5,
        startDate: new Date("2026-02-02"),
        endDate: new Date("2026-02-06"),
      },
    });
    const before = {
      revision: await prisma.scheduleRevision.findUnique({ where: { id: revision.id } }),
      activity: await prisma.activity.findUnique({ where: { id: activity.id } }),
    };

    await expectBoqRequired(built, "pre-rule baseline", revision.id);

    expect(await prisma.scheduleRevision.findUnique({ where: { id: revision.id } })).toEqual(before.revision);
    expect(await prisma.activity.findUnique({ where: { id: activity.id } })).toEqual(before.activity);
    expect(await prisma.auditEvent.count({ where: { orgId: live.org.id, projectId, action: { in: ["baseline_locked", "superseded"] } } })).toBe(0);
    // The schedule still reads as baselined, with its dates.
    const schedule = await built.get("/schedule");
    expect(schedule.revision).toMatchObject({ id: revision.id, status: "baselined" });
  });
});
