const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");

/**
 * Permission-filtered retrieval for the AI features (OCTA-AI-ASSIST-028).
 *
 * Every candidate comes through the same gates the UI uses: the global
 * search (projects the caller can open, modules readable by role / template
 * / party, register-level party visibility) and the document content search
 * (full text + embeddings when configured). Record bodies are then loaded
 * for the best hits so the model can quote them. Nothing is retrieved that
 * the caller could not open by hand.
 */

const DEFAULT_LIMIT = 12;
const BODY_CHARS = 900;
const SNIPPET_CHARS = 280;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const clip = (text, max) => {
  const value = trimOrNull(text);
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const stripHtml = (text) => String(text || "").replace(/<[^>]+>/g, "");

/** How to turn a record hit into quotable text. Keys are search result types. */
const BODY_LOADERS = Object.freeze({
  rfi: { model: "rfi", select: { subject: true, question: true, response: true, status: true, discipline: true, specSection: true }, text: (row) => [row.question ? `Question: ${row.question}` : null, row.response ? `Answer: ${row.response}` : null, row.specSection ? `Spec section: ${row.specSection}` : null, row.discipline ? `Discipline: ${row.discipline}` : null].filter(Boolean).join("\n") },
  submittal: { model: "submittal", select: { title: true, remarks: true, status: true, responseCodeLabel: true, specRef: true }, text: (row) => [row.remarks ? `Remarks: ${row.remarks}` : null, row.responseCodeLabel ? `Response: ${row.responseCodeLabel}` : null, row.specRef ? `Spec: ${row.specRef}` : null, `Status: ${row.status}`].filter(Boolean).join("\n") },
  correspondence: { model: "correspondence", select: { subject: true, body: true, direction: true, type: true }, text: (row) => [row.body, `${row.direction} ${row.type}`].filter(Boolean).join("\n") },
  change_order: { model: "changeOrder", select: { description: true, value: true, status: true, category: true }, text: (row) => [row.description, row.value !== undefined && row.value !== null ? `Value: ${row.value}` : null, row.category ? `Category: ${row.category}` : null].filter(Boolean).join("\n") },
  ncr: { model: "ncrRecord", select: { description: true, status: true, dueDate: true }, text: (row) => [row.description, row.dueDate ? `Due: ${toIso(row.dueDate)?.slice(0, 10)}` : null].filter(Boolean).join("\n") },
  punch_item: { model: "punchItem", select: { title: true, description: true, status: true, trade: true }, text: (row) => [row.description, row.trade ? `Trade: ${row.trade}` : null].filter(Boolean).join("\n") },
  task: { model: "task", select: { title: true, description: true, status: true, dueDate: true }, text: (row) => [row.description, row.dueDate ? `Due: ${toIso(row.dueDate)?.slice(0, 10)}` : null].filter(Boolean).join("\n") },
  meeting: { model: "meeting", select: { title: true, minutesText: true, status: true }, text: (row) => [row.minutesText].filter(Boolean).join("\n") },
  risk: { model: "risk", select: { description: true, mitigation: true, status: true }, text: (row) => [row.description, row.mitigation ? `Mitigation: ${row.mitigation}` : null].filter(Boolean).join("\n") },
  activity: { model: "activity", select: { name: true, startDate: true, endDate: true, physComplete: true, isCritical: true, totalFloat: true }, text: (row) => [`Start ${toIso(row.startDate)?.slice(0, 10) || "—"}, finish ${toIso(row.endDate)?.slice(0, 10) || "—"}`, `${Number(row.physComplete || 0)}% complete`, row.isCritical ? "Critical path" : `Float ${row.totalFloat ?? "—"}`].join(" · ") },
  commitment: { model: "commitment", select: { title: true, description: true, status: true, type: true }, text: (row) => [row.description, `${row.type} · ${row.status}`].filter(Boolean).join("\n") },
});

const loadBody = async (item) => {
  const loader = BODY_LOADERS[item.type];
  if (!loader || !prisma[loader.model]?.findFirst) return null;
  try {
    const row = await prisma[loader.model].findFirst({ where: { id: item.id }, select: loader.select });
    return row ? clip(loader.text(row), BODY_CHARS) : null;
  } catch {
    return null;
  }
};

/** The read decision `requirePermission` would make for this caller on one project. */
const readCheckFor = async ({ user, projectId, projectAccess = null }) => {
  const { can, canParty, normalizeRoleId } = require("../config/permissions");
  let access = projectAccess;
  if (!access) {
    try {
      const { assertProjectAccess } = require("./project-authorization.service");
      access = await assertProjectAccess({ orgId: user.orgId, projectId, userId: user.id, role: user.role, isCompanyAdmin: user.isCompanyAdmin });
    } catch {
      access = null;
    }
  }
  let template = null;
  try {
    const { resolveTemplateContext } = require("./permission-template.service");
    const context = await resolveTemplateContext({ projectId, userId: user.id, partyAccess: access?.partyAccess || [] });
    template = context?.compiled || null;
  } catch {
    template = null;
  }
  return (moduleName) => {
    if (template) {
      const { templateAllows } = require("./permission-template.service");
      const decided = templateAllows(template, { module: moduleName, action: "read", transition: null });
      if (decided !== null && decided !== undefined) return Boolean(decided);
    }
    const role = normalizeRoleId(access?.role || user.role);
    if (role && can({ role, module: moduleName, action: "read" })) return true;
    return (access?.partyAccess || []).some((party) => canParty({ partyRole: party.role, module: moduleName, action: "read" }));
  };
};

const projectSummaries = async ({ orgId, projectIds }) => {
  if (!projectIds.length || !prisma.project?.findMany) return new Map();
  const rows = await prisma.project.findMany({ where: { id: { in: projectIds }, orgId }, select: { id: true, name: true, status: true, currency: true, contractValue: true, startDate: true, endDate: true, clientName: true, location: true, type: true } });
  return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name, status: row.status, currency: row.currency, contractValue: row.contractValue === null || row.contractValue === undefined ? null : Number(row.contractValue), startDate: toIso(row.startDate)?.slice(0, 10) || null, endDate: toIso(row.endDate)?.slice(0, 10) || null, clientName: row.clientName || null, location: row.location || null, type: row.type || null }]));
};

