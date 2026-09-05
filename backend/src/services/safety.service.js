const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const {
  RECORD_TYPES,
  workflowAssignmentData,
  attachWorkflowDetailsToRecords,
  normalizeAttachmentRefs,
  primaryActivityIdFromPayload,
  recordWorkflowHistory,
  syncWorkflowReferences,
} = require("./workflow-support.service");
const approvalWorkflowService = require("./approval-workflow.service");
const auditService = require("./audit.service");
const {
  ARCHIVED_STATUS,
  applyArchiveVisibility,
  assertNotArchived,
  archiveResult,
} = require("./archive-policy.service");

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }

  return project;
};

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const SAFETY_STATUS = Object.freeze({
  OPEN: "open",
  INVESTIGATING: "investigating",
  SUBMITTED: "submitted",
  CLOSED: "closed",
  ARCHIVED: ARCHIVED_STATUS,
});

const closeoutEvidenceRequired = true;

const requireText = (value, code, message) => {
  const text = trimOrNull(value);
  if (!text) {
    throw new HttpError(400, code, message);
  }
  return text;
};

const resolveResponsible = (payload = {}, existing = {}) =>
  trimOrNull(
    payload.responsible !== undefined
      ? payload.responsible
      : existing.responsible || payload.owner || existing.owner,
  );

const resolveDueDate = (payload = {}, existing = {}) => {
  if (payload.dueDate !== undefined) {
    return payload.dueDate ? new Date(payload.dueDate) : null;
  }
  return existing.dueDate || null;
};

const attachmentInput = (payload = {}) =>
  payload.attachmentRefs !== undefined
    ? payload.attachmentRefs
    : payload.attachments;

const payloadEvidenceCount = (payload = {}, userId = null) => {
  if (
    payload.attachmentRefs === undefined &&
    payload.attachments === undefined
  ) {
    return null;
  }
  return normalizeAttachmentRefs(attachmentInput(payload), userId)?.length || 0;
};

const existingEvidenceCount = async ({ tx = prisma, projectId, recordId }) => {
  if (!tx.workflowAttachment?.count) return 0;
  return tx.workflowAttachment.count({
    where: {
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId,
    },
  });
};

const assertCloseoutRequirements = async ({
  projectId,
  existing,
  payload = {},
  userId = null,
}) => {
  const closureComment = requireText(
    payload.closureComment || payload.comment || payload.statusComment,
    "SAFETY_CLOSEOUT_REQUIRED_FIELDS",
    "A closure comment is required before safety closeout can be submitted",
  );
  const responsible = resolveResponsible(payload, existing);
  if (!responsible) {
    throw new HttpError(
      400,
      "SAFETY_CLOSEOUT_REQUIRED_FIELDS",
      "A responsible party is required before safety closeout can be submitted",
    );
  }

  const dueDate = resolveDueDate(payload, existing);
  if (!dueDate) {
    throw new HttpError(
      400,
      "SAFETY_CLOSEOUT_REQUIRED_FIELDS",
      "A due date is required before safety closeout can be submitted",
    );
  }

  const suppliedEvidenceCount = payloadEvidenceCount(payload, userId);
  const evidenceCount =
    suppliedEvidenceCount === null
      ? await existingEvidenceCount({
          projectId,
          recordId: existing.id,
        })
      : suppliedEvidenceCount;

  if (closeoutEvidenceRequired && evidenceCount < 1) {
    throw new HttpError(
      400,
      "SAFETY_CLOSEOUT_EVIDENCE_REQUIRED",
      "At least one evidence attachment is required before safety closeout can be submitted",
    );
  }

  return { closureComment, responsible, dueDate };
};

const assertDirectStatusUpdateAllowed = ({ existingStatus, nextStatus }) => {
  if (!nextStatus || nextStatus === existingStatus) return;
  if (
    [SAFETY_STATUS.SUBMITTED, SAFETY_STATUS.CLOSED].includes(nextStatus) ||
    nextStatus === SAFETY_STATUS.ARCHIVED ||
    [SAFETY_STATUS.SUBMITTED, SAFETY_STATUS.CLOSED].includes(existingStatus)
  ) {
    throw new HttpError(
      400,
      "SAFETY_WORKFLOW_ACTION_REQUIRED",
      "Safety closeout status changes must use submit, close, approve, reject, or reopen workflow endpoints",
    );
  }
};

const attachSafetyDetails = async ({ projectId, row }) => {
  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SAFETY_INCIDENT,
    records: [row],
  });
  return enriched;
};

