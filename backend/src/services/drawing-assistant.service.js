const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { recordWorkspacePath } = require("../utils/record-links");
const { pdfPages } = require("../utils/document-text");
const { disciplineFor, normalizeNumber, DISCIPLINES } = require("../utils/sheet-title-detect");
const aiProvider = require("./ai-provider.service");
const assistant = require("./assistant.service");

/**
 * Drawing intelligence (OCTA-AI-DWG-035).
 *
 *  - Title-block reading: pages without a usable text layer (scans) are
 *    rendered in the browser and read by the vision provider — number,
 *    title, revision, date, discipline, scale and the sheet numbers called
 *    out — as proposals for the review grid (applied only on request).
 *  - Cross-references: sheet numbers and detail callouts found in a page's
 *    text layer become hyperlinks between sheets (`SheetReference`),
 *    resolved to the target sheet when it exists; incoming links are the
 *    reverse view. Deterministic — no model call.
 *  - Revision comparison: two rendered revisions go to the vision provider
 *    for a plain-language list of what changed, on top of the pixel diff.
 * Runs are stored as assistant conversations on the revision / sheet.
 */

const MAX_PAGES = () => Math.max(1, Math.min(12, Number(process.env.AI_DRAWING_PAGES || 8)));
const MAX_IMAGE_BASE64 = 2_800_000; // ~2 MB of image per page
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const CONFIDENCE = Object.freeze(["low", "medium", "high"]);
const DISCIPLINE_NAMES = Object.values(DISCIPLINES || {});

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
/** "A-101", "A 101" and "A101" name the same sheet. */
const looseKey = (value) => normalizeNumber(String(value || "")).replace(/[-_.\s]/g, "");
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const confidenceNumber = (level) => (level === "high" ? 0.9 : level === "medium" ? 0.65 : 0.35);

const parseImage = (image, label) => {
  const match = DATA_URL_RE.exec(String(image || ""));
  if (!match) throw new HttpError(400, "DRAWING_AI_IMAGE", `${label}: send a JPEG, PNG or WebP data URL`);
  if (match[2].length > MAX_IMAGE_BASE64) throw new HttpError(400, "DRAWING_AI_IMAGE_TOO_LARGE", `${label}: the image is too large (max ~2 MB)`);
  return { mediaType: match[1], data: match[2] };
};

const runMessage = (stored) => (stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null);

// ─── Title-block reading ──────────────────────────────────────────────────

const READ_PROMPT = `You read the title block of a construction drawing from an image of the whole sheet (the title block is usually bottom-right or along the right edge). Report ONLY what is printed; do not guess. Give: the sheet number (e.g. "S-201", "A-101", "M-3.02"), the sheet title, the current revision (letter or number, from the revision box or table — the latest entry), its date, the discipline (Architectural, Structural, Civil, Mechanical, Electrical, Plumbing, Fire, Landscape, Interior, Other), the scale, and every other sheet number referenced in callouts on the drawing (e.g. "SEE S-301", "3/A-501" means detail 3 on sheet A-501). Initials only for names.
Return ONLY a JSON object: {"number": "…", "title": "…", "revision": "…", "date": "YYYY-MM-DD or as printed", "discipline": "…", "scale": "…", "drawnBy": "initials", "references": ["S-301", "A-501"], "confidence": {"number": "low|medium|high", "title": "low|medium|high", "revision": "low|medium|high"}, "notes": "anything unreadable"}`;

const normalizeDiscipline = (value, number) => {
  const text = trimOrNull(value);
  if (text) {
    const match = DISCIPLINE_NAMES.find((name) => String(name).toLowerCase() === text.toLowerCase()) || DISCIPLINE_NAMES.find((name) => text.toLowerCase().startsWith(String(name).toLowerCase().slice(0, 4)));
    if (match) return match;
  }
  return number ? disciplineFor(number) || text : text;
};

