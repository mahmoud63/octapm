const { HttpError } = require("../utils/http-error");
const aiProvider = require("./ai-provider.service");
const assistant = require("./assistant.service");
const reportBuilder = require("./report-builder.service");

/**
 * Natural-language reporting (OCTA-AI-NLREPORT-033).
 *
 *  - ask: a question in plain words becomes a report-builder definition
 *    (source, columns, filters, sort, grouping, aggregates, chart) chosen
 *    ONLY from the source catalogue, validated by the builder's own
 *    normaliser (anything unknown is dropped and reported as a warning),
 *    previewed as the caller and handed to the builder to refine and save.
 *    Without a provider a keyword reading of the question stands in.
 *  - narrate: a preview's totals, groups and sample rows become a short
 *    plain-language summary with highlights and caveats.
 * Nothing is saved by the assistant; the person saves the report.
 */

const PREVIEW_ROWS = 50;
const MAX_QUESTION = 1000;
const REPAIR_ROUNDS = 12;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const clip = (value, max) => {
  const text = trimOrNull(value);
  return text ? text.slice(0, max) : null;
};
const list = (value, max = 6, size = 300) => (Array.isArray(value) ? value.map((item) => clip(typeof item === "string" ? item : item?.text, size)).filter(Boolean).slice(0, max) : []);
const dateOnly = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value);

// ─── Catalogue ────────────────────────────────────────────────────────────

const catalogueText = (sourceList) =>
  sourceList
    .map((source) => `- ${source.key} (${source.label}; default sort ${source.defaultSort ? `${source.defaultSort.field} ${source.defaultSort.dir}` : "none"}):\n  columns: ${source.columns.map((column) => `${column.key}:${column.type}${column.enum ? `[${column.enum.join("|")}]` : ""}`).join(", ")}\n  default columns: ${source.defaultColumns.join(", ")}`)
    .join("\n");

const ASK_PROMPT = `You turn a question from a construction project team into a report definition for OctaPM's report builder.
Use ONLY the source keys and column keys in the catalogue. Pick the one source that answers the question; prefer the source's default columns plus whatever the question names.
Filters: {"field": <column key>, "op": <operator>, "value": …}. Operators: eq, neq, contains (strings); in / nin (value is a list); gt, gte, lt, lte (numbers, money, dates); between (value is [low, high]); empty, not_empty; is_true, is_false (booleans, no value); for dates also last_days / next_days (value is the number of days), before_today, after_today, today (no value). Dates are written YYYY-MM-DD. "open" items = status not in the closed values of that source's status enum, or a boolean like overdue = is_true where one exists.
groupBy is one column key or null. aggregates: [{"fn": "count"}] and/or {"fn": "sum|avg|min|max", "field": <number or money column>}. chart: {"type": "bar|line|pie|none", "metric": "count" or "<fn>_<field>"} — use a chart only when the question asks for one or groups the data.
Return ONLY a JSON object:
{"name": "short report name", "description": "one sentence", "source": "…", "columns": ["…"], "filters": [], "sort": {"field": "…", "dir": "asc|desc"} or null, "groupBy": null, "aggregates": [], "chart": null, "explanation": "one sentence on how the question was read", "assumptions": ["anything you had to assume"]}`;

const NARRATE_PROMPT = `You summarise the result of a construction project report for the person who asked for it. Use ONLY the figures given: totals, groups and the sample rows. Name the biggest groups and the outliers with their numbers; do not invent causes. Be brief.
Recommendations are optional: only where the figures point to something to check or chase next, each naming the group or row it rests on; never a figure that is not given.
Return ONLY a JSON object: {"headline": "one sentence with the key number", "summary": "2–4 sentences", "highlights": ["short facts with numbers"], "caveats": ["what the data cannot tell, e.g. truncation, skipped projects"], "recommendations": ["what to check or chase next"]}`;

// ─── Repair against the builder's own normaliser ──────────────────────────

const filterIndexFrom = (message) => {
  const match = /Filter (\d+):/.exec(String(message || ""));
  return match ? Number(match[1]) - 1 : -1;
};

