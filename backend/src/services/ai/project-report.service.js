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

const MAX_RECOMMENDATIONS = 5;

const SYSTEM = `You write the AI part of a construction project status report for the project manager. You are given numbered sources: [1] is the project's official facts, the rest are records needing attention.
Write two things, from ONLY the sources:
1. "answer": the interpretation, 4 to 8 sentences: how the project stands on schedule, cost, commercial and supply chain, and what the facts mean together. Cite every statement as [n].
2. "recommendations": up to ${MAX_RECOMMENDATIONS} concrete actions for the coming week, most important first, each citing the sources it rests on.
Rules: restate figures exactly as given; never compute new figures, forecast dates or costs; never state that anything is approved, certified, paid or on the critical path unless a source says so. If the sources are thin, say what is missing instead of guessing.
Return ONLY a JSON object (no markdown fences): {"answer": "...", "citations": [1, 2], "recommendations": [{"text": "...", "citations": [2]}]}`;

const validNumbers = (values, sources) => [...new Set((Array.isArray(values) ? values : []).map(Number))].filter((n) => sources.some((source) => source.n === n)).sort((a, b) => a - b);
const citedIn = (text) => [...String(text || "").matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
const citationOf = (source) => ({ n: source.n, id: source.id, type: source.type, typeLabel: source.typeLabel, title: source.title, ref: source.ref || null, url: source.url || null });

const report = async ({ req, projectId, transport = null }) => {
  requireAiAccess({ orgId: req.user?.orgId, userId: req.user?.id, access: req.projectAccess });
  const digest = await briefService.digest(req, projectId);
  const sources = digest.sources;
  const capabilities = gateway.capabilities();
  const result = {
    title: `${digest.project.name || "Project"} status report`,
    project: digest.project,
    cutoffDate: digest.cutoffDate,
    generatedAt: new Date().toISOString(),
    facts: digest.facts,
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
      feature: "report.project_status",
      system: SYSTEM,
      messages: [{ role: "user", content: `Project: ${digest.project.name || "this project"} (cutoff ${digest.cutoffDate})\n\nSources:\n${formatSources(sources)}\n\nQuestion: Write the status report's interpretation and recommendations.` }],
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

module.exports = { report, SYSTEM, MAX_RECOMMENDATIONS };
