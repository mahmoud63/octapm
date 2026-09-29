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
 * The schedule's readiness says what the lock says (closure review,
 * 2026-09-28): on a project with no bill, baselineReady is false and its
 * first failing check is "boq_present", whose fix is the upload on the BOQ
 * page — never baselineReady true beside a lock that is refused. The
 * approval's own verdict (ready) is unchanged, and setup readiness does not
 * repeat the check (its BOQ step names the upload).
 *
 * Owner decision E2 (2026-09-28): the lock needs REAL in-scope BOQ value —
 * at least one active row in scope for mapping (its rule neither
 * not_applicable nor optional) with an amount above zero, fully allocated to
 * active activities. A token bill (one not-applicable row; one optional row)
 * is refused like no bill on every baseline path, with nothing written:
 *
 *   400 BOQ_SCOPE_REQUIRED_FOR_BASELINE — "BOQ required before baseline
 *   lock: the bill has no in-scope value to map; mark the rows that belong
 *   to the schedule as required (Project Controls › Mapping), map them, then
 *   lock the baseline."
 *
 * The readiness's boq_present check and the setup baseline gate
 * (BOQ_NO_IN_SCOPE_VALUE on the BOQ step) say the same; a mixed bill —
 * in-scope rows fully mapped beside not-applicable rows — locks.
 *
 * Each refusal names the step that is missing (closure review, 2026-09-28):
 * a bill none of whose rows is priced — uploaded at rate 0 through the BOQ
 * page's own route, or a row edited back to 0 — is not told to mark its
 * (already required) rows as required, but to price them:
 *
 *   400 BOQ_VALUE_REQUIRED_FOR_BASELINE — "BOQ required before baseline
 *   lock: the bill has no value to map; price its rows (BOQ page), map them
 *   to the schedule, then lock the baseline."
 *
 * with the readiness's boq_present fix { where "BOQ page", permission
 * "boq.edit" } and the setup gate's BOQ_HAS_NO_VALUE in the same words. The
 * no-bill fix names the upload's own permission (boq.upload), not the
 * mapping's.
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
const BOQ_SCOPE_REQUIRED = {
  status: 400,
  code: "BOQ_SCOPE_REQUIRED_FOR_BASELINE",
  message:
    "BOQ required before baseline lock: the bill has no in-scope value to map; mark the rows that belong to the schedule as required (Project Controls › Mapping), map them, then lock the baseline.",
};