/**
 * Normalises a proposed definition, dropping whatever the builder rejects
 * (unknown columns, filters, sort, group, aggregates) and saying so.
 */
const repair = async ({ orgId, proposal, sourceList }) => {
  const warnings = [];
  const sourceKeys = new Set(sourceList.map((source) => source.key));
  if (!sourceKeys.has(proposal.source)) throw new HttpError(400, "REPORT_SOURCE_UNKNOWN", `Unknown report source: ${proposal.source}`);
  let payload = { source: proposal.source, columns: Array.isArray(proposal.columns) ? proposal.columns.filter((key) => typeof key === "string") : [], filters: Array.isArray(proposal.filters) ? proposal.filters.filter((filter) => filter && typeof filter === "object") : [], sort: proposal.sort && typeof proposal.sort === "object" ? proposal.sort : null, groupBy: trimOrNull(proposal.groupBy), aggregates: Array.isArray(proposal.aggregates) ? proposal.aggregates.filter((aggregate) => aggregate && typeof aggregate === "object") : [], chart: proposal.chart && typeof proposal.chart === "object" ? proposal.chart : null, visibility: "private" };
  for (let round = 0; round < REPAIR_ROUNDS; round += 1) {
    try {
      const normalized = await reportBuilder.normalizeDefinition({ orgId, payload });
      return { normalized, warnings };
    } catch (error) {
      const code = error?.code;
      if (code === "REPORT_COLUMN_UNKNOWN") {
        const unknown = new Set(error.details?.unknown || String(error.message).replace(/^.*Unknown columns:\s*/, "").split(",").map((key) => key.trim()));
        payload.columns = payload.columns.filter((key) => !unknown.has(key));
        warnings.push(`Dropped unknown column${unknown.size === 1 ? "" : "s"} ${[...unknown].join(", ")}.`);
      } else if (code === "REPORT_FILTER_FIELD" || code === "REPORT_FILTER_OP" || code === "REPORT_FILTER_VALUE") {
        const index = filterIndexFrom(error.message);
        const dropped = index >= 0 ? payload.filters[index] : payload.filters[payload.filters.length - 1];
        payload.filters = payload.filters.filter((_, position) => position !== (index >= 0 ? index : payload.filters.length - 1));
        warnings.push(`Dropped a filter that could not be applied (${dropped?.field || "?"} ${dropped?.op || ""}): ${error.message}`);
        if (!dropped) throw error;
      } else if (code === "REPORT_SORT_FIELD") {
        warnings.push(`Ignored the sort on unknown field ${payload.sort?.field}.`);
        payload.sort = null;
      } else if (code === "REPORT_GROUP_FIELD") {
        warnings.push(`Ignored grouping by unknown field ${payload.groupBy}.`);
        payload.groupBy = null;
      } else if (code === "REPORT_AGGREGATE_FN" || code === "REPORT_AGGREGATE_FIELD") {
        warnings.push(`Dropped the aggregates the builder rejected: ${error.message}`);
        payload.aggregates = payload.aggregates.filter((aggregate) => aggregate.fn === "count");
        if (code === "REPORT_AGGREGATE_FN") payload.aggregates = [];
      } else throw error;
    }
  }
  throw new HttpError(400, "REPORT_NL_UNREPAIRABLE", "The proposed report could not be made valid");
};

// ─── Keyword fallback ─────────────────────────────────────────────────────

