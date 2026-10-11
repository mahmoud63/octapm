jest.mock("../../../config/db", () => ({ prisma: { aiRun: { create: jest.fn(async () => ({ id: "run-1" })) }, project: { findMany: jest.fn() } } }));
jest.mock("../sources/workspace-snapshot", () => ({ authorizedWorkspaceDashboard: jest.fn() }));
jest.mock("../../search.service", () => ({ globalSearch: jest.fn() }));

const { prisma } = require("../../../config/db");
const { authorizedWorkspaceDashboard } = require("../sources/workspace-snapshot");
const searchService = require("../../search.service");
const smart = require("../smart-search.service");

const RIVER = { id: "11111111-1111-4111-8111-111111111111", name: "Riverside Tower" };
const MARINA = { id: "22222222-2222-4222-8222-222222222222", name: "Marina Bay Residences" };
const HIDDEN = "33333333-3333-4333-8333-333333333333";
const TODAY = new Date("2026-10-10T12:00:00Z");
const req = { user: { orgId: "org-1", id: "u-1", role: "site_eng", isCompanyAdmin: false } };
const hit = (id, title, extra = {}) => ({ id, type: "rfi", typeLabel: "RFI", module: "rfi", projectId: RIVER.id, projectName: RIVER.name, title, subtitle: null, identifier: id.toUpperCase(), status: "open", url: `/projects/${RIVER.id}?module=docControl&recordId=${id}`, score: 1, ...extra });

describe("Smart Search (AI-4)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, AI_PROVIDER: "mock", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" };
    prisma.project.findMany.mockReset().mockResolvedValue([MARINA, RIVER]);
    searchService.globalSearch.mockReset().mockResolvedValue({ items: [] });
    authorizedWorkspaceDashboard.mockReset();
  });
  afterAll(() => { process.env = saved; });

  test("rules read types, statuses, overdue, the caller's project by name, dates and keywords", () => {
    expect(smart.interpret("overdue RFIs on Marina about acoustic walls", [RIVER, MARINA], TODAY)).toEqual({ keywords: ["acoustic", "walls"], types: ["rfi"], statuses: [], overdue: true, project: { id: MARINA.id, name: MARINA.name }, dateFrom: null, interpretedBy: "rules" });
    expect(smart.interpret("approved change orders last 30 days", [RIVER], TODAY)).toMatchObject({ types: ["change_order"], statuses: ["approved"], keywords: [], dateFrom: "2026-09-10", project: null });
    expect(smart.interpret("tasks in progress riverside tower", [RIVER], TODAY)).toMatchObject({ types: ["task"], statuses: ["in_progress"], project: { id: RIVER.id }, keywords: [] });
  });

  test("a project the caller cannot open is never picked, even by exact name", () => {
    expect(smart.interpret("rfis on Secret Tower", [RIVER], TODAY).project).toBeNull();
  });

  test("searches through the caller's own search, one keyword at a time, records matching more keywords first", async () => {
    searchService.globalSearch.mockImplementation(async ({ query }) => ({ items: query.q === "glazing" ? [hit("rfi-1", "Glazing bracket"), hit("rfi-2", "Glazing panel fixings")] : [hit("rfi-2", "Glazing panel fixings")] }));
    const result = await smart.search({ req, q: "open rfis glazing panel on riverside" });
    expect(searchService.globalSearch).toHaveBeenCalledTimes(2);
    for (const [args] of searchService.globalSearch.mock.calls) {
      expect(args).toMatchObject({ orgId: "org-1", userId: "u-1", role: "site_eng", isCompanyAdmin: false });
      expect(args.query).toMatchObject({ types: ["rfi"], status: ["open"], projectId: RIVER.id });
    }
    expect(result.items.map((item) => item.id)).toEqual(["rfi-2", "rfi-1"]);
    expect(result.interpretation.interpretedBy).toBe("rules");
  });

  test("overdue comes from the caller's own dashboard queues, narrowed to the type and project", async () => {
    authorizedWorkspaceDashboard.mockResolvedValue({ workflowQueues: [
      { key: "overdueRfis", label: "Overdue RFIs", count: 1, items: [{ id: "rfi-9", projectId: MARINA.id, projectName: MARINA.name, title: "RFI-003", meta: "Acoustic rating", severity: "attention", dueDate: "2026-10-02T00:00:00.000Z", target: { projectId: MARINA.id, module: "docControl", child: "rfi", recordId: "rfi-9" } }] },
      { key: "overdueTasks", label: "Overdue tasks", count: 4, items: [{ id: "t-1", projectId: MARINA.id, title: "Chase" }] },
    ] });
    const result = await smart.search({ req, q: "overdue rfis on marina" });
    expect(authorizedWorkspaceDashboard).toHaveBeenCalledWith(req, { projectId: MARINA.id });
    expect(searchService.globalSearch).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "rfi-9", type: "rfi", url: `/projects/${MARINA.id}?module=docControl&child=rfi&recordId=rfi-9` });
    expect(result.overdue).toEqual({ count: 1, shown: 1 });
  });

  test("a project scope the caller cannot open is refused before anything is searched", async () => {
    await expect(smart.search({ req, q: "rfis", projectId: HIDDEN })).rejects.toMatchObject({ status: 404 });
    expect(searchService.globalSearch).not.toHaveBeenCalled();
  });

  test("the mock never replaces the rules' reading; the answer cites only the results given", async () => {
    searchService.globalSearch.mockResolvedValue({ items: [hit("rfi-1", "Glazing bracket")] });
    const result = await smart.search({ req, q: "glazing", explain: true });
    expect(result.interpretation.interpretedBy).toBe("rules");
    expect(result.answer).toMatchObject({ mock: true, label: "AI interpretation" });
    expect(result.answer.citations.map((citation) => citation.id)).toEqual(["rfi-1"]);
  });

  test("with AI off the search still answers, with no AI answer", async () => {
    process.env.AI_PROVIDER = "disabled";
    searchService.globalSearch.mockResolvedValue({ items: [hit("rfi-1", "Glazing bracket")] });
    const result = await smart.search({ req, q: "glazing", explain: true });
    expect(result.items).toHaveLength(1);
    expect(result).toMatchObject({ answer: null, degraded: true });
  });
});
