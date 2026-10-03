const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const aiProvider = require("./ai-provider.service");
const retrieval = require("./retrieval.service");
const auditService = require("./audit.service");

/**
 * Project knowledge assistant with citations (OCTA-AI-ASSIST-028).
 *
 * A question is answered only from sources the caller could open by hand
 * (retrieval.service). The model returns an answer with `[n]` citations
 * and, optionally, suggested actions (create an RFI or a task, open a
 * record); every exchange is stored with its sources so answers can be
 * audited and rated. Without a configured provider the assistant still
 * returns the matching sources so the feature degrades to search.
 */

const MAX_HISTORY = 6;
const MAX_QUESTION = 2000;
const ACTION_TYPES = Object.freeze(["create_rfi", "create_task", "open"]);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const tablesReady = () => Boolean(prisma.assistantConversation?.findFirst && prisma.assistantMessage?.create);

const SYSTEM_PROMPT = `You are OctaPM's project knowledge assistant for a construction project team.
Answer the user's question using ONLY the numbered sources provided. Every factual statement must cite its source as [n]; you may cite several. If the sources do not contain the answer, say so plainly and suggest where to look or what to ask — never invent records, numbers, dates or people.
Be concise and concrete: refs, dates, amounts, statuses, names of records. Use short paragraphs or bullet lists. Do not repeat the question.
When a follow-up record would help — an RFI to resolve an open question, a task to chase an action — suggest it as an action.
Return ONLY a JSON object with this shape (no markdown fences):
{"answer": "...markdown allowed, cite like [1]...", "citations": [1, 2], "actions": [{"type": "create_rfi", "label": "Raise RFI about …", "subject": "...", "question": "...", "sourceN": 1}, {"type": "create_task", "label": "...", "title": "...", "description": "...", "sourceN": 2}, {"type": "open", "label": "Open RFI-012", "sourceN": 3}]}
"actions" may be empty. Keep at most three actions.`;

// A stored run's prompt message records `{ builtWithoutBoq: true }` in its
// usageJson when the service built the run without the bill (storeRun's
// `builtWithoutBoq`). Bookkeeping, not usage: it is never served.
const BUILT_WITHOUT_BOQ = "builtWithoutBoq";
const usageOf = (row) => {
  const usage = row.usageJson;
  if (!usage || typeof usage !== "object" || Array.isArray(usage) || !Object.prototype.hasOwnProperty.call(usage, BUILT_WITHOUT_BOQ)) return usage || null;
  const { [BUILT_WITHOUT_BOQ]: _marker, ...rest } = usage;
  return Object.keys(rest).length ? rest : null;
};

const serializeMessage = (row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  citations: Array.isArray(row.citationsJson) ? row.citationsJson : [],
  actions: Array.isArray(row.actionsJson) ? row.actionsJson : [],
  sources: Array.isArray(row.sourcesJson) ? row.sourcesJson : [],
  usage: usageOf(row),
  provider: row.provider || null,
  model: row.model || null,
  feedback: row.feedback || null,
  feedbackNote: row.feedbackNote || null,
  createdAt: toIso(row.createdAt),
});

const serializeConversation = (row, { withMessages = false } = {}) => ({
  id: row.id,
  projectId: row.projectId || null,
  project: row.project ? { id: row.project.id, name: row.project.name } : null,
  title: row.title,
  lastMessageAt: toIso(row.lastMessageAt),
  messageCount: row._count?.messages ?? row.messages?.length ?? null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  ...(withMessages ? { messages: (row.messages || []).map(serializeMessage) } : {}),
});

/*
 * Stored runs built from the bill (owner check, 2026-09-29; see the header
 * of utils/boq-figures.js). A run's prompt and answer are served back to
 * the person who made it — the conversation read, the answer to rating it,
 * and the history a follow-up question sends the model. Some kinds are
 * built from the BOQ's rows or the mapping: the scope-gap review (the
 * uncovered rows, their codes and descriptions, the BOQ counts — stored
 * for every member before 6468eb0), the forecast narrative (each activity's
 * budget, its approved allocation, for a BOQ reader), and the report
 * narrative over a source whose columns state an allocation's budget
 * (sample rows, groups and totals). Owning the run is not an exemption:
 * when the reader may not read the BOQ on the run's project now, its
 * content — prompt, answer, citations, sources and actions — is withheld
 * and the metadata stays (id, title, kind, when, provider, model, rating).
 * Nothing stored is rewritten or deleted. A run the service built without
 * the bill says so on its prompt message (BUILT_WITHOUT_BOQ) and is served
 * as it is; a run with no project (a report narrative across projects)
 * cannot be decided per project and is withheld unless it says so.
 * The daily-log draft (PC-6 integration, 2026-10-01) is one of them: its
 * evidence states a progress submission's typed, planned and unit
 * quantities for a BOQ reader; a draft that showed none says so.
 */
