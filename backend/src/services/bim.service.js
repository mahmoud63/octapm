const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { brandWorkbook } = require("../utils/export-branding");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { recordWorkspacePath } = require("../utils/record-links");
const { parseIfcFile } = require("../parsers/ifc-parser");
const { JobError } = require("../jobs/errors");
const jobService = require("../jobs/job.service");
const fileStorageService = require("./file-storage.service");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");

/**
 * BIM models (OCTA-BIM-IFC-043).
 *
 * An IFC file is uploaded, parsed in the background (see parsers/ifc-parser)
 * and stored as a spatial breakdown plus one row per element with its type,
 * material, property sets and base quantities. Elements are then **linked to
 * the rest of the project** — an activity (which is what makes 4D possible on
 * the activity-linked spine), a location, a BOQ item or an issue — one by one
 * or in bulk from a filter.
 *
 * Geometry is deliberately not evaluated: no triangles are produced and no
 * viewer ships with this card. What a QS, planner or engineer needs from a
 * model — what is in it, where, how much of it, and what work it belongs to —
 * is all here.
 */

const STATUS = Object.freeze({ PROCESSING: "processing", READY: "ready", FAILED: "failed" });
const DISCIPLINES = Object.freeze(["architectural", "structural", "mechanical", "electrical", "plumbing", "civil", "coordination", "other"]);
const RELATION_TYPES = Object.freeze(["represents", "affects", "reference"]);
/** Record types an element may be tied to. Every one of these tables is project-scoped. */
const LINK_RECORD_MODELS = Object.freeze({
  activity: "activity",
  location: "location",
  boq_item: "boqItem",
  punch_item: "punchItem",
  observation: "punchItem",
  rfi: "rfi",
  ncr: "ncrRecord",
});
const LINK_RECORD_TYPES = Object.freeze(Object.keys(LINK_RECORD_MODELS));
const QUANTITY_FIELDS = Object.freeze(["netVolume", "grossVolume", "netArea", "grossArea", "length", "width", "height", "perimeter", "weight", "quantityCount"]);
const ELEMENT_PAGE = 100;
const INSERT_CHUNK = 500;
const BULK_LINK_LIMIT = 5000;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const round3 = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null);
const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];
const maxBytes = () => Math.max(1, Number.parseInt(process.env.BIM_MAX_BYTES || "", 10) || 300 * 1024 * 1024);
const maxElements = () => Math.max(1000, Number.parseInt(process.env.BIM_MAX_ELEMENTS || "", 10) || 250_000);

/** `IFCBUILDINGELEMENTPROXY` → `Building element proxy`. */
const typeLabel = (ifcType) => {
  const body = String(ifcType || "").replace(/^IFC/, "").toLowerCase();
  return body ? body.charAt(0).toUpperCase() + body.slice(1) : ifcType;
};

// ─── Serialisers ──────────────────────────────────────────────────────────

const modelOut = (row, { detail = false } = {}) => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  discipline: row.discipline || null,
  documentId: row.documentId || null,
  fileName: row.sourceDocument?.originalName || row.sourceDocument?.fileName || null,
  fileSize: row.sourceDocument?.sizeBytes ?? null,
  schema: row.ifcSchema || null,
  status: row.status,
  version: row.version,
  isCurrent: row.isCurrent,
  supersededById: row.supersededById || null,
  ifcProjectName: row.ifcProjectName || null,
  siteName: row.siteName || null,
  buildingName: row.buildingName || null,
  units: row.unitsJson || {},
  header: detail ? row.headerJson || {} : undefined,
  spatial: detail ? row.spatialJson || [] : undefined,
  typeSummary: detail ? row.typeSummaryJson || [] : undefined,
  warnings: row.warningsJson || [],
  elementCount: row.elementCount,
  entityCount: row.entityCount,
  storeyCount: row.storeyCount,
  linkedCount: row.linkedCount,
  parsedAt: toIso(row.parsedAt),
  jobId: row.jobId || null,
  error: row.error || null,
  notes: row.notes || null,
  path: recordWorkspacePath({ projectId: row.projectId, recordType: "bim_model", recordId: row.id }),
  uploadedBy: row.uploadedBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const elementOut = (row, { detail = false, links = null } = {}) => ({
  id: row.id,
  modelId: row.modelId,
  globalId: row.globalId,
  ifcType: row.ifcType,
  typeLabel: typeLabel(row.ifcType),
  name: row.name || null,
  description: detail ? row.description || null : undefined,
  objectType: row.objectType || null,
  predefinedType: row.predefinedType || null,
  tag: row.tag || null,
  typeName: row.typeName || null,
  storeyName: row.storeyName || null,
  storeyGlobalId: row.storeyGlobalId || null,
  elevation: row.elevation ?? null,
  spatialPath: row.spatialPath || null,
  materials: Array.isArray(row.materialsJson) ? row.materialsJson : [],
  properties: detail ? row.propertiesJson || {} : undefined,
  quantities: QUANTITY_FIELDS.reduce((memo, field) => {
    if (row[field] !== null && row[field] !== undefined) memo[field === "quantityCount" ? "count" : field] = round3(row[field]);
    return memo;
  }, {}),
  linkCount: row.linkCount ?? 0,
  links: links ? links.map(linkOut) : undefined,
  createdAt: toIso(row.createdAt),
});

