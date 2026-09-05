const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const { RECORD_TYPE_MODULES } = require("./attachment.service");
const { recordWorkspacePath } = require("../utils/record-links");

/**
 * Sheet markups and pins (OCTA-DWG-MARKUP-012).
 *
 * A markup is a vector layer over a sheet. Every user has one personal layer
 * per sheet that nobody else can see; publishing it makes it a project layer
 * everyone sees. Coordinates are normalised (0..1 of the page) so a layer or
 * pin drawn on revision A still sits in the same place on revision B.
 *
 * A pin ties a point on the sheet to a record (RFI, defect, photo, …). Pins
 * can create the record on the spot (RFI, defect) or link an existing one.
 */

const VISIBILITY = Object.freeze({ PERSONAL: "personal", PUBLISHED: "published" });

const SHAPE_TYPES = new Set([
  "rect",
  "ellipse",
  "line",
  "arrow",
  "polyline",
  "cloud",
  "text",
  "measure",
  "highlight",
]);
const MAX_SHAPES = 500;
const MAX_POINTS = 2000;
const MAX_TEXT = 500;
const COLOR_PATTERN = /^#[0-9a-f]{3,8}$/i;

/** Record types a pin can point at and how they are created / displayed. */
const PIN_TARGETS = Object.freeze({
  rfi: { label: "RFI", module: "rfi", create: true },
  defect: { label: "Defect", module: "ncr", create: true },
  photo: { label: "Photo", module: "document_control", create: false },
  ncr: { label: "NCR", module: "ncr", create: false },
  submittal: { label: "Submittal", module: "submittal", create: false },
  task: { label: "Task", module: "task", create: false },
  safety_incident: { label: "Safety incident", module: "safety", create: false },
  itp: { label: "ITP", module: "ncr", create: false },
  correspondence: { label: "Correspondence", module: "document_control", create: false },
});

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => value?.toISOString?.() || value || null;

const clamp01 = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(Math.max(number, 0), 1);
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const ensureSheet = async ({ orgId, projectId, sheetId }) => {
  const sheet = await prisma.sheet.findFirst({ where: { id: sheetId, orgId, projectId } });
  if (!sheet) throw new HttpError(404, "SHEET_NOT_FOUND", "Sheet not found");
  return sheet;
};

// ─── Shapes ───────────────────────────────────────────────────────────────

const normalizePoint = (point) => {
  const x = clamp01(point?.x ?? point?.[0]);
  const y = clamp01(point?.y ?? point?.[1]);
  if (x === null || y === null) return null;
  return { x, y };
};

/**
 * Keeps only known shape types and fields, clamps coordinates to the page
 * and bounds text / point counts so a layer stays small and safe to render.
 */