const normalizeRead = (parsed) => {
  const number = normalizeNumber(parsed?.number || "") || null;
  const confidence = parsed?.confidence && typeof parsed.confidence === "object" ? parsed.confidence : {};
  return {
    number,
    title: clip(parsed?.title, 200),
    revision: clip(parsed?.revision, 20)?.toUpperCase() || null,
    date: clip(parsed?.date, 40),
    discipline: clip(normalizeDiscipline(parsed?.discipline, number), 80),
    scale: clip(parsed?.scale, 40),
    drawnBy: clip(parsed?.drawnBy, 20),
    references: [...new Set((Array.isArray(parsed?.references) ? parsed.references : []).map((item) => normalizeNumber(String(item || ""))).filter((item) => item && looseKey(item) !== looseKey(number)))].slice(0, 30),
    fields: { number: { confidence: confidenceNumber(pick(confidence.number, CONFIDENCE, "medium")), source: "vision" }, title: { confidence: confidenceNumber(pick(confidence.title, CONFIDENCE, "medium")), source: "vision" }, revision: { confidence: confidenceNumber(pick(confidence.revision, CONFIDENCE, "low")), source: "vision" } },
    notes: clip(parsed?.notes, 300),
  };
};

/**
 * Reads the title blocks of rendered pages of a set. `pages` =
 * [{ revisionId, image: data URL }]; `apply` writes the proposals onto the
 * pending revisions (empty fields only unless `overwrite`).
 */
const readTitleBlocks = async ({ orgId, projectId, setId, user, payload = {}, transport = null }) => {
  const pages = Array.isArray(payload.pages) ? payload.pages.slice(0, MAX_PAGES()) : [];
  if (!pages.length) throw new HttpError(400, "DRAWING_AI_PAGES_REQUIRED", "Send at least one rendered page");
  const set = await prisma.drawingSet.findFirst({ where: { id: setId, projectId, orgId }, select: { id: true, setNumber: true, name: true, discipline: true } });
  if (!set) throw new HttpError(404, "DRAWING_SET_NOT_FOUND", "Drawing set not found");
  const revisions = await prisma.sheetRevision.findMany({ where: { setId: set.id, id: { in: pages.map((page) => page.revisionId) } }, select: { id: true, pageNumber: true, number: true, title: true, revision: true, discipline: true, status: true, textStatus: true } });
  const byId = new Map(revisions.map((row) => [row.id, row]));
  const provider = aiProvider.describe();
  if (!transport && !(provider.enabled && provider.vision)) return { degraded: true, reason: provider.enabled ? "The configured AI provider does not read images (AI_VISION is off)." : "AI title-block reading is not configured on this server.", items: [], applied: 0 };
  const items = [];
  for (const page of pages) {
    const revision = byId.get(page.revisionId);
    if (!revision) {
      items.push({ revisionId: page.revisionId, error: "Not a page of this set", proposal: null });
      continue;
    }
    let image;
    try {
      image = parseImage(page.image, `Page ${revision.pageNumber}`);
    } catch (error) {
      items.push({ revisionId: revision.id, pageNumber: revision.pageNumber, error: error.message, proposal: null });
      continue;
    }
    let completion;
    try {
      completion = await aiProvider.complete({ system: READ_PROMPT, messages: [{ role: "user", content: [{ type: "text", text: `Set ${set.setNumber} — ${set.name}${set.discipline ? ` (${set.discipline})` : ""}; page ${revision.pageNumber}. Read the title block.` }, { type: "image", mediaType: image.mediaType, data: image.data }] }], maxTokens: 600, temperature: 0, transport });
    } catch (error) {
      if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
      items.push({ revisionId: revision.id, pageNumber: revision.pageNumber, error: error.message, proposal: null });
      break;
    }
    const proposal = normalizeRead(aiProvider.parseJsonAnswer(completion.text));
    const stored = await assistant.storeRun({ orgId, user, projectId, kind: "sheet_read", recordType: "sheet_revision", recordId: revision.id, title: `Title block: ${set.setNumber} p.${revision.pageNumber}`, prompt: `[rendered page ${revision.pageNumber} of ${set.setNumber}]`, answer: JSON.stringify(proposal), usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null }).catch(() => null);
    items.push({ revisionId: revision.id, pageNumber: revision.pageNumber, current: { number: revision.number, title: revision.title, revision: revision.revision, discipline: revision.discipline, status: revision.status, textStatus: revision.textStatus }, proposal, message: runMessage(stored) });
  }
  let applied = 0;
  if (payload.apply) {
    const updates = items
      .filter((item) => item.proposal && item.current && (item.current.status === "pending_review" || item.current.status === "rejected"))
      .map((item) => {
        const update = { id: item.revisionId };
        for (const key of ["number", "title", "revision", "discipline"]) {
          if (item.proposal[key] && (payload.overwrite || !item.current[key])) update[key] = item.proposal[key];
        }
        return Object.keys(update).length > 1 ? update : null;
      })
      .filter(Boolean);
    if (updates.length) {
      await require("./drawing-set.service").reviewRevisions({ orgId, projectId, setId: set.id, updates, userId: user?.id || null });
      applied = updates.length;
    }
  }
  return { degraded: false, items, applied, limit: MAX_PAGES() };
};

