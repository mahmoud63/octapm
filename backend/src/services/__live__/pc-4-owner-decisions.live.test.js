/**
 * PC-4, the owner's decisions of 2026-09-27 that live in the API — proven
 * against a real API process and the real local Postgres.
 *
 *   D2  the Overview's "Forecast at completion" is the business-rule EAC:
 *       revised BAC / CPI when CPI > 0, otherwise the revised BAC. It is the
 *       EV report's eac, carried by the forecast (cost.eac) with the revised
 *       BAC it was computed from (cost.bac) and the rule that gave it
 *       (cost.eacBasis). A member who may read neither the BOQ nor the cost
 *       module receives none of the three figures.
 *   C   a member without BOQ read receives no mapping share (rounded or not)
 *       and no count of mapped, unmapped, partial, over-allocated or
 *       not-applicable rows from setup readiness; a BOQ reader keeps the
 *       exact share, the coverage endpoint's own.
 *   D3  anyone who can read the schedule reads the WBS outline: node id,
 *       code, name, parent, depth, status and counts — a 3-level tree with a
 *       repeated short code — and nothing of the bill (no BOQ row count per
 *       node, no package commitment); a BOQ reader's answer is the service's,
 *       byte for byte; writes stay on boq:update.
 *
 * The member without BOQ read is a site engineer whose permission template
 * sets the BOQ tool to none (no cost tool either). Everything lives in a
 * throwaway "LiveTest <uuid>" organisation dropped afterwards.
 *
 *   npm run test:live -- src/services/__live__/pc-4-owner-decisions.live.test.js
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { normalizeMoneyTree } = require("../../utils/money");
const wbsService = require("../wbs.service");
const { startApi } = require("./auth-live-kit");

const keyPaths = (value, keys, at = "") =>
  value && typeof value === "object"
    ? Object.entries(value).flatMap(([key, inner]) => [...(keys.has(key) ? [`${at}.${key}`] : []), ...keyPaths(inner, keys, `${at}.${key}`)])
    : [];

liveDescribe("PC-4 owner decisions D2, C and D3", () => {
  let live;
  let api;
  let siteEngineer;
  const auth = () => ({ authorization: `Bearer ${live.token}` });
  const seAuth = () => ({ authorization: `Bearer ${mintAccessToken(siteEngineer)}` });

  beforeAll(async () => {
    live = await createLiveOrg(prisma);
    api = await startApi({ RATE_LIMIT_AI_MAX: "1000", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DATABASE_CONNECTION_LIMIT: "4" });
    siteEngineer = await createLiveUser(prisma, {
      orgId: live.org.id,
      name: "LiveTest Site Engineer",
      email: `live-se-${Date.now()}@octapm-live.test`,
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

  /** A project with the site engineer on it under a template that takes the BOQ away. */
  const newProject = async (name) => {
    const project = await prisma.project.create({
      data: { orgId: live.org.id, name: `LiveTest decisions ${name}`, startDate: new Date("2026-01-05"), endDate: new Date("2026-12-18") },
    });
    const template = await prisma.permissionTemplate.create({
      data: { orgId: live.org.id, name: `LiveTest no BOQ ${name} ${Date.now()}`, baseRole: "site_engineer", tools: { create: [{ module: "boq", level: "none" }] } },
    });
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: siteEngineer.id, role: "site_engineer", orgId: live.org.id } });
    await prisma.projectUserPermission.create({ data: { orgId: live.org.id, projectId: project.id, userId: siteEngineer.id, templateId: template.id } });
    const at = (route) => `/api/v1/projects/${project.id}${route}`;
    const post = async (route, body, expected = 201) => {
      const response = await api.post(at(route), body, auth());
      expect([route, response.status, response.body?.error]).toEqual([route, expected, undefined]);
      return response.body.data;
    };
    const get = async (route, headers = auth()) => {
      const response = await api.get(at(route), headers);
      expect([route, response.status, response.body?.error]).toEqual([route, 200, undefined]);
      return response;
    };
    return { project, at, post, get };
  };

  const activityWithBill = async (built, { code, name, quantity, rate, allocate = quantity }) => {
    const item = await built.post("/boq/items", { code, description: name, quantity, unit: "m3", rate });
    const activity = await built.post("/activities", {
      name,
      activityCode: `A-${code}`,
      duration: 5,
      startDate: "2026-02-02",
      endDate: "2026-02-06",
      engineerIds: [live.user.id, siteEngineer.id],
    });
    if (allocate > 0) {
      const allocation = await built.post("/activity-boq-allocations", { boqItemId: item.item.id, activityId: activity.id, quantity: allocate });
      for (const step of ["submit", "approve"]) await built.post(`/activity-boq-allocations/${allocation.id}/${step}`, {}, 200);
    }
    return { item: item.item, activity };
  };

  const CPI_ZERO_NOTE =
    "CPI is 0: actual cost has been recorded with no earned value through the cutoff, so budget ÷ CPI cannot be computed and the estimate at completion shows the budget.";
  const CPI_MISSING_NOTE =
    "CPI is not available yet: no official cost-record actuals through the cutoff, so the earned-value estimate at completion falls back to the budget.";

  describe("D2: the forecast at completion is the business-rule EAC", () => {
    it("with cost performance: revised BAC / CPI — the EV report's figure, carried by the forecast with its BAC and its rule", async () => {
      const built = await newProject("D2 cpi");
      const { activity } = await activityWithBill(built, { code: "1.1", name: "Concrete frame", quantity: 100, rate: 1000 });
      // Half the work approved; 62,500 spent through last month: CPI 0.8.
      await prisma.activityProgress.create({
        data: { activityId: activity.id, pctComplete: 50, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00Z") },
      });
      await prisma.costRecord.create({
        data: { projectId: built.project.id, activityId: activity.id, actual: 62500, actualThroughDate: new Date("2026-02-05T12:00:00Z") },
      });
      const ev = (await built.get("/reports/ev")).body.data;
      const forecast = (await built.get("/forecast")).body.data;
      // Recomputed from the report's own inputs: BAC / (EV / AC).
      expect([ev.totalBudget, ev.ev, ev.ac]).toEqual([100000, 50000, 62500]);
      const expected = ev.totalBudget / (ev.ev / ev.ac);
      expect(expected).toBeCloseTo(125000, 2);
      expect(ev.eac).toBeCloseTo(expected, 2);
      expect(forecast.cost).toMatchObject({ eac: ev.eac, bac: ev.totalBudget, eacBasis: "budget_over_cpi" });
      // The EV report names the same rule for the same figure.
      expect(ev.eacBasis).toBe("budget_over_cpi");
      // The projected cost is max(EAC, bottom-up): never below the EAC.
      expect(forecast.cost.projected).toBeGreaterThanOrEqual(forecast.cost.eac);
    });

    it("without cost performance: the revised BAC itself, said to be the budget", async () => {
      const built = await newProject("D2 no cpi");
      const { activity } = await activityWithBill(built, { code: "1.1", name: "Concrete frame", quantity: 100, rate: 1000 });
      await prisma.activityProgress.create({
        data: { activityId: activity.id, pctComplete: 50, status: "approved", approvedBy: live.user.id, approvedAt: new Date("2026-02-04T12:00:00Z") },
      });
      const ev = (await built.get("/reports/ev")).body.data;
      const forecast = (await built.get("/forecast")).body.data;
      expect([ev.cpi, ev.eac, ev.totalBudget]).toEqual([null, 100000, 100000]);
      expect(forecast.cost).toMatchObject({ eac: 100000, bac: 100000, eacBasis: "budget_no_cost_performance" });
      expect(ev.eacBasis).toBe("budget_no_cost_performance");
      expect(forecast.schedule.cpi).toBeNull();
      expect(forecast.dataQuality).toContain(CPI_MISSING_NOTE);
      expect(forecast.dataQuality).not.toContain(CPI_ZERO_NOTE);
    });

    it("with actual cost and nothing earned (CPI 0): the revised BAC, named as its own rule on the EV report and the forecast, with the reason in the forecast's data quality", async () => {
      const built = await newProject("D2 cpi zero");
      const { activity } = await activityWithBill(built, { code: "1.1", name: "Concrete frame", quantity: 100, rate: 1000 });
      // 62,500 spent through 5 February, no progress approved: EV 0, CPI 0.
      await prisma.costRecord.create({
        data: { projectId: built.project.id, activityId: activity.id, actual: 62500, actualThroughDate: new Date("2026-02-05T00:00:00Z") },
      });
      const ev = (await built.get("/reports/ev")).body.data;
      const forecast = (await built.get("/forecast")).body.data;
      // The certified figure is unchanged: CPI = EV / AC = 0, and with CPI
      // not above 0 the EAC is the revised BAC itself.
      expect([ev.ev, ev.ac, ev.cpi, ev.eac, ev.totalBudget]).toEqual([0, 62500, 0, 100000, 100000]);
      // ... named for what it is: not "budget / CPI", not "no cost performance yet".
      expect(ev.eacBasis).toBe("budget_cpi_zero");
      expect(forecast.cost).toMatchObject({ eac: 100000, bac: 100000, actual: 62500, eacBasis: "budget_cpi_zero" });
      expect(forecast.schedule.cpi).toBe(0);
      expect(forecast.dataQuality).toContain(CPI_ZERO_NOTE);
      expect(forecast.dataQuality).not.toContain(CPI_MISSING_NOTE);
    });

    it("a member who may read neither the BOQ nor the cost module receives no EAC, no BAC, no budget and no EAC basis (which says whether a budget exists — read off the mapping, owner decision 2026-09-28)", async () => {
      const built = await newProject("D2 withheld");
      const { activity } = await activityWithBill(built, { code: "1.1", name: "Concrete frame", quantity: 100, rate: 1000 });
      await prisma.costRecord.create({
        data: { projectId: built.project.id, activityId: activity.id, actual: 62500, actualThroughDate: new Date("2026-02-05T12:00:00Z") },
      });
      const full = (await built.get("/forecast")).body.data;
      expect(full.cost).toHaveProperty("eac");
      const limited = await built.get("/forecast", seAuth());
      const cost = limited.body.data.cost;
      expect(["eac" in cost, "bac" in cost, "budget" in cost, "projected" in cost, "eacBasis" in cost, cost.withheld, cost.reason]).toEqual([false, false, false, false, false, true, "Cost figures are not available to you"]);
      // Actual cost and nothing earned: the rule is CPI 0's, for the reader who may see the EAC.
      expect(full.cost.eacBasis).toBe("budget_cpi_zero");
      expect(limited.text).not.toContain(String(full.cost.eac));
      expect(limited.text).not.toContain("100000");
    });
  });

  describe("C: the mapping's coverage goes to BOQ readers only", () => {
    it("a BOQ reader receives the exact share and counts; a member without BOQ read receives neither, nor any count a mapping issue concerns", async () => {
      const built = await newProject("C coverage");
      // Two priced rows, only the first allocated: a share that is not a whole percent.
      await activityWithBill(built, { code: "1.1", name: "Concrete in foundations", quantity: 100, rate: 213.37 });
      await activityWithBill(built, { code: "1.2", name: "Reinforcement to foundations", quantity: 50, rate: 1009.13, allocate: 0 });

      const full = (await built.get("/setup-readiness")).body.data;
      const coverage = (await built.get("/activity-boq-allocations/coverage")).body.data;
      // The BOQ reader: the coverage endpoint's own share, not rounded.
      expect(full.coverage.coveragePct).toBe(coverage.coveragePct);
      expect(full.coverage.coveragePct).toBeCloseTo((21337 / 71793.5) * 100, 6);
      expect(Number.isInteger(full.coverage.coveragePct)).toBe(false);
      expect(full.coverage.counts).toEqual(coverage.counts);
      expect(full.summary.headline.find((entry) => entry.key === "mapping").raw).toBe(full.coverage.coveragePct);

      const response = await built.get("/setup-readiness", seAuth());
      const limited = response.body.data;
      // The member without BOQ read: no share, no counts — anywhere in the answer.
      expect(limited.coverage).toEqual({ withheld: true, reason: "Mapping details unavailable to you" });
      expect(keyPaths(limited, new Set(["coveragePct"]))).toEqual([]);
      expect(response.text).not.toMatch(/"coveragePct"/);
      expect(response.text).not.toContain(`${Math.round(full.coverage.coveragePct)}%`);
      expect(limited.summary.headline.find((entry) => entry.key === "mapping")).toEqual({
        key: "mapping",
        label: "Mapping",
        value: "—",
        tone: "neutral",
        raw: null,
        withheld: true,
        reason: "Mapping details unavailable to you",
      });
      const guide = limited.steps.find((step) => step.key === "structure_setup").guides.find((entry) => entry.key === "mapping_readiness");
      expect(guide).toMatchObject({ count: null, detail: "Mapping details unavailable to you", detailsWithheld: true });
      // The mapping issues are named, with their verdicts, but not counted.
      const issues = limited.steps.flatMap((step) => [...step.blockers, ...step.warnings, ...step.advisories]);
      const unallocated = issues.find((issue) => issue.code === "UNALLOCATED_BOQ");
      expect(unallocated).toMatchObject({ severity: "blocking", mappingDetailsWithheld: true, items: [] });
      expect(unallocated).not.toHaveProperty("count");
      const fullUnallocated = full.steps.flatMap((step) => step.blockers).find((issue) => issue.code === "UNALLOCATED_BOQ");
      expect(fullUnallocated.count).toBe(1);
      // Every gate is the same for both.
      for (const name of ["baseline", "progress", "reporting"]) {
        expect([name, limited.gates[name].ready, limited.gates[name].blockers.map((b) => b.code)]).toEqual([
          name,
          full.gates[name].ready,
          full.gates[name].blockers.map((b) => b.code),
        ]);
      }
      // The Overview's other answers carry no coverage either.
      for (const route of ["/health", "/forecast", "/schedule"]) {
        const other = await built.get(route, seAuth());
        expect([route, keyPaths(other.body.data, new Set(["coveragePct"]))]).toEqual([route, []]);
      }
    });
  });

  describe("D3: anyone who can read the schedule reads the WBS outline", () => {
    let built;
    let nodes;

    beforeAll(async () => {
      built = await newProject("D3 wbs");
      // An imported programme's WBS (XER-shaped: wbsId / parentWbsId), with
      // the short code "FDN" under both CIV and MEP, made canonical the way a
      // revision's activation makes it: the second FDN is qualified with its
      // parent's code, the unique (project, code) holding.
      const xer = [
        { wbsId: "W1", parentWbsId: null, code: "CIV", name: "Civil works" },
        { wbsId: "W2", parentWbsId: "W1", code: "FDN", name: "Civil foundations" },
        { wbsId: "W3", parentWbsId: "W2", code: "PILE", name: "Piles" },
        { wbsId: "W4", parentWbsId: null, code: "MEP", name: "MEP works" },
        { wbsId: "W5", parentWbsId: "W4", code: "FDN", name: "MEP foundations" },
        { wbsId: "W6", parentWbsId: "W5", code: "PLI", name: "Plinths" },
      ];
      await prisma.$transaction((tx) =>
        wbsService.upsertNodesFromSnapshot({ tx, orgId: live.org.id, projectId: built.project.id, nodes: xer, source: "import", userId: live.user.id }),
      );
      const rows = await prisma.wbsNode.findMany({ where: { projectId: built.project.id } });
      const byExternal = Object.fromEntries(rows.map((row) => [row.externalId, row]));
      const [civ, civFdn, piles, mep, mepFdn, plinths] = ["W1", "W2", "W3", "W4", "W5", "W6"].map((id) => byExternal[id]);
      nodes = { civ, civFdn, piles, mep, mepFdn, plinths };
      expect(mepFdn.code).toBe("MEP.FDN");
      // A BOQ row filed under the civil foundations and an activity under the
      // piles: the node's BOQ row count is the bill's, its activity count is not.
      const { item, activity } = await activityWithBill(built, { code: "1.1", name: "Piling", quantity: 10, rate: 500, allocate: 0 });
      await prisma.boqItem.update({ where: { id: item.id }, data: { wbsNodeId: civFdn.id } });
      await prisma.activity.update({ where: { id: activity.id }, data: { wbsNodeId: piles.id } });
    });

    it("a site engineer with the BOQ tool set to none reads the canonical outline — codes, names, parents, depths of a 3-level imported tree whose short code FDN repeats — and no WBS figure of the bill", async () => {
      const response = await built.get("/structure/wbs", seAuth());
      const outline = response.body.data;
      expect(outline.view).toBe("outline");
      const byId = new Map(outline.items.map((item) => [item.id, item]));
      const row = (node) => {
        const item = byId.get(node.id);
        return [item.code, item.name, item.parentId, item.depth, item.status];
      };
      expect([nodes.civ, nodes.civFdn, nodes.piles, nodes.mep, nodes.mepFdn, nodes.plinths].map(row)).toEqual([
        ["CIV", "Civil works", null, 0, "active"],
        ["FDN", "Civil foundations", nodes.civ.id, 1, "active"],
        ["PILE", "Piles", nodes.civFdn.id, 2, "active"],
        ["MEP", "MEP works", null, 0, "active"],
        ["MEP.FDN", "MEP foundations", nodes.mep.id, 1, "active"],
        ["PLI", "Plinths", nodes.mepFdn.id, 2, "active"],
      ]);
      // The nested tree: each FDN under its own parent, each with its own child.
      const tree = outline.tree.map((root) => [root.code, root.children.map((child) => [child.code, child.name, child.children.map((leaf) => leaf.code)])]);
      expect(tree).toEqual([
        ["CIV", [["FDN", "Civil foundations", ["PILE"]]]],
        ["MEP", [["MEP.FDN", "MEP foundations", ["PLI"]]]],
      ]);
      // Counts that are the schedule's stay.
      expect(byId.get(nodes.piles.id).activityCount).toBe(1);
      expect(byId.get(nodes.civ.id).childCount).toBe(1);
      // Nothing of the bill: no BOQ row count, no package owner or commitment.
      const withheld = new Set(["boqItemCount", "linkedBoqItems", "commitmentId", "ownerPartyId", "budget", "amount", "externalId", "source"]);
      expect(keyPaths(outline, withheld)).toEqual([]);
      // Writes stay the BOQ updater's.
      const refused = await api.post(built.at("/structure/wbs"), { code: "X", name: "Nope" }, seAuth());
      expect([refused.status, refused.body?.error?.code]).toEqual([403, "FORBIDDEN"]);
    });

    it("a BOQ reader's answer is the service's, byte for byte — unchanged", async () => {
      const response = await built.get("/structure/wbs");
      const service = await wbsService.listWbsNodes({ orgId: live.org.id, projectId: built.project.id, query: {} });
      expect(response.text).toBe(JSON.stringify({ success: true, data: normalizeMoneyTree(service) }));
      expect(response.body.data).not.toHaveProperty("view");
      expect(response.body.data.items.find((item) => item.id === nodes.civFdn.id).boqItemCount).toBe(1);
    });
  });
});
