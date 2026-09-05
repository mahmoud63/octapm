const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { JobError } = require("../jobs/errors");
const jobService = require("../jobs/job.service");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const fileStorageService = require("./file-storage.service");
const documentTextService = require("./document-text.service");
const { pdfPages } = require("../utils/document-text");
const {
  detectSheetMetadata,
  disciplineFor,
  normalizeNumber,
  sortKeyFor,
} = require("../utils/sheet-title-detect");
const { recordWorkspacePath } = require("../utils/record-links");

/**
 * Drawings tool (OCTA-DWG-CORE-011): DrawingSet → Sheet → SheetRevision.
 *
 * A set is one multi-page PDF. The `drawing.set_process` job reads every
 * page's text layer, detects number / title / revision / discipline with a
 * confidence, and creates one pending SheetRevision per page. Reviewers fix
 * the grid, then publish: each revision lands on its Sheet (matched by
 * number), the previous current revision is superseded, and the site sees
 * only current sheets. Single sheets can also be revised one at a time.
 */

const SET_STATUS = Object.freeze({
  DRAFT: "draft",
  PROCESSING: "processing",
  REVIEW: "review",
  PUBLISHED: "published",
  ARCHIVED: "archived",
  FAILED: "failed",
});

const REVISION_STATUS = Object.freeze({
  PENDING: "pending_review",
  PUBLISHED: "published",
  SUPERSEDED: "superseded",
  REJECTED: "rejected",
});

const SHEET_STATUS = Object.freeze({ CURRENT: "current", OBSOLETE: "obsolete" });

const SET_PURPOSES = ["IFC", "IFT", "IFA", "AS_BUILT", "TENDER", "SHOP", "RECORD", "OTHER"];
const MAX_PAGES = 1500;
const DETECTED_THRESHOLD = 0.5;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => value?.toISOString?.() || value || null;

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const documentUrl = (projectId, documentId) =>
  documentId ? `/api/v1/projects/${projectId}/attachments/documents/${documentId}` : null;

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, name: true },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const ensureSet = async ({ orgId, projectId, setId, include = undefined }) => {
  const set = await prisma.drawingSet.findFirst({
    where: { id: setId, orgId, projectId },
    include,
  });
  if (!set) throw new HttpError(404, "DRAWING_SET_NOT_FOUND", "Drawing set not found");
  return set;
};

const ensureSheet = async ({ orgId, projectId, sheetId, include = undefined }) => {
  const sheet = await prisma.sheet.findFirst({
    where: { id: sheetId, orgId, projectId },
    include,
  });
  if (!sheet) throw new HttpError(404, "SHEET_NOT_FOUND", "Sheet not found");
  return sheet;
};

// ─── Serializers ──────────────────────────────────────────────────────────

const serializeRevision = (revision) => {
  if (!revision) return null;
  const projectId = revision.projectId;
  return {
    id: revision.id,
    projectId,
    sheetId: revision.sheetId || null,
    setId: revision.setId || null,
    documentId: revision.documentId,
    pageNumber: revision.pageNumber,
    number: revision.number || null,
    title: revision.title || null,
    revision: revision.revision || null,
    discipline: revision.discipline || null,
    status: revision.status,
    detected: {
      number: revision.detectedNumber || null,
      title: revision.detectedTitle || null,
      revision: revision.detectedRevision || null,
      discipline: revision.detectedDiscipline || null,
    },
    confidence: Number(revision.confidence || 0),
    fields: revision.confidenceJson || null,
    textStatus: revision.textStatus || "none",
    width: revision.widthPt ?? null,
    height: revision.heightPt ?? null,
    rotation: revision.rotation || 0,
    reviewedBy: revision.reviewedBy || null,
    reviewedAt: toIso(revision.reviewedAt),
    publishedBy: revision.publishedBy || null,
    publishedAt: toIso(revision.publishedAt),
    supersededById: revision.supersededById || null,
    supersededAt: toIso(revision.supersededAt),
    createdBy: revision.createdBy || null,
    createdAt: toIso(revision.createdAt),
    updatedAt: toIso(revision.updatedAt),
    fileUrl: documentUrl(projectId, revision.documentId),
    fileName: revision.document?.fileName || null,
    sizeBytes: revision.document?.sizeBytes ?? null,
    path: revision.sheetId
      ? recordWorkspacePath({ projectId, recordType: "sheet", recordId: revision.sheetId })
      : revision.setId
        ? recordWorkspacePath({ projectId, recordType: "drawing_set", recordId: revision.setId })
        : null,
  };
};

const serializeSheet = (sheet, { currentRevision = null } = {}) => ({
  id: sheet.id,
  projectId: sheet.projectId,
  number: sheet.number,
  title: sheet.title,
  discipline: sheet.discipline || null,
  locationId: sheet.locationId || null,
  location: sheet.location
    ? { id: sheet.location.id, name: sheet.location.name, code: sheet.location.code || null, path: sheet.location.path }
    : null,
  status: sheet.status,
  obsoleteReason: sheet.obsoleteReason || null,
  scaleRatio: sheet.scaleRatio ?? null,
  currentRevisionId: sheet.currentRevisionId || null,
  currentRevision: currentRevision ? serializeRevision(currentRevision) : null,
  revisionCount: sheet._count?.revisions ?? (Array.isArray(sheet.revisions) ? sheet.revisions.length : undefined),
  drawingRecordId: sheet.drawingRecordId || null,
  hasFile: Boolean(currentRevision || sheet.currentRevisionId),
  path: recordWorkspacePath({ projectId: sheet.projectId, recordType: "sheet", recordId: sheet.id }),
  createdAt: toIso(sheet.createdAt),
  updatedAt: toIso(sheet.updatedAt),
});

