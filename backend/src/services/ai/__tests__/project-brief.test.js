jest.mock("../../../config/db", () => ({ prisma: { aiRun: { create: jest.fn(async () => ({ id: "run-1" })) } } }));
jest.mock("../sources/workspace-snapshot", () => ({ authorizedWorkspaceDashboard: jest.fn() }));

const { authorizedWorkspaceDashboard } = require("../sources/workspace-snapshot");
const briefService = require("../project-brief.service");

const P = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const req = { user: { orgId: "org-1", id: "u-1", role: "pm" }, projectAccess: { id: P } };

// The caller's dashboard as the snapshot hands it over: one project's row (its
// budget withheld, as boq-figures does for a reader without BOQ or cost), a
// queue holding items of this project and another, and an item in their court.
const snapshot = () => ({
  projectHealth: [{ id: P, name: "Riverside Tower", status: "active", currency: "USD", contractValue: null, overallScore: 75, dimensions: { schedule: 60, cost: 40 }, weakestDimension: { key: "cost", label: "Cost", score: 40 }, spi: null, cpi: 0.74, ev: 3091720, ac: 4163436, bac: null, eac: null, criticalActivities: 2, target: { projectId: P, module: "overview" } }],
  workflowQueues: [
    { key: "procurementRisks", label: "Procurement risks", description: "Long-lead dates at risk", items: [
      { id: "pr-1", projectId: P, projectName: "Riverside Tower", title: "Glazing panel", meta: "order by missed", severity: "critical", dueDate: "2026-10-20T00:00:00.000Z", target: { projectId: P, module: "procurement", recordId: "pr-1" } },
      { id: "pr-2", projectId: OTHER, projectName: "Marina Bay", title: "Pumps", meta: "late", severity: "critical", dueDate: "2026-10-01T00:00:00.000Z", target: { projectId: OTHER, module: "procurement", recordId: "pr-2" } },
    ] },
    { key: "overdueRfis", label: "Overdue RFIs", items: [{ id: "rfi-1", projectId: P, title: "RFI-003", meta: "Acoustic rating", severity: "attention", dueDate: "2026-10-02T00:00:00.000Z", target: { projectId: P, module: "docControl", child: "rfi", recordId: "rfi-1" } }] },
  ],
  myOpenItems: { items: [
    { recordType: "rfi", label: "RFI", recordId: "rfi-1", ref: "RFI-003", title: "Acoustic rating", projectId: P, roles: ["ballInCourt"], overdue: true, target: { projectId: P, module: "docControl", child: "rfi", recordId: "rfi-1" } },
    { recordType: "task", label: "Task", recordId: "t-9", title: "Elsewhere", projectId: OTHER, roles: ["assignee"], target: { projectId: OTHER } },
  ] },
  openExceptions: { total: 1, bySeverity: { critical: 1, warning: 0 } },
});

describe("project brief (AI-3)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    authorizedWorkspaceDashboard.mockReset().mockResolvedValue(snapshot());
    process.env = { ...saved, AI_PROVIDER: "mock", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" };
  });
  afterAll(() => { process.env = saved; });

  test("reads only the caller's own dashboard, narrowed to the project, and lists only that project's records", async () => {
    const digest = await briefService.digest(req, P);
    expect(authorizedWorkspaceDashboard).toHaveBeenCalledWith(req, { projectId: P });
    expect(digest.items.map((item) => item.id)).toEqual(["pr-1", "rfi-1"]);
    expect(JSON.stringify(digest)).not.toMatch(/Marina Bay|Pumps|Elsewhere/);
    expect(digest.items[0].url).toBe(`/projects/${P}?module=procurement&recordId=pr-1`);
  });

  test("a figure withheld from the caller is left out, never estimated", async () => {
    const { facts, sources } = await briefService.digest(req, P);
    const keys = facts.map((fact) => fact.key);
    expect(keys).toEqual(expect.arrayContaining(["cpi", "ev", "ac", "health", "exceptions"]));
    expect(keys).not.toEqual(expect.arrayContaining(["bac"]));
    for (const absent of ["bac", "eac", "contractValue", "spi"]) expect(keys).not.toContain(absent);
    expect(facts.find((fact) => fact.key === "cpi").value).toBe("0.74 (below the 0.9 alert threshold)");
    expect(sources[0]).toMatchObject({ n: 1, type: "project_facts" });
    expect(sources[0].text).not.toMatch(/Budget at completion|Estimate at completion|Contract value/);
  });

  test("the narrative cites the numbered sources and is labelled an AI interpretation", async () => {
    const result = await briefService.brief({ req, projectId: P, kind: "attention" });
    expect(result.degraded).toBe(false);
    expect(result.narrative).toMatchObject({ provider: "mock", mock: true, label: "AI interpretation" });
    expect(result.narrative.citations.map((citation) => citation.n)).toEqual([1, 2, 3]);
    expect(result.sources.every((source) => source.text === undefined)).toBe(true);
  });

  test("without a provider the facts and the list still come back, with no narrative", async () => {
    process.env.AI_PROVIDER = "disabled";
    const result = await briefService.brief({ req, projectId: P, kind: "summary" });
    expect(result).toMatchObject({ degraded: true, degradedReason: "AI_NOT_CONFIGURED", narrative: null });
    expect(result.items).toHaveLength(2);
    expect(result.facts.length).toBeGreaterThan(3);
  });

  test("a provider failure degrades the same way instead of failing the request", async () => {
    const transport = jest.fn(async () => { const error = new Error("down"); error.status = 400; throw error; });
    const result = await briefService.brief({ req, projectId: P, kind: "attention", transport });
    expect(result).toMatchObject({ degraded: true, degradedReason: "AI_UNAVAILABLE", narrative: null });
    expect(result.items).toHaveLength(2);
  });

  test("the list without a narrative calls no model (what the overview loads on every visit)", async () => {
    const transport = jest.fn();
    const result = await briefService.brief({ req, projectId: P, kind: "attention", withNarrative: false, transport });
    expect(transport).not.toHaveBeenCalled();
    expect(result).toMatchObject({ narrative: null, degraded: false, ai: { enabled: true, mode: "mock" } });
    expect(result.items).toHaveLength(2);
  });

  test("no project access context, no read and no model call", async () => {
    await expect(briefService.brief({ req: { user: req.user }, projectId: P, kind: "attention" })).rejects.toMatchObject({ code: "AI_CONTEXT_MISSING" });
    expect(authorizedWorkspaceDashboard).not.toHaveBeenCalled();
  });
});
