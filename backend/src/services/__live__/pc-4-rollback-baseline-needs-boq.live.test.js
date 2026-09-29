/**
 * Orchestrator ruling G2 (2026-09-29, under owner decision E2): a rollback
 * whose target revision is BASELINED re-establishes a schedule baseline, so
 * it is a baseline path. POST /schedule/revisions/:id/rollback to such a
 * revision is refused, before any write, with the lock's own E2 refusal:
 *
 *   400 BOQ_REQUIRED_FOR_BASELINE — no bill at all;
 *   400 BOQ_SCOPE_REQUIRED_FOR_BASELINE — the bill has no in-scope value
 *   (every priced row not applicable, or optional);
 *   400 SCHEDULE_NOT_READY (the BOQ allocations check, Project Controls ›
 *   Mapping) — the in-scope value is not fully allocated to the activities
 *   the rollback keeps (D5): value mapped only to an activity the rollback
 *   retires does not count.
 *
 * With the in-scope value fully mapped (beside a not-applicable row: a mixed
 * bill) the same rollback still succeeds and the baselined revision is the
 * active schedule again. A rollback to an approved, never-baselined revision
 * is not a baseline path: on a token bill it still succeeds.
 *
 * Proven against a real API process and the real local Postgres, through the
 * product's own API, in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards.
 *
 *   npm run test:live -- src/services/__live__/pc-4-rollback-baseline-needs-boq.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const BOQ_REQUIRED = {
  status: 400,
  code: "BOQ_REQUIRED_FOR_BASELINE",
  message: "BOQ required before baseline lock: upload the BOQ (BOQ page), then map it to the schedule and lock the baseline.",
};
const BOQ_SCOPE_REQUIRED = {
  status: 400,
  code: "BOQ_SCOPE_REQUIRED_FOR_BASELINE",
  message:
    "BOQ required before baseline lock: the bill has no in-scope value to map; mark the rows that belong to the schedule as required (Project Controls › Mapping), map them, then lock the baseline.",
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

/** The same schedule with a third activity, G300, after G200. */
const XER_WITH_G300 = XER.replace(
  "%T\tTASKPRED",
  "%R\tT3\tG300\tCure\tW1\t40\t40\t2026-02-23 08:00\t2026-02-27 17:00\t2026-02-23 08:00\t2026-02-27 17:00\t0\t0\n%T\tTASKPRED",
).replace("%E", "%R\tP2\tT3\tT2\tPR_FS\t0\n%E");