const BOQ_BEARING_KINDS = new Set(["scope_gap", "forecast", "daily_log_draft"]);
const ASSISTANT_RUN_BOQ_WITHHELD = "This AI run was built from the BOQ's rows or the mapping, available only to members who may read the BOQ";
let mappingNarrativeTitles = null;
const isMappingNarrative = (title) => {
  if (!mappingNarrativeTitles) {
    const { SOURCES } = require("./report-sources");
    const { reportMappingColumns } = require("../utils/boq-figures");
    mappingNarrativeTitles = new Set(Object.values(SOURCES).filter((source) => reportMappingColumns(source.key).length).map((source) => `Narrative: ${source.label}`.slice(0, 120)));
  }
  return mappingNarrativeTitles.has(title);
};
const bearsBoq = (row) => BOQ_BEARING_KINDS.has(row.kind) || (row.kind === "report_narrative" && isMappingNarrative(row.title));
const builtWithoutBoq = (messages = []) => messages.some((message) => message.role === "user" && message.usageJson && message.usageJson[BUILT_WITHOUT_BOQ] === true);
/** The reader may read nothing of the bill unless a caller says otherwise. */
const READS_NO_BOQ = async () => false;

/** Whether this reader is given the run's content (`row` with its messages). */
const withholdsRun = async (row, readsBoq = READS_NO_BOQ) => {
  if (!bearsBoq(row) || builtWithoutBoq(row.messages)) return false;
  if (!row.projectId) return true;
  return !(await readsBoq(row.projectId));
};

const withheldMessage = (message) => {
  const { content, citations, actions, sources, ...kept } = message;
  return { ...kept, contentWithheld: { reason: ASSISTANT_RUN_BOQ_WITHHELD } };
};

const status = () => ({ ...aiProvider.describe(), embeddings: require("./embedding.service").describe() });

/** Only chats are listed in Ask OctaPM; AI runs stored on records (OCTA-AI-RFI-029) have their own kind. */
const listConversations = async ({ orgId, user, projectId = null, limit = 30 }) => {
  if (!tablesReady()) return [];
  const rows = await prisma.assistantConversation.findMany({ where: { orgId, userId: user.id, kind: "chat", ...(projectId ? { projectId } : {}) }, include: { project: { select: { id: true, name: true } }, _count: { select: { messages: true } } }, orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }], take: Math.min(100, Math.max(1, Number(limit) || 30)) });
  return rows.map((row) => serializeConversation(row));
};

/**
 * Stores one AI run made on behalf of a record (an RFI draft, a suggested
 * response, a summary) as a conversation of `kind` with the prompt and the
 * answer, so it can be audited and rated like a chat answer.
 */
const storeRun = async ({ orgId, user, projectId = null, kind, recordType = null, recordId = null, title, prompt, answer, citations = [], sources = [], usage = null, provider = null, model = null, builtWithoutBoq: withoutBoq = false }) => {
  if (!tablesReady()) return null;
  const conversation = await prisma.assistantConversation.create({ data: { orgId, projectId, userId: user.id, kind, recordType, recordId, title: String(title || kind).slice(0, 120), lastMessageAt: new Date() } });
  await prisma.assistantMessage.create({ data: { orgId, conversationId: conversation.id, role: "user", content: String(prompt || "").slice(0, 20000), ...(withoutBoq === true ? { usageJson: { [BUILT_WITHOUT_BOQ]: true } } : {}) } });
  const message = await prisma.assistantMessage.create({ data: { orgId, conversationId: conversation.id, role: "assistant", content: String(answer || ""), citationsJson: citations, sourcesJson: sources.map((source) => ({ n: source.n, id: source.id, type: source.type, title: source.title, ref: source.ref, projectId: source.projectId, url: source.url })), usageJson: usage, provider, model } });
  return { conversationId: conversation.id, message: serializeMessage(message) };
};

