/**
 * PC-4 merge gate, round 6 — owner decision D5: BOQ allocation coverage is
 * checked at the BASELINE LOCK, not at the approval. Proven against a real
 * API process and the real local Postgres, through the product's own API.
 *
 * Before D5 a greenfield project deadlocked: approving a staged revision
 * required BOQ allocations to ACTIVE activities, which exist only after
 * activation, and activation requires the approval — and SCHEDULE_NOT_READY
 * sent the PM to Project Controls › Mapping, which could not help.
 *
 * The greenfield flow, step by step:
 *   upload the bill -> submit -> approve -> lock it;
 *   import an XER (staged) -> submit -> approve (200, the bill unmapped);
 *   baseline refused 409 REVISION_NOT_ACTIVATED;
 *   activate;
 *   baseline refused 400 SCHEDULE_NOT_READY naming the unallocated
 *   coverage and Project Controls › Mapping;
 *   map the bill's value to the active activities (submit, approve);
 *   baseline 200.
 * At every stage the setup readiness names the next real step, and a member
 * without boq:read is told the same words without a figure of the bill.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards; the only writes outside the API are to its own rows.
 *
 *   npm run test:live -- src/services/__live__/pc-4-merge-gate-r6.live.test.js
 */
const XLSX = require("@e965/xlsx");
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { REVISION_NOT_ACTIVATED_MESSAGE } = require("../schedule.service");

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

// The bill: 10 × 12,345.50 + 20 × 2,515 = 173,755 (USD).
const BILL = [
  ["Item No", "Description", "Qty", "Unit", "Rate"],
  ["1.1", "Excavation", 10, "m3", 12345.5],
  ["1.2", "Concrete", 20, "m3", 2515],
];
const BILL_FIGURES = ["173755", "173,755", "123455", "123,455", "50300", "50,300", "12345.5", "2515"];

const NOT_READY_BASELINE =
  "Schedule readiness checks must pass before baseline lock: BOQ allocations — BOQ value remains unallocated to approved schedule activities (Project Controls › Mapping).";