const linkOut = (row) => ({
  id: row.id,
  modelId: row.modelId,
  elementId: row.elementId,
  element: row.element ? { id: row.element.id, globalId: row.element.globalId, ifcType: row.element.ifcType, name: row.element.name || null, tag: row.element.tag || null, storeyName: row.element.storeyName || null } : undefined,
  recordType: row.recordType,
  recordId: row.recordId,
  recordTitle: row.recordTitle || null,
  recordPath: recordWorkspacePath({ projectId: row.projectId, recordType: row.recordType, recordId: row.recordId }),
  relationType: row.relationType,
  notes: row.notes || null,
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
});

// ─── Loading ──────────────────────────────────────────────────────────────

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const modelInclude = { sourceDocument: { select: { id: true, fileName: true, originalName: true, sizeBytes: true } } };

const load = async ({ orgId, projectId, modelId, tx = prisma }) => {
  const row = await tx.bimModel.findFirst({ where: { id: modelId, orgId, projectId }, include: modelInclude });
  if (!row) throw new HttpError(404, "BIM_MODEL_NOT_FOUND", "Model not found");
  return row;
};

/** The title of a linked record, without guessing at any one table's column names. */
const recordTitleOf = (row) => {
  if (!row) return null;
  const reference = row.ref || row.activityCode || row.itemCode || row.code || row.wbsCode || row.number || null;
  const name = row.name || row.title || row.subject || row.description || null;
  return [reference, name].filter(Boolean).join(" ").trim() || row.id;
};

const loadLinkedRecord = async ({ projectId, recordType, recordId }) => {
  const model = LINK_RECORD_MODELS[recordType];
  if (!model || !prisma[model]?.findFirst) throw new HttpError(400, "BIM_LINK_RECORD_TYPE_INVALID", `Elements can be linked to: ${LINK_RECORD_TYPES.join(", ")}`);
  const row = await prisma[model].findFirst({ where: { id: recordId, projectId } });
  if (!row) throw new HttpError(404, "BIM_LINK_RECORD_NOT_FOUND", "That record is not on this project");
  return row;
};

/** Titles for a page of links, one query per record type. */
const decorateLinks = async ({ links }) => {
  const byType = new Map();
  for (const link of links) {
    if (!byType.has(link.recordType)) byType.set(link.recordType, new Set());
    byType.get(link.recordType).add(link.recordId);
  }
  const titles = new Map();
  for (const [recordType, ids] of byType) {
    const model = LINK_RECORD_MODELS[recordType];
    if (!model || !prisma[model]?.findMany) continue;
    const rows = await prisma[model].findMany({ where: { id: { in: [...ids] } } }).catch(() => []);
    for (const row of rows) titles.set(`${recordType}:${row.id}`, recordTitleOf(row));
  }
  return links.map((link) => ({ ...link, recordTitle: titles.get(`${link.recordType}:${link.recordId}`) || null }));
};

// ─── Upload and parse ─────────────────────────────────────────────────────

const nextVersion = async ({ projectId, name }) => {
  const previous = await prisma.bimModel.aggregate({ where: { projectId, name }, _max: { version: true } });
  return (previous._max.version || 0) + 1;
};

