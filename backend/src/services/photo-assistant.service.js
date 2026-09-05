const fs = require("fs/promises");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const aiProvider = require("./ai-provider.service");
const assistant = require("./assistant.service");
const attachments = require("./attachment.service");

/**
 * Photo and safety intelligence (OCTA-AI-PHOTO-034).
 *
 * A site photo goes to a vision-capable provider with its context (project,
 * location, time, existing caption and tags, the records it is attached
 * to) and comes back as a proposed caption, tags, the scene and activity,
 * quality notes and SAFETY observations visible in the image (missing PPE,
 * unprotected edges, ladder / scaffold misuse, housekeeping, excavation
 * without shoring…), each with severity and confidence. Nothing is written
 * until the person applies the caption / tags or raises an observation —
 * which goes through the punch engine with the photo attached as evidence.
 * Every analysis is stored as an assistant run on the photo; a batch can
 * analyse the day's uncaptioned photos; `AI_PHOTO_AUTO=on` analyses every
 * upload in the background.
 */

const KIND = "photo_analysis";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const SEVERITIES = Object.freeze(["low", "medium", "high"]);
const CONFIDENCE = Object.freeze(["low", "medium", "high"]);
const batchLimit = () => Math.max(1, Math.min(40, Number(process.env.AI_PHOTO_BATCH || 10)));
const FRESH_MS = 24 * 60 * 60 * 1000;

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

const PHOTO_PROMPT = `You inspect a construction site photo for the project team. Report ONLY what the image shows; if it is not a site photo, is blurred or shows nothing useful, say so with low confidence. Never identify or describe individual people beyond their role and equipment.
1. Caption: one line — what is being done and where (use the location given when it fits).
2. Tags: 3–8 lowercase words for trade, element and stage (e.g. "formwork", "rebar", "concrete pour", "scaffold", "excavation", "mep", "blockwork", "housekeeping", "delivery").
3. Quality notes: anything a quality engineer would look at (honeycombing, cover, alignment, cleanliness before a pour) — only if visible.
4. SAFETY: every hazard visible — missing PPE (helmet, vest, harness, eye protection), unprotected edge or opening, ladder or scaffold misuse (missing guardrails, toe boards, ties), trip hazards and housekeeping, excavation without shoring or barriers, fire or electrical hazards, loads over people, unsafe access. Give a short hazard name, what is visible and why it matters, severity (low / medium / high) and how confident you are.
Return ONLY a JSON object:
{"caption": "…", "tags": ["…"], "scene": "one sentence", "activity": "the work in progress or null", "locationHint": "level / area visible or null", "quality": [{"text": "…", "severity": "low|medium|high"}], "safety": [{"hazard": "…", "description": "…", "severity": "low|medium|high", "confidence": "low|medium|high"}], "confidence": "low|medium|high"}`;

// ─── Image bytes ──────────────────────────────────────────────────────────

const readFile = async (file, fetchImpl) => {
  if (file?.path) return fs.readFile(file.path);
  if (file?.redirectUrl) {
    const response = await (fetchImpl || fetch)(file.redirectUrl);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  }
  return null;
};

/** The original when it fits the size cap, else the thumbnail. */
const loadImage = async ({ orgId, projectId, photo, fetchImpl }) => {
  for (const variant of ["original", "thumbnail"]) {
    try {
      const file = await attachments.getPhotoFile({ orgId, projectId, photoId: photo.id, variant });
      const mediaType = String(file?.mimeType || photo.document?.mimeType || "").toLowerCase();
      if (!IMAGE_TYPES.has(mediaType)) continue;
      const buffer = await readFile(file, fetchImpl);
      if (buffer && buffer.length && buffer.length <= MAX_IMAGE_BYTES) return { mediaType, data: buffer.toString("base64"), bytes: buffer.length, variant };
    } catch {
      /* try the next variant */
    }
  }
  return null;
};

// ─── Analysis ─────────────────────────────────────────────────────────────

const normalizeTagList = (tags) => [...new Set((Array.isArray(tags) ? tags : []).map((tag) => clip(String(tag || "").toLowerCase().replace(/[^a-z0-9 \-]/g, ""), 40)).filter(Boolean))].slice(0, 10);

