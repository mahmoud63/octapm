const fs = require("fs/promises");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const aiProvider = require("./ai-provider.service");
const assistant = require("./assistant.service");
const dailyLog = require("./daily-log.service");
const attachments = require("./attachment.service");

/**
 * Daily report auto-draft from the day's records, photos and voice notes
 * (OCTA-AI-DAILY-030).
 *
 * Evidence for a calendar day in the project's own time zone: the daily log
 * as logged so far (weather, manpower, equipment, deliveries, visitors,
 * delays, notes), progress updates, inspections, punch items / observations,
 * safety incidents and the photos taken that day (sent to the model as
 * images when the provider reads them), plus whatever the site team dictated
 * or typed. The model returns a summary, work performed, notes, delays and
 * captions for uncaptioned photos; the person picks what to apply and the
 * day is updated through the daily log's own service. Without a provider a
 * factual draft is built from the records alone.
 */

const KIND = "daily_log_draft";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const CONFIDENCE = Object.freeze(["high", "medium", "low"]);
const maxPhotos = () => Math.max(0, Math.min(20, Number(process.env.AI_MAX_PHOTOS || 8)));

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const clip = (value, max) => {
  const text = trimOrNull(typeof value === "string" ? value : value === null || value === undefined ? null : String(value));
  return text ? text.slice(0, max) : null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const list = (value, max = 8, size = 300) => (Array.isArray(value) ? value.map((item) => clip(typeof item === "string" ? item : item?.text || item?.description, size)).filter(Boolean).slice(0, max) : []);
const clampHours = (value) => Math.min(24, Math.max(0, Number(value) || 0));
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const DRAFT_PROMPT = `You write the daily site report for a construction project from the evidence supplied for ONE calendar day: what the team has already logged, progress updates, inspections, punch items and observations, safety incidents, site photos (described and, when attached, shown) and notes the site team dictated.
Rules: use ONLY the evidence; never invent quantities, companies, people, locations or causes. Past tense, factual, no marketing. For photos describe only what is visible. When the dictated notes mention something the records do not, include it and cite "notes". Record a delay only where the evidence says work was held up. Mark what the team should still record in "missing".
Photo references are P1, P2 …; progress references are progress:<id>.
Return ONLY a JSON object:
{"summary": "5–10 sentences for the report", "workPerformed": [{"text": "…", "activity": "activity name or null", "sources": ["P1", "progress:…", "notes"]}], "notes": [{"kind": "general | safety | instruction | inspection | issue", "text": "…"}], "delays": [{"type": "weather | access | design | material | labour | equipment | inspection | utility | other", "description": "…", "hoursLost": 0}], "photoCaptions": [{"photo": "P3", "caption": "one line, what and where"}], "missing": ["…"], "confidence": "high | medium | low"}
Caption only photos that have no caption yet. Keep "notes" for facts worth keeping on the day that are not already logged.`;

// ─── The project's local day ──────────────────────────────────────────────

const tzOffsetMinutes = (timezone, at) => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
    const get = (type) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
};

