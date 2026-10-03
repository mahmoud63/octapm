const express = require("express");
const request = require("supertest");
const { HttpError } = require("../../utils/http-error");

/**
 * The organisation-mounted assistant decides the caller's access to a project
 * named in the body as that project's own assistant route would — the
 * project opened by the caller and the assistant readable there — before
 * the service stores, retrieves or calls a model (certification L46).
 */

const mockProject = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ASSIGNED = mockProject(1);
const TEMPLATE_DENIES = mockProject(2);
const UNASSIGNED = mockProject(3);
const FOREIGN = mockProject(4);

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "user-1", orgId: "org-1", role: "site_engineer", isCompanyAdmin: false };
    next();
  },
}));

const mockService = {
  ACTION_TYPES: ["create_rfi", "create_task", "open"],
  // The service asks the route's decision first, for the project it is scoped to.
  ask: jest.fn(async ({ projectId, accessFor }) => ({ projectId, access: projectId ? await accessFor(projectId) : null })),
};
jest.mock("../../services/assistant.service", () => mockService);

// Each project as the project middleware finds it for this caller; a project it refuses has no person.
const mockViews = {
  [ASSIGNED]: { projectAccess: { id: ASSIGNED, role: "site_engineer", partyAccess: [] } },
  [TEMPLATE_DENIES]: { projectAccess: { id: TEMPLATE_DENIES, role: "site_engineer", partyAccess: [], template: { deny: ["assistant"] } } },
};
jest.mock("../../middleware/project-access", () => ({
  requestForProject: jest.fn(async (req, projectId) => (mockViews[projectId] ? { user: req.user, params: { projectId }, ...mockViews[projectId] } : { user: null, params: { projectId } })),
}));
const mockAuthorization = {
  throwProjectNotFoundOrAccessDenied: jest.fn(async ({ projectId }) => {
    if (projectId === UNASSIGNED) throw new HttpError(403, "PROJECT_ACCESS_DENIED", "You are not assigned to this project");
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }),
};
jest.mock("../../services/project-authorization.service", () => mockAuthorization);
jest.mock("../../services/permission-template.service", () => ({
  templateAllows: jest.fn((template, { module }) => (template?.deny?.includes(module) ? false : null)),
}));

const assistantRoutes = require("../assistant");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/assistant", assistantRoutes.orgRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message } }));
  return app;
};
const ask = (projectId) => request(buildApp()).post("/assistant/ask").send({ question: "What is the contract value?", ...(projectId ? { projectId } : {}) });

describe("organisation assistant: a project in the body (certification L46)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses a project the caller is not on (403) and a project not of the company (404)", async () => {
    const unassigned = await ask(UNASSIGNED);
    expect(unassigned.status).toBe(403);
    expect(unassigned.body.error.code).toBe("PROJECT_ACCESS_DENIED");
    const foreign = await ask(FOREIGN);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("PROJECT_NOT_FOUND");
    expect(mockAuthorization.throwProjectNotFoundOrAccessDenied).toHaveBeenCalledWith({ orgId: "org-1", projectId: FOREIGN });
  });

  it("refuses a project whose permission template withholds the assistant", async () => {
    const res = await ask(TEMPLATE_DENIES);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("answers for a project the caller is on, with that project's access, and for no project at all", async () => {
    const res = await ask(ASSIGNED);
    expect(res.status).toBe(200);
    expect(res.body.data.access).toEqual(expect.objectContaining({ id: ASSIGNED, role: "site_engineer" }));
    expect(mockAuthorization.throwProjectNotFoundOrAccessDenied).not.toHaveBeenCalled();
    const general = await ask(null);
    expect(general.status).toBe(200);
    expect(general.body.data).toEqual({ projectId: null, access: null });
  });
});