const loadConversation = async ({ orgId, user, conversationId }) => {
  const row = await prisma.assistantConversation.findFirst({ where: { id: conversationId, orgId, userId: user.id }, include: { project: { select: { id: true, name: true } }, messages: { orderBy: { createdAt: "asc" } } } });
  if (!row) throw new HttpError(404, "ASSISTANT_CONVERSATION_NOT_FOUND", "Conversation not found");
  return row;
};

/**
 * One conversation with its messages. `readsBoq(projectId)` says whether
 * the reader may read the BOQ on a project now; a stored run built from
 * the bill is served without its content otherwise (see above).
 */
const getConversation = async ({ orgId, user, conversationId, readsBoq = READS_NO_BOQ }) => {
  const row = await loadConversation({ orgId, user, conversationId });
  const conversation = serializeConversation(row, { withMessages: true });
  if (!(await withholdsRun(row, readsBoq))) return conversation;
  return { ...conversation, kind: row.kind, contentWithheld: { reason: ASSISTANT_RUN_BOQ_WITHHELD }, messages: conversation.messages.map(withheldMessage) };
};

const deleteConversation = async ({ orgId, user, conversationId }) => {
  const row = await loadConversation({ orgId, user, conversationId });
  await prisma.assistantConversation.delete({ where: { id: row.id } });
  return { deleted: true };
};

const normalizeActions = (actions, sources) =>
  (Array.isArray(actions) ? actions : [])
    .filter((action) => action && ACTION_TYPES.includes(action.type))
    .slice(0, 3)
    .map((action) => {
      const source = sources.find((item) => item.n === Number(action.sourceN)) || null;
      const base = { type: action.type, label: trimOrNull(action.label) || (action.type === "create_rfi" ? "Raise an RFI" : action.type === "create_task" ? "Create a task" : "Open"), sourceN: source ? source.n : null, url: source?.url || null };
      if (action.type === "create_rfi") return { ...base, subject: trimOrNull(action.subject)?.slice(0, 200) || trimOrNull(action.label)?.slice(0, 200) || "RFI", question: trimOrNull(action.question)?.slice(0, 4000) || null };
      if (action.type === "create_task") return { ...base, title: trimOrNull(action.title)?.slice(0, 200) || trimOrNull(action.label)?.slice(0, 200) || "Task", description: trimOrNull(action.description)?.slice(0, 4000) || null };
      return base;
    });

const citationsFrom = ({ answer, citations, sources }) => {
  const numbers = new Set((Array.isArray(citations) ? citations : []).map(Number).filter((n) => Number.isInteger(n)));
  for (const match of String(answer || "").matchAll(/\[(\d+)\]/g)) numbers.add(Number(match[1]));
  return [...numbers].filter((n) => sources.some((source) => source.n === n)).sort((a, b) => a - b).map((n) => {
    const source = sources.find((item) => item.n === n);
    return { n, id: source.id, type: source.type, typeLabel: source.typeLabel, title: source.title, ref: source.ref, projectId: source.projectId, projectName: source.projectName, url: source.url, snippet: source.snippet };
  });
};

const fallbackAnswer = ({ sources }) => {
  if (!sources.length) return "AI answers are not configured on this server, and no matching records or documents were found for that question.";
  const lines = sources.slice(0, 6).map((source) => `- [${source.n}] ${source.typeLabel}${source.ref ? ` ${source.ref}` : ""}: ${source.title}${source.snippet ? ` — ${source.snippet}` : ""}`);
  return `AI answers are not configured on this server (set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY). Here is what matched your question:\n${lines.join("\n")}`;
};

const buildMessages = ({ history, question, sources, projects }) => {
  const context = projects.length ? `Project context:\n${projects.map((project) => `- ${project.name}${project.status ? ` (${project.status})` : ""}${project.clientName ? `, client ${project.clientName}` : ""}${project.contractValue ? `, contract ${project.contractValue.toLocaleString()} ${project.currency || ""}` : ""}${project.startDate ? `, ${project.startDate} → ${project.endDate || "?"}` : ""}`).join("\n")}\n\n` : "";
  const sourceBlock = sources.length ? `Sources:\n${retrieval.formatSources(sources)}` : "Sources: none found.";
  const messages = history.map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.role === "assistant" ? message.content : message.content }));
  messages.push({ role: "user", content: `${context}${sourceBlock}\n\nQuestion: ${question}` });
  return messages;
};

