const fs = require("fs");
const fsp = require("fs/promises");
const https = require("https");
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { readImageMetadata } = require("../utils/image-metadata");
const fileStorageService = require("./file-storage.service");
const auditService = require("./audit.service");
const { JobError } = require("../jobs/errors");

/**
 * Unified attachments (OCTA-DOC-ATTACH-006).
 *
 * Every record type links files through one `Attachment` row that points at a
 * `ProjectDocument`; images additionally get a `Photo` row with EXIF, GPS,
 * location, tags and an asynchronously generated thumbnail. One photo can be
 * attached to many records.
 */

const ATTACHMENT_ROLES = Object.freeze(["attachment", "evidence", "photo", "reference", "signature"]);
const THUMBNAIL_STATUS = Object.freeze({
  PENDING: "pending",
  READY: "ready",
  UNAVAILABLE: "unavailable",
  FAILED: "failed",
});
const THUMBNAIL_WIDTH = 480;
const PHOTO_TAG_LIMIT = 20;

/** Record types that accept attachments and the permission module that guards them. */
const RECORD_TYPE_MODULES = Object.freeze({
  risk: "risk",
  ncr: "ncr",
  itp: "ncr",
  defect: "ncr",
  punch_item: "punch",
  form_template: "inspection",
  form_instance: "inspection",
  form_response: "inspection",
  material_test: "ncr",
  safety_incident: "safety",
  rfi: "rfi",
  submittal: "submittal",
  drawing: "document_control",
  drawing_set: "document_control",
  sheet: "document_control",
  sheet_revision: "document_control",
  markup: "document_control",
  pin: "document_control",
  transmittal: "document_control",
  correspondence: "document_control",
  document: "document_control",
  task: "task",
  daily_report: "progress",
  site_diary: "progress",
  daily_log: "progress",
  timesheet: "timesheet",
  progress_submission: "progress",
  activity: "schedule",
  change_order: "change_order",
  change_event: "change_event",
  rfq: "change_event",
  ipc: "ipc",
  ipc_certificate: "ipc",
  sub_valuation: "ipc",
  eot: "eot",
  weather_delay: "eot",
  meeting: "meeting",
  meeting_action: "meeting",
  procurement_order: "procurement",
  procurement_package: "procurement",
  delivery_receipt: "procurement",
  commitment: "commitment",
  commitment_change_order: "commitment",
  sub_pay_app: "sub_pay_app",
  bid_package: "bid",
  bid: "bid",
  cost_record: "cost",
  direct_cost: "cost",
  lookahead: "lookahead",
  conversation: "conversation",
  inbound_email: "email",
  bim_model: "bim",
  closeout_deliverable: "closeout",
  boq_item: "boq",
  location: "location",
  project: "project_parties",
});
const RECORD_TYPES = Object.keys(RECORD_TYPE_MODULES);

/**
 * Where each record type's rows live, so an attachment names only a record of
 * the caller's own project (certification CERT-2: a company's attachment —
 * its document, audit row, history snapshot and outbound event — named
 * another company's bid package). A type whose rows carry their project names
 * its model; the rest say how a row reaches it: a form template of the
 * organisation's library or of this project, a checklist answer through its
 * inspection, a bid through its package, a conversation or inbound e-mail of
 * this project or of none. `project` is the project itself.
 */
const RECORD_TYPE_MODELS = Object.freeze({
  risk: "risk",
  ncr: "ncrRecord",
  itp: "itpRecord",
  defect: "defectRecord",
  punch_item: "punchItem",
  form_instance: "formInstance",
  material_test: "materialTest",
  safety_incident: "safetyIncident",
  rfi: "rfi",
  submittal: "submittal",
  drawing: "drawingRecord",
  drawing_set: "drawingSet",
  sheet: "sheet",
  sheet_revision: "sheetRevision",
  markup: "markup",
  pin: "pin",
  transmittal: "transmittal",
  correspondence: "correspondence",
  document: "projectDocument",
  task: "task",
  daily_report: "dailyReport",
  site_diary: "siteDiary",
  daily_log: "dailyLog",
  timesheet: "timesheet",
  progress_submission: "progressSubmission",
  activity: "activity",
  change_order: "changeOrder",
  change_event: "changeEvent",
  rfq: "rfq",
  ipc: "ipcCertificate",
  ipc_certificate: "ipcCertificate",
  sub_valuation: "subValuation",
  eot: "eotClaim",
  weather_delay: "weatherDelay",
  meeting: "meeting",
  meeting_action: "meetingActionItem",
  procurement_order: "procurementOrder",
  procurement_package: "procurementPackage",
  delivery_receipt: "deliveryReceipt",
  commitment: "commitment",
  commitment_change_order: "commitmentChangeOrder",
  sub_pay_app: "subPayApp",
  bid_package: "bidPackage",
  cost_record: "costRecord",
  direct_cost: "directCost",
  lookahead: "lookahead",
  bim_model: "bimModel",
  closeout_deliverable: "closeoutDeliverable",
  boq_item: "boqItem",
  location: "location",
});
const ofOrganisationOrProject = ({ orgId, projectId }) => ({ orgId, OR: [{ projectId }, { projectId: null }] });
const RECORD_TYPE_SCOPES = Object.freeze({
  form_template: { model: "formTemplate", where: ofOrganisationOrProject },
  form_response: { model: "formItemResponse", where: ({ projectId }) => ({ instance: { projectId } }) },
  bid: { model: "bid", where: ({ orgId, projectId }) => ({ orgId, package: { projectId } }) },
  conversation: { model: "conversation", where: ofOrganisationOrProject },
  inbound_email: { model: "inboundEmail", where: ofOrganisationOrProject },
});

