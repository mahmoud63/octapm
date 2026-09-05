const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const aiProvider = require("./ai-provider.service");
const assistant = require("./assistant.service");

/**
 * Contract intelligence (OCTA-AI-CONTRACT-032).
 *
 *  - Contract profile: the form (FIDIC, NEC, JCT…), the notice / particulars /
 *    response periods, the contract documents and the clauses extracted from
 *    them. Extraction proposes; a person confirms.
 *  - Notice monitor: every event that may carry an entitlement (weather
 *    delays, change orders, RFIs with a schedule impact, EOT claims, incoming
 *    contractual notices) against the period that applies, with the outgoing
 *    notice that served it (linked, or matched by reference) — served, late,
 *    due or missed.
 *  - Notice drafting: a letter for one event from its facts and the clauses,
 *    created as a draft outgoing correspondence linked to the event.
 *  - EOT entitlement assessment: a claim against the clauses, its notices,
 *    the critical-path impact and the evidence on record, with the gaps.
 * Every model call degrades to a deterministic result.
 */

const DAY = 86_400_000;
const FORMS = Object.freeze({
  fidic_1999: { label: "FIDIC 1999 (Red / Yellow Book)", delayNoticeDays: 28, claimParticularsDays: 42, variationNoticeDays: 28, responseDays: 42, references: { notice: "Sub-Clause 20.1", eot: "Sub-Clause 8.4", variation: "Sub-Clause 13.1", response: "Sub-Clause 20.1" } },
  fidic_2017: { label: "FIDIC 2017", delayNoticeDays: 28, claimParticularsDays: 84, variationNoticeDays: 28, responseDays: 42, references: { notice: "Sub-Clause 20.2.1", eot: "Sub-Clause 8.5", variation: "Sub-Clause 13.1", response: "Sub-Clause 20.2.5" } },
  nec4: { label: "NEC4 ECC", delayNoticeDays: 56, claimParticularsDays: 56, variationNoticeDays: 56, responseDays: 14, references: { notice: "Clause 61.3", eot: "Clause 60.1", variation: "Clause 61.1", response: "Clause 62.3" } },
  jct_2016: { label: "JCT SBC 2016", delayNoticeDays: 0, claimParticularsDays: 0, variationNoticeDays: 0, responseDays: 84, references: { notice: "Clause 2.27", eot: "Clause 2.28", variation: "Clause 3.14", response: "Clause 2.28.2" } },
  aia_a201: { label: "AIA A201-2017", delayNoticeDays: 21, claimParticularsDays: 21, variationNoticeDays: 21, responseDays: 10, references: { notice: "§15.1.3", eot: "§8.3", variation: "§7.3", response: "§15.2.2" } },
  custom: { label: "Custom", delayNoticeDays: 28, claimParticularsDays: 42, variationNoticeDays: 28, responseDays: 42, references: {} },
});
const CLAUSE_CATEGORIES = Object.freeze(["notice", "eot", "variation", "payment", "ld", "retention", "defects", "suspension", "force_majeure", "dispute", "other"]);
const CLAUSE_STATUSES = Object.freeze(["draft", "confirmed", "rejected"]);
const EVENT_KINDS = Object.freeze({ delay: "delay", variation: "variation", incoming: "incoming_notice" });
const NOTICE_STATUSES = Object.freeze(["missed", "due", "late", "served", "not_required"]);
const WINDOW_CHARS = 14_000;
const WINDOW_OVERLAP = 600;
const maxWindows = () => Math.max(1, Math.min(20, Number(process.env.AI_CONTRACT_WINDOWS || 8)));

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
const dateOnly = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const intOrNull = (value, { min = 0, max = 3650 } = {}) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : null;
};
const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY);
const daysBetween = (from, to) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const safeMany = async (model, args) => {
  try {
    return prisma[model]?.findMany ? await prisma[model].findMany(args) : [];
  } catch {
    return [];
  }
};

// ─── Profile ──────────────────────────────────────────────────────────────

const normalizeClause = (raw, index = 0) => {
  if (!raw || typeof raw !== "object") return null;
  const category = CLAUSE_CATEGORIES.includes(raw.category) ? raw.category : "other";
  const title = clip(raw.title, 200);
  const summary = clip(raw.summary, 1500);
  if (!title && !summary) return null;
  return {
    id: clip(raw.id, 80) || `cl-${index + 1}-${Math.random().toString(36).slice(2, 8)}`,
    category,
    reference: clip(raw.reference, 80),
    title: title || summary.slice(0, 120),
    summary,
    days: intOrNull(raw.days),
    excerpt: clip(raw.excerpt, 2000),
    documentId: clip(raw.documentId, 80),
    status: CLAUSE_STATUSES.includes(raw.status) ? raw.status : "draft",
    source: raw.source === "heuristic" ? "heuristic" : raw.source === "manual" ? "manual" : "model",
  };
};

const serializeProfile = (row, projectId) => {
  const form = row && FORMS[row.form] ? row.form : "custom";
  const preset = FORMS[form];
  return {
    projectId,
    exists: Boolean(row),
    form,
    formLabel: preset.label,
    delayNoticeDays: row?.delayNoticeDays ?? preset.delayNoticeDays,
    claimParticularsDays: row?.claimParticularsDays ?? preset.claimParticularsDays,
    variationNoticeDays: row?.variationNoticeDays ?? preset.variationNoticeDays,
    responseDays: row?.responseDays ?? preset.responseDays,
    paymentDays: row?.paymentDays ?? null,
    defectsLiabilityDays: row?.defectsLiabilityDays ?? null,
    ldCapPct: row?.ldCapPct ?? null,
    documentIds: Array.isArray(row?.documentIds) ? row.documentIds : [],
    clauses: (Array.isArray(row?.clausesJson) ? row.clausesJson : []).map(normalizeClause).filter(Boolean),
    references: preset.references,
    extractedAt: toIso(row?.extractedAt),
    extractedModel: row?.extractedModel || null,
    confirmedBy: row?.confirmedBy || null,
    confirmedAt: toIso(row?.confirmedAt),
    updatedAt: toIso(row?.updatedAt),
  };
};