/**
 * The caller's access to the project an answer is scoped to. The project
 * comes from the route, the request body or the conversation followed up;
 * the organisation-mounted assistant took it from the body and retrieved
 * on, stored a conversation against, and would have sent a model the
 * context of a project the caller is refused everywhere else (certification
 * L46). `projectAccess` is the route's own (already decided for its
 * project); `accessFor(projectId)` is the route's decision for any other
 * — the project's own access and assistant permission — and refuses by
 * throwing. Without one, the project access rule alone decides.
 */
const projectAccessFor = async ({ orgId, user, projectId, projectAccess = null, accessFor = null }) => {
  if (projectAccess?.id && projectAccess.id === projectId) return projectAccess;
  if (accessFor) return accessFor(projectId);
  const { assertProjectAccess } = require("./project-authorization.service");
  return assertProjectAccess({ orgId, projectId, userId: user.id, role: user.role, isCompanyAdmin: Boolean(user.isCompanyAdmin) });
};

/**
 * Answers a question inside a conversation (new when `conversationId` is
 * null). `transport` lets tests inject a fake model. Nothing is stored,
 * retrieved or sent to a model before the caller's access to the
 * conversation's project is decided (projectAccessFor).
 */
const ask = async ({ orgId, user, projectId = null, conversationId = null, question, projectAccess = null, accessFor = null, transport = null, readsBoq = READS_NO_BOQ }) => {
  const text = trimOrNull(question);
  if (!text) throw new HttpError(400, "ASSISTANT_QUESTION_REQUIRED", "Ask a question");
  if (text.length > MAX_QUESTION) throw new HttpError(400, "ASSISTANT_QUESTION_TOO_LONG", `Keep the question under ${MAX_QUESTION} characters`);
  if (!tablesReady()) throw new HttpError(503, "ASSISTANT_UNAVAILABLE", "The assistant tables are not available");
  let conversation = conversationId ? await loadConversation({ orgId, user, conversationId }) : null;
  const scopeProjectId = conversation?.projectId ?? projectId ?? null;
  const scopeAccess = scopeProjectId ? await projectAccessFor({ orgId, user, projectId: scopeProjectId, projectAccess, accessFor }) : null;
  if (!conversation) {
    conversation = await prisma.assistantConversation.create({ data: { orgId, projectId: scopeProjectId, userId: user.id, kind: "chat", title: text.slice(0, 120), lastMessageAt: new Date() }, include: { project: { select: { id: true, name: true } }, messages: true } });
  }
  // A follow-up on a stored run this reader is not given (built from the
  // bill) sends the model none of it.
  const history = (await withholdsRun(conversation, readsBoq)) ? [] : (conversation.messages || []).slice(-MAX_HISTORY).map((message) => ({ role: message.role, content: message.content }));
  const userMessage = await prisma.assistantMessage.create({ data: { orgId, conversationId: conversation.id, role: "user", content: text } });

  const retrieved = await retrieval.retrieve({ orgId, user, projectId: scopeProjectId, query: text, projectAccess: scopeAccess });
  const sources = retrieved.sources;
  let answer;
  let citations;
  let actions = [];
  let usage = null;
  let provider = null;
  let model = null;
  let degraded = false;
  if (aiProvider.isEnabled() || transport) {
    try {
      const completion = await aiProvider.complete({ system: SYSTEM_PROMPT, messages: buildMessages({ history, question: text, sources, projects: retrieved.projects }), maxTokens: 1500, temperature: 0.2, transport });
      const parsed = aiProvider.parseJsonAnswer(completion.text);
      answer = trimOrNull(parsed?.answer) || trimOrNull(completion.text) || "I could not produce an answer.";
      citations = citationsFrom({ answer, citations: parsed?.citations, sources });
      actions = normalizeActions(parsed?.actions, sources);
      usage = completion.usage || null;
      provider = completion.provider || null;
      model = completion.model || null;
    } catch (error) {
      if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
      degraded = true;
      answer = `${error.message}\n\n${fallbackAnswer({ sources })}`;
      citations = citationsFrom({ answer: "", citations: sources.map((source) => source.n), sources });
    }
  } else {
    degraded = true;
    answer = fallbackAnswer({ sources });
    citations = citationsFrom({ answer: "", citations: sources.map((source) => source.n), sources });
  }
  const assistantMessage = await prisma.assistantMessage.create({ data: { orgId, conversationId: conversation.id, role: "assistant", content: answer, citationsJson: citations, actionsJson: actions, sourcesJson: sources.map((source) => ({ n: source.n, id: source.id, type: source.type, title: source.title, ref: source.ref, projectId: source.projectId, url: source.url })), usageJson: usage, provider, model } });
  await prisma.assistantConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } }).catch(() => null);
  return {
    conversationId: conversation.id,
    projectId: scopeProjectId,
    title: conversation.title,
    question: serializeMessage(userMessage),
    message: serializeMessage(assistantMessage),
    degraded,
    retrieval: { sources: sources.length, projects: retrieved.projects.map((project) => project.name), mode: retrieved.mode },
  };
};

