/**
 * Smart Search (AI-4): a plain-language query ("overdue RFIs on Marina Bay",
 * "approved submittals last 30 days", "glazing") turned into the search
 * filters OctaPM already has, then run through them.
 *
 * Authorisation is never the interpreter's: every result comes from
 *   - search.service globalSearch, which reads only the projects the caller
 *     can open and, on each, only the modules they may read; or
 *   - for "overdue" / "late", the caller's own dashboard queues
 *     (sources/workspace-snapshot), decided module by module the same way.
 * The interpreter only chooses filters from fixed lists (types, statuses,
 * the caller's own project names, date ranges). A live model may refine
 * that choice, and is held to the same lists; it never sees a record.
 * An optional answer explains the results the caller was given, citing them.
 */
const { prisma } = require("../../config/db");
const { HttpError } = require("../../utils/http-error");
const gateway = require("./gateway");
const { requireAiAccess } = require("./context");
const { authorizedWorkspaceDashboard } = require("./sources/workspace-snapshot");
const { getProjectAccessWhere } = require("../project-authorization.service");
const searchService = require("../search.service");
const { formatSources } = require("../retrieval.service");
const { parseJsonAnswer } = require("../ai-provider.service");

const MAX_QUERY = 300;
const MAX_KEYWORDS = 4;
const LIMIT = 30;

// Words → the search's own types. Multi-word phrases are matched first.
const TYPE_PHRASES = [
  ["change orders", "change_order"], ["change order", "change_order"], ["long lead", "long_lead"], ["long-lead", "long_lead"],
  ["variation orders", "change_order"], ["purchase orders", "procurement"],
];
const TYPE_WORDS = {
  rfi: "rfi", rfis: "rfi", submittal: "submittal", submittals: "submittal", drawing: "drawing", drawings: "drawing",
  document: "document", documents: "document", docs: "document", doc: "document", variation: "change_order", variations: "change_order",
  vo: "change_order", vos: "change_order", co: "change_order", cos: "change_order", ipc: "ipc", ipcs: "ipc", payment: "ipc", payments: "ipc",
  risk: "risk", risks: "risk", procurement: "procurement", package: "procurement", packages: "procurement", meeting: "meeting",
  meetings: "meeting", minutes: "meeting", task: "task", tasks: "task", activity: "activity", activities: "activity", boq: "boq",
  project: "project", projects: "project", ncr: "ncr", ncrs: "ncr", safety: "safety", incidents: "safety", incident: "safety",
};
// "ncr" and "safety" are not search types; they are answered from the overdue queues only.
const QUEUE_ONLY_TYPES = new Set(["ncr", "safety"]);
const STATUS_PHRASES = [["in progress", "in_progress"], ["under review", "under_review"], ["not ordered", "not_ordered"], ["in delivery", "in_delivery"]];
const STATUS_WORDS = new Set(["open", "answered", "closed", "approved", "rejected", "pending", "draft", "submitted", "certified", "paid", "superseded", "blocked", "done", "awarded", "delivered", "ordered", "cancelled", "monitoring", "resubmit", "finalized", "distributed", "tendering", "planning", "todo"]);
const OVERDUE_WORDS = new Set(["overdue", "late", "past-due", "lapsed"]);
const STOPWORDS = new Set("a an the and or of on in at for to from by with about all any show me my our list find get give what which who are is was were there that this those these please records record items item due".split(" "));
const OVERDUE_QUEUES = { rfi: ["overdueRfis"], submittal: ["overdueSubmittals"], task: ["overdueTasks"], ncr: ["overdueNcrs"], safety: ["overdueSafety"], risk: ["overdueRiskMitigations"], procurement: ["procurementRisks"], long_lead: ["procurementRisks"] };
const ALL_OVERDUE_QUEUES = ["overdueRfis", "overdueSubmittals", "overdueTasks", "overdueNcrs", "overdueSafety", "overdueRiskMitigations"];
const QUEUE_TYPE = { overdueRfis: "rfi", overdueSubmittals: "submittal", overdueTasks: "task", overdueNcrs: "ncr", overdueSafety: "safety", overdueRiskMitigations: "risk", procurementRisks: "procurement" };