const BOQ_VALUE_REQUIRED = {
  status: 400,
  code: "BOQ_VALUE_REQUIRED_FOR_BASELINE",
  message:
    "BOQ required before baseline lock: the bill has no value to map; price its rows (BOQ page), map them to the schedule, then lock the baseline.",
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
  const expectBoqRequired = async (built, label, revisionId, refusal = BOQ_REQUIRED) => {
    const routes = [
      ...(revisionId ? [[`/schedule/revisions/${revisionId}/baseline`, {}]] : []),
      ["/schedule/baseline", revisionId ? { revisionId } : {}],
      ["/schedule/baseline", {}],
    ];
    for (const [who, headers] of [["pm", pmAuth()], ["planner", plannerAuth()]]) {
      for (const [route, body] of routes) {
        expect([label, who, route, await built.refused(route, body, headers)]).toEqual([label, who, route, refusal]);
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
    // The readiness says so too: the approval's verdict stands, the
    // baseline's is false, and its first failing step is the upload.
    await built.post(`/schedule/revisions/${revisionId}/activate`, { mappings: [] });
    const readiness = (await built.get("/schedule")).revision.readiness;
    expect([readiness.ready, readiness.baselineReady, readiness.baselineBlockingCount]).toEqual([true, false, 1]);
    expect(readiness.checks[0]).toEqual({
      key: "boq_present",
      label: "BOQ",
      requiredFor: ["baseline"],
      passed: false,
      severity: "blocking",
      message: "No BOQ has been uploaded; a baseline locks a BOQ mapped to the schedule.",
      details: {},
      fix: {
        where: "BOQ page",
        inline: true,
        permission: "boq.upload",
        next: "upload the BOQ (BOQ page)",
        text: "Upload the BOQ on the BOQ page, then map it to the schedule's activities (Project Controls › Mapping) and lock the baseline.",
      },
    });
    expect(readiness.checks.filter((check) => check.severity === "blocking" && !check.passed).map((check) => check.key)).toEqual(["boq_present"]);
    await expectBoqRequired(built, "active approved", revisionId);

    // Nothing is written by any of those refusals: the revision is approved
    // and unbaselined, no activity carries a baseline date, no lock is
    // audited or recorded in the approval workflow.
    expect(await lockWrites(projectId)).toEqual(NOTHING);
    const row = await prisma.scheduleRevision.findUnique({ where: { id: revisionId } });
    expect([row.status, row.isActive, row.baselinedBy, row.baselinedAt, row.baselineComment]).toEqual(["approved", true, null, null, null]);
    // The setup readiness agrees: the baseline gate is not ready — and its
    // BOQ step names the upload; the schedule's BOQ check is not repeated
    // as a schedule correction.
    const setup = await built.get("/setup-readiness");
    expect(setup.gates.baseline.ready).toBe(false);
    expect(setup.gates.baseline.blockers.map((blocker) => blocker.code)).not.toContain("SCHEDULE_BOQ_PRESENT_FAILED");

    // ── The bill, entered by hand through the BOQ API: the refusal moves on
    // to the next step, the mapping (D5) — still nothing written.
    const item = (await built.post("/boq/items", { code: "1.1", description: "Excavation", quantity: 10, unit: "m3", rate: 100 }, 201)).item;
    const mappingNext = (await built.get("/schedule")).revision.readiness;
    expect(mappingNext.checks[0]).toMatchObject({ key: "boq_present", passed: true, fix: null });
    expect([mappingNext.baselineReady, mappingNext.checks.filter((check) => check.severity === "blocking" && !check.passed).map((check) => check.key)]).toEqual([false, ["allocations"]]);
    const coverage = await built.refused("/schedule/baseline", {});
    expect([coverage.status, coverage.code]).toEqual([400, "SCHEDULE_NOT_READY"]);
    expect(coverage.message).toContain("BOQ allocations");
    expect(coverage.message).toContain("Project Controls › Mapping");
    expect(await lockWrites(projectId)).toEqual(NOTHING);

    // ── Mapped and approved: the planning engineer granted the lock locks it.
    const [first] = await prisma.activity.findMany({ where: { projectId, isActive: true }, orderBy: { sortOrder: "asc" } });
    const allocation = await built.post("/activity-boq-allocations", { boqItemId: item.id, activityId: first.id, quantity: 10 }, 201);
    for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${allocation.id}/${step}`, {});
    // Every check the baseline needs now passes, and the lock succeeds.
    expect((await built.get("/schedule")).revision.readiness).toMatchObject({ ready: true, baselineReady: true, baselineBlockingCount: 0 });
    const locked = await built.post(`/schedule/revisions/${revisionId}/baseline`, {}, 200, plannerAuth());
    expect([locked.locked, locked.revision.status]).toEqual([2, "baselined"]);
    expect(await prisma.activity.count({ where: { projectId, isActive: true, baselineStart: null } })).toBe(0);
  });

  it("a token bill — one not-applicable row, then one optional row — is refused like no bill on every baseline path at every stage, readiness and the setup gate say why, nothing is written; a mixed bill with its in-scope rows fully mapped locks (E2)", async () => {
    const built = await newProject("token bill");
    const projectId = built.project.id;
    const setRule = async (rule, itemIds) => {
      const response = await api.request("PATCH", built.at("/activity-boq-allocations/mapping-rules"), { body: { rule, itemIds }, headers: pmAuth() });
      expect([rule, response.status, response.body?.error]).toEqual([rule, 200, undefined]);
    };
    // The token bill: one priced row, marked not applicable.
    const token = (await built.post("/boq/items", { code: "P.1", description: "Preliminaries", quantity: 1, unit: "item", rate: 5000 }, 201)).item;
    await setRule("not_applicable", [token.id]);
    expect(await prisma.boqItem.findUnique({ where: { id: token.id }, select: { mappingRule: true, amount: true } })).toMatchObject({ mappingRule: "not_applicable" });

    // ── No revision, a staged draft, approved but staged: the bill's scope,
    // named before every schedule refusal, as the missing bill is.
    await expectBoqRequired(built, "token bill, no revision", null, BOQ_SCOPE_REQUIRED);
    const revisionId = await built.importXer();
    await expectBoqRequired(built, "token bill, staged draft", revisionId, BOQ_SCOPE_REQUIRED);
    for (const step of ["submit-review", "approve"]) await built.post(`/schedule/revisions/${revisionId}/${step}`, {});
    await expectBoqRequired(built, "token bill, staged approved", revisionId, BOQ_SCOPE_REQUIRED);

    // ── Active and approved, its own logic sound, and the coverage check
    // passing vacuously on a bill with nothing to map: still refused, for
    // the not-applicable row and then for the optional one.
    await built.post(`/schedule/revisions/${revisionId}/activate`, { mappings: [] });
    for (const rule of ["not_applicable", "optional"]) {
      await setRule(rule, [token.id]);
      const readiness = (await built.get("/schedule")).revision.readiness;
      // The coverage check passes vacuously, and says so without telling the
      // reader that nothing blocks the baseline (boq_present does).
      const allocations = readiness.checks.find((check) => check.key === "allocations");
      expect([rule, allocations.passed, allocations.message]).toEqual([rule, true, "No in-scope BOQ value to allocate yet."]);
      expect([rule, readiness.ready, readiness.baselineReady, readiness.baselineBlockingCount]).toEqual([rule, true, false, 1]);
      expect([rule, readiness.checks[0]]).toEqual([
        rule,
        {
          key: "boq_present",
          label: "BOQ",
          requiredFor: ["baseline"],
          passed: false,
          severity: "blocking",
          message:
            "The bill has no in-scope value to map: every priced row is marked not applicable or optional; a baseline locks a BOQ mapped to the schedule.",
          details: {},
          fix: {
            where: "Project Controls › Mapping",
            inline: true,
            permission: "boq.update",
            next: "mark the rows that belong to the schedule as required (Project Controls › Mapping)",
            text: "Mark the BOQ rows that belong to the schedule as required on Project Controls › Mapping, map them to the schedule's activities and lock the baseline.",
          },
        },
      ]);
      await expectBoqRequired(built, `token bill (${rule}), active approved`, revisionId, BOQ_SCOPE_REQUIRED);
      // The setup baseline gate agrees, on its BOQ step, in the refusal's words.
      const setup = await built.get("/setup-readiness");
      expect([rule, setup.gates.baseline.ready, setup.summary.readyForBaseline]).toEqual([rule, false, false]);
      const codes = setup.gates.baseline.blockers.map((blocker) => blocker.code);
      expect([rule, codes.includes("BOQ_NO_IN_SCOPE_VALUE"), codes.includes("SCHEDULE_BOQ_PRESENT_FAILED")]).toEqual([rule, true, false]);
      expect(setup.gates.baseline.blockers.find((blocker) => blocker.code === "BOQ_NO_IN_SCOPE_VALUE")).toMatchObject({
        stepKey: "boq_upload",
        message:
          "The bill has no in-scope value to map: every priced row is marked not applicable or optional. Mark the rows that belong to the schedule as required (Project Controls › Mapping), map them, then lock the baseline.",
      });
      // The Overview's BOQ Upload card sends to where that step is taken —
      // Project Controls › Mapping — not to the BOQ the project already has.
      expect([rule, setup.steps.find((step) => step.key === "boq_upload").action]).toEqual([
        rule,
        { label: "Open Mapping", target: { module: "controls", child: "mapping" } },
      ]);
    }
    // Nothing is written by any refusal.
    expect(await lockWrites(projectId)).toEqual(NOTHING);
    const row = await prisma.scheduleRevision.findUnique({ where: { id: revisionId } });
    expect([row.status, row.isActive, row.baselinedBy, row.baselinedAt]).toEqual(["approved", true, null, null]);

    // ── A mixed bill: the token row back to not applicable, and an in-scope
    // row fully mapped to an active activity. The not-applicable row needs no
    // mapping (D5), and the planning engineer granted the lock locks it.
    await setRule("not_applicable", [token.id]);
    const works = (await built.post("/boq/items", { code: "1.1", description: "Excavation", quantity: 10, unit: "m3", rate: 100 }, 201)).item;
    const [first] = await prisma.activity.findMany({ where: { projectId, isActive: true }, orderBy: { sortOrder: "asc" } });
    const allocation = await built.post("/activity-boq-allocations", { boqItemId: works.id, activityId: first.id, quantity: 10 }, 201);
    for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${allocation.id}/${step}`, {});
    const mixed = (await built.get("/schedule")).revision.readiness;
    expect(mixed.checks[0]).toMatchObject({ key: "boq_present", passed: true, fix: null });
    expect(mixed).toMatchObject({ ready: true, baselineReady: true, baselineBlockingCount: 0 });
    const setup = await built.get("/setup-readiness");
    expect(setup.gates.baseline.blockers.map((blocker) => blocker.code)).not.toContain("BOQ_NO_IN_SCOPE_VALUE");
    const locked = await built.post(`/schedule/revisions/${revisionId}/baseline`, {}, 200, plannerAuth());
    expect([locked.locked, locked.revision.status]).toEqual([2, "baselined"]);
  });

  it("an unpriced bill — uploaded at rate 0 the canonical way, or a row edited to 0 — is refused with the pricing step on every baseline path, readiness and the setup gate say the same, nothing is written; priced, the refusal moves on to the mapping (E2)", async () => {
    const built = await newProject("unpriced bill");
    const projectId = built.project.id;
    // The bill uploaded through the BOQ page's own route: two rows at rate 0,
    // in scope by rule (required), so it has no value to map.
    const XLSX = require("@e965/xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["code", "description", "quantity", "unit", "rate"],
        ["1.1", "Excavation", 10, "m3", 0],
        ["1.2", "Concrete", 5, "m3", 0],
      ]),
      "BOQ",
    );
    const form = new FormData();
    form.append(
      "file",
      new Blob([XLSX.write(book, { type: "buffer", bookType: "xlsx" })], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "unpriced.xlsx",
    );
    const uploaded = await fetch(`${api.base}${built.at("/boq/upload")}`, { method: "POST", headers: pmAuth(), body: form });
    const uploadBody = await uploaded.json();
    expect([uploaded.status, uploadBody?.error]).toEqual([200, undefined]);
    const rows = await prisma.boqItem.findMany({ where: { projectId, isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, amount: true, mappingRule: true } });
    expect(rows.map((row) => [row.code, Number(row.amount), row.mappingRule])).toEqual([
      ["1.1", 0, "required"],
      ["1.2", 0, "required"],
    ]);

    const UNPRICED_MESSAGE = "The bill has no value to map: none of its rows is priced; a baseline locks a BOQ mapped to the schedule.";
    const PRICING_FIX = {
      where: "BOQ page",
      inline: true,
      permission: "boq.edit",
      next: "price the BOQ's rows (BOQ page)",
      text: "Price the BOQ's rows on the BOQ page, then map them to the schedule's activities (Project Controls › Mapping) and lock the baseline.",
    };
    const expectUnpriced = async (label, revisionId) => {
      await expectBoqRequired(built, label, revisionId, BOQ_VALUE_REQUIRED);
      // (No schedule yet: GET /schedule answers null.)
      const readiness = (await built.get("/schedule"))?.revision?.readiness;
      if (readiness) {
        expect([label, readiness.checks[0]]).toEqual([
          label,
          { key: "boq_present", label: "BOQ", requiredFor: ["baseline"], passed: false, severity: "blocking", message: UNPRICED_MESSAGE, details: {}, fix: PRICING_FIX },
        ]);
        const allocations = readiness.checks.find((check) => check.key === "allocations");
        expect([label, allocations.message]).toEqual([label, "No in-scope BOQ value to allocate yet."]);
      }
      // The setup baseline gate names the same step, in the refusal's words.
      const setup = await built.get("/setup-readiness");
      const codes = setup.gates.baseline.blockers.map((blocker) => blocker.code);
      expect([label, setup.gates.baseline.ready, codes.includes("BOQ_HAS_NO_VALUE"), codes.includes("BOQ_NO_IN_SCOPE_VALUE")]).toEqual([label, false, true, false]);
      expect(setup.gates.baseline.blockers.find((blocker) => blocker.code === "BOQ_HAS_NO_VALUE")).toMatchObject({
        stepKey: "boq_upload",
        message: "The bill has no value to map: none of its rows is priced. Price its rows (BOQ page), map them to the schedule, then lock the baseline.",
      });
      // Its card still opens the BOQ page, where the rows are priced.
      expect([label, setup.steps.find((step) => step.key === "boq_upload").action.label]).toEqual([label, "Open BOQ"]);
    };

    // ── No revision, then the schedule imported, approved and activated:
    // the pricing, named before every schedule refusal, on every path.
    await expectUnpriced("unpriced, no revision", null);
    const revisionId = await built.importXer();
    await expectUnpriced("unpriced, staged draft", revisionId);
    for (const step of ["submit-review", "approve"]) await built.post(`/schedule/revisions/${revisionId}/${step}`, {});
    await built.post(`/schedule/revisions/${revisionId}/activate`, { mappings: [] });
    await expectUnpriced("unpriced, active approved", revisionId);
    expect(await lockWrites(projectId)).toEqual(NOTHING);

    // ── One row priced through the BOQ page's edit: the refusal moves on to
    // the mapping (D5) — still nothing written.
    const edit = async (itemId, rate) => {
      const response = await api.request("PATCH", built.at(`/boq/items/${itemId}`), { body: { rate }, headers: pmAuth() });
      expect([rate, response.status, response.body?.error]).toEqual([rate, 200, undefined]);
    };
    await edit(rows[0].id, 120);
    const priced = (await built.get("/schedule")).revision.readiness;
    expect(priced.checks[0]).toMatchObject({ key: "boq_present", passed: true, fix: null });
    const coverage = await built.refused("/schedule/baseline", {});
    expect([coverage.status, coverage.code]).toEqual([400, "SCHEDULE_NOT_READY"]);
    // ── ... and edited back to 0: the pricing is the missing step again.
    await edit(rows[0].id, 0);
    await expectUnpriced("a row edited back to 0, active approved", revisionId);
    expect(await lockWrites(projectId)).toEqual(NOTHING);
    const row = await prisma.scheduleRevision.findUnique({ where: { id: revisionId } });
    expect([row.status, row.isActive, row.baselinedBy, row.baselinedAt]).toEqual(["approved", true, null, null]);
  });

  // Closure review (2026-09-29): one threshold for value. A bill whose only
  // in-scope value is one cent is no value — the coverage check cannot tell
  // it covered from uncovered, its remainder being within the cent
  // tolerance — and every path says so alike: the lock refuses it on both
  // routes, the schedule readiness is not baseline-ready, the setup gate
  // names the same step. Before, the setup gate refused it
  // (BOQ_HAS_NO_VALUE) while the readiness passed and POST /schedule/baseline
  // locked it with nothing mapped.
  it("a bill worth one cent, unmapped, is refused on both routes with the pricing step and nothing written; beside a priced not-applicable row, with the scope step — never \"nothing blocks the baseline\" (closure review)", async () => {
    const built = await newProject("one cent");
    const projectId = built.project.id;
    const cent = (await built.post("/boq/items", { code: "1.1", description: "Token pour", quantity: 1, unit: "m3", rate: 0.01 }, 201)).item;
    expect(Number(cent.amount)).toBe(0.01);
    const revisionId = await built.importXer();
    for (const step of ["submit-review", "approve"]) await built.post(`/schedule/revisions/${revisionId}/${step}`, {});
    await built.post(`/schedule/revisions/${revisionId}/activate`, { mappings: [] });

    // ── The cent alone: no value — the pricing step, everywhere.
    const readiness = (await built.get("/schedule")).revision.readiness;
    expect([readiness.ready, readiness.baselineReady]).toEqual([true, false]);
    expect(readiness.checks[0]).toMatchObject({
      key: "boq_present",
      passed: false,
      message: "The bill has no value to map: none of its rows is priced; a baseline locks a BOQ mapped to the schedule.",
    });
    await expectBoqRequired(built, "one cent, active approved", revisionId, BOQ_VALUE_REQUIRED);
    const setup = await built.get("/setup-readiness");
    expect([setup.gates.baseline.ready, setup.gates.baseline.blockers.map((blocker) => blocker.code).includes("BOQ_HAS_NO_VALUE")]).toEqual([false, true]);
    expect(await lockWrites(projectId)).toEqual(NOTHING);
    expect(await prisma.activityBoqAllocation.count({ where: { boqItemId: cent.id } })).toBe(0);

    // ── Beside a $250,000 row marked not applicable: the bill is priced, its
    // in-scope value a cent — the scope step, everywhere, and the refusal
    // never says nothing blocks the baseline.
    const prelims = (await built.post("/boq/items", { code: "P.1", description: "Preliminaries", quantity: 1, unit: "item", rate: 250000 }, 201)).item;
    const ruled = await api.request("PATCH", built.at("/activity-boq-allocations/mapping-rules"), { body: { rule: "not_applicable", itemIds: [prelims.id] }, headers: pmAuth() });
    expect([ruled.status, ruled.body?.error]).toEqual([200, undefined]);
    const beside = (await built.get("/schedule")).revision.readiness;
    expect(beside.baselineReady).toBe(false);
    expect(beside.checks[0]).toMatchObject({ key: "boq_present", passed: false });
    for (const check of beside.checks) expect([check.key, check.message]).not.toEqual([check.key, expect.stringMatching(/nothing blocks the baseline/)]);
    await expectBoqRequired(built, "one cent beside not applicable, active approved", revisionId, BOQ_SCOPE_REQUIRED);
    const besideSetup = await built.get("/setup-readiness");
    const codes = besideSetup.gates.baseline.blockers.map((blocker) => blocker.code);
    expect([besideSetup.gates.baseline.ready, codes.includes("BOQ_NO_IN_SCOPE_VALUE"), codes.includes("BOQ_HAS_NO_VALUE")]).toEqual([false, true, false]);
    expect(await lockWrites(projectId)).toEqual(NOTHING);
    const row = await prisma.scheduleRevision.findUnique({ where: { id: revisionId } });
    expect([row.status, row.isActive, row.baselinedBy, row.baselinedAt]).toEqual(["approved", true, null, null]);
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