const SOURCE_KEYWORDS = [
  ["rfi", /\brfis?\b|request for information/],
  ["submittal", /submittal/],
  ["observation", /observation/],
  ["punch_item", /punch|snag|defect/],
  ["inspection", /inspection|\bitp\b|checklist|form/],
  ["ncr", /\bncrs?\b|non-?conform/],
  ["safety_incident", /safety|incident|near miss|accident/],
  ["change_order", /change order|variation|\bvos?\b|change event/],
  ["commitment", /commitment|subcontract|purchase contract/],
  ["sub_pay_app", /pay app|payment application|pay application/],
  ["ipc_certificate", /\bipc\b|payment certificate|certificate/],
  ["procurement_order", /purchase order|\bpos?\b|procurement/],
  ["long_lead", /long[- ]lead|lead time/],
  ["budget_line", /budget line|cost code/],
  ["cost_record", /\bcost\b|actual|spend|budget/],
  ["daily_log_manpower", /manpower|workers|crew|headcount|man-?hours/],
  ["daily_log", /daily log|site diary|daily report/],
  ["risk", /\brisks?\b/],
  ["task", /\btasks?\b|to-?do|action item/],
  ["activity", /activit|schedule|progress|milestone|critical/],
];

const heuristicDefinition = ({ question, sourceList }) => {
  const text = question.toLowerCase();
  const sourceKey = SOURCE_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] || "activity";
  const source = sourceList.find((item) => item.key === sourceKey) || sourceList[0];
  const column = (predicate) => source.columns.find(predicate) || null;
  const byKey = (key) => column((item) => item.key === key);
  const status = byKey("status");
  const filters = [];
  const assumptions = [];
  if (status?.enum) {
    if (/\bopen\b|outstanding|pending|unresolved/.test(text)) {
      const openValues = status.enum.filter((value) => !["closed", "complete", "completed", "approved", "rejected", "void", "cancelled", "paid", "archived", "answered", "delivered"].includes(value));
      if (openValues.length) {
        filters.push({ field: "status", op: "in", value: openValues });
        assumptions.push(`"open" read as status in ${openValues.join(", ")}.`);
      }
    } else if (/\bclosed\b|completed?\b|done\b/.test(text) && status.enum.some((value) => ["closed", "complete", "completed"].includes(value))) {
      filters.push({ field: "status", op: "in", value: status.enum.filter((value) => ["closed", "complete", "completed"].includes(value)) });
    }
  }
  const overdue = byKey("overdue") || column((item) => item.type === "boolean" && /overdue|late/i.test(item.label));
  if (overdue && /overdue|late\b/.test(text)) filters.push({ field: overdue.key, op: "is_true", value: null });
  const critical = column((item) => item.type === "boolean" && /critical/i.test(item.label));
  if (critical && /critical/.test(text)) filters.push({ field: critical.key, op: "is_true", value: null });
  const priority = byKey("priority");
  if (priority?.enum && /urgent|high priority/.test(text)) filters.push({ field: "priority", op: "in", value: priority.enum.filter((value) => ["high", "urgent", "critical"].includes(value)) });
  const dateColumn = column((item) => item.type === "date" && /raised|created|date|start|submitted|opened/i.test(item.label)) || column((item) => item.type === "date");
  const window = /last\s+(\d+)\s*(day|week|month)s?/.exec(text) || (/this week|past week/.test(text) ? [null, "7", "day"] : /this month|past month/.test(text) ? [null, "30", "day"] : null);
  if (dateColumn && window) {
    const days = Number(window[1]) * (window[2] === "week" ? 7 : window[2] === "month" ? 30 : 1);
    filters.push({ field: dateColumn.key, op: "last_days", value: days });
    assumptions.push(`Time window applied to ${dateColumn.label} (last ${days} days).`);
  }
  // "by trade this month" → try "by trade this", then "by trade" against the column labels.
  const groupMatch = /\bby\s+([a-z]+(?:\s+[a-z]+){0,2})/.exec(text);
  let groupBy = null;
  if (groupMatch) {
    const words = groupMatch[1].trim().split(/\s+/);
    for (let count = Math.min(words.length, 3); count >= 1 && !groupBy; count -= 1) {
      const wanted = words.slice(0, count).join(" ");
      const match = column((item) => item.label.toLowerCase() === wanted || item.key.toLowerCase() === wanted || (wanted === "project" && item.key === "project.name") || (wanted === "activity" && item.key === "activity.name")) || column((item) => item.label.toLowerCase().startsWith(wanted));
      if (match) groupBy = match.key;
    }
  }
  const aggregates = [{ fn: "count" }];
  const moneyColumn = column((item) => item.type === "money") || column((item) => item.type === "number");
  if (moneyColumn && /total|sum|value|amount|cost|spend|hours/.test(text)) aggregates.push({ fn: "sum", field: moneyColumn.key });
  const chart = groupBy ? { type: /\bpie\b/.test(text) ? "pie" : /\bline\b|\btrend/.test(text) ? "line" : "bar", metric: aggregates.length > 1 && /\btotal\b|\bsum\b|\bvalue\b|\bamount\b|\bcost\b/.test(text) ? `sum_${moneyColumn.key}` : "count" } : null;
  const name = question.trim().replace(/[?.]+$/, "");
  return {
    proposal: { name: name.charAt(0).toUpperCase() + name.slice(1, 160), description: `Built from the question "${question.trim().slice(0, 200)}"`, source: source.key, columns: [...new Set([...source.defaultColumns, ...(groupBy ? [groupBy] : [])])], filters, sort: source.defaultSort || null, groupBy, aggregates, chart, explanation: `Read the question by keywords: ${source.label}${filters.length ? ` filtered on ${filters.map((filter) => filter.field).join(", ")}` : ""}${groupBy ? `, grouped by ${groupBy}` : ""}.`, assumptions },
    reason: "AI reporting is not configured on this server; the question was read by keywords.",
  };
};