const serializeSet = (set, { revisions = null, counts = null } = {}) => ({
  id: set.id,
  projectId: set.projectId,
  setNumber: set.setNumber,
  name: set.name,
  description: set.description || null,
  discipline: set.discipline || null,
  purpose: set.purpose || null,
  status: set.status,
  sourceDocumentId: set.sourceDocumentId || null,
  fileUrl: documentUrl(set.projectId, set.sourceDocumentId),
  fileName: set.sourceDocument?.fileName || null,
  sizeBytes: set.sourceDocument?.sizeBytes ?? null,
  pageCount: set.pageCount ?? null,
  processedPages: set.processedPages || 0,
  progress:
    set.status === SET_STATUS.PROCESSING && set.pageCount
      ? Math.min(100, Math.round((100 * (set.processedPages || 0)) / set.pageCount))
      : set.status === SET_STATUS.PROCESSING
        ? 0
        : 100,
  detectionSummary: set.detectionSummaryJson || null,
  counts: counts || null,
  receivedAt: toIso(set.receivedAt),
  issuedAt: toIso(set.issuedAt),
  uploadedBy: set.uploadedBy || null,
  publishedAt: toIso(set.publishedAt),
  publishedBy: set.publishedBy || null,
  jobId: set.jobId || null,
  error: set.error || null,
  path: recordWorkspacePath({ projectId: set.projectId, recordType: "drawing_set", recordId: set.id }),
  revisions: revisions ? revisions.map(serializeRevision) : undefined,
  createdAt: toIso(set.createdAt),
  updatedAt: toIso(set.updatedAt),
});

const revisionCountsForSets = async ({ projectId, setIds }) => {
  if (!setIds.length || !prisma.sheetRevision?.groupBy) return new Map();
  const groups = await prisma.sheetRevision.groupBy({
    by: ["setId", "status"],
    where: { projectId, setId: { in: setIds } },
    _count: { _all: true },
  });
  const map = new Map();
  for (const group of groups) {
    const entry = map.get(group.setId) || { total: 0, pending: 0, published: 0, superseded: 0, rejected: 0 };
    const count = group._count?._all ?? 0;
    entry.total += count;
    if (group.status === REVISION_STATUS.PENDING) entry.pending += count;
    else if (group.status === REVISION_STATUS.PUBLISHED) entry.published += count;
    else if (group.status === REVISION_STATUS.SUPERSEDED) entry.superseded += count;
    else if (group.status === REVISION_STATUS.REJECTED) entry.rejected += count;
    map.set(group.setId, entry);
  }
  return map;
};

// ─── Sets ─────────────────────────────────────────────────────────────────

const nextSetNumber = async ({ projectId, offset = 0 }) => {
  const count = await prisma.drawingSet.count({ where: { projectId } });
  return `SET-${String(count + 1 + offset).padStart(3, "0")}`;
};

const normalizeSetPayload = (payload = {}) => {
  const purpose = trimOrNull(payload.purpose)?.toUpperCase() || null;
  if (purpose && !SET_PURPOSES.includes(purpose)) {
    throw new HttpError(400, "DRAWING_SET_PURPOSE_INVALID", `Purpose must be one of ${SET_PURPOSES.join(", ")}`);
  }
  return {
    name: trimOrNull(payload.name),
    description: trimOrNull(payload.description),
    discipline: trimOrNull(payload.discipline),
    purpose,
    receivedAt: toDate(payload.receivedAt),
    issuedAt: toDate(payload.issuedAt),
  };
};

const listSets = async ({ orgId, projectId, status = null }) => {
  await ensureProject({ orgId, projectId });
  const where = { orgId, projectId };
  if (status && status !== "all") where.status = status;
  else if (!status) where.status = { not: SET_STATUS.ARCHIVED };
  const sets = await prisma.drawingSet.findMany({
    where,
    include: { sourceDocument: { select: { fileName: true, sizeBytes: true } } },
    orderBy: [{ createdAt: "desc" }],
  });
  const counts = await revisionCountsForSets({ projectId, setIds: sets.map((set) => set.id) });
  return {
    items: sets.map((set) => serializeSet(set, { counts: counts.get(set.id) || null })),
  };
};

const getSet = async ({ orgId, projectId, setId }) => {
  const set = await ensureSet({
    orgId,
    projectId,
    setId,
    include: {
      sourceDocument: { select: { fileName: true, sizeBytes: true } },
      revisions: {
        orderBy: { pageNumber: "asc" },
        include: { document: { select: { fileName: true, sizeBytes: true } } },
      },
    },
  });
  const counts = await revisionCountsForSets({ projectId, setIds: [set.id] });
  return serializeSet(set, { revisions: set.revisions, counts: counts.get(set.id) || null });
};

const enqueueSetJob = async ({ orgId, projectId, setId, requestedBy }) => {
  const job = await jobService.enqueueJob({
    orgId,
    projectId,
    type: jobService.JOB_TYPES.DRAWING_SET_PROCESS,
    payload: { setId },
    requestedBy: requestedBy || null,
  });
  await prisma.drawingSet.update({
    where: { id: setId },
    data: { jobId: job.id, status: SET_STATUS.PROCESSING, processedPages: 0, error: null },
  });
  return job;
};