/**
 * Refuses a record that is not one of this project's — another company's,
 * another project's, or one that exists nowhere — with the answer the route
 * gives a record the caller may not see (404 ATTACHMENT_RECORD_NOT_FOUND), so
 * it never tells whether the record exists elsewhere. A type with no known
 * home is refused the same way.
 */
const assertRecordInProject = async ({ orgId, projectId, recordType, recordId }) => {
  const notFound = () => new HttpError(404, "ATTACHMENT_RECORD_NOT_FOUND", "Record not found");
  if (recordType === "project") {
    if (recordId !== projectId) throw notFound();
    return;
  }
  const model = RECORD_TYPE_MODELS[recordType];
  if (model) {
    await require("./tenant-references.service").assertProjectRows({ model, projectId, ids: [recordId], code: "ATTACHMENT_RECORD_NOT_FOUND", message: "Record not found" });
    return;
  }
  const scope = RECORD_TYPE_SCOPES[recordType];
  const row = scope && prisma[scope.model]?.findFirst
    ? await prisma[scope.model].findFirst({ where: { id: recordId, ...scope.where({ orgId, projectId }) }, select: { id: true } })
    : null;
  if (!row) throw notFound();
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => value?.toISOString?.() || value || null;

const isImage = (mimeType) => String(mimeType || "").startsWith("image/");

const moduleForRecordType = (recordType) => {
  const moduleName = RECORD_TYPE_MODULES[recordType];
  if (!moduleName) {
    throw new HttpError(400, "ATTACHMENT_RECORD_TYPE_INVALID", `Unknown record type: ${recordType}`);
  }
  return moduleName;
};

const normalizeRole = (role, fallback = "attachment") => {
  const value = trimOrNull(role) || fallback;
  if (!ATTACHMENT_ROLES.includes(value)) {
    throw new HttpError(400, "ATTACHMENT_ROLE_INVALID", `Role must be one of ${ATTACHMENT_ROLES.join(", ")}`);
  }
  return value;
};

const normalizeTags = (tags) => {
  if (tags === undefined) return undefined;
  const list = Array.isArray(tags)
    ? tags
    : String(tags || "")
        .split(",")
        .map((tag) => tag.trim());
  const unique = [...new Set(list.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))];
  return unique.slice(0, PHOTO_TAG_LIMIT);
};

/**
 * Evidence a reviewer has seen stays as it was: a closeout deliverable's files
 * are fixed while it is submitted and once it is settled (CLOSEOUT V1); reopen
 * the deliverable to change them.
 */
const EVIDENCE_LOCKS = Object.freeze({
  closeout_deliverable: async (recordId) => {
    const row = await prisma.closeoutDeliverable.findFirst({ where: { id: recordId }, select: { status: true } });
    return row && ["submitted", "accepted", "waived", "not_applicable"].includes(row.status)
      ? "This deliverable is submitted or settled; reopen it to change its files"
      : null;
  },
});