const isoDay = (date) => date.toISOString().slice(0, 10);
const daysAgo = (today, days) => isoDay(new Date(today.getTime() - days * 86_400_000));

/** A date range named in the query: today, this/last week or month, last N days, since YYYY-MM-DD. */
const dateRangeOf = (text, today = new Date()) => {
  const lastN = /\b(?:last|past)\s+(\d{1,3})\s+days?\b/.exec(text);
  if (lastN) return { dateFrom: daysAgo(today, Number(lastN[1])), phrase: lastN[0] };
  const since = /\bsince\s+(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (since) return { dateFrom: since[1], phrase: since[0] };
  const named = [["today", 0], ["this week", 7], ["last week", 14], ["this month", 31], ["last month", 62]].find(([phrase]) => text.includes(phrase));
  return named ? { dateFrom: daysAgo(today, named[1]), phrase: named[0] } : null;
};

/** A project of the caller's named in the query: its full name, or its first word when distinctive. */
const projectOf = (text, projects) => {
  const byFull = projects.find((project) => text.includes(project.name.toLowerCase()));
  if (byFull) return { project: byFull, phrase: byFull.name.toLowerCase() };
  for (const project of projects) {
    const first = project.name.toLowerCase().split(/\s+/)[0];
    if (first.length >= 4 && !STOPWORDS.has(first) && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) return { project, phrase: first };
  }
  return null;
};

/**
 * The query's filters by rule: types, statuses, overdue, project, dates and
 * the remaining keywords. Deterministic, so search works with AI off.
 */
const interpret = (raw, projects = [], today = new Date()) => {
  let text = ` ${String(raw || "").toLowerCase().replace(/[^\p{L}\p{N}\s\-/]/gu, " ").replace(/\s+/g, " ").trim()} `;
  const consume = (phrase) => { text = text.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " "); };
  const types = new Set();
  const statuses = new Set();
  let overdue = false;
  const found = projectOf(text, projects);
  if (found) consume(found.phrase);
  const range = dateRangeOf(text, today);
  if (range) consume(range.phrase);
  for (const [phrase, type] of TYPE_PHRASES) if (text.includes(` ${phrase} `)) { types.add(type); consume(phrase); }
  for (const [phrase, status] of STATUS_PHRASES) if (text.includes(` ${phrase} `)) { statuses.add(status); consume(phrase); }
  if (/\bpast due\b/.test(text)) { overdue = true; consume("past due"); }
  const keywords = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (TYPE_WORDS[word]) types.add(TYPE_WORDS[word]);
    else if (STATUS_WORDS.has(word)) statuses.add(word);
    else if (OVERDUE_WORDS.has(word)) overdue = true;
    else if (!STOPWORDS.has(word) && word.length > 1 && !keywords.includes(word)) keywords.push(word);
  }
  return {
    keywords: keywords.slice(0, MAX_KEYWORDS),
    types: [...types],
    statuses: [...statuses],
    overdue,
    project: found ? { id: found.project.id, name: found.project.name } : null,
    dateFrom: range?.dateFrom || null,
    interpretedBy: "rules",
  };
};

const SEARCH_TYPES = ["project", "activity", "boq", "rfi", "submittal", "drawing", "document", "change_order", "ipc", "risk", "procurement", "long_lead", "meeting", "task", "ncr", "safety"];

/**
 * A live model's reading of the query, held to the same lists; anything
 * outside them is dropped. The mock and a failure leave the rules' reading.
 */
