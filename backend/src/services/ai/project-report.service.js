/**
 * AI project status report (AI-5), in three parts the reader can tell apart:
 *
 *   FACT                the project's figures and records as OctaPM's own
 *                       services compute them for the caller (the project
 *                       digest: dashboard row and queues, already withheld
 *                       where the caller may not read them). Never written by
 *                       a model.
 *   AI INTERPRETATION   the model's reading of those facts, every statement
 *                       citing a numbered source.
 *   AI RECOMMENDATION   what the model suggests doing, each citing the facts
 *                       it rests on; a recommendation with no valid citation
 *                       is dropped, not shown.
 *
 * The model is not the authority for any figure, status, approval or
 * critical-path result. Without a provider the FACT part is the report.
 */
const gateway = require("./gateway");
const { requireAiAccess } = require("./context");
const briefService = require("./project-brief.service");
const { formatSources } = require("../retrieval.service");
const { parseJsonAnswer } = require("../ai-provider.service");
const { HttpError } = require("../../utils/http-error");
const { moduleSources } = require("./sources/module-sources");

const MAX_RECOMMENDATIONS = 5;

// The report kinds the Reports module offers (AI-7, Reports). Each adds the
// module sources of its subject (sources/module-sources, each deciding the
// caller's access itself) to the project digest, and sets the focus.
const KINDS = Object.freeze({
  status: { title: "status report", focus: "how the project stands on schedule, cost, commercial and supply chain", screens: [] },
  executive: { title: "executive summary", focus: "an executive summary for the client or company leadership: the three or four things that matter most, in plain words", screens: [["schedule", null], ["cost", null]] },
  weekly: { title: "weekly summary", focus: "the week: progress approved and still awaiting approval, what changed, what is late, and what is due next", screens: [["schedule", "progress"], ["schedule", null]] },
  monthly: { title: "monthly summary", focus: "the month: progress, schedule, cost, commercial and quality, and the trend", screens: [["schedule", "progress"], ["cost", null], ["commercial", "change-orders"], ["quality", null]] },
  commercial: { title: "commercial summary", focus: "the commercial position: cost against budget, forecast, commitments, cash flow and changes", screens: [["cost", null], ["commercial", "change-orders"], ["commercial", "commitments"]] },
  quality: { title: "quality summary", focus: "quality and safety: the quality score, NCRs, inspections, punch items and incidents", screens: [["quality", null], ["quality", "safety"]] },
  procurement: { title: "procurement summary", focus: "procurement: items at risk, purchase orders, long-lead exposure and bids", screens: [["procurement", null]] },
});

const systemFor = (focus) => `You write the AI part of a construction project report for the project team. You are given numbered sources: those titled as facts are OctaPM's own figures; the rest are records.
Write two things, from ONLY the sources:
1. "answer": the interpretation, 4 to 8 sentences: ${focus}, and what the facts mean together. Cite every statement as [n].
2. "recommendations": up to ${MAX_RECOMMENDATIONS} concrete actions for the coming week, most important first, each citing the sources it rests on.
Rules: restate figures exactly as given; never compute new figures, forecast dates or costs; never state that anything is approved, certified, paid or on the critical path unless a source says so. If the sources are thin, say what is missing instead of guessing.
Return ONLY a JSON object (no markdown fences): {"answer": "...", "citations": [1, 2], "recommendations": [{"text": "...", "citations": [2]}]}`;

const validNumbers = (values, sources) => [...new Set((Array.isArray(values) ? values : []).map(Number))].filter((n) => sources.some((source) => source.n === n)).sort((a, b) => a - b);
const citedIn = (text) => [...String(text || "").matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
const citationOf = (source) => ({ n: source.n, id: source.id, type: source.type, typeLabel: source.typeLabel, title: source.title, ref: source.ref || null, url: source.url || null });

const SYSTEM = systemFor(KINDS.status.focus);

const report = async ({ req, projectId, kind = "status", transport = null }) => {
  const spec = KINDS[kind];
  if (!spec) throw new HttpError(400, "INVALID_REPORT_KIND", "Unknown report kind");
  requireAiAccess({ orgId: req.user?.orgId, userId: req.user?.id, access: req.projectAccess });
  const digest = await briefService.digest(req, projectId);
  // The subject's own module results, each read under the caller's access
  // (the route's request is the project view: user, projectAccess).
  const extra = [];
  for (const [moduleKey, child] of spec.screens) {
    for (const source of await moduleSources({ view: req, projectId, moduleKey, child })) {
      if (![...digest.sources, ...extra].some((item) => item.id === source.id)) extra.push(source);
    }
  }
  const sources = [...digest.sources, ...extra].map((source, index) => ({ ...source, n: index + 1 }));
  const factLines = extra
    .filter((source) => /_facts$|_coverage$/.test(source.type))
    .map((source) => ({ source: source.typeLabel, lines: String(source.text || "").split("\n").map((line) => line.replace(/^FACT:\s*/, "")).filter(Boolean) }));
  const capabilities = gateway.capabilities();
  const result = {
    kind,
    title: `${digest.project.name || "Project"} ${spec.title}`,
    project: digest.project,
    cutoffDate: digest.cutoffDate,
    generatedAt: new Date().toISOString(),
    facts: digest.facts,
    factLines,
    attention: digest.items,
    sources: sources.map(({ text: _text, ...source }) => source),
    interpretation: null,
    recommendations: [],
    ai: { enabled: capabilities.enabled, mode: capabilities.mode, provider: null, model: null },
    degraded: false,
    degradedReason: null,
  };
  if (!capabilities.enabled && !transport) return { ...result, degraded: true, degradedReason: "AI_NOT_CONFIGURED" };
  if (!sources.length) return { ...result, degraded: true, degradedReason: "NO_SOURCES" };
  let completion;
  try {
    completion = await gateway.complete({
      feature: kind === "status" ? "report.project_status" : `report.${kind}`,
      system: systemFor(spec.focus),
      messages: [{ role: "user", content: `Project: ${digest.project.name || "this project"} (cutoff ${digest.cutoffDate})\n\nSources:\n${formatSources(sources)}\n\nQuestion: Write the ${spec.title}'s interpretation and recommendations.` }],
      maxTokens: 1400,
      temperature: 0.2,
      transport,
    });
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { ...result, degraded: true, degradedReason: error.code };
  }
  const parsed = parseJsonAnswer(completion.text) || {};
  const text = String(parsed.answer || "").trim();
  const byN = new Map(sources.map((source) => [source.n, source]));
  if (text) {
    const numbers = validNumbers([...(parsed.citations || []), ...citedIn(text)], sources);
    result.interpretation = { text, citations: numbers.map((n) => citationOf(byN.get(n))) };
  }
  result.recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
    .map((item) => {
      const recommendation = String((typeof item === "string" ? item : item?.text) || "").trim().slice(0, 600);
      const numbers = validNumbers([...(Array.isArray(item?.citations) ? item.citations : []), ...citedIn(recommendation)], sources);
      return recommendation && numbers.length ? { text: recommendation, citations: numbers.map((n) => citationOf(byN.get(n))) } : null;
    })
    .filter(Boolean)
    .slice(0, MAX_RECOMMENDATIONS);
  result.ai = { ...result.ai, provider: completion.provider || null, model: completion.model || null };
  return result;
};

module.exports = { report, SYSTEM, KINDS, MAX_RECOMMENDATIONS };
