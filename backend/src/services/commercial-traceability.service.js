const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const approvalWorkflowService = require("./approval-workflow.service");

const RECORD_TYPES = Object.freeze({
  CHANGE_ORDER: "change_order",
  IPC_ITEM: "ipc_item",
  SUB_VALUATION: "sub_valuation",
  EOT_CLAIM: "eot_claim",
  WEATHER_DELAY: "weather_delay",
});

const toArray = (value) => (Array.isArray(value) ? value : []);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const compactRecordId = (value) => trimOrNull(value);

const getEvidencePayload = (payload = {}) => ({
  correspondence:
    payload.correspondenceLinks !== undefined
      ? payload.correspondenceLinks
      : payload.correspondenceIds,
  attachments:
    payload.attachmentRefs !== undefined
      ? payload.attachmentRefs
      : payload.attachments !== undefined
        ? payload.attachments
        : payload.supportingDocumentIds !== undefined
          ? payload.supportingDocumentIds
          : payload.documentIds,
});

const normalizeCorrespondenceLinks = (value) => {
  if (value === undefined) return null;

  return toArray(value)
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          correspondenceId: compactRecordId(entry),
          relationType: "supporting",
          notes: null,
        };
      }

      return {
        correspondenceId: compactRecordId(entry?.correspondenceId || entry?.id),
        relationType: trimOrNull(entry?.relationType) || "supporting",
        notes: trimOrNull(entry?.notes),
      };
    })
    .filter((entry) => entry.correspondenceId);
};

const normalizeAttachmentRefs = (value, userId = null) => {
  if (value === undefined) return null;

  return toArray(value)
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          documentId: compactRecordId(entry),
          fileName: null,
          fileUrl: null,
          storageKey: null,
          mimeType: null,
          sizeBytes: null,
          sha256: null,
          scanStatus: null,
          description: null,
          uploadedBy: userId || null,
        };
      }

      return {
        documentId: compactRecordId(
          entry?.documentId || entry?.projectDocumentId,
        ),
        fileName: trimOrNull(
          entry?.fileName ||
            entry?.filename ||
            entry?.originalName ||
            entry?.name,
        ),
        fileUrl: trimOrNull(entry?.fileUrl || entry?.downloadUrl || entry?.url),
        storageKey: trimOrNull(entry?.storageKey || entry?.key),
        mimeType: trimOrNull(entry?.mimeType || entry?.type),
        sizeBytes:
          entry?.sizeBytes !== undefined
            ? Number(entry.sizeBytes) || null
            : entry?.size !== undefined
              ? Number(entry.size) || null
              : null,
        sha256: trimOrNull(entry?.sha256),
        scanStatus: trimOrNull(entry?.scanStatus),
        description: trimOrNull(entry?.description),
        uploadedBy: trimOrNull(entry?.uploadedBy) || userId || null,
      };
    })
    .filter(
      (entry) =>
        entry.documentId || entry.fileUrl || entry.storageKey || entry.fileName,
    );
};

const ensureCorrespondence = async ({ tx, projectId, links }) => {
  if (links.length === 0) return;

  const ids = [...new Set(links.map((link) => link.correspondenceId))];
  const rows = await tx.correspondence.findMany({
    where: { projectId, id: { in: ids } },
    select: { id: true },
  });
  const found = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      "COMMERCIAL_CORRESPONDENCE_NOT_FOUND",
      "One or more correspondence references were not found in this project",
    );
  }
};

const ensureProjectDocuments = async ({ tx, projectId, attachments }) => {
  const documentIds = [
    ...new Set(
      (attachments || []).map((entry) => entry.documentId).filter(Boolean),
    ),
  ];
  if (documentIds.length === 0) return new Map();

  if (!tx.projectDocument?.findMany) {
    throw new HttpError(
      500,
      "COMMERCIAL_DOCUMENT_VALIDATION_UNAVAILABLE",
      "Project document validation is unavailable",
    );
  }

  const documents = await tx.projectDocument.findMany({
    where: {
      projectId,
      id: { in: documentIds },
      scanStatus: "clean",
    },
    select: {
      id: true,
      fileName: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      storageKey: true,
      scanStatus: true,
      uploadedBy: true,
      documentType: true,
      status: true,
    },
  });

  const documentById = new Map(
    documents.map((document) => [document.id, document]),
  );
  const missing = documentIds.filter((id) => !documentById.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      "COMMERCIAL_DOCUMENT_NOT_FOUND",
      "One or more supporting documents were not found, not clean, or outside this project",
    );
  }

  return documentById;
};