const safetyWorkflowMetadata = (row, extra = {}) => ({
  ref: row.ref,
  incidentType: row.incidentType,
  severity: row.severity,
  activityId: row.activityId,
  responsible: row.responsible,
  dueDate: row.dueDate,
  ...extra,
});

const safetyAuditSummary = (row) => ({
  ref: row.ref,
  title: row.title,
  incidentType: row.incidentType,
  severity: row.severity || null,
  activityId: row.activityId || null,
  status: row.status,
  owner: row.owner || null,
  responsible: row.responsible || null,
  dueDate: row.dueDate?.toISOString?.() || row.dueDate || null,
  archivedAt: row.archivedAt?.toISOString?.() || row.archivedAt || null,
  archivedBy: row.archivedBy || null,
});

const listSafetyIncidents = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });

  const where = { projectId };
  if (Object.values(SAFETY_STATUS).includes(query.status)) {
    where.status = query.status;
  }
  applyArchiveVisibility(where, query);

  const records = await prisma.safetyIncident.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SAFETY_INCIDENT,
    records,
  });

  return {
    rows,
    summary: {
      open: rows.filter((row) => row.status === SAFETY_STATUS.OPEN).length,
      investigating: rows.filter(
        (row) => row.status === SAFETY_STATUS.INVESTIGATING,
      ).length,
      submitted: rows.filter((row) => row.status === SAFETY_STATUS.SUBMITTED)
        .length,
      closed: rows.filter((row) => row.status === SAFETY_STATUS.CLOSED).length,
      archived: rows.filter((row) => row.status === SAFETY_STATUS.ARCHIVED)
        .length,
      lti: rows.filter((row) => row.incidentType === "lti").length,
      nearMiss: rows.filter((row) => row.incidentType === "near_miss").length,
      lostDays: rows.reduce((sum, row) => sum + (Number(row.lostDays) || 0), 0),
      overdue: rows.filter(
        (row) =>
          row.status !== SAFETY_STATUS.CLOSED &&
          row.dueDate &&
          new Date(row.dueDate).getTime() < Date.now(),
      ).length,
    },
  };
};

const createSafetyIncident = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.safetyIncident.count({ where: { projectId } });
  const activityId = primaryActivityIdFromPayload(payload);
  const status = payload.status || SAFETY_STATUS.OPEN;
  if (![SAFETY_STATUS.OPEN, SAFETY_STATUS.INVESTIGATING].includes(status)) {
    throw new HttpError(
      400,
      "SAFETY_WORKFLOW_ACTION_REQUIRED",
      "Safety closeout status changes must use submit, close, approve, reject, or reopen workflow endpoints",
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.safetyIncident.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || `SAF-${String(count + 1).padStart(3, "0")}`,
        incidentType: payload.incidentType,
        severity: payload.severity?.trim() || null,
        title: payload.title,
        date: payload.date ? new Date(payload.date) : new Date(),
        lostDays: Number(payload.lostDays) || 0,
        status,
        responsible: payload.responsible?.trim() || null,
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          status,
          assigneeTextField: "responsible",
        })),
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        closedDate: null,
        closureComment: payload.closureComment?.trim() || null,
        investigation: payload.investigation?.trim() || null,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: created.id,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: created.id,
      newStatus: created.status,
      comment:
        payload.comment || payload.statusComment || payload.investigation,
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: created.id,
      fromStatus: null,
      toStatus: created.status,
      actorId: userId,
      actorRole: userRole,
      comment:
        payload.comment || payload.statusComment || payload.investigation,
      metadata: {
        ...safetyWorkflowMetadata(created),
      },
    });
    return created;
  });

  return attachSafetyDetails({ projectId, row });
};