const assertEvidenceOpen = async (recordType, recordId) => {
  const lock = EVIDENCE_LOCKS[recordType];
  const reason = lock ? await lock(recordId) : null;
  if (reason) throw new HttpError(409, "ATTACHMENT_RECORD_LOCKED", reason);
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

// ─── Serialization ──────────────────────────────────────────────────────────

const documentUrl = (projectId, documentId) =>
  `/api/v1/projects/${projectId}/attachments/documents/${documentId}`;

const photoUrls = (projectId, photo) => ({
  url: documentUrl(projectId, photo.documentId),
  thumbnailUrl:
    photo.thumbnailStatus === THUMBNAIL_STATUS.READY && photo.thumbnailKey
      ? `/api/v1/projects/${projectId}/photos/${photo.id}/thumbnail`
      : documentUrl(projectId, photo.documentId),
});

const serializePhoto = (photo, projectId, extra = {}) =>
  photo
    ? {
        id: photo.id,
        documentId: photo.documentId,
        locationId: photo.locationId || null,
        location: photo.location
          ? { id: photo.location.id, name: photo.location.name, fullName: photo.location.fullName || null, path: photo.location.path }
          : null,
        caption: photo.caption || null,
        tags: photo.tags || [],
        takenAt: toIso(photo.takenAt),
        latitude: photo.latitude ?? null,
        longitude: photo.longitude ?? null,
        altitude: photo.altitude ?? null,
        cameraMake: photo.cameraMake || null,
        cameraModel: photo.cameraModel || null,
        width: photo.width ?? null,
        height: photo.height ?? null,
        orientation: photo.orientation ?? null,
        thumbnailStatus: photo.thumbnailStatus,
        uploadedBy: photo.uploadedBy || null,
        createdAt: toIso(photo.createdAt),
        updatedAt: toIso(photo.updatedAt),
        ...photoUrls(projectId, photo),
        ...extra,
      }
    : null;

const serializeDocument = (document, projectId) =>
  document
    ? {
        id: document.id,
        fileName: document.fileName,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        documentType: document.documentType,
        uploadedBy: document.uploadedBy || null,
        uploadedAt: toIso(document.uploadedAt),
        url: documentUrl(projectId, document.id),
      }
    : null;

const serializeAttachment = (attachment, projectId) => ({
  id: attachment.id,
  projectId,
  recordType: attachment.recordType,
  recordId: attachment.recordId,
  documentId: attachment.documentId,
  role: attachment.role,
  caption: attachment.caption || null,
  sortOrder: attachment.sortOrder,
  source: attachment.source,
  uploadedBy: attachment.uploadedBy || null,
  createdAt: toIso(attachment.createdAt),
  document: serializeDocument(attachment.document, projectId),
  photo: serializePhoto(attachment.document?.photo, projectId),
  // Legacy-compatible fields so existing evidence lists keep rendering.
  fileName: attachment.document?.fileName || null,
  fileUrl: attachment.document ? documentUrl(projectId, attachment.document.id) : null,
  mimeType: attachment.document?.mimeType || null,
  sizeBytes: attachment.document?.sizeBytes ?? null,
});

const attachmentInclude = {
  document: { include: { photo: { include: { location: { select: { id: true, name: true, path: true } } } } } },
};

// ─── Photos ─────────────────────────────────────────────────────────────────

const enqueueThumbnail = async ({ orgId, projectId, photoId, userId }) => {
  try {
    const jobService = require("../jobs/job.service");
    if (!prisma.backgroundJob?.create) return null;
    const job = await jobService.enqueueJob({
      orgId,
      projectId,
      type: jobService.JOB_TYPES.PHOTO_THUMBNAIL,
      payload: { photoId },
      requestedBy: userId || null,
      maxAttempts: 2,
    });
    // OCTA-AI-PHOTO-034: AI_PHOTO_AUTO=on analyses every upload in the background.
    if (String(process.env.AI_PHOTO_AUTO || "").toLowerCase() === "on" && jobService.JOB_TYPES.PHOTO_ANALYZE) {
      await jobService
        .enqueueJob({ orgId, projectId, type: jobService.JOB_TYPES.PHOTO_ANALYZE, payload: { photoId, userId: userId || null }, requestedBy: userId || null, maxAttempts: 2, priority: -1 })
        .catch((error) => console.error("[attachments] could not enqueue photo analysis", error));
    }
    return job;
  } catch (error) {
    console.error("[attachments] could not enqueue thumbnail job", error);
    return null;
  }
};

/** Creates (or returns) the Photo row for an image document. */
const ensurePhotoForDocument = async ({
  tx = prisma,
  orgId,
  projectId,
  document,
  userId = null,
  metadata = null,
  locationId = null,
  caption = null,
  tags = [],
}) => {
  if (!isImage(document.mimeType) || !tx.photo?.upsert) return null;
  const meta = metadata || {};
  return tx.photo.upsert({
    where: { documentId: document.id },
    create: {
      orgId,
      projectId,
      documentId: document.id,
      locationId: locationId || null,
      caption: trimOrNull(caption),
      tags: tags || [],
      takenAt: meta.takenAt || document.uploadedAt || null,
      latitude: meta.latitude ?? null,
      longitude: meta.longitude ?? null,
      altitude: meta.altitude ?? null,
      cameraMake: meta.cameraMake || null,
      cameraModel: meta.cameraModel || null,
      width: meta.width ?? null,
      height: meta.height ?? null,
      orientation: meta.orientation ?? null,
      exifJson: meta.raw || null,
      thumbnailStatus: THUMBNAIL_STATUS.PENDING,
      uploadedBy: userId || document.uploadedBy || null,
    },
    update: {
      ...(locationId ? { locationId } : {}),
      ...(trimOrNull(caption) ? { caption: trimOrNull(caption) } : {}),
      ...(tags?.length ? { tags } : {}),
    },
  });
};

// ─── Attachments ────────────────────────────────────────────────────────────

const parseDocumentIds = (value) => {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map(trimOrNull).filter(Boolean);
  const text = String(value).trim();
  if (text.startsWith("[")) {
    try {
      return JSON.parse(text).map(trimOrNull).filter(Boolean);
    } catch {
      throw new HttpError(400, "ATTACHMENT_DOCUMENT_IDS_INVALID", "documentIds must be a JSON array");
    }
  }
  return text.split(",").map(trimOrNull).filter(Boolean);
};

/**
 * Attaches uploaded files and/or existing documents to a record. Files are
 * stored as ProjectDocuments (images also become Photos with EXIF read from
 * the temp upload before it is cleaned up).
 */
const createAttachments = async ({
  orgId,
  projectId,
  userId = null,
  userRole = null,
  recordType,
  recordId,
  role,
  caption = null,
  locationId = null,
  tags,
  files = [],
  documentIds = [],
  clientRequestId = null,
}) => {
  await ensureProject({ orgId, projectId });
  moduleForRecordType(recordType);
  const id = trimOrNull(recordId);
  if (!id) throw new HttpError(400, "ATTACHMENT_RECORD_ID_REQUIRED", "recordId is required");
  // The record is one of this project's before anything is uploaded, stored, audited or queued.
  await assertRecordInProject({ orgId, projectId, recordType, recordId: id });
  await assertEvidenceOpen(recordType, id);
  // Offline replay (OCTA-MOB-PWA-018): the same upload sent twice returns what the first one made.
  const replayKey = trimOrNull(clientRequestId)?.slice(0, 120) || null;
  if (replayKey && prisma.attachment?.findMany) {
    const existing = await prisma.attachment.findMany({
      where: { projectId, clientRequestId: replayKey },
      include: attachmentInclude,
      orderBy: { sortOrder: "asc" },
    });
    if (existing.length) return { items: existing.map(serializeAttachment), replayed: true };
  }
  const ids = parseDocumentIds(documentIds);
  if (!files.length && !ids.length) {
    throw new HttpError(400, "NO_FILE", "Upload at least one file or link a document");
  }
  const normalizedTags = normalizeTags(tags) || [];

  // Uploads first (outside the transaction: object storage is not transactional).
  const uploaded = [];
  for (const file of files) {
    const mimeType = file.mimetype || file.mimeType || "";
    const metadata = isImage(mimeType) ? await readImageMetadata(file.path) : null;
    const document = await fileStorageService.uploadProjectDocument({
      orgId,
      projectId,
      userId,
      file,
      documentType: fileStorageService.DOCUMENT_TYPES.WORKFLOW_ATTACHMENT,
      linkedEntityType: recordType,
      linkedEntityId: id,
    });
    uploaded.push({ document, metadata });
  }

  const linkedDocuments = ids.length
    ? await prisma.projectDocument.findMany({
        where: { id: { in: ids }, orgId, projectId, status: { in: ["available", "linked"] } },
      })
    : [];
  const missing = ids.filter((docId) => !linkedDocuments.some((doc) => doc.id === docId));
  if (missing.length) {
    throw new HttpError(404, "ATTACHMENT_DOCUMENT_NOT_FOUND", "One or more documents were not found in this project");
  }

  const created = await prisma.$transaction(async (tx) => {
    const rows = [];
    const entries = [
      ...uploaded.map((entry) => ({ ...entry, source: "upload" })),
      ...linkedDocuments.map((document) => ({ document, metadata: null, source: "link" })),
    ];
    let sortOrder = await tx.attachment.count({ where: { recordType, recordId: id } });

    for (const entry of entries) {
      const attachmentRole = normalizeRole(
        role,
        isImage(entry.document.mimeType) ? "photo" : entry.source === "link" ? "reference" : "attachment",
      );
      const attachment = await tx.attachment.upsert({
        where: {
          recordType_recordId_documentId: { recordType, recordId: id, documentId: entry.document.id },
        },
        create: {
          orgId,
          projectId,
          recordType,
          recordId: id,
          documentId: entry.document.id,
          role: attachmentRole,
          caption: trimOrNull(caption),
          sortOrder: sortOrder++,
          source: entry.source,
          clientRequestId: replayKey,
          uploadedBy: userId || null,
        },
        update: {
          role: attachmentRole,
          ...(replayKey ? { clientRequestId: replayKey } : {}),
          ...(trimOrNull(caption) ? { caption: trimOrNull(caption) } : {}),
        },
        include: attachmentInclude,
      });

      if (isImage(entry.document.mimeType)) {
        const photo = await ensurePhotoForDocument({
          tx,
          orgId,
          projectId,
          document: entry.document,
          userId,
          metadata: entry.metadata,
          locationId,
          caption,
          tags: normalizedTags,
        });
        attachment.document.photo = photo
          ? { ...photo, location: attachment.document.photo?.location || null }
          : attachment.document.photo;
      }

      await auditService.recordEvent({
        tx,
        orgId,
        projectId,
        entityType: auditService.ENTITY_TYPES.ATTACHMENT,
        entityId: attachment.id,
        action: auditService.ACTIONS.CREATED,
        actorId: userId,
        actorRole: userRole,
        summary: {
          recordType,
          recordId: id,
          fileName: entry.document.fileName,
          role: attachmentRole,
        },
        metadata: { recordType, recordId: id, documentId: entry.document.id, source: entry.source },
      });
      rows.push(attachment);
    }
    return rows;
  });

  // Thumbnails are generated in the background; failures never block the upload.
  for (const attachment of created) {
    const photo = attachment.document?.photo;
    if (photo && photo.thumbnailStatus === THUMBNAIL_STATUS.PENDING && !photo.thumbnailKey) {
      await enqueueThumbnail({ orgId, projectId, photoId: photo.id, userId });
    }
  }

  return { items: created.map((row) => serializeAttachment(row, projectId)) };
};

const listAttachments = async ({ orgId, projectId, recordType, recordId, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  if (recordType) moduleForRecordType(recordType);
  const rows = await prisma.attachment.findMany({
    where: {
      projectId,
      ...(recordType ? { recordType } : {}),
      ...(recordId ? { recordId } : {}),
    },
    include: attachmentInclude,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  // A party-scoped viewer sees only the records their own rule admits — a
  // list by record type alone returned every company's rows (Phase 21D, CX21-551).
  let visible = rows;
  if (viewer) {
    const docText = require("./document-text.service");
    const pairs = [...new Map(rows.map((row) => [`${row.recordType}:${row.recordId}`, { recordType: row.recordType, recordId: row.recordId }])).values()];
    const ruled = await docText.recordRuleVisibleIds({ documents: [{ attachments: pairs }], viewer });
    visible = rows.filter((row) => docText.attachmentVisible({ recordType: row.recordType, recordId: row.recordId, role: row.role }, viewer, ruled));
  }
  return { items: visible.map((row) => serializeAttachment(row, projectId)) };
};

/**
 * Evidence already in the project (Phase 22B): every document attached to any
 * record the viewer may read — an RFI's instruction letter, an NCR's photos, a
 * submittal's transmittal, a daily log's photos — searched by file name,
 * caption, or the record's reference and title. A change order then cites the
 * very same ProjectDocument the record carries: nothing is uploaded twice, and
 * nothing appears that the record's own visibility rule would hide (the module
 * read permission first, then the Phase 21 record rules for party-scoped
 * viewers).
 */
const searchProjectEvidence = async ({ orgId, projectId, viewer = null, q = "", limit = 40 }) => {
  await ensureProject({ orgId, projectId });
  const rows = await prisma.attachment.findMany({
    where: { projectId, document: { status: { in: ["available", "linked"] } } },
    include: attachmentInclude,
    orderBy: [{ createdAt: "desc" }],
    take: 500,
  });
  let visible = rows.filter((row) => {
    const moduleName = RECORD_TYPE_MODULES[row.recordType];
    return !moduleName || !viewer?.canRead || viewer.canRead(moduleName);
  });
  if (viewer) {
    const docText = require("./document-text.service");
    const pairs = [...new Map(visible.map((row) => [`${row.recordType}:${row.recordId}`, { recordType: row.recordType, recordId: row.recordId }])).values()];
    const ruled = await docText.recordRuleVisibleIds({ documents: [{ attachments: pairs }], viewer });
    visible = visible.filter((row) => docText.attachmentVisible({ recordType: row.recordType, recordId: row.recordId, role: row.role }, viewer, ruled));
  }

  // one label per record, resolved through the same loader comments and pins use
  const { loadRecord } = require("./comment.service");
  const labels = new Map();
  const keys = [...new Set(visible.map((row) => `${row.recordType}:${row.recordId}`))].slice(0, 150);
  for (const key of keys) {
    const [recordType, recordId] = key.split(":");
    try {
      const { record, display } = await loadRecord({ orgId, projectId, recordType, recordId });
      labels.set(key, { ref: record?.ref || record?.number || null, title: display || null, status: record?.status || null });
    } catch {
      labels.set(key, { ref: null, title: null, status: null });
    }
  }

  const needle = String(q || "").trim().toLowerCase();
  const seen = new Set();
  const items = [];
  for (const row of visible) {
    if (seen.has(row.documentId)) continue; // the same file can hang on several records; offer it once
    const label = labels.get(`${row.recordType}:${row.recordId}`) || { ref: null, title: null, status: null };
    const fileName = row.document?.fileName || row.document?.originalName || null;
    const haystack = [fileName, row.caption, label.ref, label.title].filter(Boolean).join(" ").toLowerCase();
    if (needle && !haystack.includes(needle)) continue;
    seen.add(row.documentId);
    items.push({
      documentId: row.documentId,
      attachmentId: row.id,
      recordType: row.recordType,
      recordId: row.recordId,
      recordRef: label.ref,
      recordTitle: label.title,
      recordStatus: label.status,
      role: row.role,
      caption: row.caption || null,
      fileName,
      mimeType: row.document?.mimeType || null,
      sizeBytes: row.document?.sizeBytes ?? null,
      uploadedAt: toIso(row.document?.uploadedAt || row.createdAt),
      fileUrl: row.document ? documentUrl(projectId, row.document.id) : null,
    });
    if (items.length >= limit) break;
  }
  return { items, total: items.length };
};

const getAttachment = async ({ orgId, projectId, attachmentId }) => {
  const row = await prisma.attachment.findFirst({
    where: { id: attachmentId, projectId, orgId },
    include: attachmentInclude,
  });
  if (!row) throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
  return row;
};

/** Unlinks a document from a record. The document and its photo stay. */
const deleteAttachment = async ({ orgId, projectId, attachmentId, userId = null, userRole = null }) => {
  const existing = await getAttachment({ orgId, projectId, attachmentId });
  await assertEvidenceOpen(existing.recordType, existing.recordId);
  await prisma.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: attachmentId } });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.ATTACHMENT,
      entityId: attachmentId,
      action: auditService.ACTIONS.DELETED,
      actorId: userId,
      actorRole: userRole,
      summary: { recordType: existing.recordType, recordId: existing.recordId, fileName: existing.document?.fileName },
      metadata: { recordType: existing.recordType, recordId: existing.recordId, documentId: existing.documentId },
    });
  });
  return { deleted: true, id: attachmentId, recordType: existing.recordType, recordId: existing.recordId };
};

