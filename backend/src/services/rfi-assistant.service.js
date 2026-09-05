const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const aiProvider = require("./ai-provider.service");
const retrieval = require("./retrieval.service");
const assistant = require("./assistant.service");
const rfiWorkflow = require("./rfi-workflow.service");

/**
 * RFI drafting and response assistant (OCTA-AI-RFI-029).
 *
 * Three helpers around the RFI workflow, all draft-then-approve — nothing is
 * written to the RFI itself:
 *   - draftQuestion: a rough description becomes a proper RFI (subject,
 *     question citing the documents, discipline, spec section, priority,
 *     impact flags) and lists prior RFIs that may already answer it;
 *   - suggestResponse: a draft answer for the responder built only from the
 *     specifications, drawings, prior RFIs, submittals and change orders the
 *     caller can read, with confidence, basis, conflicts and open points;
 *   - summarize: the thread condensed into decisions and open points;
 *   - similar: prior RFIs across the caller's projects (duplicate check).
 * Retrieval is the caller's own (retrieval.service); every run is stored on
 * the record through assistant.storeRun so it can be audited and rated.
 */

const KINDS = Object.freeze({ DRAFT: "rfi_draft", RESPONSE: "rfi_response", SUMMARY: "rfi_summary" });
const PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);
const CONFIDENCE = Object.freeze(["high", "medium", "low"]);
const IMPACT_LEVELS = Object.freeze(["none", "possible", "likely"]);
const MAX_PROMPT = 4000;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const clip = (value, max) => {
  const text = trimOrNull(value);
  return text ? text.slice(0, max) : null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const list = (value, max = 10, size = 400) => (Array.isArray(value) ? value.map((item) => clip(typeof item === "string" ? item : item?.text || item?.description || JSON.stringify(item), size)).filter(Boolean).slice(0, max) : []);
const numbers = (value) => (Array.isArray(value) ? value.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);

const DRAFT_PROMPT = `You help a construction project team turn a rough note into a formal Request for Information (RFI).
Use ONLY the numbered sources for any reference to drawings, specifications, prior RFIs or submittals; cite them as [n] inside the question. Never invent drawing numbers, clauses, dates or people. If a source already answers the note, say so in "alreadyAnswered" instead of asking again.
A good RFI question states: what is unclear or conflicting, exactly where (drawing / grid / level / element), what the documents say (cited), what the contractor proposes, and what decision is needed by when.
Return ONLY a JSON object:
{"subject": "specific, under 120 characters", "question": "the formal question, cite like [1]", "discipline": "Structural | Architectural | MEP | Civil | … or null", "specSection": "e.g. 03 30 00 or null", "priority": "low | normal | high | urgent", "costImpact": true|false, "scheduleImpactFlag": true|false, "impactReason": "one sentence or null", "alreadyAnswered": [{"sourceN": 2, "why": "…"}], "citations": [1, 2]}`;

const RESPONSE_PROMPT = `You help the person responsible for answering a construction RFI draft the response.
Answer ONLY from the numbered sources (specifications, drawings, prior RFIs and their answers, submittals, change orders) and the RFI thread. Cite every statement as [n]. Where sources disagree, say so in "conflicts" instead of picking one silently. If the sources do not settle the question, say so in the response, set confidence to "low" and list what is needed in "openPoints". Never invent clauses, revisions, values or dates. Write in the voice of the responder: direct, formal, no greeting.
Return ONLY a JSON object:
{"response": "the draft answer with [n] citations", "confidence": "high | medium | low", "basis": ["what each cited source establishes"], "conflicts": [{"description": "…", "sourceNs": [1, 3]}], "openPoints": ["…"], "impacts": {"cost": "none | possible | likely", "schedule": "none | possible | likely", "reason": "…"}, "citations": [1, 2]}`;

const SUMMARY_PROMPT = `Summarise a construction RFI thread for someone who has not read it. Use only the thread given; do not add facts.
Return ONLY a JSON object:
{"summary": "three to five sentences: the question, what has been said, where it stands", "decisions": ["…"], "openPoints": ["…"], "suggestedNextStep": "one sentence", "suggestedStatus": "open | answered | closed | null"}`;

// ─── Context ──────────────────────────────────────────────────────────────

const person = (row) => row?.name || row?.email || null;

/** The RFI, its people and thread as a prompt block. */
const rfiBlock = (rfi) => {
  const lines = [
    `RFI ${rfi.ref}: ${rfi.subject}`,
    `Status: ${rfi.status}${rfi.revision ? ` (revision ${rfi.revision})` : ""} · priority ${rfi.priority}`,
    rfi.discipline ? `Discipline: ${rfi.discipline}` : null,
    rfi.specSection ? `Spec section: ${rfi.specSection}` : null,
    rfi.activity?.name ? `Activity: ${rfi.activity.name}` : null,
    rfi.location?.name ? `Location: ${rfi.location.name}` : null,
    rfi.responseRequiredBy || rfi.dueDate ? `Response required by: ${toIso(rfi.responseRequiredBy || rfi.dueDate)?.slice(0, 10)}` : null,
    rfi.costImpact ? `Cost impact flagged${rfi.costImpactAmount !== null && rfi.costImpactAmount !== undefined ? ` (${rfi.costImpactAmount})` : ""}` : null,
    rfi.scheduleImpactFlag ? `Schedule impact flagged (${rfi.scheduleImpact || 0} days)` : null,
    "",
    `Question:\n${rfi.question || "(no question text)"}`,
  ];
  const thread = (rfi.responses || []).filter((row) => row.body);
  if (thread.length) {
    lines.push("", "Thread:");
    for (const row of thread) lines.push(`- ${row.isOfficial ? "OFFICIAL ANSWER" : "Reply"} by ${person(row.author) || rfi.answeredBy || "unknown"} on ${toIso(row.createdAt)?.slice(0, 10) || "?"}${row.revision !== undefined && row.revision !== (rfi.revision || 0) ? ` (rev ${row.revision})` : ""}:\n  ${String(row.body).replace(/\n/g, "\n  ")}`);
  } else if (rfi.response) {
    lines.push("", `Answer on record:\n${rfi.response}`);
  }
  return lines.filter((line) => line !== null).join("\n");
};

const loadRfi = ({ orgId, projectId, rfiId, user }) => rfiWorkflow.getRfi({ orgId, projectId, rfiId, viewerId: user.id });

const referenceNames = async ({ projectId, activityId, locationId }) => {
  const out = { activity: null, location: null };
  try {
    if (activityId && prisma.activity?.findFirst) out.activity = (await prisma.activity.findFirst({ where: { id: activityId, projectId }, select: { name: true } }))?.name || null;
    if (locationId && prisma.location?.findFirst) out.location = (await prisma.location.findFirst({ where: { id: locationId, projectId }, select: { name: true, path: true } }))?.name || null;
  } catch {
    /* references are optional context */
  }
  return out;
};

const projectLine = (projects) => (projects.length ? `Project: ${projects.map((project) => `${project.name}${project.clientName ? ` (client ${project.clientName})` : ""}`).join("; ")}\n\n` : "");

const sourceBlock = (sources) => (sources.length ? `Sources:\n${retrieval.formatSources(sources)}` : "Sources: none found.");

const similarFrom = (sources, { projectId = null, excludeRfiId = null, limit = 5 } = {}) =>
  sources
    .filter((source) => source.type === "rfi" && source.id !== excludeRfiId)
    .map((source) => ({ n: source.n, id: source.id, ref: source.ref, subject: source.title, status: source.status, projectId: source.projectId, projectName: source.projectName, url: source.url, snippet: source.snippet, sameProject: Boolean(projectId) && source.projectId === projectId }))
    .sort((a, b) => Number(b.sameProject) - Number(a.sameProject) || a.n - b.n)
    .slice(0, limit);

/** `[n]` markers become readable references so a draft can be pasted as plain text. */
const plainText = (text, citations) =>
  String(text || "").replace(/\s*\[(\d+)\]/g, (match, n) => {
    const citation = citations.find((item) => item.n === Number(n));
    if (!citation) return "";
    return ` (${citation.typeLabel}${citation.ref ? ` ${citation.ref}` : ` ${citation.title}`})`;
  });

const complete = async ({ system, messages, transport, maxTokens = 1800 }) => {
  try {
    const completion = await aiProvider.complete({ system, messages, maxTokens, temperature: 0.2, transport });
    return { completion, parsed: aiProvider.parseJsonAnswer(completion.text) };
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { completion: null, parsed: null, error };
  }
};

const store = (args) => assistant.storeRun(args).catch(() => null);

// ─── Similar RFIs ─────────────────────────────────────────────────────────

/** Prior RFIs across every project the caller can open; the current project first. */
const similar = async ({ orgId, user, projectId, q, limit = 5, excludeRfiId = null }) => {
  const text = trimOrNull(q);
  if (!text) throw new HttpError(400, "RFI_AI_QUERY_REQUIRED", "Type a subject or question first");
  const retrieved = await retrieval.retrieve({ orgId, user, projectId: null, query: text, limit: Math.max(10, limit * 2), types: ["rfi"] });
  return { query: text, items: similarFrom(retrieved.sources, { projectId, excludeRfiId, limit }) };
};

// ─── Draft a question ─────────────────────────────────────────────────────

const normalizeDraft = (parsed, { sources, fallback }) => {
  const citations = assistant.citationsFrom({ answer: parsed?.question, citations: parsed?.citations, sources });
  const alreadyAnswered = (Array.isArray(parsed?.alreadyAnswered) ? parsed.alreadyAnswered : [])
    .map((item) => {
      const source = sources.find((candidate) => candidate.n === Number(item?.sourceN));
      return source ? { n: source.n, id: source.id, type: source.type, typeLabel: source.typeLabel, ref: source.ref, title: source.title, url: source.url, projectName: source.projectName, why: clip(item?.why, 400) } : null;
    })
    .filter(Boolean)
    .slice(0, 5);
  const question = clip(parsed?.question, 20000) || fallback.prompt;
  return {
    subject: clip(parsed?.subject, 200) || clip(fallback.subject, 200) || "RFI",
    question,
    questionPlain: plainText(question, citations),
    discipline: clip(parsed?.discipline, 120) || fallback.discipline || null,
    specSection: clip(parsed?.specSection, 120) || fallback.specSection || null,
    priority: PRIORITIES.includes(parsed?.priority) ? parsed.priority : "normal",
    costImpact: Boolean(parsed?.costImpact),
    scheduleImpactFlag: Boolean(parsed?.scheduleImpactFlag),
    impactReason: clip(parsed?.impactReason, 400),
    alreadyAnswered,
    citations,
  };
};

/**
 * Turns a rough note (plus optional references) into a proposed RFI. Nothing
 * is created; the form is pre-filled with the result.
 */
const draftQuestion = async ({ orgId, user, projectId, payload = {}, projectAccess = null, transport = null }) => {
  const prompt = trimOrNull(payload.prompt);
  if (!prompt) throw new HttpError(400, "RFI_AI_PROMPT_REQUIRED", "Describe the issue first");
  if (prompt.length > MAX_PROMPT) throw new HttpError(400, "RFI_AI_PROMPT_TOO_LONG", `Keep the description under ${MAX_PROMPT} characters`);
  const specSection = clip(payload.specSection, 120);
  const discipline = clip(payload.discipline, 120);
  const refs = await referenceNames({ projectId, activityId: payload.activityId || null, locationId: payload.locationId || null });
  const query = [prompt, specSection, discipline, refs.activity, refs.location].filter(Boolean).join(" ");
  const retrieved = await retrieval.retrieve({ orgId, user, projectId, query, limit: 10, projectAccess });
  const sources = retrieved.sources;
  const similarRfis = similarFrom(sources, { projectId, limit: 5 });
  const knownRefs = [specSection ? `spec section ${specSection}` : null, discipline ? `discipline ${discipline}` : null, refs.activity ? `activity "${refs.activity}"` : null, refs.location ? `location "${refs.location}"` : null].filter(Boolean);
  const userContent = `${projectLine(retrieved.projects)}${sourceBlock(sources)}\n\nWhat the user wrote:\n${prompt}${knownRefs.length ? `\n\nKnown references: ${knownRefs.join(", ")}.` : ""}`;
  const fallback = { subject: prompt.split(/[.\n]/)[0], prompt, discipline, specSection };
  if (!aiProvider.isEnabled() && !transport) {
    return { degraded: true, reason: "AI drafting is not configured on this server (set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY).", draft: null, similar: similarRfis, citations: assistant.citationsFrom({ answer: "", citations: sources.map((source) => source.n), sources }), message: null };
  }
  const { completion, parsed, error } = await complete({ system: DRAFT_PROMPT, messages: [{ role: "user", content: userContent }], transport });
  if (!completion) {
    return { degraded: true, reason: error?.message || "The AI provider did not answer.", draft: null, similar: similarRfis, citations: assistant.citationsFrom({ answer: "", citations: sources.map((source) => source.n), sources }), message: null };
  }
  const draft = normalizeDraft(parsed, { sources, fallback });
  const stored = await store({ orgId, user, projectId, kind: KINDS.DRAFT, title: `RFI draft: ${draft.subject}`, prompt: userContent, answer: JSON.stringify(draft), citations: draft.citations, sources, usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null });
  return { degraded: false, draft, similar: similarRfis, citations: draft.citations, message: stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null, retrieval: { sources: sources.length, mode: retrieved.mode } };
};

// ─── Suggest a response ───────────────────────────────────────────────────

const normalizeSuggestion = (parsed, { sources }) => {
  const response = clip(parsed?.response, 20000) || "The sources available do not settle this question.";
  const citations = assistant.citationsFrom({ answer: response, citations: parsed?.citations, sources });
  const impacts = parsed?.impacts && typeof parsed.impacts === "object" ? parsed.impacts : {};
  return {
    response,
    responsePlain: plainText(response, citations),
    confidence: CONFIDENCE.includes(parsed?.confidence) ? parsed.confidence : "low",
    basis: list(parsed?.basis, 8),
    conflicts: (Array.isArray(parsed?.conflicts) ? parsed.conflicts : []).map((item) => ({ description: clip(item?.description || item, 400), sourceNs: numbers(item?.sourceNs).filter((n) => sources.some((source) => source.n === n)) })).filter((item) => item.description).slice(0, 5),
    openPoints: list(parsed?.openPoints, 8),
    impacts: { cost: IMPACT_LEVELS.includes(impacts.cost) ? impacts.cost : "none", schedule: IMPACT_LEVELS.includes(impacts.schedule) ? impacts.schedule : "none", reason: clip(impacts.reason, 400) },
    citations,
  };
};

/** A draft answer for the responder, built only from what they can read. Nothing is posted. */
const suggestResponse = async ({ orgId, user, projectId, rfiId, payload = {}, projectAccess = null, transport = null }) => {
  const rfi = await loadRfi({ orgId, projectId, rfiId, user });
  if (rfi.status === "closed" || rfi.status === "archived") throw new HttpError(409, "RFI_ALREADY_CLOSED", "Reopen the RFI before drafting a response");
  const instructions = clip(payload.instructions, 2000);
  const query = [rfi.subject, rfi.question, rfi.specSection, rfi.discipline].filter(Boolean).join(" ");
  const retrieved = await retrieval.retrieve({ orgId, user, projectId, query, limit: 10, projectAccess, exclude: [`record:${rfi.id}`] });
  const sources = retrieved.sources;
  const similarRfis = similarFrom(sources, { projectId, excludeRfiId: rfi.id, limit: 5 });
  const allCitations = assistant.citationsFrom({ answer: "", citations: sources.map((source) => source.n), sources });
  const userContent = `${projectLine(retrieved.projects)}${sourceBlock(sources)}\n\n${rfiBlock(rfi)}${instructions ? `\n\nInstructions from the responder: ${instructions}` : ""}\n\nDraft the response to ${rfi.ref}.`;
  if (!aiProvider.isEnabled() && !transport) {
    return { degraded: true, reason: "AI drafting is not configured on this server (set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY).", suggestion: null, similar: similarRfis, citations: allCitations, message: null };
  }
  const { completion, parsed, error } = await complete({ system: RESPONSE_PROMPT, messages: [{ role: "user", content: userContent }], transport });
  if (!completion) return { degraded: true, reason: error?.message || "The AI provider did not answer.", suggestion: null, similar: similarRfis, citations: allCitations, message: null };
  const suggestion = normalizeSuggestion(parsed, { sources });
  const stored = await store({ orgId, user, projectId, kind: KINDS.RESPONSE, recordType: "rfi", recordId: rfi.id, title: `Response draft: ${rfi.ref}`, prompt: userContent, answer: suggestion.response, citations: suggestion.citations, sources, usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null });
  return { degraded: false, rfi: { id: rfi.id, ref: rfi.ref, status: rfi.status, revision: rfi.revision || 0 }, suggestion, similar: similarRfis, citations: suggestion.citations, message: stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null, retrieval: { sources: sources.length, mode: retrieved.mode } };
};

// ─── Summarise the thread ─────────────────────────────────────────────────

const deterministicSummary = (rfi) => {
  const thread = rfi.responses || [];
  const replies = thread.filter((row) => !row.isOfficial);
  const last = thread[thread.length - 1] || null;
  const parts = [
    `${rfi.ref} (${rfi.status}) asks: ${rfi.subject}.`,
    replies.length ? `${replies.length} repl${replies.length === 1 ? "y" : "ies"} in the thread.` : "No discussion yet.",
    rfi.officialResponse ? `Official answer by ${person(rfi.officialResponse.author) || rfi.answeredBy || "unknown"} on ${toIso(rfi.officialResponse.createdAt)?.slice(0, 10)}.` : "No official answer yet.",
    last ? `Last activity ${toIso(last.createdAt)?.slice(0, 10)} by ${person(last.author) || "unknown"}.` : null,
  ].filter(Boolean);
  return { summary: parts.join(" "), decisions: rfi.officialResponse ? [clip(rfi.officialResponse.body, 300)] : [], openPoints: rfi.officialResponse ? [] : ["No official answer has been given."], suggestedNextStep: rfi.officialResponse ? (rfi.status === "answered" ? "The manager reviews the answer and closes the RFI." : null) : "An assignee answers the question.", suggestedStatus: null };
};

const normalizeSummary = (parsed, rfi) => ({
  summary: clip(parsed?.summary, 4000) || deterministicSummary(rfi).summary,
  decisions: list(parsed?.decisions, 8),
  openPoints: list(parsed?.openPoints, 8),
  suggestedNextStep: clip(parsed?.suggestedNextStep, 400),
  suggestedStatus: ["open", "answered", "closed"].includes(parsed?.suggestedStatus) ? parsed.suggestedStatus : null,
});

/** The thread condensed; without a provider a factual summary is built from the record. */
const summarize = async ({ orgId, user, projectId, rfiId, transport = null }) => {
  const rfi = await loadRfi({ orgId, projectId, rfiId, user });
  const block = rfiBlock(rfi);
  if (!aiProvider.isEnabled() && !transport) return { degraded: true, reason: "AI summaries are not configured on this server.", summary: deterministicSummary(rfi), message: null };
  const { completion, parsed, error } = await complete({ system: SUMMARY_PROMPT, messages: [{ role: "user", content: block }], transport, maxTokens: 900 });
  if (!completion) return { degraded: true, reason: error?.message || "The AI provider did not answer.", summary: deterministicSummary(rfi), message: null };
  const summary = normalizeSummary(parsed, rfi);
  const stored = await store({ orgId, user, projectId, kind: KINDS.SUMMARY, recordType: "rfi", recordId: rfi.id, title: `Summary: ${rfi.ref}`, prompt: block, answer: summary.summary, usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null });
  return { degraded: false, rfi: { id: rfi.id, ref: rfi.ref, status: rfi.status }, summary, message: stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null };
};

module.exports = { KINDS, DRAFT_PROMPT, RESPONSE_PROMPT, SUMMARY_PROMPT, similar, draftQuestion, suggestResponse, summarize, rfiBlock, plainText, deterministicSummary };