const updateSafetyIncident = async ({
  orgId,
  projectId,
  incidentId,
  payload,
  userId,
  userRole,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.safetyIncident.findFirst({
    where: { id: incidentId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      "SAFETY_INCIDENT_NOT_FOUND",
      "Safety incident not found",
    );
  }
  assertNotArchived(existing, {
    code: "SAFETY_INCIDENT_ARCHIVED",
    message:
      "Archived safety incidents cannot be updated through normal workflow actions",
  });

  const nextStatus = payload.status ?? existing.status;
  assertDirectStatusUpdateAllowed({
    existingStatus: existing.status,
    nextStatus,
  });
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.safetyIncident.update({
      where: { id: incidentId },
      data: {
        activityId,
        incidentType: payload.incidentType ?? existing.incidentType,
        severity:
          payload.severity !== undefined
            ? payload.severity?.trim() || null
            : existing.severity,
        title: payload.title ?? existing.title,
        date:
          payload.date !== undefined
            ? payload.date
              ? new Date(payload.date)
              : null
            : existing.date,
        lostDays:
          payload.lostDays !== undefined
            ? Number(payload.lostDays) || 0
            : existing.lostDays,
        status: nextStatus,
        responsible:
          payload.responsible !== undefined
            ? payload.responsible?.trim() || null
            : existing.responsible,
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload,
          existing,
          status: nextStatus,
          assigneeTextField: "responsible",
        })),
        dueDate:
          payload.dueDate !== undefined
            ? payload.dueDate
              ? new Date(payload.dueDate)
              : null
            : existing.dueDate,
        closedDate:
          nextStatus === SAFETY_STATUS.CLOSED ? existing.closedDate : null,
        closureComment:
          payload.closureComment !== undefined
            ? payload.closureComment?.trim() || null
            : existing.closureComment,
        investigation:
          payload.investigation !== undefined
            ? payload.investigation?.trim() || null
            : existing.investigation,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: payload.comment || payload.statusComment,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment,
      metadata: {
        ...safetyWorkflowMetadata(updated),
      },
    });
    return updated;
  });

  return attachSafetyDetails({ projectId, row });
};

const submitSafetyCloseout = async ({
  orgId,
  projectId,
  incidentId,
  payload = {},
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.safetyIncident.findFirst({
    where: { id: incidentId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      "SAFETY_INCIDENT_NOT_FOUND",
      "Safety incident not found",
    );
  }

  if (
    ![SAFETY_STATUS.OPEN, SAFETY_STATUS.INVESTIGATING].includes(existing.status)
  ) {
    throw new HttpError(
      409,
      "SAFETY_NOT_READY_FOR_CLOSEOUT",
      "Only open or investigating safety incidents can be submitted for closeout approval",
    );
  }

  const closeout = await assertCloseoutRequirements({
    projectId,
    existing,
    payload,
    userId,
  });
  const now = new Date();

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.safetyIncident.update({
      where: { id: incidentId },
      data: {
        status: SAFETY_STATUS.SUBMITTED,
        responsible: closeout.responsible,
        ...(await workflowAssignmentData({
          tx,
          orgId,
          projectId,
          payload: {
            ...(payload.assigneeUserId !== undefined
              ? { assigneeUserId: payload.assigneeUserId }
              : {}),
            ...(payload.assigneeCompanyId !== undefined
              ? { assigneeCompanyId: payload.assigneeCompanyId }
              : {}),
          },
          existing,
          status: SAFETY_STATUS.SUBMITTED,
          assigneeTextField: "responsible",
        })),
        dueDate: closeout.dueDate,
        closureComment: closeout.closureComment,
        closureSubmittedBy: userId || null,
        closureSubmittedAt: now,
        closureApprovedBy: null,
        closureApprovedAt: null,
        closedDate: null,
      },
    });

    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: closeout.closureComment,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment: closeout.closureComment,
      metadata: safetyWorkflowMetadata(updated, {
        evidenceRequired: closeoutEvidenceRequired,
      }),
    });

    return updated;
  });

  return attachSafetyDetails({ projectId, row });
};

const approveSafetyIncident = async ({
  orgId,
  projectId,
  incidentId,
  comment = null,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.safetyIncident.findFirst({
    where: { id: incidentId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      "SAFETY_INCIDENT_NOT_FOUND",
      "Safety incident not found",
    );
  }

  if (existing.status !== SAFETY_STATUS.SUBMITTED) {
    throw new HttpError(
      409,
      "SAFETY_INCIDENT_NOT_READY_FOR_APPROVAL",
      "Only submitted safety closeouts can be approved",
    );
  }

  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.safetyIncident.update({
      where: { id: incidentId },
      data: {
        status: SAFETY_STATUS.CLOSED,
        closedDate: now,
        closureApprovedBy: userId || null,
        closureApprovedAt: now,
      },
    });

    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment,
      metadata: safetyWorkflowMetadata(updated),
    });

    return updated;
  });

  return attachSafetyDetails({ projectId, row });
};