/** Streams any document that is attached somewhere on the project. */
const getDocumentFile = async ({ orgId, projectId, documentId }) => {
  const document = await prisma.projectDocument.findFirst({
    where: { id: documentId, orgId, projectId },
    select: { id: true, documentType: true },
  });
  if (!document) throw new HttpError(404, "FILE_NOT_FOUND", "File not found");
  return fileStorageService.getProjectDocumentFile({
    orgId,
    projectId,
    key: document.id,
    documentType: document.documentType,
  });
};

// ─── Gallery ────────────────────────────────────────────────────────────────

const photoInclude = {
  document: { select: { id: true, fileName: true, originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true, uploadedBy: true, documentType: true } },
  location: { select: { id: true, name: true, path: true } },
};

const parseDate = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "PHOTO_DATE_INVALID", "Date filters must be ISO-8601");
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) date.setHours(23, 59, 59, 999);
  return date;
};

/**
 * The gallery as a viewer (document-text.service documentViewer) may see it
 * (certification R31): a photo is its document's, and its document its
 * records' — a photo appears only when the viewer may read its document
 * (readableDocumentIds), its `records` name only the links the viewer may
 * see (attachmentVisible), a record filter matches only those, and the
 * summary's total and tags count only the photos listed to them. The gallery
 * handed every document-control reader the photos of other parties' RFIs,
 * NCRs, safety incidents and commitments, and the records they hang on.
 * Pages are filled from as many rows as it takes (at most PHOTO_SCAN_BATCHES
 * batches a page); the cursor stays a photo id. Without a viewer, nothing
 * is filtered.
 */
