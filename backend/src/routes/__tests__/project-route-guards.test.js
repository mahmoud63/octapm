/**
 * Ten project-nested routers were mounted behind project membership alone:
 * any member of any role could raise, change or delete drawings,
 * transmittals, correspondence, ITPs, defects, material tests, budget
 * revisions, cash-flow entries, sub valuations and weather delays, while
 * shared/permissions.json said otherwise (Phase 21C, P21-010).
 *
 * Each route is now guarded with the module the policy already names for it.
 * This test drives every one of those routes as a role the policy denies and
 * as a role it allows, straight through the real RBAC middleware.
 */
const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "user-1", orgId: "org-1", role: req.get("x-role") || "pm" };
    next();
  },
}));

const resolved = () => jest.fn().mockResolvedValue({ id: "record-1" });
const serviceMock = (names) => Object.fromEntries(names.map((name) => [name, resolved()]));

jest.mock("../../services/drawing.service", () => serviceMock(["listDrawings", "createDrawing", "updateDrawing", "deleteDrawing"]));
jest.mock("../../services/transmittal.service", () => serviceMock(["listTransmittals", "createTransmittal", "updateTransmittal", "deleteTransmittal"]));
jest.mock("../../services/correspondence.service", () => serviceMock(["listCorrespondence", "createCorrespondence", "updateCorrespondence", "deleteCorrespondence"]));
jest.mock("../../services/itp.service", () => serviceMock(["listItps", "createItp", "updateItp", "deleteItp"]));
jest.mock("../../services/defect.service", () => serviceMock(["listDefects", "createDefect", "updateDefect", "deleteDefect"]));
jest.mock("../../services/material-test.service", () => serviceMock(["listMaterialTests", "createMaterialTest", "updateMaterialTest", "deleteMaterialTest"]));
jest.mock("../../services/budget-revision.service", () => serviceMock(["listBudgetRevisions", "createBudgetRevision", "updateBudgetRevision", "deleteBudgetRevision"]));
jest.mock("../../services/cash-flow.service", () => serviceMock(["listCashFlow", "createManualCashFlowEntry", "rebuildCashFlow", "deleteCashFlowEntry"]));
jest.mock("../../services/sub-valuation.service", () => serviceMock(["listSubValuations", "createSubValuation", "updateSubValuation", "deleteSubValuation", "attributionReport"]));
jest.mock("../../services/weather.service", () => serviceMock(["listWeatherDelays", "createWeatherDelay", "updateWeatherDelay", "deleteWeatherDelay"]));

const { authenticate } = require("../../middleware/auth");

const ROUTERS = {
  drawings: require("../drawings"),
  transmittals: require("../transmittals"),
  correspondence: require("../correspondence"),
  itp: require("../itp"),
  defects: require("../defects"),
  "material-tests": require("../material-tests"),
  "budget-revisions": require("../budget-revisions"),
  "cash-flow": require("../cash-flow"),
  "sub-valuations": require("../sub-valuations"),
  "weather-delays": require("../weather-delays"),
};

const ID = "00000000-0000-4000-8000-000000000001";

/**
 * One row per route: who the policy lets through and who it does not.
 * `allowed` must not be refused (a 400 from the validators is fine — it means
 * the role got past the door); `denied` must be refused with 403 FORBIDDEN.
 */
