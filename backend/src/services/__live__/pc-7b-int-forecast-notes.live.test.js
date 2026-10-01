/**
 * PC-7b integration (item D) — GET /projects/:id/forecast lists the open
 * data-quality exception rows each caller may read, exactly as the
 * exceptions list would give them to that caller, and names the kinds it
 * leaves out in `dataQualityWithheld { reason }` (no count, never whether a
 * withheld row exists). Before the fix the route called buildForecast with no
 * access, so every reader — a PM included — got progress_stale only.
 *
 * A real API process (EXCEPTIONS_ENGINE_ENABLED=false: nothing evaluates),
 * one throwaway "LiveTest <uuid>" organisation, exception rows seeded directly.
 *
 *   DATABASE_CONNECTION_LIMIT=4 npm run -s test:live -- src/services/__live__/pc-7b-int-forecast-notes.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const RULES = require("../exception-rules/data-quality");

const ruleOf = (kind) => RULES.find((rule) => rule.kind === kind);

liveDescribe("PC-7b integration D: the forecast's data-quality notes per reader", () => {
  let live;
  let api;
  let project;
  const members = {};
  const tag = Date.now();
  const as = (user) => ({ authorization: `Bearer ${mintAccessToken(user)}` });
  const forecast = (headers) => api.get(`/api/v1/projects/${project.id}/forecast`, headers);
  const dqKinds = (answer) => answer.body.data.dataQualityItems.map((item) => item.kind).filter((kind) => RULES.DATA_QUALITY_KINDS.includes(kind));

  // One open row of each of these kinds (two of progress_stale), plus a
  // snoozed and a dismissed row that are never listed.
  const SEEDED = ["progress_stale", "budget_truths_disagree", "forecast_without_provenance", "unit_unresolved", "orphan_change_link", "change_order_possible_duplicate", "period_not_locked"];

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ DATABASE_CONNECTION_LIMIT: "4", EXCEPTIONS_ENGINE_ENABLED: "false" });
    project = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-7b int forecast notes", startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") } });
    const member = async (key, role, { noBoq = false } = {}) => {
      const user = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest ${key}`, email: `live-pc7bint-d-${key.replace(/_/g, "")}-${tag}@octapm-live.test`, role });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: user.id, role, orgId: live.org.id } });
      if (noBoq) {
        const template = await prisma.permissionTemplate.create({ data: { orgId: live.org.id, name: `LiveTest D ${key} ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } } });
        await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: user.id, templateId: template.id } });
      }
      members[key] = user;
    };
    await member("pm", "pm");
    await member("cost_noboq", "cost_controller", { noBoq: true });
    await member("site_noboq", "site_engineer", { noBoq: true });

    const row = (kind, subjectId, extra = {}) => ({
      orgId: live.org.id, projectId: project.id, kind, severity: ruleOf(kind).severity, subjectType: "test", subjectId,
      measured: 1, limit: 0, measuredBasis: "LiveTest seeded", limitBasis: "LiveTest seeded", ...extra,
    });
    await prisma.projectException.createMany({
      data: [
        ...SEEDED.map((kind) => row(kind, `${kind}-1`)),
        row("progress_stale", "progress_stale-2"),
        row("structure_missing", "snoozed", { snoozedUntil: new Date(Date.now() + 5 * 86_400_000) }),
        row("ev_basis_divergence", "dismissed", { resolvedAt: new Date(), resolvedReason: "dismissed:LiveTest" }),
      ],
    });
  }, 180_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["projectException", "auditEvent", "backgroundJob", "notification"]) await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it("a PM reads every seeded kind, in the rules' order, worded by the rule, and nothing is withheld", async () => {
    const answer = await forecast(as(members.pm));
    expect(answer.status).toBe(200);
    const expected = RULES.filter((rule) => SEEDED.includes(rule.kind)).map((rule) => rule.kind);
    expect(dqKinds(answer)).toEqual(expected);
    const stale = answer.body.data.dataQualityItems.find((item) => item.kind === "progress_stale");
    expect(stale).toEqual({ kind: "progress_stale", severity: "warning", subject: ruleOf("progress_stale").label, message: ruleOf("progress_stale").note(2) });
    expect(answer.body.data.dataQuality).toEqual(answer.body.data.dataQualityItems.map((item) => item.message));
    expect(answer.body.data).not.toHaveProperty("dataQualityWithheld");
  });

  it("a cost controller without boq:read: the cost and progress kinds, never a BOQ-derived one; the marker says why, with no count", async () => {
    const answer = await forecast(as(members.cost_noboq));
    expect(answer.status).toBe(200);
    // forecast_without_provenance (BOQ-derived) and unit_unresolved (boq) are left out.
    const expected = RULES.filter((rule) => SEEDED.includes(rule.kind) && !rule.boqDerived && rule.module !== "boq").map((rule) => rule.kind);
    expect(dqKinds(answer)).toEqual(expected);
    expect(dqKinds(answer)).not.toEqual(expect.arrayContaining(["forecast_without_provenance"]));
    expect(answer.body.data.dataQualityWithheld.reason).toMatch(/available only to members who may read the BOQ/);
    expect(answer.body.data.dataQualityWithheld.reason).not.toMatch(/cost module/);
    expect(Object.keys(answer.body.data.dataQualityWithheld)).toEqual(["reason"]);
    expect(JSON.stringify(answer.body.data.dataQualityWithheld)).not.toMatch(/\d/);
  });

  it("a site engineer (no boq:read, no cost read): the progress kind only; the marker names the BOQ and the cost module", async () => {
    const answer = await forecast(as(members.site_noboq));
    expect(answer.status).toBe(200);
    expect(dqKinds(answer)).toEqual(["progress_stale"]);
    const { reason } = answer.body.data.dataQualityWithheld;
    expect(reason).toMatch(/available only to members who may read the BOQ/);
    // The cost kinds and (PC-7b integration J) the change-order kinds.
    expect(reason).toMatch(/cost, change order modules are available only to members who may read them/);
    expect(JSON.stringify(answer.body.data.dataQualityWithheld)).not.toMatch(/\d/);
  });

  it("the marker depends on the caller's access, not on the rows: with no row at all it is the same", async () => {
    const empty = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-7b int forecast empty", startDate: new Date("2026-01-05") } });
    await prisma.projectAssignment.create({ data: { projectId: empty.id, userId: members.site_noboq.id, role: "site_engineer", orgId: live.org.id } });
    const template = await prisma.projectUserPermission.findFirst({ where: { projectId: project.id, userId: members.site_noboq.id } });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: empty.id, userId: members.site_noboq.id, templateId: template.templateId } });
    const there = await forecast(as(members.site_noboq));
    const none = await api.get(`/api/v1/projects/${empty.id}/forecast`, as(members.site_noboq));
    expect(none.status).toBe(200);
    expect(none.body.data.dataQualityWithheld).toEqual(there.body.data.dataQualityWithheld);
  });

  // PC-7b integration fixer 5: the notes read the rows through the list's own
  // filter (exceptionReadableWhere), so a row the list withholds — a kind the
  // caller reads, on a subject (or secondary subject) that is a BOQ record —
  // is never counted in a note.
  it("a note never counts a row the exceptions list withholds from the same caller", async () => {
    const parity = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest PC-7b fixer forecast parity", startDate: new Date("2026-01-05") } });
    for (const key of ["pm", "site_noboq"]) {
      await prisma.projectAssignment.create({ data: { projectId: parity.id, userId: members[key].id, role: members[key].role, orgId: live.org.id } });
    }
    const template = await prisma.projectUserPermission.findFirst({ where: { projectId: project.id, userId: members.site_noboq.id } });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: parity.id, userId: members.site_noboq.id, templateId: template.templateId } });
    const stale = (subjectType, subjectId, extra = {}) => ({
      orgId: live.org.id, projectId: parity.id, kind: "progress_stale", severity: ruleOf("progress_stale").severity, subjectType, subjectId,
      measured: 1, limit: 0, measuredBasis: "LiveTest seeded", limitBasis: "LiveTest seeded", ...extra,
    });
    await prisma.projectException.createMany({
      data: [stale("activity", "parity-plain"), stale("allocation", "parity-on-allocation"), stale("activity", "parity-beside-item", { secondarySubjectType: "boq_item", secondarySubjectId: "parity-item" })],
    });
    const noteOf = async (user) => {
      const answer = await api.get(`/api/v1/projects/${parity.id}/forecast`, as(user));
      expect(answer.status).toBe(200);
      return answer.body.data.dataQualityItems.find((item) => item.kind === "progress_stale");
    };
    const listed = async (user) => {
      const answer = await api.get(`/api/v1/projects/${parity.id}/controls/exceptions?kind=progress_stale&status=open&limit=100`, as(user));
      expect(answer.status).toBe(200);
      return answer.body.data.data.length;
    };
    expect(await listed(members.site_noboq)).toBe(1);
    expect((await noteOf(members.site_noboq)).message).toBe(ruleOf("progress_stale").note(1));
    expect(await listed(members.pm)).toBe(3);
    expect((await noteOf(members.pm)).message).toBe(ruleOf("progress_stale").note(3));
  });
});
