const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const {
  RECORD_TYPES,
  assertPayloadActivity,
  workflowAssignmentData,
  attachWorkflowDetailsToRecords,
  normalizeAttachmentRefs,
  primaryActivityIdFromPayload,
  recordWorkflowHistory,
  syncWorkflowReferences,
} = require("./workflow-support.service");
const approvalWorkflowService = require("./approval-workflow.service");
const { nextRef } = require("../utils/reference-number");

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

const NCR_STATUS = Object.freeze({
  OPEN: "open",
  SUBMITTED: "submitted",
  CLOSED: "closed",
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
    where: { projectId, recordType: RECORD_TYPES.NCR, recordId },
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
    "NCR_CLOSEOUT_REQUIRED_FIELDS",
    "A closure comment is required before NCR closeout can be submitted",
  );
  const responsible = resolveResponsible(payload, existing);
  if (!responsible) {
    throw new HttpError(
      400,
      "NCR_CLOSEOUT_REQUIRED_FIELDS",
      "A responsible party is required before NCR closeout can be submitted",
    );
  }

  const dueDate = resolveDueDate(payload, existing);
  if (!dueDate) {
    throw new HttpError(
      400,
      "NCR_CLOSEOUT_REQUIRED_FIELDS",
      "A due date is required before NCR closeout can be submitted",
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
      "NCR_CLOSEOUT_EVIDENCE_REQUIRED",
      "At least one evidence attachment is required before NCR closeout can be submitted",
    );
  }

  return { closureComment, responsible, dueDate };
};

const assertDirectStatusUpdateAllowed = ({ existingStatus, nextStatus }) => {
  if (!nextStatus || nextStatus === existingStatus) return;
  if (
    [NCR_STATUS.SUBMITTED, NCR_STATUS.CLOSED].includes(nextStatus) ||
    [NCR_STATUS.SUBMITTED, NCR_STATUS.CLOSED].includes(existingStatus)
  ) {
    throw new HttpError(
      400,
      "NCR_WORKFLOW_ACTION_REQUIRED",
      "NCR closeout status changes must use submit, close, approve, reject, or reopen workflow endpoints",
    );
  }
};

const attachNcrDetails = async ({ projectId, row }) => {
  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.NCR,
    records: [row],
  });
  return enriched;
};

const ncrWorkflowMetadata = (row, extra = {}) => ({
  ref: row.ref,
  severity: row.severity,
  activityId: row.activityId,
  responsible: row.responsible,
  dueDate: row.dueDate,
  ...extra,
});

const listNcrs = async ({ orgId, projectId }) => {
  await ensureProject({ orgId, projectId });

  const records = await prisma.ncrRecord.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }],
  });
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.NCR,
    records,
  });

  const now = Date.now();
  const summary = {
    open: rows.filter((row) => row.status === NCR_STATUS.OPEN).length,
    submitted: rows.filter((row) => row.status === NCR_STATUS.SUBMITTED).length,
    closed: rows.filter((row) => row.status === NCR_STATUS.CLOSED).length,
    major: rows.filter((row) => row.severity === "major").length,
    minor: rows.filter((row) => row.severity === "minor").length,
    overdue: rows.filter(
      (row) =>
        row.status !== NCR_STATUS.CLOSED &&
        row.dueDate &&
        new Date(row.dueDate).getTime() < now,
    ).length,
  };

  return { rows, summary };
};