const normalizeShapes = (input) => {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new HttpError(400, "MARKUP_SHAPES_INVALID", "shapes must be an array");
  if (input.length > MAX_SHAPES) {
    throw new HttpError(400, "MARKUP_TOO_MANY_SHAPES", `A layer holds at most ${MAX_SHAPES} shapes`);
  }
  const shapes = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const type = String(raw.type || "");
    if (!SHAPE_TYPES.has(type)) continue;
    const points = Array.isArray(raw.points) ? raw.points.map(normalizePoint).filter(Boolean).slice(0, MAX_POINTS) : [];
    const shape = {
      id: trimOrNull(raw.id) || `${type}-${shapes.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      color: COLOR_PATTERN.test(String(raw.color || "")) ? String(raw.color) : "#e11d48",
      strokeWidth: Math.min(Math.max(Number(raw.strokeWidth) || 2, 0.5), 20),
    };
    if (["rect", "ellipse", "highlight", "cloud", "text"].includes(type)) {
      const x = clamp01(raw.x);
      const y = clamp01(raw.y);
      const w = clamp01(raw.w ?? raw.width);
      const h = clamp01(raw.h ?? raw.height);
      if (x === null || y === null) continue;
      shape.x = x;
      shape.y = y;
      shape.w = w ?? 0;
      shape.h = h ?? 0;
    }
    if (["line", "arrow", "measure"].includes(type)) {
      if (points.length < 2) continue;
      shape.points = points.slice(0, 2);
    }
    if (type === "polyline") {
      if (points.length < 2) continue;
      shape.points = points;
    }
    if (type === "text") {
      const text = trimOrNull(raw.text);
      if (!text) continue;
      shape.text = text.slice(0, MAX_TEXT);
      shape.fontSize = Math.min(Math.max(Number(raw.fontSize) || 14, 6), 96);
    }
    if (type === "measure") {
      shape.label = trimOrNull(raw.label)?.slice(0, 80) || null;
    }
    if (raw.fill === true || raw.fill === false) shape.fill = raw.fill;
    shapes.push(shape);
  }
  return shapes;
};

const serializeMarkup = (row, viewer = null) => ({
  id: row.id,
  projectId: row.projectId,
  sheetId: row.sheetId,
  sheetRevisionId: row.sheetRevisionId || null,
  authorId: row.authorId || null,
  authorName: row.author?.name || null,
  visibility: row.visibility,
  name: row.name || null,
  shapes: Array.isArray(row.shapesJson) ? row.shapesJson : [],
  shapeCount: row.shapeCount || 0,
  publishedAt: toIso(row.publishedAt),
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  isMine: Boolean(viewer?.id) && row.authorId === viewer.id,
  canEdit: Boolean(viewer?.id) && (row.authorId === viewer.id || (row.visibility === VISIBILITY.PUBLISHED && Boolean(viewer?.canManage))),
});

const authorNames = async (rows) => {
  const ids = [...new Set(rows.map((row) => row.authorId || row.createdBy).filter(Boolean))];
  if (!ids.length || !prisma.user?.findMany) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
};

/** Published layers for everyone plus the viewer's own personal layer. */
const listMarkups = async ({ orgId, projectId, sheetId, viewer }) => {
  await ensureSheet({ orgId, projectId, sheetId });
  const rows = await prisma.markup.findMany({
    where: {
      orgId,
      projectId,
      sheetId,
      OR: [{ visibility: VISIBILITY.PUBLISHED }, ...(viewer?.id ? [{ authorId: viewer.id }] : [])],
    },
    orderBy: [{ visibility: "asc" }, { updatedAt: "desc" }],
  });
  const names = await authorNames(rows);
  return {
    items: rows.map((row) => serializeMarkup({ ...row, author: { name: names.get(row.authorId) || null } }, viewer)),
  };
};

/** The viewer's personal layer on a sheet (created empty on first use). */
const getPersonalMarkup = async ({ orgId, projectId, sheetId, viewer }) => {
  await ensureSheet({ orgId, projectId, sheetId });
  let row = await prisma.markup.findFirst({
    where: { orgId, projectId, sheetId, authorId: viewer.id, visibility: VISIBILITY.PERSONAL },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) {
    row = await prisma.markup.create({
      data: { orgId, projectId, sheetId, authorId: viewer.id, visibility: VISIBILITY.PERSONAL, shapesJson: [], shapeCount: 0 },
    });
  }
  return serializeMarkup(row, viewer);
};

const savePersonalMarkup = async ({ orgId, projectId, sheetId, viewer, shapes, name, sheetRevisionId = null }) => {
  await ensureSheet({ orgId, projectId, sheetId });
  const normalized = normalizeShapes(shapes);
  const existing = await prisma.markup.findFirst({
    where: { orgId, projectId, sheetId, authorId: viewer.id, visibility: VISIBILITY.PERSONAL },
    orderBy: { updatedAt: "desc" },
  });
  const data = {
    shapesJson: normalized,
    shapeCount: normalized.length,
    ...(name !== undefined ? { name: trimOrNull(name) } : {}),
    ...(sheetRevisionId ? { sheetRevisionId } : {}),
  };
  const row = existing
    ? await prisma.markup.update({ where: { id: existing.id }, data })
    : await prisma.markup.create({
        data: { orgId, projectId, sheetId, authorId: viewer.id, visibility: VISIBILITY.PERSONAL, ...data },
      });
  return serializeMarkup(row, viewer);
};

const findMarkup = async ({ orgId, projectId, markupId }) => {
  const row = await prisma.markup.findFirst({ where: { id: markupId, orgId, projectId } });
  if (!row) throw new HttpError(404, "MARKUP_NOT_FOUND", "Markup not found");
  return row;
};

const assertCanEdit = (row, viewer) => {
  const isAuthor = Boolean(viewer?.id) && row.authorId === viewer.id;
  if (isAuthor) return;
  if (row.visibility === VISIBILITY.PUBLISHED && viewer?.canManage) return;
  throw new HttpError(403, "MARKUP_FORBIDDEN", "Only the author can change this markup");
};

const updateMarkup = async ({ orgId, projectId, markupId, shapes, name, viewer }) => {
  const row = await findMarkup({ orgId, projectId, markupId });
  assertCanEdit(row, viewer);
  const data = {};
  if (shapes !== undefined) {
    const normalized = normalizeShapes(shapes);
    data.shapesJson = normalized;
    data.shapeCount = normalized.length;
  }
  if (name !== undefined) data.name = trimOrNull(name);
  const updated = await prisma.markup.update({ where: { id: row.id }, data });
  if (row.visibility === VISIBILITY.PUBLISHED) {
    await auditService.recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SHEET,
      entityId: row.sheetId,
      action: "markup_updated",
      actorId: viewer?.id || null,
      summary: { markupId: row.id, name: updated.name, shapes: updated.shapeCount },
    });
  }
  return serializeMarkup(updated, viewer);
};

/**
 * Makes a personal layer visible to the whole project. The author gets a
 * fresh empty personal layer on their next edit.
 */
const publishMarkup = async ({ orgId, projectId, markupId, name, viewer }) => {
  const row = await findMarkup({ orgId, projectId, markupId });
  if (row.authorId !== viewer?.id) {
    throw new HttpError(403, "MARKUP_FORBIDDEN", "Only the author can publish this markup");
  }
  if (row.visibility === VISIBILITY.PUBLISHED) return serializeMarkup(row, viewer);
  if (!row.shapeCount) throw new HttpError(400, "MARKUP_EMPTY", "Draw something before publishing");
  const now = new Date();
  const updated = await prisma.markup.update({
    where: { id: row.id },
    data: {
      visibility: VISIBILITY.PUBLISHED,
      publishedAt: now,
      name: trimOrNull(name) || row.name || `Markup ${now.toLocaleDateString("en-GB")}`,
    },
  });
  await auditService.recordEvent({
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.SHEET,
    entityId: row.sheetId,
    action: "markup_published",
    actorId: viewer.id,
    occurredAt: now,
    summary: { markupId: row.id, name: updated.name, shapes: updated.shapeCount },
  });
  return serializeMarkup(updated, viewer);
};

const deleteMarkup = async ({ orgId, projectId, markupId, viewer }) => {
  const row = await findMarkup({ orgId, projectId, markupId });
  assertCanEdit(row, viewer);
  await prisma.markup.delete({ where: { id: row.id } });
  if (row.visibility === VISIBILITY.PUBLISHED) {
    await auditService.recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SHEET,
      entityId: row.sheetId,
      action: "markup_removed",
      actorId: viewer?.id || null,
      summary: { markupId: row.id, name: row.name, shapes: row.shapeCount },
    });
  }
  return { deleted: true, id: row.id };
};

// ─── Pins ─────────────────────────────────────────────────────────────────

const pinTarget = (recordType) => {
  const target = PIN_TARGETS[recordType];
  if (!target) throw new HttpError(400, "PIN_RECORD_TYPE_INVALID", `Pins cannot point at ${recordType}`);
  return target;
};

/** Display data for the record behind a pin; tolerant of deleted records. */
const describeRecord = async ({ orgId, projectId, recordType, recordId }) => {
  if (recordType === "photo") {
    const photo = await prisma.photo.findFirst({
      where: { id: recordId, projectId },
      select: { id: true, caption: true, documentId: true, takenAt: true },
    });
    return photo
      ? {
          display: photo.caption || "Photo",
          status: null,
          exists: true,
          thumbnailUrl: `/api/v1/projects/${projectId}/photos/${photo.id}/thumbnail`,
          fileUrl: `/api/v1/projects/${projectId}/photos/${photo.id}/file`,
        }
      : { display: "Photo (removed)", status: null, exists: false };
  }
  try {
    const { loadRecord } = require("./comment.service");
    const { record, display } = await loadRecord({ orgId, projectId, recordType, recordId });
    return { display, status: record?.status || record?.result || null, exists: true, ref: record?.ref || null };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return { display: `${pinTarget(recordType).label} (removed)`, status: null, exists: false };
    }
    throw error;
  }
};

const serializePin = (row, { record = null, sheet = null } = {}) => ({
  id: row.id,
  projectId: row.projectId,
  sheetId: row.sheetId,
  sheetRevisionId: row.sheetRevisionId || null,
  x: row.x,
  y: row.y,
  recordType: row.recordType,
  recordId: row.recordId,
  recordLabel: PIN_TARGETS[row.recordType]?.label || row.recordType,
  label: row.label || null,
  color: row.color || null,
  createdBy: row.createdBy || null,
  createdByName: row.createdByName || null,
  createdAt: toIso(row.createdAt),
  record,
  recordPath:
    row.recordType === "photo"
      ? recordWorkspacePath({ projectId: row.projectId, recordType: "photo" })
      : recordWorkspacePath({ projectId: row.projectId, recordType: row.recordType, recordId: row.recordId }),
  sheet: sheet ? { id: sheet.id, number: sheet.number, title: sheet.title } : undefined,
  sheetPath: `${recordWorkspacePath({ projectId: row.projectId, recordType: "sheet", recordId: row.sheetId })}&pin=${row.id}`,
});

const listPins = async ({ orgId, projectId, sheetId }) => {
  await ensureSheet({ orgId, projectId, sheetId });
  const rows = await prisma.pin.findMany({ where: { orgId, projectId, sheetId }, orderBy: { createdAt: "asc" } });
  const names = await authorNames(rows);
  const items = [];
  for (const row of rows) {
    const record = await describeRecord({ orgId, projectId, recordType: row.recordType, recordId: row.recordId });
    items.push(serializePin({ ...row, createdByName: names.get(row.createdBy) || null }, { record }));
  }
  return { items };
};

/** Pins that reference one record, with the sheet they sit on. */
const listPinsForRecord = async ({ orgId, projectId, recordType, recordId }) => {
  await ensureProject({ orgId, projectId });
  const rows = await prisma.pin.findMany({
    where: { orgId, projectId, recordType, recordId },
    include: { sheet: { select: { id: true, number: true, title: true } } },
    orderBy: { createdAt: "asc" },
  });
  return { items: rows.map((row) => serializePin(row, { sheet: row.sheet })) };
};

const createLinkedRecord = async ({ orgId, projectId, recordType, create, sheet, revision, actor }) => {
  const origin = `Sheet ${sheet.number}${revision?.revision ? ` rev ${revision.revision}` : ""}`;
  if (recordType === "rfi") {
    const rfiService = require("./rfi.service");
    const subject = trimOrNull(create.subject) || trimOrNull(create.title);
    if (!subject) throw new HttpError(400, "PIN_SUBJECT_REQUIRED", "Give the RFI a subject");
    const row = await rfiService.createRfi({
      orgId,
      projectId,
      payload: {
        subject,
        question: [trimOrNull(create.question), `Raised from ${origin}.`].filter(Boolean).join("\n\n"),
        priority: create.priority || "normal",
        discipline: trimOrNull(create.discipline) || sheet.discipline || null,
        dueDate: create.dueDate || null,
      },
      userId: actor?.id || null,
      userRole: actor?.role || null,
      projectAccess: actor?.projectAccess || null,
    });
    return row;
  }
  if (recordType === "defect") {
    const defectService = require("./defect.service");
    const title = trimOrNull(create.title) || trimOrNull(create.subject);
    if (!title) throw new HttpError(400, "PIN_TITLE_REQUIRED", "Give the defect a title");
    return defectService.createDefect({
      orgId,
      projectId,
      payload: {
        title,
        severity: create.severity || "minor",
        trade: trimOrNull(create.trade) || null,
        location: trimOrNull(create.location) || origin,
        dueDate: create.dueDate || null,
        assigneeUserId: create.assigneeUserId || undefined,
      },
    });
  }
  throw new HttpError(400, "PIN_CREATE_UNSUPPORTED", `${pinTarget(recordType).label} records must be linked, not created here`);
};

/**
 * Drops a pin. Either `recordId` (link an existing record) or `create`
 * (make the record first: RFI or defect) must be given.
 */
const createPin = async ({
  orgId,
  projectId,
  sheetId,
  sheetRevisionId = null,
  x,
  y,
  recordType,
  recordId = null,
  create = null,
  label = null,
  color = null,
  actor,
}) => {
  const sheet = await ensureSheet({ orgId, projectId, sheetId });
  const target = pinTarget(recordType);
  const px = clamp01(x);
  const py = clamp01(y);
  if (px === null || py === null) throw new HttpError(400, "PIN_POSITION_INVALID", "x and y must be between 0 and 1");
  const revision = sheetRevisionId
    ? await prisma.sheetRevision.findFirst({ where: { id: sheetRevisionId, sheetId }, select: { id: true, revision: true } })
    : null;

  let targetId = trimOrNull(recordId);
  let created = null;
  if (!targetId) {
    if (!create) throw new HttpError(400, "PIN_TARGET_REQUIRED", "Link a record or create one");
    if (!target.create) throw new HttpError(400, "PIN_CREATE_UNSUPPORTED", `${target.label} records must be linked, not created here`);
    created = await createLinkedRecord({ orgId, projectId, recordType, create, sheet, revision, actor });
    targetId = created.id;
  }
  const record = await describeRecord({ orgId, projectId, recordType, recordId: targetId });
  if (!record.exists) throw new HttpError(404, "PIN_RECORD_NOT_FOUND", `${target.label} not found on this project`);

  const row = await prisma.pin.create({
    data: {
      orgId,
      projectId,
      sheetId,
      sheetRevisionId: revision?.id || null,
      x: px,
      y: py,
      recordType,
      recordId: targetId,
      label: trimOrNull(label)?.slice(0, 80) || null,
      color: COLOR_PATTERN.test(String(color || "")) ? color : null,
      createdBy: actor?.id || null,
    },
  });

  await auditService.recordEvent({
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.SHEET,
    entityId: sheetId,
    action: "pin_added",
    actorId: actor?.id || null,
    summary: { pinId: row.id, recordType, recordId: targetId, display: record.display, created: Boolean(created), x: px, y: py },
  });

  // Leave a trace on the record so its own history says where it came from.
  if (recordType !== "photo" && actor?.id) {
    try {
      const { createComment } = require("./comment.service");
      await createComment({
        orgId,
        projectId,
        recordType,
        recordId: targetId,
        body: `${created ? "Raised" : "Pinned"} on sheet ${sheet.number}${revision?.revision ? ` rev ${revision.revision}` : ""}.`,
        actor: { id: actor.id, name: actor.name || null },
      });
    } catch (error) {
      console.error("[pin] record note failed", error?.message || error);
    }
  }

  return { pin: serializePin(row, { record }), created: created ? { id: created.id, ref: created.ref || null } : null };
};

const deletePin = async ({ orgId, projectId, pinId, actor }) => {
  const row = await prisma.pin.findFirst({ where: { id: pinId, orgId, projectId } });
  if (!row) throw new HttpError(404, "PIN_NOT_FOUND", "Pin not found");
  if (row.createdBy !== actor?.id && !actor?.canManage) {
    throw new HttpError(403, "PIN_FORBIDDEN", "Only the person who dropped the pin or a document controller can remove it");
  }
  await prisma.pin.delete({ where: { id: row.id } });
  await auditService.recordEvent({
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.SHEET,
    entityId: row.sheetId,
    action: "pin_removed",
    actorId: actor?.id || null,
    summary: { pinId: row.id, recordType: row.recordType, recordId: row.recordId },
  });
  return { deleted: true, id: row.id };
};

const moduleForPinTarget = (recordType) => pinTarget(recordType).module || RECORD_TYPE_MODULES[recordType] || "document_control";

module.exports = {
  MAX_SHAPES,
  PIN_TARGETS,
  SHAPE_TYPES,
  VISIBILITY,
  createPin,
  deleteMarkup,
  deletePin,
  describeRecord,
  getPersonalMarkup,
  listMarkups,
  listPins,
  listPinsForRecord,
  moduleForPinTarget,
  normalizeShapes,
  publishMarkup,
  savePersonalMarkup,
  serializeMarkup,
  serializePin,
  updateMarkup,
};
