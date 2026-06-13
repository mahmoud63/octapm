const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const approvalWorkflowService = require("./approval-workflow.service");

const RECORD_TYPES = Object.freeze({
  NCR: "ncr",
  ITP: "itp",
  DEFECT: "defect",
  SAFETY_INCIDENT: "safety_incident",
  MATERIAL_TEST: "material_test",
  RFI: "rfi",
  SUBMITTAL: "submittal",
  DRAWING: "drawing",
  TRANSMITTAL: "transmittal",
  CORRESPONDENCE: "correspondence",
});

const DOCUMENT_RECORD_TYPES = new Set([
  RECORD_TYPES.RFI,
  RECORD_TYPES.SUBMITTAL,
  RECORD_TYPES.DRAWING,
  RECORD_TYPES.TRANSMITTAL,
  RECORD_TYPES.CORRESPONDENCE,
]);

const toArray = (value) => (Array.isArray(value) ? value : []);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const maybeDate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  return new Date(value);
};

const normalizeTextField = (payload, existing, field) => {
  if (payload[field] === undefined) return existing?.[field] ?? null;
  return trimOrNull(payload[field]);
};

const assignmentData = (payload = {}, existing = {}) => ({
  owner: normalizeTextField(payload, existing, "owner"),
  reviewer: normalizeTextField(payload, existing, "reviewer"),
  approver: normalizeTextField(payload, existing, "approver"),
});

const PARTY_ASSIGNMENT_FIELDS = [
  ["ownerPartyId", "owner"],
  ["reviewerPartyId", "reviewer"],
  ["approverPartyId", "approver"],
];