// ─── Cross-references ─────────────────────────────────────────────────────

const TOKEN_RE = /\b([A-Z]{1,3})[-\s]?(\d{1,2}(?:[.\-]\d{1,3})?|\d{3,4})([A-Z]?)\b/g;
const CALLOUT_RE = /\b(\d{1,3})\s*\/\s*([A-Z]{1,3}[-\s]?\d[\d.\-]{0,5}[A-Z]?)\b/g;

/** Sheet numbers and detail callouts in a page's text that name another sheet of the project. */
const extractReferences = (text, knownNumbers, selfNumber = null) => {
  const known = new Map();
  for (const number of knownNumbers || []) known.set(looseKey(number), number);
  const self = selfNumber ? looseKey(selfNumber) : null;
  const found = new Map();
  const seen = new Set();
  const source = String(text || "");
  const note = (raw, index) => {
    const key = looseKey(raw);
    if (!known.has(key) || key === self || seen.has(index)) return;
    seen.add(index);
    const entry = found.get(key) || { targetNumber: known.get(key), count: 0, samples: [] };
    entry.count += 1;
    if (entry.samples.length < 3) entry.samples.push(source.slice(Math.max(0, index - 40), index + raw.length + 40).replace(/\s+/g, " ").trim());
    found.set(key, entry);
  };
  for (const match of source.matchAll(CALLOUT_RE)) note(match[2], match.index + match[0].indexOf(match[2]));
  for (const match of source.matchAll(TOKEN_RE)) note(match[0], match.index);
  return [...found.values()].sort((a, b) => b.count - a.count || a.targetNumber.localeCompare(b.targetNumber));
};

const sheetOut = (sheet) => (sheet ? { id: sheet.id, number: sheet.number, title: sheet.title, discipline: sheet.discipline || null, status: sheet.status, path: recordWorkspacePath({ projectId: sheet.projectId, recordType: "sheet", recordId: sheet.id }) } : null);

const referenceOut = (row) => ({ id: row.id, sheetId: row.sheetId, revisionId: row.revisionId || null, targetNumber: row.targetNumber, targetSheet: sheetOut(row.targetSheet), sheet: sheetOut(row.sheet), count: row.count, samples: Array.isArray(row.samplesJson) ? row.samplesJson : [], source: row.source, updatedAt: toIso(row.updatedAt) });

const listReferences = async ({ orgId, projectId, sheetId }) => {
  const sheet = await prisma.sheet.findFirst({ where: { id: sheetId, projectId, orgId }, select: { id: true, number: true } });
  if (!sheet) throw new HttpError(404, "SHEET_NOT_FOUND", "Sheet not found");
  if (!prisma.sheetReference?.findMany) return { sheetId, outgoing: [], incoming: [], builtAt: null };
  const [outgoing, incoming] = await Promise.all([
    prisma.sheetReference.findMany({ where: { projectId, sheetId }, include: { targetSheet: true }, orderBy: [{ count: "desc" }, { targetNumber: "asc" }] }),
    prisma.sheetReference.findMany({ where: { projectId, targetSheetId: sheetId }, include: { sheet: true }, orderBy: [{ count: "desc" }] }),
  ]);
  return { sheetId, outgoing: outgoing.map(referenceOut), incoming: incoming.map(referenceOut), builtAt: outgoing.length ? toIso(outgoing.map((row) => row.updatedAt).sort().pop()) : null };
};

const pageTextFor = async ({ documentId, pageNumber, cache }) => {
  if (!cache.has(documentId)) {
    const document = await prisma.projectDocument.findFirst({ where: { id: documentId } });
    if (!document) cache.set(documentId, null);
    else {
      try {
        const buffer = await require("./document-text.service").readDocumentBytes(document);
        cache.set(documentId, pdfPages(buffer));
      } catch {
        cache.set(documentId, null);
      }
    }
  }
  const parsed = cache.get(documentId);
  return parsed?.pages?.find((page) => page.pageNumber === pageNumber)?.text || "";
};

