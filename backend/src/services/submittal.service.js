const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const {
  containsInsensitive,
  cursorArgs,
  dateRangeFilter,
  normalizeListQuery,
  toCursorPage,
  trimToNull,
} = require("../utils/list-query");
const {
  RECORD_TYPES,
  attachWorkflowDetailsToRecords,
  primaryActivityIdFromPayload,
  recordDocumentRevisions,
  recordWorkflowHistory,
  syncWorkflowReferences,
  workflowPartyAssignmentData,
} = require("./workflow-support.service");
const {
  applyPartyWorkflowVisibility,
  assertPartyWorkflowAccess,
  withDefaultOwnerParty,
} = require("./company-party.service");
const auditService = require("./audit.service");
const approvalWorkflowService = require("./approval-workflow.service");
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

const SUBMITTAL_STATUSES = [
  "pending",
  "under_review",
  "approved",
  "resubmit",
  "rejected",
  ARCHIVED_STATUS,
];
const SUBMITTAL_SORT_FIELDS = {
  created: "createdAt",
  updated: "updatedAt",
  dueDate: "dueDate",
  submittedOn: "submittedOn",
  reviewedOn: "reviewedOn",
  status: "status",
  ref: "ref",
  title: "title",
};

const dateSummary = (value) => (value ? new Date(value).toISOString() : null);

const decisionText = (payload = {}) =>
  payload.reason ||
  payload.rejectedReason ||
  payload.comment ||
  payload.statusComment ||
  payload.remarks ||
  null;

const submittalAuditSummary = (record) => ({
  ref: record.ref,
  title: record.title,
  activityId: record.activityId || null,
  discipline: record.discipline || null,
  revision: record.revision,
  specRef: record.specRef || null,
  status: record.status,
  owner: record.owner || null,
  ownerPartyId: record.ownerPartyId || null,
  reviewer: record.reviewer || null,
  reviewerPartyId: record.reviewerPartyId || null,
  approver: record.approver || null,
  approverPartyId: record.approverPartyId || null,
  submittedOn: dateSummary(record.submittedOn),
  dueDate: dateSummary(record.dueDate),
  reviewedOn: dateSummary(record.reviewedOn),
  remarks: record.remarks || null,
  archivedAt: dateSummary(record.archivedAt),
  archivedBy: record.archivedBy || null,
});

const buildSubmittalWhere = ({ projectId, query = {} }) => {
  const where = { projectId };

  if (SUBMITTAL_STATUSES.includes(query.status)) where.status = query.status;
  applyArchiveVisibility(where, query);
  if (trimToNull(query.activityId))
    where.activityId = trimToNull(query.activityId);

  const owner = trimToNull(query.owner);
  if (owner) where.owner = containsInsensitive(owner);
  if (trimToNull(query.ownerPartyId))
    where.ownerPartyId = trimToNull(query.ownerPartyId);

  const dueDate = dateRangeFilter({
    after: trimToNull(query.dueAfter),
    before: trimToNull(query.dueBefore),
  });
  if (dueDate) where.dueDate = dueDate;

  const search = trimToNull(query.search);
  if (search) {
    where.OR = [
      { ref: containsInsensitive(search) },
      { title: containsInsensitive(search) },
      { discipline: containsInsensitive(search) },
      { specRef: containsInsensitive(search) },
      { remarks: containsInsensitive(search) },
      { owner: containsInsensitive(search) },
      { reviewer: containsInsensitive(search) },
      { approver: containsInsensitive(search) },
    ];
  }

  if (trimToNull(query.partyId)) {
    const partyId = trimToNull(query.partyId);
    const partyClause = {
      OR: [
        { ownerPartyId: partyId },
        { reviewerPartyId: partyId },
        { approverPartyId: partyId },
      ],
    };
    if (where.OR) {
      where.AND = [...(where.AND || []), { OR: where.OR }, partyClause];
      delete where.OR;
    } else {
      where.OR = partyClause.OR;
    }
  }

  return where;
};

