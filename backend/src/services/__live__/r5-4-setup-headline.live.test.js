/**
 * R5-4 — the setup headline's three schedule states (owner decision,
 * 2026-09-30), proven against a real API process and the real local
 * Postgres, through the product's own API.
 *
 *   The headline distinguishes no schedule, an imported/staged schedule and
 *   an active schedule. An import can truthfully be complete before
 *   activation. "Critical unmapped 0" — or any count — is never shown when
 *   no eligible (active) schedule has been assessed: "Waiting for active
 *   schedule" is shown instead. BOQ-derived-information restrictions are
 *   preserved.
 *
 * Three projects of one throwaway "LiveTest <uuid>" organisation, each with
 * the same one-row bill:
 *
 *   none    — no schedule revision, no activity
 *   staged  — a P6 XER imported (a staged draft), then submitted and
 *             approved, never activated
 *   active  — the same import, approved and activated
 *
 * and two callers: the organisation's admin (who may read the BOQ) and a
 * site engineer whose permission template takes the BOQ away (the BOQ and
 * coverage endpoints refuse them).
 *
 *   - none and staged: both callers are told the state and that the critical
 *     entry is waiting — the waiting state is the schedule's, not the
 *     bill's — with no count, no "0" and no done tone anywhere;
 *   - active: the BOQ reader gets the count (the critical activities with no
 *     approved allocation, re-derived here from the rows), and an assessed
 *     zero once they are mapped; the member gets no count and the server's
 *     reason, exactly as before.
 *
 * The organisation is dropped afterwards. The API is started on a free port
 * with the job worker off, so nothing calls a model.
 *
 *   npm run test:live -- src/services/__live__/r5-4-setup-headline.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const WAITING = "Waiting for active schedule";
const WITHHELD = "Mapping details unavailable to you";

/** A two-activity XER (an FS link between them), both on the critical path. */
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