// ─── Ask ──────────────────────────────────────────────────────────────────

const serializeFilters = (filters) => filters.map((filter) => ({ ...filter, value: Array.isArray(filter.value) ? filter.value.map(dateOnly) : dateOnly(filter.value) }));

const definitionOut = ({ proposal, normalized, projectId }) => ({
  name: clip(proposal.name, 160) || "Report",
  description: clip(proposal.description, 2000),
  source: normalized.source,
  projectId: projectId || null,
  columns: normalized.columns,
  filters: serializeFilters(normalized.filters),
  sort: normalized.sort,
  groupBy: normalized.groupBy,
  aggregates: normalized.aggregates,
  chart: normalized.chart,
  visibility: "private",
});

const runMessage = (stored) => (stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null);

/**
 * The project a run is scoped to, decided before anything is read, sent to
 * a model or stored — as the assistant decides its project (assistant
 * routes, certification L46): 403 PROJECT_ACCESS_DENIED for a project of the
 * company the caller cannot open, 404 PROJECT_NOT_FOUND for any other id,
 * and an API key only on its own projects (report-builder runQuery). The
 * project came from the body unchecked: the preview was filtered, but the
 * run was stored against a project of the company the caller cannot open,
 * and whether a message came back told whether the id names one
 * (certification R19).
 */
const assertRunProject = async ({ orgId, user, projectId, apiClient = null }) => {
  if (!projectId) return null;
  if (apiClient?.projectIds?.length && !apiClient.projectIds.includes(projectId)) {
    throw new HttpError(403, "FORBIDDEN_PROJECT", "This API key is not allowed on that project");
  }
  const { assertProjectAccess } = require("./project-authorization.service");
  return assertProjectAccess({ orgId, projectId, userId: user.id, role: user.role, isCompanyAdmin: Boolean(user.isCompanyAdmin) });
};

