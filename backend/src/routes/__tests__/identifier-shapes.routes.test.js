/**
 * CERT-2 "wrongly shaped identifiers": express-validator's standard
 * validators check an array element by element, so `isUUID()` alone let
 * `engineerIds: [["<id>"]]` or `recordId: ["<id>"]` through to the service,
 * where Prisma threw (500). Each identifier field below is now `.isString()`
 * before `.isUUID()`: an array (or nested array) in its place is a 400
 * VALIDATION_ERROR naming that field, before the service is called — the same
 * answer whoever's identifier the array wraps. The identifier itself, as a
 * plain string, passes the field's check.
 *
 * The routers are mounted with every service they import replaced by a stub,
 * so only the routes' own validation runs.
 */
const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "11111111-1111-4111-8111-111111111111", orgId: "org-1", name: "Tester", role: "pm", isCompanyAdmin: true };
    next();
  },
}));

// A service stub: every export is a jest.fn (resolving a small record), except
// the constants a route reads when it is loaded.
const mockService = (constants = {}) =>
  new Proxy(
    { ...constants },
    {
      get(target, key) {
        if (key === "__esModule") return false;
        if (typeof key === "symbol") return undefined;
        if (!(key in target)) target[key] = jest.fn(async () => ({ id: "stubbed", items: [] }));
        return target[key];
      },
    },
  );

jest.mock("../../services/activity.service", () => mockService());
jest.mock("../../services/controls-detail.service", () => mockService());
jest.mock("../../services/quantity-views.service", () => mockService());
jest.mock("../../services/progress.service", () => mockService());
jest.mock("../../services/quantity-progress.service", () => mockService());
jest.mock("../../services/material.service", () => mockService());
jest.mock("../../services/workflow-engine.service", () => mockService({ INSTANCE_STATUS: { RUNNING: "running" } }));
jest.mock("../../services/prime-contract.service", () => mockService());
jest.mock("../../services/bid.service", () => mockService({ STATUS: { DRAFT: "draft" }, COMMITMENT_TYPES: ["subcontract"] }));
jest.mock("../../services/form.service", () => mockService({ TYPES: ["inspection"], OUTCOMES: ["pass"], SIGNATURE_ROLES: ["inspector"] }));
jest.mock("../../services/budget.service", () => mockService());
jest.mock("../../services/activity-boq-allocation.service", () => mockService());
jest.mock("../../services/mapping-suggestion.service", () => mockService());
jest.mock("../../services/mapping-import.service", () => mockService());
// Its constants (party roles, access levels) are read by the parties routes as they load.
const mockActualConstants = (path, overrides = {}) => {
  const actual = jest.requireActual(path);
  const constants = Object.fromEntries(Object.entries(actual).filter(([, value]) => typeof value !== "function"));
  return mockService({ ...constants, ...overrides });
};
jest.mock("../../services/company-party.service", () => mockActualConstants("../../services/company-party.service", { isPartyScopedAccess: () => false }));
jest.mock("../../services/location.service", () => mockService());
jest.mock("../../services/earned-value.service", () => mockService());
jest.mock("../../services/long-lead.service", () => mockService());
jest.mock("../../services/procurement.service", () => mockService());
jest.mock("../../services/goods-receipt.service", () => mockService());
jest.mock("../../services/change-order.service", () => mockService());
jest.mock("../../services/direct-cost.service", () => mockService({ TYPES: ["invoice"], COST_TYPES: ["material"], STATUS: { DRAFT: "draft" } }));
jest.mock("../../services/daily-report.service", () => mockService());
jest.mock("../../services/rfi.service", () => mockService());
jest.mock("../../services/rfi-workflow.service", () => mockService({ MAX_PEOPLE: 50 }));
jest.mock("../../services/rfi-assistant.service", () => mockService());
jest.mock("../../services/submittal.service", () => mockService());
jest.mock("../../services/submittal-workflow.service", () => mockService());
jest.mock("../../services/conversation.service", () => mockService({ KINDS: ["direct", "group", "record"], MAX_MEMBERS: 50 }));
jest.mock("../../services/comment.service", () => mockService());
jest.mock("../../services/document-text.service", () => mockService({ recordVisibleToViewer: async () => true }));
jest.mock("../../services/custom-field.service", () => mockService({ RECORD_TYPE_KEYS: ["task"] }));
jest.mock("../../services/notification.service", () => mockService());
jest.mock("../../services/push.service", () => mockService());