const createModel = async ({ orgId, projectId, userId = null, file, payload = {} }) => {
  await ensureProject({ orgId, projectId });
  if (!file) throw new HttpError(400, "NO_FILE", "Upload the model as an IFC file");
  const discipline = trimOrNull(payload.discipline);
  if (discipline && !DISCIPLINES.includes(discipline)) throw new HttpError(400, "BIM_DISCIPLINE_INVALID", `Discipline must be one of ${DISCIPLINES.join(", ")}`);

  const document = await fileStorageService.uploadProjectDocument({
    orgId,
    projectId,
    userId,
    file,
    documentType: fileStorageService.DOCUMENT_TYPES.BIM_MODEL,
    linkedEntityType: "bim_model",
  });

  const name = trimOrNull(payload.name) || document.originalName?.replace(/\.ifc$/i, "") || document.fileName;
  const version = await nextVersion({ projectId, name });
  const created = await prisma.$transaction(async (tx) => {
    // A new version of the same model supersedes the one the team was using.
    const previous = await tx.bimModel.findFirst({ where: { projectId, name, isCurrent: true } });
    const row = await tx.bimModel.create({
      data: { orgId, projectId, name, discipline, documentId: document.id, status: STATUS.PROCESSING, version, isCurrent: true, notes: trimOrNull(payload.notes), uploadedBy: userId },
    });
    if (previous) await tx.bimModel.update({ where: { id: previous.id }, data: { isCurrent: false, supersededById: row.id } });
    return row;
  });

  const job = await jobService.enqueueJob({ orgId, projectId, type: jobService.JOB_TYPES.BIM_PARSE, payload: { modelId: created.id }, requestedBy: userId });
  await prisma.bimModel.update({ where: { id: created.id }, data: { jobId: job.id } });
  await fileStorageService.markDocumentLinked({ documentId: document.id, entityType: "bim_model", entityId: created.id }).catch(() => null);
  await auditService.recordEvent({ orgId, projectId, entityType: "bim_model", entityId: created.id, action: auditService.ACTIONS.CREATED, actorId: userId, summary: { name, version, discipline, fileName: document.fileName, sizeBytes: document.sizeBytes } }).catch(() => null);
  return modelOut({ ...created, jobId: job.id, sourceDocument: document });
};

/** Runs `fn` with a readable local path, downloading from object storage when needed. */
const withLocalFile = async ({ orgId, projectId, documentId }, fn) => {
  const file = await fileStorageService.getBimModelFile({ orgId, projectId, key: documentId });
  if (file?.path) return fn(file.path);
  if (!file?.redirectUrl) throw new JobError("BIM_FILE_UNAVAILABLE", "The model file could not be read", { retryable: true });
  const target = path.join(fileStorageService.ensureTempUploadDirSync(), `${crypto.randomUUID()}.ifc`);
  const response = await fetch(file.redirectUrl);
  if (!response.ok) throw new JobError("BIM_FILE_UNAVAILABLE", `Object storage answered ${response.status}`, { retryable: true });
  await fsp.writeFile(target, Buffer.from(await response.arrayBuffer()));
  try {
    return await fn(target);
  } finally {
    await fsp.unlink(target).catch(() => null);
  }
};

const summarizeTypes = (elements) => {
  const byType = new Map();
  for (const element of elements) {
    const entry = byType.get(element.ifcType) || { ifcType: element.ifcType, label: typeLabel(element.ifcType), count: 0, netVolume: 0, netArea: 0 };
    entry.count += 1;
    entry.netVolume += element.quantities?.netVolume || 0;
    entry.netArea += element.quantities?.netArea || element.quantities?.grossArea || 0;
    byType.set(element.ifcType, entry);
  }
  return [...byType.values()]
    .map((entry) => ({ ...entry, netVolume: round3(entry.netVolume) || 0, netArea: round3(entry.netArea) || 0 }))
    .sort((a, b) => b.count - a.count);
};