const countByStatus = (counts) =>
  counts.reduce(
    (acc, row) => ({
      ...acc,
      [row.status]: row._count?._all || 0,
    }),
    Object.fromEntries(SUBMITTAL_STATUSES.map((status) => [status, 0])),
  );

const listSubmittals = async ({
  orgId,
  projectId,
  query = {},
  projectAccess = null,
}) => {
  await ensureProject({ orgId, projectId });

  const listQuery = normalizeListQuery(query, {
    allowedSorts: Object.keys(SUBMITTAL_SORT_FIELDS),
    defaultSortBy: "created",
    defaultSortDir: "desc",
  });
  const where = applyPartyWorkflowVisibility(
    buildSubmittalWhere({ projectId, query }),
    projectAccess,
  );
  const orderBy = [
    { [SUBMITTAL_SORT_FIELDS[listQuery.sortBy]]: listQuery.sortDir },
    { id: listQuery.sortDir },
  ];

  const [records, statusCounts] = await Promise.all([
    prisma.submittal.findMany({
      where,
      take: listQuery.limit + 1,
      orderBy,
      ...cursorArgs(listQuery.cursor),
    }),
    prisma.submittal.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);
  const page = toCursorPage(records, listQuery.limit);
  const rows = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SUBMITTAL,
    records: page.rows,
  });
  const summaryCounts = countByStatus(statusCounts);

  return {
    rows,
    summary: {
      pending: summaryCounts.pending,
      underReview: summaryCounts.under_review,
      approved: summaryCounts.approved,
      resubmit: summaryCounts.resubmit,
      rejected: summaryCounts.rejected,
      archived: summaryCounts.archived,
    },
    pagination: page.pagination,
  };
};

const createSubmittal = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  await ensureProject({ orgId, projectId });

  const count = await prisma.submittal.count({ where: { projectId } });
  const activityId = primaryActivityIdFromPayload(payload);
  const assignmentPayload = withDefaultOwnerParty(payload, projectAccess);

  const row = await prisma.$transaction(async (tx) => {
    const assignments = await workflowPartyAssignmentData({
      tx,
      orgId,
      projectId,
      payload: assignmentPayload,
      status: payload.status || "pending",
    });
    const created = await tx.submittal.create({
      data: {
        projectId,
        activityId,
        ref: payload.ref || `SUB-${String(count + 1).padStart(3, "0")}`,
        title: payload.title,
        discipline: payload.discipline?.trim() || null,
        revision: payload.revision || "A",
        specRef: payload.specRef?.trim() || null,
        status: payload.status || "pending",
        ...assignments,
        submittedOn: payload.submittedOn ? new Date(payload.submittedOn) : null,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
        reviewedOn: payload.reviewedOn ? new Date(payload.reviewedOn) : null,
        remarks: payload.remarks?.trim() || null,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      recordId: created.id,
      payload,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      recordId: created.id,
      newStatus: created.status,
      comment: payload.comment || payload.statusComment || payload.remarks,
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SUBMITTAL,
      recordId: created.id,
      fromStatus: null,
      toStatus: created.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment || payload.remarks,
      metadata: {
        ref: created.ref,
        title: created.title,
        revision: created.revision,
      },
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      record: created,
      payload,
    });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL,
      entityId: created.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: null,
      newStatus: created.status,
      reason: payload.comment || payload.statusComment || null,
      newSummary: submittalAuditSummary(created),
      summary: {
        ref: created.ref,
        title: created.title,
        status: created.status,
        revision: created.revision,
      },
      metadata: { source: "document_control.submittal" },
    });
    return created;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SUBMITTAL,
    records: [row],
  });
  return enriched;
};

const requireDecisionText = (value, code, message) => {
  const text = decisionText({ comment: value, reason: value });
  if (!text) {
    throw new HttpError(400, code, message);
  }
  return text;
};

const getSubmittalForWorkflow = async ({ orgId, projectId, submittalId }) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.submittal.findFirst({
    where: { id: submittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "SUBMITTAL_NOT_FOUND", "Submittal not found");
  }

  return existing;
};