const createSet = async ({ orgId, projectId, userId = null, file, payload = {} }) => {
  await ensureProject({ orgId, projectId });
  if (!file) throw new HttpError(400, "NO_FILE", "Upload the drawing set as a PDF");
  const fields = normalizeSetPayload(payload);

  const document = await fileStorageService.uploadProjectDocument({
    orgId,
    projectId,
    userId,
    file,
    documentType: fileStorageService.DOCUMENT_TYPES.DRAWING_SET,
    linkedEntityType: "drawing_set",
  });

  let set = null;
  for (let attempt = 0; attempt < 3 && !set; attempt += 1) {
    try {
      set = await prisma.drawingSet.create({
        data: {
          orgId,
          projectId,
          setNumber: await nextSetNumber({ projectId, offset: attempt }),
          name: fields.name || document.originalName || document.fileName,
          description: fields.description,
          discipline: fields.discipline,
          purpose: fields.purpose,
          status: SET_STATUS.PROCESSING,
          sourceDocumentId: document.id,
          receivedAt: fields.receivedAt,
          issuedAt: fields.issuedAt,
          uploadedBy: userId,
        },
      });
    } catch (error) {
      if (error?.code !== "P2002" || attempt === 2) throw error;
    }
  }

  const job = await enqueueSetJob({ orgId, projectId, setId: set.id, requestedBy: userId });
  await auditService.recordEvent({
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.DRAWING_SET,
    entityId: set.id,
    action: auditService.ACTIONS.CREATED,
    actorId: userId,
    newStatus: SET_STATUS.PROCESSING,
    summary: { setNumber: set.setNumber, name: set.name, fileName: document.fileName, sizeBytes: document.sizeBytes },
  });

  return serializeSet({ ...set, jobId: job.id, sourceDocument: document });
};

const updateSet = async ({ orgId, projectId, setId, payload = {}, userId = null }) => {
  const set = await ensureSet({ orgId, projectId, setId });
  const fields = normalizeSetPayload(payload);
  const data = {};
  if (payload.name !== undefined) data.name = fields.name || set.name;
  if (payload.description !== undefined) data.description = fields.description;
  if (payload.discipline !== undefined) data.discipline = fields.discipline;
  if (payload.purpose !== undefined) data.purpose = fields.purpose;
  if (payload.receivedAt !== undefined) data.receivedAt = fields.receivedAt;
  if (payload.issuedAt !== undefined) data.issuedAt = fields.issuedAt;
  if (payload.status !== undefined) {
    if (![SET_STATUS.ARCHIVED, SET_STATUS.REVIEW, SET_STATUS.PUBLISHED].includes(payload.status)) {
      throw new HttpError(400, "DRAWING_SET_STATUS_INVALID", "Status can be archived, review or published");
    }
    if (set.status === SET_STATUS.PROCESSING) {
      throw new HttpError(409, "DRAWING_SET_PROCESSING", "Wait for processing to finish");
    }
    data.status = payload.status;
  }
  const updated = await prisma.drawingSet.update({ where: { id: set.id }, data });
  await auditService.recordEvent({
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.DRAWING_SET,
    entityId: set.id,
    action: data.status && data.status !== set.status ? auditService.ACTIONS.STATUS_CHANGED : auditService.ACTIONS.UPDATED,
    actorId: userId,
    oldStatus: set.status,
    newStatus: updated.status,
    oldSummary: { name: set.name, discipline: set.discipline, purpose: set.purpose },
    newSummary: { name: updated.name, discipline: updated.discipline, purpose: updated.purpose },
  });
  return serializeSet(updated);
};

const deleteSet = async ({ orgId, projectId, setId, userId = null }) => {
  const set = await ensureSet({ orgId, projectId, setId });
  const published = await prisma.sheetRevision.count({
    where: { setId: set.id, status: { in: [REVISION_STATUS.PUBLISHED, REVISION_STATUS.SUPERSEDED] } },
  });
  if (published > 0) {
    throw new HttpError(409, "DRAWING_SET_HAS_PUBLISHED_SHEETS", "Archive the set instead: some sheets were published from it");
  }
  await prisma.$transaction(async (tx) => {
    await tx.sheetRevision.deleteMany({ where: { setId: set.id } });
    await tx.drawingSet.delete({ where: { id: set.id } });
  });
  await auditService.recordEvent({
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.DRAWING_SET,
    entityId: set.id,
    action: auditService.ACTIONS.DELETED,
    actorId: userId,
    oldStatus: set.status,
    oldSummary: { setNumber: set.setNumber, name: set.name },
  });
  return { deleted: true, id: set.id };
};

const reprocessSet = async ({ orgId, projectId, setId, userId = null }) => {
  const set = await ensureSet({ orgId, projectId, setId });
  if (set.status === SET_STATUS.PROCESSING) {
    throw new HttpError(409, "DRAWING_SET_PROCESSING", "The set is already being processed");
  }
  if (!set.sourceDocumentId) {
    throw new HttpError(409, "DRAWING_SET_NO_SOURCE", "The set has no source PDF");
  }
  await prisma.sheetRevision.deleteMany({ where: { setId: set.id, status: REVISION_STATUS.PENDING } });
  const job = await enqueueSetJob({ orgId, projectId, setId: set.id, requestedBy: userId });
  return { queued: true, jobId: job.id, setId: set.id };
};