const rejectSafetyIncident = async ({
  orgId,
  projectId,
  incidentId,
  reason,
  userId = null,
  userRole = null,
}) => {
  const rejectionReason = trimOrNull(reason);
  if (!rejectionReason) {
    throw new HttpError(
      400,
      "APPROVAL_WORKFLOW_REASON_REQUIRED",
      "A reason is required for this workflow decision",
    );
  }

  await ensureProject({ orgId, projectId });

  const existing = await prisma.safetyIncident.findFirst({
    where: { id: incidentId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      "SAFETY_INCIDENT_NOT_FOUND",
      "Safety incident not found",
    );
  }

  if (existing.status !== SAFETY_STATUS.SUBMITTED) {
    throw new HttpError(
      409,
      "SAFETY_NOT_READY_FOR_REJECTION",
      "Only submitted safety closeouts can be rejected",
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.safetyIncident.update({
      where: { id: incidentId },
      data: {
        status: SAFETY_STATUS.INVESTIGATING,
        closedDate: null,
        closureApprovedBy: null,
        closureApprovedAt: null,
      },
    });

    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: rejectionReason,
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      reason: rejectionReason,
      comment: rejectionReason,
      metadata: {
        ...safetyWorkflowMetadata(updated),
      },
      force: true,
    });

    return updated;
  });

  return attachSafetyDetails({ projectId, row });
};

const reopenSafetyIncident = async ({
  orgId,
  projectId,
  incidentId,
  reason,
  userId = null,
  userRole = null,
}) => {
  const reopenReason = requireText(
    reason,
    "SAFETY_REOPEN_REASON_REQUIRED",
    "A reason is required to reopen a safety incident",
  );

  await ensureProject({ orgId, projectId });

  const existing = await prisma.safetyIncident.findFirst({
    where: { id: incidentId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      "SAFETY_INCIDENT_NOT_FOUND",
      "Safety incident not found",
    );
  }

  if (existing.status !== SAFETY_STATUS.CLOSED) {
    throw new HttpError(
      409,
      "SAFETY_NOT_READY_FOR_REOPEN",
      "Only closed safety incidents can be reopened",
    );
  }

  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.safetyIncident.update({
      where: { id: incidentId },
      data: {
        status: SAFETY_STATUS.INVESTIGATING,
        closedDate: null,
        reopenedBy: userId || null,
        reopenedAt: now,
        closureApprovedBy: null,
        closureApprovedAt: null,
      },
    });

    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: reopenReason,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment: reopenReason,
      metadata: safetyWorkflowMetadata(updated),
    });

    return updated;
  });

  return attachSafetyDetails({ projectId, row });
};

const deleteSafetyIncident = async ({
  orgId,
  projectId,
  incidentId,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.safetyIncident.findFirst({
    where: { id: incidentId, projectId },
  });

  if (!existing) {
    throw new HttpError(
      404,
      "SAFETY_INCIDENT_NOT_FOUND",
      "Safety incident not found",
    );
  }

  if (existing.status === ARCHIVED_STATUS || existing.archivedAt) {
    return archiveResult({
      id: incidentId,
      status: ARCHIVED_STATUS,
      archivedAt: existing.archivedAt,
    });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const archived = await tx.safetyIncident.update({
      where: { id: incidentId },
      data: {
        status: ARCHIVED_STATUS,
        archivedAt: now,
        archivedBy: userId || null,
      },
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      oldStatus: existing.status,
      newStatus: ARCHIVED_STATUS,
      comment: "Safety incident archived",
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SAFETY_INCIDENT,
      recordId: incidentId,
      fromStatus: existing.status,
      toStatus: ARCHIVED_STATUS,
      actorId: userId,
      actorRole: userRole,
      comment: "Safety incident archived",
      metadata: safetyWorkflowMetadata(archived, {
        archivedAt: now.toISOString(),
      }),
    });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SAFETY_INCIDENT,
      entityId: incidentId,
      action: auditService.ACTIONS.ARCHIVED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: ARCHIVED_STATUS,
      oldSummary: safetyAuditSummary(existing),
      newSummary: safetyAuditSummary(archived),
      summary: {
        transition: "safety.archive",
        ref: existing.ref,
        title: existing.title,
        status: ARCHIVED_STATUS,
      },
      metadata: { source: "safety.archive" },
    });
  });

  return archiveResult({ id: incidentId, archivedAt: now });
};

module.exports = {
  listSafetyIncidents,
  createSafetyIncident,
  updateSafetyIncident,
  submitSafetyCloseout,
  closeSafetyIncident: submitSafetyCloseout,
  approveSafetyIncident,
  rejectSafetyIncident,
  reopenSafetyIncident,
  deleteSafetyIncident,
};