const CASES = [
  // document_control: read=everyone, create=pm|planning_eng|site_engineer, update=pm|planning_eng
  ...["drawings", "transmittals", "correspondence"].flatMap((prefix) => [
    { prefix, method: "get", path: "/", allowed: "warehouse", denied: null },
    { prefix, method: "post", path: "/", allowed: "site_engineer", denied: "warehouse" },
    { prefix, method: "post", path: "/", allowed: "planning_eng", denied: "finance" },
    { prefix, method: "patch", path: `/${ID}`, allowed: "planning_eng", denied: "site_engineer" },
    { prefix, method: "delete", path: `/${ID}`, allowed: "pm", denied: "qs" },
  ]),
  // inspection: create/update=pm|planning_eng|site_engineer|qs, delete=pm|planning_eng
  ...["itp", "material-tests"].flatMap((prefix) => [
    { prefix, method: "get", path: "/", allowed: "finance", denied: null },
    { prefix, method: "post", path: "/", allowed: "qs", denied: "warehouse" },
    { prefix, method: "post", path: "/", allowed: "site_engineer", denied: "procurement" },
    { prefix, method: "patch", path: `/${ID}`, allowed: "qs", denied: "finance" },
    { prefix, method: "delete", path: `/${ID}`, allowed: "planning_eng", denied: "qs" },
  ]),
  // punch: create=pm|planning_eng|site_engineer|qs, update=pm|planning_eng|site_engineer, delete=pm
  { prefix: "defects", method: "get", path: "/", allowed: "procurement", denied: null },
  { prefix: "defects", method: "post", path: "/", allowed: "qs", denied: "warehouse" },
  { prefix: "defects", method: "patch", path: `/${ID}`, allowed: "site_engineer", denied: "qs" },
  { prefix: "defects", method: "delete", path: `/${ID}`, allowed: "pm", denied: "planning_eng" },
  // cost: read=pm|planning_eng|qs|cost_controller|finance, create/update=pm|qs|cost_controller, delete=pm|cost_controller
  ...["budget-revisions", "cash-flow"].flatMap((prefix) => [
    { prefix, method: "get", path: "/", allowed: "finance", denied: "warehouse" },
    { prefix, method: "post", path: "/", allowed: "cost_controller", denied: "site_engineer" },
    { prefix, method: "delete", path: `/${ID}`, allowed: "cost_controller", denied: "qs" },
  ]),
  { prefix: "budget-revisions", method: "patch", path: `/${ID}`, allowed: "qs", denied: "finance" },
  { prefix: "cash-flow", method: "post", path: "/rebuild", allowed: "qs", denied: "finance" },
  // sub_pay_app: read=pm|qs|cost_controller|procurement|finance, create/update=pm|qs, delete=pm
  { prefix: "sub-valuations", method: "get", path: "/", allowed: "procurement", denied: "site_engineer" },
  { prefix: "sub-valuations", method: "get", path: "/attribution", allowed: "finance", denied: "warehouse" },
  { prefix: "sub-valuations", method: "post", path: "/", allowed: "qs", denied: "cost_controller" },
  { prefix: "sub-valuations", method: "patch", path: `/${ID}`, allowed: "qs", denied: "procurement" },
  { prefix: "sub-valuations", method: "delete", path: `/${ID}`, allowed: "pm", denied: "qs" },
  // eot: read=pm|planning_eng|qs|cost_controller|finance, create/update=pm|planning_eng|qs
  { prefix: "weather-delays", method: "get", path: "/", allowed: "cost_controller", denied: "warehouse" },
  { prefix: "weather-delays", method: "post", path: "/", allowed: "planning_eng", denied: "site_engineer" },
  { prefix: "weather-delays", method: "patch", path: `/${ID}`, allowed: "qs", denied: "finance" },
  { prefix: "weather-delays", method: "delete", path: `/${ID}`, allowed: "planning_eng", denied: "cost_controller" },
];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  for (const [prefix, router] of Object.entries(ROUTERS)) {
    app.use(`/projects/:projectId/${prefix}`, router);
  }
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.code || "INTERNAL", message: err.message, details: err.details },
    }),
  );
  return app;
}

describe("project route guards (P21-010)", () => {
  const app = buildApp();

  it.each(CASES.filter((c) => c.denied))(
    "$method $prefix$path refuses $denied",
    async ({ prefix, method, path, denied }) => {
      const res = await request(app)[method](`/projects/${ID}/${prefix}${path}`).set("x-role", denied).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    },
  );

  it.each(CASES)(
    "$method $prefix$path lets $allowed through the door",
    async ({ prefix, method, path, allowed }) => {
      const res = await request(app)[method](`/projects/${ID}/${prefix}${path}`).set("x-role", allowed).send({});
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(401);
    },
  );

  it("covers every route of every one of the ten routers, so a new route cannot slip in unguarded", () => {
    for (const [prefix, router] of Object.entries(ROUTERS)) {
      const routes = router.stack.filter((layer) => layer.route);
      expect(routes.length).toBeGreaterThan(0);
      for (const layer of routes) {
        const methods = Object.keys(layer.route.methods);
        for (const method of methods) {
          const covered = CASES.some((c) => c.prefix === prefix && c.method === method && (c.path === layer.route.path || (layer.route.path.startsWith("/:") && c.path === `/${ID}`)));
          expect({ prefix, method, path: layer.route.path, covered }).toEqual(expect.objectContaining({ covered: true }));
        }
        // Guard first, then validators and the handler — never the handler alone.
        expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