const hasPayloadRevisionEvidence = (payload = {}) =>
  Boolean(
    payload.revision ||
    payload.projectDocumentId ||
    payload.documentId ||
    payload.storageKey ||
    payload.key ||
    payload.revisions?.length ||
    payload.attachmentRefs?.length ||
    payload.attachments?.length,
  );

const ensureRevisionEvidence = async ({ projectId, submittalId, payload }) => {
  if (hasPayloadRevisionEvidence(payload)) return;
  if (!prisma.documentRevision?.count) return;

  const revisionCount = await prisma.documentRevision.count({
    where: {
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      recordId: submittalId,
    },
  });

  if (revisionCount > 0) return;

  throw new HttpError(
    400,
    "SUBMITTAL_REVISION_REQUIRED",
    "A revision file or attachment is required before submittal review",
  );
};

const updateSubmittal = async ({
  orgId,
  projectId,
  submittalId,
  payload,
  userId,
  userRole,
  forceWorkflowEvent = false,
  projectAccess = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.submittal.findFirst({
    where: { id: submittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "SUBMITTAL_NOT_FOUND", "Submittal not found");
  }
  assertNotArchived(existing, {
    code: "SUBMITTAL_ARCHIVED",
    message:
      "Archived submittals cannot be updated through normal workflow actions",
  });
  assertPartyWorkflowAccess({ projectAccess, record: existing });

  const nextStatus = payload.status ?? existing.status;
  if (nextStatus === ARCHIVED_STATUS && existing.status !== ARCHIVED_STATUS) {
    throw new HttpError(
      400,
      "SUBMITTAL_ARCHIVE_ACTION_REQUIRED",
      "Use the archive/delete endpoint to archive a submittal",
    );
  }
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);

  const row = await prisma.$transaction(async (tx) => {
    const assignments = await workflowPartyAssignmentData({
      tx,
      orgId,
      projectId,
      payload,
      existing,
      status: nextStatus,
    });
    const updated = await tx.submittal.update({
      where: { id: submittalId },
      data: {
        activityId,
        title: payload.title ?? existing.title,
        discipline:
          payload.discipline !== undefined
            ? payload.discipline?.trim() || null
            : existing.discipline,
        revision: payload.revision ?? existing.revision,
        specRef:
          payload.specRef !== undefined
            ? payload.specRef?.trim() || null
            : existing.specRef,
        status: nextStatus,
        ...assignments,
        submittedOn:
          payload.submittedOn !== undefined
            ? payload.submittedOn
              ? new Date(payload.submittedOn)
              : null
            : existing.submittedOn,
        dueDate:
          payload.dueDate !== undefined
            ? payload.dueDate
              ? new Date(payload.dueDate)
              : null
            : existing.dueDate,
        reviewedOn:
          payload.reviewedOn !== undefined
            ? payload.reviewedOn
              ? new Date(payload.reviewedOn)
              : null
            : existing.reviewedOn,
        remarks:
          payload.remarks !== undefined
            ? payload.remarks?.trim() || null
            : existing.remarks,
      },
    });
    await syncWorkflowReferences({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      recordId: submittalId,
      payload,
      userId,
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      recordId: submittalId,
      oldStatus: existing.status,
      newStatus: updated.status,
      comment: payload.comment || payload.statusComment || payload.remarks,
      userId,
      userRole,
      force: forceWorkflowEvent,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SUBMITTAL,
      recordId: submittalId,
      fromStatus: existing.status,
      toStatus: updated.status,
      actorId: userId,
      actorRole: userRole,
      reason: decisionText(payload),
      comment: payload.comment || payload.statusComment || payload.remarks,
      force: forceWorkflowEvent,
      metadata: {
        ref: updated.ref,
        title: updated.title,
        revision: updated.revision,
      },
    });
    await recordDocumentRevisions({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      record: updated,
      payload,
      userId,
    });
    const reason = payload.comment || payload.statusComment || null;
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL,
      entityId: submittalId,
      action:
        existing.status !== updated.status
          ? auditService.ACTIONS.STATUS_CHANGED
          : auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: updated.status,
      reason,
      oldSummary: submittalAuditSummary(existing),
      newSummary: submittalAuditSummary(updated),
      summary: {
        ref: updated.ref,
        title: updated.title,
        status: updated.status,
        revision: updated.revision,
      },
      metadata: { source: "document_control.submittal" },
    });
    return updated;
  });

  const [enriched] = await attachWorkflowDetailsToRecords({
    projectId,
    recordType: RECORD_TYPES.SUBMITTAL,
    records: [row],
  });
  return enriched;
};

