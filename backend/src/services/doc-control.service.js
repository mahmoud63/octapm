const { prisma } = require("../config/db");
const { normalizeRoleId } = require("../config/permissions");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const fileStorageService = require("./file-storage.service");
const {
  RECORD_TYPES,
  attachWorkflowDetailsToRecords,
  dueAlertForRecord,
  recordWorkflowHistory,
  trimOrNull,
} = require("./workflow-support.service");

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  return project;
};

const REGISTER_RECORD_TYPES = [
  RECORD_TYPES.RFI,
  RECORD_TYPES.SUBMITTAL,
  RECORD_TYPES.DRAWING,
  RECORD_TYPES.TRANSMITTAL,
  RECORD_TYPES.CORRESPONDENCE,
];

const REVISION_ACTION_RECORD_TYPES = [
  RECORD_TYPES.RFI,
  RECORD_TYPES.SUBMITTAL,
  RECORD_TYPES.DRAWING,
  RECORD_TYPES.TRANSMITTAL,
];

const RECORD_DELEGATES = {
  [RECORD_TYPES.RFI]: "rfi",
  [RECORD_TYPES.SUBMITTAL]: "submittal",
  [RECORD_TYPES.DRAWING]: "drawingRecord",
  [RECORD_TYPES.TRANSMITTAL]: "transmittal",
  [RECORD_TYPES.CORRESPONDENCE]: "correspondence",
};

const toIso = (value) => value?.toISOString?.() || value || null;

const statusLabel = (value) => String(value || "").toLowerCase();

const CURRENT_ONLY_ROLES = new Set(["site_engineer", "warehouse"]);

const DOCUMENT_FOLDERS = [
  { key: "drawings", label: "Drawings", recordTypes: [RECORD_TYPES.DRAWING] },
  {
    key: "submittals",
    label: "Submittals",
    recordTypes: [RECORD_TYPES.SUBMITTAL],
  },
  { key: "rfi", label: "RFI", recordTypes: [RECORD_TYPES.RFI] },
  {
    key: "transmittals",
    label: "Transmittals",
    recordTypes: [RECORD_TYPES.TRANSMITTAL],
  },
  {
    key: "correspondence",
    label: "Correspondence",
    recordTypes: [RECORD_TYPES.CORRESPONDENCE],
  },
];

const DEFAULT_FOLDER_BY_RECORD_TYPE = {
  [RECORD_TYPES.RFI]: { category: "RFI", folderPath: "/RFI", folderKey: "rfi" },
  [RECORD_TYPES.SUBMITTAL]: {
    category: "Submittals",
    folderPath: "/Submittals",
    folderKey: "submittals",
  },
  [RECORD_TYPES.DRAWING]: {
    category: "Drawings",
    folderPath: "/Drawings",
    folderKey: "drawings",
  },
  [RECORD_TYPES.TRANSMITTAL]: {
    category: "Transmittals",
    folderPath: "/Transmittals",
    folderKey: "transmittals",
  },
  [RECORD_TYPES.CORRESPONDENCE]: {
    category: "Correspondence",
    folderPath: "/Correspondence",
    folderKey: "correspondence",
  },
};

const canViewRevisionHistory = (userRole) =>
  !userRole || !CURRENT_ONLY_ROLES.has(normalizeRoleId(userRole));

const isCurrentApprovedRevision = (revision) =>
  Boolean(revision?.isLatest) && statusLabel(revision?.status) === "approved";

const visibleRevisionsForRole = (revisions, userRole) =>
  canViewRevisionHistory(userRole)
    ? revisions
    : revisions.filter(isCurrentApprovedRevision);