const elementRow = ({ orgId, projectId, modelId, element }) => ({
  orgId,
  projectId,
  modelId,
  globalId: element.globalId || crypto.randomUUID(),
  ifcType: element.ifcType,
  name: element.name || element.longName || null,
  description: element.description || null,
  objectType: element.objectType || null,
  predefinedType: element.predefinedType || null,
  tag: element.tag || null,
  typeName: element.typeName || null,
  storeyName: element.storeyName || null,
  storeyGlobalId: element.storeyGlobalId || null,
  elevation: element.elevation ?? null,
  spatialPath: element.spatialPath || null,
  materialsJson: element.materials || [],
  propertiesJson: element.properties || {},
  netVolume: element.quantities?.netVolume ?? null,
  grossVolume: element.quantities?.grossVolume ?? null,
  netArea: element.quantities?.netArea ?? null,
  grossArea: element.quantities?.grossArea ?? null,
  length: element.quantities?.length ?? null,
  width: element.quantities?.width ?? null,
  height: element.quantities?.height ?? null,
  perimeter: element.quantities?.perimeter ?? null,
  weight: element.quantities?.weight ?? null,
  quantityCount: element.quantities?.count ?? null,
  searchText: [element.name, element.longName, element.tag, element.typeName, typeLabel(element.ifcType), element.objectType, element.storeyName, (element.materials || []).join(" ")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .slice(0, 1000),
});

const runBimParseJob = async ({ job, payload = {}, updateProgress = async () => {} }) => {
  const model = await prisma.bimModel.findFirst({ where: { id: payload.modelId, orgId: job.orgId } });
  if (!model) throw new JobError("BIM_MODEL_NOT_FOUND", "The model no longer exists", { retryable: false });
  if (!model.documentId) throw new JobError("BIM_MODEL_NO_SOURCE", "The model has no uploaded file", { retryable: false });

  try {
    await updateProgress({ step: "read", progress: 5 });
    const parsed = await withLocalFile({ orgId: model.orgId, projectId: model.projectId, documentId: model.documentId }, (file) =>
      parseIfcFile(file, {
        maxBytes: maxBytes(),
        maxEntities: maxElements() * 4,
        onProgress: (read, total) => {
          const ratio = total ? Math.min(0.7, read / total) : 0;
          updateProgress({ step: "read", progress: 5 + Math.round(ratio * 65) }).catch(() => null);
        },
      }),
    );

    await updateProgress({ step: "store", progress: 75 });
    const warnings = [...(parsed.warnings || [])];
    let elements = parsed.elements;
    if (elements.length > maxElements()) {
      warnings.push(`Only the first ${maxElements().toLocaleString("en")} elements were stored.`);
      elements = elements.slice(0, maxElements());
    }
    // Two elements can share a GlobalId in a badly exported file; the last wins.
    const rows = [...new Map(elements.map((element) => [element.globalId || crypto.randomUUID(), elementRow({ orgId: model.orgId, projectId: model.projectId, modelId: model.id, element })])).values()];

    await prisma.$transaction(async (tx) => {
      await tx.bimElement.deleteMany({ where: { modelId: model.id } });
      for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
        await tx.bimElement.createMany({ data: rows.slice(index, index + INSERT_CHUNK) });
      }
      await tx.bimModel.update({
        where: { id: model.id },
        data: {
          status: STATUS.READY,
          ifcSchema: parsed.schema || null,
          ifcProjectName: parsed.project?.name || null,
          siteName: parsed.site?.name || null,
          buildingName: parsed.building?.name || null,
          unitsJson: parsed.units || {},
          headerJson: parsed.header || {},
          spatialJson: parsed.spatial || [],
          typeSummaryJson: summarizeTypes(elements),
          warningsJson: warnings,
          elementCount: rows.length,
          entityCount: parsed.entityCount || 0,
          storeyCount: (parsed.spatial || []).filter((node) => node.ifcType === "IFCBUILDINGSTOREY").length,
          parsedAt: new Date(),
          error: null,
        },
      });
    });

    await updateProgress({ step: "done", progress: 100 });
    await auditService.recordEvent({ orgId: model.orgId, projectId: model.projectId, entityType: "bim_model", entityId: model.id, action: auditService.ACTIONS.IMPORTED, actorId: model.uploadedBy, summary: { elements: rows.length, schema: parsed.schema, storeys: (parsed.spatial || []).filter((node) => node.ifcType === "IFCBUILDINGSTOREY").length } }).catch(() => null);
    if (model.uploadedBy) {
      await notificationService
        .createNotifications({
          orgId: model.orgId,
          projectId: model.projectId,
          recipientUserIds: [model.uploadedBy],
          type: "bim_model",
          category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
          event: "bim.ready",
          title: `${model.name} is ready`,
          message: `${rows.length.toLocaleString("en")} elements read from the ${parsed.schema || "IFC"} model.`,
          priority: "low",
          actionUrl: recordWorkspacePath({ projectId: model.projectId, recordType: "bim_model", recordId: model.id }),
          entityType: "bim_model",
          entityId: model.id,
          dedupeKeyBase: `bim:${model.id}:ready`,
          metadata: { elements: rows.length },
        })
        .catch(() => null);
    }
    return { elements: rows.length, schema: parsed.schema };
  } catch (error) {
    const code = error?.code || "BIM_PARSE_FAILED";
    await prisma.bimModel
      .update({ where: { id: model.id }, data: { status: STATUS.FAILED, error: error?.message || "The model could not be read" } })
      .catch(() => null);
    if (error instanceof JobError) throw error;
    throw new JobError(code, error?.message || "The model could not be read", { retryable: false });
  }
};

// ─── Models ───────────────────────────────────────────────────────────────

const listModels = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });
  const where = { orgId, projectId };
  if (query.status) where.status = query.status;
  if (query.discipline) where.discipline = query.discipline;
  if (query.current === "true" || query.current === true) where.isCurrent = true;
  const rows = await prisma.bimModel.findMany({ where, include: modelInclude, orderBy: [{ isCurrent: "desc" }, { createdAt: "desc" }] });
  const items = rows.map((row) => modelOut(row));
  return {
    items,
    summary: {
      count: items.length,
      current: items.filter((item) => item.isCurrent).length,
      elements: items.filter((item) => item.isCurrent).reduce((sum, item) => sum + item.elementCount, 0),
      linked: items.filter((item) => item.isCurrent).reduce((sum, item) => sum + item.linkedCount, 0),
      byStatus: Object.fromEntries(Object.values(STATUS).map((status) => [status, items.filter((item) => item.status === status).length])),
    },
  };
};