/** UTC bounds of a YYYY-MM-DD day in the given time zone (UTC when none). */
const dayWindow = (date, timezone = null) => {
  const key = String(date || "").slice(0, 10);
  const noon = new Date(`${key}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || Number.isNaN(noon.getTime())) throw new HttpError(400, "DAILY_LOG_DATE", "date must be YYYY-MM-DD");
  const offset = timezone ? tzOffsetMinutes(timezone, noon) : 0;
  const start = new Date(Date.parse(`${key}T00:00:00.000Z`) - offset * 60_000);
  return { key, start, end: new Date(start.getTime() + 86_400_000 - 1) };
};

// ─── Evidence ─────────────────────────────────────────────────────────────

const safeMany = async (model, args) => {
  try {
    return prisma[model]?.findMany ? await prisma[model].findMany(args) : [];
  } catch {
    return [];
  }
};

const collectEvidence = async ({ orgId, projectId, date, viewer = null, photoIds = null }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true, timezone: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  const { key, start, end } = dayWindow(date, project.timezone);
  const range = { gte: start, lte: end };
  const [log, photos, progress, inspections, punch, safety] = await Promise.all([
    dailyLog.getLog({ orgId, projectId, date: key, viewer }),
    safeMany("photo", {
      where: { projectId, orgId, ...(photoIds?.length ? { id: { in: photoIds } } : { OR: [{ takenAt: range }, { takenAt: null, createdAt: range }] }) },
      include: { location: { select: { id: true, name: true } }, document: { select: { id: true, fileName: true, originalName: true, mimeType: true } } },
      orderBy: [{ takenAt: "asc" }, { createdAt: "asc" }],
      take: 40,
    }),
    safeMany("progressSubmission", { where: { projectId, OR: [{ submittedAt: range }, { submittedAt: null, createdAt: range }] }, include: { activity: { select: { id: true, name: true, wbsCode: true, p6ActivityId: true } } }, orderBy: { createdAt: "asc" }, take: 50 }),
    safeMany("formInstance", { where: { projectId, OR: [{ completedAt: range }, { startedAt: range }] }, select: { id: true, ref: true, type: true, title: true, status: true, outcome: true, completedAt: true }, take: 50 }),
    safeMany("punchItem", { where: { projectId, createdAt: range, status: { not: "void" } }, select: { id: true, ref: true, title: true, kind: true, observationType: true, priority: true, status: true, trade: true, locationText: true }, take: 50 }),
    safeMany("safetyIncident", { where: { projectId, date: range, archivedAt: null }, select: { id: true, ref: true, title: true, incidentType: true, severity: true, status: true }, take: 20 }),
  ]);
  return { project, key, start, end, log, photos: photos.map((photo, index) => ({ ...photo, ref: `P${index + 1}` })), progress, inspections, punch, safety };
};

const num = (value) => (value === null || value === undefined ? "—" : String(value));

// The BOQ-access rule (utils/boq-figures.js): a progress submission's typed
// installed quantity, its planned quantity (Σ approved allocations) and its
// unit are figures of the bill, withheld from a member who may not read the
// BOQ on the project. The evidence is what the model is shown and what the
// stored run keeps, served back to its author, so it carries those figures
// only for a BOQ reader; anyone else's evidence states the percentage, the
// method and the status. The caller says which (`access`, boqFigureAccess);
// without it nothing of the bill is shown.
const NO_BOQ_ACCESS = Object.freeze({ boq: false, budget: false });
const hasQuantity = (row) => row.quantityComplete !== null && row.quantityComplete !== undefined;
const quantityNote = (row) =>
  hasQuantity(row) ? ` (${row.quantityComplete}${row.quantityUnit ? ` ${row.quantityUnit}` : ""}${row.quantityPlanned !== null && row.quantityPlanned !== undefined ? ` of ${row.quantityPlanned}` : ""})` : "";
const progressLine = (row, access) =>
  `- progress:${row.id} · ${row.activity?.name || "activity"} → ${row.pctComplete}%${row.method ? ` by ${row.method}` : ""}${access?.boq ? quantityNote(row) : ""} · ${row.status}${row.notes ? ` · ${row.notes}` : ""}`;

/** Everything the model may use, as text; photos are listed here and attached as images separately. */
const evidenceBlock = ({ project, key, log, photos, progress, inspections, punch, safety, notes, access = NO_BOQ_ACCESS }) => {
  const rows = (items, render) => (items.length ? items.map(render) : ["- none"]);
  const weather = log.weather;
  const s = log.sections;
  const lines = [
    `Project: ${project.name}`,
    `Date: ${key}`,
    "",
    `Weather: ${weather ? [weather.summary || weather.condition, weather.tempMinC !== null && weather.tempMinC !== undefined ? `${num(weather.tempMinC)}–${num(weather.tempMaxC)} °C` : weather.tempMaxC !== null && weather.tempMaxC !== undefined ? `up to ${weather.tempMaxC} °C` : null, weather.precipitationMm ? `${weather.precipitationMm} mm rain` : null, weather.windMaxKph ? `wind ${weather.windMaxKph} km/h` : null, ...(weather.alerts || []).map((alert) => `ALERT ${alert.message}`)].filter(Boolean).join(", ") : "not recorded"}`,
  ];
  if (log.summary) lines.push(`Existing summary (improve it, do not repeat it): ${log.summary}`);
  lines.push("", `Manpower logged (${log.totals.workers} workers, ${log.totals.manHours} man-hours):`, ...rows(s.manpower, (row) => `- ${row.companyName || row.party?.companyName || "company ?"} · ${row.trade} · ${row.workers} × ${row.hours} h${row.activity ? ` · ${row.activity.name}` : ""}${row.location ? ` · ${row.location.name}` : ""}${row.notes ? ` · ${row.notes}` : ""}`));
  lines.push("", "Equipment logged:", ...rows(s.equipment, (row) => `- ${row.name} × ${row.count} · ${row.hoursOperated} h run, ${row.hoursIdle} h idle${row.activity ? ` · ${row.activity.name}` : ""}${row.notes ? ` · ${row.notes}` : ""}`));
  lines.push("", "Deliveries logged:", ...rows(s.deliveries, (row) => `- ${row.description}${row.quantity !== null && row.quantity !== undefined ? ` · ${row.quantity} ${row.unit || ""}`.trimEnd() : ""}${row.supplierName ? ` · ${row.supplierName}` : ""}${row.poRef ? ` · PO ${row.poRef}` : ""}`));
  lines.push("", "Visitors logged:", ...rows(s.visitors, (row) => `- ${row.name}${row.company ? ` (${row.company})` : ""}${row.purpose ? ` · ${row.purpose}` : ""}`));
  lines.push("", "Delays logged:", ...rows(s.delays, (row) => `- ${row.type}: ${row.description} · ${row.hoursLost} h lost${row.suggested ? " (suggested by the weather feed, not confirmed)" : ""}`));
  lines.push("", "Notes logged:", ...rows(s.notes, (row) => `- [${row.kind}] ${row.text}`));
  lines.push("", "Progress updates today:", ...rows(progress, (row) => progressLine(row, access)));
  lines.push("", "Inspections today:", ...rows(inspections, (row) => `- ${row.ref} ${row.title} (${row.type}) · ${row.status}${row.outcome ? ` · ${row.outcome}` : ""}`));
  lines.push("", "Punch items / observations raised today:", ...rows(punch, (row) => `- ${row.ref} ${row.title} · ${row.kind}${row.observationType ? ` (${row.observationType})` : ""} · ${row.priority}${row.trade ? ` · ${row.trade}` : ""}${row.locationText ? ` · ${row.locationText}` : ""}`));
  lines.push("", "Safety incidents today:", ...rows(safety, (row) => `- ${row.ref} ${row.title} · ${row.incidentType}${row.severity ? ` · ${row.severity}` : ""} · ${row.status}`));
  lines.push("", `Photos today (${photos.length}):`, ...rows(photos, (photo) => `- ${photo.ref}${photo.takenAt ? ` ${toIso(photo.takenAt).slice(11, 16)} UTC` : ""}${photo.location ? ` · ${photo.location.name}` : ""}${photo.caption ? ` · "${photo.caption}"` : " · no caption"}${photo.tags?.length ? ` · tags ${photo.tags.join(", ")}` : ""}`));
  if (notes) lines.push("", `Dictated / typed notes from the site team:\n${notes}`);
  return lines.join("\n");
};

const readFile = async (file, fetchImpl) => {
  if (file?.path) return fs.readFile(file.path);
  if (file?.redirectUrl) {
    const response = await (fetchImpl || fetch)(file.redirectUrl);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }
  return null;
};

/** Up to AI_MAX_PHOTOS images (thumbnails when ready) as content blocks, each introduced by its reference. */
const loadImages = async ({ orgId, projectId, photos, fetchImpl = null }) => {
  const blocks = [];
  for (const photo of photos.slice(0, maxPhotos())) {
    try {
      const file = await attachments.getPhotoFile({ orgId, projectId, photoId: photo.id, variant: "thumbnail" });
      const mediaType = String(file?.mimeType || photo.document?.mimeType || "").toLowerCase();
      if (!IMAGE_TYPES.has(mediaType)) continue;
      const buffer = await readFile(file, fetchImpl);
      if (!buffer || !buffer.length || buffer.length > MAX_IMAGE_BYTES) continue;
      blocks.push({ type: "text", text: `Photo ${photo.ref}${photo.caption ? ` — ${photo.caption}` : ""}${photo.location ? ` (${photo.location.name})` : ""}` });
      blocks.push({ type: "image", mediaType, data: buffer.toString("base64"), photoId: photo.id });
    } catch {
      /* a photo that cannot be read is simply not shown */
    }
  }
  return blocks;
};

const photoOut = ({ projectId, photos, included }) =>
  photos.map((photo) => ({
    id: photo.id,
    ref: photo.ref,
    caption: photo.caption || null,
    takenAt: toIso(photo.takenAt),
    thumbnailUrl: photo.thumbnailStatus === "ready" && photo.thumbnailKey ? `/api/v1/projects/${projectId}/photos/${photo.id}/thumbnail` : `/api/v1/projects/${projectId}/attachments/documents/${photo.documentId}`,
    locationName: photo.location?.name || null,
    tags: photo.tags || [],
    included: included.has(photo.id),
  }));

// ─── Drafts ───────────────────────────────────────────────────────────────

/** A factual draft from the records alone — used without a provider and as the fallback for missing fields. */
const deterministicDraft = (evidence, notes = null) => {
  const { log, progress, inspections, punch, safety, photos } = evidence;
  const totals = log.totals;
  const weather = log.weather;
  const sentences = [];
  if (weather) sentences.push(`Weather: ${weather.summary || weather.condition || "recorded"}${weather.tempMaxC !== null && weather.tempMaxC !== undefined ? `, up to ${weather.tempMaxC} °C` : ""}${weather.precipitationMm ? `, ${weather.precipitationMm} mm rain` : ""}.`);
  sentences.push(totals.workers ? `${plural(totals.workers, "worker")} from ${plural(totals.companies, "company", "companies")} on site (${totals.manHours} man-hours).` : "No manpower logged.");
  if (totals.equipmentCount) sentences.push(`${plural(totals.equipmentCount, "item")} of equipment, ${totals.equipmentHours} operating hours${totals.idleHours ? ` and ${totals.idleHours} idle` : ""}.`);
  if (totals.deliveries) sentences.push(`${plural(totals.deliveries, "delivery", "deliveries")} received.`);
  if (progress.length) sentences.push(`Progress recorded on ${progress.map((row) => `${row.activity?.name || "an activity"} (${row.pctComplete}%)`).join(", ")}.`);
  if (inspections.length) sentences.push(`Inspections: ${inspections.map((row) => `${row.ref} ${row.outcome || row.status}`).join(", ")}.`);
  if (punch.length) sentences.push(`${plural(punch.length, "punch item / observation", "punch items / observations")} raised (${punch.map((row) => row.ref).join(", ")}).`);
  if (safety.length) sentences.push(`Safety: ${safety.map((row) => `${row.ref} ${row.incidentType}`).join(", ")}.`);
  if (totals.hoursLost) sentences.push(`${totals.hoursLost} hours lost to delays.`);
  if (photos.length) sentences.push(`${plural(photos.length, "site photo")} taken.`);
  if (notes) sentences.push(`Site notes: ${notes}`);
  const noteRows = [
    ...(notes ? [{ kind: "general", text: notes }] : []),
    ...punch.filter((row) => row.kind === "observation" && row.observationType === "safety").map((row) => ({ kind: "safety", text: `${row.ref} ${row.title}` })),
    ...safety.map((row) => ({ kind: "safety", text: `${row.ref} ${row.title} (${row.incidentType})` })),
  ].slice(0, 10);
  return {
    summary: sentences.join(" "),
    workPerformed: progress.map((row) => ({ text: `${row.activity?.name || "Activity"} to ${row.pctComplete}%`, activity: row.activity?.name || null, sources: [`progress:${row.id}`] })),
    notes: noteRows,
    delays: [],
    photoCaptions: [],
    missing: [!totals.workers ? "Manpower for the day" : null, !weather ? "Weather" : null, photos.some((photo) => !photo.caption) ? "Captions on today's photos" : null].filter(Boolean),
    confidence: "low",
  };
};

const normalizeDraft = (parsed, { photos, fallback }) => {
  const byRef = new Map(photos.map((photo) => [photo.ref, photo]));
  const notes = (Array.isArray(parsed?.notes) ? parsed.notes : []).map((note) => ({ kind: dailyLog.NOTE_KINDS.includes(note?.kind) ? note.kind : "general", text: clip(typeof note === "string" ? note : note?.text, 4000) })).filter((note) => note.text).slice(0, 10);
  const delays = (Array.isArray(parsed?.delays) ? parsed.delays : []).map((delay) => ({ type: dailyLog.DELAY_TYPES.includes(delay?.type) ? delay.type : "other", description: clip(delay?.description || delay?.text, 2000), hoursLost: clampHours(delay?.hoursLost) })).filter((delay) => delay.description).slice(0, 6);
  const photoCaptions = (Array.isArray(parsed?.photoCaptions) ? parsed.photoCaptions : [])
    .map((item) => {
      const photo = byRef.get(String(item?.photo || item?.ref || "").trim().toUpperCase());
      const caption = clip(item?.caption, 300);
      return photo && caption ? { photoId: photo.id, ref: photo.ref, caption, existing: photo.caption || null } : null;
    })
    .filter(Boolean)
    .slice(0, 40);
  const workPerformed = (Array.isArray(parsed?.workPerformed) ? parsed.workPerformed : []).map((item) => ({ text: clip(typeof item === "string" ? item : item?.text, 600), activity: clip(item?.activity, 200), sources: Array.isArray(item?.sources) ? item.sources.map((source) => clip(source, 80)).filter(Boolean).slice(0, 6) : [] })).filter((item) => item.text).slice(0, 12);
  return {
    summary: clip(parsed?.summary, 8000) || fallback.summary,
    workPerformed: workPerformed.length ? workPerformed : fallback.workPerformed,
    notes,
    delays,
    photoCaptions,
    missing: list(parsed?.missing, 8),
    confidence: CONFIDENCE.includes(parsed?.confidence) ? parsed.confidence : "medium",
  };
};

const complete = async ({ system, messages, transport, maxTokens }) => {
  try {
    const completion = await aiProvider.complete({ system, messages, maxTokens, temperature: 0.2, transport });
    return { completion, parsed: aiProvider.parseJsonAnswer(completion.text) };
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { completion: null, parsed: null, error };
  }
};

const runMessage = (stored) => (stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback } : null);

/**
 * Drafts the day. `payload.notes` is the dictated / typed text,
 * `payload.includePhotos` (default true) attaches the day's photos as images
 * when the provider reads them, `payload.photoIds` limits the photos.
 * `access` is the caller's boqFigureAccess: without `access.boq` the
 * evidence carries no quantity of the bill (see progressLine).
 */
const draftReport = async ({ orgId, projectId, date, payload = {}, user, viewer = null, access = NO_BOQ_ACCESS, transport = null, fetchImpl = null }) => {
  const notes = clip(payload.notes, 8000);
  const evidence = await collectEvidence({ orgId, projectId, date, viewer, photoIds: Array.isArray(payload.photoIds) && payload.photoIds.length ? payload.photoIds : null });
  const text = evidenceBlock({ ...evidence, notes, access });
  // The stored run keeps the evidence as its prompt: a run that shows a
  // quantity is BOQ-bearing (assistant.service BOQ_BEARING_KINDS) and is
  // served back only while its author may read the BOQ; one that shows none
  // says so.
  const builtWithoutBoq = !access?.boq || !evidence.progress.some(hasQuantity);
  const provider = aiProvider.describe();
  const counts = { photos: evidence.photos.length, progress: evidence.progress.length, inspections: evidence.inspections.length, punch: evidence.punch.length, safety: evidence.safety.length, entries: evidence.log.totals.entries, notes: Boolean(notes) };
  const degraded = (reason) => ({ degraded: true, reason, date: evidence.key, draft: deterministicDraft(evidence, notes), evidence: { photos: photoOut({ projectId, photos: evidence.photos, included: new Set() }), counts, includedImages: 0 }, message: null });
  if (!provider.enabled && !transport) return degraded("AI drafting is not configured on this server (set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY); this draft was built from the day's records only.");
  const wantImages = payload.includePhotos !== false && evidence.photos.length > 0 && (transport ? true : provider.vision);
  const imageBlocks = wantImages ? await loadImages({ orgId, projectId, photos: evidence.photos, fetchImpl }) : [];
  const included = new Set(imageBlocks.filter((block) => block.type === "image").map((block) => block.photoId));
  const content = imageBlocks.length ? [{ type: "text", text }, ...imageBlocks.map(({ photoId, ...block }) => block), { type: "text", text: "Write the daily report JSON now." }] : text;
  const { completion, parsed, error } = await complete({ system: DRAFT_PROMPT, messages: [{ role: "user", content }], transport, maxTokens: 2500 });
  if (!completion) return degraded(`${error?.message || "The AI provider did not answer."} This draft was built from the day's records only.`);
  const draft = normalizeDraft(parsed, { photos: evidence.photos, fallback: deterministicDraft(evidence, notes) });
  const stored = await assistant.storeRun({ orgId, user, projectId, kind: KIND, recordType: "daily_log", recordId: evidence.log.id || null, title: `Daily report draft ${evidence.key}`, prompt: text, answer: JSON.stringify(draft), usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null, builtWithoutBoq }).catch(() => null);
  return { degraded: false, date: evidence.key, draft, evidence: { photos: photoOut({ projectId, photos: evidence.photos, included }), counts, includedImages: included.size }, message: runMessage(stored) };
};

/**
 * Applies the parts the person kept: the summary, notes and delays as new
 * entries, captions on photos (uncaptioned ones unless `overwriteCaptions`).
 * Every write goes through the daily log / photo services (audited).
 */
const applyDraft = async ({ orgId, projectId, date, payload = {}, actor = null, viewer = null }) => {
  const applied = { summary: false, notes: 0, delays: 0, captions: 0, skippedCaptions: 0 };
  const summary = payload.summary === undefined ? undefined : clip(payload.summary, 8000);
  if (summary !== undefined && summary !== null) {
    await dailyLog.updateLog({ orgId, projectId, date, payload: { summary }, actor, viewer });
    applied.summary = true;
  }
  for (const note of Array.isArray(payload.notes) ? payload.notes.slice(0, 20) : []) {
    const text = clip(note?.text, 4000);
    if (!text) continue;
    await dailyLog.addEntry({ orgId, projectId, date, section: "notes", payload: { kind: dailyLog.NOTE_KINDS.includes(note?.kind) ? note.kind : "general", text, activityId: note?.activityId || null, locationId: note?.locationId || null }, actor, viewer });
    applied.notes += 1;
  }
  for (const delay of Array.isArray(payload.delays) ? payload.delays.slice(0, 10) : []) {
    const description = clip(delay?.description, 2000);
    if (!description) continue;
    await dailyLog.addEntry({ orgId, projectId, date, section: "delays", payload: { type: dailyLog.DELAY_TYPES.includes(delay?.type) ? delay.type : "other", description, hoursLost: clampHours(delay?.hoursLost), activityId: delay?.activityId || null, locationId: delay?.locationId || null }, actor, viewer });
    applied.delays += 1;
  }
  for (const item of Array.isArray(payload.photoCaptions) ? payload.photoCaptions.slice(0, 40) : []) {
    const caption = clip(item?.caption, 300);
    if (!item?.photoId || !caption) continue;
    const photo = prisma.photo?.findFirst ? await prisma.photo.findFirst({ where: { id: item.photoId, projectId, orgId }, select: { id: true, caption: true } }) : null;
    if (!photo) continue;
    if (photo.caption && !payload.overwriteCaptions) {
      applied.skippedCaptions += 1;
      continue;
    }
    await attachments.updatePhoto({ orgId, projectId, photoId: photo.id, payload: { caption }, userId: actor?.id || null, userRole: actor?.role || null });
    applied.captions += 1;
  }
  const log = await dailyLog.getLog({ orgId, projectId, date, viewer });
  return { applied, log };
};

const status = () => {
  const provider = aiProvider.describe();
  return { enabled: provider.enabled, provider: provider.provider, model: provider.model, vision: provider.vision, transcription: provider.transcription, maxPhotos: maxPhotos() };
};

const transcribe = ({ file, language = null, fetchImpl = null }) => {
  if (!file?.buffer) throw new HttpError(400, "AI_TRANSCRIPTION_EMPTY", "Attach a recording as `audio`");
  return aiProvider.transcribeAudio({ buffer: file.buffer, mimeType: file.mimetype || "audio/webm", fileName: file.originalname || "audio.webm", language, fetchImpl });
};

module.exports = { KIND, DRAFT_PROMPT, NO_BOQ_ACCESS, dayWindow, collectEvidence, evidenceBlock, progressLine, deterministicDraft, normalizeDraft, draftReport, applyDraft, status, transcribe };