// ─── Processing job ───────────────────────────────────────────────────────

const failSet = async (setId, reason) => {
  await prisma.drawingSet.update({
    where: { id: setId },
    data: { status: SET_STATUS.FAILED, error: String(reason || "processing_failed").slice(0, 500) },
  });
};

/** Records the failure reason on the set, then raises a non-retryable job error. */
const failAndThrow = async (setId, reason, code, message) => {
  await failSet(setId, reason);
  const error = new JobError(code, message, { retryable: false });
  error.failureRecorded = true;
  throw error;
};

const runDrawingSetJob = async ({ job, payload = {}, updateProgress = async () => {} }) => {
  const set = await prisma.drawingSet.findFirst({
    where: { id: payload.setId, orgId: job.orgId },
    include: { sourceDocument: true },
  });
  if (!set) throw new JobError("DRAWING_SET_NOT_FOUND", "Drawing set no longer exists", { retryable: false });
  if (!set.sourceDocument) {
    await failAndThrow(set.id, "missing_source", "DRAWING_SET_NO_SOURCE", "The set has no source PDF");
  }

  try {
    await updateProgress({ step: "load", progress: 5 });
    const isPdf =
      /pdf/i.test(set.sourceDocument.mimeType || "") ||
      /\.pdf$/i.test(set.sourceDocument.fileName || set.sourceDocument.originalName || "");
    if (!isPdf) {
      await failAndThrow(set.id, "not_pdf", "DRAWING_SET_NOT_PDF", "Drawing sets must be PDF files");
    }
    const buffer = await documentTextService.readDocumentBytes(set.sourceDocument);
    await updateProgress({ step: "parse", progress: 10 });
    const parsed = pdfPages(buffer);
    if (parsed.encrypted) {
      await failAndThrow(set.id, "encrypted", "DRAWING_SET_ENCRYPTED", "The PDF is encrypted");
    }
    if (!parsed.pageCount) {
      await failAndThrow(set.id, "no_pages", "DRAWING_SET_NO_PAGES", "No pages were found in the PDF");
    }
    if (parsed.pageCount > MAX_PAGES) {
      await failAndThrow(set.id, "too_many_pages", "DRAWING_SET_TOO_LARGE", `Sets are limited to ${MAX_PAGES} pages`);
    }

    await prisma.drawingSet.update({
      where: { id: set.id },
      data: { pageCount: parsed.pageCount, processedPages: 0, error: null },
    });

    // Pages already published from this set keep their revision rows.
    const existing = await prisma.sheetRevision.findMany({
      where: { setId: set.id },
      select: { pageNumber: true, status: true },
    });
    const keep = new Set(
      existing.filter((row) => row.status !== REVISION_STATUS.PENDING).map((row) => row.pageNumber),
    );

    let detected = 0;
    let noText = 0;
    for (const page of parsed.pages) {
      if (!keep.has(page.pageNumber)) {
        const meta = detectSheetMetadata(page.text, {
          pageNumber: page.pageNumber,
          fallbackDiscipline: set.discipline,
        });
        if (meta.textStatus === "no_text") noText += 1;
        if (meta.fields.number.confidence >= DETECTED_THRESHOLD) detected += 1;
        const working = {
          number: meta.number,
          title: meta.title,
          revision: meta.revision,
          discipline: meta.discipline,
          detectedNumber: meta.number,
          detectedTitle: meta.title,
          detectedRevision: meta.revision,
          detectedDiscipline: meta.discipline,
          confidence: meta.confidence,
          confidenceJson: meta.fields,
          textStatus: meta.textStatus,
          widthPt: page.width,
          heightPt: page.height,
          rotation: page.rotation,
          status: REVISION_STATUS.PENDING,
        };
        await prisma.sheetRevision.upsert({
          where: { setId_pageNumber: { setId: set.id, pageNumber: page.pageNumber } },
          create: {
            orgId: set.orgId,
            projectId: set.projectId,
            setId: set.id,
            documentId: set.sourceDocumentId,
            pageNumber: page.pageNumber,
            createdBy: set.uploadedBy,
            ...working,
          },
          update: working,
        });
      }
      if (page.pageNumber % 10 === 0 || page.pageNumber === parsed.pageCount) {
        await updateProgress({
          step: "detect",
          progress: 10 + Math.round((85 * page.pageNumber) / parsed.pageCount),
          processed: page.pageNumber,
          total: parsed.pageCount,
        });
        await prisma.drawingSet.update({
          where: { id: set.id },
          data: { processedPages: page.pageNumber },
        });
      }
    }

    const summary = {
      pages: parsed.pageCount,
      detected,
      needsReview: Math.max(parsed.pageCount - keep.size - detected, 0),
      noText,
      kept: keep.size,
    };
    await prisma.drawingSet.update({
      where: { id: set.id },
      data: {
        status: SET_STATUS.REVIEW,
        processedPages: parsed.pageCount,
        detectionSummaryJson: summary,
        error: null,
      },
    });
    await auditService.recordEvent({
      orgId: set.orgId,
      projectId: set.projectId,
      entityType: auditService.ENTITY_TYPES.DRAWING_SET,
      entityId: set.id,
      action: auditService.ACTIONS.STATUS_CHANGED,
      oldStatus: SET_STATUS.PROCESSING,
      newStatus: SET_STATUS.REVIEW,
      summary: { setNumber: set.setNumber, ...summary },
    });
    await updateProgress({ step: "done", progress: 100 });
    return { setId: set.id, ...summary };
  } catch (error) {
    const alreadyRecorded = Boolean(error?.failureRecorded);
    const transient = error instanceof JobError && error.retryable;
    if (!alreadyRecorded && !transient) {
      await failSet(set.id, error?.code || error?.message).catch(() => {});
    }
    throw error;
  }
};

