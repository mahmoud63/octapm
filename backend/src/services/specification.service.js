const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { recordWorkspacePath } = require("../utils/record-links");
const { pdfPages } = require("../utils/document-text");
const aiProvider = require("./ai-provider.service");
const assistant = require("./assistant.service");
const auditService = require("./audit.service");
const { SPEC_BOQ_WITHHELD } = require("../utils/boq-figures");

/**
 * Specifications and scope intelligence (OCTA-AI-SPEC-036).
 *
 *  - Section index: the extracted text of a specification document is
 *    parsed into sections (CSI MasterFormat "SECTION 03 30 00" / "03 30 00
 *    CAST-IN-PLACE CONCRETE", 1995 five-digit codes, or generic "SECTION 5
 *    – CONCRETE" / "5.3 CONCRETE WORKS" numbering); table-of-contents
 *    repeats are dropped in favour of the occurrence with the body.
 *  - Relating: each section is matched to BOQ items, sheets, activities and
 *    RFIs by keywords of its title, the division's vocabulary, CSI code
 *    prefixes and disciplines — deterministic, explained by `basis`.
 *  - Scope gaps: sections with no BOQ / drawings / activities, BOQ items
 *    no section covers, disciplines with sheets but no specification.
 *  - Conflicts: one section's text against the text layers of its related
 *    sheets and its RFIs, read by the model; conflicts and gaps are
 *    proposals — an RFI is raised only when the person asks.
 *
 * The BOQ side of all this is the BOQ's, not the specification's (owner
 * check, 2026-09-29): the routes admit document_control:read and pass the
 * caller's boq-figures access. A member who may not read the BOQ gets a
 * check run without loading the bill — no BOQ row, row count, uncovered
 * row, "no_boq" gap or BOQ count, in the answer or in the model's prompt —
 * and `boqWithheld` / `boqItemsWithheld` with the reason.
 *
 * A specification is a document, and a document is its records' (document-
 * text.service documentVisible): the routes pass the caller's `viewer`
 * (documentViewer) and every door here — the document list, indexing, the
 * section list, a section's text, the scope check, the conflict check and
 * raising an RFI — admits only the documents that viewer may read, a hidden
 * one answered as a missing one. A section's related RFIs are those the RFI
 * register lists to the caller: none without RFI read, and for the rest the
 * register's own where (party routing with `projectAccess`, drafts to their
 * author and manager). The listing handed every document-control reader the
 * text of executed subcontracts, lien waivers and other parties' RFI
 * attachments, and the RFIs routed to other companies (certification R30,
 * R7). Without a viewer (no caller) nothing is filtered.
 */

/** Everything, as the service has always answered a BOQ reader. */
const BOQ_READER = Object.freeze({ boq: true });
const boqWithheld = () => ({ reason: SPEC_BOQ_WITHHELD });

// ─── Who reads ────────────────────────────────────────────────────────────

const documentText = () => require("./document-text.service");

/** The ids among these documents the viewer may read; null (no filter) without a viewer. */
const readableAmong = async ({ orgId, projectId, documentIds, viewer }) =>
  viewer ? documentText().readableDocumentIds({ orgId, projectId, documentIds, viewer }) : null;

/** Whether the viewer may read one document (always, without a viewer). */
const documentReadable = async ({ orgId, projectId, documentId, viewer }) =>
  !viewer || documentText().documentReadableToViewer({ orgId, projectId, documentId, viewer });

/** The documents of the project's indexed sections the viewer may read; null without a viewer. */
const readableSectionDocuments = async ({ orgId, projectId, viewer }) => {
  if (!viewer) return null;
  const rows = await prisma.specSection.findMany({ where: { orgId, projectId }, select: { documentId: true }, distinct: ["documentId"] });
  return readableAmong({ orgId, projectId, documentIds: rows.map((row) => row.documentId), viewer });
};
const ofReadable = (readable) => (readable ? { documentId: { in: [...readable] } } : null);

/** The RFIs a section may be related to for this caller: none without RFI read, else the register's where. */
const relatedRfiWhere = ({ projectId, viewer, projectAccess }) => {
  const where = { projectId, archivedAt: null };
  if (!viewer) return where;
  if (typeof viewer.canRead === "function" && !viewer.canRead("rfi")) return null;
  const { applyPartyWorkflowVisibility } = require("./company-party.service");
  const { withDraftVisibility } = require("./rfi-workflow.service");
  return withDraftVisibility(applyPartyWorkflowVisibility(where, projectAccess || {}), viewer.userId || viewer.id || null);
};

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
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const SPEC_CHARS = () => Math.max(2000, Math.min(60000, Number(process.env.AI_SPEC_CHARS || 12000)));
const SPEC_SHEETS = () => Math.max(1, Math.min(12, Number(process.env.AI_SPEC_SHEETS || 6)));
const SHEET_CHARS = 3000;

// ─── Vocabulary ───────────────────────────────────────────────────────────

const DIVISION_LABELS = Object.freeze({
  "00": "Procurement and contracting",
  "01": "General requirements",
  "02": "Existing conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, plastics and composites",
  "07": "Thermal and moisture protection",
  "08": "Openings",
  "09": "Finishes",
  10: "Specialties",
  11: "Equipment",
  12: "Furnishings",
  13: "Special construction",
  14: "Conveying equipment",
  21: "Fire suppression",
  22: "Plumbing",
  23: "HVAC",
  25: "Integrated automation",
  26: "Electrical",
  27: "Communications",
  28: "Electronic safety and security",
  31: "Earthwork",
  32: "Exterior improvements",
  33: "Utilities",
  34: "Transportation",
  35: "Waterway and marine",
});

