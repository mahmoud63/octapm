/**
 * Document Q&A (AI-6): a question answered from the passages of a project's
 * documents, every statement citing its passage.
 *
 * Authorisation comes first and fails closed (the AI-0 audit found the
 * document visibility helpers treat a missing viewer as "visible"):
 *   - the viewer is always built from the caller's own access
 *     (document-text documentViewer: their module reads, and for a
 *     party-scoped person their parties and companies);
 *   - named documents are kept only if readableDocumentIds admits every one
 *     of them; otherwise the request is refused as not found, so a
 *     document's existence is not confirmed;
 *   - a question over the whole project needs document_control read and
 *     finds its documents through the document search, which filters each
 *     hit by that same viewer.
 * Only the passages of the documents left are read, ranked and sent.
 * Without a provider the best passages are returned, with no answer.
 */
const { prisma } = require("../../config/db");
const { HttpError } = require("../../utils/http-error");
const { hasPermission } = require("../../middleware/rbac");
const gateway = require("./gateway");
const { requireAiAccess } = require("./context");
const documentText = require("../document-text.service");
const { parseJsonAnswer } = require("../ai-provider.service");

const MAX_QUESTION = 1000;
const MAX_DOCUMENTS = 10;
const MAX_PASSAGES = 8;
const PER_DOCUMENT = 3;
const PASSAGE_CHARS = 1400;
const STOPWORDS = new Set("a an the and or of on in at for to from by with about what which who whom whose when where why how is are was were be been being does do did this that these those it its there their they we you our your i me my any all please tell show give explain say says said document documents file spec specification drawing".split(" "));

const keywordsOf = (text) => [...new Set(String(text || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2 && !STOPWORDS.has(word)))].slice(0, 12);

/** The viewer the caller reads documents as; never absent (fail closed). */
const viewerOf = (req) =>
  documentText.documentViewer({ userId: req.user.id, projectAccess: req.projectAccess, canRead: (moduleName) => hasPermission(req, moduleName, "read") });

/**
 * The documents the question may read: the named ones only if every one is
 * readable by this viewer, or the project's documents the viewer's own
 * search finds for the question's words.
 */
const documentsFor = async ({ req, projectId, question, documentIds, viewer }) => {
  const orgId = req.user.orgId;
  if (documentIds?.length) {
    const wanted = [...new Set(documentIds)];
    const readable = await documentText.readableDocumentIds({ orgId, projectId, documentIds: wanted, viewer });
    if (readable.size !== wanted.length) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document not found");
    return wanted;
  }
  if (!hasPermission(req, "document_control", "read")) {
    const forbidden = new HttpError(403, "FORBIDDEN", "Asking across the project's documents needs document control read; choose a document you can open instead");
    forbidden.details = { module: "document_control", action: "read" };
    throw forbidden;
  }
  const words = keywordsOf(question);
  if (!words.length) return [];
  const semantic = require("../embedding.service").isEnabled();
  const runs = await Promise.all(words.slice(0, 4).map((word) => documentText.searchDocuments({ orgId, projectId, q: word, limit: MAX_DOCUMENTS, semantic, viewer })));
  const tally = new Map();
  for (const run of runs) for (const item of run.items || []) tally.set(item.documentId, (tally.get(item.documentId) || 0) + 1 + (item.score || 0));
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_DOCUMENTS).map(([id]) => id);
};