const getModel = async ({ orgId, projectId, modelId }) => {
  await ensureProject({ orgId, projectId });
  return modelOut(await load({ orgId, projectId, modelId }), { detail: true });
};

const updateModel = async ({ orgId, projectId, modelId, payload = {}, actor = null }) => {
  const existing = await load({ orgId, projectId, modelId });
  const data = {};
  if (payload.name !== undefined) {
    const name = trimOrNull(payload.name);
    if (!name) throw new HttpError(400, "BIM_NAME_REQUIRED", "Name the model");
    data.name = name;
  }
  if (payload.discipline !== undefined) {
    const discipline = trimOrNull(payload.discipline);
    if (discipline && !DISCIPLINES.includes(discipline)) throw new HttpError(400, "BIM_DISCIPLINE_INVALID", `Discipline must be one of ${DISCIPLINES.join(", ")}`);
    data.discipline = discipline;
  }
  if (payload.notes !== undefined) data.notes = trimOrNull(payload.notes);
  if (Object.keys(data).length) {
    await prisma.bimModel.update({ where: { id: modelId }, data });
    await auditService.recordEvent({ orgId, projectId, entityType: "bim_model", entityId: modelId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { ...data, previousName: existing.name } }).catch(() => null);
  }
  return getModel({ orgId, projectId, modelId });
};

const reparseModel = async ({ orgId, projectId, modelId, actor = null }) => {
  const existing = await load({ orgId, projectId, modelId });
  if (!existing.documentId) throw new HttpError(409, "BIM_MODEL_NO_SOURCE", "This model has no uploaded file to read again");
  const job = await jobService.enqueueJob({ orgId, projectId, type: jobService.JOB_TYPES.BIM_PARSE, payload: { modelId }, requestedBy: actor?.id || null });
  await prisma.bimModel.update({ where: { id: modelId }, data: { status: STATUS.PROCESSING, jobId: job.id, error: null } });
  return getModel({ orgId, projectId, modelId });
};

const deleteModel = async ({ orgId, projectId, modelId, actor = null }) => {
  const existing = await load({ orgId, projectId, modelId });
  await prisma.bimModel.delete({ where: { id: modelId } });
  // `supersededById` is a plain pointer, so clear the ones that named this model.
  await prisma.bimModel.updateMany({ where: { supersededById: modelId }, data: { supersededById: null } }).catch(() => null);
  // The model this one superseded becomes current again.
  const predecessor = await prisma.bimModel.findFirst({ where: { projectId, name: existing.name, supersededById: null, isCurrent: false }, orderBy: { version: "desc" } });
  if (predecessor) await prisma.bimModel.update({ where: { id: predecessor.id }, data: { isCurrent: true } });
  await auditService.recordEvent({ orgId, projectId, entityType: "bim_model", entityId: modelId, action: auditService.ACTIONS.DELETED, actorId: actor?.id || null, summary: { name: existing.name, version: existing.version } }).catch(() => null);
  return { deleted: true };
};

/** The spatial breakdown as a tree, with the element count on every node. */
const spatialTree = async ({ orgId, projectId, modelId }) => {
  await ensureProject({ orgId, projectId });
  const model = await load({ orgId, projectId, modelId });
  const nodes = (model.spatialJson || []).map((node) => ({ ...node, children: [] }));
  const byGlobalId = new Map(nodes.map((node) => [node.globalId, node]));
  const roots = [];
  for (const node of nodes) {
    const parent = node.parentGlobalId ? byGlobalId.get(node.parentGlobalId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortTree = (list) => {
    list.sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0) || String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }));
    list.forEach((node) => sortTree(node.children));
  };
  sortTree(roots);
  return { items: roots, storeys: nodes.filter((node) => node.ifcType === "IFCBUILDINGSTOREY").map(({ children, ...node }) => node) };
};

// ─── Elements ─────────────────────────────────────────────────────────────

const elementWhere = ({ modelId, query = {} }) => {
  const where = { modelId };
  if (query.ifcType) where.ifcType = String(query.ifcType).toUpperCase();
  if (query.storeyGlobalId) where.storeyGlobalId = query.storeyGlobalId;
  if (query.typeName) where.typeName = query.typeName;
  const text = trimOrNull(query.q);
  if (text) where.searchText = { contains: text.toLowerCase() };
  if (query.linked === "true" || query.linked === true) where.linkCount = { gt: 0 };
  if (query.linked === "false" || query.linked === false) where.linkCount = 0;
  return where;
};