const DIVISION_KEYWORDS = Object.freeze({
  "02": ["demolition", "survey", "existing", "asbestos", "remediation"],
  "03": ["concrete", "formwork", "rebar", "reinforcement", "reinforcing", "slab", "foundation", "footing", "column", "beam", "precast", "grout", "screed", "cement"],
  "04": ["masonry", "block", "blockwork", "brick", "brickwork", "mortar", "stone"],
  "05": ["steel", "structural steel", "metal", "metalwork", "railing", "handrail", "decking", "welding", "bolt", "stair"],
  "06": ["wood", "timber", "carpentry", "joinery", "plywood", "millwork", "cabinet", "composite"],
  "07": ["waterproofing", "insulation", "roofing", "roof", "membrane", "sealant", "flashing", "damp", "vapour", "vapor", "cladding", "firestopping", "thermal"],
  "08": ["door", "window", "glazing", "glass", "curtain wall", "louver", "louvre", "hardware", "shutter", "frame", "skylight"],
  "09": ["finish", "finishes", "plaster", "gypsum", "drywall", "paint", "painting", "tile", "tiling", "ceiling", "flooring", "carpet", "render", "screed", "epoxy"],
  10: ["signage", "partition", "toilet", "locker", "canopy", "specialties"],
  11: ["equipment", "appliance", "kitchen", "laboratory"],
  12: ["furniture", "furnishing", "blind", "curtain", "seating"],
  13: ["pool", "swimming", "clean room", "special construction"],
  14: ["elevator", "lift", "escalator", "hoist", "conveying"],
  21: ["sprinkler", "fire suppression", "fire fighting", "firefighting", "standpipe", "hydrant", "fire pump"],
  22: ["plumbing", "drainage", "sanitary", "water supply", "pipe", "piping", "sewage", "sump", "fixture"],
  23: ["hvac", "duct", "ductwork", "chiller", "ventilation", "air conditioning", "ahu", "fcu", "fan", "cooling", "heating", "refrigerant", "diffuser"],
  25: ["bms", "automation", "controls"],
  26: ["electrical", "cable", "cabling", "lighting", "panel", "switchgear", "transformer", "conduit", "socket", "earthing", "grounding", "generator", "busbar", "distribution board"],
  27: ["communications", "data", "telephone", "structured cabling", "network", "fibre", "fiber", "pa system"],
  28: ["fire alarm", "security", "cctv", "access control", "detection", "intrusion"],
  31: ["earthwork", "excavation", "backfill", "piling", "pile", "dewatering", "grading", "compaction", "shoring", "soil"],
  32: ["paving", "asphalt", "landscape", "landscaping", "kerb", "curb", "fence", "fencing", "irrigation", "planting", "external works"],
  33: ["utilities", "sewer", "water main", "storm", "manhole", "utility", "gas", "district cooling"],
  34: ["road", "rail", "bridge", "transportation"],
  35: ["marine", "dredging", "quay", "waterway"],
});

const DIVISION_DISCIPLINES = Object.freeze({
  "02": ["Civil"],
  "03": ["Structural", "Civil"],
  "04": ["Structural", "Architectural"],
  "05": ["Structural", "Architectural"],
  "06": ["Architectural", "Interior"],
  "07": ["Architectural"],
  "08": ["Architectural"],
  "09": ["Architectural", "Interior"],
  10: ["Architectural", "Interior"],
  11: ["Architectural", "Mechanical"],
  12: ["Interior", "Architectural"],
  13: ["Architectural"],
  14: ["Mechanical", "Architectural"],
  21: ["Fire", "Mechanical"],
  22: ["Plumbing", "Mechanical"],
  23: ["Mechanical"],
  25: ["Electrical", "Mechanical"],
  26: ["Electrical"],
  27: ["Electrical", "Telecommunications"],
  28: ["Electrical", "Fire"],
  31: ["Civil", "Structural"],
  32: ["Civil", "Landscape"],
  33: ["Civil"],
  34: ["Civil"],
  35: ["Civil"],
});

const STOPWORDS = new Set(["and", "or", "of", "the", "for", "to", "in", "on", "with", "a", "an", "by", "at", "from", "general", "requirement", "requirements", "work", "works", "system", "systems", "section", "part", "other", "misc", "miscellaneous", "all", "including", "etc", "new", "type", "typical", "detail", "details", "plan", "plans", "level", "layout", "schedule", "notes", "supply", "install", "installation", "provide", "complete", "as", "per", "item", "items"]);

const stem = (word) => {
  let w = word;
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("es") && !w.endsWith("ses")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
};