// ─── Review and publish ───────────────────────────────────────────────────

const reviewRevisions = async ({ orgId, projectId, setId, updates = [], userId = null }) => {
  const set = await ensureSet({ orgId, projectId, setId });
  if (set.status === SET_STATUS.PROCESSING) {
    throw new HttpError(409, "DRAWING_SET_PROCESSING", "Wait for processing to finish");
  }
  const ids = updates.map((update) => update.id).filter(Boolean);
  const rows = await prisma.sheetRevision.findMany({ where: { id: { in: ids }, setId: set.id } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new HttpError(404, "SHEET_REVISION_NOT_FOUND", `Unknown revision(s): ${missing.join(", ")}`);
  }

  const now = new Date();
  const results = [];
  for (const update of updates) {
    const row = byId.get(update.id);
    if (row.status !== REVISION_STATUS.PENDING && row.status !== REVISION_STATUS.REJECTED) {
      throw new HttpError(409, "SHEET_REVISION_NOT_EDITABLE", `Revision ${row.pageNumber} is ${row.status}`);
    }
    const data = { reviewedBy: userId, reviewedAt: now };
    if (update.number !== undefined) data.number = normalizeNumber(update.number) || null;
    if (update.title !== undefined) data.title = trimOrNull(update.title);
    if (update.revision !== undefined) data.revision = trimOrNull(update.revision)?.toUpperCase() || null;
    if (update.discipline !== undefined) {
      data.discipline = trimOrNull(update.discipline) || (data.number ? disciplineFor(data.number) : null);
    } else if (data.number && !row.discipline) {
      data.discipline = disciplineFor(data.number);
    }
    if (update.status !== undefined) {
      if (![REVISION_STATUS.PENDING, REVISION_STATUS.REJECTED].includes(update.status)) {
        throw new HttpError(400, "SHEET_REVISION_STATUS_INVALID", "Status can be pending_review or rejected");
      }
      data.status = update.status;
    }
    results.push(await prisma.sheetRevision.update({ where: { id: row.id }, data }));
  }
  return { items: results.map(serializeRevision) };
};

/**
 * Publishes pending revisions: finds/creates the Sheet by number, supersedes
 * the current revision, and makes the new one current. All or nothing.
 */
const publishRevisions = async ({ orgId, projectId, revisionIds = [], userId = null }) => {
  const ids = [...new Set(revisionIds.filter(Boolean))];
  if (!ids.length) throw new HttpError(400, "SHEET_REVISIONS_REQUIRED", "Choose at least one revision");
  const revisions = await prisma.sheetRevision.findMany({ where: { id: { in: ids }, orgId, projectId } });
  if (revisions.length !== ids.length) {
    throw new HttpError(404, "SHEET_REVISION_NOT_FOUND", "One or more revisions were not found");
  }

  const seen = new Map();
  for (const revision of revisions) {
    if (revision.status !== REVISION_STATUS.PENDING) {
      throw new HttpError(409, "SHEET_REVISION_NOT_PENDING", `Page ${revision.pageNumber} is already ${revision.status}`);
    }
    const number = normalizeNumber(revision.number);
    if (!number) {
      throw new HttpError(400, "SHEET_NUMBER_REQUIRED", `Page ${revision.pageNumber} needs a sheet number before publishing`);
    }
    if (seen.has(number)) {
      throw new HttpError(
        400,
        "SHEET_NUMBER_DUPLICATE",
        `Sheet ${number} appears on pages ${seen.get(number)} and ${revision.pageNumber}`,
      );
    }
    seen.set(number, revision.pageNumber);
  }

  const now = new Date();
  const results = [];
  await prisma.$transaction(async (tx) => {
    for (const revision of revisions) {
      const number = normalizeNumber(revision.number);
      const title = trimOrNull(revision.title) || `Sheet ${number}`;
      const revisionLabel = trimOrNull(revision.revision)?.toUpperCase() || "0";
      const discipline = trimOrNull(revision.discipline) || disciplineFor(number);

      let sheet = await tx.sheet.findFirst({ where: { projectId, number } });
      if (!sheet) {
        sheet = await tx.sheet.create({
          data: {
            orgId,
            projectId,
            number,
            title,
            discipline,
            status: SHEET_STATUS.CURRENT,
            sortKey: sortKeyFor(number),
          },
        });
      }
      const previous = sheet.currentRevisionId
        ? await tx.sheetRevision.findFirst({ where: { id: sheet.currentRevisionId } })
        : null;

      const published = await tx.sheetRevision.update({
        where: { id: revision.id },
        data: {
          sheetId: sheet.id,
          number,
          title,
          revision: revisionLabel,
          discipline: discipline || sheet.discipline,
          status: REVISION_STATUS.PUBLISHED,
          publishedAt: now,
          publishedBy: userId,
        },
      });
      if (previous && previous.id !== revision.id) {
        await tx.sheetRevision.update({
          where: { id: previous.id },
          data: { status: REVISION_STATUS.SUPERSEDED, supersededById: revision.id, supersededAt: now },
        });
      }
      await tx.sheet.update({
        where: { id: sheet.id },
        data: {
          currentRevisionId: revision.id,
          title,
          discipline: published.discipline || sheet.discipline,
          status: SHEET_STATUS.CURRENT,
          obsoleteReason: null,
        },
      });

      await auditService.recordEvent({
        tx,
        orgId,
        projectId,
        entityType: auditService.ENTITY_TYPES.SHEET_REVISION,
        entityId: revision.id,
        action: "published",
        actorId: userId,
        occurredAt: now,
        oldStatus: REVISION_STATUS.PENDING,
        newStatus: REVISION_STATUS.PUBLISHED,
        summary: {
          number,
          title,
          revision: revisionLabel,
          sheetId: sheet.id,
          setId: revision.setId,
          pageNumber: revision.pageNumber,
          supersededRevisionId: previous && previous.id !== revision.id ? previous.id : null,
        },
      });
      if (previous && previous.id !== revision.id) {
        await auditService.recordEvent({
          tx,
          orgId,
          projectId,
          entityType: auditService.ENTITY_TYPES.SHEET_REVISION,
          entityId: previous.id,
          action: auditService.ACTIONS.SUPERSEDED,
          actorId: userId,
          occurredAt: now,
          oldStatus: previous.status,
          newStatus: REVISION_STATUS.SUPERSEDED,
          summary: { number, revision: previous.revision, supersededById: revision.id, sheetId: sheet.id },
        });
      }
      results.push({
        sheetId: sheet.id,
        number,
        title,
        revisionId: revision.id,
        revision: revisionLabel,
        supersededRevisionId: previous && previous.id !== revision.id ? previous.id : null,
        isNewSheet: !previous,
      });
    }
  });
  return results;
};

const notifySetPublished = async ({ orgId, projectId, set, results, actorId }) => {
  let followerIds = [];
  try {
    const { listSubscribers } = require("./comment.service");
    const subscribers = await listSubscribers({ orgId, projectId, recordType: "drawing_set", recordId: set.id });
    followerIds = subscribers.map((row) => row.userId);
  } catch (error) {
    console.error("[drawing-set] follower lookup failed", error?.message || error);
  }
  const numbers = results.map((row) => row.number);
  const preview = numbers.slice(0, 6).join(", ") + (numbers.length > 6 ? ` +${numbers.length - 6} more` : "");
  return notificationService.createNotifications({
    orgId,
    projectId,
    actorId,
    recipientUserIds: followerIds,
    recipientRoles: ["pm", "planning_eng", "site_engineer"],
    type: "drawing",
    category: notificationService.NOTIFICATION_CATEGORIES.WORKFLOW,
    event: "drawing_set.published",
    title: `Drawing set ${set.setNumber} published`,
    message: `${results.length} sheet${results.length === 1 ? "" : "s"} now current in ${set.name}: ${preview}`,
    priority: "normal",
    actionUrl: recordWorkspacePath({ projectId, recordType: "drawing_set", recordId: set.id }),
    entityType: "drawing_set",
    entityId: set.id,
    dedupeKeyBase: `drawing_set:${set.id}:published:${Date.now()}`,
    metadata: { setNumber: set.setNumber, published: results.length, numbers: numbers.slice(0, 50) },
  });
};

const publishSet = async ({ orgId, projectId, setId, revisionIds = null, userId = null }) => {
  const set = await ensureSet({ orgId, projectId, setId });
  if (![SET_STATUS.REVIEW, SET_STATUS.PUBLISHED].includes(set.status)) {
    throw new HttpError(409, "DRAWING_SET_NOT_REVIEWABLE", `The set is ${set.status}; it must finish processing first`);
  }
  const pending = await prisma.sheetRevision.findMany({
    where: {
      setId: set.id,
      status: REVISION_STATUS.PENDING,
      ...(revisionIds?.length ? { id: { in: revisionIds } } : {}),
    },
    orderBy: { pageNumber: "asc" },
  });
  const ready = pending.filter((row) => normalizeNumber(row.number));
  const skipped = pending.length - ready.length;
  if (!ready.length) {
    throw new HttpError(400, "DRAWING_SET_NOTHING_TO_PUBLISH", "No reviewed pages with a sheet number to publish");
  }

  const results = await publishRevisions({ orgId, projectId, revisionIds: ready.map((row) => row.id), userId });
  const remaining = await prisma.sheetRevision.count({ where: { setId: set.id, status: REVISION_STATUS.PENDING } });
  const now = new Date();
  const updated = await prisma.drawingSet.update({
    where: { id: set.id },
    data: {
      status: remaining ? SET_STATUS.REVIEW : SET_STATUS.PUBLISHED,
      publishedAt: set.publishedAt || now,
      publishedBy: set.publishedBy || userId,
    },
  });
  await auditService.recordEvent({
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.DRAWING_SET,
    entityId: set.id,
    action: "published",
    actorId: userId,
    occurredAt: now,
    oldStatus: set.status,
    newStatus: updated.status,
    summary: { setNumber: set.setNumber, published: results.length, skipped, remaining },
  });
  await notifySetPublished({ orgId, projectId, set, results, actorId: userId });

  return { published: results.length, skipped, remaining, results, set: serializeSet(updated) };
};

// ─── Sheets ───────────────────────────────────────────────────────────────

const currentRevisionsFor = async (sheets) => {
  const ids = sheets.map((sheet) => sheet.currentRevisionId).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await prisma.sheetRevision.findMany({
    where: { id: { in: ids } },
    include: { document: { select: { fileName: true, sizeBytes: true } } },
  });
  return new Map(rows.map((row) => [row.id, row]));
};

const listSheets = async ({ orgId, projectId, filters = {} }) => {
  await ensureProject({ orgId, projectId });
  const where = { orgId, projectId };
  const status = filters.status || "current";
  if (status === SHEET_STATUS.CURRENT) where.status = SHEET_STATUS.CURRENT;
  else if (status === SHEET_STATUS.OBSOLETE) where.status = SHEET_STATUS.OBSOLETE;
  if (trimOrNull(filters.discipline)) {
    where.discipline = { equals: filters.discipline.trim(), mode: "insensitive" };
  }
  if (filters.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: filters.locationId, projectId },
      select: { path: true },
    });
    if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found");
    where.location = { path: { startsWith: location.path } };
  }
  if (trimOrNull(filters.search)) {
    const search = filters.search.trim();
    where.OR = [
      { number: { contains: search, mode: "insensitive" } },
      { title: { contains: search, mode: "insensitive" } },
    ];
  }
  if (filters.setId) where.revisions = { some: { setId: filters.setId } };

  const sheets = await prisma.sheet.findMany({
    where,
    include: {
      location: { select: { id: true, name: true, code: true, path: true } },
      _count: { select: { revisions: true } },
    },
    orderBy: [{ sortKey: "asc" }],
  });
  const currentById = await currentRevisionsFor(sheets);

  const disciplines = new Map();
  let obsolete = 0;
  for (const sheet of sheets) {
    if (sheet.status === SHEET_STATUS.OBSOLETE) obsolete += 1;
    const key = sheet.discipline || "Unassigned";
    disciplines.set(key, (disciplines.get(key) || 0) + 1);
  }

  return {
    items: sheets.map((sheet) =>
      serializeSheet(sheet, { currentRevision: currentById.get(sheet.currentRevisionId) || null }),
    ),
    summary: {
      total: sheets.length,
      current: sheets.length - obsolete,
      obsolete,
      disciplines: [...disciplines.entries()]
        .map(([discipline, count]) => ({ discipline, count }))
        .sort((a, b) => a.discipline.localeCompare(b.discipline)),
    },
  };
};