const normalizeAnalysis = (parsed) => ({
  caption: clip(parsed?.caption, 300),
  tags: normalizeTagList(parsed?.tags),
  scene: clip(parsed?.scene, 500),
  activity: clip(parsed?.activity, 200),
  locationHint: clip(parsed?.locationHint, 200),
  quality: (Array.isArray(parsed?.quality) ? parsed.quality : []).map((item) => ({ text: clip(typeof item === "string" ? item : item?.text, 500), severity: pick(item?.severity, SEVERITIES, "low") })).filter((item) => item.text).slice(0, 8),
  safety: (Array.isArray(parsed?.safety) ? parsed.safety : []).map((item) => ({ hazard: clip(item?.hazard || item?.text, 120), description: clip(item?.description, 1000), severity: pick(item?.severity, SEVERITIES, "medium"), confidence: pick(item?.confidence, CONFIDENCE, "medium") })).filter((item) => item.hazard).slice(0, 10),
  confidence: pick(parsed?.confidence, CONFIDENCE, "medium"),
});

const photoOut = (photo, projectId) => ({
  id: photo.id,
  documentId: photo.documentId,
  caption: photo.caption || null,
  tags: photo.tags || [],
  takenAt: toIso(photo.takenAt),
  locationId: photo.locationId || null,
  locationName: photo.location?.name || null,
  url: `/api/v1/projects/${projectId}/attachments/documents/${photo.documentId}`,
  thumbnailUrl: photo.thumbnailStatus === "ready" && photo.thumbnailKey ? `/api/v1/projects/${projectId}/photos/${photo.id}/thumbnail` : `/api/v1/projects/${projectId}/attachments/documents/${photo.documentId}`,
});

const contextBlock = async ({ projectId, photo }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId }, select: { name: true, type: true } }).catch(() => null);
  const links = prisma.attachment?.findMany ? await prisma.attachment.findMany({ where: { projectId, documentId: photo.documentId }, select: { recordType: true, recordId: true, role: true } }).catch(() => []) : [];
  return [
    `Project: ${project?.name || projectId}${project?.type ? ` (${project.type})` : ""}`,
    photo.location ? `Location on record: ${photo.location.name}${photo.location.path ? ` (${photo.location.path})` : ""}` : "Location on record: none",
    photo.takenAt ? `Taken: ${toIso(photo.takenAt)}` : "Taken: unknown",
    photo.caption ? `Current caption: ${photo.caption}` : "Current caption: none",
    photo.tags?.length ? `Current tags: ${photo.tags.join(", ")}` : "Current tags: none",
    links.length ? `Attached to: ${links.map((link) => `${link.recordType} (${link.role})`).join(", ")}` : "Attached to: nothing yet",
  ].join("\n");
};

const runMessage = (stored) => (stored?.message ? { id: stored.message.id, provider: stored.message.provider, model: stored.message.model, feedback: stored.message.feedback, createdAt: stored.message.createdAt } : null);

const parseStored = (message) => {
  try {
    return message?.content ? JSON.parse(message.content) : null;
  } catch {
    return null;
  }
};

/** The latest stored analysis of a photo, if any. */
const latestAnalysis = async ({ orgId, projectId, photoId }) => {
  const photo = await attachments.getPhoto({ orgId, projectId, photoId });
  if (!prisma.assistantConversation?.findFirst) return { photo: photoOut(photo, projectId), analysis: null, message: null, analyzedAt: null };
  const row = await prisma.assistantConversation.findFirst({ where: { orgId, kind: KIND, recordType: "photo", recordId: photoId }, orderBy: { createdAt: "desc" }, include: { messages: { where: { role: "assistant" }, orderBy: { createdAt: "desc" }, take: 1 } } });
  const message = row?.messages?.[0] || null;
  return { photo: photoOut(photo, projectId), analysis: message ? normalizeAnalysis(parseStored(message)) : null, analyzedAt: toIso(message?.createdAt || row?.createdAt), message: message ? { id: message.id, provider: message.provider, model: message.model, feedback: message.feedback, createdAt: toIso(message.createdAt) } : null };
};

