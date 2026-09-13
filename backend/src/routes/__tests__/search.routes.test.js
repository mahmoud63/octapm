const express = require("express");
const request = require("supertest");

const mockGlobalSearch = jest.fn();

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: "user-1",
      orgId: "org-1",
      role: "pm",
    };
    next();
  },
}));

jest.mock("../../middleware/subscription-gate", () => ({
  subscriptionGate: (_req, _res, next) => next(),
}));

jest.mock("../../services/search.service", () => ({
  globalSearch: mockGlobalSearch,
}));

const searchRoutes = require("../search");

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/search", searchRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || "TEST_ERROR",
        message: err.message,
        details: err.details,
      },
    });
  });
  return app;
};

describe("search routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGlobalSearch.mockResolvedValue({
      query: "rfi",
      items: [],
      groups: [],
      filters: {},
      meta: {
        limit: 20,
        total: 0,
        authorizedProjectCount: 0,
        searchableTypes: [],
      },
    });
  });

  it("passes authenticated context and filters to global search", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/search")
      .query({
        q: "slab",
        type: "rfi,submittal",
        status: "open",
        limit: 10,
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(mockGlobalSearch).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: "user-1",
      role: "pm",
      apiClient: null,
      query: expect.objectContaining({
        q: "slab",
        type: "rfi,submittal",
        status: "open",
        limit: 10,
      }),
    });
  });

  it("rejects invalid project filters before search execution", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/search")
      .query({ projectId: "not-a-uuid" })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(mockGlobalSearch).not.toHaveBeenCalled();
  });
});