const upsertReferences = async ({ orgId, projectId, sheet, revision, references, sheetsByNumber, source = "text" }) => {
  const kept = new Set();
  for (const reference of references) {
    const target = sheetsByNumber.get(looseKey(reference.targetNumber)) || null;
    kept.add(reference.targetNumber);
    await prisma.sheetReference.upsert({
      where: { sheetId_targetNumber: { sheetId: sheet.id, targetNumber: reference.targetNumber } },
      create: { orgId, projectId, sheetId: sheet.id, revisionId: revision?.id || null, targetNumber: reference.targetNumber, targetSheetId: target?.id || null, count: reference.count, samplesJson: reference.samples, source },
      update: { revisionId: revision?.id || null, targetSheetId: target?.id || null, count: reference.count, samplesJson: reference.samples, source },
    });
  }
  if (source === "text") await prisma.sheetReference.deleteMany({ where: { sheetId: sheet.id, source: "text", targetNumber: { notIn: [...kept] } } });
  return kept.size;
};

/** Builds the outgoing references of one sheet from its current revision's text layer. */
const buildSheetReferences = async ({ orgId, projectId, sheetId }) => {
  const sheet = await prisma.sheet.findFirst({ where: { id: sheetId, projectId, orgId }, include: { revisions: { where: { status: "published" }, orderBy: { publishedAt: "desc" }, take: 1 } } });
  if (!sheet) throw new HttpError(404, "SHEET_NOT_FOUND", "Sheet not found");
  const revision = sheet.revisions?.[0] || null;
  if (!revision) return { ...(await listReferences({ orgId, projectId, sheetId })), built: 0, textStatus: "no_revision" };
  const sheets = await prisma.sheet.findMany({ where: { projectId, orgId }, select: { id: true, number: true } });
  const sheetsByNumber = new Map(sheets.map((row) => [looseKey(row.number), row]));
  const text = await pageTextFor({ documentId: revision.documentId, pageNumber: revision.pageNumber, cache: new Map() });
  const references = extractReferences(text, sheets.map((row) => row.number), sheet.number);
  const built = await upsertReferences({ orgId, projectId, sheet, revision, references, sheetsByNumber });
  return { ...(await listReferences({ orgId, projectId, sheetId })), built, textStatus: text ? "ready" : "no_text" };
};

/** Builds references for every published sheet of a set (one PDF parse per source document). */
const buildSetReferences = async ({ orgId, projectId, setId }) => {
  const set = await prisma.drawingSet.findFirst({ where: { id: setId, projectId, orgId }, select: { id: true } });
  if (!set) throw new HttpError(404, "DRAWING_SET_NOT_FOUND", "Drawing set not found");
  const revisions = await prisma.sheetRevision.findMany({ where: { setId: set.id, status: "published", sheetId: { not: null } }, include: { sheet: { select: { id: true, number: true } } } });
  const sheets = await prisma.sheet.findMany({ where: { projectId, orgId }, select: { id: true, number: true } });
  const sheetsByNumber = new Map(sheets.map((row) => [looseKey(row.number), row]));
  const cache = new Map();
  let sheetsBuilt = 0;
  let references = 0;
  let noText = 0;
  for (const revision of revisions) {
    if (!revision.sheet) continue;
    const text = await pageTextFor({ documentId: revision.documentId, pageNumber: revision.pageNumber, cache });
    if (!text) {
      noText += 1;
      continue;
    }
    const found = extractReferences(text, sheets.map((row) => row.number), revision.sheet.number);
    references += await upsertReferences({ orgId, projectId, sheet: revision.sheet, revision, references: found, sheetsByNumber });
    sheetsBuilt += 1;
  }
  return { setId: set.id, sheetsBuilt, references, noText, revisions: revisions.length };
};

// ─── Revision comparison ──────────────────────────────────────────────────