/**
 * Analyses one photo. `force` re-runs even when a fresh analysis exists;
 * `store` is skipped without a user (background jobs without a requester).
 */
const analyzePhoto = async ({ orgId, projectId, photoId, user = null, transport = null, fetchImpl = null, force = false }) => {
  const photo = await attachments.getPhoto({ orgId, projectId, photoId });
  if (!force && !transport) {
    const existing = await latestAnalysis({ orgId, projectId, photoId });
    if (existing.analysis && existing.analyzedAt && Date.now() - new Date(existing.analyzedAt).getTime() < FRESH_MS) return { ...existing, degraded: false, cached: true };
  }
  const provider = aiProvider.describe();
  if (!transport && !(provider.enabled && provider.vision)) return { degraded: true, reason: provider.enabled ? "The configured AI provider does not read images (AI_VISION is off)." : "AI photo analysis is not configured on this server (set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY).", photo: photoOut(photo, projectId), analysis: null, analyzedAt: null, message: null, cached: false };
  const image = await loadImage({ orgId, projectId, photo, fetchImpl });
  if (!image) throw new HttpError(409, "PHOTO_AI_UNREADABLE", "The image could not be read (unsupported type or too large)");
  const context = await contextBlock({ projectId, photo });
  let completion;
  try {
    completion = await aiProvider.complete({ system: PHOTO_PROMPT, messages: [{ role: "user", content: [{ type: "text", text: `${context}\n\nInspect the photo and answer in JSON.` }, { type: "image", mediaType: image.mediaType, data: image.data }] }], maxTokens: 1200, temperature: 0.1, transport });
  } catch (error) {
    if (error?.code !== "AI_UNAVAILABLE" && error?.code !== "AI_NOT_CONFIGURED") throw error;
    return { degraded: true, reason: error.message, photo: photoOut(photo, projectId), analysis: null, analyzedAt: null, message: null, cached: false };
  }
  const analysis = normalizeAnalysis(aiProvider.parseJsonAnswer(completion.text));
  const stored = user?.id ? await assistant.storeRun({ orgId, user, projectId, kind: KIND, recordType: "photo", recordId: photo.id, title: `Photo: ${analysis.caption || photo.caption || photo.document?.originalName || photo.id}`, prompt: `${context}\n[image ${image.variant}, ${image.bytes} bytes]`, answer: JSON.stringify(analysis), usage: completion.usage || null, provider: completion.provider || null, model: completion.model || null }).catch(() => null) : null;
  return { degraded: false, photo: photoOut(photo, projectId), analysis, analyzedAt: new Date().toISOString(), message: runMessage(stored), cached: false, image: { variant: image.variant, bytes: image.bytes } };
};

/** Analyses several photos (the day's uncaptioned ones by default), bounded by AI_PHOTO_BATCH. */
const analyzeBatch = async ({ orgId, projectId, user, payload = {}, transport = null, fetchImpl = null }) => {
  const limit = Math.min(batchLimit(), Math.max(1, Number(payload.limit) || batchLimit()));
  const where = { projectId, orgId };
  if (Array.isArray(payload.photoIds) && payload.photoIds.length) where.id = { in: payload.photoIds.slice(0, 40) };
  else {
    if (payload.uncaptionedOnly !== false) where.caption = null;
    if (payload.from || payload.to) where.takenAt = { ...(payload.from ? { gte: new Date(payload.from) } : {}), ...(payload.to ? { lte: new Date(payload.to) } : {}) };
  }
  const rows = prisma.photo?.findMany ? await prisma.photo.findMany({ where, select: { id: true }, orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }], take: limit }) : [];
  const items = [];
  for (const row of rows) {
    try {
      const result = await analyzePhoto({ orgId, projectId, photoId: row.id, user, transport, fetchImpl, force: Boolean(payload.force) });
      items.push({ photoId: row.id, ...result });
      if (result.degraded && !result.analysis) break;
    } catch (error) {
      items.push({ photoId: row.id, degraded: true, reason: error?.message || "failed", analysis: null, photo: null, message: null });
    }
  }
  return { items, analyzed: items.filter((item) => item.analysis && !item.cached).length, cached: items.filter((item) => item.cached).length, safetyFindings: items.reduce((sum, item) => sum + (item.analysis?.safety?.length || 0), 0), limit };
};