const normalizeFolderPath = (value, fallback) => {
  const path = trimOrNull(value) || fallback;
  const normalized = String(path || "/Documents")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const folderDefaultsFor = (recordType) =>
  DEFAULT_FOLDER_BY_RECORD_TYPE[recordType] || {
    category: "Documents",
    folderPath: "/Documents",
    folderKey: "documents",
  };

const folderKeyFor = ({ recordType, folderPath, category }) => {
  const defaults = folderDefaultsFor(recordType);
  const normalizedPath = String(folderPath || "").toLowerCase();
  const normalizedCategory = String(category || "").toLowerCase();
  const match = DOCUMENT_FOLDERS.find(
    (folder) =>
      folder.recordTypes.includes(recordType) ||
      normalizedPath.includes(folder.key) ||
      normalizedCategory.includes(folder.label.toLowerCase()),
  );
  return match?.key || defaults.folderKey;
};

const documentMetadataFromPayload = ({ payload = {}, recordType, record }) => {
  const defaults = folderDefaultsFor(recordType);
  const title = trimOrNull(payload.title) || recordTitle(recordType, record);
  const category = trimOrNull(payload.category) || defaults.category;
  const folderPath = normalizeFolderPath(payload.folderPath, defaults.folderPath);
  return {
    title,
    documentNumber: trimOrNull(payload.documentNumber) || recordRef(recordType, record),
    category,
    folderPath,
    folderKey: folderKeyFor({ recordType, category, folderPath }),
    discipline: trimOrNull(payload.discipline),
    confidentiality: trimOrNull(payload.confidentiality) || "project",
    reviewDueAt: payload.reviewDueAt ? new Date(payload.reviewDueAt) : null,
  };
};

const revisionDownloadUrl = (revision, projectId) =>
  revision?.projectDocumentId || revision?.storageKey
    ? `/api/v1/projects/${projectId}/doc-control/revisions/${revision.id}/download`
    : null;

const revisionPreviewUrl = (revision, projectId) =>
  revision?.projectDocumentId || revision?.storageKey
    ? `/api/v1/projects/${projectId}/doc-control/revisions/${revision.id}/preview`
    : null;

const serializeRevision = (revision, projectId) => {
  const downloadUrl = revisionDownloadUrl(revision, projectId);
  const previewUrl = revisionPreviewUrl(revision, projectId);
  return {
    id: revision.id,
    projectId: revision.projectId,
    projectDocumentId: revision.projectDocumentId || null,
    recordType: revision.recordType,
    recordId: revision.recordId,
    revision: revision.revision,
    status: revision.status || null,
    title: revision.title || null,
    documentNumber: revision.documentNumber || null,
    category: revision.category || null,
    folderPath: revision.folderPath || null,
    folderKey: folderKeyFor({
      recordType: revision.recordType,
      folderPath: revision.folderPath,
      category: revision.category,
    }),
    discipline: revision.discipline || null,
    mimeType: revision.mimeType || null,
    sizeBytes: revision.sizeBytes || null,
    fileName: revision.fileName || null,
    fileUrl: revision.fileUrl || downloadUrl,
    downloadUrl,
    previewUrl,
    storageKey: revision.storageKey || null,
    isLatest: Boolean(revision.isLatest),
    issuedBy: revision.issuedBy || null,
    issuedAt: toIso(revision.issuedAt),
    submittedBy: revision.submittedBy || null,
    submittedAt: toIso(revision.submittedAt),
    reviewDueAt: toIso(revision.reviewDueAt),
    approvedBy: revision.approvedBy || null,
    approvedAt: toIso(revision.approvedAt),
    supersededBy: revision.supersededBy || null,
    supersededAt: toIso(revision.supersededAt),
    notes: revision.notes || null,
    createdAt: toIso(revision.createdAt),
    updatedAt: toIso(revision.updatedAt),
    readOnly: statusLabel(revision.status) === "superseded",
  };
};

const sortRevisions = (rows = []) =>
  [...rows].sort((a, b) => {
    if (a.isLatest !== b.isLatest) return a.isLatest ? -1 : 1;
    const aTime = new Date(a.issuedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.issuedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });

const recordTitle = (recordType, record) => {
  if (recordType === RECORD_TYPES.RFI) return record.subject;
  if (recordType === RECORD_TYPES.SUBMITTAL) return record.title;
  if (recordType === RECORD_TYPES.DRAWING) {
    return [record.drawingNumber, record.title].filter(Boolean).join(" / ");
  }
  if (recordType === RECORD_TYPES.TRANSMITTAL) return record.subject;
  return record.subject;
};

const recordRef = (recordType, record) =>
  record.ref || record.drawingNumber || `${recordType}:${record.id}`;

const recordRevision = (recordType, record) => {
  if (recordType === RECORD_TYPES.DRAWING) return record.revision || null;
  if (recordType === RECORD_TYPES.SUBMITTAL) return record.revision || null;
  return null;
};

const registerRowForRecord = ({ projectId, recordType, record, userRole }) => {
  const allRevisions = sortRevisions(record.revisions || []).map((revision) =>
    serializeRevision(revision, projectId),
  );
  const revisions = visibleRevisionsForRole(allRevisions, userRole);
  const latestRevision =
    revisions.find((revision) => revision.isLatest) ||
    revisions.find(
      (revision) => statusLabel(revision.status) !== "superseded",
    ) ||
    revisions[0] ||
    null;
  const attachments = record.attachments || record.attachmentRefs || [];
  const defaults = folderDefaultsFor(recordType);
  const category = latestRevision?.category || defaults.category;
  const folderPath = latestRevision?.folderPath || defaults.folderPath;
  const folderKey =
    latestRevision?.folderKey ||
    folderKeyFor({ recordType, folderPath, category });

  return {
    id: `${recordType}:${record.id}`,
    recordType,
    recordId: record.id,
    ref: recordRef(recordType, record),
    title: recordTitle(recordType, record),
    documentNumber: latestRevision?.documentNumber || recordRef(recordType, record),
    category,
    folderPath,
    folderKey,
    restrictedToCurrentRevision: !canViewRevisionHistory(userRole),
    status: record.status || null,
    currentRevision: recordRevision(recordType, record),
    latestRevision,
    revisions,
    revisionCount: revisions.length,
    supersededRevisionCount: revisions.filter(
      (revision) => statusLabel(revision.status) === "superseded",
    ).length,
    dueDate: toIso(record.dueDate || record.responseRequiredBy),
    dueAlert: record.dueAlert || dueAlertForRecord(record),
    activityId: record.activityId || null,
    activityLinks: record.activityLinks || [],
    attachments,
    attachmentCount: attachments.length,
    owner: record.owner || null,
    reviewer: record.reviewer || null,
    approver: record.approver || null,
    linkedEntities: {
      rfiId: recordType === RECORD_TYPES.RFI ? record.id : null,
      submittalId: recordType === RECORD_TYPES.SUBMITTAL ? record.id : null,
      drawingId: recordType === RECORD_TYPES.DRAWING ? record.id : null,
      transmittalId: recordType === RECORD_TYPES.TRANSMITTAL ? record.id : null,
    },
    updatedAt: toIso(record.updatedAt),
  };
};

const getRecord = async ({ tx = prisma, projectId, recordType, recordId }) => {
  const delegate = RECORD_DELEGATES[recordType];
  if (!delegate || !tx[delegate]?.findFirst) {
    throw new HttpError(
      400,
      "DOCUMENT_RECORD_TYPE_UNSUPPORTED",
      "Document record type is not supported",
    );
  }

  const record = await tx[delegate].findFirst({
    where: { id: recordId, projectId },
  });

  if (!record) {
    throw new HttpError(
      404,
      "DOCUMENT_RECORD_NOT_FOUND",
      "Linked document-control record was not found",
    );
  }

  return record;
};

const assertRevisionActionType = (recordType) => {
  if (!REVISION_ACTION_RECORD_TYPES.includes(recordType)) {
    throw new HttpError(
      400,
      "DOCUMENT_RECORD_TYPE_UNSUPPORTED",
      "Revisions can only be linked to RFI, submittal, drawing, and transmittal records",
    );
  }
};

const resolveProjectDocument = async ({ orgId, projectId, payload }) => {
  const key = trimOrNull(
    payload.projectDocumentId ||
      payload.documentId ||
      payload.storageKey ||
      payload.key,
  );
  if (!key) {
    throw new HttpError(
      400,
      "DOCUMENT_REVISION_FILE_REQUIRED",
      "A private project document id or storage key is required for revision upload",
    );
  }

  const document = await prisma.projectDocument.findFirst({
    where: {
      orgId,
      projectId,
      OR: [{ id: key }, { storageKey: key }],
    },
  });

  if (!document) {
    throw new HttpError(
      404,
      "FILE_NOT_FOUND",
      "Revision source file not found",
    );
  }

  if (document.scanStatus !== "clean") {
    throw new HttpError(
      409,
      "FILE_NOT_AVAILABLE",
      "Revision file is not cleared for document-control use",
    );
  }

  if (!["available", "linked"].includes(document.status)) {
    throw new HttpError(
      409,
      "FILE_NOT_AVAILABLE",
      "Revision file is not available for linking",
    );
  }

  return document;
};

const revisionSummary = (revision) => ({
  id: revision.id,
  recordType: revision.recordType,
  recordId: revision.recordId,
  revision: revision.revision,
  status: revision.status || null,
  isLatest: Boolean(revision.isLatest),
  projectDocumentId: revision.projectDocumentId || null,
  category: revision.category || null,
  folderPath: revision.folderPath || null,
  fileName: revision.fileName || null,
});

const getDocControlDashboard = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const [rfis, submittals, drawings, transmittals, correspondence] =
    await Promise.all([
      prisma.rfi.findMany({ where: { projectId } }),
      prisma.submittal.findMany({ where: { projectId } }),
      prisma.drawingRecord.findMany({ where: { projectId } }),
      prisma.transmittal.findMany({ where: { projectId } }),
      prisma.correspondence.findMany({ where: { projectId } }),
    ]);

  const now = Date.now();
  const avgRfiTurnaroundDays = (() => {
    const closed = rfis.filter((row) => row.answeredDate && row.raisedDate);
    if (!closed.length) return 0;
    const total = closed.reduce((sum, row) => {
      const diff =
        new Date(row.answeredDate).getTime() -
        new Date(row.raisedDate).getTime();
      return sum + diff / (1000 * 60 * 60 * 24);
    }, 0);
    return total / closed.length;
  })();
  const dueAlerts = [
    ...rfis,
    ...submittals,
    ...drawings,
    ...transmittals,
    ...correspondence,
  ]
    .map(dueAlertForRecord)
    .filter(Boolean);

  return {
    metrics: {
      rfiOpen: rfis.filter((row) => row.status !== "closed").length,
      rfiOverdue: rfis.filter(
        (row) =>
          row.status !== "closed" &&
          row.responseRequiredBy &&
          new Date(row.responseRequiredBy).getTime() < now,
      ).length,
      avgRfiTurnaroundDays,
      submittalPending: submittals.filter((row) => row.status === "pending")
        .length,
      submittalResubmit: submittals.filter((row) => row.status === "resubmit")
        .length,
      drawingsActive: drawings.filter((row) => row.status === "active").length,
      drawingsSuperseded: drawings.filter((row) => row.status === "superseded")
        .length,
      transmittalPendingAck: transmittals.filter(
        (row) => row.status === "pending_ack",
      ).length,
      contractualNotices: correspondence.filter((row) => row.contractualNotice)
        .length,
      dueAlerts: dueAlerts.length,
      overdue: dueAlerts.filter((alert) => alert.severity === "overdue").length,
    },
  };
};

const listDocumentRegister = async ({
  orgId,
  projectId,
  query = {},
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const requestedType = trimOrNull(query.recordType);
  const recordTypes =
    requestedType && REGISTER_RECORD_TYPES.includes(requestedType)
      ? [requestedType]
      : REGISTER_RECORD_TYPES;

  const recordSets = await Promise.all(
    recordTypes.map(async (recordType) => {
      const delegate = RECORD_DELEGATES[recordType];
      const records = await prisma[delegate].findMany({
        where: { projectId },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });
      return attachWorkflowDetailsToRecords({
        projectId,
        recordType,
        records,
      }).then((rows) => ({ recordType, rows }));
    }),
  );

  const search = trimOrNull(query.search)?.toLowerCase();
  const status = trimOrNull(query.status);
  const category = trimOrNull(query.category);
  const folder = trimOrNull(query.folder);

  const baseRows = recordSets
    .flatMap(({ recordType, rows: records }) =>
      records.map((record) =>
        registerRowForRecord({ projectId, recordType, record, userRole }),
      ),
    )
    .filter((row) => {
      if (category && row.category !== category) return false;
      if (
        status &&
        row.status !== status &&
        row.latestRevision?.status !== status
      ) {
        return false;
      }
      if (!search) return true;
      return [
        row.recordType,
        row.ref,
        row.title,
        row.status,
        row.currentRevision,
        row.latestRevision?.revision,
        row.latestRevision?.fileName,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    })
    .sort((a, b) => {
      const aTime = new Date(
        a.latestRevision?.issuedAt || a.updatedAt || 0,
      ).getTime();
      const bTime = new Date(
        b.latestRevision?.issuedAt || b.updatedAt || 0,
      ).getTime();
      return bTime - aTime;
    });

  const allRows =
    folder && folder !== "all"
      ? baseRows.filter((row) => row.folderKey === folder)
      : baseRows;

  const folderCounts = DOCUMENT_FOLDERS.map((folder) => ({
    ...folder,
    count: baseRows.filter((row) => row.folderKey === folder.key).length,
  }));

  return {
    rows: allRows,
    folders: [
      {
        key: "all",
        label: "All documents",
        recordTypes: REGISTER_RECORD_TYPES,
        count: baseRows.length,
      },
      ...folderCounts,
    ],
    summary: {
      records: allRows.length,
      latestApproved: allRows.filter(
        (row) => statusLabel(row.latestRevision?.status) === "approved",
      ).length,
      supersededRevisions: allRows.reduce(
        (sum, row) => sum + row.supersededRevisionCount,
        0,
      ),
      missingRevision: allRows.filter((row) => !row.latestRevision).length,
      currentOnly: !canViewRevisionHistory(userRole),
    },
  };
};

const uploadDocumentRevision = async ({
  orgId,
  projectId,
  recordType,
  recordId,
  payload,
  userId = null,
  userRole = null,
}) => {
  assertRevisionActionType(recordType);
  await ensureProject({ orgId, projectId });
  const record = await getRecord({ projectId, recordType, recordId });
  const document = await resolveProjectDocument({ orgId, projectId, payload });
  const revision = trimOrNull(payload.revision);
  const metadata = documentMetadataFromPayload({ payload, recordType, record });
  const requestedStatus = trimOrNull(payload.status) || "uploaded";

  if (!revision) {
    throw new HttpError(
      400,
      "DOCUMENT_REVISION_REQUIRED",
      "Revision code is required",
    );
  }

  const existing = await prisma.documentRevision.findFirst({
    where: { projectId, recordType, recordId, revision },
  });

  if (existing) {
    throw new HttpError(
      409,
      "DOCUMENT_REVISION_EXISTS",
      "This revision already exists for the record",
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.documentRevision.create({
      data: {
        projectId,
        projectDocumentId: document.id,
        recordType,
        recordId,
        revision,
        status: requestedStatus,
        title: metadata.title,
        documentNumber: metadata.documentNumber,
        category: metadata.category,
        folderPath: metadata.folderPath,
        discipline: metadata.discipline,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        fileName: trimOrNull(payload.fileName) || document.fileName,
        fileUrl: null,
        storageKey: document.id,
        isLatest: false,
        issuedBy: trimOrNull(payload.issuedBy) || userId || null,
        issuedAt: payload.issuedAt ? new Date(payload.issuedAt) : new Date(),
        submittedBy: requestedStatus === "submitted" ? userId || null : null,
        submittedAt: requestedStatus === "submitted" ? new Date() : null,
        reviewDueAt: metadata.reviewDueAt,
        notes: trimOrNull(payload.notes),
      },
    });

    await tx.projectDocument.update({
      where: { id: document.id },
      data: {
        status: "linked",
        linkedEntityType: recordType,
        linkedEntityId: recordId,
        title: metadata.title,
        documentNumber: metadata.documentNumber,
        category: metadata.category,
        folderPath: metadata.folderPath,
        discipline: metadata.discipline,
        confidentiality: metadata.confidentiality,
      },
    });

    if (tx.workflowAttachment?.create) {
      await tx.workflowAttachment.create({
        data: {
          projectId,
          recordType,
          recordId,
          fileName: document.fileName,
          fileUrl: `/api/v1/projects/${projectId}/doc-control/revisions/${row.id}/download`,
          storageKey: document.id,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          description: trimOrNull(payload.notes) || `Revision ${revision}`,
          uploadedBy: userId || document.uploadedBy || null,
          uploadedAt: new Date(),
        },
      });
    }

    await recordWorkflowHistory({
      tx,
      projectId,
      recordType,
      recordId,
      oldStatus: record.status,
      newStatus: record.status,
      comment: trimOrNull(payload.notes) || `Revision ${revision} uploaded`,
      userId,
      userRole,
      force: true,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.DOCUMENT_REVISION,
      entityId: row.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: null,
      newStatus: row.status,
      reason: trimOrNull(payload.notes),
      newSummary: revisionSummary(row),
      summary: {
        recordType,
        recordId,
        ref: recordRef(recordType, record),
        revision,
      },
      metadata: { source: "document_control.revision_upload" },
    });

    return row;
  });

  return serializeRevision(created, projectId);
};

const submitDocumentRevisionForReview = async ({
  orgId,
  projectId,
  revisionId,
  comment = null,
  reviewDueAt = null,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  const existing = await prisma.documentRevision.findFirst({
    where: { id: revisionId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      "DOCUMENT_REVISION_NOT_FOUND",
      "Document revision not found",
    );
  }

  if (statusLabel(existing.status) === "superseded") {
    throw new HttpError(
      409,
      "DOCUMENT_REVISION_SUPERSEDED_READ_ONLY",
      "Superseded revisions are read-only",
    );
  }

  if (statusLabel(existing.status) === "approved") {
    throw new HttpError(
      409,
      "DOCUMENT_REVISION_ALREADY_APPROVED",
      "Approved revisions cannot be resubmitted for review",
    );
  }

  const record = await getRecord({
    projectId,
    recordType: existing.recordType,
    recordId: existing.recordId,
  });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.documentRevision.update({
      where: { id: revisionId },
      data: {
        status: "submitted",
        submittedBy: userId || null,
        submittedAt: new Date(),
        reviewDueAt: reviewDueAt ? new Date(reviewDueAt) : existing.reviewDueAt,
        notes: trimOrNull(comment) || existing.notes,
      },
    });

    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: existing.recordType,
      recordId: existing.recordId,
      oldStatus: record.status,
      newStatus: record.status,
      comment: trimOrNull(comment) || `Revision ${row.revision} submitted for review`,
      userId,
      userRole,
      force: true,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.DOCUMENT_REVISION,
      entityId: row.id,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: row.status,
      reason: trimOrNull(comment),
      oldSummary: revisionSummary(existing),
      newSummary: revisionSummary(row),
      summary: {
        recordType: row.recordType,
        recordId: row.recordId,
        revision: row.revision,
      },
      metadata: { source: "document_control.revision_submit_review" },
    });

    return row;
  });

  return serializeRevision(updated, projectId);
};

const approveDocumentRevision = async ({
  orgId,
  projectId,
  revisionId,
  comment = null,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  const existing = await prisma.documentRevision.findFirst({
    where: { id: revisionId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      "DOCUMENT_REVISION_NOT_FOUND",
      "Document revision not found",
    );
  }

  if (statusLabel(existing.status) === "superseded") {
    throw new HttpError(
      409,
      "DOCUMENT_REVISION_SUPERSEDED_READ_ONLY",
      "Superseded revisions are read-only",
    );
  }

  const record = await getRecord({
    projectId,
    recordType: existing.recordType,
    recordId: existing.recordId,
  });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.documentRevision.updateMany({
      where: {
        projectId,
        recordType: existing.recordType,
        recordId: existing.recordId,
        isLatest: true,
        id: { not: existing.id },
      },
      data: {
        status: "superseded",
        isLatest: false,
        supersededBy: userId || null,
        supersededAt: new Date(),
      },
    });

    const row = await tx.documentRevision.update({
      where: { id: revisionId },
      data: {
        status: "approved",
        isLatest: true,
        approvedBy: userId || null,
        approvedAt: new Date(),
        notes: trimOrNull(comment) || existing.notes,
      },
    });

    if (existing.recordType === RECORD_TYPES.DRAWING) {
      await tx.drawingRecord.update({
        where: { id: existing.recordId },
        data: { revision: row.revision, status: "active" },
      });
    }
    if (existing.recordType === RECORD_TYPES.SUBMITTAL) {
      await tx.submittal.update({
        where: { id: existing.recordId },
        data: { revision: row.revision },
      });
    }

    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: existing.recordType,
      recordId: existing.recordId,
      oldStatus: record.status,
      newStatus: record.status,
      comment: trimOrNull(comment) || `Revision ${row.revision} approved`,
      userId,
      userRole,
      force: true,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.DOCUMENT_REVISION,
      entityId: row.id,
      action: auditService.ACTIONS.APPROVED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: row.status,
      reason: trimOrNull(comment),
      oldSummary: revisionSummary(existing),
      newSummary: revisionSummary(row),
      summary: {
        recordType: row.recordType,
        recordId: row.recordId,
        revision: row.revision,
      },
      metadata: { source: "document_control.revision_approve" },
    });

    return row;
  });

  return serializeRevision(updated, projectId);
};