/** Distinct stemmed keywords of a text (lower case, ≥ 3 letters, no stopwords). */
const tokens = (text) => {
  const out = new Set();
  for (const raw of String(text || "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    if (/^\d+$/.test(raw)) continue;
    out.add(stem(raw));
  }
  return out;
};

const divisionTokens = new Map(Object.entries(DIVISION_KEYWORDS).map(([division, words]) => [String(division).padStart(2, "0"), tokens(words.join(" "))]));

const intersect = (a, b) => {
  let n = 0;
  for (const item of a) if (b.has(item)) n += 1;
  return n;
};

// ─── Section parsing ──────────────────────────────────────────────────────

const CSI_SECTION_RE = /^SECTION\s+(\d{2}\s?\d{2}\s?\d{2}(?:[.\-]\d{2})?|\d{5})\b[\s\-–—:.]*(.*)$/i;
const CSI_INLINE_RE = /^(\d{2}\s\d{2}\s\d{2}(?:[.\-]\d{2})?)\s*[\-–—:]?\s+([A-Za-z][^\n]{2,90})$/;
const GENERIC_SECTION_RE = /^SECTION\s+([A-Z]?\d{1,3}(?:\.\d{1,2})?)\b[\s\-–—:.]*(.*)$/i;
const NUMBERED_HEADING_RE = /^(\d{1,2}(?:\.\d{1,2}){1,2})\s+([A-Z][A-Z0-9 ,&/\-()']{3,80})$/;
const DIVISION_RE = /^DIVISION\s+(\d{1,2})\b/i;

const csiKey = (code) => code.replace(/[\s.\-]/g, "");
const csiDisplay = (code) => {
  const key = csiKey(code);
  if (key.length >= 6) return `${key.slice(0, 2)} ${key.slice(2, 4)} ${key.slice(4, 6)}${key.length > 6 ? `.${key.slice(6)}` : ""}`;
  return key;
};
const divisionOf = (codeKey) => {
  if (/^\d{5,}$/.test(codeKey)) return codeKey.slice(0, 2);
  const match = /^[A-Z]?(\d{1,2})/i.exec(codeKey);
  return match ? match[1].padStart(2, "0") : null;
};
const looksLikeTitle = (line) => line && line.length <= 100 && /[A-Za-z]{3,}/.test(line) && !/^(PART|SECTION|DIVISION|END OF SECTION|\d)/i.test(line);

/**
 * Headings of a specification text with their character offsets. CSI
 * headings win; generic numbered headings are used only when no CSI heading
 * exists, so the "1.01 SUMMARY" paragraphs inside CSI sections never become
 * sections.
 */
const detectHeadings = (text) => {
  const lines = [];
  let offset = 0;
  for (const raw of String(text || "").split("\n")) {
    lines.push({ raw, offset });
    offset += raw.length + 1;
  }
  const csi = [];
  const generic = [];
  const nextTitle = (index) => {
    for (let look = index + 1; look < Math.min(lines.length, index + 3); look += 1) {
      const candidate = lines[look].raw.trim();
      if (!candidate) continue;
      return looksLikeTitle(candidate) ? candidate : null;
    }
    return null;
  };
  lines.forEach((line, index) => {
    const value = line.raw.trim();
    if (!value || value.length > 140 || DIVISION_RE.test(value)) return;
    let match = CSI_SECTION_RE.exec(value);
    if (match) {
      const title = trimOrNull(match[2]) || nextTitle(index);
      if (title) csi.push({ code: csiDisplay(match[1]), codeKey: csiKey(match[1]), title, charStart: line.offset, headingText: value });
      return;
    }
    match = CSI_INLINE_RE.exec(value);
    if (match) {
      csi.push({ code: csiDisplay(match[1]), codeKey: csiKey(match[1]), title: match[2].trim(), charStart: line.offset, headingText: value });
      return;
    }
    match = GENERIC_SECTION_RE.exec(value);
    if (match) {
      const title = trimOrNull(match[2]) || nextTitle(index);
      if (title) generic.push({ code: match[1].toUpperCase(), codeKey: match[1].toUpperCase(), title, charStart: line.offset, headingText: value, weight: 2 });
      return;
    }
    match = NUMBERED_HEADING_RE.exec(value);
    if (match) generic.push({ code: match[1], codeKey: match[1], title: match[2].trim(), charStart: line.offset, headingText: value, weight: 1 });
  });
  if (csi.length) return csi;
  if (generic.some((item) => item.weight === 2)) return generic.filter((item) => item.weight === 2);
  return generic;
};

/** Sections with bodies; table-of-contents repeats of a code are dropped for the longest occurrence. */
const parseSections = (text) => {
  const headings = detectHeadings(text);
  const total = String(text || "").length;
  const withEnds = headings.map((heading, index) => ({ ...heading, charEnd: index + 1 < headings.length ? headings[index + 1].charStart : total }));
  const best = new Map();
  for (const heading of withEnds) {
    const length = heading.charEnd - heading.charStart;
    const current = best.get(heading.codeKey);
    if (!current || length > current.charEnd - current.charStart) best.set(heading.codeKey, heading);
  }
  const kept = [...best.values()].filter((heading) => heading.charEnd - heading.charStart >= 120 || best.size === 1).sort((a, b) => a.charStart - b.charStart);
  return kept.map((heading, index) => {
    const body = String(text || "").slice(heading.charStart, heading.charEnd);
    return { code: heading.code, codeKey: heading.codeKey, division: divisionOf(heading.codeKey), title: clip(heading.title.replace(/\s+/g, " "), 200), charStart: heading.charStart, charEnd: heading.charEnd, wordCount: body.split(/\s+/).filter(Boolean).length, sortOrder: index, headingText: heading.headingText, dropped: withEnds.length - kept.length };
  });
};

/** Page of each heading, found by searching the heading line in the PDF's own page texts. */
const pagesFor = (sections, pages) => {
  if (!pages?.length) return sections.map((section) => ({ ...section, pageFrom: null, pageTo: null }));
  const normalized = pages.map((page) => ({ pageNumber: page.pageNumber, text: String(page.text || "").replace(/\s+/g, " ").toUpperCase() }));
  let cursor = 0;
  const located = sections.map((section) => {
    const needle = section.headingText.replace(/\s+/g, " ").toUpperCase();
    let found = null;
    // Prefer the last page that carries the heading at or after the cursor — the TOC comes first.
    for (let index = normalized.length - 1; index >= cursor; index -= 1) {
      if (normalized[index].text.includes(needle)) {
        found = index;
        break;
      }
    }
    if (found === null) for (let index = cursor; index < normalized.length; index += 1) if (normalized[index].text.includes(needle)) found = index;
    if (found !== null) cursor = found;
    return { ...section, pageFrom: found === null ? null : normalized[found].pageNumber };
  });
  return located.map((section, index) => ({ ...section, pageTo: section.pageFrom === null ? null : (located.slice(index + 1).find((next) => next.pageFrom !== null)?.pageFrom ?? normalized[normalized.length - 1].pageNumber) }));
};

// ─── Index ────────────────────────────────────────────────────────────────

const documentOut = (document, counts = {}) => ({
  id: document.id,
  title: document.title || document.originalName,
  originalName: document.originalName,
  documentNumber: document.documentNumber || null,
  category: document.category || null,
  discipline: document.discipline || null,
  mimeType: document.mimeType,
  uploadedAt: toIso(document.uploadedAt),
  wordCount: document.text?.wordCount ?? counts.wordCount ?? 0,
  pageCount: document.text?.pageCount ?? counts.pageCount ?? null,
  sections: counts.sections ?? 0,
  indexedAt: counts.indexedAt ?? null,
});

const loadText = async ({ orgId, projectId, documentId, viewer = null }) => {
  const document = await prisma.projectDocument.findFirst({ where: { id: documentId, orgId, projectId }, include: { text: true } });
  // One the caller may not read is answered as a missing one, before its text's state says it exists.
  if (!document || !(await documentReadable({ orgId, projectId, documentId: document.id, viewer }))) throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document not found");
  if (document.text?.status !== "ready" || !document.text.text) throw new HttpError(409, "SPEC_TEXT_NOT_READY", "The document's text has not been extracted yet — index the document first");
  return document;
};

/** Parses one document into sections and stores them (replacing earlier rows). */
const indexDocument = async ({ orgId, projectId, documentId, userId = null, viewer = null }) => {
  const document = await loadText({ orgId, projectId, documentId, viewer });
  let sections = parseSections(document.text.text);
  if (sections.length && /pdf/i.test(document.mimeType)) {
    try {
      const buffer = await require("./document-text.service").readDocumentBytes(document);
      sections = pagesFor(sections, pdfPages(buffer).pages);
    } catch {
      sections = sections.map((section) => ({ ...section, pageFrom: null, pageTo: null }));
    }
  } else sections = sections.map((section) => ({ ...section, pageFrom: null, pageTo: null }));
  await prisma.$transaction(async (tx) => {
    await tx.specSection.deleteMany({ where: { documentId: document.id } });
    if (sections.length) {
      await tx.specSection.createMany({ data: sections.map(({ headingText, dropped, ...section }) => ({ ...section, orgId, projectId, documentId: document.id })) });
    }
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "document", entityId: document.id, action: auditService.ACTIONS.UPDATED, actorId: userId, summary: { specSections: sections.length } }).catch(() => null);
  return { documentId: document.id, title: document.title || document.originalName, sections: sections.length, dropped: sections[0]?.dropped ?? 0, divisions: [...new Set(sections.map((section) => section.division).filter(Boolean))].sort() };
};

const SPEC_HINT_RE = /\b(SECTION\s+\d{2}\s?\d{2}\s?\d{2}|\d{2}\s\d{2}\s\d{2}\s+[A-Z]|SECTION\s+\d{5}\b|PART\s+[123]\s*[\-–—]\s*(GENERAL|PRODUCTS|EXECUTION)|END OF SECTION)/g;

/** Every document with extracted text the viewer may read, with its section count and whether it reads like a specification. */
const listDocuments = async ({ orgId, projectId, viewer = null }) => {
  const [texts, counts] = await Promise.all([
    prisma.documentText.findMany({ where: { orgId, projectId, status: "ready" }, select: { documentId: true, wordCount: true, pageCount: true, excerpt: true, document: { select: { id: true, title: true, originalName: true, documentNumber: true, category: true, discipline: true, mimeType: true, uploadedAt: true } } }, orderBy: { updatedAt: "desc" }, take: 300 }),
    prisma.specSection.groupBy({ by: ["documentId"], where: { projectId }, _count: { _all: true }, _max: { updatedAt: true } }).catch(() => []),
  ]);
  const countById = new Map(counts.map((row) => [row.documentId, { sections: row._count._all, indexedAt: toIso(row._max.updatedAt) }]));
  const readable = await readableAmong({ orgId, projectId, documentIds: texts.map((row) => row.documentId), viewer });
  return {
    items: texts
      .filter((row) => row.document && (!readable || readable.has(row.documentId)))
      .map((row) => {
        const meta = countById.get(row.documentId) || {};
        const hints = (String(row.excerpt || "").match(SPEC_HINT_RE) || []).length;
        return { ...documentOut(row.document, { wordCount: row.wordCount, pageCount: row.pageCount, ...meta }), likelySpec: meta.sections > 0 || hints >= 2 || /spec/i.test(`${row.document.title || ""} ${row.document.originalName} ${row.document.category || ""}`) };
      })
      .sort((a, b) => Number(b.likelySpec) - Number(a.likelySpec) || b.sections - a.sections),
  };
};

/**
 * Indexes the given documents, or every document that reads like a
 * specification — of those the viewer may read: a named one it may not is
 * answered as a missing one (loadText), and the scan neither indexes nor
 * names one.
 */
const scanProject = async ({ orgId, projectId, documentIds = null, userId = null, viewer = null }) => {
  let ids = Array.isArray(documentIds) && documentIds.length ? documentIds : null;
  if (!ids) {
    const texts = await prisma.documentText.findMany({ where: { orgId, projectId, status: "ready", wordCount: { gte: 300 } }, select: { documentId: true, text: true }, take: 200 });
    ids = texts.filter((row) => (String(row.text || "").match(SPEC_HINT_RE) || []).length >= 3).map((row) => row.documentId);
    const readable = await readableAmong({ orgId, projectId, documentIds: ids, viewer });
    if (readable) ids = ids.filter((id) => readable.has(id));
  }
  const results = [];
  for (const documentId of ids) {
    try {
      results.push({ ...(await indexDocument({ orgId, projectId, documentId, userId, viewer })), error: null });
    } catch (error) {
      results.push({ documentId, sections: 0, error: error.message });
    }
  }
  return { documents: results, sections: results.reduce((sum, row) => sum + (row.sections || 0), 0) };
};

// ─── Relating sections to the project ─────────────────────────────────────

const sectionOut = (row) => ({
  id: row.id,
  documentId: row.documentId,
  document: row.document ? { id: row.document.id, title: row.document.title || row.document.originalName } : undefined,
  code: row.code,
  codeKey: row.codeKey,
  division: row.division,
  divisionLabel: row.division ? DIVISION_LABELS[row.division] || null : null,
  title: row.title,
  pageFrom: row.pageFrom,
  pageTo: row.pageTo,
  wordCount: row.wordCount,
  sortOrder: row.sortOrder,
  path: recordWorkspacePath({ projectId: row.projectId, recordType: "spec_section", recordId: row.id }),
});

// `withBoq: false` does not read the bill at all (a member who may not read the BOQ).
// The RFIs are those the caller's RFI register lists (relatedRfiWhere).
const loadContext = async ({ orgId, projectId, withBoq = true, viewer = null, projectAccess = null }) => {
  const rfiWhere = relatedRfiWhere({ projectId, viewer, projectAccess });
  const [boqItems, sheets, activities, rfis] = await Promise.all([
    !withBoq ? [] : prisma.boqItem.findMany({ where: { projectId, isActive: true }, select: { id: true, code: true, description: true, unit: true, qty: true, section: true }, orderBy: { sortOrder: "asc" }, take: 5000 }),
    prisma.sheet.findMany({ where: { orgId, projectId, status: "current" }, select: { id: true, number: true, title: true, discipline: true, currentRevisionId: true }, orderBy: { sortKey: "asc" }, take: 3000 }),
    prisma.activity.findMany({ where: { projectId }, select: { id: true, name: true, activityCode: true, wbsCode: true }, take: 5000 }),
    !rfiWhere ? [] : prisma.rfi.findMany({ where: rfiWhere, select: { id: true, ref: true, subject: true, question: true, response: true, specSection: true, status: true }, take: 2000 }),
  ]);
  return {
    boqItems: boqItems.map((item) => ({ ...item, keys: tokens(`${item.description} ${item.section || ""}`), codeKey: item.code ? item.code.replace(/[\s.\-]/g, "") : "" })),
    sheets: sheets.map((sheet) => ({ ...sheet, keys: tokens(sheet.title) })),
    activities: activities.map((activity) => ({ ...activity, keys: tokens(activity.name) })),
    rfis: rfis.map((rfi) => ({ ...rfi, keys: tokens(rfi.subject), specKey: rfi.specSection ? rfi.specSection.replace(/[\s.\-]/g, "") : "" })),
  };
};

const sectionKeys = (section) => ({ title: tokens(section.title), family: (section.division && divisionTokens.get(section.division)) || new Set() });

/** Why a record relates to a section, or null. */
const matchBasis = (keys, candidateKeys, { small }) => {
  const hits = intersect(keys.title, candidateKeys);
  const family = intersect(keys.family, candidateKeys);
  if (hits >= 2) return { basis: "title", score: hits * 2 + family };
  if (hits >= 1 && (family >= 1 || small)) return { basis: "title", score: hits * 2 + family };
  if (family >= 2) return { basis: "division", score: family };
  return null;
};

/** Related BOQ items, sheets, activities and RFIs of one section with the reason for each. */
const relateSection = (section, context) => {
  const keys = sectionKeys(section);
  const small = keys.title.size <= 2;
  const csiPrefix = /^\d{5,}$/.test(section.codeKey) ? section.codeKey.slice(0, 4) : null;
  const disciplines = section.division ? DIVISION_DISCIPLINES[section.division] || [] : [];
  const boqItems = context.boqItems
    .map((item) => {
      if (csiPrefix && item.codeKey.length >= 5 && item.codeKey.startsWith(csiPrefix)) return { item, basis: "code", score: 10 };
      const match = matchBasis(keys, item.keys, { small });
      return match ? { item, ...match } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map(({ item, basis, score }) => ({ id: item.id, code: item.code, description: item.description, unit: item.unit, qty: item.qty, basis, score }));
  const sheets = context.sheets
    .map((sheet) => {
      const match = matchBasis(keys, sheet.keys, { small });
      if (match) return { sheet, ...match };
      if (sheet.discipline && disciplines.includes(sheet.discipline)) return { sheet, basis: "discipline", score: 0 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map(({ sheet, basis, score }) => ({ id: sheet.id, number: sheet.number, title: sheet.title, discipline: sheet.discipline, currentRevisionId: sheet.currentRevisionId, basis, score, path: recordWorkspacePath({ projectId: section.projectId, recordType: "sheet", recordId: sheet.id }) }));
  const activities = context.activities
    .map((activity) => {
      const match = matchBasis(keys, activity.keys, { small });
      return match ? { activity, ...match } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map(({ activity, basis, score }) => ({ id: activity.id, name: activity.name, activityCode: activity.activityCode, wbsCode: activity.wbsCode, basis, score }));
  const rfis = context.rfis
    .map((rfi) => {
      if (rfi.specKey && (rfi.specKey === section.codeKey || (csiPrefix && rfi.specKey.startsWith(csiPrefix)))) return { rfi, basis: "spec_section", score: 10 };
      const match = matchBasis(keys, rfi.keys, { small });
      return match ? { rfi, ...match } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map(({ rfi, basis, score }) => ({ id: rfi.id, ref: rfi.ref, subject: rfi.subject, status: rfi.status, basis, score, path: recordWorkspacePath({ projectId: section.projectId, recordType: "rfi", recordId: rfi.id }) }));
  return { boqItems, sheets, activities, rfis, keywords: [...keys.title], disciplines };
};

const listSections = async ({ orgId, projectId, q = null, division = null, documentId = null, viewer = null }) => {
  const readable = ofReadable(await readableSectionDocuments({ orgId, projectId, viewer }));
  const where = { orgId, projectId, ...(division ? { division } : {}), ...(documentId ? { documentId } : {}), ...(readable ? { AND: [readable] } : {}) };
  const search = trimOrNull(q);
  if (search) where.OR = [{ title: { contains: search, mode: "insensitive" } }, { code: { contains: search, mode: "insensitive" } }, { codeKey: { contains: search.replace(/[\s.\-]/g, ""), mode: "insensitive" } }];
  const [rows, all] = await Promise.all([
    prisma.specSection.findMany({ where, include: { document: { select: { id: true, title: true, originalName: true } } }, orderBy: [{ division: "asc" }, { codeKey: "asc" }, { sortOrder: "asc" }], take: 2000 }),
    prisma.specSection.groupBy({ by: ["division"], where: { orgId, projectId, ...(readable || {}) }, _count: { _all: true } }).catch(() => []),
  ]);
  const divisions = all.map((row) => ({ division: row.division, label: row.division ? DIVISION_LABELS[row.division] || null : null, count: row._count._all })).sort((a, b) => String(a.division || "zz").localeCompare(String(b.division || "zz")));
  return { items: rows.map(sectionOut), divisions, total: divisions.reduce((sum, row) => sum + row.count, 0) };
};

/** A section's related records as this caller may receive them: no BOQ rows for a member who may not read the BOQ. */
const relatedFor = (related, access) => {
  if (access.boq) return related;
  const { boqItems, ...rest } = related;
  return { ...rest, boqItemsWithheld: boqWithheld() };
};

/** A section the viewer may open: its document readable to them, else answered as a missing section. */
const findReadableSection = async ({ orgId, projectId, sectionId, viewer, include = undefined }) => {
  const row = await prisma.specSection.findFirst({ where: { id: sectionId, orgId, projectId }, ...(include ? { include } : {}) });
  if (!row || !(await documentReadable({ orgId, projectId, documentId: row.documentId, viewer }))) throw new HttpError(404, "SPEC_SECTION_NOT_FOUND", "Specification section not found");
  return row;
};

const getSection = async ({ orgId, projectId, sectionId, maxChars = 20000, access = BOQ_READER, viewer = null, projectAccess = null }) => {
  const row = await findReadableSection({ orgId, projectId, sectionId, viewer, include: { document: { select: { id: true, title: true, originalName: true, text: { select: { text: true } } } } } });
  const full = String(row.document?.text?.text || "").slice(row.charStart, row.charEnd);
  const context = await loadContext({ orgId, projectId, withBoq: access.boq, viewer, projectAccess });
  return { ...sectionOut(row), text: full.slice(0, maxChars), truncated: full.length > maxChars, totalChars: full.length, related: relatedFor(relateSection(row, context), access) };
};

// ─── Scope gaps ───────────────────────────────────────────────────────────

const BOQ_EMPTY_NOTE = "The BOQ is empty, so BOQ coverage cannot be checked.";

/**
 * The check as this caller may receive it. Run without the bill for a
 * member who may not read the BOQ (no "no_boq" gap can arise, so withGaps
 * counts drawing and activity gaps only); then every BOQ key is left out —
 * the section's BOQ count, the summary's noBoq, boqItems and uncoveredBoq,
 * the uncovered rows and the "BOQ is empty" note — and boqWithheld says why.
 */
const withoutBoqCoverage = (gaps) => {
  const { uncoveredBoq, ...rest } = gaps;
  const { noBoq, boqItems, uncoveredBoq: uncoveredCount, ...summary } = gaps.summary;
  return {
    ...rest,
    sections: gaps.sections.map(({ counts, ...section }) => {
      const { boq, ...kept } = counts;
      return { ...section, counts: kept };
    }),
    summary,
    notes: gaps.notes.filter((note) => note !== BOQ_EMPTY_NOTE),
    boqWithheld: boqWithheld(),
  };
};

const scopeGaps = async ({ orgId, projectId, access = BOQ_READER, viewer = null, projectAccess = null }) => {
  const readable = ofReadable(await readableSectionDocuments({ orgId, projectId, viewer }));
  const [rows, context] = await Promise.all([
    prisma.specSection.findMany({ where: { orgId, projectId, ...(readable || {}) }, include: { document: { select: { id: true, title: true, originalName: true } } }, orderBy: [{ division: "asc" }, { codeKey: "asc" }] }),
    loadContext({ orgId, projectId, withBoq: access.boq, viewer, projectAccess }),
  ]);
  const coveredBoq = new Set();
  const sections = rows.map((row) => {
    const related = relateSection(row, context);
    for (const item of related.boqItems) coveredBoq.add(item.id);
    const gaps = [];
    if (context.boqItems.length && !related.boqItems.length) gaps.push("no_boq");
    if (context.sheets.length && !related.sheets.length) gaps.push("no_drawings");
    if (context.activities.length && !related.activities.length) gaps.push("no_activities");
    return { ...sectionOut(row), counts: { boq: related.boqItems.length, sheets: related.sheets.filter((sheet) => sheet.basis !== "discipline").length, sheetsByDiscipline: related.sheets.length, activities: related.activities.length, rfis: related.rfis.length }, gaps, keywords: related.keywords };
  });
  const divisionsPresent = new Set(rows.map((row) => row.division).filter(Boolean));
  const disciplinesWithSpecs = new Set([...divisionsPresent].flatMap((division) => DIVISION_DISCIPLINES[division] || []));
  const sheetsByDiscipline = new Map();
  for (const sheet of context.sheets) {
    const key = sheet.discipline || "Unassigned";
    sheetsByDiscipline.set(key, (sheetsByDiscipline.get(key) || 0) + 1);
  }
  const uncoveredDisciplines = rows.length ? [...sheetsByDiscipline.entries()].filter(([discipline]) => discipline !== "Unassigned" && !disciplinesWithSpecs.has(discipline)).map(([discipline, count]) => ({ discipline, sheets: count })) : [];
  const uncoveredBoq = rows.length ? context.boqItems.filter((item) => !coveredBoq.has(item.id)) : [];
  const notes = [];
  if (!rows.length) notes.push("No specification has been indexed yet — pick the specification documents and index them.");
  if (!context.boqItems.length) notes.push(BOQ_EMPTY_NOTE);
  if (!context.sheets.length) notes.push("No sheets are published, so drawing coverage cannot be checked.");
  if (!context.activities.length) notes.push("The schedule has no activities, so activity coverage cannot be checked.");
  const gaps = {
    sections,
    summary: { sections: sections.length, withGaps: sections.filter((section) => section.gaps.length).length, noBoq: sections.filter((section) => section.gaps.includes("no_boq")).length, noDrawings: sections.filter((section) => section.gaps.includes("no_drawings")).length, noActivities: sections.filter((section) => section.gaps.includes("no_activities")).length, boqItems: context.boqItems.length, uncoveredBoq: uncoveredBoq.length, sheets: context.sheets.length, activities: context.activities.length },
    uncoveredBoq: uncoveredBoq.slice(0, 200).map((item) => ({ id: item.id, code: item.code, description: item.description, unit: item.unit, qty: item.qty })),
    uncoveredDisciplines,
    notes,
    computedAt: new Date().toISOString(),
  };
  return access.boq ? gaps : withoutBoqCoverage(gaps);
};

const GAP_PROMPT = `You are a construction commercial / technical reviewer. You get a scope-coverage check of a project's specification against its BOQ, drawings and schedule (computed by keyword and code matching — treat matches as indicative). Write a short review for the project manager: what looks genuinely missing, what is probably a naming mismatch rather than a gap, and what to do first. Be concrete, name sections and items, no padding.
Return ONLY a JSON object: {"headline": "one sentence", "narrative": "markdown, 2–4 short paragraphs or bullets", "actions": [{"type": "create_task", "title": "...", "description": "..."}, {"type": "create_rfi", "subject": "...", "question": "..."}]} — at most four actions.`;

const deterministicGapNarrative = (gaps) => {
  const lines = [];
  const { summary } = gaps;
  const boqPart = gaps.boqWithheld ? "" : `${summary.noBoq} without BOQ items, `;
  lines.push(`${summary.sections} specification section${summary.sections === 1 ? "" : "s"} checked: ${boqPart}${summary.noDrawings} without drawings, ${summary.noActivities} without schedule activities.`);
  if (summary.uncoveredBoq) lines.push(`${summary.uncoveredBoq} of ${summary.boqItems} BOQ items match no specification section — check whether they are covered by a section under another name.`);
  for (const discipline of gaps.uncoveredDisciplines) lines.push(`${discipline.sheets} ${discipline.discipline} sheet${discipline.sheets === 1 ? "" : "s"} but no specification section for that discipline.`);
  for (const section of gaps.sections.filter((row) => row.gaps.length).slice(0, 8)) lines.push(`- ${section.code} ${section.title}: ${section.gaps.map((gap) => ({ no_boq: "no BOQ items", no_drawings: "no drawings", no_activities: "no activities" })[gap]).join(", ")}`);
  for (const note of gaps.notes) lines.push(note);
  return lines.join("\n");
};

const normalizeActions = (actions) =>
  (Array.isArray(actions) ? actions : [])
    .map((action) => {
      if (action?.type === "create_task" && trimOrNull(action.title)) return { type: "create_task", title: clip(action.title, 200), description: clip(action.description, 2000) };
      if (action?.type === "create_rfi" && trimOrNull(action.subject)) return { type: "create_rfi", subject: clip(action.subject, 200), question: clip(action.question, 4000) };
      return null;
    })
    .filter(Boolean)
    .slice(0, 4);

const explainScopeGaps = async ({ orgId, projectId, user, access = BOQ_READER, viewer = null, projectAccess = null, transport = null }) => {
  const gaps = await scopeGaps({ orgId, projectId, access, viewer, projectAccess });
  const fallback = { headline: `${gaps.summary.withGaps} of ${gaps.summary.sections} sections have a coverage gap`, narrative: deterministicGapNarrative(gaps), actions: [] };
  const provider = aiProvider.describe();
  if (!transport && !provider.enabled) return { degraded: true, reason: "No AI provider is configured — showing the computed review.", gaps, review: fallback, message: null };
  const digest = { summary: gaps.summary, notes: gaps.notes, uncoveredDisciplines: gaps.uncoveredDisciplines, sectionsWithGaps: gaps.sections.filter((section) => section.gaps.length).slice(0, 40).map((section) => ({ code: section.code, title: section.title, division: section.divisionLabel, gaps: section.gaps, keywords: section.keywords })), ...(gaps.boqWithheld ? { boqCoverage: "not part of this check — do not comment on BOQ coverage" } : { uncoveredBoq: gaps.uncoveredBoq.slice(0, 40).map((item) => `${item.code || ""} ${item.description}`.trim()) }) };
  let completion;
  try {
    completion = await aiProvider.complete({ system: GAP_PROMPT, messages: [{ role: "user", content: JSON.stringify(digest) }], maxTokens: 1200, temperature: 0.2, transport });
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { degraded: true, reason: error.message, gaps, review: fallback, message: null };
  }
  const parsed = aiProvider.parseJsonAnswer(completion.text) || {};
  const review = { headline: clip(parsed.headline, 300) || fallback.headline, narrative: clip(parsed.narrative, 6000) || fallback.narrative, actions: normalizeActions(parsed.actions) };
  const stored = await assistant.storeRun({ orgId, user, projectId, kind: "scope_gap", recordType: "project", recordId: projectId, title: "Scope coverage review", prompt: JSON.stringify(digest).slice(0, 8000), answer: review.narrative, usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null, builtWithoutBoq: Boolean(gaps.boqWithheld) }).catch(() => null);
  return { degraded: false, gaps, review, message: stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null };
};

// ─── Conflicts ────────────────────────────────────────────────────────────

const CONFLICT_PROMPT = `You compare one specification section with the text found on the related drawings (general notes, material callouts, schedules read from the sheets' text layers) and with RFIs on the subject. Find CONFLICTS — where a drawing states something different from the specification (material, grade, thickness, dimension, standard, tolerance, finish, product) — and GAPS — requirements the specification sets that no drawing shows, or drawing callouts the specification does not cover. Quote both sides briefly. Only use the text given; if the drawing text is too thin to judge, say so. Rate severity: high = affects structure, safety, cost or a critical dimension; medium = material / finish / product mismatch; low = wording or reference.
Return ONLY a JSON object: {"summary": "2–3 sentences", "conflicts": [{"topic": "...", "specSays": "...", "drawingSays": "...", "sheetNumber": "A-101", "severity": "low|medium|high", "recommendation": "..."}], "gaps": [{"topic": "...", "detail": "...", "where": "specification|drawings"}], "confidence": "low|medium|high"}`;

const sectionWindow = (text) => {
  const limit = SPEC_CHARS();
  if (text.length <= limit) return text;
  // Keep the opening (summary / references) and as much of PRODUCTS + EXECUTION as fits.
  const partTwo = text.search(/\bPART\s*2\b/i);
  if (partTwo > 3000) return `${text.slice(0, 3000)}\n[…]\n${text.slice(partTwo, partTwo + limit - 3000)}`;
  return text.slice(0, limit);
};

const findConflicts = async ({ orgId, projectId, sectionId, user, payload = {}, access = BOQ_READER, viewer = null, projectAccess = null, transport = null }) => {
  const section = await getSection({ orgId, projectId, sectionId, maxChars: 200000, access, viewer, projectAccess });
  const requested = Array.isArray(payload.sheetIds) && payload.sheetIds.length ? new Set(payload.sheetIds) : null;
  const candidates = requested ? section.related.sheets.filter((sheet) => requested.has(sheet.id)) : section.related.sheets;
  const sheets = candidates.filter((sheet) => sheet.currentRevisionId).slice(0, SPEC_SHEETS());
  const provider = aiProvider.describe();
  if (!transport && !provider.enabled) return { degraded: true, reason: "No AI provider is configured on this server.", section: { id: section.id, code: section.code, title: section.title }, sheetsChecked: [], related: section.related, result: null, message: null };
  const revisions = sheets.length ? await prisma.sheetRevision.findMany({ where: { id: { in: sheets.map((sheet) => sheet.currentRevisionId) } }, select: { id: true, sheetId: true, documentId: true, pageNumber: true, revision: true } }) : [];
  const { pageTextFor } = require("./drawing-assistant.service");
  const cache = new Map();
  const sheetBlocks = [];
  for (const sheet of sheets) {
    const revision = revisions.find((row) => row.id === sheet.currentRevisionId);
    const text = revision ? await pageTextFor({ documentId: revision.documentId, pageNumber: revision.pageNumber, cache }) : "";
    sheetBlocks.push({ id: sheet.id, number: sheet.number, title: sheet.title, revision: revision?.revision || null, basis: sheet.basis, chars: text.length, text: text.replace(/\s+/g, " ").slice(0, SHEET_CHARS) });
  }
  const rfiBlocks = section.related.rfis.slice(0, 6);
  const prompt = [
    `SPECIFICATION SECTION ${section.code} — ${section.title}${section.divisionLabel ? ` (Division ${section.division} ${section.divisionLabel})` : ""}`,
    sectionWindow(section.text),
    "",
    sheetBlocks.length ? "DRAWINGS (text layer of the current revision):" : "DRAWINGS: none related — report only specification-side observations.",
    ...sheetBlocks.map((sheet) => `--- ${sheet.number} ${sheet.title}${sheet.revision ? ` rev ${sheet.revision}` : ""} ---\n${sheet.text || "(no text layer on this sheet)"}`),
    rfiBlocks.length ? "\nRFIs ON THE SUBJECT:" : "",
    ...rfiBlocks.map((rfi) => `${rfi.ref} (${rfi.status}) ${rfi.subject}`),
  ].join("\n");
  let completion;
  try {
    completion = await aiProvider.complete({ system: CONFLICT_PROMPT, messages: [{ role: "user", content: prompt }], maxTokens: 1800, temperature: 0.1, transport });
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { degraded: true, reason: error.message, section: { id: section.id, code: section.code, title: section.title }, sheetsChecked: sheetBlocks.map(({ text, ...rest }) => rest), related: section.related, result: null, message: null };
  }
  const parsed = aiProvider.parseJsonAnswer(completion.text) || {};
  const knownNumbers = new Set(sheetBlocks.map((sheet) => sheet.number.toUpperCase()));
  const result = {
    summary: clip(parsed.summary, 1500) || "No summary was returned.",
    conflicts: (Array.isArray(parsed.conflicts) ? parsed.conflicts : []).map((item) => ({ topic: clip(item?.topic, 150), specSays: clip(item?.specSays, 600), drawingSays: clip(item?.drawingSays, 600), sheetNumber: trimOrNull(item?.sheetNumber) && knownNumbers.has(String(item.sheetNumber).toUpperCase()) ? String(item.sheetNumber).toUpperCase() : clip(item?.sheetNumber, 40), severity: pick(item?.severity, ["low", "medium", "high"], "medium"), recommendation: clip(item?.recommendation, 600) })).filter((item) => item.topic && (item.specSays || item.drawingSays)).slice(0, 20),
    gaps: (Array.isArray(parsed.gaps) ? parsed.gaps : []).map((item) => ({ topic: clip(item?.topic, 150), detail: clip(item?.detail, 600), where: pick(item?.where, ["specification", "drawings"], "drawings") })).filter((item) => item.topic).slice(0, 20),
    confidence: pick(parsed.confidence, ["low", "medium", "high"], "medium"),
  };
  const stored = await assistant.storeRun({ orgId, user, projectId, kind: "spec_conflict", recordType: "spec_section", recordId: section.id, title: `Conflicts: ${section.code} ${section.title}`, prompt: prompt.slice(0, 12000), answer: JSON.stringify(result), usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null }).catch(() => null);
  return { degraded: false, section: { id: section.id, code: section.code, title: section.title }, sheetsChecked: sheetBlocks.map(({ text, ...rest }) => rest), related: section.related, result, message: stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null };
};

/** Raises a draft RFI from a conflict or gap, tagged with the section. */
const raiseRfi = async ({ orgId, projectId, sectionId, user, projectAccess = null, payload = {}, viewer = null }) => {
  const section = await findReadableSection({ orgId, projectId, sectionId, viewer });
  const subject = clip(payload.subject, 200);
  if (!subject) throw new HttpError(400, "SPEC_RFI_SUBJECT", "The RFI needs a subject");
  const rfiService = require("./rfi.service");
  const disciplines = section.division ? DIVISION_DISCIPLINES[section.division] || [] : [];
  const created = await rfiService.createRfi({ orgId, projectId, payload: { subject, question: clip(payload.question, 4000), specSection: section.code, discipline: clip(payload.discipline, 80) || disciplines[0] || null, priority: pick(payload.priority, ["low", "normal", "high", "urgent"], "normal"), status: "draft" }, userId: user?.id || null, userRole: user?.role || null, projectAccess });
  await auditService.recordEvent({ orgId, projectId, entityType: "rfi", entityId: created.id, action: auditService.ACTIONS.CREATED, actorId: user?.id || null, summary: { ref: created.ref, source: "specification", specSection: section.code } }).catch(() => null);
  return { record: { id: created.id, ref: created.ref, status: created.status }, url: recordWorkspacePath({ projectId, recordType: "rfi", recordId: created.id }) };
};

const status = () => {
  const provider = aiProvider.describe();
  return { enabled: Boolean(provider.enabled), provider: provider.provider, model: provider.model, sectionChars: SPEC_CHARS(), sheetLimit: SPEC_SHEETS() };
};

module.exports = { DIVISION_LABELS, DIVISION_KEYWORDS, DIVISION_DISCIPLINES, tokens, detectHeadings, parseSections, pagesFor, relateSection, indexDocument, listDocuments, scanProject, listSections, getSection, scopeGaps, explainScopeGaps, findConflicts, raiseRfi, status };