/**
 * Sources for a question. `projectId` narrows to one project (and enables
 * semantic document hits); without it, every project the caller can open is
 * searched. `types` limits the record types (search type keys); `exclude`
 * drops sources by `record:<id>` / `document:<id>` (e.g. the record being
 * worked on). Returns numbered sources ready for a prompt.
 */
const retrieve = async ({ orgId, user, projectId = null, query, limit = DEFAULT_LIMIT, projectAccess = null, types = null, exclude = [] }) => {
  const text = trimOrNull(query);
  if (!text) throw new HttpError(400, "ASSISTANT_QUESTION_REQUIRED", "Ask a question");
  const searchService = require("./search.service");
  const search = await searchService.globalSearch({ orgId, userId: user.id, role: user.role, isCompanyAdmin: Boolean(user.isCompanyAdmin), query: { q: text, projectId: projectId || undefined, limit: Math.max(20, limit * 2), ...(Array.isArray(types) && types.length ? { types } : {}) } });
  const excluded = new Set((exclude || []).filter(Boolean));
  const candidates = [];
  for (const item of search.items || []) {
    const isContent = String(item.id).startsWith("content:");
    candidates.push({
      id: isContent ? String(item.id).slice("content:".length) : item.id,
      type: isContent ? "document" : item.type,
      typeLabel: item.typeLabel || item.type,
      module: item.module || null,
      title: item.title,
      ref: item.identifier || null,
      status: item.status || null,
      projectId: item.projectId,
      projectName: item.projectName || null,
      url: item.url || null,
      date: item.date || null,
      snippet: clip(stripHtml(item.metadata?.headline || item.metadata?.snippet || item.subtitle), SNIPPET_CHARS),
      text: null,
      score: Number(item.metadata?.score ?? item.metadata?.rank ?? 0) || 0,
      kind: isContent ? "document" : "record",
    });
  }
  // Semantic passes inside one project (embeddings when configured, full text otherwise).
  if (projectId && (!Array.isArray(types) || !types.length || types.includes("document"))) {
    try {
      const documentText = require("./document-text.service");
      const embeddings = require("./embedding.service");
      const viewer = { id: user.id, role: user.role, isCompanyAdmin: Boolean(user.isCompanyAdmin), projectAccess: projectAccess || null, canRead: await readCheckFor({ user: { ...user, orgId }, projectId, projectAccess }) };
      const docs = await documentText.searchDocuments({ orgId, projectId, q: text, limit: 6, viewer, semantic: embeddings.isEnabled() });
      for (const hit of docs.items || []) {
        const existing = candidates.find((candidate) => candidate.kind === "document" && candidate.id === (hit.documentId || hit.id));
        const snippet = clip(stripHtml(hit.matchedChunk || hit.headline || hit.snippet), BODY_CHARS);
        if (existing) {
          existing.text = existing.text || snippet;
          existing.score = Math.max(existing.score, Number(hit.score) || 0);
        } else {
          candidates.push({ id: hit.documentId || hit.id, type: "document", typeLabel: "Document", module: "document_control", title: hit.title || hit.originalName || hit.fileName || "Document", ref: hit.documentNumber || null, status: null, projectId, projectName: null, url: hit.url || hit.path || null, date: hit.uploadedAt || null, snippet: clip(stripHtml(hit.headline || hit.matchedChunk), SNIPPET_CHARS), text: snippet, score: Number(hit.score) || 0, kind: "document" });
        }
      }
    } catch (error) {
      console.warn("[retrieval] document search skipped", error?.message || error);
    }
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.id}`;
    if (excluded.has(key)) continue;
    if (!unique.has(key) || unique.get(key).score < candidate.score) unique.set(key, candidate);
  }
  const ranked = [...unique.values()].sort((a, b) => b.score - a.score || String(b.date || "").localeCompare(String(a.date || ""))).slice(0, limit);
  for (const source of ranked) if (source.kind === "record" && !source.text) source.text = await loadBody(source);
  const projects = await projectSummaries({ orgId, projectIds: [...new Set([...(projectId ? [projectId] : []), ...ranked.map((source) => source.projectId).filter(Boolean)])] });
  const sources = ranked.map((source, index) => ({ n: index + 1, ...source, projectName: source.projectName || projects.get(source.projectId)?.name || null }));
  return { query: text, sources, projects: [...projects.values()], searchedProjects: search.meta?.authorizedProjectCount ?? null, mode: search.meta?.mode || null };
};

/** Compact prompt block: `[n] Type Ref — Title (Project, status)` followed by the quotable text. */
const formatSources = (sources) =>
  sources
    .map((source) => {
      const head = `[${source.n}] ${source.typeLabel}${source.ref ? ` ${source.ref}` : ""} — ${source.title}${source.projectName ? ` (${source.projectName}${source.status ? `, ${source.status}` : ""})` : source.status ? ` (${source.status})` : ""}`;
      const body = source.text || source.snippet;
      return body ? `${head}\n${body}` : head;
    })
    .join("\n\n");

module.exports = { BODY_LOADERS, retrieve, formatSources };