const getSheet = async ({ orgId, projectId, sheetId, includeSuperseded = false }) => {
  const sheet = await ensureSheet({
    orgId,
    projectId,
    sheetId,
    include: {
      location: { select: { id: true, name: true, code: true, path: true } },
      revisions: {
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        include: { document: { select: { fileName: true, sizeBytes: true } } },
      },
    },
  });
  const revisions = sheet.revisions.filter((row) =>
    includeSuperseded ? true : row.status === REVISION_STATUS.PUBLISHED,
  );
  const current = sheet.revisions.find((row) => row.id === sheet.currentRevisionId) || null;
  return {
    ...serializeSheet(sheet, { currentRevision: current }),
    revisionCount: sheet.revisions.length,
    revisions: revisions.map(serializeRevision),
  };
};

const updateSheet = async ({ orgId, projectId, sheetId, payload = {}, userId = null }) => {
  const sheet = await ensureSheet({ orgId, projectId, sheetId });
  const data = {};
  if (payload.title !== undefined) data.title = trimOrNull(payload.title) || sheet.title;
  if (payload.discipline !== undefined) data.discipline = trimOrNull(payload.discipline);
  if (payload.locationId !== undefined) {
    if (payload.locationId) {
      const location = await prisma.location.findFirst({ where: { id: payload.locationId, projectId }, select: { id: true } });
      if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found");
    }
    data.locationId = payload.locationId || null;
  }
  if (payload.status !== undefined) {
    if (![SHEET_STATUS.CURRENT, SHEET_STATUS.OBSOLETE].includes(payload.status)) {
      throw new HttpError(400, "SHEET_STATUS_INVALID", "Status can be current or obsolete");
    }
    data.status = payload.status;
    data.obsoleteReason = payload.status === SHEET_STATUS.OBSOLETE ? trimOrNull(payload.obsoleteReason) : null;
  }
  if (payload.scaleRatio !== undefined) {
    const ratio = payload.scaleRatio === null || payload.scaleRatio === "" ? null : Number(payload.scaleRatio);
    if (ratio !== null && (!Number.isFinite(ratio) || ratio <= 0 || ratio > 100000)) {
      throw new HttpError(400, "SHEET_SCALE_INVALID", "Scale must be the denominator of the drawing scale, e.g. 100 for 1:100");
    }
    data.scaleRatio = ratio;
  }
  const updated = await prisma.sheet.update({
    where: { id: sheet.id },
    data,
    include: { location: { select: { id: true, name: true, code: true, path: true } } },
  });
  await auditService.recordEvent({
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.SHEET,
    entityId: sheet.id,
    action: data.status && data.status !== sheet.status ? auditService.ACTIONS.STATUS_CHANGED : auditService.ACTIONS.UPDATED,
    actorId: userId,
    oldStatus: sheet.status,
    newStatus: updated.status,
    reason: data.obsoleteReason || null,
    oldSummary: { number: sheet.number, title: sheet.title, discipline: sheet.discipline, locationId: sheet.locationId },
    newSummary: { number: updated.number, title: updated.title, discipline: updated.discipline, locationId: updated.locationId },
  });
  const currentById = await currentRevisionsFor([updated]);
  return serializeSheet(updated, { currentRevision: currentById.get(updated.currentRevisionId) || null });
};