/** Passages ranked by the question's words (rarer words weigh more), at most three per document. */
const rankPassages = (chunks, question) => {
  const words = keywordsOf(question);
  if (!words.length) return [];
  const lower = chunks.map((chunk) => chunk.text.toLowerCase());
  const weight = new Map(words.map((word) => [word, Math.log(1 + chunks.length / (1 + lower.filter((text) => text.includes(word)).length))]));
  const phrase = String(question).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const scored = chunks
    .map((chunk, index) => {
      const text = lower[index];
      let score = 0;
      for (const word of words) if (text.includes(word)) score += weight.get(word);
      if (phrase.length > 8 && text.includes(phrase)) score += 2;
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const perDocument = new Map();
  const picked = [];
  for (const item of scored) {
    const count = perDocument.get(item.chunk.documentId) || 0;
    if (count >= PER_DOCUMENT) continue;
    perDocument.set(item.chunk.documentId, count + 1);
    picked.push(item.chunk);
    if (picked.length >= MAX_PASSAGES) break;
  }
  return picked;
};

const SYSTEM = `You answer questions about a construction project's documents (specifications, contracts, minutes, reports) for the project team.
Use ONLY the numbered passages. Cite every statement as [n]; quote short phrases where the exact wording matters (clauses, quantities, dates). If the passages do not answer the question, say plainly that the documents provided do not say, and what they do cover; never fill gaps from general knowledge.
You do not decide contractual entitlement, approval or payment; state what the document says.
Return ONLY a JSON object (no markdown fences): {"answer": "...", "citations": [1, 2]}`;

// "summary" and "compare" read named documents from their start (a summary
// has no keywords to rank by): the first passages of each, in order, after
// any the question's words rank higher.
const MODES = Object.freeze(["answer", "summary", "compare"]);
const openingPassages = (chunks, ranked, perDocument) => {
  const picked = [...ranked];
  const count = new Map();
  for (const chunk of picked) count.set(chunk.documentId, (count.get(chunk.documentId) || 0) + 1);
  for (const chunk of chunks) {
    if (picked.length >= MAX_PASSAGES) break;
    if (picked.includes(chunk) || (count.get(chunk.documentId) || 0) >= perDocument) continue;
    count.set(chunk.documentId, (count.get(chunk.documentId) || 0) + 1);
    picked.push(chunk);
  }
  return picked;
};

const ask = async ({ req, projectId, question, documentIds = null, mode = "answer", transport = null }) => {
  if (!MODES.includes(mode)) throw new HttpError(400, "INVALID_MODE", "Unknown document question mode");
  if (mode !== "answer" && !documentIds?.length) throw new HttpError(400, "DOCUMENTS_REQUIRED", "Choose the documents to summarise or compare");
  const text = String(question || "").trim();
  if (text.length < 3) throw new HttpError(400, "QUESTION_REQUIRED", "Ask a question about the documents");
  if (text.length > MAX_QUESTION) throw new HttpError(400, "QUESTION_TOO_LONG", `Keep the question under ${MAX_QUESTION} characters`);
  if (Array.isArray(documentIds) && documentIds.length > MAX_DOCUMENTS) throw new HttpError(400, "TOO_MANY_DOCUMENTS", `Ask about at most ${MAX_DOCUMENTS} documents at once`);
  requireAiAccess({ orgId: req.user?.orgId, userId: req.user?.id, access: req.projectAccess });
  const orgId = req.user.orgId;
  const viewer = viewerOf(req);

  const ids = await documentsFor({ req, projectId, question: text, documentIds, viewer });
  const [documents, chunks] = ids.length
    ? await Promise.all([
        prisma.projectDocument.findMany({ where: { id: { in: ids }, orgId, projectId }, select: { id: true, title: true, documentNumber: true, originalName: true, text: { select: { status: true } } } }),
        prisma.documentChunk.findMany({ where: { orgId, projectId, documentId: { in: ids } }, select: { id: true, documentId: true, index: true, text: true, charStart: true, charEnd: true }, orderBy: [{ documentId: "asc" }, { index: "asc" }], take: 4000 }),
      ])
    : [[], []];
  const byId = new Map(documents.map((document) => [document.id, document]));
  const ranked = rankPassages(chunks, text);
  const chosen = mode === "answer" ? ranked : openingPassages(chunks, ranked.slice(0, 2), mode === "summary" && ids.length === 1 ? MAX_PASSAGES : Math.max(2, Math.floor(MAX_PASSAGES / ids.length)));
  const passages = chosen.map((chunk, index) => {
    const document = byId.get(chunk.documentId);
    const title = document?.title || document?.originalName || "Document";
    return { n: index + 1, documentId: chunk.documentId, title, ref: document?.documentNumber || null, chunkIndex: chunk.index, charStart: chunk.charStart, charEnd: chunk.charEnd, snippet: chunk.text.slice(0, 280), text: chunk.text.slice(0, PASSAGE_CHARS), url: `/projects/${projectId}?module=docControl&child=register&recordId=${chunk.documentId}` };
  });
  const notIndexed = documents.filter((document) => document.text?.status !== "ready").map((document) => ({ documentId: document.id, title: document.title || document.originalName, status: document.text?.status || "none" }));
  const publicPassages = passages.map(({ text: _text, ...passage }) => passage);
  const capabilities = gateway.capabilities();
  const result = { question: text, documents: documents.map((document) => ({ id: document.id, title: document.title || document.originalName, ref: document.documentNumber || null })), notIndexed, passages: publicPassages, answer: null, ai: { enabled: capabilities.enabled, mode: capabilities.mode }, degraded: false, degradedReason: null, insufficient: !passages.length };
  if (!passages.length) return result;
  if (!capabilities.enabled && !transport) return { ...result, degraded: true, degradedReason: "AI_NOT_CONFIGURED" };

  const block = passages.map((passage) => `[${passage.n}] Document ${passage.ref ? `${passage.ref} ` : ""}— ${passage.title} (passage ${passage.chunkIndex + 1})\n${passage.text}`).join("\n\n");
  try {
    const completion = await gateway.complete({ feature: mode === "answer" ? "document.ask" : `document.${mode}`, system: SYSTEM, messages: [{ role: "user", content: `Passages:\n${block}\n\nQuestion: ${text}` }], maxTokens: 1000, temperature: 0.1, transport });
    const parsed = parseJsonAnswer(completion.text);
    const answer = String(parsed?.answer || completion.text || "").trim();
    const numbers = new Set([...(Array.isArray(parsed?.citations) ? parsed.citations : []), ...[...answer.matchAll(/\[(\d+)\]/g)].map((match) => match[1])].map(Number));
    result.answer = { text: answer, citations: publicPassages.filter((passage) => numbers.has(passage.n)), provider: completion.provider || null, model: completion.model || null, mock: completion.provider === "mock", label: "AI interpretation" };
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { ...result, degraded: true, degradedReason: error.code };
  }
  return result;
};

module.exports = { ask, rankPassages, keywordsOf, viewerOf, SYSTEM, MAX_DOCUMENTS };