const ID = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const R = "44444444-4444-4444-8444-444444444444";

const mounts = {
  activities: "/projects/:projectId/activities",
  workflows: "/projects/:projectId/workflows",
  bids: "/projects/:projectId/bids",
  forms: "/projects/:projectId/forms",
  budget: "/projects/:projectId/budget",
  "activity-boq-allocations": "/projects/:projectId/activity-boq-allocations",
  "project-parties": "/projects/:projectId/parties",
  locations: "/projects/:projectId/locations",
  reports: "/projects/:projectId/reports",
  "long-lead": "/projects/:projectId/long-lead",
  procurement: "/projects/:projectId/procurement",
  "change-orders": "/projects/:projectId/change-orders",
  "direct-costs": "/projects/:projectId/direct-costs",
  "daily-reports": "/projects/:projectId/daily-reports",
  rfi: "/projects/:projectId/rfi",
  submittals: "/projects/:projectId/submittals",
  conversations: "/conversations",
  comments: "/projects/:projectId/comments",
  "custom-fields": "/projects/:projectId/custom-fields",
  notifications: "/notifications",
  "project-team": "/projects/:projectId/team",
};

const buildApp = () => {
  const app = express();
  app.use(express.json());
  for (const [name, mount] of Object.entries(mounts)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    app.use(mount, require(`../${name}`));
  }
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message, details: err.details } }));
  return app;
};