liveDescribe("PC-4 merge gate round 6: BOQ coverage is checked at the baseline lock (D5)", () => {
  let live;
  let api;
  let siteEngineer;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const seAuth = () => ({ authorization: `Bearer ${mintAccessToken(siteEngineer)}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      RATE_LIMIT_UPLOAD_MAX: "1000",
      DATABASE_CONNECTION_LIMIT: "4",
    });
    siteEngineer = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest r6 Site Engineer",
      email: `live-r6-se-${Date.now()}@octapm-live.test`,
      role: "site_engineer",
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
      data: { orgId: live.org.id, currency: "USD", name: `LiveTest r6 ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
    });
    // The site engineer is on the project under a template that takes the BOQ away.
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest r6 no BOQ ${name} ${Date.now()}`, baseRole: "site_engineer", tools: { create: [{ module: "boq", level: "none" }] } },
    });
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: siteEngineer.id, role: "site_engineer", orgId: live.org.id } });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: siteEngineer.id, templateId: template.id } });

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
    const get = async (route, headers = auth()) => {
      const response = await api.get(at(route), headers);
      expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
      return response;
    };
    const setup = async (headers = auth()) => (await get("/setup-readiness", headers)).body.data;
    const upload = async (path, file, filename, type) => {
      const form = new FormData();
      form.append("file", new Blob([file], { type }), filename);
      const response = await fetch(`${api.base}${at(path)}`, { method: "POST", headers: auth(), body: form });
      return { status: response.status, body: await response.json() };
    };
    return { project, at, post, refused, get, setup, upload };
  };

  const stepOf = (readiness, key) => readiness.steps.find((step) => step.key === key);
  const allocationCheck = (readiness) => readiness.checks.find((check) => check.key === "allocations");
  const withoutBillFigures = (label, text) => {
    for (const figure of BILL_FIGURES) expect([label, figure, text.includes(figure)]).toEqual([label, figure, false]);
  };

  it("greenfield: bill approved and locked, XER imported, submitted, approved with the bill unmapped, activated, refused a baseline until mapped, then baselined", async () => {
    const built = await newProject("greenfield");

    // ── 1. The bill: upload, submit, approve, lock (the product's BOQ API).
    const sheet = XLSX.utils.aoa_to_sheet(BILL);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const uploaded = await built.upload(
      "/boq/upload",
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      "boq.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect([uploaded.status, uploaded.body?.error, uploaded.body?.data?.mode]).toEqual([200, undefined, "imported"]);
    const boqRevisionId = uploaded.body.data.revisionId;
    for (const step of ["submit", "approve", "lock"]) await built.post(`/boq/revisions/${boqRevisionId}/${step}`, {});
    const items = await prisma.boqItem.findMany({ where: { projectId: built.project.id }, orderBy: { code: "asc" } });
    expect(items.map((item) => [item.code, Number(item.amount)])).toEqual([
      ["1.1", 123455],
      ["1.2", 50300],
    ]);

    // ── 2. The schedule: an XER import, staged.
    const imported = await built.upload("/import/xer", XER, "greenfield.xer", "application/octet-stream");
    expect([imported.status, imported.body?.error]).toEqual([201, undefined]);
    expect(imported.body.data).toMatchObject({ staged: true, imported: 2 });
    const revisionId = imported.body.data.revisionId;

    // Draft: the mapping waits on the revision's review, approval and
    // activation — and the next action says so, sending to Revisions.
    const draft = await built.setup();
    const draftWaiting = stepOf(draft, "boq_allocation").blockers.find((row) => row.code === "ALLOCATION_WAITING_FOR_SCHEDULE");
    expect(draftWaiting.message).toBe(
      "Submit the schedule revision for review, approve it and activate it (Schedule › Revisions) before mapping allocations to its activities.",
    );
    expect(stepOf(draft, "boq_allocation").action).toEqual({ label: "Open Review", target: { module: "schedule", child: "revisions" } });
    expect(draft.summary.nextAction).toMatchObject({
      stepKey: "boq_allocation",
      label: "Open Review",
      target: { module: "schedule", child: "revisions" },
    });

    // The Schedule page's readiness: the revision's own logic passes, so it
    // is ready for approval; coverage waits for the baseline, after activation.
    const staged = (await built.get("/schedule")).body.data.revision;
    expect(staged).toMatchObject({ id: revisionId, isActive: false });
    expect([staged.readiness.ready, staged.readiness.blockingCount, staged.readiness.baselineReady]).toEqual([true, 0, false]);
    expect(allocationCheck(staged.readiness)).toMatchObject({
      requiredFor: ["baseline"],
      passed: false,
      severity: "blocking",
      message: "BOQ value is mapped to this revision's activities after it is activated; the baseline lock needs it, the approval does not.",
    });

    // ── 3. Submit and approve: 200, with the bill wholly unmapped.
    await built.post(`/schedule/revisions/${revisionId}/submit-review`, {});
    const underReview = await built.setup();
    expect(stepOf(underReview, "boq_allocation").blockers.find((row) => row.code === "ALLOCATION_WAITING_FOR_SCHEDULE").message).toBe(
      "Approve the schedule revision under review and activate it (Schedule › Revisions) before mapping allocations to its activities.",
    );
    const approved = await built.post(`/schedule/revisions/${revisionId}/approve`, {});
    expect(approved.status).toBe("approved");
    expect(await prisma.activityBoqAllocation.count({ where: { projectId: built.project.id } })).toBe(0);

    // ── 4. Approved but staged: the baseline is refused with the activation.
    for (const route of [`/schedule/revisions/${revisionId}/baseline`, "/schedule/baseline"]) {
      expect(await built.refused(route)).toEqual({ status: 409, code: "REVISION_NOT_ACTIVATED", message: REVISION_NOT_ACTIVATED_MESSAGE });
    }
    const awaiting = await built.setup();
    expect(stepOf(awaiting, "boq_allocation").action).toEqual({ label: "Activate Revision", target: { module: "schedule", child: "revisions" } });
    expect(awaiting.summary.nextAction).toMatchObject({ stepKey: "boq_allocation", label: "Activate Revision" });

    // ── 5. Activate: the baseline is refused for the unmapped coverage,
    // naming Project Controls › Mapping — and nothing is written.
    await built.post(`/schedule/revisions/${revisionId}/activate`, { mappings: [] });
    const activities = await prisma.activity.findMany({ where: { projectId: built.project.id, isActive: true }, orderBy: { sortOrder: "asc" } });
    expect(activities.map((activity) => activity.activityCode || activity.p6ActivityId)).toEqual(["G100", "G200"]);
    for (const [route, body] of [[`/schedule/revisions/${revisionId}/baseline`, {}], ["/schedule/baseline", {}]]) {
      const refusal = await built.refused(route, body);
      expect(refusal).toEqual({ status: 400, code: "SCHEDULE_NOT_READY", message: NOT_READY_BASELINE });
      withoutBillFigures(route, refusal.message);
    }
    expect((await prisma.scheduleRevision.findUnique({ where: { id: revisionId } })).status).toBe("approved");
    expect(
      await prisma.activity.count({ where: { projectId: built.project.id, isActive: true, NOT: { baselineStart: null } } }),
    ).toBe(0);

    // The setup readiness names the mapping as the step before the lock.
    const active = await built.setup();
    const baselineStep = stepOf(active, "baseline_readiness");
    expect(baselineStep.action).toEqual({ label: "Map Allocations", target: { module: "controls", child: "mapping" } });
    expect(baselineStep.blockers.map((row) => [row.code, row.message])).toEqual([
      [
        "SCHEDULE_ALLOCATIONS_FAILED",
        "BOQ value remains unallocated to approved schedule activities. Map it to the active activities on Project Controls › Mapping, then lock the baseline.",
      ],
    ]);
    expect(active.gates.baseline).toMatchObject({ ready: false });
    expect(active.gates.baseline.message).toMatch(/^Map the bill's value to the active activities \(Project Controls › Mapping\)/);
    expect(active.gates.baseline.blockers.map((row) => row.code)).toEqual(
      expect.arrayContaining(["NO_APPROVED_ALLOCATIONS", "UNALLOCATED_BOQ", "SCHEDULE_ALLOCATIONS_FAILED"]),
    );
    const activeSchedule = (await built.get("/schedule")).body.data.revision.readiness;
    expect([activeSchedule.ready, activeSchedule.baselineReady, activeSchedule.baselineBlockingCount]).toEqual([true, false, 1]);

    // A member without boq:read is told the same step and the same words,
    // without a figure of the bill.
    const seResponse = await built.get("/setup-readiness", seAuth());
    const seSetup = seResponse.body.data;
    expect(stepOf(seSetup, "baseline_readiness").blockers.map((row) => [row.code, row.message])).toEqual(
      baselineStep.blockers.map((row) => [row.code, row.message]),
    );
    expect(seSetup.gates.baseline.message).toBe(active.gates.baseline.message);
    withoutBillFigures("site engineer setup readiness", seResponse.text);

    // ── 6. Map the bill's value to the active activities, then lock.
    for (const [item, activity] of [
      [items[0], activities[0]],
      [items[1], activities[1]],
    ]) {
      const allocation = await built.post(
        "/activity-boq-allocations",
        { boqItemId: item.id, activityId: activity.id, quantity: Number(item.qty) },
        201,
      );
      for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${allocation.id}/${step}`, {});
    }
    const mapped = await built.setup();
    expect(stepOf(mapped, "baseline_readiness").action).toEqual({ label: "Lock Baseline", target: { module: "schedule", child: "revisions" } });
    expect(stepOf(mapped, "baseline_readiness").blockers).toEqual([]);
    const locked = await built.post(`/schedule/revisions/${revisionId}/baseline`, {});
    expect(locked.locked).toBe(2);
    expect(locked.revision.status).toBe("baselined");
  });
});