const COMPARE_PROMPT = `You compare two revisions of the same construction drawing sheet: image A is the earlier revision, image B the later. List what changed — added, removed or modified elements, notes, dimensions, revision clouds — naming the area of the sheet (grid, level, detail number) where each change sits. Only what is visible in both images; do not invent. Rate the impact of each change for the site team (low: annotation / cosmetic; medium: dimension, material or note that affects work; high: structural, layout or scope change).
Return ONLY a JSON object: {"summary": "two or three sentences", "changes": [{"area": "…", "description": "…", "kind": "added|removed|modified", "impact": "low|medium|high"}], "confidence": "low|medium|high"}`;

const normalizeCompare = (parsed) => ({
  summary: clip(parsed?.summary, 1500) || "No description was returned.",
  changes: (Array.isArray(parsed?.changes) ? parsed.changes : []).map((item) => ({ area: clip(item?.area, 120), description: clip(item?.description, 600), kind: pick(item?.kind, ["added", "removed", "modified"], "modified"), impact: pick(item?.impact, ["low", "medium", "high"], "medium") })).filter((item) => item.description).slice(0, 25),
  confidence: pick(parsed?.confidence, CONFIDENCE, "medium"),
});

const compareRevisions = async ({ orgId, projectId, sheetId, user, payload = {}, transport = null }) => {
  const sheet = await prisma.sheet.findFirst({ where: { id: sheetId, projectId, orgId }, select: { id: true, number: true, title: true } });
  if (!sheet) throw new HttpError(404, "SHEET_NOT_FOUND", "Sheet not found");
  const ids = [payload.a?.revisionId, payload.b?.revisionId].filter(Boolean);
  const revisions = await prisma.sheetRevision.findMany({ where: { id: { in: ids }, sheetId: sheet.id }, select: { id: true, revision: true, publishedAt: true, status: true } });
  if (revisions.length !== 2 || ids[0] === ids[1]) throw new HttpError(400, "DRAWING_AI_REVISIONS", "Send two different revisions of this sheet");
  const a = revisions.find((row) => row.id === payload.a.revisionId);
  const b = revisions.find((row) => row.id === payload.b.revisionId);
  const provider = aiProvider.describe();
  if (!transport && !(provider.enabled && provider.vision)) return { degraded: true, reason: provider.enabled ? "The configured AI provider does not read images (AI_VISION is off)." : "AI revision comparison is not configured on this server.", comparison: null, message: null };
  const imageA = parseImage(payload.a.image, "Revision A");
  const imageB = parseImage(payload.b.image, "Revision B");
  let completion;
  try {
    completion = await aiProvider.complete({ system: COMPARE_PROMPT, messages: [{ role: "user", content: [{ type: "text", text: `Sheet ${sheet.number} — ${sheet.title}. Image A: revision ${a.revision || "?"}${a.publishedAt ? ` (${toIso(a.publishedAt).slice(0, 10)})` : ""}.` }, { type: "image", mediaType: imageA.mediaType, data: imageA.data }, { type: "text", text: `Image B: revision ${b.revision || "?"}${b.publishedAt ? ` (${toIso(b.publishedAt).slice(0, 10)})` : ""}. List the changes from A to B.` }, { type: "image", mediaType: imageB.mediaType, data: imageB.data }] }], maxTokens: 1500, temperature: 0.1, transport });
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { degraded: true, reason: error.message, comparison: null, message: null };
  }
  const comparison = normalizeCompare(aiProvider.parseJsonAnswer(completion.text));
  const stored = await assistant.storeRun({ orgId, user, projectId, kind: "sheet_diff", recordType: "sheet", recordId: sheet.id, title: `Changes ${sheet.number}: rev ${a.revision || "?"} → ${b.revision || "?"}`, prompt: `[two rendered revisions of ${sheet.number}]`, answer: JSON.stringify(comparison), usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null }).catch(() => null);
  return { degraded: false, sheet: { id: sheet.id, number: sheet.number, title: sheet.title }, from: { id: a.id, revision: a.revision }, to: { id: b.id, revision: b.revision }, comparison, message: runMessage(stored) };
};

const status = () => {
  const provider = aiProvider.describe();
  return { vision: Boolean(provider.enabled && provider.vision), provider: provider.provider, model: provider.model, pageLimit: MAX_PAGES() };
};

module.exports = { READ_PROMPT, COMPARE_PROMPT, normalizeRead, extractReferences, pageTextFor, readTitleBlocks, listReferences, buildSheetReferences, buildSetReferences, compareRevisions, status };