// [route, method, url, body(value), the field's path in the refusal]
const cases = [
  ["POST activities engineerIds[]", "post", `/projects/${P}/activities`, (v) => ({ name: "Pour", engineerIds: [v] }), "engineerIds[0]"],
  ["PATCH activities/:id engineerIds[]", "patch", `/projects/${P}/activities/${R}`, (v) => ({ engineerIds: [v] }), "engineerIds[0]"],
  ["POST activities/bulk-progress updates[].activityId", "post", `/projects/${P}/activities/bulk-progress`, (v) => ({ updates: [{ activityId: v, pctComplete: 5 }] }), "updates[0].activityId"],
  ["POST workflows/instances recordId", "post", `/projects/${P}/workflows/instances`, (v) => ({ tool: "correspondence", recordId: v }), "recordId"],
  ["POST workflows/instances templateId", "post", `/projects/${P}/workflows/instances`, (v) => ({ tool: "correspondence", recordId: R, templateId: v }), "templateId"],
  ["POST bids/:id/lines/from-boq boqItemIds[]", "post", `/projects/${P}/bids/${R}/lines/from-boq`, (v) => ({ boqItemIds: [v] }), "boqItemIds[0]"],
  ["POST forms activityId", "post", `/projects/${P}/forms`, (v) => ({ templateId: R, activityId: v }), "activityId"],
  ["POST forms locationId", "post", `/projects/${P}/forms`, (v) => ({ templateId: R, locationId: v }), "locationId"],
  ["POST forms assigneeCompanyId", "post", `/projects/${P}/forms`, (v) => ({ templateId: R, assigneeCompanyId: v }), "assigneeCompanyId"],
  ["PUT budget/cost-codes costCodeIds[]", "put", `/projects/${P}/budget/cost-codes`, (v) => ({ costCodeIds: [v] }), "costCodeIds[0]"],
  ["PUT budget/change-orders/:id/line lineId", "put", `/projects/${P}/budget/change-orders/${R}/line`, (v) => ({ lineId: v }), "lineId"],
  ["POST activity-boq-allocations boqItemId", "post", `/projects/${P}/activity-boq-allocations`, (v) => ({ boqItemId: v, activityId: R, quantity: 1 }), "boqItemId"],
  ["POST activity-boq-allocations activityId", "post", `/projects/${P}/activity-boq-allocations`, (v) => ({ boqItemId: R, activityId: v, quantity: 1 }), "activityId"],
  ["PATCH activity-boq-allocations/:id boqItemId", "patch", `/projects/${P}/activity-boq-allocations/${R}`, (v) => ({ boqItemId: v }), "boqItemId"],
  ["PATCH activity-boq-allocations/:id activityId", "patch", `/projects/${P}/activity-boq-allocations/${R}`, (v) => ({ activityId: v }), "activityId"],
  ["POST parties companyId", "post", `/projects/${P}/parties`, (v) => ({ role: "subcontractor", companyId: v }), "companyId"],
  ["POST parties/:id/members userId", "post", `/projects/${P}/parties/${R}/members`, (v) => ({ userId: v }), "userId"],
  ["POST locations/reorder orderedIds[]", "post", `/projects/${P}/locations/reorder`, (v) => ({ orderedIds: [v] }), "orderedIds[0]"],
  ["POST reports/cost-loading activityId", "post", `/projects/${P}/reports/cost-loading`, (v) => ({ activityId: v, plannedDate: "2026-10-01", plannedValue: 1 }), "activityId"],
  ["POST reports/cost-loading reportingPeriodId", "post", `/projects/${P}/reports/cost-loading`, (v) => ({ activityId: R, reportingPeriodId: v, plannedDate: "2026-10-01", plannedValue: 1 }), "reportingPeriodId"],
  ["PATCH reports/cost-loading/:id activityId", "patch", `/projects/${P}/reports/cost-loading/${R}`, (v) => ({ activityId: v }), "activityId"],
  ["PATCH reports/cost-loading/:id reportingPeriodId", "patch", `/projects/${P}/reports/cost-loading/${R}`, (v) => ({ reportingPeriodId: v }), "reportingPeriodId"],
  ["POST long-lead activityId", "post", `/projects/${P}/long-lead`, (v) => ({ item: "Crane", activityId: v }), "activityId"],
  ["POST long-lead procurementPackageId", "post", `/projects/${P}/long-lead`, (v) => ({ item: "Crane", procurementPackageId: v }), "procurementPackageId"],
  ["PATCH long-lead/:id activityId", "patch", `/projects/${P}/long-lead/${R}`, (v) => ({ activityId: v }), "activityId"],
  ["PATCH long-lead/:id procurementPackageId", "patch", `/projects/${P}/long-lead/${R}`, (v) => ({ procurementPackageId: v }), "procurementPackageId"],
  ["POST activities/:id/materials supplierId", "post", `/projects/${P}/activities/${R}/materials`, (v) => ({ name: "Cement", supplierId: v }), "supplierId"],
  ["PATCH activities/:id/materials/:id supplierId", "patch", `/projects/${P}/activities/${R}/materials/${ID}`, (v) => ({ supplierId: v }), "supplierId"],
  ["POST procurement/suppliers companyId", "post", `/projects/${P}/procurement/suppliers`, (v) => ({ companyId: v }), "companyId"],
  ["POST procurement/packages activityId", "post", `/projects/${P}/procurement/packages`, (v) => ({ title: "Blocks", activityId: v }), "activityId"],
  ["POST procurement/packages supplierId", "post", `/projects/${P}/procurement/packages`, (v) => ({ title: "Blocks", supplierId: v }), "supplierId"],
  ["POST procurement/purchase-orders supplierId", "post", `/projects/${P}/procurement/purchase-orders`, (v) => ({ item: "Blocks", supplierId: v, lines: [{ activityId: R }] }), "supplierId"],
  ["POST procurement/purchase-orders packageId", "post", `/projects/${P}/procurement/purchase-orders`, (v) => ({ item: "Blocks", packageId: v, lines: [{ activityId: R }] }), "packageId"],
  ["POST procurement/purchase-orders commitmentId", "post", `/projects/${P}/procurement/purchase-orders`, (v) => ({ item: "Blocks", commitmentId: v, lines: [{ activityId: R }] }), "commitmentId"],
  ["POST procurement/purchase-orders activityId", "post", `/projects/${P}/procurement/purchase-orders`, (v) => ({ item: "Blocks", activityId: v, lines: [{ activityId: R }] }), "activityId"],
  ["POST procurement/purchase-orders lines[].activityId", "post", `/projects/${P}/procurement/purchase-orders`, (v) => ({ item: "Blocks", lines: [{ activityId: v }] }), "lines[0].activityId"],
  ["POST procurement/purchase-orders lines[].activityMaterialId", "post", `/projects/${P}/procurement/purchase-orders`, (v) => ({ item: "Blocks", lines: [{ activityId: R, activityMaterialId: v }] }), "lines[0].activityMaterialId"],
  ["POST change-orders activityId", "post", `/projects/${P}/change-orders`, (v) => ({ description: "Extra", activityId: v }), "activityId"],
  ["POST change-orders activityLinks[].activityId", "post", `/projects/${P}/change-orders`, (v) => ({ description: "Extra", activityLinks: [{ activityId: v }] }), "activityLinks[0].activityId"],
  ["POST change-orders affectedActivityIds[]", "post", `/projects/${P}/change-orders`, (v) => ({ description: "Extra", affectedActivityIds: [v] }), "affectedActivityIds[0]"],
  ["PATCH change-orders/:id activityId", "patch", `/projects/${P}/change-orders/${R}`, (v) => ({ activityId: v }), "activityId"],
  ["PATCH change-orders/:id activityLinks[].activityId", "patch", `/projects/${P}/change-orders/${R}`, (v) => ({ activityLinks: [{ activityId: v }] }), "activityLinks[0].activityId"],
  ["PATCH change-orders/:id affectedActivityIds[]", "patch", `/projects/${P}/change-orders/${R}`, (v) => ({ affectedActivityIds: [v] }), "affectedActivityIds[0]"],
  ["POST direct-costs lines[].poLineId", "post", `/projects/${P}/direct-costs`, (v) => ({ description: "Invoice", costDate: "2026-10-01", lines: [{ description: "Line", poLineId: v }] }), "lines[0].poLineId"],
  ["POST daily-reports activityId", "post", `/projects/${P}/daily-reports`, (v) => ({ activityId: v, date: "2026-10-01" }), "activityId"],
  ["PATCH daily-reports/:id activityId", "patch", `/projects/${P}/daily-reports/${R}`, (v) => ({ activityId: v }), "activityId"],
  ["POST rfi managerUserId", "post", `/projects/${P}/rfi`, (v) => ({ subject: "Level", question: "Which?", managerUserId: v }), "managerUserId"],
  ["POST rfi assigneeUserIds[]", "post", `/projects/${P}/rfi`, (v) => ({ subject: "Level", question: "Which?", assigneeUserIds: [v] }), "assigneeUserIds[0]"],
  ["POST rfi distributionUserIds[]", "post", `/projects/${P}/rfi`, (v) => ({ subject: "Level", question: "Which?", distributionUserIds: [v] }), "distributionUserIds[0]"],
  ["POST rfi locationId", "post", `/projects/${P}/rfi`, (v) => ({ subject: "Level", question: "Which?", locationId: v }), "locationId"],
  ["PUT rfi/:id/people managerUserId", "put", `/projects/${P}/rfi/${R}/people`, (v) => ({ managerUserId: v }), "managerUserId"],
  ["PUT rfi/:id/people assigneeUserIds[]", "put", `/projects/${P}/rfi/${R}/people`, (v) => ({ assigneeUserIds: [v] }), "assigneeUserIds[0]"],
  ["PUT rfi/:id/people distributionUserIds[]", "put", `/projects/${P}/rfi/${R}/people`, (v) => ({ distributionUserIds: [v] }), "distributionUserIds[0]"],
  ["POST submittals workflowTemplateId", "post", `/projects/${P}/submittals`, (v) => ({ title: "Mill certificate", workflowTemplateId: v }), "workflowTemplateId"],
  ["POST submittals/packages submittalIds[]", "post", `/projects/${P}/submittals/packages`, (v) => ({ name: "Package", submittalIds: [v] }), "submittalIds[0]"],
  ["POST submittals/packages/:id/items submittalIds[]", "post", `/projects/${P}/submittals/packages/${R}/items`, (v) => ({ submittalIds: [v] }), "submittalIds[0]"],
  ["POST conversations memberUserIds[]", "post", "/conversations", (v) => ({ kind: "group", memberUserIds: [v] }), "memberUserIds[0]"],
  ["POST conversations/:id/members userIds[]", "post", `/conversations/${R}/members`, (v) => ({ userIds: [v] }), "userIds[0]"],
  ["POST comments parentId", "post", `/projects/${P}/comments`, (v) => ({ recordType: "activity", recordId: R, body: "Agreed", parentId: v }), "parentId"],
  ["PUT custom-fields/assignments fieldsetId", "put", `/projects/${P}/custom-fields/assignments`, (v) => ({ recordType: "task", fieldsetId: v }), "fieldsetId"],
  ["POST notifications/scan-due projectId", "post", "/notifications/scan-due", (v) => ({ projectId: v }), "projectId"],
  ["POST team userId", "post", `/projects/${P}/team`, (v) => ({ userId: v }), "userId"],
  // The shapes reviewer's fields (CERT-2 round 3): each answered 500.
  ["POST forms sheetId", "post", `/projects/${P}/forms`, (v) => ({ templateId: R, sheetId: v }), "sheetId"],
  ["PATCH forms/:id sheetId", "patch", `/projects/${P}/forms/${R}`, (v) => ({ sheetId: v }), "sheetId"],
  ["POST activities/:id/materials procurementPackageId", "post", `/projects/${P}/activities/${R}/materials`, (v) => ({ name: "Cement", procurementPackageId: v }), "procurementPackageId"],
  ["PATCH activities/:id/materials/:id procurementPackageId", "patch", `/projects/${P}/activities/${R}/materials/${ID}`, (v) => ({ procurementPackageId: v }), "procurementPackageId"],
  ["PUT budget/cost-codes removeCostCodeIds[]", "put", `/projects/${P}/budget/cost-codes`, (v) => ({ removeCostCodeIds: [v] }), "removeCostCodeIds[0]"],
  ["POST activity-boq-allocations locationId", "post", `/projects/${P}/activity-boq-allocations`, (v) => ({ boqItemId: R, activityId: R, quantity: 1, locationId: v }), "locationId"],
  ["PATCH activity-boq-allocations/:id locationId", "patch", `/projects/${P}/activity-boq-allocations/${R}`, (v) => ({ locationId: v }), "locationId"],
  ...["boqItemId", "activityId", "locationId"].map((f) => [`POST activity-boq-allocations/bulk allocations[].${f}`, "post", `/projects/${P}/activity-boq-allocations/bulk`, (v) => ({ allocations: [{ boqItemId: R, activityId: R, quantity: 1, [f]: v }] }), `allocations[0].${f}`]),
  // Every activity a workflow record names (the existence-oracle fields).
  ...[["rfi", "post", `/projects/${P}/rfi`, { subject: "Level", question: "Which?" }], ["rfi/:id", "patch", `/projects/${P}/rfi/${R}`, {}], ["submittals", "post", `/projects/${P}/submittals`, { title: "Mill certificate" }], ["submittals/:id", "patch", `/projects/${P}/submittals/${R}`, {}]].flatMap(([name, method, url, base]) => [
    [`${method.toUpperCase()} ${name} activityId`, method, url, (v) => ({ ...base, activityId: v }), "activityId"],
    [`${method.toUpperCase()} ${name} activityIds[]`, method, url, (v) => ({ ...base, activityIds: [v] }), "activityIds[0]"],
    [`${method.toUpperCase()} ${name} activityLinks[].activityId`, method, url, (v) => ({ ...base, activityLinks: [{ activityId: v }] }), "activityLinks[0].activityId"],
  ]),
];