const presets = () => Object.entries(FORMS).map(([key, preset]) => ({ key, label: preset.label, delayNoticeDays: preset.delayNoticeDays, claimParticularsDays: preset.claimParticularsDays, variationNoticeDays: preset.variationNoticeDays, responseDays: preset.responseDays, references: preset.references }));

const loadProfileRow = ({ projectId }) => (prisma.contractProfile?.findUnique ? prisma.contractProfile.findUnique({ where: { projectId } }) : Promise.resolve(null));

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true, clientName: true, consultantName: true, contractorName: true, contractType: true, contractNumber: true, completionDate: true, endDate: true, revisedCompletionDate: true, ldRatePerDay: true, weatherAllowanceDays: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const getProfile = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });
  return { ...serializeProfile(await loadProfileRow({ projectId }), projectId), presets: presets() };
};

const updateProfile = async ({ orgId, projectId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadProfileRow({ projectId });
  const form = FORMS[payload.form] ? payload.form : existing?.form || "custom";
  const preset = FORMS[form];
  const pick = (key) => (payload[key] !== undefined ? intOrNull(payload[key]) ?? preset[key] : payload.form && payload.form !== existing?.form ? preset[key] : existing?.[key] ?? preset[key]);
  const data = {
    orgId,
    projectId,
    form,
    delayNoticeDays: pick("delayNoticeDays"),
    claimParticularsDays: pick("claimParticularsDays"),
    variationNoticeDays: pick("variationNoticeDays"),
    responseDays: pick("responseDays"),
    paymentDays: payload.paymentDays !== undefined ? intOrNull(payload.paymentDays) : existing?.paymentDays ?? null,
    defectsLiabilityDays: payload.defectsLiabilityDays !== undefined ? intOrNull(payload.defectsLiabilityDays) : existing?.defectsLiabilityDays ?? null,
    ldCapPct: payload.ldCapPct !== undefined ? (payload.ldCapPct === null || payload.ldCapPct === "" ? null : Math.min(100, Math.max(0, Number(payload.ldCapPct) || 0))) : existing?.ldCapPct ?? null,
    documentIds: Array.isArray(payload.documentIds) ? [...new Set(payload.documentIds.map((id) => trimOrNull(id)).filter(Boolean))].slice(0, 20) : Array.isArray(existing?.documentIds) ? existing.documentIds : [],
    clausesJson: Array.isArray(payload.clauses) ? payload.clauses.map(normalizeClause).filter(Boolean).slice(0, 200) : Array.isArray(existing?.clausesJson) ? existing.clausesJson : [],
  };
  if (payload.confirm) {
    data.confirmedBy = actor?.id || null;
    data.confirmedAt = new Date();
    data.clausesJson = data.clausesJson.map((clause) => (clause.status === "draft" ? { ...clause, status: "confirmed" } : clause));
  }
  const row = await prisma.contractProfile.upsert({ where: { projectId }, create: data, update: data });
  return { ...serializeProfile(row, projectId), presets: presets() };
};

// ─── Clause extraction ────────────────────────────────────────────────────

const EXTRACT_PROMPT = `You read construction contract text and list the clauses that govern time, money and notices. Use ONLY the text given; quote the reference exactly as written (e.g. "Sub-Clause 20.1", "Clause 61.3", "Article 8.3"); never invent numbers.
Categories: notice (notice of a claim / delay event and its period), eot (extension of time grounds and assessment), variation (instructions, change procedure, notice of a variation), payment (application, certification and payment periods), ld (liquidated damages rate and cap), retention, defects (defects liability / notification period), suspension, force_majeure, dispute, other.
Return ONLY a JSON object: {"clauses": [{"category": "notice", "reference": "…", "title": "short name", "summary": "what it requires, in one or two sentences", "days": 28, "excerpt": "the key sentence, verbatim"}]}
"days" is the period in days when the clause states one (convert weeks to days), else null. Skip boilerplate; at most 12 clauses per text.`;

const windowsOf = (text, size = WINDOW_CHARS, overlap = WINDOW_OVERLAP) => {
  const out = [];
  let start = 0;
  while (start < text.length) {
    out.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
    start += size - overlap;
  }
  return out;
};

const REFERENCE_RE = /((?:sub-)?clause|article|section|§)\s*[\d.]*\d[a-z]?/i;

/**
 * Sentences that mention a notice and a period — the fallback without a
 * model. A clause heading ("Sub-Clause 20.1 Contractor's Claims.") is often
 * split from the sentence that states the period, so the last reference seen
 * carries forward.
 */
const heuristicClauses = (text, documentId) => {
  const found = [];
  const sentences = String(text || "").replace(/\s+/g, " ").split(/(?<=[.;])\s+/);
  let lastReference = null;
  for (const sentence of sentences) {
    const referenceMatch = REFERENCE_RE.exec(sentence);
    if (referenceMatch) lastReference = referenceMatch[0].replace(/\.$/, "");
    if (sentence.length < 30 || sentence.length > 700) continue;
    const period = /(\d{1,3})\s*(days?|weeks?)/i.exec(sentence);
    if (!period) continue;
    const lower = sentence.toLowerCase();
    const category = /notice|notify|give notice/.test(lower) ? "notice" : /extension of time|extend the time for completion|compensation event/.test(lower) ? "eot" : /variation|change order|instruct/.test(lower) ? "variation" : /liquidated damages|delay damages/.test(lower) ? "ld" : /payment|certif/.test(lower) ? "payment" : /defect/.test(lower) ? "defects" : /retention/.test(lower) ? "retention" : null;
    if (!category) continue;
    const days = Number(period[1]) * (/week/i.test(period[2]) ? 7 : 1);
    const reference = referenceMatch ? referenceMatch[0].replace(/\.$/, "") : lastReference;
    found.push({ category, reference, title: `${category === "eot" ? "Extension of time" : category === "ld" ? "Liquidated damages" : category[0].toUpperCase() + category.slice(1)} — ${days} days`, summary: sentence.trim(), days, excerpt: sentence.trim(), documentId, source: "heuristic" });
    if (found.length >= 20) break;
  }
  return found;
};

const mergeClauses = (lists) => {
  const map = new Map();
  for (const clause of lists.flat()) {
    if (!clause) continue;
    const key = `${clause.category}:${(clause.reference || clause.title || "").toLowerCase().replace(/\s+/g, " ")}`;
    const existing = map.get(key);
    if (!existing || (clause.summary || "").length > (existing.summary || "").length) map.set(key, clause);
  }
  return [...map.values()];
};

const suggestedPeriods = (clauses) => {
  const first = (category) => clauses.find((clause) => clause.category === category && clause.days !== null && clause.days !== undefined);
  const notice = first("notice");
  const variation = first("variation");
  const payment = first("payment");
  const defects = first("defects");
  return { delayNoticeDays: notice?.days ?? null, variationNoticeDays: variation?.days ?? notice?.days ?? null, paymentDays: payment?.days ?? null, defectsLiabilityDays: defects?.days ?? null };
};

/**
 * Reads the contract documents (text already extracted by document-text)
 * window by window and proposes clauses; stored on the profile as drafts.
 */
const extractClauses = async ({ orgId, projectId, user, payload = {}, viewer = null, transport = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await loadProfileRow({ projectId });
  const documentIds = [...new Set([...(Array.isArray(payload.documentIds) ? payload.documentIds : []), ...(Array.isArray(existing?.documentIds) ? existing.documentIds : [])].map((id) => trimOrNull(id)).filter(Boolean))].slice(0, 10);
  if (!documentIds.length) throw new HttpError(400, "CONTRACT_DOCUMENTS_REQUIRED", "Add the contract documents to the profile first");
  const documentText = require("./document-text.service");
  const documents = [];
  for (const documentId of documentIds) {
    try {
      const result = await documentText.getDocumentText({ orgId, projectId, documentId, viewer, maxChars: 600_000 });
      documents.push({ id: documentId, title: result.document?.title || documentId, status: result.text?.status || null, text: result.text?.text || "", chars: result.text?.totalChars || 0 });
    } catch (error) {
      documents.push({ id: documentId, title: documentId, status: "unavailable", text: "", chars: 0, error: error?.message || "unavailable" });
    }
  }
  const readable = documents.filter((document) => document.text.length > 200);
  if (!readable.length) throw new HttpError(409, "CONTRACT_TEXT_UNAVAILABLE", "None of the contract documents has extracted text yet (upload a text PDF or Word file and wait for extraction)");

  const provider = aiProvider.describe();
  const heuristics = readable.flatMap((document) => heuristicClauses(document.text, document.id));
  let clauses = [];
  let degraded = false;
  let reason = null;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let model = null;
  let windowsRead = 0;
  if (provider.enabled || transport) {
    const budget = maxWindows();
    const perDocument = Math.max(1, Math.floor(budget / readable.length));
    const collected = [];
    try {
      for (const document of readable) {
        for (const window of windowsOf(document.text).slice(0, perDocument)) {
          const completion = await aiProvider.complete({ system: EXTRACT_PROMPT, messages: [{ role: "user", content: `Document: ${document.title}\n\n${window}` }], maxTokens: 1800, temperature: 0, transport });
          windowsRead += 1;
          usage = { inputTokens: (usage.inputTokens || 0) + (completion.usage?.inputTokens || 0), outputTokens: (usage.outputTokens || 0) + (completion.usage?.outputTokens || 0) };
          model = completion.model || model;
          const parsed = aiProvider.parseJsonAnswer(completion.text);
          for (const clause of Array.isArray(parsed?.clauses) ? parsed.clauses : []) collected.push({ ...clause, documentId: document.id, source: "model" });
        }
      }
      clauses = mergeClauses([collected]);
    } catch (error) {
      if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
      degraded = true;
      reason = `${error.message} Clauses below come from a text scan only.`;
    }
  } else {
    degraded = true;
    reason = "AI extraction is not configured on this server; clauses below come from a text scan of the documents.";
  }
  if (!clauses.length) clauses = mergeClauses([heuristics]);
  const normalized = clauses.map((clause, index) => normalizeClause({ ...clause, status: "draft" }, index)).filter(Boolean).slice(0, 60);
  const kept = (Array.isArray(existing?.clausesJson) ? existing.clausesJson : []).map(normalizeClause).filter((clause) => clause && clause.status !== "draft");
  const merged = [...kept, ...normalized.filter((clause) => !kept.some((keptClause) => keptClause.category === clause.category && (keptClause.reference || keptClause.title) === (clause.reference || clause.title)))];
  const row = await prisma.contractProfile.upsert({
    where: { projectId },
    create: { orgId, projectId, form: existing?.form || "custom", documentIds, clausesJson: merged, extractedAt: new Date(), extractedModel: model },
    update: { documentIds, clausesJson: merged, extractedAt: new Date(), extractedModel: model },
  });
  if (!degraded) await assistant.storeRun({ orgId, user, projectId, kind: "contract_extract", recordType: "project", recordId: projectId, title: `Contract clauses ${dateOnly(new Date())}`, prompt: `Documents: ${readable.map((document) => `${document.title} (${document.chars} chars)`).join(", ")}; ${windowsRead} windows read`, answer: JSON.stringify(normalized), usage, provider: provider.provider || "test", model }).catch(() => null);
  return { degraded, reason, profile: { ...serializeProfile(row, projectId), presets: presets() }, proposed: normalized, suggestedPeriods: suggestedPeriods(normalized), documents: documents.map(({ text, ...rest }) => ({ ...rest, readable: text.length > 200 })), windowsRead };
};

// ─── Notice monitor ───────────────────────────────────────────────────────

const RECORD_TYPES = Object.freeze({ WEATHER_DELAY: "weather_delay", CHANGE_ORDER: "change_order", RFI: "rfi", EOT_CLAIM: "eot_claim", CORRESPONDENCE: "correspondence" });

const periodFor = (profile, kind) => (kind === EVENT_KINDS.variation ? profile.variationNoticeDays : kind === EVENT_KINDS.incoming ? profile.responseDays : profile.delayNoticeDays);
const referenceFor = (profile, kind) => (kind === EVENT_KINDS.variation ? profile.references.variation : kind === EVENT_KINDS.incoming ? profile.references.response : profile.references.notice) || null;

const mentions = (notice, ref) => {
  if (!ref) return false;
  const needle = String(ref).toLowerCase();
  return `${notice.subject || ""} ${notice.body || ""}`.toLowerCase().includes(needle);
};

const collectEvents = async ({ projectId }) => {
  const [weather, changeOrders, rfis, claims, incoming] = await Promise.all([
    safeMany("weatherDelay", { where: { projectId }, select: { id: true, date: true, description: true, delayDays: true, contractual: true, activityLinks: { select: { activityId: true } } }, orderBy: { date: "desc" }, take: 200 }),
    safeMany("changeOrder", { where: { projectId, archivedAt: null }, select: { id: true, ref: true, description: true, status: true, value: true, scheduleImpact: true, activityId: true, submittedDate: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    safeMany("rfi", { where: { projectId, scheduleImpactFlag: true, archivedAt: null }, select: { id: true, ref: true, subject: true, status: true, activityId: true, raisedDate: true, createdAt: true, scheduleImpact: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    safeMany("eotClaim", { where: { projectId }, select: { id: true, ref: true, eventName: true, eventType: true, status: true, delayDays: true, createdAt: true, activityLinks: { select: { activityId: true, delayStart: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    safeMany("correspondence", { where: { projectId, direction: "incoming", contractualNotice: true }, select: { id: true, ref: true, subject: true, date: true, responseRequiredBy: true, responseDate: true, status: true, activityId: true }, orderBy: { date: "desc" }, take: 200 }),
  ]);
  const events = [];
  for (const row of weather) events.push({ recordType: RECORD_TYPES.WEATHER_DELAY, recordId: row.id, kind: EVENT_KINDS.delay, ref: dateOnly(row.date), title: row.description, date: row.date, days: Number(row.delayDays) || 0, activityIds: (row.activityLinks || []).map((link) => link.activityId), required: Boolean(row.contractual), status: row.contractual ? "contractual" : "non-contractual", url: `/projects/${projectId}/commercial/weather?recordId=${row.id}` });
  for (const row of changeOrders) events.push({ recordType: RECORD_TYPES.CHANGE_ORDER, recordId: row.id, kind: EVENT_KINDS.variation, ref: row.ref, title: row.description, date: row.submittedDate || row.createdAt, days: Number(row.scheduleImpact) || 0, activityIds: row.activityId ? [row.activityId] : [], required: row.status !== "rejected", status: row.status, url: `/projects/${projectId}/commercial/change-orders?recordId=${row.id}` });
  for (const row of rfis) events.push({ recordType: RECORD_TYPES.RFI, recordId: row.id, kind: EVENT_KINDS.delay, ref: row.ref, title: row.subject, date: row.raisedDate || row.createdAt, days: Number(row.scheduleImpact) || 0, activityIds: row.activityId ? [row.activityId] : [], required: true, status: row.status, url: `/projects/${projectId}/doc-control/rfi?recordId=${row.id}` });
  for (const row of claims) events.push({ recordType: RECORD_TYPES.EOT_CLAIM, recordId: row.id, kind: EVENT_KINDS.delay, ref: row.ref, title: row.eventName, date: (row.activityLinks || []).map((link) => link.delayStart).filter(Boolean).sort()[0] || row.createdAt, days: Number(row.delayDays) || 0, activityIds: (row.activityLinks || []).map((link) => link.activityId), required: true, status: row.status, url: `/projects/${projectId}/commercial/eot?recordId=${row.id}` });
  for (const row of incoming) events.push({ recordType: RECORD_TYPES.CORRESPONDENCE, recordId: row.id, kind: EVENT_KINDS.incoming, ref: row.ref, title: row.subject, date: row.date, days: 0, activityIds: row.activityId ? [row.activityId] : [], required: true, status: row.status, responseRequiredBy: row.responseRequiredBy, responseDate: row.responseDate, url: `/projects/${projectId}/doc-control/correspondence?recordId=${row.id}` });
  return events;
};

/** Every event with the notice period that applies and the notice that served it. */
const noticeMonitor = async ({ orgId, projectId, asOf = new Date() }) => {
  await ensureProject({ orgId, projectId });
  const profile = serializeProfile(await loadProfileRow({ projectId }), projectId);
  const [events, notices, links] = await Promise.all([
    collectEvents({ projectId }),
    safeMany("correspondence", { where: { projectId, direction: "outgoing", contractualNotice: true }, select: { id: true, ref: true, subject: true, body: true, date: true, activityId: true, status: true }, orderBy: { date: "asc" }, take: 500 }),
    safeMany("commercialCorrespondenceLink", { where: { projectId }, select: { recordType: true, recordId: true, correspondenceId: true, relationType: true } }),
  ]);
  const noticeById = new Map(notices.map((notice) => [notice.id, notice]));
  const items = events.map((event) => {
    const days = periodFor(profile, event.kind);
    const deadline = event.kind === EVENT_KINDS.incoming ? event.responseRequiredBy || addDays(event.date, days) : addDays(event.date, days);
    let served = null;
    if (event.kind === EVENT_KINDS.incoming) {
      if (event.responseDate) served = { id: null, ref: null, subject: "Response recorded", date: event.responseDate, via: "response" };
    } else {
      const linked = links.filter((link) => link.recordType === event.recordType && link.recordId === event.recordId).map((link) => noticeById.get(link.correspondenceId)).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
      const matched = linked || notices.filter((notice) => new Date(notice.date) >= new Date(event.date) && (mentions(notice, event.ref) || (event.activityIds.length && notice.activityId && event.activityIds.includes(notice.activityId) && daysBetween(event.date, notice.date) <= days + 30))).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
      if (matched) served = { id: matched.id, ref: matched.ref, subject: matched.subject, date: matched.date, via: linked ? "link" : mentions(matched, event.ref) ? "reference" : "activity" };
    }
    let status;
    if (!event.required) status = "not_required";
    else if (served) status = new Date(served.date) <= new Date(deadline) ? "served" : "late";
    else status = new Date(deadline) >= asOf ? "due" : "missed";
    const daysLeft = daysBetween(asOf, deadline);
    return { ...event, date: toIso(event.date), responseRequiredBy: toIso(event.responseRequiredBy), responseDate: toIso(event.responseDate), periodDays: days, clauseReference: referenceFor(profile, event.kind), deadline: toIso(deadline), daysLeft, served: served ? { ...served, date: toIso(served.date), lateByDays: Math.max(0, daysBetween(deadline, served.date)) } : null, status };
  });
  const order = { missed: 0, due: 1, late: 2, served: 3, not_required: 4 };
  items.sort((a, b) => order[a.status] - order[b.status] || (a.status === "due" ? a.daysLeft - b.daysLeft : new Date(b.date) - new Date(a.date)));
  const summary = Object.fromEntries(NOTICE_STATUSES.map((status) => [status, items.filter((item) => item.status === status).length]));
  summary.dueSoon = items.filter((item) => item.status === "due" && item.daysLeft <= 7).length;
  return { asOf: asOf.toISOString(), profile: { form: profile.form, formLabel: profile.formLabel, delayNoticeDays: profile.delayNoticeDays, variationNoticeDays: profile.variationNoticeDays, responseDays: profile.responseDays, claimParticularsDays: profile.claimParticularsDays, exists: profile.exists }, summary, items };
};

// ─── Notice drafting ──────────────────────────────────────────────────────

const NOTICE_PROMPT = `You draft formal contractual notices for a construction contractor. Write in the first person plural on behalf of the Contractor to the Engineer / Employer, formal and short, citing the clause references given. Use ONLY the facts and clauses supplied; never invent dates, amounts or clause numbers. State: the event, when it occurred / was first known, the clause under which notice is given, that particulars will follow within the period stated, and the reservation of the Contractor's rights to time and cost.
Return ONLY a JSON object: {"subject": "…", "body": "the letter body with paragraphs separated by blank lines", "clauseRefs": ["Sub-Clause 20.1"]}`;

const relevantClauses = (profile, kind) => {
  const categories = kind === EVENT_KINDS.variation ? ["variation", "notice", "eot"] : kind === EVENT_KINDS.incoming ? ["notice", "dispute", "other"] : ["notice", "eot", "force_majeure"];
  return profile.clauses.filter((clause) => categories.includes(clause.category) && clause.status !== "rejected").slice(0, 6);
};

const clauseBlock = (clauses) => (clauses.length ? `Clauses on record:\n${clauses.map((clause) => `- ${clause.reference || clause.title}${clause.days !== null && clause.days !== undefined ? ` (${clause.days} days)` : ""}: ${clause.summary || clause.title}${clause.excerpt ? `\n  "${clause.excerpt}"` : ""}`).join("\n")}` : "Clauses on record: none confirmed yet.");

const templateNotice = ({ project, profile, event }) => {
  const reference = event.clauseReference || relevantClauses(profile, event.kind)[0]?.reference || "the Contract";
  const isVariation = event.kind === EVENT_KINDS.variation;
  const subject = `Notice under ${reference} — ${event.ref ? `${event.ref} ` : ""}${event.title}`.slice(0, 200);
  const body = [
    `Contract: ${project.contractNumber || project.name}${project.contractType ? ` (${project.contractType})` : ""}`,
    `To: ${project.consultantName || project.clientName || "the Engineer"}`,
    `From: ${project.contractorName || "the Contractor"}`,
    "",
    `We give notice under ${reference} that ${isVariation ? "the instruction / change" : "the following event"} ${event.ref ? `${event.ref} — ` : ""}${event.title} ${isVariation ? "constitutes a Variation and" : "has occurred on"} ${dateOnly(event.date)}${event.days ? ` and is expected to delay the Works by ${plural(event.days, "day")}` : ""}.`,
    "",
    `This event ${isVariation ? "entitles the Contractor to an adjustment of the Contract Price and, where applicable, an extension of the Time for Completion" : "is likely to entitle the Contractor to an extension of the Time for Completion and to additional payment"} under the Contract. Full particulars, including the effect on the programme and the costs incurred, will follow within ${plural(profile.claimParticularsDays, "day")} of this notice.`,
    "",
    "The Contractor reserves all of its rights under the Contract and at law. Please acknowledge receipt of this notice.",
  ].join("\n");
  return { subject, body, clauseRefs: [reference] };
};

const draftNotice = async ({ orgId, projectId, user, payload = {}, transport = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const monitor = await noticeMonitor({ orgId, projectId });
  const event = monitor.items.find((item) => item.recordType === payload.recordType && item.recordId === payload.recordId);
  if (!event) throw new HttpError(404, "CONTRACT_EVENT_NOT_FOUND", "That event is not on the notice monitor");
  const profile = serializeProfile(await loadProfileRow({ projectId }), projectId);
  const clauses = relevantClauses(profile, event.kind);
  const fallback = templateNotice({ project, profile, event });
  const facts = [
    `Project: ${project.name}${project.contractNumber ? ` · contract ${project.contractNumber}` : ""}${project.contractType ? ` (${project.contractType})` : ""}; form ${profile.formLabel}`,
    `Employer: ${project.clientName || "—"}; Engineer / consultant: ${project.consultantName || "—"}; Contractor: ${project.contractorName || "—"}`,
    `Event: ${event.ref ? `${event.ref} — ` : ""}${event.title} (${event.kind}) on ${dateOnly(event.date)}${event.days ? `, ${plural(event.days, "day")} of delay recorded` : ""}; status ${event.status}`,
    `Notice period: ${plural(event.periodDays, "day")} (${event.clauseReference || "no clause reference on record"}); deadline ${dateOnly(event.deadline)} (${event.daysLeft >= 0 ? `${event.daysLeft} days left` : `${Math.abs(event.daysLeft)} days ago`}); particulars within ${plural(profile.claimParticularsDays, "day")}`,
    clauseBlock(clauses),
    payload.instructions ? `Instructions from the writer: ${clip(payload.instructions, 1000)}` : null,
  ].filter(Boolean).join("\n");
  if (!aiProvider.isEnabled() && !transport) return { degraded: true, reason: "AI drafting is not configured on this server; this is the standard template.", event, draft: { ...fallback, deadline: event.deadline, daysLeft: event.daysLeft }, message: null };
  let completion;
  try {
    completion = await aiProvider.complete({ system: NOTICE_PROMPT, messages: [{ role: "user", content: `${facts}\n\nDraft the notice.` }], maxTokens: 1200, temperature: 0.2, transport });
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { degraded: true, reason: `${error.message} This is the standard template.`, event, draft: { ...fallback, deadline: event.deadline, daysLeft: event.daysLeft }, message: null };
  }
  const parsed = aiProvider.parseJsonAnswer(completion.text);
  const draft = { subject: clip(parsed?.subject, 200) || fallback.subject, body: clip(parsed?.body, 12000) || fallback.body, clauseRefs: (Array.isArray(parsed?.clauseRefs) ? parsed.clauseRefs : fallback.clauseRefs).map((ref) => clip(ref, 80)).filter(Boolean).slice(0, 6), deadline: event.deadline, daysLeft: event.daysLeft };
  const stored = await assistant.storeRun({ orgId, user, projectId, kind: "contract_notice", recordType: event.recordType, recordId: event.recordId, title: `Notice draft: ${event.ref || event.title}`, prompt: facts, answer: `${draft.subject}\n\n${draft.body}`, usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null }).catch(() => null);
  return { degraded: false, event, draft, message: stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null };
};

/** Creates the notice as an outgoing contractual correspondence and links it to the event. */
const createNotice = async ({ orgId, projectId, user, payload = {} }) => {
  const subject = clip(payload.subject, 200);
  const body = clip(payload.body, 12000);
  if (!subject || !body) throw new HttpError(400, "CONTRACT_NOTICE_TEXT", "The notice needs a subject and a body");
  const recordType = trimOrNull(payload.recordType);
  const recordId = trimOrNull(payload.recordId);
  if (!recordType || !recordId || !Object.values(RECORD_TYPES).includes(recordType)) throw new HttpError(400, "CONTRACT_EVENT_REQUIRED", "The notice must refer to an event on the monitor");
  const correspondence = require("./correspondence.service");
  const created = await correspondence.createCorrespondence({ orgId, projectId, payload: { direction: "outgoing", type: "notice", subject, body, contractualNotice: true, date: payload.date || new Date().toISOString(), activityId: payload.activityId || null, status: "open", comment: `Contractual notice for ${recordType} ${recordId}` }, userId: user.id, userRole: user.role });
  let link = null;
  if (prisma.commercialCorrespondenceLink?.create) {
    try {
      link = await prisma.commercialCorrespondenceLink.create({ data: { projectId, recordType, recordId, correspondenceId: created.id, relationType: "notice", notes: "Created from the contract notice monitor" } });
    } catch {
      link = null;
    }
  }
  return { correspondence: created, linked: Boolean(link), url: `/projects/${projectId}/doc-control/correspondence?recordId=${created.id}` };
};

// ─── EOT entitlement assessment ───────────────────────────────────────────

const ASSESS_PROMPT = `You are a delay analyst assessing an extension of time claim under a construction contract. You are given the claim (event, delay days, affected activities with float and critical-path impact), the contract clauses on record, the notice compliance for the event, the evidence on record (weather delays, daily-log delay entries, correspondence, attachments) and the contract dates.
Assess entitlement strictly from what is given: is the event a ground for extension under the clauses; was notice given in time; does the delay sit on the critical path (float absorbs the rest); is there concurrency with contractor-caused delay; is the evidence sufficient. Do not invent facts. Where something is missing, list it as a gap.
Return ONLY a JSON object: {"entitlement": "likely | partial | unlikely", "recommendedDays": 0, "basis": ["…"], "gaps": ["…"], "concurrency": ["…"], "noticeCompliance": "one or two sentences", "narrative": "the supporting analysis, 2–4 paragraphs", "claimLetter": "a formal claim letter body citing the clauses"}`;

const loadClaim = async ({ orgId, projectId, claimId }) => {
  await ensureProject({ orgId, projectId });
  const claim = await prisma.eotClaim.findFirst({ where: { id: claimId, projectId }, include: { activityLinks: { include: { activity: { select: { id: true, name: true, activityCode: true, isCritical: true, totalFloat: true } } } }, weatherDelayLinks: { include: { weatherDelay: { select: { id: true, date: true, description: true, delayDays: true, contractual: true } } } } } });
  if (!claim) throw new HttpError(404, "EOT_CLAIM_NOT_FOUND", "EOT claim not found");
  return claim;
};

const claimEvidence = async ({ projectId, claim }) => {
  const starts = [...(claim.activityLinks || []).map((link) => link.delayStart), ...(claim.weatherDelayLinks || []).map((link) => link.delayStart || link.weatherDelay?.date)].filter(Boolean).map((value) => new Date(value));
  const ends = [...(claim.activityLinks || []).map((link) => link.delayEnd), ...(claim.weatherDelayLinks || []).map((link) => link.delayEnd || link.weatherDelay?.date)].filter(Boolean).map((value) => new Date(value));
  const from = starts.length ? new Date(Math.min(...starts)) : null;
  const to = ends.length ? new Date(Math.max(...ends)) : from;
  const [logDelays, attachments, links] = await Promise.all([
    from ? safeMany("dailyLogDelay", { where: { projectId, status: { not: "rejected" }, dailyLog: { date: { gte: from, lte: addDays(to || from, 1) } } }, select: { id: true, type: true, description: true, hoursLost: true, activityId: true, dailyLog: { select: { date: true } } }, take: 200 }) : [],
    safeMany("commercialAttachmentRef", { where: { projectId, recordType: RECORD_TYPES.EOT_CLAIM, recordId: claim.id }, select: { id: true, fileName: true, description: true } }),
    safeMany("commercialCorrespondenceLink", { where: { projectId, recordType: RECORD_TYPES.EOT_CLAIM, recordId: claim.id }, select: { correspondenceId: true, relationType: true, correspondence: { select: { ref: true, subject: true, date: true, direction: true, contractualNotice: true } } } }),
  ]);
  return { window: { from: dateOnly(from), to: dateOnly(to) }, logDelays: logDelays.map((row) => ({ id: row.id, date: dateOnly(row.dailyLog?.date), type: row.type, description: row.description, hoursLost: Number(row.hoursLost) || 0, activityId: row.activityId })), attachments, correspondence: links.map((link) => ({ ...link.correspondence, date: toIso(link.correspondence?.date), relationType: link.relationType })) };
};

const deterministicAssessment = ({ claim, profile, notices, evidence }) => {
  const summary = claim.entitlementSummaryJson || {};
  const cpDays = Number(summary.criticalPathImpactDays ?? (claim.activityLinks || []).reduce((sum, link) => sum + (Number(link.criticalPathImpactDays) || 0), 0)) || 0;
  const claimed = Number(claim.delayDays) || 0;
  const noticeOk = notices.length > 0 && notices.every((notice) => notice.status === "served" || notice.status === "not_required");
  const noticeMissing = notices.filter((notice) => notice.status === "missed" || notice.status === "due");
  const gaps = [];
  if (!notices.length) gaps.push("No event on the notice monitor is linked to this claim.");
  if (noticeMissing.length) gaps.push(`Notice ${noticeMissing.some((notice) => notice.status === "missed") ? "was not served within" : "is still due under"} the ${plural(profile.delayNoticeDays, "day")} period (${profile.references.notice || "notice clause"}).`);
  if (notices.some((notice) => notice.status === "late")) gaps.push("The notice was served after the contractual period; expect a time-bar argument.");
  if (cpDays <= 0) gaps.push("None of the affected activities carries the delay onto the critical path (float absorbs it); no extension follows from the programme as recorded.");
  if (!evidence.attachments.length) gaps.push("No supporting documents are attached to the claim.");
  if (!evidence.logDelays.length) gaps.push("No daily-log delay entries fall in the delay window.");
  if (!profile.clauses.some((clause) => clause.category === "eot" && clause.status === "confirmed")) gaps.push("No confirmed extension-of-time clause on the contract profile.");
  const entitlement = cpDays > 0 && noticeOk ? "likely" : cpDays > 0 || noticeOk ? "partial" : "unlikely";
  return {
    entitlement,
    recommendedDays: Math.min(claimed, cpDays),
    basis: [cpDays > 0 ? `${plural(cpDays, "day")} of critical-path impact across ${plural((claim.activityLinks || []).length, "linked activity", "linked activities")}` : "No critical-path impact recorded", noticeOk ? "Notice served within the period" : "Notice compliance not established", evidence.logDelays.length ? `${plural(evidence.logDelays.length, "daily-log delay entry", "daily-log delay entries")} in the window` : null, (claim.weatherDelayLinks || []).length ? `${plural((claim.weatherDelayLinks || []).length, "weather delay")} linked (allowance ${profile.weatherAllowanceDays ?? "—"} days)` : null].filter(Boolean),
    gaps,
    concurrency: [],
    noticeCompliance: notices.length ? notices.map((notice) => `${notice.ref || notice.title}: ${notice.status}${notice.served ? ` (${notice.served.ref || "notice"} on ${dateOnly(notice.served.date)})` : ""}`).join("; ") : "No notice event linked to this claim.",
    narrative: `${claim.eventName}: ${plural(claimed, "day")} claimed, ${plural(cpDays, "day")} on the critical path. ${noticeOk ? "Notice was served within the contractual period." : "Notice compliance is not established."} ${gaps.length ? `Gaps: ${gaps.join(" ")}` : "No gaps found in the record."}`,
    claimLetter: claim.claimLetter || null,
  };
};

const normalizeAssessment = (parsed, fallback) => ({
  entitlement: ["likely", "partial", "unlikely"].includes(parsed?.entitlement) ? parsed.entitlement : fallback.entitlement,
  recommendedDays: intOrNull(parsed?.recommendedDays) ?? fallback.recommendedDays,
  basis: (Array.isArray(parsed?.basis) ? parsed.basis : fallback.basis).map((item) => clip(item, 400)).filter(Boolean).slice(0, 8),
  gaps: (Array.isArray(parsed?.gaps) ? parsed.gaps : fallback.gaps).map((item) => clip(item, 400)).filter(Boolean).slice(0, 8),
  concurrency: (Array.isArray(parsed?.concurrency) ? parsed.concurrency : []).map((item) => clip(item, 400)).filter(Boolean).slice(0, 6),
  noticeCompliance: clip(parsed?.noticeCompliance, 800) || fallback.noticeCompliance,
  narrative: clip(parsed?.narrative, 8000) || fallback.narrative,
  claimLetter: clip(parsed?.claimLetter, 12000) || fallback.claimLetter,
});

const assessClaim = async ({ orgId, projectId, claimId, user, transport = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const claim = await loadClaim({ orgId, projectId, claimId });
  const profile = { ...serializeProfile(await loadProfileRow({ projectId }), projectId), weatherAllowanceDays: project.weatherAllowanceDays };
  const monitor = await noticeMonitor({ orgId, projectId });
  const weatherIds = new Set((claim.weatherDelayLinks || []).map((link) => link.weatherDelayId));
  const notices = monitor.items.filter((item) => (item.recordType === RECORD_TYPES.EOT_CLAIM && item.recordId === claim.id) || (item.recordType === RECORD_TYPES.WEATHER_DELAY && weatherIds.has(item.recordId)));
  const evidence = await claimEvidence({ projectId, claim });
  const fallback = deterministicAssessment({ claim, profile, notices, evidence });
  const summary = claim.entitlementSummaryJson || {};
  const text = [
    `Project: ${project.name}; form ${profile.formLabel}; contract completion ${dateOnly(project.completionDate || project.endDate) || "—"}${project.revisedCompletionDate ? `, revised ${dateOnly(project.revisedCompletionDate)}` : ""}; LD rate ${Number(project.ldRatePerDay) || 0}/day; weather allowance ${project.weatherAllowanceDays} days`,
    `Claim ${claim.ref}: ${claim.eventName} (${claim.eventType || "delay event"}), status ${claim.status}, ${plural(Number(claim.delayDays) || 0, "day")} claimed, ${Number(claim.eotDaysGranted) || 0} requested; critical-path impact ${summary.criticalPathImpactDays ?? "—"} days, float absorbed ${summary.floatAbsorbedDays ?? "—"}, LD-applicable ${summary.ldApplicableDays ?? "—"}`,
    "Affected activities:",
    ...((claim.activityLinks || []).length ? claim.activityLinks.map((link) => `- ${link.activity?.name || link.activityId}${link.activity?.activityCode ? ` (${link.activity.activityCode})` : ""} · delay ${link.delayDays} days${link.delayStart ? ` from ${dateOnly(link.delayStart)}` : ""}${link.delayEnd ? ` to ${dateOnly(link.delayEnd)}` : ""} · float ${link.floatDays} · critical-path impact ${link.criticalPathImpactDays}${link.activity?.isCritical ? " · critical" : ""}${link.impactBasis ? ` · ${link.impactBasis}` : ""}`) : ["- none linked"]),
    "Weather delays linked:",
    ...((claim.weatherDelayLinks || []).length ? claim.weatherDelayLinks.map((link) => `- ${dateOnly(link.weatherDelay?.date)} ${link.weatherDelay?.description || ""} · ${link.weatherDelay?.delayDays ?? link.delayDays} days · ${link.weatherDelay?.contractual ? "contractual" : "non-contractual"}`) : ["- none"]),
    `Notice compliance: ${fallback.noticeCompliance}`,
    `Evidence: ${plural(evidence.logDelays.length, "daily-log delay entry", "daily-log delay entries")} in ${evidence.window.from || "—"} → ${evidence.window.to || "—"}${evidence.logDelays.length ? ` (${evidence.logDelays.slice(0, 6).map((row) => `${row.date} ${row.type} ${row.hoursLost}h`).join("; ")})` : ""}; ${plural(evidence.attachments.length, "attachment")}; ${plural(evidence.correspondence.length, "linked letter")}`,
    clauseBlock(profile.clauses.filter((clause) => ["eot", "notice", "force_majeure", "ld"].includes(clause.category) && clause.status !== "rejected").slice(0, 8)),
    claim.analysis ? `Existing analysis on the claim: ${clip(claim.analysis, 2000)}` : null,
  ].filter(Boolean).join("\n");
  const claimOut = { id: claim.id, ref: claim.ref, eventName: claim.eventName, status: claim.status, delayDays: Number(claim.delayDays) || 0, eotDaysGranted: Number(claim.eotDaysGranted) || 0 };
  if (!aiProvider.isEnabled() && !transport) return { degraded: true, reason: "AI assessment is not configured on this server; this assessment was built from the record.", claim: claimOut, assessment: fallback, notices, evidence, message: null };
  let completion;
  try {
    completion = await aiProvider.complete({ system: ASSESS_PROMPT, messages: [{ role: "user", content: text }], maxTokens: 2500, temperature: 0.2, transport });
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { degraded: true, reason: `${error.message} This assessment was built from the record.`, claim: claimOut, assessment: fallback, notices, evidence, message: null };
  }
  const assessment = normalizeAssessment(aiProvider.parseJsonAnswer(completion.text), fallback);
  const stored = await assistant.storeRun({ orgId, user, projectId, kind: "contract_eot", recordType: RECORD_TYPES.EOT_CLAIM, recordId: claim.id, title: `Entitlement: ${claim.ref}`, prompt: text, answer: JSON.stringify(assessment), usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null }).catch(() => null);
  return { degraded: false, claim: claimOut, assessment, notices, evidence, message: stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null };
};

/** Writes the kept analysis / claim letter onto the claim through the EOT service (draft claims only). */
const applyAssessment = async ({ orgId, projectId, claimId, payload = {}, user }) => {
  const analysis = payload.analysis === undefined ? undefined : clip(payload.analysis, 8000);
  const claimLetter = payload.claimLetter === undefined ? undefined : clip(payload.claimLetter, 12000);
  if (analysis === undefined && claimLetter === undefined) throw new HttpError(400, "CONTRACT_APPLY_EMPTY", "Nothing to apply");
  const eot = require("./eot.service");
  const claim = await eot.updateEotClaim({ orgId, projectId, claimId, payload: { ...(analysis !== undefined ? { analysis } : {}), ...(claimLetter !== undefined ? { claimLetter } : {}) }, userId: user.id, userRole: user.role });
  return { applied: { analysis: analysis !== undefined, claimLetter: claimLetter !== undefined }, claim };
};

module.exports = { FORMS, CLAUSE_CATEGORIES, RECORD_TYPES, EVENT_KINDS, NOTICE_STATUSES, EXTRACT_PROMPT, NOTICE_PROMPT, ASSESS_PROMPT, presets, getProfile, updateProfile, extractClauses, heuristicClauses, windowsOf, noticeMonitor, draftNotice, createNotice, assessClaim, applyAssessment, deterministicAssessment, templateNotice };
