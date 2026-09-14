/**
 * The BOQ register is read under the BOQ permission — a project's template
 * and a key's scope decide, not authentication alone (Phase 21D, CX21-526).
 */
const express = require("express");
const request = require("supertest");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

jest.mock("../../config/db", () => ({ prisma: {} }));
jest.mock("../../middleware/auth", () => ({ authenticate: (_req, _res, next) => next() }));
jest.mock("../../middleware/rate-limit", () => ({ aiGenerationLimiter: (_req, _res, next) => next(), uploadLimiter: (_req, _res, next) => next() }));
const mockBoq = { getProjectBoq: jest.fn(async () => ({ items: [{ id: "b1" }] })), findShadowActivities: jest.fn(async () => ({ items: [] })) };
jest.mock("../../services/boq.service", () => mockBoq);
jest.mock("../../services/file-storage.service", () => ({}));
jest.mock("../../jobs/job.service", () => ({ getLegacyJob: jest.fn(async () => ({ id: "job-1", status: "done" })) }));

const mockTemplates = jest.requireActual("../../services/permission-template.service");
const denyBoq = mockTemplates.compileTemplate({ id: "tpl-1", name: "No BOQ", kind: "internal", baseRole: "pm", tools: [{ module: "boq", level: "none" }], grants: [] });

const router = require("../boq");

const buildApp = ({ role = "pm", template = null, apiClient = null } = {}) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "user-1", orgId: "org-1", role };
    req.projectAccess = { id: PROJECT_ID, role, partyAccess: [], ...(template ? { template } : {}) };
    if (apiClient) req.apiClient = apiClient;
    next();
  });
  app.use("/projects/:projectId/boq", router);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message, details: err.details } }),
  );
  return app;
};

describe("Phase 21D — integrity (release challenge, eleventh pass)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("CX21-526: the BOQ register, its shadow-activity report and its job status are refused to a template that refuses BOQ and to a key without a boq scope, and served to a PM", async () => {
    const denied = buildApp({ template: denyBoq });
    for (const path of ["", "/shadow-activities", "/job/22222222-2222-4222-8222-222222222222"]) {
      const res = await request(denied).get(`/projects/${PROJECT_ID}/boq${path}`);
      expect([path, res.status, res.body.error?.details?.source]).toEqual([path, 403, "template"]);
    }
    expect(mockBoq.getProjectBoq).not.toHaveBeenCalled();

    const keyed = buildApp({ apiClient: { id: "key-1", scopes: ["task:read"], projectIds: [PROJECT_ID] } });
    expect((await request(keyed).get(`/projects/${PROJECT_ID}/boq`)).status).toBe(403);
    expect(mockBoq.getProjectBoq).not.toHaveBeenCalled();

    const pm = buildApp();
    expect((await request(pm).get(`/projects/${PROJECT_ID}/boq`)).status).toBe(200);
    expect(mockBoq.getProjectBoq).toHaveBeenCalledTimes(1);
  });
});
