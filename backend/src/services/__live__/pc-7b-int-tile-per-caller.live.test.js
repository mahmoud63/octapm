/**
 * PC-7b integration, item O — the workspace dashboard's openExceptions tile,
 * answered to three callers at once.
 *
 * Once (1 run in 5 of the exceptions-API live suite, before the tile's access
 * was made to fail closed) a site engineer on a no-BOQ template received the
 * PM's openExceptions figures exactly. It never reproduced since (the suite's
 * repeated runs, 400 interleaved probe requests); the code path holds no
 * state across requests (the per-project views live in the request; the
 * template cache is keyed by template and read-only to its callers; the
 * access objects are built per call). This keeps it that way: a PM, a site
 * engineer and a cost controller — both on templates without `boq:read` —
 * ask for the tile interleaved, 60 requests, 20 at a time (more than the
 * API's 4-connection pool), and every answer must be its own caller's
 * figure, with no template-resolution failure in the API's output. A view,
 * an access or a cache shared across callers (keyed by project or
 * organisation but not by person) fails it.
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const REQUESTS = 60;
const CONCURRENCY = 20;

liveDescribe("PC-7b integration O: the workspace tile answers each caller with their own figure under interleaved load", () => {
  let live;
  let api;
  let project;
  const members = {};
  const tag = Date.now();

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ EXCEPTIONS_ENGINE_ENABLED: "false", EXCEPTIONS_SCHEDULER_ENABLED: "false", DATABASE_CONNECTION_LIMIT: "4" });
    project = await prisma.project.create({ data: { orgId: live.org.id, name: "LiveTest tile per caller", startDate: new Date("2026-01-05") } });
    for (const [key, role] of [["site", "site_engineer"], ["cost", "cost_controller"]]) {
      const user = await createLiveUser(prisma, { orgId: live.org.id, name: `LiveTest tile ${key}`, email: `live-tile-${key}-${tag}@octapm-live.test`, role });
      await prisma.projectAssignment.create({ data: { projectId: project.id, userId: user.id, role, orgId: live.org.id } });
      const template = await prisma.permissionTemplate.create({ data: { orgId: live.org.id, name: `LiveTest tile ${key} ${tag}`, baseRole: role, tools: { create: [{ module: "boq", level: "none" }] } } });
      await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: user.id, templateId: template.id } });
      members[key] = user;
    }
    const seed = (kind, severity, subjectType, subjectId) =>
      prisma.projectException.create({ data: { orgId: live.org.id, projectId: project.id, kind, severity, subjectType, subjectId, measured: 2, limit: 1, measuredBasis: "LiveTest", limitBasis: "LiveTest" } });
    // BOQ (critical), cost (warning), progress (info), schedule but BOQ-derived (warning).
    await seed("quantity_over_boq", "critical", "boq_item", "00000000-0000-4000-8000-000000000001");
    await seed("committed_over_budget", "warning", "budget_line", "00000000-0000-4000-8000-000000000002");
    await seed("progress_stale", "info", "activity", "00000000-0000-4000-8000-000000000003");
    await seed("schedule_slip_on_mapped_item", "warning", "activity", "00000000-0000-4000-8000-000000000004");
  }, 120_000);

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      await prisma.projectException.deleteMany({ where: { orgId: live.org.id } }).catch(() => {});
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  it(`${REQUESTS} interleaved requests, ${CONCURRENCY} at a time: every answer is its own caller's`, async () => {
    const expected = {
      pm: { total: 4, bySeverity: { critical: 1, warning: 2, info: 1 }, withheldBoq: null },
      site: { total: 1, bySeverity: { critical: 0, warning: 0, info: 1 }, withheldBoq: true },
      cost: { total: 2, bySeverity: { critical: 0, warning: 1, info: 1 }, withheldBoq: true },
    };
    const headers = {
      pm: { authorization: `Bearer ${live.token}` },
      site: { authorization: `Bearer ${mintAccessToken(members.site)}` },
      cost: { authorization: `Bearer ${mintAccessToken(members.cost)}` },
    };
    const callers = Array.from({ length: REQUESTS }, (_, index) => ["pm", "site", "cost"][index % 3]);
    const answers = [];
    for (let start = 0; start < callers.length; start += CONCURRENCY) {
      const chunk = callers.slice(start, start + CONCURRENCY);
      answers.push(...(await Promise.all(chunk.map((who) => api.get("/api/v1/projects/workspace-dashboard", headers[who]).then((answer) => ({ who, answer }))))));
    }
    const seen = answers.map(({ who, answer }) => {
      const got = answer.body?.data?.openExceptions || null;
      return {
        who,
        status: answer.status,
        total: got?.total,
        bySeverity: got?.bySeverity,
        withheldBoq: got?.withheld ? got.withheld.modules.includes("boq") : null,
      };
    });
    const want = callers.map((who) => ({ who, status: 200, total: expected[who].total, bySeverity: expected[who].bySeverity, withheldBoq: expected[who].withheldBoq }));
    expect(seen).toEqual(want);
    const output = api.proc.output();
    expect((output.match(/template resolution failed|permission template lookup failed/g) || []).length).toBe(0);
  }, 300_000);
});
