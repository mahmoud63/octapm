jest.mock("../../../config/db", () => ({ prisma: { aiRun: { create: jest.fn(async () => ({ id: "run-1" })) } } }));
jest.mock("../project-brief.service", () => ({ digest: jest.fn() }));
jest.mock("../sources/module-sources", () => ({ moduleSources: jest.fn(async () => []) }));

const briefService = require("../project-brief.service");
const reportService = require("../project-report.service");

const P = "11111111-1111-4111-8111-111111111111";
const req = { user: { orgId: "org-1", id: "u-1", role: "pm" }, projectAccess: { id: P } };
const DIGEST = {
  project: { id: P, name: "Riverside Tower", status: "active" },
  cutoffDate: "2026-10-10",
  facts: [{ key: "cpi", label: "CPI", value: "0.74 (below the 0.9 alert threshold)" }],
  items: [{ id: "pr-1", type: "procurementRisks", typeLabel: "Procurement risks", title: "Glazing panel", severity: "critical" }],
  sources: [
    { n: 1, id: P, type: "project_facts", typeLabel: "Project facts", title: "Riverside Tower at today's cutoff", url: `/projects/${P}`, text: "FACT: CPI: 0.74 (below the 0.9 alert threshold)" },
    { n: 2, id: "pr-1", type: "procurementRisks", typeLabel: "Procurement risks", title: "Glazing panel", url: `/projects/${P}?module=procurement&recordId=pr-1`, text: "order by missed" },
  ],
};
const answer = (body) => jest.fn(async () => ({ text: JSON.stringify(body), usage: { inputTokens: 10, outputTokens: 10 } }));

describe("AI project status report (AI-5)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, AI_PROVIDER: "mock", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" };
    briefService.digest.mockReset().mockResolvedValue(DIGEST);
  });
  afterAll(() => { process.env = saved; });

  test("facts come from the digest, never from the model; interpretation and recommendations are kept apart and cited", async () => {
    const transport = answer({ answer: "Cost is under pressure [1]; glazing is late [2].", citations: [1], recommendations: [{ text: "Expedite the glazing order [2]", citations: [2] }] });
    const result = await reportService.report({ req, projectId: P, transport });
    expect(briefService.digest).toHaveBeenCalledWith(req, P);
    expect(result.facts).toEqual(DIGEST.facts);
    expect(result.interpretation.citations.map((citation) => citation.n)).toEqual([1, 2]);
    expect(result.recommendations).toEqual([{ text: "Expedite the glazing order [2]", citations: [expect.objectContaining({ n: 2, id: "pr-1" })] }]);
    expect(result.sources.every((source) => source.text === undefined)).toBe(true);
  });

  test("a recommendation citing nothing, or only sources that were never given, is dropped", async () => {
    const transport = answer({ answer: "Fine [1].", citations: [1], recommendations: [{ text: "Hire more staff", citations: [] }, { text: "Ask the client [7]", citations: [7] }, "Chase the glazing order [2]"] });
    const result = await reportService.report({ req, projectId: P, transport });
    expect(result.recommendations.map((item) => item.text)).toEqual(["Chase the glazing order [2]"]);
  });

  test("the mock fills both AI parts from the sources alone, labelled as the mock", async () => {
    const result = await reportService.report({ req, projectId: P });
    expect(result.ai).toMatchObject({ mode: "mock", provider: "mock" });
    expect(result.interpretation.text).toMatch(/Development mock answer/);
    expect(result.recommendations).toEqual([{ text: expect.stringMatching(/^Mock: review Procurement risks/), citations: [expect.objectContaining({ n: 2 })] }]);
  });

  test("without AI the facts are the report", async () => {
    process.env.AI_PROVIDER = "disabled";
    const result = await reportService.report({ req, projectId: P });
    expect(result).toMatchObject({ degraded: true, degradedReason: "AI_NOT_CONFIGURED", interpretation: null, recommendations: [] });
    expect(result.facts).toHaveLength(1);
  });

  test("a commercial summary adds the commercial screens' own results, read as the caller, as fact lines and sources", async () => {
    const { moduleSources } = require("../sources/module-sources");
    moduleSources.mockImplementation(async ({ moduleKey, child }) => (moduleKey === "cost" ? [{ id: `${P}:cost`, type: "cost_facts", typeLabel: "Cost (OctaPM cost ledger)", title: "Cost", text: "FACT: Cost ledger totals: budget 100, actual 120" }] : child === "change-orders" ? [{ id: `${P}:change`, type: "change_facts", typeLabel: "Change management", title: "Change register", text: "FACT: 2 change orders: 1 pending" }] : []));
    const result = await reportService.report({ req, projectId: P, kind: "commercial" });
    expect(moduleSources.mock.calls.map(([args]) => [args.moduleKey, args.child, args.view])).toEqual([["cost", null, req], ["commercial", "change-orders", req], ["commercial", "commitments", req]]);
    expect(result.title).toBe("Riverside Tower commercial summary");
    expect(result.factLines).toEqual([{ source: "Cost (OctaPM cost ledger)", lines: ["Cost ledger totals: budget 100, actual 120"] }, { source: "Change management", lines: ["2 change orders: 1 pending"] }]);
    expect(result.sources.map((source) => source.n)).toEqual([1, 2, 3, 4]);
    await expect(reportService.report({ req, projectId: P, kind: "gossip" })).rejects.toMatchObject({ code: "INVALID_REPORT_KIND" });
  });

  test("no project access context, nothing read", async () => {
    await expect(reportService.report({ req: { user: req.user }, projectId: P })).rejects.toMatchObject({ code: "AI_CONTEXT_MISSING" });
    expect(briefService.digest).not.toHaveBeenCalled();
  });
});