const listSheetRevisions = async ({ orgId, projectId, sheetId, includeSuperseded = false }) => {
  const sheet = await getSheet({ orgId, projectId, sheetId, includeSuperseded });
  return { items: sheet.revisions, currentRevisionId: sheet.currentRevisionId };
};

const addSheetRevision = async ({ orgId, projectId, sheetId, file, payload = {}, userId = null }) => {
  const sheet = await ensureSheet({ orgId, projectId, sheetId });
  if (!file) throw new HttpError(400, "NO_FILE", "Upload the sheet as a PDF");
  const revisionLabel = trimOrNull(payload.revision)?.toUpperCase();
  if (!revisionLabel) throw new HttpError(400, "SHEET_REVISION_REQUIRED", "Give the revision a label (e.g. B, 2, P1)");

  const document = await fileStorageService.uploadProjectDocument({
    orgId,
    projectId,
    userId,
    file,
    documentType: fileStorageService.DOCUMENT_TYPES.DRAWING_SET,
    linkedEntityType: "sheet",
    linkedEntityId: sheet.id,
  });
  const created = await prisma.sheetRevision.create({
    data: {
      orgId,
      projectId,
      sheetId: sheet.id,
      documentId: document.id,
      pageNumber: Math.max(1, Number(payload.pageNumber) || 1),
      number: sheet.number,
      title: trimOrNull(payload.title) || sheet.title,
      revision: revisionLabel,
      discipline: sheet.discipline,
      status: REVISION_STATUS.PENDING,
      confidence: 1,
      textStatus: "none",
      createdBy: userId,
    },
  });
  await auditService.recordEvent({
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.SHEET_REVISION,
    entityId: created.id,
    action: auditService.ACTIONS.CREATED,
    actorId: userId,
    newStatus: created.status,
    summary: { number: sheet.number, revision: revisionLabel, sheetId: sheet.id, fileName: document.fileName },
  });

  let publishResult = null;
  if (payload.publish === true || payload.publish === "true") {
    publishResult = await publishRevisions({ orgId, projectId, revisionIds: [created.id], userId });
  }
  const row = await prisma.sheetRevision.findFirst({
    where: { id: created.id },
    include: { document: { select: { fileName: true, sizeBytes: true } } },
  });
  return { revision: serializeRevision(row), published: publishResult?.[0] || null };
};

