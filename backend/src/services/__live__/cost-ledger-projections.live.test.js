/**
 * The cost ledger's projections, end to end through the product API — the
 * lasting live proof behind the direct-costs and timesheets source checks
 * (frontend/scripts/direct-costs-ui.test.mjs, timesheets-ui.test.mjs).
 *
 *   1. An approved direct cost posts its line's amount as actual cost onto the
 *      budget line for its cost code and type (material, from an invoice) and
 *      onto its activity — not onto the same code's labour line, not onto
 *      another activity — and the ledger entry names both. A void writes a
 *      negative mirror onto the same line and activity, and both return to 0.
 *   2. An approved timesheet posts hours × the worker's rate as labour onto
 *      the labour budget line for the entry's cost code and onto its activity;
 *      a reopen mirrors it back to 0 on both.
 *
 * Everything lives in a throwaway "LiveTest <uuid>" organisation dropped
 * afterwards; writes outside the API create its own rows only.
 *
 *   npm run test:live -- src/services/__live__/cost-ledger-projections.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

liveDescribe("cost ledger: approvals reach the budget line and the activity, and reversals take them back", () => {
  let live;
  let api;
  const auth = () => ({ authorization: `Bearer ${live.token}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DATABASE_CONNECTION_LIMIT: "4" });
  });

  afterAll(async () => {
    if (api) await api.stop();
    if (live) {
      for (const model of ["backgroundJob", "outboundEvent", "auditEvent", "approvalWorkflowEvent"]) {
        await prisma[model]?.deleteMany?.({ where: { orgId: live.org.id } }).catch(() => {});
      }
      await dropLiveOrg(prisma, live.org.id);
    }
    await prisma.$disconnect();
  });

  /**
   * A project with two activities (built through the API) and one cost code
   * carrying a material and a labour budget line (this organisation's own
   * rows), so a posting that lands on the wrong line or activity shows.
   */
  const newProject = async (name) => {
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest ledger ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    const post = async (route, body, expected = 201) => {
      const response = await api.post(at(route), body, auth());
      expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
      return response.body.data;
    };
    const activity = (code) =>
      post("/activities", { name: `Ledger ${code}`, activityCode: `A-${code}`, duration: 5, startDate: "2026-02-02", endDate: "2026-02-06", engineerIds: [live.user.id] });
    const costed = await activity("COSTED");
    const other = await activity("OTHER");
    const costCode = await prisma.costCode.create({ data: { orgId: live.org.id, code: `LT-LEDGER-${name}-${Date.now()}`, name: "LiveTest ledger" } });
    await prisma.projectCostCode.create({ data: { orgId: live.org.id, projectId: project.id, costCodeId: costCode.id } });
    const line = (costType) => prisma.budgetLine.create({ data: { orgId: live.org.id, projectId: project.id, costCodeId: costCode.id, costType, originalBudget: 10000 } });
    const material = await line("material");
    const labour = await line("labour");

    /** Actual cost where the ledger projects it, read by each row's own id. */
    const actuals = async () => {
      const [materialRow, labourRow] = await Promise.all([
        prisma.budgetLine.findUnique({ where: { id: material.id }, select: { actual: true } }),
        prisma.budgetLine.findUnique({ where: { id: labour.id }, select: { actual: true } }),
      ]);
      const onActivity = async (activityId) => {
        const record = await prisma.costRecord.findFirst({ where: { projectId: project.id, activityId }, select: { actual: true } });
        return record ? Number(record.actual) : null;
      };
      return { material: Number(materialRow.actual), labour: Number(labourRow.actual), costed: await onActivity(costed.id), other: await onActivity(other.id) };
    };
    const ledgerFor = (sourceType, sourceId) =>
      prisma.costLedgerEntry.findMany({
        where: { orgId: live.org.id, projectId: project.id, sourceType, sourceId },
        orderBy: { createdAt: "asc" },
        select: { id: true, amount: true, budgetLineId: true, activityId: true, costType: true, reversalOfId: true },
      });
    /** The entries without their ids, amounts as numbers: the original, then its mirror. */
    const shape = (entries) => entries.map(({ id: _id, amount, ...rest }) => ({ ...rest, amount: Number(amount) }));
    return { project, post, costed, other, costCode, material, labour, actuals, ledgerFor, shape };
  };

  it("a direct cost reaches its material budget line and its activity, and a void takes it back from both", async () => {
    const built = await newProject("direct");
    expect(await built.actuals()).toEqual({ material: 0, labour: 0, costed: null, other: null });

    const cost = await built.post("/direct-costs", {
      description: "LiveTest ledger invoice",
      costDate: "2026-02-03",
      lines: [{ description: "Rebar", activityId: built.costed.id, costCodeId: built.costCode.id, amount: 1234.56 }],
    });
    for (const step of ["submit", "approve"]) await built.post(`/direct-costs/${cost.id}/${step}`, {}, 200);

    expect(await built.actuals()).toEqual({ material: 1234.56, labour: 0, costed: 1234.56, other: null });
    const posted = await built.ledgerFor("direct_cost", cost.id);
    expect(built.shape(posted)).toEqual([
      { amount: 1234.56, budgetLineId: built.material.id, activityId: built.costed.id, costType: "material", reversalOfId: null },
    ]);

    await built.post(`/direct-costs/${cost.id}/void`, { reason: "LiveTest: returned" }, 200);

    expect(await built.actuals()).toEqual({ material: 0, labour: 0, costed: 0, other: null });
    expect(built.shape(await built.ledgerFor("direct_cost", cost.id))).toEqual([
      { amount: 1234.56, budgetLineId: built.material.id, activityId: built.costed.id, costType: "material", reversalOfId: null },
      { amount: -1234.56, budgetLineId: built.material.id, activityId: built.costed.id, costType: "material", reversalOfId: posted[0].id },
    ]);
  });

  it("a timesheet reaches the labour budget line for its cost code and its activity, and a reopen takes it back from both", async () => {
    const built = await newProject("timesheet");
    const worker = await built.post("/timesheets/workers", { name: "LiveTest Ledger Worker", hourlyRate: 50 });
    const timesheet = await built.post("/timesheets", {
      date: "2026-02-04",
      entries: [{ workerId: worker.id, activityId: built.costed.id, costCodeId: built.costCode.id, hours: 8 }],
    });
    for (const step of ["submit", "approve"]) await built.post(`/timesheets/${timesheet.id}/${step}`, {}, 200);

    expect(await built.actuals()).toEqual({ material: 0, labour: 400, costed: 400, other: null });
    const posted = await built.ledgerFor("timesheet", timesheet.id);
    expect(built.shape(posted)).toEqual([
      { amount: 400, budgetLineId: built.labour.id, activityId: built.costed.id, costType: "labour", reversalOfId: null },
    ]);

    await built.post(`/timesheets/${timesheet.id}/reopen`, { reason: "LiveTest: wrong day" }, 200);

    expect(await built.actuals()).toEqual({ material: 0, labour: 0, costed: 0, other: null });
    expect(built.shape(await built.ledgerFor("timesheet", timesheet.id))).toEqual([
      { amount: 400, budgetLineId: built.labour.id, activityId: built.costed.id, costType: "labour", reversalOfId: null },
      { amount: -400, budgetLineId: built.labour.id, activityId: built.costed.id, costType: "labour", reversalOfId: posted[0].id },
    ]);
  });
});