const refine = async (raw, intent, projects) => {
  if (gateway.capabilities().mode !== "live") return intent;
  try {
    const completion = await gateway.complete({
      feature: "search.interpret",
      system: `Turn a construction project-management search into filters. Allowed types: ${SEARCH_TYPES.join(", ")}. Allowed statuses: ${[...STATUS_WORDS, "in_progress", "under_review"].join(", ")}. Allowed projects: ${projects.map((project) => project.name).join("; ") || "none"}.
Return ONLY a JSON object: {"keywords": ["..."], "types": [], "statuses": [], "overdue": false, "project": null, "dateFrom": null}. Keywords are the subject words to match in record text (at most 4). Use only allowed values; leave out anything unsure.`,
      messages: [{ role: "user", content: String(raw).slice(0, MAX_QUERY) }],
      maxTokens: 200,
      temperature: 0,
    });
    const parsed = parseJsonAnswer(completion.text);
    if (!parsed || typeof parsed !== "object" || parsed.mock) return intent;
    const project = typeof parsed.project === "string" ? projects.find((item) => item.name.toLowerCase() === parsed.project.toLowerCase()) : null;
    const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => item.toLowerCase().trim()) : []);
    return {
      keywords: strings(parsed.keywords).filter((word) => word && word.length <= 40).slice(0, MAX_KEYWORDS),
      types: strings(parsed.types).filter((type) => SEARCH_TYPES.includes(type)),
      statuses: strings(parsed.statuses).filter((status) => STATUS_WORDS.has(status) || status === "in_progress" || status === "under_review"),
      overdue: parsed.overdue === true,
      project: project ? { id: project.id, name: project.name } : intent.project,
      dateFrom: typeof parsed.dateFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dateFrom) ? parsed.dateFrom : intent.dateFrom,
      interpretedBy: "ai",
    };
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return intent;
  }
};

const matches = (item, keyword) => [item.title, item.subtitle, item.identifier, item.projectName].some((value) => value && String(value).toLowerCase().includes(keyword));

/** The overdue items the caller's own dashboard queues hold, narrowed by type, project and keyword. */
const overdueItems = async (req, intent) => {
  const keys = intent.types.length ? [...new Set(intent.types.flatMap((type) => OVERDUE_QUEUES[type] || []))] : ALL_OVERDUE_QUEUES;
  if (!keys.length) return { items: [], count: 0 };
  const snapshot = await authorizedWorkspaceDashboard(req, { projectId: intent.project?.id || null });
  const items = [];
  let count = 0;
  for (const queue of snapshot.workflowQueues || []) {
    if (!keys.includes(queue.key)) continue;
    count += Number(queue.count) || 0;
    for (const item of queue.items || []) {
      const params = new URLSearchParams();
      for (const key of ["module", "child", "status", "source", "recordId"]) if (item.target?.[key]) params.set(key, String(item.target[key]));
      items.push({ id: item.id, type: QUEUE_TYPE[queue.key] || queue.key, typeLabel: queue.label, module: item.target?.module || null, projectId: item.projectId, projectName: item.projectName || null, title: item.title, subtitle: item.meta || null, identifier: null, status: item.severity || null, date: item.dueDate || null, url: `/projects/${item.projectId}${params.toString() ? `?${params}` : ""}`, score: 0, metadata: { dueDate: item.dueDate || null }, reason: queue.description || "Overdue on your dashboard" });
    }
  }
  return { items, count };
};

/**
 * Runs a smart search for the caller. `explain` adds an AI answer over the
 * results they were given (citing them); off by default (cost control).
 */