const syncEvidenceReferences = async ({
  tx,
  projectId,
  recordType,
  recordId,
  payload = {},
  userId = null,
}) => {
  const evidencePayload = getEvidencePayload(payload);
  const correspondenceLinks = normalizeCorrespondenceLinks(
    evidencePayload.correspondence,
  );
  const attachmentRefs = normalizeAttachmentRefs(
    evidencePayload.attachments,
    userId,
  );
  const documentById = await ensureProjectDocuments({
    tx,
    projectId,
    attachments: attachmentRefs || [],
  });
  // Evidence is a read grant to every reader of the commercial record: it
  // cites only a document its writer may read, or their own new upload; the
  // evidence the record already cites stays as it is (certification R29).
  // Refused as a missing document is.
  if (documentById.size > 0) {
    await require("./document-text.service").assertDocumentsLinkable({
      projectId,
      keys: [...documentById.keys()],
      unchanged: async () =>
        tx.commercialAttachmentRef?.findMany
          ? (
              await tx.commercialAttachmentRef.findMany({
                where: { projectId, recordType, recordId },
                select: { documentId: true },
              })
            ).map((row) => row.documentId)
          : [],
      userId,
      refuse: () =>
        new HttpError(
          400,
          "COMMERCIAL_DOCUMENT_NOT_FOUND",
          "One or more supporting documents were not found, not clean, or outside this project",
        ),
    });
  }

  const result = {
    correspondenceCount: null,
    attachmentCount: null,
    attachments: attachmentRefs || [],
  };

  if (correspondenceLinks !== null) {
    await ensureCorrespondence({ tx, projectId, links: correspondenceLinks });
    await tx.commercialCorrespondenceLink.deleteMany({
      where: { projectId, recordType, recordId },
    });
    if (correspondenceLinks.length > 0) {
      await tx.commercialCorrespondenceLink.createMany({
        data: correspondenceLinks.map((link) => ({
          projectId,
          recordType,
          recordId,
          correspondenceId: link.correspondenceId,
          relationType: link.relationType,
          notes: link.notes,
        })),
        skipDuplicates: true,
      });
    }
    result.correspondenceCount = correspondenceLinks.length;
  }

  if (attachmentRefs !== null) {
    await tx.commercialAttachmentRef.deleteMany({
      where: { projectId, recordType, recordId },
    });
    if (attachmentRefs.length > 0) {
      await tx.commercialAttachmentRef.createMany({
        data: attachmentRefs.map((attachment) => {
          const document = attachment.documentId
            ? documentById.get(attachment.documentId)
            : null;
          return {
            projectId,
            recordType,
            recordId,
            documentId: attachment.documentId || null,
            fileName:
              attachment.fileName ||
              document?.fileName ||
              document?.originalName ||
              null,
            fileUrl:
              attachment.fileUrl ||
              (document
                ? `/api/v1/projects/${projectId}/workflow/uploads/${document.id}`
                : null),
            storageKey: attachment.storageKey || document?.storageKey || null,
            mimeType: attachment.mimeType || document?.mimeType || null,
            sizeBytes: attachment.sizeBytes || document?.sizeBytes || null,
            sha256: attachment.sha256 || document?.sha256 || null,
            scanStatus: attachment.scanStatus || document?.scanStatus || null,
            description: attachment.description,
            uploadedBy: attachment.uploadedBy || document?.uploadedBy || null,
          };
        }),
      });
    }
    result.attachmentCount = attachmentRefs.length;
  }

  if (documentById.size > 0 && tx.projectDocument?.updateMany) {
    await tx.projectDocument.updateMany({
      where: {
        projectId,
        id: { in: [...documentById.keys()] },
      },
      data: {
        status: "linked",
        linkedEntityType: recordType,
        linkedEntityId: recordId,
      },
    });
  }

  return result;
};

const groupByRecordId = (rows, getRecordId = (row) => row.recordId) =>
  rows.reduce((acc, row) => {
    const recordId = getRecordId(row);
    if (!acc.has(recordId)) acc.set(recordId, []);
    acc.get(recordId).push(row);
    return acc;
  }, new Map());

const serializeAuditEvent =
  typeof auditService.serializeEvent === "function"
    ? auditService.serializeEvent
    : (event) => event;

const attachEvidenceToRecords = async ({
  tx = prisma,
  projectId,
  recordType,
  records,
  idSelector = (record) => record.id,
}) => {
  const rows = toArray(records);
  const ids = rows.map(idSelector).filter(Boolean);
  if (ids.length === 0) return rows;

  if (
    !tx.commercialCorrespondenceLink?.findMany ||
    !tx.commercialAttachmentRef?.findMany ||
    !tx.auditEvent?.findMany
  ) {
    return rows.map((record) => ({
      ...record,
      correspondenceLinks: [],
      attachmentRefs: [],
      approvalHistory: [],
    }));
  }

  const [
    correspondenceLinks,
    attachmentRefs,
    auditEvents,
    approvalHistoryById,
  ] = await Promise.all([
    tx.commercialCorrespondenceLink.findMany({
      where: { projectId, recordType, recordId: { in: ids } },
      include: {
        correspondence: {
          select: {
            id: true,
            ref: true,
            direction: true,
            type: true,
            subject: true,
            contractualNotice: true,
            date: true,
            status: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    }),
    tx.commercialAttachmentRef.findMany({
      where: { projectId, recordType, recordId: { in: ids } },
      include: {
        projectDocument: {
          select: {
            id: true,
            fileName: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            scanStatus: true,
            uploadedAt: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    }),
    tx.auditEvent.findMany({
      where: {
        projectId,
        entityType: recordType,
        entityId: { in: ids },
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
    approvalWorkflowService.listEventsForRecords({
      tx,
      projectId,
      recordType,
      recordIds: ids,
    }),
  ]);

  const correspondenceById = groupByRecordId(correspondenceLinks);
  const attachmentsById = groupByRecordId(attachmentRefs);
  const auditById = groupByRecordId(auditEvents, (event) => event.entityId);

  return rows.map((record) => {
    const id = idSelector(record);
    return {
      ...record,
      correspondenceLinks: correspondenceById.get(id) || [],
      attachmentRefs: attachmentsById.get(id) || [],
      approvalHistory:
        approvalHistoryById.get(id) ||
        (auditById.get(id) || []).map(serializeAuditEvent),
    };
  });
};

module.exports = {
  RECORD_TYPES,
  attachEvidenceToRecords,
  syncEvidenceReferences,
};
