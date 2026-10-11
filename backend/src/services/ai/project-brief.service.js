/**
 * Project Summary and What Needs Attention (AI-3).
 *
 * The facts and the attention list are deterministic: they are the caller's
 * own workspace dashboard for one project (sources/workspace-snapshot), so
 * every figure, queue and record is one the product already shows them, and
 * each figure keeps the product's own rule (EV, CPI, health). The model is
 * then given ONLY those numbered sources to explain and prioritise; it is
 * never the authority for a figure, a status or an approval. Without a
 * provider (or when it fails) the same facts and list are returned with no
 * narrative, so the feature still works.
 */
const gateway = require("./gateway");
const { requireAiAccess } = require("./context");
const { authorizedWorkspaceDashboard } = require("./sources/workspace-snapshot");
const { formatSources } = require("../retrieval.service");
const { parseJsonAnswer } = require("../ai-provider.service");

const MAX_ITEMS = 25;
// The alert threshold the product applies to SPI and CPI (CLAUDE.md business rules).
const INDEX_ALERT = 0.9;
const SEVERITY_ORDER = { critical: 0, overdue: 1, attention: 2, warning: 3 };
const DIMENSION_LABELS = { schedule: "Schedule", cost: "Cost", commercial: "Commercial", supplyChain: "Supply chain", quality: "Quality", safety: "Safety", docControl: "Document control" };

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const money = (value, currency) => `${currency ? `${currency} ` : ""}${Math.round(value).toLocaleString("en-US")}`;
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

/** The product's own link for a dashboard target (the dashboard's targetSearch). */
const urlFor = (target) => {
  if (!target?.projectId) return null;
  const params = new URLSearchParams();
  for (const key of ["module", "child", "status", "source", "recordId"]) if (target[key]) params.set(key, String(target[key]));
  const query = params.toString();
  return `/projects/${target.projectId}${query ? `?${query}` : ""}`;
};

/**
 * The project's facts as label/value lines, each from the dashboard row the
 * caller is given. A figure the caller may not read is null there and is
 * left out, never guessed.
 */
const factsOf = (row, openExceptions) => {
  if (!row) return [];
  const facts = [];
  const add = (key, label, value, rule = null) => facts.push({ key, label, value, ...(rule ? { rule } : {}) });
  add("status", "Status", row.status || "unknown");
  if (row.startDate || row.endDate) add("dates", "Planned dates", `${day(row.startDate) || "?"} to ${day(row.endDate) || "?"}`);
  if (isNumber(row.contractValue)) add("contractValue", "Contract value", money(row.contractValue, row.currency));
  if (isNumber(row.overallScore)) add("health", "Overall health score", `${row.overallScore}/100`, "Average of the seven health dimensions");
  if (row.weakestDimension?.label) add("weakest", "Weakest dimension", `${row.weakestDimension.label} (${row.weakestDimension.score}/100)`);
  if (row.dimensions && typeof row.dimensions === "object") {
    const parts = Object.entries(row.dimensions).filter(([, score]) => isNumber(score)).map(([key, score]) => `${DIMENSION_LABELS[key] || key} ${score}`);
    if (parts.length) add("dimensions", "Health dimensions", parts.join(", "));
  }
  if (isNumber(row.spi)) add("spi", "SPI", `${row.spi.toFixed(2)}${row.spi < INDEX_ALERT ? ` (below the ${INDEX_ALERT} alert threshold)` : ""}`, "SPI = EV / PV, official EV at today's cutoff");
  if (isNumber(row.cpi)) add("cpi", "CPI", `${row.cpi.toFixed(2)}${row.cpi < INDEX_ALERT ? ` (below the ${INDEX_ALERT} alert threshold)` : ""}`, "CPI = EV / AC, official EV and actual cost at today's cutoff");
  if (isNumber(row.ev)) add("ev", "Earned value", money(row.ev, row.currency));
  if (isNumber(row.ac)) add("ac", "Actual cost", money(row.ac, row.currency));
  if (isNumber(row.bac)) add("bac", "Budget at completion", money(row.bac, row.currency));
  if (isNumber(row.eac)) add("eac", "Estimate at completion", money(row.eac, row.currency), "EAC = budget / CPI");
  if (isNumber(row.criticalActivities)) add("critical", "Critical activities (open)", String(row.criticalActivities));
  if (isNumber(row.delayedActivities)) add("delayed", "Delayed activities", String(row.delayedActivities));
  if (isNumber(row.procurementRisks)) add("procurement", "Procurement items at risk", String(row.procurementRisks));
  if (isNumber(row.pendingChangeOrders)) add("changeOrders", "Pending change orders", String(row.pendingChangeOrders));
  if (isNumber(row.overdueNcrRfi)) add("overdueNcrRfi", "Overdue NCRs and RFIs", String(row.overdueNcrRfi));
  if (isNumber(row.overdueTasks)) add("overdueTasks", "Overdue tasks", String(row.overdueTasks));
  if (isNumber(openExceptions?.total)) add("exceptions", "Open exceptions", `${openExceptions.total} (critical ${openExceptions.bySeverity?.critical ?? 0}, warning ${openExceptions.bySeverity?.warning ?? 0})`);
  return facts;
};