const createNcr = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  // Every activity the NCR will name (activityId, activityIds, activityLinks),
  // before anything is written: the row carries the primary activity, so an
  // activity that exists nowhere failed its foreign key (500) where another
  // company's was refused 400 by the links (CERT-2).
  await assertPayloadActivity({ projectId, payload });

  const activityId = primaryActivityIdFromPayload(payload);
  const status = payload.status || NCR_STATUS.OPEN;
  if (status !== NCR_STATUS.OPEN) {
    throw new HttpError(
      400,
      "NCR_WORKFLOW_ACTION_REQUIRED",
      "NCR closeout status changes must use submit, close, approve, reject, or reopen workflow endpoints",
    );
  }

  // A reference is one NCR's per project (NcrRecord_projectId_ref_key,
  // migration 20261005060100). A typed one that is taken is refused by name;
  // a generated one skips any reference someone typed ahead of the counter.
  const typedRef = trimOrNull(payload.ref);
  if (typedRef) {
    await assertNcrRefFree({ projectId, ref: typedRef });
    try {
      return await insertNcr({ orgId, projectId, payload, userId, userRole, activityId, status, ref: typedRef });
    } catch (error) {
      if (isRefConflict(error)) throw ncrRefTaken(typedRef);
      throw error;
    }
  }
  for (let attempt = 0; attempt < GENERATED_REF_ATTEMPTS; attempt += 1) {
    const generatedRef = await nextRef(prisma, { table: 'NcrRecord', scopeColumn: 'projectId', scopeId: projectId, prefix: 'NCR' });
    if (await ncrRefTakenBy({ projectId, ref: generatedRef })) continue;
    try {
      return await insertNcr({ orgId, projectId, payload, userId, userRole, activityId, status, ref: generatedRef });
    } catch (error) {
      // Typed by a concurrent request between the check and the insert.
      if (!isRefConflict(error)) throw error;
    }
  }
  throw new HttpError(500, "NCR_NUMBERING_FAILED", "Could not allocate a free NCR reference; type one or try again");
};

const GENERATED_REF_ATTEMPTS = 50;

const ncrRefTaken = (ref) =>
  new HttpError(409, "NCR_REF_TAKEN", `${ref} is already used by another NCR in this project.`);

const ncrRefTakenBy = async ({ projectId, ref }) =>
  prisma.ncrRecord.findFirst({ where: { projectId, ref }, select: { id: true } });

const assertNcrRefFree = async ({ projectId, ref }) => {
  if (await ncrRefTakenBy({ projectId, ref })) throw ncrRefTaken(ref);
};

// P2002 on NcrRecord's (projectId, ref) unique — the only unique an insert can hit.
const isRefConflict = (error) =>
  error?.code === "P2002" && /\bref\b|_ref_key/.test([].concat(error?.meta?.target ?? "").join(","));

const insertNcr = async ({ orgId, projectId, payload, userId, userRole, activityId, status, ref }) => {
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.ncrRecord.create({
      data: {
        projectId,
        activityId,
        ref,
        severity: payload.severity || "minor",
        description: payload.description?.trim() || null,
        disposition: payload.disposition?.trim() || null,
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
        closureComment: payload.closureComment?.trim() || null,
        closedDate: null,
      },
    });

    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: created.id,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.description,
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: created.id,
      fromStatus: null,
      toStatus: created.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment || payload.description,
      metadata: {
        ...ncrWorkflowMetadata(created),
      },
    });
    return created;
  });

  return attachNcrDetails({ projectId, row });
};

const updateNcr = async ({
  orgId,
  projectId,
  ncrId,
  payload,
  userId,
  userRole,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.ncrRecord.findFirst({
    where: { id: ncrId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "NCR_NOT_FOUND", "NCR not found");
  }

  const nextStatus = payload.status ?? existing.status;
  assertDirectStatusUpdateAllowed({
    existingStatus: existing.status,
    nextStatus,
  });
  // As on create: checked before anything is written (CERT-2).
  await assertPayloadActivity({ projectId, payload });
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.ncrRecord.update({
      where: { id: ncrId },
      data: {
        activityId,
        severity: payload.severity ?? existing.severity,
        description:
          payload.description !== undefined
            ? payload.description?.trim() || null
            : existing.description,
        disposition:
          payload.disposition !== undefined
            ? payload.disposition?.trim() || null
            : existing.disposition,
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
        closureComment:
          payload.closureComment !== undefined
            ? payload.closureComment?.trim() || null
            : existing.closureComment,
        closedDate:
          nextStatus === NCR_STATUS.CLOSED ? existing.closedDate : null,
      },
    });

    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: ncrId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: ncrId,
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
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: ncrId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment,
      metadata: {
        ...ncrWorkflowMetadata(updated),
      },
    });
    return updated;
  });

  return attachNcrDetails({ projectId, row });
};