const supersedeDocumentRevision = async ({
  orgId,
  projectId,
  revisionId,
  reason,
  userId = null,
  userRole = null,
}) => {
  const supersedeReason = trimOrNull(reason);
  if (!supersedeReason) {
    throw new HttpError(
      400,
      "DOCUMENT_REVISION_SUPERSEDE_REASON_REQUIRED",
      "A reason is required to supersede a revision",
    );
  }

  await ensureProject({ orgId, projectId });
  const existing = await prisma.documentRevision.findFirst({
    where: { id: revisionId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      "DOCUMENT_REVISION_NOT_FOUND",
      "Document revision not found",
    );
  }

  if (statusLabel(existing.status) === "superseded") {
    throw new HttpError(
      409,
      "DOCUMENT_REVISION_SUPERSEDED_READ_ONLY",
      "Superseded revisions are already read-only",
    );
  }

  const record = await getRecord({
    projectId,
    recordType: existing.recordType,
    recordId: existing.recordId,
  });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.documentRevision.update({
      where: { id: revisionId },
      data: {
        status: "superseded",
        isLatest: false,
        supersededBy: userId || null,
        supersededAt: new Date(),
        notes: supersedeReason,
      },
    });

    if (existing.recordType === RECORD_TYPES.DRAWING && existing.isLatest) {
      await tx.drawingRecord.update({
        where: { id: existing.recordId },
        data: { status: "superseded" },
      });
    }

    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: existing.recordType,
      recordId: existing.recordId,
      oldStatus: record.status,
      newStatus: record.status,
      comment: supersedeReason,
      userId,
      userRole,
      force: true,
    });

    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.DOCUMENT_REVISION,
      entityId: row.id,
      action: auditService.ACTIONS.SUPERSEDED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: row.status,
      reason: supersedeReason,
      oldSummary: revisionSummary(existing),
      newSummary: revisionSummary(row),
      summary: {
        recordType: row.recordType,
        recordId: row.recordId,
        revision: row.revision,
      },
      metadata: { source: "document_control.revision_supersede" },
    });

    return row;
  });

  return serializeRevision(updated, projectId);
};