/** Every queue entry and every item in the caller's court on this project, most urgent first. */
const attentionOf = (snapshot, projectId) => {
  const seen = new Set();
  const items = [];
  for (const queue of snapshot.workflowQueues || []) {
    for (const item of queue.items || []) {
      if (item.projectId !== projectId) continue;
      const key = item.target?.recordId || item.id;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ id: item.id, type: queue.key, typeLabel: queue.label, title: item.title, ref: null, status: item.target?.status || null, severity: item.severity || "attention", dueDate: item.dueDate || null, snippet: item.meta || null, projectId, projectName: item.projectName || null, url: urlFor(item.target), target: item.target || null, why: queue.description || null });
    }
  }
  for (const item of snapshot.myOpenItems?.items || []) {
    if (item.projectId !== projectId) continue;
    const key = item.recordId;
    if (seen.has(key)) continue;
    seen.add(key);
    const roles = Array.isArray(item.roles) ? item.roles : [];
    items.push({ id: item.recordId, type: `my_${item.recordType}`, typeLabel: `${item.label} in your court`, title: item.title, ref: item.ref || null, status: item.status || null, severity: item.overdue ? "overdue" : "attention", dueDate: item.dueDate || null, snippet: roles.length ? `Your role: ${roles.join(", ")}` : null, projectId, projectName: item.projectName || null, url: urlFor(item.target), target: item.target || null, why: "Assigned to you or waiting on you" });
  }
  const dueKey = (item) => (item.dueDate ? new Date(item.dueDate).getTime() : Number.MAX_SAFE_INTEGER);
  items.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || dueKey(a) - dueKey(b));
  return items.slice(0, MAX_ITEMS);
};

/**
 * The project's authorised digest: its facts and attention list as numbered
 * sources ([1] is the facts). Ask OctaPM reads the same digest, so a
 * natural question about the project is grounded in what the caller sees.
 */
const digest = async (req, projectId) => {
  const snapshot = await authorizedWorkspaceDashboard(req, { projectId });
  const row = (snapshot.projectHealth || []).find((item) => item.id === projectId) || null;
  const facts = factsOf(row, snapshot.openExceptions);
  const items = attentionOf(snapshot, projectId);
  const projectName = row?.name || null;
  const factsSource = facts.length
    ? { id: projectId, type: "project_facts", typeLabel: "Project facts", title: `${projectName || "Project"} at today's cutoff`, ref: null, status: row?.status || null, projectId, projectName, url: urlFor(row?.target || { projectId, module: "overview" }), snippet: null, text: facts.map((fact) => `FACT: ${fact.label}: ${fact.value}${fact.rule ? ` [rule: ${fact.rule}]` : ""}`).join("\n") }
    : null;
  const sources = [factsSource, ...items.map((item) => ({ ...item, text: [item.snippet, item.dueDate ? `Due: ${day(item.dueDate)}` : null, `Severity: ${item.severity}`, item.why ? `Why listed: ${item.why}` : null].filter(Boolean).join("\n") }))]
    .filter(Boolean)
    .map((source, index) => ({ n: index + 1, ...source }));
  return { project: row ? { id: row.id, name: row.name, status: row.status, currency: row.currency || null } : { id: projectId, name: null }, facts, items, sources, cutoffDate: new Date().toISOString().slice(0, 10) };
};