const ask = async ({ orgId, user, question, projectId = null, transport = null, apiClient = null }) => {
  const text = trimOrNull(question);
  if (!text) throw new HttpError(400, "REPORT_NL_QUESTION_REQUIRED", "Ask for a report in a sentence");
  if (text.length > MAX_QUESTION) throw new HttpError(400, "REPORT_NL_QUESTION_TOO_LONG", `Keep the question under ${MAX_QUESTION} characters`);
  await assertRunProject({ orgId, user, projectId, apiClient });
  const sourceList = await reportBuilder.listSources({ orgId });
  let proposal;
  let degraded = false;
  let reason = null;
  let completion = null;
  let prompt = null;
  if (aiProvider.isEnabled() || transport) {
    prompt = `Today: ${new Date().toISOString().slice(0, 10)}${projectId ? "\nScope: one project" : "\nScope: every project the person can open"}\n\nCatalogue:\n${catalogueText(sourceList)}\n\nQuestion: ${text}`;
    try {
      completion = await aiProvider.complete({ feature: "report.ask", system: ASK_PROMPT, messages: [{ role: "user", content: prompt }], maxTokens: 1200, temperature: 0, transport });
      proposal = aiProvider.parseJsonAnswer(completion.text);
      if (!proposal || typeof proposal !== "object") throw Object.assign(new Error("The model did not return a report definition"), { code: "AI_UNAVAILABLE" });
    } catch (error) {
      if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
      degraded = true;
      reason = `${error.message} The question was read by keywords instead.`;
      completion = null;
      proposal = heuristicDefinition({ question: text, sourceList }).proposal;
    }
  } else {
    degraded = true;
    ({ proposal, reason } = heuristicDefinition({ question: text, sourceList }));
  }
  let repaired;
  try {
    repaired = await repair({ orgId, proposal, sourceList });
  } catch (error) {
    if (error?.code !== "REPORT_SOURCE_UNKNOWN" && error?.code !== "REPORT_NL_UNREPAIRABLE") throw error;
    const fallback = heuristicDefinition({ question: text, sourceList });
    repaired = await repair({ orgId, proposal: fallback.proposal, sourceList });
    repaired.warnings.unshift(`${error.message}; the source was chosen by keywords instead.`);
    proposal = { ...proposal, source: fallback.proposal.source, explanation: fallback.proposal.explanation };
  }
  const definition = definitionOut({ proposal, normalized: repaired.normalized, projectId });
  let preview = null;
  const warnings = [...repaired.warnings];
  try {
    preview = await reportBuilder.runQuery({ orgId, user, definition: { ...repaired.normalized, projectId: projectId || null }, limit: PREVIEW_ROWS, apiClient });
  } catch (error) {
    warnings.push(`Preview failed: ${error?.message || "unknown error"}`);
  }
  const explanation = clip(proposal.explanation, 500) || null;
  const assumptions = list(proposal.assumptions, 6);
  const stored = completion ? await assistant.storeRun({ orgId, user, projectId, kind: "report_nl", recordType: null, recordId: null, title: text.slice(0, 120), prompt, answer: JSON.stringify({ definition, explanation, assumptions, warnings }), usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null }).catch(() => null) : null;
  return { degraded, reason, question: text, definition, explanation, assumptions, warnings, preview: preview ? { ...preview, rows: preview.rows.slice(0, PREVIEW_ROWS) } : null, message: runMessage(stored) };
};

// ─── Narrate ──────────────────────────────────────────────────────────────

const money = (value) => (value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 }));

const digestOf = (result) => {
  const lines = [
    `Source: ${result.source.label}; ${result.total} rows across ${result.projects.queried} project${result.projects.queried === 1 ? "" : "s"}${result.projects.denied ? ` (${result.projects.denied} skipped for permissions)` : ""}${result.truncated ? "; truncated" : ""}`,
    `Totals: ${Object.entries(result.totals || {}).map(([key, value]) => `${key} ${money(value)}`).join(", ") || "count only"}`,
  ];
  if (result.groups?.length) {
    lines.push(`Groups by ${result.groupBy?.label || result.groupBy?.key} (${result.groups.length}):`);
    for (const group of result.groups.slice(0, 12)) lines.push(`- ${group.label}: ${Object.entries(group).filter(([key]) => !["key", "label"].includes(key)).map(([key, value]) => `${key} ${money(value)}`).join(", ")}`);
  }
  if (result.rows?.length) {
    lines.push(`Sample rows (${Math.min(8, result.rows.length)} of ${result.total}):`);
    for (const row of result.rows.slice(0, 8)) lines.push(`- ${result.columns.map((column) => `${column.label}: ${row[column.key] === null || row[column.key] === undefined ? "—" : column.type === "date" ? String(row[column.key]).slice(0, 10) : column.type === "money" ? money(row[column.key]) : String(row[column.key]).slice(0, 60)}`).join(" · ")}`);
  }
  return lines.join("\n");
};