liveDescribe("PC-4 G2: a rollback to a baselined revision is a baseline path (E2)", () => {
  let live;
  let api;
  const pmAuth = () => ({ authorization: `Bearer ${live.token}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
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
      data: { orgId: live.org.id, currency: "USD", name: `LiveTest rollback-boq ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    const post = async (route, body, expected = 200) => {
      const response = await api.post(at(route), body, pmAuth());
      expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
      return response.body.data;
    };
    const refused = async (route, body = {}) => {
      const response = await api.post(at(route), body, pmAuth());
      return { status: response.status, code: response.body?.error?.code, message: response.body?.error?.message };
    };
    const get = async (route) => {
      const response = await api.get(at(route), pmAuth());
      expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
      return response.body.data;
    };
    const setRule = async (rule, itemIds) => {
      const response = await api.request("PATCH", at("/activity-boq-allocations/mapping-rules"), { body: { rule, itemIds }, headers: pmAuth() });
      expect([rule, response.status, response.body?.error]).toEqual([rule, 200, undefined]);
    };
    const importXer = async (xer = XER) => {
      const form = new FormData();
      form.append("file", new Blob([xer], { type: "application/octet-stream" }), "schedule.xer");
      const response = await fetch(`${api.base}${at("/import/xer")}`, { method: "POST", headers: pmAuth(), body: form });
      const body = await response.json();
      expect([response.status, body?.error, body?.data?.staged]).toEqual([201, undefined, true]);
      return body.data.revisionId;
    };
    // Import, approve and activate a revision; over an active schedule, with
    // the mapping the Activate dialog proposes.
    const importAndActivate = async (xer = XER) => {
      const revisionId = await importXer(xer);
      for (const step of ["submit-review", "approve"]) await post(`/schedule/revisions/${revisionId}/${step}`, {});
      const mapping = await get(`/schedule/revisions/${revisionId}/mapping`);
      await post(`/schedule/revisions/${revisionId}/activate`, {
        mappings: mapping.suggestedMappings.map(({ oldActivityId, newActivityKey }) => ({ oldActivityId, newActivityKey })),
        unmappedRemovals: mapping.unmappedExisting.map((activity) => ({ oldActivityId: activity.id, reason: "LiveTest: replaced" })),
      });
      return revisionId;
    };
    // Every row a rollback writes, read straight from the database.
    const rollbackRows = async () => ({
      revisions: await prisma.scheduleRevision.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
      activities: await prisma.activity.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }),
      allocations: await prisma.activityBoqAllocation.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }),
      workflow: await prisma.approvalWorkflowEvent.count({ where: { orgId: live.org.id, projectId: project.id } }),
      audits: await prisma.auditEvent.count({ where: { orgId: live.org.id, projectId: project.id } }),
    });
    return { project, at, post, refused, get, setRule, importXer, importAndActivate, rollbackRows };
  };

  // Activation marks the revision it replaces superseded, so through today's
  // API a rollback's target is superseded; a target stored as BASELINED (a
  // revision kept baselined when it was replaced, or a baseline locked before
  // E2 on a bill with no in-scope value) is the state the rollback restores
  // as a baseline — the path G2 governs. The fixture writes that state on
  // the LiveTest project's own row, by its key. While a revision is stored
  // baselined the bill is locked (BOQ_BASELINE_LOCKED), so a change to the
  // bill is made with the target superseded, then the target is stored
  // baselined again before the rollback is asked for.
  const baselinedTarget = async (built, revA, revB) => {
    expect((await prisma.scheduleRevision.findUnique({ where: { id: revB } })).previousActiveRevisionId).toBe(revA);
    expect((await prisma.scheduleRevision.findUnique({ where: { id: revA } })).status).toBe("superseded");
    const storeTarget = (status) => prisma.scheduleRevision.update({ where: { id: revA }, data: { status } });
    await storeTarget("baselined");
    return async (change) => {
      await storeTarget("superseded");
      const result = await change();
      await storeTarget("baselined");
      return result;
    };
  };
  const rollback = (built, revB) => built.refused(`/schedule/revisions/${revB}/rollback`, { reason: "LiveTest: roll back" });

  it("a rollback to a baselined revision on a bill with no in-scope value — no bill, one not-applicable row, one optional row — is refused with the lock's E2 refusal before any write", async () => {
    const built = await newProject("token bill");
    const revA = await built.importAndActivate();
    const revB = await built.importAndActivate();
    const changeBill = await baselinedTarget(built, revA, revB);

    // ── No bill at all.
    const noBill = await built.rollbackRows();
    expect(await rollback(built, revB)).toEqual(BOQ_REQUIRED);
    expect(await built.rollbackRows()).toEqual(noBill);

    // ── The token bill: its one priced row not applicable, then optional.
    const token = await changeBill(async () => (await built.post("/boq/items", { code: "P.1", description: "Preliminaries", quantity: 1, unit: "item", rate: 5000 }, 201)).item);
    for (const rule of ["not_applicable", "optional"]) {
      await changeBill(() => built.setRule(rule, [token.id]));
      const before = await built.rollbackRows();
      expect([rule, await rollback(built, revB)]).toEqual([rule, BOQ_SCOPE_REQUIRED]);
      // Nothing written: every revision, activity and allocation row as it
      // was, and no workflow or audit event recorded.
      expect([rule, await built.rollbackRows()]).toEqual([rule, before]);
    }
    const active = await prisma.scheduleRevision.findMany({ where: { projectId: built.project.id, isActive: true }, select: { id: true } });
    expect(active.map((row) => row.id)).toEqual([revB]);
  });

  it("a rollback to a baselined revision with in-scope value left unmapped is refused before any write, naming the mapping; with the in-scope value fully mapped beside a not-applicable row it succeeds", async () => {
    const built = await newProject("mapped bill");
    const projectId = built.project.id;

    // ── Rev A, locked the E2 way: an in-scope row fully mapped and approved.
    const works = (await built.post("/boq/items", { code: "1.1", description: "Excavation", quantity: 10, unit: "m3", rate: 100 }, 201)).item;
    const revA = await built.importAndActivate();
    const [first] = await prisma.activity.findMany({ where: { projectId, isActive: true }, orderBy: { sortOrder: "asc" } });
    const allocation = await built.post("/activity-boq-allocations", { boqItemId: works.id, activityId: first.id, quantity: 10 }, 201);
    for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${allocation.id}/${step}`, {});
    const locked = await built.post(`/schedule/revisions/${revA}/baseline`, {});
    expect(locked.revision.status).toBe("baselined");

    // ── Rev B, activated over it: every activity mapped by its code, so
    // the mapped activity keeps its allocation.
    const revB = await built.importAndActivate();
    const changeBill = await baselinedTarget(built, revA, revB);

    // ── In-scope value left unmapped: a second required row with no
    // allocation. Refused as the lock refuses uncovered value, naming the
    // step — nothing written.
    const open = await changeBill(async () => (await built.post("/boq/items", { code: "1.2", description: "Backfill", quantity: 5, unit: "m3", rate: 100 }, 201)).item);
    const before = await built.rollbackRows();
    const coverage = await rollback(built, revB);
    expect(coverage).toEqual({
      status: 400,
      code: "SCHEDULE_NOT_READY",
      message:
        "Schedule readiness checks must pass before a rollback to a baselined revision: BOQ allocations — BOQ value remains unallocated to approved schedule activities (Project Controls › Mapping).",
    });
    expect(await built.rollbackRows()).toEqual(before);

    // ── A mixed bill: the open row not applicable, the in-scope row fully
    // mapped. The rollback succeeds and the baselined revision is the active
    // schedule again, its baseline status kept.
    await changeBill(() => built.setRule("not_applicable", [open.id]));
    const rolled = await built.post(`/schedule/revisions/${revB}/rollback`, { reason: "LiveTest: roll back" });
    expect(rolled).toBeTruthy();
    const after = await prisma.scheduleRevision.findMany({ where: { projectId }, select: { id: true, isActive: true, status: true, rollbackReason: true } });
    const byId = new Map(after.map((row) => [row.id, row]));
    expect([byId.get(revA).isActive, byId.get(revA).status]).toEqual([true, "baselined"]);
    expect([byId.get(revB).isActive, byId.get(revB).rollbackReason]).toEqual([false, "LiveTest: roll back"]);
  });

  it("a rollback to a baselined revision counts only the allocations to the activities it keeps: value mapped to an activity the rollback retires is uncovered, and the rollback is refused before any write", async () => {
    const built = await newProject("retired activity");
    const projectId = built.project.id;
    const works = (await built.post("/boq/items", { code: "1.1", description: "Excavation", quantity: 10, unit: "m3", rate: 100 }, 201)).item;
    const revA = await built.importAndActivate();
    const [first] = await prisma.activity.findMany({ where: { projectId, isActive: true }, orderBy: { sortOrder: "asc" } });
    const allocation = await built.post("/activity-boq-allocations", { boqItemId: works.id, activityId: first.id, quantity: 10 }, 201);
    for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${allocation.id}/${step}`, {});
    await built.post(`/schedule/revisions/${revA}/baseline`, {});

    // Rev B adds G300, which rev A does not have: a rollback retires it.
    const revB = await built.importAndActivate(XER_WITH_G300);
    const changeBill = await baselinedTarget(built, revA, revB);
    const added = await prisma.activity.findFirst({ where: { projectId, isActive: true, name: "Cure" } });
    expect(added).toBeTruthy();
    // A second in-scope row, fully mapped — to G300. Today every in-scope
    // row is covered by the active schedule; after the rollback it would not be.
    await changeBill(async () => {
      const cure = (await built.post("/boq/items", { code: "1.2", description: "Cure", quantity: 5, unit: "m3", rate: 100 }, 201)).item;
      const onAdded = await built.post("/activity-boq-allocations", { boqItemId: cure.id, activityId: added.id, quantity: 5 }, 201);
      for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${onAdded.id}/${step}`, {});
    });
    const before = await built.rollbackRows();
    expect(await rollback(built, revB)).toEqual({
      status: 400,
      code: "SCHEDULE_NOT_READY",
      message:
        "Schedule readiness checks must pass before a rollback to a baselined revision: BOQ allocations — BOQ value remains unallocated to approved schedule activities (Project Controls › Mapping).",
    });
    expect(await built.rollbackRows()).toEqual(before);
  });

  it("a rollback to an approved, never-baselined revision is not a baseline path: on a token bill it still succeeds", async () => {
    const built = await newProject("approved target");
    const projectId = built.project.id;
    const token = (await built.post("/boq/items", { code: "P.1", description: "Preliminaries", quantity: 1, unit: "item", rate: 5000 }, 201)).item;
    await built.setRule("not_applicable", [token.id]);
    const revA = await built.importAndActivate();
    const revB = await built.importAndActivate();
    expect((await prisma.scheduleRevision.findUnique({ where: { id: revA } })).status).not.toBe("baselined");
    await built.post(`/schedule/revisions/${revB}/rollback`, { reason: "LiveTest: roll back" });
    const restored = await prisma.scheduleRevision.findUnique({ where: { id: revA } });
    expect([restored.isActive, restored.status]).toEqual([true, "approved"]);
    expect(await prisma.scheduleRevision.count({ where: { projectId, status: "baselined" } })).toBe(0);
  });
});