const publishSheetRevision = async ({ orgId, projectId, revisionId, userId = null }) => {
  const [result] = await publishRevisions({ orgId, projectId, revisionIds: [revisionId], userId });
  const row = await prisma.sheetRevision.findFirst({
    where: { id: revisionId },
    include: { document: { select: { fileName: true, sizeBytes: true } } },
  });
  return { ...result, revision: serializeRevision(row) };
};

/** Current sheets with file metadata, for offline caching on site devices. */
const offlineManifest = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });
  const sheets = await prisma.sheet.findMany({
    where: { orgId, projectId, status: SHEET_STATUS.CURRENT, currentRevisionId: { not: null } },
    orderBy: [{ sortKey: "asc" }],
  });
  const revisions = await prisma.sheetRevision.findMany({
    where: { id: { in: sheets.map((sheet) => sheet.currentRevisionId) } },
    include: { document: { select: { fileName: true, sizeBytes: true, sha256: true, mimeType: true } } },
  });
  const byId = new Map(revisions.map((row) => [row.id, row]));
  const items = sheets
    .map((sheet) => {
      const revision = byId.get(sheet.currentRevisionId);
      if (!revision) return null;
      return {
        sheetId: sheet.id,
        number: sheet.number,
        title: sheet.title,
        discipline: sheet.discipline || null,
        revisionId: revision.id,
        revision: revision.revision,
        documentId: revision.documentId,
        pageNumber: revision.pageNumber,
        fileUrl: documentUrl(projectId, revision.documentId),
        fileName: revision.document?.fileName || null,
        sizeBytes: revision.document?.sizeBytes ?? null,
        sha256: revision.document?.sha256 || null,
        publishedAt: toIso(revision.publishedAt),
      };
    })
    .filter(Boolean);
  const documents = new Map();
  for (const item of items) {
    if (!documents.has(item.documentId)) documents.set(item.documentId, item.sizeBytes || 0);
  }
  return {
    generatedAt: new Date().toISOString(),
    items,
    totals: {
      sheets: items.length,
      documents: documents.size,
      bytes: [...documents.values()].reduce((sum, size) => sum + size, 0),
    },
  };
};

module.exports = {
  REVISION_STATUS,
  SET_PURPOSES,
  SET_STATUS,
  SHEET_STATUS,
  addSheetRevision,
  createSet,
  deleteSet,
  getSet,
  getSheet,
  listSets,
  listSheetRevisions,
  listSheets,
  offlineManifest,
  publishRevisions,
  publishSet,
  publishSheetRevision,
  reprocessSet,
  reviewRevisions,
  runDrawingSetJob,
  serializeRevision,
  serializeSet,
  serializeSheet,
  updateSet,
  updateSheet,
};