const listElements = async ({ orgId, projectId, modelId, query = {} }) => {
  await ensureProject({ orgId, projectId });
  await load({ orgId, projectId, modelId });
  const take = Math.min(Math.max(Number(query.limit) || ELEMENT_PAGE, 1), 500);
  const where = elementWhere({ modelId, query });
  const cursor = trimOrNull(query.cursor);
  const [rows, total] = await Promise.all([
    prisma.bimElement.findMany({ where, orderBy: [{ ifcType: "asc" }, { name: "asc" }, { id: "asc" }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
    prisma.bimElement.count({ where }),
  ]);
  const hasMore = rows.length > take;
  const page = rows.slice(0, take);
  return { items: page.map((row) => elementOut(row)), nextCursor: hasMore ? page[page.length - 1].id : null, total };
};

const getElement = async ({ orgId, projectId, modelId, elementId }) => {
  await ensureProject({ orgId, projectId });
  const row = await prisma.bimElement.findFirst({ where: { id: elementId, modelId, projectId }, include: { links: { orderBy: { createdAt: "asc" } } } });
  if (!row) throw new HttpError(404, "BIM_ELEMENT_NOT_FOUND", "Element not found");
  const links = await decorateLinks({ links: row.links });
  return elementOut(row, { detail: true, links });
};

/** Totals by IFC type or by storey, over whatever filter the caller is looking at. */
const quantitySummary = async ({ orgId, projectId, modelId, query = {} }) => {
  await ensureProject({ orgId, projectId });
  const model = await load({ orgId, projectId, modelId });
  const groupBy = query.groupBy === "storey" ? "storey" : "type";
  const where = elementWhere({ modelId, query });
  const rows = await prisma.bimElement.groupBy({
    by: groupBy === "storey" ? ["storeyGlobalId", "storeyName"] : ["ifcType"],
    where,
    _count: { _all: true },
    _sum: { netVolume: true, grossVolume: true, netArea: true, grossArea: true, length: true, weight: true, quantityCount: true },
  });
  const items = rows
    .map((row) => ({
      key: groupBy === "storey" ? row.storeyGlobalId || "unassigned" : row.ifcType,
      label: groupBy === "storey" ? row.storeyName || "Not on a storey" : typeLabel(row.ifcType),
      ifcType: groupBy === "type" ? row.ifcType : null,
      storeyGlobalId: groupBy === "storey" ? row.storeyGlobalId || null : null,
      elements: row._count._all,
      netVolume: round3(row._sum.netVolume) || 0,
      grossVolume: round3(row._sum.grossVolume) || 0,
      netArea: round3(row._sum.netArea) || 0,
      grossArea: round3(row._sum.grossArea) || 0,
      length: round3(row._sum.length) || 0,
      weight: round3(row._sum.weight) || 0,
      count: round3(row._sum.quantityCount) || 0,
    }))
    .sort((a, b) => b.elements - a.elements);
  return {
    groupBy,
    units: model.unitsJson || {},
    items,
    totals: {
      elements: items.reduce((sum, item) => sum + item.elements, 0),
      netVolume: round3(items.reduce((sum, item) => sum + item.netVolume, 0)) || 0,
      netArea: round3(items.reduce((sum, item) => sum + item.netArea, 0)) || 0,
      weight: round3(items.reduce((sum, item) => sum + item.weight, 0)) || 0,
    },
  };
};

// ─── Links ────────────────────────────────────────────────────────────────

const refreshCounts = async ({ tx = prisma, modelId, elementIds = [] }) => {
  for (const elementId of uniqueIds(elementIds)) {
    const linkCount = await tx.bimElementLink.count({ where: { elementId } });
    await tx.bimElement.update({ where: { id: elementId }, data: { linkCount } });
  }
  const linkedCount = await tx.bimElement.count({ where: { modelId, linkCount: { gt: 0 } } });
  await tx.bimModel.update({ where: { id: modelId }, data: { linkedCount } });
  return linkedCount;
};

/**
 * Links elements to one record. `elementIds` names them; `filter` links every
 * element the filter matches (up to 5 000) so a planner can tie a whole
 * storey's walls to one activity in a single action.
 */
const createLinks = async ({ orgId, projectId, modelId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  await load({ orgId, projectId, modelId });
  const recordType = trimOrNull(payload.recordType);
  const recordId = trimOrNull(payload.recordId);
  if (!recordType || !recordId) throw new HttpError(400, "BIM_LINK_RECORD_REQUIRED", "Choose the record to link to");
  const record = await loadLinkedRecord({ projectId, recordType, recordId });
  const relationType = trimOrNull(payload.relationType) || "represents";
  if (!RELATION_TYPES.includes(relationType)) throw new HttpError(400, "BIM_LINK_RELATION_INVALID", `Relation must be one of ${RELATION_TYPES.join(", ")}`);

  let elements = [];
  if (payload.filter && typeof payload.filter === "object") {
    elements = await prisma.bimElement.findMany({ where: elementWhere({ modelId, query: payload.filter }), select: { id: true }, take: BULK_LINK_LIMIT });
  } else {
    const ids = uniqueIds(payload.elementIds);
    if (!ids.length) throw new HttpError(400, "BIM_LINK_ELEMENTS_REQUIRED", "Choose at least one element");
    if (ids.length > BULK_LINK_LIMIT) throw new HttpError(400, "BIM_LINK_TOO_MANY", `At most ${BULK_LINK_LIMIT} elements at a time`);
    elements = await prisma.bimElement.findMany({ where: { id: { in: ids }, modelId }, select: { id: true } });
    if (elements.length !== ids.length) throw new HttpError(400, "BIM_ELEMENT_INVALID", "Some of those elements are not in this model");
  }
  if (!elements.length) throw new HttpError(400, "BIM_LINK_ELEMENTS_REQUIRED", "Nothing matches that filter");

  const elementIds = elements.map((element) => element.id);
  const existing = await prisma.bimElementLink.findMany({ where: { elementId: { in: elementIds }, recordType, recordId }, select: { elementId: true } });
  const already = new Set(existing.map((link) => link.elementId));
  const fresh = elementIds.filter((id) => !already.has(id));

  await prisma.$transaction(async (tx) => {
    if (fresh.length) {
      await tx.bimElementLink.createMany({
        data: fresh.map((elementId) => ({ orgId, projectId, modelId, elementId, recordType, recordId, relationType, notes: trimOrNull(payload.notes), createdBy: actor?.id || null })),
      });
    }
    await refreshCounts({ tx, modelId, elementIds });
  });

  await auditService
    .recordEvent({ orgId, projectId, entityType: "bim_model", entityId: modelId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { linked: fresh.length, alreadyLinked: already.size, recordType, recordId, record: recordTitleOf(record) } })
    .catch(() => null);
  return { linked: fresh.length, alreadyLinked: already.size, recordType, recordId, recordTitle: recordTitleOf(record) };
};

const listLinks = async ({ orgId, projectId, modelId, query = {} }) => {
  await ensureProject({ orgId, projectId });
  await load({ orgId, projectId, modelId });
  const where = { modelId };
  if (query.recordType) where.recordType = query.recordType;
  if (query.recordId) where.recordId = query.recordId;
  const rows = await prisma.bimElementLink.findMany({ where, include: { element: { select: { id: true, globalId: true, ifcType: true, name: true, tag: true, storeyName: true } } }, orderBy: { createdAt: "desc" }, take: 1000 });
  const links = await decorateLinks({ links: rows });
  const byRecord = new Map();
  for (const link of links) {
    const key = `${link.recordType}:${link.recordId}`;
    const entry = byRecord.get(key) || { recordType: link.recordType, recordId: link.recordId, recordTitle: link.recordTitle, recordPath: recordWorkspacePath({ projectId, recordType: link.recordType, recordId: link.recordId }), elements: 0 };
    entry.elements += 1;
    byRecord.set(key, entry);
  }
  return { items: links.map(linkOut), records: [...byRecord.values()].sort((a, b) => b.elements - a.elements) };
};

const deleteLink = async ({ orgId, projectId, modelId, linkId, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const link = await prisma.bimElementLink.findFirst({ where: { id: linkId, modelId, projectId } });
  if (!link) throw new HttpError(404, "BIM_LINK_NOT_FOUND", "Link not found");
  await prisma.$transaction(async (tx) => {
    await tx.bimElementLink.delete({ where: { id: linkId } });
    await refreshCounts({ tx, modelId, elementIds: [link.elementId] });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "bim_model", entityId: modelId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { unlinked: 1, recordType: link.recordType, recordId: link.recordId } }).catch(() => null);
  return { deleted: true };
};

/** Every model element tied to one record — used by the schedule and the registers. */
const elementsForRecord = async ({ orgId, projectId, recordType, recordId }) => {
  await ensureProject({ orgId, projectId });
  const rows = await prisma.bimElementLink.findMany({
    where: { projectId, orgId, recordType, recordId },
    include: { element: { select: { id: true, globalId: true, ifcType: true, name: true, tag: true, storeyName: true, netVolume: true, netArea: true } }, model: { select: { id: true, name: true, isCurrent: true } } },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });
  return {
    items: rows.map((row) => ({
      linkId: row.id,
      modelId: row.modelId,
      modelName: row.model?.name || null,
      relationType: row.relationType,
      element: row.element ? { ...row.element, typeLabel: typeLabel(row.element.ifcType), netVolume: round3(row.element.netVolume), netArea: round3(row.element.netArea) } : null,
    })),
    totals: {
      elements: rows.length,
      netVolume: round3(rows.reduce((sum, row) => sum + (row.element?.netVolume || 0), 0)) || 0,
      netArea: round3(rows.reduce((sum, row) => sum + (row.element?.netArea || 0), 0)) || 0,
    },
  };
};

// ─── Export ───────────────────────────────────────────────────────────────

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };

const styleHeader = (sheet, columns) => {
  sheet.columns = columns;
  const row = sheet.getRow(1);
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  row.height = 24;
};

const exportElements = async ({ orgId, projectId, modelId, query = {} }) => {
  await ensureProject({ orgId, projectId });
  const model = await load({ orgId, projectId, modelId });
  const where = elementWhere({ modelId, query });
  const [elements, links] = await Promise.all([
    prisma.bimElement.findMany({ where, orderBy: [{ storeyName: "asc" }, { ifcType: "asc" }, { name: "asc" }], take: 50_000 }),
    prisma.bimElementLink.findMany({ where: { modelId }, take: 20_000 }),
  ]);
  const decorated = await decorateLinks({ links });
  const linksByElement = new Map();
  for (const link of decorated) {
    if (!linksByElement.has(link.elementId)) linksByElement.set(link.elementId, []);
    linksByElement.get(link.elementId).push(`${link.recordType}: ${link.recordTitle || link.recordId}`);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OctaPM";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Elements");
  styleHeader(sheet, [
    { header: "Global ID", key: "globalId", width: 24 },
    { header: "Type", key: "typeLabel", width: 18 },
    { header: "Name", key: "name", width: 38 },
    { header: "Type name", key: "typeName", width: 24 },
    { header: "Tag", key: "tag", width: 12 },
    { header: "Storey", key: "storeyName", width: 16 },
    { header: "Location", key: "spatialPath", width: 30 },
    { header: "Materials", key: "materials", width: 26 },
    { header: `Net volume (${model.unitsJson?.volume || "m³"})`, key: "netVolume", width: 14 },
    { header: `Net area (${model.unitsJson?.area || "m²"})`, key: "netArea", width: 14 },
    { header: `Length (${model.unitsJson?.length || "mm"})`, key: "length", width: 14 },
    { header: "Count", key: "quantityCount", width: 10 },
    { header: "Linked to", key: "links", width: 40 },
  ]);
  elements.forEach((element) => {
    sheet.addRow({
      globalId: element.globalId,
      typeLabel: typeLabel(element.ifcType),
      name: element.name || "",
      typeName: element.typeName || "",
      tag: element.tag || "",
      storeyName: element.storeyName || "",
      spatialPath: element.spatialPath || "",
      materials: (Array.isArray(element.materialsJson) ? element.materialsJson : []).join(", "),
      netVolume: round3(element.netVolume) ?? "",
      netArea: round3(element.netArea) ?? "",
      length: round3(element.length) ?? "",
      quantityCount: round3(element.quantityCount) ?? "",
      links: (linksByElement.get(element.id) || []).join("; "),
    });
  });

  const summary = await quantitySummary({ orgId, projectId, modelId, query });
  const totals = workbook.addWorksheet("Quantities by type");
  styleHeader(totals, [
    { header: "Type", key: "label", width: 24 },
    { header: "Elements", key: "elements", width: 12 },
    { header: `Net volume (${model.unitsJson?.volume || "m³"})`, key: "netVolume", width: 16 },
    { header: `Net area (${model.unitsJson?.area || "m²"})`, key: "netArea", width: 16 },
    { header: `Length (${model.unitsJson?.length || "mm"})`, key: "length", width: 14 },
  ]);
  summary.items.forEach((item) => totals.addRow(item));

  const about = workbook.addWorksheet("About");
  about.getColumn(1).width = 22;
  about.getColumn(2).width = 60;
  [
    ["Model", `${model.name} (v${model.version})`],
    ["IFC schema", model.ifcSchema || "—"],
    ["Authoring tool", model.headerJson?.originatingSystem || model.headerJson?.preprocessor || "—"],
    ["IFC project", model.ifcProjectName || "—"],
    ["Site / building", [model.siteName, model.buildingName].filter(Boolean).join(" / ") || "—"],
    ["Units", Object.entries(model.unitsJson || {}).map(([key, value]) => `${key}: ${value}`).join(", ") || "—"],
    ["Elements exported", String(elements.length)],
    ["Exported", new Date().toISOString()],
  ].forEach((pair) => about.addRow(pair));

  brandWorkbook(workbook, { title: `BIM elements — ${model.name}` });
  return { workbook, filename: `${String(model.name).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}-elements.xlsx` };
};

module.exports = {
  STATUS,
  DISCIPLINES,
  RELATION_TYPES,
  LINK_RECORD_TYPES,
  typeLabel,
  createModel,
  runBimParseJob,
  listModels,
  getModel,
  updateModel,
  reparseModel,
  deleteModel,
  spatialTree,
  listElements,
  getElement,
  quantitySummary,
  createLinks,
  listLinks,
  deleteLink,
  elementsForRecord,
  exportElements,
};