liveDescribe("R5-4: the setup headline tells no schedule, a staged schedule and an active schedule apart", () => {
  let live;
  let api;
  let member;
  const projects = {};
  const pmAuth = () => ({ authorization: `Bearer ${live.token}` });
  const memberAuth = () => ({ authorization: `Bearer ${mintAccessToken(member)}` });

  const at = (projectId, route) => `/api/v1/projects/${projectId}${route}`;
  const post = async (projectId, route, body, expected = 200) => {
    const response = await api.post(at(projectId, route), body, pmAuth());
    expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
    return response.body.data;
  };
  const readiness = async (projectId, headers) => {
    const response = await api.get(at(projectId, "/setup-readiness"), headers);
    expect([response.status, response.body?.error]).toEqual([200, undefined]);
    return response.body.data;
  };
  const entry = (result, key) => result.summary.headline.find((item) => item.key === key);
  const importXer = async (projectId) => {
    const form = new FormData();
    form.append("file", new Blob([XER], { type: "application/octet-stream" }), "schedule.xer");
    const response = await fetch(`${api.base}${at(projectId, "/import/xer")}`, { method: "POST", headers: pmAuth(), body: form });
    const body = await response.json();
    expect([response.status, body?.error, body?.data?.staged]).toEqual([201, undefined, true]);
    return body.data.revisionId;
  };

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      RATE_LIMIT_UPLOAD_MAX: "1000",
      DATABASE_CONNECTION_LIMIT: "4",
    });
    const tag = Date.now();
    member = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest headline site engineer",
      email: `live-r5-4-se-${tag}@octapm-live.test`,
      role: "site_engineer",
    });
    const template = await prisma.permissionTemplate.create({
      data: {
        orgId: live.org.id,
        name: `LiveTest R5-4 no BOQ ${tag}`,
        baseRole: "site_engineer",
        tools: { create: [{ module: "boq", level: "none" }] },
      },
    });
    for (const state of ["none", "staged", "active"]) {
      const project = await prisma.project.create({
        data: { orgId: live.org.id, currency: "USD", name: `LiveTest R5-4 headline ${state}`, startDate: new Date("2026-01-05"), endDate: new Date("2027-12-17") },
      });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: member.id, role: "site_engineer", orgId: live.org.id } });
      await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: member.id, templateId: template.id } });
      // The same bill on each, through the BOQ API.
      const item = (await post(project.id, "/boq/items", { code: "1.1", description: "Excavation", quantity: 10, unit: "m3", rate: 100 }, 201)).item;
      projects[state] = { id: project.id, item };
    }
    // staged: imported, submitted and approved — never activated.
    projects.staged.revisionId = await importXer(projects.staged.id);
    // active: the same import, taken all the way to activation.
    projects.active.revisionId = await importXer(projects.active.id);
  }, 180_000);

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

  // Nothing was assessed: no count for anyone, no claim of withholding, and
  // nothing in the entry that reads as a figure or as done.
  const expectWaiting = (label, result) => {
    expect([label, entry(result, "critical_unmapped")]).toEqual([
      label,
      { key: "critical_unmapped", label: "Critical unmapped activities", value: WAITING, tone: "neutral", raw: null, waiting: true },
    ]);
    expect([label, Object.prototype.hasOwnProperty.call(result.summary, "criticalUnmappedActivities")]).toEqual([label, false]);
    expect([label, Object.prototype.hasOwnProperty.call(result.summary, "criticalUnmappedWithheld")]).toEqual([label, false]);
    expect([label, result.summary.criticalUnmappedWaiting, result.summary.criticalUnmappedReason]).toEqual([label, true, WAITING]);
  };
  // The member is still refused the bill and the mapping's share.
  const expectMemberRestricted = async (projectId, result) => {
    expect((await api.get(at(projectId, "/boq"), memberAuth())).status).toBe(403);
    expect((await api.get(at(projectId, "/activity-boq-allocations/coverage"), memberAuth())).status).toBe(403);
    expect(result.coverage).toEqual({ withheld: true, reason: WITHHELD });
    expect(entry(result, "mapping")).toMatchObject({ value: "—", raw: null, withheld: true, reason: WITHHELD });
    const keys = result.summary.headline.map((item) => item.key);
    expect(keys).not.toContain("unmapped_boq");
    expect(keys).not.toContain("unmapped_quantity");
    expect(JSON.stringify(result)).not.toContain("Excavation");
  };

  it("no schedule: 'No schedule yet' and a waiting critical entry, for the BOQ reader and for the member who may not read the BOQ", async () => {
    const { id } = projects.none;
    expect(await prisma.scheduleRevision.count({ where: { projectId: id } })).toBe(0);
    expect(await prisma.activity.count({ where: { projectId: id } })).toBe(0);

    const full = await readiness(id, pmAuth());
    const limited = await readiness(id, memberAuth());
    for (const [who, result] of [["reader", full], ["member", limited]]) {
      expect([who, result.summary.scheduleState]).toEqual([who, "none"]);
      expect([who, entry(result, "schedule_imported")]).toEqual([
        who,
        { key: "schedule_imported", label: "Schedule", value: "No schedule yet", tone: "blocked", raw: false },
      ]);
      expectWaiting(who, result);
      expect([who, result.context.currentRevision]).toEqual([who, null]);
    }
    // The reader's line, whole: a bill, no schedule, nothing assessed.
    expect(full.summary.headline.map((item) => [item.key, item.value])).toEqual([
      ["boq_imported", "PASS"],
      ["schedule_imported", "No schedule yet"],
      ["mapping", "0%"],
      ["unmapped_quantity", "10 m3"],
      ["unmapped_boq", "1,000 USD"],
      ["critical_unmapped", WAITING],
      ["baseline", "NOT APPROVED"],
      ["cost_loading", "INCOMPLETE"],
    ]);
    await expectMemberRestricted(id, limited);
    // The gate is what it was: the schedule step's NO_SCHEDULE blocker.
    expect(full.steps.find((step) => step.key === "schedule_generation").blockers.map((b) => b.code)).toEqual(["NO_SCHEDULE"]);
  });

  it("a staged schedule — imported, then approved, never activated: the import reads complete, and the critical entry waits at every stage for both callers", async () => {
    const { id, revisionId } = projects.staged;
    const stage = async (label, status) => {
      const row = await prisma.scheduleRevision.findUnique({ where: { id: revisionId }, select: { status: true, isActive: true, activityCount: true } });
      expect([label, row.status, row.isActive, row.activityCount]).toEqual([label, status, false, 2]);
      expect([label, await prisma.activity.count({ where: { projectId: id, isActive: true } })]).toEqual([label, 0]);

      const full = await readiness(id, pmAuth());
      const limited = await readiness(id, memberAuth());
      for (const [who, result] of [["reader", full], ["member", limited]]) {
        const tag = `${label} / ${who}`;
        expect([tag, result.summary.scheduleState]).toEqual([tag, "staged"]);
        expect([tag, entry(result, "schedule_imported")]).toEqual([
          tag,
          { key: "schedule_imported", label: "Schedule imported", value: "PASS (waiting for activation)", tone: "info", raw: true },
        ]);
        expectWaiting(tag, result);
        expect([tag, result.context.currentRevision]).toEqual([tag, expect.objectContaining({ id: revisionId, isActive: false })]);
        // The old line: a count of zero in the done tone. Never again.
        const critical = entry(result, "critical_unmapped");
        expect([tag, /\d/.test(critical.value), critical.tone === "done"]).toEqual([tag, false, false]);
      }
      await expectMemberRestricted(id, limited);
      // The schedule step is complete with the engine's own warning, as before.
      const step = full.steps.find((item) => item.key === "schedule_generation");
      expect([label, step.blockers.map((b) => b.code), step.warnings.map((w) => w.code)]).toEqual([label, [], ["SCHEDULE_NOT_ACTIVE"]]);
      return full;
    };

    await stage("staged draft", "draft");
    await post(id, `/schedule/revisions/${revisionId}/submit-review`, {});
    await stage("staged under review", "under_review");
    await post(id, `/schedule/revisions/${revisionId}/approve`, {});
    await stage("staged approved", "approved");
  });

  it("an active schedule: the BOQ reader gets the count and, once mapped, an assessed zero; the member gets no count and the server's reason", async () => {
    const { id, revisionId, item } = projects.active;
    for (const step of ["submit-review", "approve"]) await post(id, `/schedule/revisions/${revisionId}/${step}`, {});
    // Approved and still staged: waiting, for both.
    for (const [who, headers] of [["reader", pmAuth()], ["member", memberAuth()]]) {
      const before = await readiness(id, headers);
      expect([who, before.summary.scheduleState]).toEqual([who, "staged"]);
      expectWaiting(`before activation / ${who}`, before);
    }

    await post(id, `/schedule/revisions/${revisionId}/activate`, { mappings: [] });
    const active = await prisma.activity.findMany({ where: { projectId: id, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, isCritical: true, isMilestone: true } });
    expect(active).toHaveLength(2);
    // The count, re-derived from the rows: critical, not a milestone, and no
    // approved allocation.
    const unmappedCritical = async () => {
      const approvedIds = new Set(
        (await prisma.activityBoqAllocation.findMany({ where: { projectId: id, isActive: true, status: "approved" }, select: { activityId: true } })).map((row) => row.activityId),
      );
      const rows = await prisma.activity.findMany({ where: { projectId: id, isActive: true, isCritical: true, isMilestone: false }, select: { id: true } });
      return rows.filter((row) => !approvedIds.has(row.id)).length;
    };
    const expected = await unmappedCritical();
    // Both imported activities have no float: a count that cannot be read as
    // "nothing to see".
    expect(expected).toBe(2);

    const full = await readiness(id, pmAuth());
    expect(full.summary.scheduleState).toBe("active");
    expect(entry(full, "schedule_imported")).toEqual({ key: "schedule_imported", label: "Schedule imported", value: "PASS", tone: "done", raw: true });
    expect(entry(full, "critical_unmapped")).toEqual({
      key: "critical_unmapped",
      label: "Critical unmapped activities",
      value: String(expected),
      tone: "review",
      raw: expected,
    });
    expect(full.summary.criticalUnmappedActivities).toBe(expected);
    expect(full.summary).not.toHaveProperty("criticalUnmappedWaiting");
    expect(full.summary).not.toHaveProperty("criticalUnmappedWithheld");

    // The member: assessed, and withheld — not the waiting state, no count,
    // no tone that says whether there are any.
    const limited = await readiness(id, memberAuth());
    expect(limited.summary.scheduleState).toBe("active");
    expect(entry(limited, "schedule_imported")).toEqual(entry(full, "schedule_imported"));
    expect(entry(limited, "critical_unmapped")).toEqual({
      key: "critical_unmapped",
      label: "Critical unmapped activities",
      value: "—",
      tone: "neutral",
      raw: null,
      withheld: true,
      reason: WITHHELD,
    });
    expect(limited.summary).not.toHaveProperty("criticalUnmappedActivities");
    expect(limited.summary).not.toHaveProperty("criticalUnmappedWaiting");
    expect([limited.summary.criticalUnmappedWithheld, limited.summary.criticalUnmappedReason]).toEqual([true, WITHHELD]);
    await expectMemberRestricted(id, limited);
    // The critical activities themselves are the schedule's, and theirs.
    const criticalOf = (result) => result.steps.find((step) => step.key === "schedule_generation").counts.criticalActivities;
    expect([criticalOf(full), criticalOf(limited)]).toEqual([2, 2]);

    // Map the bill across both critical activities and approve: an assessed
    // zero is a fact, and reads as one — to the reader alone.
    for (const [index, activity] of active.entries()) {
      const allocation = await post(id, "/activity-boq-allocations", { boqItemId: item.id, activityId: activity.id, quantity: 5 }, 201);
      for (const step of ["submit", "approve"]) await post(id, `/activity-boq-allocations/${allocation.id}/${step}`, {});
      expect([index, await unmappedCritical()]).toEqual([index, 1 - index]);
    }
    const mapped = await readiness(id, pmAuth());
    expect(entry(mapped, "critical_unmapped")).toEqual({
      key: "critical_unmapped",
      label: "Critical unmapped activities",
      value: "0",
      tone: "done",
      raw: 0,
    });
    expect(mapped.summary.criticalUnmappedActivities).toBe(0);
    const mappedLimited = await readiness(id, memberAuth());
    expect(entry(mappedLimited, "critical_unmapped")).toEqual(entry(limited, "critical_unmapped"));
    expect(mappedLimited.summary).not.toHaveProperty("criticalUnmappedActivities");
  });

  it("the three states side by side never put a count beside a schedule that is not active", async () => {
    const rows = [];
    for (const state of ["none", "staged", "active"]) {
      for (const [who, headers] of [["reader", pmAuth()], ["member", memberAuth()]]) {
        const result = await readiness(projects[state].id, headers);
        const critical = entry(result, "critical_unmapped");
        rows.push([state, who, result.summary.scheduleState, critical.value, critical.tone]);
      }
    }
    expect(rows).toEqual([
      ["none", "reader", "none", WAITING, "neutral"],
      ["none", "member", "none", WAITING, "neutral"],
      ["staged", "reader", "staged", WAITING, "neutral"],
      ["staged", "member", "staged", WAITING, "neutral"],
      ["active", "reader", "active", "0", "done"],
      ["active", "member", "active", "—", "neutral"],
    ]);
  });
});