const submitSubmittal = async ({
  orgId,
  projectId,
  submittalId,
  payload = {},
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  const existing = await getSubmittalForWorkflow({
    orgId,
    projectId,
    submittalId,
  });
  if (!["pending", "resubmit", "rejected"].includes(existing.status)) {
    throw new HttpError(
      409,
      "SUBMITTAL_NOT_READY_FOR_SUBMISSION",
      "Only pending, resubmit, or rejected submittals can be submitted",
    );
  }
  await ensureRevisionEvidence({ projectId, submittalId, payload });

  return updateSubmittal({
    orgId,
    projectId,
    submittalId,
    payload: {
      ...payload,
      status: "under_review",
      submittedOn: payload.submittedOn || new Date().toISOString(),
      comment:
        payload.comment || payload.remarks || "Submittal submitted for review",
      statusComment:
        payload.statusComment ||
        payload.comment ||
        payload.remarks ||
        "Submittal submitted for review",
    },
    userId,
    userRole,
    projectAccess,
  });
};

const reviewSubmittal = async ({
  orgId,
  projectId,
  submittalId,
  payload = {},
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  const comment = requireDecisionText(
    payload.comment || payload.remarks,
    "SUBMITTAL_REVIEW_COMMENT_REQUIRED",
    "A review comment is required",
  );
  const existing = await getSubmittalForWorkflow({
    orgId,
    projectId,
    submittalId,
  });
  if (existing.status !== "under_review") {
    throw new HttpError(
      409,
      "SUBMITTAL_NOT_UNDER_REVIEW",
      "Only under-review submittals can be reviewed",
    );
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });

  return updateSubmittal({
    orgId,
    projectId,
    submittalId,
    payload: {
      ...payload,
      status: "under_review",
      reviewedOn: payload.reviewedOn || new Date().toISOString(),
      remarks: payload.remarks || comment,
      comment,
      statusComment: payload.statusComment || comment,
    },
    userId,
    userRole,
    projectAccess,
    forceWorkflowEvent: true,
  });
};

const resubmitSubmittal = async ({
  orgId,
  projectId,
  submittalId,
  payload = {},
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  const existing = await getSubmittalForWorkflow({
    orgId,
    projectId,
    submittalId,
  });

  if (existing.status === "under_review") {
    if (userRole !== "pm") {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Only the Project Manager can require submittal resubmission",
      );
    }
    const reason = requireDecisionText(
      payload.reason || payload.comment || payload.remarks,
      "SUBMITTAL_RESUBMIT_REASON_REQUIRED",
      "A reason is required to request resubmission",
    );

    return updateSubmittal({
      orgId,
      projectId,
      submittalId,
      payload: {
        ...payload,
        status: "resubmit",
        reviewedOn: payload.reviewedOn || new Date().toISOString(),
        reason,
        remarks: payload.remarks || reason,
        comment: reason,
        statusComment: reason,
      },
      userId,
      userRole,
      projectAccess,
    });
  }

  if (!["pending", "resubmit", "rejected"].includes(existing.status)) {
    throw new HttpError(
      409,
      "SUBMITTAL_NOT_READY_FOR_RESUBMISSION",
      "Only pending, resubmit, or rejected submittals can be resubmitted",
    );
  }

  await ensureRevisionEvidence({ projectId, submittalId, payload });

  return updateSubmittal({
    orgId,
    projectId,
    submittalId,
    payload: {
      ...payload,
      status: "under_review",
      submittedOn: payload.submittedOn || new Date().toISOString(),
      comment:
        payload.comment ||
        payload.remarks ||
        "Submittal resubmitted for review",
      statusComment:
        payload.statusComment ||
        payload.comment ||
        payload.remarks ||
        "Submittal resubmitted for review",
    },
    userId,
    userRole,
    projectAccess,
  });
};

const approveSubmittal = async ({
  orgId,
  projectId,
  submittalId,
  comment = null,
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  const existing = await getSubmittalForWorkflow({
    orgId,
    projectId,
    submittalId,
  });
  if (existing.status !== "under_review") {
    throw new HttpError(
      409,
      "SUBMITTAL_NOT_READY_FOR_APPROVAL",
      "Only under-review submittals can be approved",
    );
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });

  return updateSubmittal({
    orgId,
    projectId,
    submittalId,
    payload: {
      status: "approved",
      reviewedOn: new Date().toISOString(),
      comment,
      statusComment: comment,
    },
    userId,
    userRole,
    projectAccess,
  });
};

const rejectSubmittal = async ({
  orgId,
  projectId,
  submittalId,
  reason,
  userId = null,
  userRole = null,
  projectAccess = null,
}) => {
  const rejectionReason = decisionText({ reason });
  if (!rejectionReason) {
    throw new HttpError(
      400,
      "APPROVAL_WORKFLOW_REASON_REQUIRED",
      "A reason is required for this workflow decision",
    );
  }

  const existing = await getSubmittalForWorkflow({
    orgId,
    projectId,
    submittalId,
  });
  if (existing.status !== "under_review") {
    throw new HttpError(
      409,
      "SUBMITTAL_NOT_READY_FOR_REJECTION",
      "Only under-review submittals can be rejected",
    );
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });

  return updateSubmittal({
    orgId,
    projectId,
    submittalId,
    payload: {
      status: "rejected",
      reviewedOn: new Date().toISOString(),
      reason: rejectionReason,
      comment: rejectionReason,
      statusComment: rejectionReason,
    },
    userId,
    userRole,
    projectAccess,
  });
};