const submitNcrCloseout = async ({
  orgId,
  projectId,
  ncrId,
  payload = {},
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.ncrRecord.findFirst({
    where: { id: ncrId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "NCR_NOT_FOUND", "NCR not found");
  }

  if (existing.status !== NCR_STATUS.OPEN) {
    throw new HttpError(
      409,
      "NCR_NOT_READY_FOR_CLOSEOUT",
      "Only open NCRs can be submitted for closeout approval",
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
    const updated = await tx.ncrRecord.update({
      where: { id: ncrId },
      data: {
        status: NCR_STATUS.SUBMITTED,
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
          status: NCR_STATUS.SUBMITTED,
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
      recordType: RECORD_TYPES.NCR,
      recordId: ncrId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: ncrId,
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
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: ncrId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment: closeout.closureComment,
      metadata: ncrWorkflowMetadata(updated, {
        evidenceRequired: closeoutEvidenceRequired,
      }),
    });

    return updated;
  });

  return attachNcrDetails({ projectId, row });
};

const approveNcr = async ({
  orgId,
  projectId,
  ncrId,
  comment = null,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.ncrRecord.findFirst({
    where: { id: ncrId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "NCR_NOT_FOUND", "NCR not found");
  }

  if (existing.status !== NCR_STATUS.SUBMITTED) {
    throw new HttpError(
      409,
      "NCR_NOT_READY_FOR_APPROVAL",
      "Only submitted NCR closeouts can be approved",
    );
  }

  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.ncrRecord.update({
      where: { id: ncrId },
      data: {
        status: NCR_STATUS.CLOSED,
        closedDate: now,
        closureApprovedBy: userId || null,
        closureApprovedAt: now,
      },
    });

    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: ncrId,
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
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: ncrId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment,
      metadata: ncrWorkflowMetadata(updated),
    });

    return updated;
  });

  return attachNcrDetails({ projectId, row });
};

const rejectNcr = async ({
  orgId,
  projectId,
  ncrId,
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

  const existing = await prisma.ncrRecord.findFirst({
    where: { id: ncrId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "NCR_NOT_FOUND", "NCR not found");
  }

  if (existing.status !== NCR_STATUS.SUBMITTED) {
    throw new HttpError(
      409,
      "NCR_NOT_READY_FOR_REJECTION",
      "Only submitted NCR closeouts can be rejected",
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.ncrRecord.update({
      where: { id: ncrId },
      data: {
        status: NCR_STATUS.OPEN,
        closedDate: null,
        closureApprovedBy: null,
        closureApprovedAt: null,
      },
    });

    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.NCR,
      recordId: ncrId,
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
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: ncrId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      reason: rejectionReason,
      comment: rejectionReason,
      metadata: {
        ...ncrWorkflowMetadata(updated),
      },
      force: true,
    });

    return updated;
  });

  return attachNcrDetails({ projectId, row });
};

const reopenNcr = async ({
  orgId,
  projectId,
  ncrId,
  reason,
  userId = null,
  userRole = null,
}) => {
  const reopenReason = requireText(
    reason,
    "NCR_REOPEN_REASON_REQUIRED",
    "A reason is required to reopen an NCR",
  );

  await ensureProject({ orgId, projectId });

  const existing = await prisma.ncrRecord.findFirst({
    where: { id: ncrId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "NCR_NOT_FOUND", "NCR not found");
  }

  if (existing.status !== NCR_STATUS.CLOSED) {
    throw new HttpError(
      409,
      "NCR_NOT_READY_FOR_REOPEN",
      "Only closed NCRs can be reopened",
    );
  }

  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.ncrRecord.update({
      where: { id: ncrId },
      data: {
        status: NCR_STATUS.OPEN,
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
      recordType: RECORD_TYPES.NCR,
      recordId: ncrId,
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
      recordType: approvalWorkflowService.RECORD_TYPES.NCR,
      recordId: ncrId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      comment: reopenReason,
      metadata: ncrWorkflowMetadata(updated),
    });

    return updated;
  });

  return attachNcrDetails({ projectId, row });
};

const deleteNcr = async ({ orgId, projectId, ncrId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.ncrRecord.findFirst({
    where: { id: ncrId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "NCR_NOT_FOUND", "NCR not found");
  }

  await prisma.ncrRecord.delete({ where: { id: ncrId } });
  return { deleted: true };
};

module.exports = {
  listNcrs,
  createNcr,
  updateNcr,
  submitNcrCloseout,
  closeNcr: submitNcrCloseout,
  approveNcr,
  rejectNcr,
  reopenNcr,
  deleteNcr,
};