// ─── Apply ────────────────────────────────────────────────────────────────

const applyAnalysis = async ({ orgId, projectId, photoId, payload = {}, actor = null }) => {
  const photo = await attachments.getPhoto({ orgId, projectId, photoId });
  const data = {};
  const caption = clip(payload.caption, 300);
  if (caption && (!photo.caption || payload.overwrite)) data.caption = caption;
  const tags = normalizeTagList(payload.tags);
  if (tags.length) data.tags = [...new Set([...(photo.tags || []), ...tags])].slice(0, 20);
  if (payload.locationId !== undefined && !photo.locationId) data.locationId = payload.locationId || null;
  if (!Object.keys(data).length) return { applied: {}, photo: photoOut(photo, projectId) };
  const updated = await attachments.updatePhoto({ orgId, projectId, photoId, payload: data, userId: actor?.id || null, userRole: actor?.role || null });
  return { applied: Object.fromEntries(Object.keys(data).map((key) => [key, true])), photo: { ...photoOut({ ...photo, ...updated }, projectId), caption: updated.caption ?? photo.caption ?? null, tags: updated.tags ?? photo.tags ?? [] } };
};

const PRIORITY_BY_SEVERITY = Object.freeze({ low: "low", medium: "normal", high: "high" });

/** Raises a safety observation on the punch engine from one finding, with the photo as evidence. */
const raiseObservation = async ({ orgId, projectId, photoId, payload = {}, actor = null }) => {
  const hazard = clip(payload.hazard, 120);
  if (!hazard) throw new HttpError(400, "PHOTO_AI_HAZARD_REQUIRED", "The observation needs a hazard");
  const photo = await attachments.getPhoto({ orgId, projectId, photoId });
  const punch = require("./punch.service");
  const severity = pick(payload.severity, SEVERITIES, "medium");
  const item = await punch.createPunchItem({
    orgId,
    projectId,
    payload: {
      kind: "observation",
      observationType: "safety",
      title: hazard,
      description: clip(payload.description, 4000) || `Seen on a site photo${photo.takenAt ? ` taken ${toIso(photo.takenAt).slice(0, 10)}` : ""}.`,
      hazard,
      contributingCondition: clip(payload.contributingCondition, 500),
      priority: PRIORITY_BY_SEVERITY[severity],
      locationId: payload.locationId || photo.locationId || null,
      sourceRecordType: "photo",
      sourceRecordId: photo.id,
      trade: clip(payload.trade, 80),
      assigneeCompanyId: payload.assigneeCompanyId || null,
      dueDate: payload.dueDate || null,
    },
    actor,
  });
  let attached = false;
  try {
    await attachments.createAttachments({ orgId, projectId, userId: actor?.id || null, userRole: actor?.role || null, recordType: "punch_item", recordId: item.id, role: "evidence", caption: hazard, documentIds: [photo.documentId] });
    attached = true;
  } catch {
    attached = false;
  }
  return { item: { id: item.id, ref: item.ref, kind: item.kind, status: item.status, observationType: item.observationType }, attached, url: `/projects/${projectId}/quality/observations?recordId=${item.id}` };
};

// ─── Background job ───────────────────────────────────────────────────────

const runPhotoAnalyzeJob = async ({ job, payload = {} }) => {
  const userId = payload.userId || job.requestedBy || null;
  const user = userId ? { id: userId, orgId: job.orgId, role: "system" } : null;
  return analyzePhoto({ orgId: job.orgId, projectId: job.projectId, photoId: payload.photoId, user, force: Boolean(payload.force) });
};

const status = () => {
  const provider = aiProvider.describe();
  return { enabled: Boolean(provider.enabled && provider.vision), provider: provider.provider, model: provider.model, autoOnUpload: String(process.env.AI_PHOTO_AUTO || "").toLowerCase() === "on", batchLimit: batchLimit() };
};

module.exports = { KIND, PHOTO_PROMPT, SEVERITIES, normalizeAnalysis, latestAnalysis, analyzePhoto, analyzeBatch, applyAnalysis, raiseObservation, runPhotoAnalyzeJob, status };