const deleteSubmittal = async ({
  orgId,
  projectId,
  submittalId,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.submittal.findFirst({
    where: { id: submittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "SUBMITTAL_NOT_FOUND", "Submittal not found");
  }

  if (existing.status === ARCHIVED_STATUS || existing.archivedAt) {
    return archiveResult({
      id: submittalId,
      status: ARCHIVED_STATUS,
      archivedAt: existing.archivedAt,
    });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const archived = await tx.submittal.update({
      where: { id: submittalId },
      data: {
        status: ARCHIVED_STATUS,
        archivedAt: now,
        archivedBy: userId || null,
      },
    });
    await recordWorkflowHistory({
      tx,
      projectId,
      recordType: RECORD_TYPES.SUBMITTAL,
      recordId: submittalId,
      oldStatus: existing.status,
      newStatus: ARCHIVED_STATUS,
      comment: "Submittal archived",
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.SUBMITTAL,
      recordId: submittalId,
      fromStatus: existing.status,
      toStatus: ARCHIVED_STATUS,
      actorId: userId,
      actorRole: userRole,
      comment: "Submittal archived",
      metadata: {
        ref: existing.ref,
        title: existing.title,
        revision: existing.revision,
        archivedAt: now.toISOString(),
      },
    });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.SUBMITTAL,
      entityId: submittalId,
      action: auditService.ACTIONS.ARCHIVED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: ARCHIVED_STATUS,
      oldSummary: submittalAuditSummary(existing),
      newSummary: submittalAuditSummary(archived),
      summary: {
        transition: "submittal.archive",
        ref: existing.ref,
        title: existing.title,
        status: ARCHIVED_STATUS,
        revision: existing.revision,
      },
      metadata: { source: "document_control.submittal" },
    });
  });
  return archiveResult({ id: submittalId, archivedAt: now });
};

module.exports = {
  listSubmittals,
  createSubmittal,
  updateSubmittal,
  submitSubmittal,
  reviewSubmittal,
  resubmitSubmittal,
  approveSubmittal,
  rejectSubmittal,
  deleteSubmittal,
};