const assertRevisionReadableForRole = ({ revision, userRole }) => {
  if (canViewRevisionHistory(userRole)) return;
  if (isCurrentApprovedRevision(revision)) return;
  throw new HttpError(
    403,
    "DOCUMENT_REVISION_HISTORY_FORBIDDEN",
    "Only the current approved revision is available for this role",
  );
};

const getRevisionFile = async ({
  orgId,
  projectId,
  revisionId,
  userId = null,
  userRole = null,
  accessAction = null,
}) => {
  await ensureProject({ orgId, projectId });
  const revision = await prisma.documentRevision.findFirst({
    where: { id: revisionId, projectId },
  });

  if (!revision) {
    throw new HttpError(
      404,
      "DOCUMENT_REVISION_NOT_FOUND",
      "Document revision not found",
    );
  }

  assertRevisionReadableForRole({ revision, userRole });

  const key = revision.projectDocumentId || revision.storageKey;
  if (!key) {
    throw new HttpError(404, "FILE_NOT_FOUND", "Revision has no stored file");
  }

  const file = await fileStorageService.getWorkflowFile({ orgId, projectId, key });

  if (accessAction && userId) {
    await auditService.recordEvent({
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.DOCUMENT_REVISION,
      entityId: revision.id,
      action: accessAction,
      actorId: userId,
      actorRole: userRole,
      oldStatus: revision.status,
      newStatus: revision.status,
      newSummary: revisionSummary(revision),
      summary: {
        recordType: revision.recordType,
        recordId: revision.recordId,
        revision: revision.revision,
        fileName: revision.fileName || file.fileName || null,
      },
      metadata: { source: `document_control.revision_${accessAction}` },
    });
  }

  return file;
};

const getRevisionDownloadFile = (params) => getRevisionFile(params);

const getRevisionPreviewFile = (params) => getRevisionFile(params);

module.exports = {
  getDocControlDashboard,
  listDocumentRegister,
  uploadDocumentRevision,
  submitDocumentRevisionForReview,
  approveDocumentRevision,
  supersedeDocumentRevision,
  getRevisionDownloadFile,
  getRevisionPreviewFile,
};