const PROMPTS = {
  attention: `You are OctaPM's project controls assistant. From ONLY the numbered sources, write a short "What needs attention" brief for the project team: the three to five things to act on first, most urgent first, each with why it matters and who or what it waits on, citing its source as [n].
You are not the authority for any figure, status, approval, cost, progress or critical-path result: restate the sources' figures exactly, never compute new ones, never claim something was approved, certified or paid. If the sources show nothing urgent, say so. Separate what the sources state from your recommendation.
Return ONLY a JSON object (no markdown fences): {"answer": "...markdown, cite like [1]...", "citations": [1, 2]}`,
  summary: `You are OctaPM's project controls assistant. From ONLY the numbered sources, write a project summary for a project manager in three short parts: "Where the project stands" (schedule, cost, commercial and supply chain, from the facts), "What is at risk", and "Suggested focus". Cite every statement as [n].
You are not the authority for any figure, status, approval, cost, progress or critical-path result: restate the sources' figures exactly, never compute new ones. If a figure is absent from the sources, do not mention or estimate it. If the sources are thin, say so.
Return ONLY a JSON object (no markdown fences): {"answer": "...markdown, cite like [1]...", "citations": [1, 2]}`,
};

const QUESTIONS = { attention: "What needs attention on this project first?", summary: "Summarise where this project stands." };

const citationsOf = (answer, citations, sources) => {
  const numbers = new Set((Array.isArray(citations) ? citations : []).map(Number).filter(Number.isInteger));
  for (const match of String(answer || "").matchAll(/\[(\d+)\]/g)) numbers.add(Number(match[1]));
  return [...numbers].sort((a, b) => a - b).map((n) => sources.find((source) => source.n === n)).filter(Boolean).map((source) => ({ n: source.n, id: source.id, type: source.type, typeLabel: source.typeLabel, title: source.title, ref: source.ref, url: source.url }));
};

/**
 * The deterministic brief, with an AI narrative when a provider answers.
 * `kind` is "attention" or "summary". `transport` lets tests inject a model.
 */
const brief = async ({ req, projectId, kind, withNarrative = true, transport = null }) => {
  requireAiAccess({ orgId: req.user?.orgId, userId: req.user?.id, access: req.projectAccess });
  const data = await digest(req, projectId);
  const publicSources = data.sources.map(({ text: _text, ...source }) => source);
  const status = gateway.capabilities();
  const result = { kind, project: data.project, cutoffDate: data.cutoffDate, generatedAt: new Date().toISOString(), facts: data.facts, items: data.items, sources: publicSources, narrative: null, ai: { enabled: status.enabled, mode: status.mode }, degraded: false, degradedReason: null };
  if (!withNarrative) return result;
  if (!status.enabled && !transport) return { ...result, degraded: true, degradedReason: "AI_NOT_CONFIGURED" };
  if (!data.sources.length) return { ...result, degraded: true, degradedReason: "NO_SOURCES" };
  try {
    const completion = await gateway.complete({
      feature: kind === "summary" ? "ai.summary" : "ai.attention",
      system: PROMPTS[kind],
      messages: [{ role: "user", content: `Project: ${data.project.name || "this project"} (cutoff ${data.cutoffDate})\n\nSources:\n${formatSources(data.sources)}\n\nQuestion: ${QUESTIONS[kind]}` }],
      maxTokens: 900,
      temperature: 0.2,
      transport,
    });
    const parsed = parseJsonAnswer(completion.text);
    const text = String(parsed?.answer || completion.text || "").trim();
    result.narrative = { text, citations: citationsOf(text, parsed?.citations, data.sources), provider: completion.provider || null, model: completion.model || null, mock: completion.provider === "mock", label: "AI interpretation" };
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { ...result, degraded: true, degradedReason: error.code };
  }
  return result;
};

module.exports = { digest, brief, factsOf, attentionOf, urlFor, PROMPTS, MAX_ITEMS };
