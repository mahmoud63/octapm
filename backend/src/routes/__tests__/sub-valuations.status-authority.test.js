/**
 * Marking a sub valuation certified or paid is the certifying or paying
 * authority's act (Phase 21D, CX21-513).
 */
const express = require("express");
const request = require("supertest");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VALUATION_ID = "22222222-2222-4222-8222-222222222222";

jest.mock("../../config/db", () => ({ prisma: {} }));
const mockService = {
  listSubValuations: jest.fn(async () => ({ rows: [] })),
  createSubValuation: jest.fn(async () => ({ id: VALUATION_ID })),
  updateSubValuation: jest.fn(async ({ payload }) => ({ id: VALUATION_ID, ...payload })),
  deleteSubValuation: jest.fn(async () => ({ id: VALUATION_ID })),
  getSubValuation: jest.fn(async () => ({ id: VALUATION_ID })),
};
jest.mock("../../services/sub-valuation.service", () => mockService);

const router = require("../sub-valuations");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  // the project router authenticates before this one is reached
  app.use((req, _res, next) => {
    req.user = { id: "user-1", orgId: "org-1", role: req.get("x-role") || "qs" };
    next();
  });
  app.use("/projects/:projectId/sub-valuations", router);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message, details: err.details } }),
  );
  return app;
};

describe("Phase 21D — integrity (release challenge, tenth pass)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("CX21-513: an editor cannot mark a valuation paid or certified; the paying and certifying authority can", async () => {
    const app = buildApp();
    const paidByQs = await request(app).patch(`/projects/${PROJECT_ID}/sub-valuations/${VALUATION_ID}`).set("x-role", "qs").send({ status: "paid" });
    expect([paidByQs.status, paidByQs.body.error?.code]).toEqual([403, "FORBIDDEN"]);
    const certifiedByQs = await request(app).patch(`/projects/${PROJECT_ID}/sub-valuations/${VALUATION_ID}`).set("x-role", "qs").send({ status: "certified" });
    expect(certifiedByQs.status).toBe(403);
    expect(mockService.updateSubValuation).not.toHaveBeenCalled();

    const draftByQs = await request(app).patch(`/projects/${PROJECT_ID}/sub-valuations/${VALUATION_ID}`).set("x-role", "qs").send({ status: "submitted", workDone: 1000 });
    expect(draftByQs.status).toBe(200);
    const paidByPm = await request(app).patch(`/projects/${PROJECT_ID}/sub-valuations/${VALUATION_ID}`).set("x-role", "pm").send({ status: "paid" });
    expect(paidByPm.status).toBe(200);
    expect(mockService.updateSubValuation).toHaveBeenCalledTimes(2);
  });
});