const deterministicNarrative = (result) => {
  const top = (result.groups || []).slice(0, 3);
  const headline = `${result.total.toLocaleString("en-US")} ${result.source.label.toLowerCase()} across ${result.projects.queried} project${result.projects.queried === 1 ? "" : "s"}${top.length ? `; largest group ${top[0].label} (${top[0].count})` : ""}.`;
  const highlights = [...top.map((group) => `${group.label}: ${group.count}${Object.entries(group).filter(([key]) => !["key", "label", "count"].includes(key)).map(([key, value]) => `, ${key} ${money(value)}`).join("")}`), ...Object.entries(result.totals || {}).filter(([key]) => key !== "count").map(([key, value]) => `Total ${key.replace(/_/g, " ")}: ${money(value)}`)].slice(0, 6);
  const caveats = [result.truncated ? "The result was truncated; totals cover the rows returned." : null, result.projects.denied ? `${result.projects.denied} project${result.projects.denied === 1 ? "" : "s"} skipped because you cannot read this register there.` : null, result.total === 0 ? "No rows matched the filters." : null].filter(Boolean);
  return { headline, summary: `${headline}${top.length > 1 ? ` The next groups are ${top.slice(1).map((group) => `${group.label} (${group.count})`).join(" and ")}.` : ""}`, highlights, caveats };
};

const narrate = async ({ orgId, user, payload = {}, transport = null, apiClient = null }) => {
  await assertRunProject({ orgId, user, projectId: trimOrNull(payload.projectId), apiClient });
  const result = await reportBuilder.preview({ orgId, user, payload, limit: 200, apiClient });
  const fallback = deterministicNarrative(result);
  const digest = digestOf(result);
  // AI-5: `facts` is always the builder's own numbers (never a model's), so
  // the reader can tell FACT from the AI's interpretation (`narrative`, when
  // generatedBy is "ai") and its suggestions (`recommendations`).
  const facts = { headline: fallback.headline, items: fallback.highlights, caveats: fallback.caveats };
  const out = (narrative, degraded, reason, stored, recommendations = []) => ({ degraded, reason, facts, narrative, recommendations, generatedBy: degraded ? "rules" : "ai", result: { total: result.total, groups: result.groups?.length || 0, projects: result.projects, truncated: result.truncated }, message: runMessage(stored) });
  if (!aiProvider.isEnabled() && !transport) return out(fallback, true, "AI summaries are not configured on this server; this summary was built from the numbers.", null);
  let completion;
  try {
    completion = await aiProvider.complete({ feature: "report.narrate", system: NARRATE_PROMPT, messages: [{ role: "user", content: digest }], maxTokens: 700, temperature: 0.2, transport });
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return out(fallback, true, `${error.message} This summary was built from the numbers.`, null);
  }
  const parsed = aiProvider.parseJsonAnswer(completion.text);
  const narrative = { headline: clip(parsed?.headline, 300) || fallback.headline, summary: clip(parsed?.summary, 2000) || fallback.summary, highlights: (Array.isArray(parsed?.highlights) ? list(parsed.highlights, 8) : fallback.highlights), caveats: (Array.isArray(parsed?.caveats) ? list(parsed.caveats, 6) : fallback.caveats) };
  const stored = await assistant.storeRun({ orgId, user, projectId: trimOrNull(payload.projectId), kind: "report_narrative", title: `Narrative: ${result.source.label}`, prompt: digest, answer: JSON.stringify(narrative), usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null }).catch(() => null);
  return out(narrative, false, null, stored, list(parsed?.recommendations, 5));
};

module.exports = { ASK_PROMPT, NARRATE_PROMPT, SOURCE_KEYWORDS, catalogueText, repair, heuristicDefinition, ask, narrate, digestOf, deterministicNarrative };