const PHOTO_SCAN_BATCHES = 25;
const listPhotos = async ({ orgId, projectId, query = {}, viewer = null }) => {
  if (viewer) return listPhotosForViewer({ orgId, projectId, query, viewer });
  await ensureProject({ orgId, projectId });
  const limit = Math.min(Math.max(Number(query.limit) || 60, 1), 200);
  const where = { projectId, orgId };

  const from = parseDate(query.from);
  const to = parseDate(query.to, true);
  if (from || to) {
    where.takenAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  if (query.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: query.locationId, projectId },
      select: { id: true, path: true },
    });
    if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found");
    const subtree = await prisma.location.findMany({
      where: { projectId, OR: [{ id: location.id }, { path: { startsWith: `${location.path}/` } }] },
      select: { id: true },
    });
    where.locationId = { in: subtree.map((row) => row.id) };
  }
  const tag = trimOrNull(query.tag)?.toLowerCase();
  if (tag) where.tags = { has: tag };
  if (query.recordType) {
    moduleForRecordType(query.recordType);
    where.document = {
      attachments: {
        some: { recordType: query.recordType, ...(query.recordId ? { recordId: query.recordId } : {}) },
      },
    };
  }
  if (query.search) {
    const search = String(query.search).trim();
    where.OR = [
      { caption: { contains: search, mode: "insensitive" } },
      { document: { originalName: { contains: search, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.photo.findMany({
    where,
    include: photoInclude,
    orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const links = page.length
    ? await prisma.attachment.findMany({
        where: { projectId, documentId: { in: page.map((row) => row.documentId) } },
        select: { documentId: true, recordType: true, recordId: true, role: true },
      })
    : [];
  const linksByDocument = links.reduce((map, link) => {
    if (!map.has(link.documentId)) map.set(link.documentId, []);
    map.get(link.documentId).push({ recordType: link.recordType, recordId: link.recordId, role: link.role });
    return map;
  }, new Map());

  const [total, tagRows] = await Promise.all([
    prisma.photo.count({ where: { projectId, orgId } }),
    prisma.photo.findMany({ where: { projectId, orgId }, select: { tags: true }, take: 2000 }),
  ]);
  const tagCounts = {};
  for (const row of tagRows) for (const value of row.tags || []) tagCounts[value] = (tagCounts[value] || 0) + 1;

  return {
    items: page.map((photo) =>
      serializePhoto(photo, projectId, {
        document: serializeDocument(photo.document, projectId),
        records: linksByDocument.get(photo.documentId) || [],
      }),
    ),
    pagination: { limit, nextCursor: hasMore ? page[page.length - 1].id : null },
    summary: {
      total,
      tags: Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([value, count]) => ({ tag: value, count })),
    },
  };
};

const listPhotosForViewer = async ({ orgId, projectId, query = {}, viewer }) => {
  await ensureProject({ orgId, projectId });
  const docText = require("./document-text.service");
  const limit = Math.min(Math.max(Number(query.limit) || 60, 1), 200);
  const where = { projectId, orgId };

  const from = parseDate(query.from);
  const to = parseDate(query.to, true);
  if (from || to) {
    where.takenAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  if (query.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: query.locationId, projectId },
      select: { id: true, path: true },
    });
    if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found");
    const subtree = await prisma.location.findMany({
      where: { projectId, OR: [{ id: location.id }, { path: { startsWith: `${location.path}/` } }] },
      select: { id: true },
    });
    where.locationId = { in: subtree.map((row) => row.id) };
  }
  const tag = trimOrNull(query.tag)?.toLowerCase();
  if (tag) where.tags = { has: tag };
  const recordFilter = query.recordType
    ? { recordType: query.recordType, ...(query.recordId ? { recordId: query.recordId } : {}) }
    : null;
  if (recordFilter) {
    moduleForRecordType(query.recordType);
    where.document = { attachments: { some: recordFilter } };
  }
  if (query.search) {
    const search = String(query.search).trim();
    where.OR = [
      { caption: { contains: search, mode: "insensitive" } },
      { document: { originalName: { contains: search, mode: "insensitive" } } },
    ];
  }

  // The links of these photos' documents the viewer may see, by document.
  const visibleLinks = async (documentIds) => {
    const links = documentIds.length
      ? await prisma.attachment.findMany({
          where: { projectId, documentId: { in: documentIds } },
          select: { documentId: true, recordType: true, recordId: true, role: true },
        })
      : [];
    const pairs = [...new Map(links.map((link) => [`${link.recordType}:${link.recordId}`, { recordType: link.recordType, recordId: link.recordId }])).values()];
    const ruled = await docText.recordRuleVisibleIds({ documents: [{ attachments: pairs }], viewer });
    return links
      .filter((link) => docText.attachmentVisible(link, viewer, ruled))
      .reduce((map, link) => {
        if (!map.has(link.documentId)) map.set(link.documentId, []);
        map.get(link.documentId).push({ recordType: link.recordType, recordId: link.recordId, role: link.role });
        return map;
      }, new Map());
  };
  const matchesRecord = (records) =>
    !recordFilter ||
    records.some((record) => record.recordType === recordFilter.recordType && (!recordFilter.recordId || record.recordId === recordFilter.recordId));

  const batch = Math.min(200, limit + 1);
  const shown = [];
  let cursor = query.cursor || null;
  let exhausted = false;
  let scanned = 0;
  while (shown.length <= limit && !exhausted && scanned < PHOTO_SCAN_BATCHES) {
    const rows = await prisma.photo.findMany({
      where,
      include: photoInclude,
      orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: batch,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    scanned += 1;
    exhausted = rows.length < batch;
    if (rows.length) cursor = rows[rows.length - 1].id;
    const readable = await docText.readableDocumentIds({ orgId, projectId, documentIds: rows.map((row) => row.documentId), viewer });
    const candidates = rows.filter((row) => readable.has(row.documentId));
    const links = await visibleLinks([...new Set(candidates.map((row) => row.documentId))]);
    for (const photo of candidates) {
      const records = links.get(photo.documentId) || [];
      if (matchesRecord(records)) shown.push({ photo, records });
    }
  }
  const hasMore = shown.length > limit || (!exhausted && scanned >= PHOTO_SCAN_BATCHES);
  const page = shown.slice(0, limit);
  // A page cut short by the scan bound continues after the last row read.
  const nextCursor = shown.length > limit ? page[page.length - 1].photo.id : hasMore ? cursor : null;

  // The summary counts the photos this viewer may see, judged a thousand at a time.
  const summaryRows = await prisma.photo.findMany({
    where: { projectId, orgId },
    select: { documentId: true, tags: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  let total = 0;
  const tagCounts = {};
  for (let start = 0; start < summaryRows.length; start += 1000) {
    const slice = summaryRows.slice(start, start + 1000);
    const readable = await docText.readableDocumentIds({ orgId, projectId, documentIds: slice.map((row) => row.documentId), viewer });
    for (const row of slice) {
      if (!readable.has(row.documentId)) continue;
      total += 1;
      if (total <= 2000) for (const value of row.tags || []) tagCounts[value] = (tagCounts[value] || 0) + 1;
    }
  }

  return {
    items: page.map(({ photo, records }) =>
      serializePhoto(photo, projectId, {
        document: serializeDocument(photo.document, projectId),
        records,
      }),
    ),
    pagination: { limit, nextCursor },
    summary: {
      total,
      tags: Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([value, count]) => ({ tag: value, count })),
    },
  };
};

const getPhoto = async ({ orgId, projectId, photoId }) => {
  const photo = await prisma.photo.findFirst({
    where: { id: photoId, projectId, orgId },
    include: photoInclude,
  });
  if (!photo) throw new HttpError(404, "PHOTO_NOT_FOUND", "Photo not found");
  return photo;
};

const updatePhoto = async ({ orgId, projectId, photoId, payload = {}, userId = null, userRole = null }) => {
  const existing = await getPhoto({ orgId, projectId, photoId });
  const data = {};
  if (payload.caption !== undefined) data.caption = trimOrNull(payload.caption);
  if (payload.tags !== undefined) data.tags = normalizeTags(payload.tags);
  if (payload.takenAt !== undefined) data.takenAt = parseDate(payload.takenAt);
  if (payload.locationId !== undefined) {
    const locationId = trimOrNull(payload.locationId);
    if (locationId) {
      const location = await prisma.location.findFirst({ where: { id: locationId, projectId }, select: { id: true } });
      if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found");
    }
    data.locationId = locationId;
  }

  const photo = await prisma.$transaction(async (tx) => {
    const updated = await tx.photo.update({ where: { id: existing.id }, data, include: photoInclude });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.PHOTO,
      entityId: existing.id,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      summary: { caption: updated.caption, tags: updated.tags, locationId: updated.locationId },
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  });

  return serializePhoto(photo, projectId, { document: serializeDocument(photo.document, projectId) });
};

/**
 * A photo's original or thumbnail. With a viewer (documentViewer), only a
 * photo whose document they may read — refused as a missing photo: the
 * thumbnail and the original of another party's RFI photo were served to
 * every document-control reader (certification R31).
 */
const getPhotoFile = async ({ orgId, projectId, photoId, variant = "original", viewer = null }) => {
  const photo = await getPhoto({ orgId, projectId, photoId });
  if (viewer && !(await require("./document-text.service").documentReadableToViewer({ orgId, projectId, documentId: photo.documentId, viewer }))) {
    throw new HttpError(404, "PHOTO_NOT_FOUND", "Photo not found");
  }
  const key =
    variant === "thumbnail" && photo.thumbnailStatus === THUMBNAIL_STATUS.READY && photo.thumbnailKey
      ? photo.thumbnailKey
      : photo.documentId;
  const document = await prisma.projectDocument.findFirst({
    where: { id: key, orgId, projectId },
    select: { id: true, documentType: true },
  });
  if (!document) throw new HttpError(404, "FILE_NOT_FOUND", "File not found");
  return fileStorageService.getProjectDocumentFile({
    orgId,
    projectId,
    key: document.id,
    documentType: document.documentType,
  });
};

// ─── Thumbnail job ──────────────────────────────────────────────────────────

const loadSharp = () => {
  try {
    // Optional dependency: native image codec. Absent in minimal installs.
    return require("sharp");
  } catch {
    return null;
  }
};

const downloadToTemp = (url, extension) =>
  new Promise((resolve, reject) => {
    const target = path.join(os.tmpdir(), `octapm-photo-${crypto.randomUUID()}${extension}`);
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new JobError("PHOTO_DOWNLOAD_FAILED", `Download failed (${response.statusCode})`, { retryable: true }));
          return;
        }
        const stream = fs.createWriteStream(target);
        response.pipe(stream);
        stream.on("finish", () => stream.close(() => resolve(target)));
        stream.on("error", reject);
      })
      .on("error", reject);
  });

const runPhotoThumbnailJob = async ({ job, payload = {}, updateProgress = async () => {} }) => {
  const photoId = payload.photoId;
  const photo = await prisma.photo.findFirst({
    where: { id: photoId, orgId: job.orgId },
    include: { document: true },
  });
  if (!photo) throw new JobError("PHOTO_NOT_FOUND", "Photo no longer exists", { retryable: false });

  const sharp = loadSharp();
  if (!sharp) {
    await prisma.photo.update({
      where: { id: photo.id },
      data: { thumbnailStatus: THUMBNAIL_STATUS.UNAVAILABLE },
    });
    return { photoId: photo.id, status: THUMBNAIL_STATUS.UNAVAILABLE, reason: "sharp not installed" };
  }

  await updateProgress({ step: "load", progress: 10 });
  const source = await fileStorageService.getProjectDocumentFile({
    orgId: photo.orgId,
    projectId: photo.projectId,
    key: photo.documentId,
    documentType: photo.document.documentType,
  });
  const extension = path.extname(photo.document.fileName || "") || ".jpg";
  const localPath = source.path || (await downloadToTemp(source.redirectUrl, extension));
  const thumbPath = path.join(os.tmpdir(), `octapm-thumb-${crypto.randomUUID()}.jpg`);

  try {
    await updateProgress({ step: "resize", progress: 40 });
    const image = sharp(localPath).rotate().resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true });
    const info = await image.jpeg({ quality: 78 }).toFile(thumbPath);
    const original = await sharp(localPath).metadata().catch(() => ({}));

    await updateProgress({ step: "store", progress: 70 });
    const thumbDocument = await fileStorageService.uploadProjectDocument({
      orgId: photo.orgId,
      projectId: photo.projectId,
      userId: photo.uploadedBy,
      file: {
        path: thumbPath,
        originalname: `${path.basename(photo.document.fileName || "photo", extension)}-thumb.jpg`,
        mimetype: "image/jpeg",
        size: info.size,
      },
      documentType: fileStorageService.DOCUMENT_TYPES.WORKFLOW_ATTACHMENT,
      linkedEntityType: "photo_thumbnail",
      linkedEntityId: photo.id,
    });

    await prisma.photo.update({
      where: { id: photo.id },
      data: {
        thumbnailKey: thumbDocument.id,
        thumbnailStatus: THUMBNAIL_STATUS.READY,
        width: photo.width || original.width || null,
        height: photo.height || original.height || null,
      },
    });
    return { photoId: photo.id, status: THUMBNAIL_STATUS.READY, thumbnailKey: thumbDocument.id };
  } catch (error) {
    await prisma.photo.update({
      where: { id: photo.id },
      data: { thumbnailStatus: THUMBNAIL_STATUS.FAILED },
    });
    throw new JobError("PHOTO_THUMBNAIL_FAILED", error?.message || "Thumbnail generation failed", {
      retryable: false,
    });
  } finally {
    await fsp.unlink(thumbPath).catch(() => {});
    if (!source.path && localPath) await fsp.unlink(localPath).catch(() => {});
  }
};

module.exports = {
  searchProjectEvidence,
  ATTACHMENT_ROLES,
  RECORD_TYPES,
  RECORD_TYPE_MODELS,
  RECORD_TYPE_MODULES,
  RECORD_TYPE_SCOPES,
  THUMBNAIL_STATUS,
  assertRecordInProject,
  createAttachments,
  deleteAttachment,
  ensurePhotoForDocument,
  getAttachment,
  getDocumentFile,
  getPhoto,
  getPhotoFile,
  listAttachments,
  listPhotos,
  moduleForRecordType,
  normalizeTags,
  parseDocumentIds,
  runPhotoThumbnailJob,
  serializeAttachment,
  serializePhoto,
  updatePhoto,
};