const fieldsNamed = (res) => (res.body?.error?.code === "VALIDATION_ERROR" ? (res.body.error.details || []).map((d) => d.field) : []);

describe("identifier fields refuse any value that is not one string (CERT-2 shapes)", () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test.each(cases)("%s", async (_name, method, url, body, field) => {
    for (const shaped of [[ID], [[ID]]]) {
      const res = await request(app)[method](url).send(body(shaped));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(fieldsNamed(res)).toContain(field);
    }
    // The identifier itself, as one string, passes this field's check.
    const plain = await request(app)[method](url).send(body(ID));
    expect(fieldsNamed(plain)).not.toContain(field);
  });
});

// A bid package's BOQ sections are section names; an element in any other
// shape reached Prisma's `in` list (500). "" is the "(no section)" key.
describe("bid lines from the BOQ: sections[] are section names (CERT-2 shapes)", () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });
  const url = `/projects/${P}/bids/${R}/lines/from-boq`;

  test.each([[[["x"]]], [[{ not: "x" }]], [[12345]], [[true]], [[null]], [[[ID]]]])("refuses sections %j", async (sections) => {
    const res = await request(app).post(url).send({ sections });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(fieldsNamed(res)).toContain("sections[0]");
  });

  it("passes section names, the no-section key among them", async () => {
    const res = await request(app).post(url).send({ sections: ["", "Concrete works"] });
    expect(fieldsNamed(res)).not.toContain("sections[0]");
    expect(fieldsNamed(res)).not.toContain("sections[1]");
  });
});