const search = async ({ req, q, projectId = null, explain = false, transport = null }) => {
  const text = String(q || "").trim();
  if (text.length < 2) throw new HttpError(400, "SEARCH_QUERY_REQUIRED", "Type at least two characters");
  if (text.length > MAX_QUERY) throw new HttpError(400, "SEARCH_QUERY_TOO_LONG", `Keep the search under ${MAX_QUERY} characters`);
  const { orgId, id: userId, role, isCompanyAdmin } = req.user || {};
  // The caller's own projects: the only names the interpreter may pick from.
  const projects = await prisma.project.findMany({ where: { orgId, archivedAt: null, ...getProjectAccessWhere({ userId, role, isCompanyAdmin, orgId }) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  requireAiAccess({ orgId, userId, access: projects });

  let intent = await refine(text, interpret(text, projects), projects);
  if (projectId) {
    const scoped = projects.find((project) => project.id === projectId);
    if (!scoped) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    intent = { ...intent, project: { id: scoped.id, name: scoped.name } };
  }

  let items = [];
  let overdue = null;
  if (intent.overdue) {
    overdue = await overdueItems(req, intent);
    items = intent.keywords.length ? overdue.items.filter((item) => intent.keywords.some((keyword) => matches(item, keyword))) : overdue.items;
  } else {
    const searchTypes = intent.types.filter((type) => !QUEUE_ONLY_TYPES.has(type));
    const hasFilter = intent.keywords.length || searchTypes.length || intent.statuses.length || intent.project || intent.dateFrom;
    if (hasFilter && !(intent.types.length && !searchTypes.length)) {
      const base = { types: searchTypes.length ? searchTypes : undefined, status: intent.statuses.length ? intent.statuses : undefined, projectId: intent.project?.id, dateFrom: intent.dateFrom || undefined, limit: LIMIT };
      const caller = { orgId, userId, role, isCompanyAdmin: Boolean(isCompanyAdmin) };
      const runs = intent.keywords.length
        ? await Promise.all(intent.keywords.map((keyword) => searchService.globalSearch({ ...caller, query: { ...base, q: keyword } })))
        : [await searchService.globalSearch({ ...caller, query: base })];
      const merged = new Map();
      for (const run of runs) for (const item of run.items || []) if (!merged.has(`${item.type}:${item.id}`)) merged.set(`${item.type}:${item.id}`, item);
      items = [...merged.values()]
        .map((item) => ({ ...item, matched: intent.keywords.filter((keyword) => matches(item, keyword)).length }))
        .sort((a, b) => b.matched - a.matched || (b.score || 0) - (a.score || 0))
        .slice(0, LIMIT);
    }
  }

  const groups = [...items.reduce((map, item) => map.set(item.type, { type: item.type, label: item.typeLabel, count: (map.get(item.type)?.count || 0) + 1 }), new Map()).values()];
  const result = { query: text, interpretation: intent, items, groups, overdue: overdue ? { count: overdue.count, shown: items.length } : null, answer: null, degraded: false };
  if (!explain || !items.length) return result;

  const sources = items.slice(0, 10).map((item, index) => ({ n: index + 1, typeLabel: item.typeLabel, ref: item.identifier, title: item.title, projectName: item.projectName, status: item.status, snippet: [item.subtitle, item.metadata?.dueDate ? `Due: ${String(item.metadata.dueDate).slice(0, 10)}` : null].filter(Boolean).join("\n"), url: item.url, id: item.id, type: item.type }));
  try {
    const completion = await gateway.complete({
      feature: "search.answer",
      system: `You are OctaPM's search assistant. Answer the user's search in two or three sentences from ONLY the numbered results, citing them as [n]. Say what was found and what stands out (status, dates). Do not invent records or figures; if the results do not answer it, say so.
Return ONLY a JSON object (no markdown fences): {"answer": "...", "citations": [1]}`,
      messages: [{ role: "user", content: `Sources:\n${formatSources(sources)}\n\nQuestion: ${text}` }],
      maxTokens: 400,
      temperature: 0.2,
      transport,
    });
    const parsed = parseJsonAnswer(completion.text);
    const answer = String(parsed?.answer || completion.text || "").trim();
    const numbers = new Set([...(Array.isArray(parsed?.citations) ? parsed.citations : []), ...[...answer.matchAll(/\[(\d+)\]/g)].map((match) => match[1])].map(Number));
    result.answer = { text: answer, citations: sources.filter((source) => numbers.has(source.n)).map(({ snippet: _snippet, status: _status, ...source }) => source), provider: completion.provider || null, mock: completion.provider === "mock", label: "AI interpretation" };
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    result.degraded = true;
  }
  return result;
};

module.exports = { interpret, refine, search, dateRangeOf, projectOf };