const workflowPartyAssignmentData = async ({
  tx = prisma,
  projectId,
  payload = {},
  existing = {},
}) => {
  const data = assignmentData(payload, existing);
  const requested = PARTY_ASSIGNMENT_FIELDS.filter(
    ([field]) => payload[field] !== undefined,
  );

  if (!requested.length) return data;

  const requestedIds = requested
    .map(([field]) => trimOrNull(payload[field]))
    .filter(Boolean);
  const uniqueIds = [...new Set(requestedIds)];

  const partyRows = uniqueIds.length
    ? await tx.projectParty.findMany({
        where: {
          id: { in: uniqueIds },
          projectId,
          status: "active",
        },
        include: {
          company: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
    : [];
  const partiesById = new Map(partyRows.map((row) => [row.id, row]));
  const missing = uniqueIds.filter((id) => !partiesById.has(id));

  if (missing.length) {
    throw new HttpError(
      400,
      "WORKFLOW_PROJECT_PARTY_NOT_FOUND",
      "One or more routed project parties were not found in this project",
    );
  }

  for (const [partyField, textField] of requested) {
    const partyId = trimOrNull(payload[partyField]);
    data[partyField] = partyId;

    if (partyId && payload[textField] === undefined) {
      data[textField] = partiesById.get(partyId)?.company?.name || null;
    }
  }

  return data;
};

const normalizeActivityLinks = (payload = {}) => {
  const raw =
    payload.activityLinks !== undefined
      ? payload.activityLinks
      : payload.activityIds;

  if (raw === undefined) {
    if (payload.activityId !== undefined) {
      return payload.activityId
        ? [
            {
              activityId: trimOrNull(payload.activityId),
              relationType: "primary",
              scheduleImpactDays: 0,
              notes: null,
            },
          ]
        : [];
    }
    return null;
  }

  return toArray(raw)
    .map((entry, index) => {
      if (typeof entry === "string") {
        return {
          activityId: trimOrNull(entry),
          relationType: index === 0 ? "primary" : "affected",
          scheduleImpactDays: 0,
          notes: null,
        };
      }

      return {
        activityId: trimOrNull(entry?.activityId || entry?.id),
        relationType:
          trimOrNull(entry?.relationType) ||
          (index === 0 ? "primary" : "affected"),
        scheduleImpactDays: Number(entry?.scheduleImpactDays) || 0,
        notes: trimOrNull(entry?.notes),
      };
    })
    .filter((entry) => entry.activityId);
};

const primaryActivityIdFromPayload = (
  payload = {},
  existingActivityId = null,
) => {
  const links = normalizeActivityLinks(payload);
  if (links !== null) return links[0]?.activityId || null;
  if (payload.activityId !== undefined) return payload.activityId || null;
  return existingActivityId || null;
};

const normalizeAttachmentRefs = (value, userId = null) => {
  if (value === undefined) return null;

  return toArray(value)
    .map((entry) => ({
      fileName: trimOrNull(entry?.fileName || entry?.filename || entry?.name),
      fileUrl: trimOrNull(entry?.fileUrl || entry?.url),
      storageKey: trimOrNull(entry?.storageKey || entry?.key),
      mimeType: trimOrNull(entry?.mimeType || entry?.type),
      sizeBytes:
        entry?.sizeBytes !== undefined || entry?.size !== undefined
          ? Number(entry.sizeBytes ?? entry.size) || 0
          : null,
      description: trimOrNull(entry?.description),
      uploadedBy: trimOrNull(entry?.uploadedBy) || userId || null,
      uploadedAt: maybeDate(entry?.uploadedAt) || new Date(),
    }))
    .filter((entry) => entry.fileUrl || entry.storageKey || entry.fileName);
};

const normalizeRevisionRefs = (payload = {}, row = {}, userId = null) => {
  const explicit =
    payload.revisions !== undefined ? toArray(payload.revisions) : null;
  const rows = [];

  if (explicit) {
    rows.push(
      ...explicit
        .map((entry) => ({
          projectDocumentId: trimOrNull(
            entry?.projectDocumentId || entry?.documentId,
          ),
          revision: trimOrNull(entry?.revision),
          status: trimOrNull(entry?.status),
          title: trimOrNull(entry?.title || entry?.fileName || entry?.name),
          fileName: trimOrNull(
            entry?.fileName || entry?.filename || entry?.name,
          ),
          fileUrl: trimOrNull(entry?.fileUrl || entry?.url),
          storageKey: trimOrNull(
            entry?.storageKey ||
              entry?.key ||
              entry?.projectDocumentId ||
              entry?.documentId,
          ),
          isLatest: Boolean(entry?.isLatest),
          issuedBy: trimOrNull(entry?.issuedBy) || userId || null,
          issuedAt: maybeDate(entry?.issuedAt) || new Date(),
          approvedBy: trimOrNull(entry?.approvedBy),
          approvedAt: maybeDate(entry?.approvedAt),
          supersededBy: trimOrNull(entry?.supersededBy),
          supersededAt: maybeDate(entry?.supersededAt),
          notes: trimOrNull(entry?.notes),
        }))
        .filter((entry) => entry.revision),
    );
  }

  const revision = trimOrNull(payload.revision ?? row.revision);
  if (revision) {
    rows.push({
      projectDocumentId: trimOrNull(
        payload.projectDocumentId || payload.documentId,
      ),
      revision,
      status: trimOrNull(payload.status ?? row.status),
      title: trimOrNull(
        payload.title ?? row.title ?? row.subject ?? row.drawingNumber,
      ),
      fileName: trimOrNull(payload.fileName),
      fileUrl: trimOrNull(payload.fileUrl ?? row.fileUrl),
      storageKey: trimOrNull(
        payload.storageKey || payload.projectDocumentId || payload.documentId,
      ),
      isLatest: Boolean(payload.isLatest),
      issuedBy: trimOrNull(payload.issuedBy) || userId || null,
      issuedAt: maybeDate(payload.issuedAt || payload.issueDate) || new Date(),
      approvedBy: trimOrNull(payload.approvedBy),
      approvedAt: maybeDate(payload.approvedAt),
      supersededBy: trimOrNull(payload.supersededBy),
      supersededAt: maybeDate(payload.supersededAt),
      notes: trimOrNull(
        payload.revisionNotes || payload.notes || payload.remarks,
      ),
    });
  }

  if (!revision && row.id && DOCUMENT_RECORD_TYPES.has(row.recordType)) {
    rows.push({
      projectDocumentId: null,
      revision: "1",
      status: trimOrNull(row.status),
      title: trimOrNull(row.subject || row.title || row.ref),
      fileName: null,
      fileUrl: trimOrNull(row.fileUrl),
      storageKey: null,
      isLatest: false,
      issuedBy: userId || null,
      issuedAt: new Date(),
      approvedBy: null,
      approvedAt: null,
      supersededBy: null,
      supersededAt: null,
      notes: null,
    });
  }

  const unique = new Map();
  for (const entry of rows) {
    if (!unique.has(entry.revision)) unique.set(entry.revision, entry);
  }
  return [...unique.values()];
};

const ensureActivities = async ({ tx, projectId, links }) => {
  if (!links.length) return;
  if (!tx.activity?.findMany) return;

  const ids = [...new Set(links.map((link) => link.activityId))];
  const rows = await tx.activity.findMany({
    where: { projectId, id: { in: ids } },
    select: { id: true },
  });
  const found = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new HttpError(
      400,
      "WORKFLOW_ACTIVITY_NOT_FOUND",
      "One or more linked activities were not found in this project",
    );
  }
};

const syncWorkflowReferences = async ({
  tx,
  projectId,
  recordType,
  recordId,
  payload = {},
  userId = null,
}) => {
  const links = normalizeActivityLinks(payload);
  const attachments = normalizeAttachmentRefs(
    payload.attachmentRefs !== undefined
      ? payload.attachmentRefs
      : payload.attachments,
    userId,
  );

  const result = {
    activityLinkCount: null,
    attachmentCount: null,
  };

  if (links !== null) {
    await ensureActivities({ tx, projectId, links });
    await tx.workflowActivityLink.deleteMany({
      where: { projectId, recordType, recordId },
    });
    if (links.length > 0) {
      await tx.workflowActivityLink.createMany({
        data: links.map((link) => ({
          projectId,
          recordType,
          recordId,
          activityId: link.activityId,
          relationType: link.relationType,
          scheduleImpactDays: link.scheduleImpactDays,
          notes: link.notes,
        })),
        skipDuplicates: true,
      });
    }
    result.activityLinkCount = links.length;
  }

  if (attachments !== null) {
    await tx.workflowAttachment.deleteMany({
      where: { projectId, recordType, recordId },
    });
    if (attachments.length > 0) {
      await tx.workflowAttachment.createMany({
        data: attachments.map((attachment) => ({
          projectId,
          recordType,
          recordId,
          ...attachment,
        })),
      });
    }
    result.attachmentCount = attachments.length;
  }

  return result;
};

const recordWorkflowHistory = async ({
  tx,
  projectId,
  recordType,
  recordId,
  oldStatus = null,
  newStatus = null,
  comment = null,
  userId = null,
  userRole = null,
  force = false,
}) => {
  const trimmedComment = trimOrNull(comment);
  const hasStatusChange = (oldStatus || null) !== (newStatus || null);
  if (!force && !hasStatusChange && !trimmedComment) return null;
  if (!tx.workflowStatusHistory?.create) return null;

  return tx.workflowStatusHistory.create({
    data: {
      projectId,
      recordType,
      recordId,
      oldStatus: oldStatus || null,
      newStatus: newStatus || null,
      comment: trimmedComment,
      createdBy: userId || null,
      actorRole: userRole || null,
    },
  });
};

const recordDocumentRevisions = async ({
  tx,
  projectId,
  recordType,
  record,
  payload = {},
  userId = null,
}) => {
  if (!DOCUMENT_RECORD_TYPES.has(recordType)) return { revisionCount: null };
  const revisions = normalizeRevisionRefs(
    payload,
    { ...record, recordType },
    userId,
  );
  if (!revisions.length) return { revisionCount: 0 };

  await tx.documentRevision.createMany({
    data: revisions.map((revision) => ({
      projectId,
      recordType,
      recordId: record.id,
      ...revision,
    })),
    skipDuplicates: true,
  });

  return { revisionCount: revisions.length };
};

const groupByRecordId = (rows) =>
  rows.reduce((acc, row) => {
    if (!acc.has(row.recordId)) acc.set(row.recordId, []);
    acc.get(row.recordId).push(row);
    return acc;
  }, new Map());

const serializeRevision = (revision, projectId) => {
  const key = revision.projectDocumentId || revision.storageKey;
  const downloadUrl = key
    ? `/api/v1/projects/${projectId}/doc-control/revisions/${revision.id}/download`
    : null;

  return {
    ...revision,
    downloadUrl,
    fileUrl: revision.fileUrl || downloadUrl,
  };
};

const dueDateForRecord = (record) =>
  record.dueDate ||
  record.responseRequiredBy ||
  record.targetCloseBy ||
  record.inspectionDate ||
  null;

const dueAlertForRecord = (record) => {
  const due = dueDateForRecord(record);
  if (!due) return null;
  const status = String(record.status || record.result || "").toLowerCase();
  if (
    [
      "closed",
      "approved",
      "passed",
      "waived",
      "cancelled",
      "acknowledged",
    ].includes(status)
  ) {
    return null;
  }

  const dueTime = new Date(due).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil(
    (dueTime - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return { severity: "overdue", days: Math.abs(diffDays) };
  if (diffDays <= 7) return { severity: "due_soon", days: diffDays };
  return null;
};

const attachWorkflowDetailsToRecords = async ({
  tx = prisma,
  projectId,
  recordType,
  records,
}) => {
  const rows = toArray(records);
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return rows;

  if (
    !tx.workflowAttachment?.findMany ||
    !tx.workflowStatusHistory?.findMany ||
    !tx.workflowActivityLink?.findMany ||
    !tx.documentRevision?.findMany
  ) {
    return rows.map((row) => ({
      ...row,
      dueDate: dueDateForRecord(row),
      dueAlert: dueAlertForRecord(row),
      attachmentRefs: [],
      attachments: [],
      activityLinks: [],
      history: [],
      approvalHistory: [],
      revisions: [],
    }));
  }

  const [attachments, history, activityLinks, revisions, approvalHistoryById] =
    await Promise.all([
      tx.workflowAttachment.findMany({
        where: { projectId, recordType, recordId: { in: ids } },
        orderBy: [{ createdAt: "asc" }],
      }),
      tx.workflowStatusHistory.findMany({
        where: { projectId, recordType, recordId: { in: ids } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      tx.workflowActivityLink.findMany({
        where: { projectId, recordType, recordId: { in: ids } },
        include: {
          activity: {
            select: {
              id: true,
              name: true,
              p6ActivityId: true,
              wbsCode: true,
              isCritical: true,
              totalFloat: true,
              startDate: true,
              endDate: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }],
      }),
      DOCUMENT_RECORD_TYPES.has(recordType)
        ? tx.documentRevision.findMany({
            where: { projectId, recordType, recordId: { in: ids } },
            orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
          })
        : Promise.resolve([]),
      approvalWorkflowService.listEventsForRecords({
        tx,
        projectId,
        recordType,
        recordIds: ids,
      }),
    ]);

  const attachmentsById = groupByRecordId(attachments);
  const historyById = groupByRecordId(history);
  const activityLinksById = groupByRecordId(activityLinks);
  const revisionsById = groupByRecordId(
    revisions.map((revision) => serializeRevision(revision, projectId)),
  );
  const partyIds = [
    ...new Set(
      rows
        .flatMap((row) => [
          row.ownerPartyId,
          row.reviewerPartyId,
          row.approverPartyId,
        ])
        .filter(Boolean),
    ),
  ];
  const partyRows =
    partyIds.length && tx.projectParty?.findMany
      ? await tx.projectParty.findMany({
          where: {
            projectId,
            id: { in: partyIds },
          },
          include: {
            company: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
        })
      : [];
  const partiesById = new Map(partyRows.map((party) => [party.id, party]));
  const serializeParty = (partyId) => {
    const party = partiesById.get(partyId);
    if (!party) return null;
    return {
      id: party.id,
      role: party.role,
      companyId: party.companyId,
      companyName: party.company?.name || null,
      status: party.status,
    };
  };

  return rows.map((row) => {
    const dueDate = dueDateForRecord(row);
    const rowAttachments = attachmentsById.get(row.id) || [];
    return {
      ...row,
      dueDate,
      dueAlert: dueAlertForRecord(row),
      ownerParty: serializeParty(row.ownerPartyId),
      reviewerParty: serializeParty(row.reviewerPartyId),
      approverParty: serializeParty(row.approverPartyId),
      attachmentRefs: rowAttachments,
      attachments: rowAttachments,
      activityLinks: activityLinksById.get(row.id) || [],
      history: historyById.get(row.id) || [],
      approvalHistory: approvalHistoryById.get(row.id) || [],
      revisions: revisionsById.get(row.id) || [],
    };
  });
};

module.exports = {
  RECORD_TYPES,
  assignmentData,
  attachWorkflowDetailsToRecords,
  dueAlertForRecord,
  dueDateForRecord,
  normalizeActivityLinks,
  normalizeAttachmentRefs,
  primaryActivityIdFromPayload,
  recordDocumentRevisions,
  recordWorkflowHistory,
  syncWorkflowReferences,
  trimOrNull,
  workflowPartyAssignmentData,
};