const feedback = async ({ orgId, user, messageId, rating, note = null, readsBoq = READS_NO_BOQ }) => {
  if (!["up", "down", null].includes(rating)) throw new HttpError(400, "ASSISTANT_FEEDBACK", "Rating must be up, down or null");
  const row = await prisma.assistantMessage.findFirst({ where: { id: messageId, orgId, conversation: { userId: user.id } } });
  if (!row) throw new HttpError(404, "ASSISTANT_MESSAGE_NOT_FOUND", "Message not found");
  const updated = await prisma.assistantMessage.update({ where: { id: row.id }, data: { feedback: rating, feedbackNote: trimOrNull(note)?.slice(0, 1000) || null } });
  // The rating is kept either way; the answer to it is the message as this reader may read it.
  const conversation = await prisma.assistantConversation.findFirst({ where: { id: row.conversationId, orgId }, select: { kind: true, title: true, projectId: true, messages: { where: { role: "user" }, select: { role: true, usageJson: true } } } });
  if (conversation && (await withholdsRun(conversation, readsBoq))) return withheldMessage(serializeMessage(updated));
  return serializeMessage(updated);
};

/**
 * Runs a suggested action through the record's own service. The route
 * checks the record module permission before calling this.
 */
const executeAction = async ({ orgId, user, projectId, action = {}, projectAccess = null }) => {
  const type = trimOrNull(action.type);
  if (type === "create_rfi") {
    const rfiService = require("./rfi.service");
    const subject = trimOrNull(action.subject);
    if (!subject) throw new HttpError(400, "ASSISTANT_ACTION_SUBJECT", "The RFI needs a subject");
    const created = await rfiService.createRfi({ orgId, projectId, payload: { subject: subject.slice(0, 200), question: trimOrNull(action.question), status: "draft", priority: "normal" }, userId: user.id, userRole: user.role, projectAccess });
    await auditService.recordEvent({ orgId, projectId, entityType: "rfi", entityId: created.id, action: auditService.ACTIONS.CREATED, actorId: user.id, summary: { ref: created.ref, source: "assistant" } }).catch(() => null);
    return { type, record: { id: created.id, ref: created.ref, status: created.status }, url: `/projects/${projectId}/doc-control/rfi?recordId=${created.id}` };
  }
  if (type === "create_task") {
    const taskService = require("./task.service");
    const title = trimOrNull(action.title);
    if (!title) throw new HttpError(400, "ASSISTANT_ACTION_TITLE", "The task needs a title");
    const created = await taskService.createTask({ orgId, projectId, payload: { title: title.slice(0, 200), description: trimOrNull(action.description) }, userId: user.id, userRole: user.role, projectAccess });
    return { type, record: { id: created.id, ref: created.taskNumber ? `T-${created.taskNumber}` : null, status: created.status }, url: `/tasks?taskId=${created.id}` };
  }
  throw new HttpError(400, "ASSISTANT_ACTION_UNKNOWN", "Unknown action");
};

module.exports = { SYSTEM_PROMPT, ACTION_TYPES, ASSISTANT_RUN_BOQ_WITHHELD, BOQ_BEARING_KINDS, status, listConversations, getConversation, deleteConversation, ask, feedback, executeAction, normalizeActions, citationsFrom, storeRun, serializeMessage };
