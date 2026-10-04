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
  assertPayloadActivity,
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
  isPartyScopedAccess,
  withDefaultOwnerParty,
} = require("./company-party.service");
const auditService = require("./audit.service");
const approvalWorkflowService = require("./approval-workflow.service");
const submittalWorkflow = require("./submittal-workflow.service");
const { nextRef } = require("../utils/reference-number");
const {
  ARCHIVED_STATUS,
  applyArchiveVisibility,
  assertNotArchived,
  archiveResult,
} = require("./archive-policy.service");

/**
 * The ids a submittal may point at belong to its own project (package) or
 * organisation (workflow template, manager, distribution) — certification
 * findings L7 and L8: a foreign package, template or person used to be stored
 * and their names served back, and a foreign submittal then counted in another
 * company's package.
 */
const assertSubmittalReferences = async ({ orgId, projectId, upgrade }) => {
  const refs = require("./tenant-references.service");
  if (upgrade.packageId) await refs.assertProjectRows({ model: "submittalPackage", projectId, ids: [upgrade.packageId], code: "SUBMITTAL_PACKAGE_NOT_FOUND", message: "Package not found" });
  if (upgrade.workflowTemplateId) {
    const template = await prisma.submittalWorkflowTemplate.findFirst({ where: { id: upgrade.workflowTemplateId, orgId, OR: [{ projectId }, { projectId: null }] }, select: { id: true } });
    if (!template) throw new HttpError(404, "SUBMITTAL_TEMPLATE_NOT_FOUND", "Workflow template not found");
  }
  await refs.assertMembers({ orgId, userIds: [upgrade.managerUserId, ...(Array.isArray(upgrade.distributionJson) ? upgrade.distributionJson : [])] });
};

/**
 * A party member files a submittal only into a package they can already open
 * (review finding R10: PATCH packageId put a guest's submittal into another
 * company's package, which then opened to the guest and took their edits).
 * The package rule is the one its own routes apply (submittal-workflow
 * getPackage: 404 when missing, 403 when not theirs). Internal callers file
 * into any package of the project.
 */
const assertPackageReachable = async ({ orgId, projectId, packageId, currentPackageId = null, projectAccess = null, viewerId = null }) => {
  if (!packageId || packageId === currentPackageId || !isPartyScopedAccess(projectAccess)) return;
  await submittalWorkflow.getPackage({ orgId, projectId, packageId, projectAccess, viewerId });
};

/** Fields added by OCTA-PM-SUB-017 (packages, workflow, lead time, people). */
const upgradeFields = (payload = {}) => {
  const data = {};
  const optionalDate = (value) => (value ? new Date(value) : null);
  if (payload.packageId !== undefined) data.packageId = payload.packageId || null;
  if (payload.workflowTemplateId !== undefined) data.workflowTemplateId = payload.workflowTemplateId || null;
  if (payload.currentStepId !== undefined) data.currentStepId = payload.currentStepId || null;
  if (payload.responseCode !== undefined) data.responseCode = payload.responseCode || null;
  if (payload.responseCodeLabel !== undefined) data.responseCodeLabel = payload.responseCodeLabel || null;
  if (payload.leadTimeWeeks !== undefined) data.leadTimeWeeks = payload.leadTimeWeeks === null || payload.leadTimeWeeks === "" ? null : Number(payload.leadTimeWeeks) || 0;
  if (payload.reviewDays !== undefined) data.reviewDays = payload.reviewDays === null || payload.reviewDays === "" ? null : Number(payload.reviewDays) || 0;
  if (payload.requiredOnSite !== undefined) data.requiredOnSite = optionalDate(payload.requiredOnSite);
  if (payload.managerUserId !== undefined) data.managerUserId = payload.managerUserId || null;
  if (payload.distributionUserIds !== undefined) data.distributionJson = Array.isArray(payload.distributionUserIds) ? [...new Set(payload.distributionUserIds.filter(Boolean))] : [];
  return data;
};

/** Recomputes submitBy from the activity / required-on-site date, lead time and review days. */
const submitByFor = async ({ tx = prisma, projectId, record }) => {
  let reviewDays = record.reviewDays;
  if ((reviewDays === null || reviewDays === undefined) && record.workflowTemplateId && tx.submittalWorkflowTemplate?.findFirst) {
    const template = await tx.submittalWorkflowTemplate.findFirst({ where: { id: record.workflowTemplateId }, select: { stepsJson: true } });
    reviewDays = template ? submittalWorkflow.reviewDaysFor(template.stepsJson) : 0;
  }
  let activityStart = null;
  if (!record.requiredOnSite && record.activityId && tx.activity?.findFirst) {
    const activity = await tx.activity.findFirst({ where: { id: record.activityId, projectId }, select: { startDate: true } });
    activityStart = activity?.startDate || null;
  }
  return submittalWorkflow.computeSubmitBy({ requiredOnSite: record.requiredOnSite, activityStart, leadTimeWeeks: record.leadTimeWeeks, reviewDays });
};

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
  packageId: record.packageId || null,
  workflowTemplateId: record.workflowTemplateId || null,
  responseCode: record.responseCode || null,
  revisionNumber: Number(record.revisionNumber || 0),
  submitBy: dateSummary(record.submitBy),
  requiredOnSite: dateSummary(record.requiredOnSite),
  leadTimeWeeks: record.leadTimeWeeks ?? null,
  managerUserId: record.managerUserId || null,
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

  // OCTA-PM-SUB-017 filters: package, manager, ball in court, response code, late.
  if (trimToNull(query.packageId)) where.packageId = trimToNull(query.packageId);
  if (trimToNull(query.managerUserId)) where.managerUserId = trimToNull(query.managerUserId);
  if (trimToNull(query.ballInCourtUserId)) where.ballInCourtUserId = trimToNull(query.ballInCourtUserId);
  if (trimToNull(query.workflowTemplateId)) where.workflowTemplateId = trimToNull(query.workflowTemplateId);
  if (trimToNull(query.responseCode)) where.responseCode = trimToNull(query.responseCode);
  if (query.overdue === true || query.overdue === "true") {
    const now = new Date();
    where.AND = [
      ...(where.AND || []),
      { OR: [{ status: "under_review", dueDate: { lt: now } }, { status: { in: ["pending", "resubmit", "rejected"] }, submitBy: { lt: now } }] },
    ];
  }

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

/**
 * A status — or a review outcome — written straight through create / update is
 * the decision an action route takes (/submit, /approve, /reject, /resubmit)
 * and needs the transition that route needs (certification finding L40: a
 * subcontractor without submittal.approve approved its own submittal through
 * PATCH, response code and distribution stamped, review steps skipped).
 * `canTransition(action, transition)` is the caller's permission check, given
 * by the create / update routes; internal callers that already passed an
 * action route's guard (or a review step) give none.
 */
const SUBMITTAL_OUTCOME_FIELDS = Object.freeze(["responseCode", "responseCodeLabel", "currentStepId"]);

const directSubmittalTransition = (fromStatus, toStatus) => {
  if (!toStatus || toStatus === fromStatus) return null;
  if (toStatus === "under_review") return { action: "submit", transition: "submittal.submit" };
  if (toStatus === "approved") return { action: "approve", transition: "submittal.approve" };
  if (toStatus === "rejected" || toStatus === "resubmit") return { action: "approve", transition: "submittal.reject" };
  return null;
};

/**
 * A decision's stamp is its reviewer's (review finding R8): the review date of
 * a decided submittal, and the notes an approval stands with. A returned
 * submittal's notes stay the submitter's until it is sent again.
 */
const SUBMITTAL_DECIDED_STATUSES = Object.freeze(["approved", "rejected", "resubmit"]);
const decisionStampFields = (status) => [
  ...(SUBMITTAL_DECIDED_STATUSES.includes(status) ? ["reviewedOn"] : []),
  ...(status === "approved" ? ["remarks"] : []),
];
const sameStampValue = (field, next, current) => {
  if (field === "reviewedOn") return (next ? new Date(next).getTime() : null) === (current ? new Date(current).getTime() : null);
  return trimToNull(next) === trimToNull(current);
};

const assertDirectSubmittalChange = ({ existing = null, payload = {}, canTransition = null }) => {
  if (typeof canTransition !== "function") return;
  const fromStatus = existing ? existing.status : null;
  const toStatus = payload.status ?? fromStatus;
  const statusNeed = directSubmittalTransition(fromStatus, toStatus);
  if (statusNeed && !canTransition(statusNeed.action, statusNeed.transition)) {
    throw new HttpError(403, "FORBIDDEN", `Moving this submittal to "${toStatus}" needs the ${statusNeed.transition} permission; use the submittal's workflow action`, { module: "submittal", action: statusNeed.action, transition: statusNeed.transition, fromStatus, toStatus });
  }
  const outcomeFields = SUBMITTAL_OUTCOME_FIELDS.filter((field) => payload[field] !== undefined && trimToNull(payload[field]) !== trimToNull(existing ? existing[field] : null));
  if (outcomeFields.length && !canTransition("approve", "submittal.approve")) {
    throw new HttpError(403, "FORBIDDEN", "A submittal's review outcome is set by its reviewers; use the review actions", { module: "submittal", action: "approve", transition: "submittal.approve", fields: outcomeFields });
  }
  const stampFields = decisionStampFields(fromStatus).filter((field) => payload[field] !== undefined && !sameStampValue(field, payload[field], existing[field]));
  if (stampFields.length && !canTransition("approve", "submittal.approve")) {
    throw new HttpError(403, "FORBIDDEN", "A decided submittal's review date and approval notes are its reviewer's", { module: "submittal", action: "approve", transition: "submittal.approve", fields: stampFields });
  }
};

/**
 * The fields each action route takes from its body (review finding R3: /submit,
 * /resubmit and /review spread the whole body into the update, past every check
 * PATCH makes — a guest's /submit stamped an "approved" response code that the
 * later rejection kept, and filed the submittal into another company's
 * package; a planner's /review stamped a code without submittal.approve). The
 * rest of the body is ignored.
 */
const SUBMISSION_FIELDS = Object.freeze([
  // the revision evidence (ensureRevisionEvidence, the revision and attachment registers)
  "revision", "revisions", "projectDocumentId", "documentId", "storageKey", "key", "fileName", "fileUrl", "revisionNotes", "notes", "attachments", "attachmentRefs",
  // the links and routing it is sent with
  "activityId", "activityIds", "activityLinks", "ownerPartyId", "reviewerPartyId", "approverPartyId",
  // the submitter's own words and date
  "remarks", "comment", "statusComment", "reason", "submittedOn",
]);
const REVIEW_FIELDS = Object.freeze(["comment", "statusComment", "remarks", "reviewedOn"]);
const RETURN_FIELDS = Object.freeze(["reason", "comment", "statusComment", "remarks", "reviewedOn"]);
const actionFields = (payload = {}, fields) =>
  Object.fromEntries(fields.filter((field) => payload[field] !== undefined).map((field) => [field, payload[field]]));

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
  canTransition = null,
}) => {
  await ensureProject({ orgId, projectId });
  assertDirectSubmittalChange({ payload, canTransition });
  // Every activity the submittal will name (activityId, activityIds,
  // activityLinks), before anything is written: the row carries the primary
  // activity, so an activity that exists nowhere failed its foreign key (500)
  // where another company's was refused 400 by the links (CERT-2).
  await assertPayloadActivity({ projectId, payload });

  const generatedRef = await nextRef(prisma, { table: 'Submittal', scopeColumn: 'projectId', scopeId: projectId, prefix: 'SUB' });
  const activityId = primaryActivityIdFromPayload(payload);
  const assignmentPayload = withDefaultOwnerParty(payload, projectAccess);
  const upgrade = upgradeFields(payload);
  await assertSubmittalReferences({ orgId, projectId, upgrade });
  await assertPackageReachable({ orgId, projectId, packageId: upgrade.packageId, projectAccess, viewerId: userId });
  const submitBy = await submitByFor({ projectId, record: { ...upgrade, activityId } });

  const { row, patch } = await prisma.$transaction(async (tx) => {
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
        ref: payload.ref || generatedRef,
        title: payload.title,
        discipline: payload.discipline?.trim() || null,
        revision: payload.revision || "A",
        specRef: payload.specRef?.trim() || null,
        status: payload.status || "pending",
        ...assignments,
        ...upgrade,
        createdBy: userId || null,
        submitBy,
        submittedOn: payload.submittedOn ? new Date(payload.submittedOn) : null,
        dueDate: payload.dueDate ? new Date(payload.dueDate) : submitBy,
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
    const workflowPatch = await submittalWorkflow.onStatusChange({ tx, orgId, projectId, existing: {}, updated: created, actorId: userId });
    return { row: { ...created, ...workflowPatch }, patch: workflowPatch };
  });
  await submittalWorkflow.afterStatusChange({ orgId, projectId, submittal: row, patch, actorId: userId });

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
  canTransition = null,
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
  assertDirectSubmittalChange({ existing, payload, canTransition });
  // A status sent straight to update respects a running workflow as the
  // approve / reject actions do: the instance owns the decision (finding L40).
  if (typeof canTransition === "function" && payload.status && payload.status !== existing.status) {
    await require("./workflow-engine.service").assertNotLocked({ tool: "submittal", projectId, recordId: submittalId });
  }

  const nextStatus = payload.status ?? existing.status;
  if (nextStatus === ARCHIVED_STATUS && existing.status !== ARCHIVED_STATUS) {
    throw new HttpError(
      400,
      "SUBMITTAL_ARCHIVE_ACTION_REQUIRED",
      "Use the archive/delete endpoint to archive a submittal",
    );
  }
  // As on create: checked before anything is written (CERT-2).
  await assertPayloadActivity({ projectId, payload });
  const activityId = primaryActivityIdFromPayload(payload, existing.activityId);
  const upgrade = upgradeFields(payload);
  await assertSubmittalReferences({ orgId, projectId, upgrade });
  await assertPackageReachable({ orgId, projectId, packageId: upgrade.packageId, currentPackageId: existing.packageId, projectAccess, viewerId: userId });
  const datesTouched = ["leadTimeWeeks", "reviewDays", "requiredOnSite", "workflowTemplateId"].some((key) => key in upgrade) || activityId !== existing.activityId;
  const submitBy = datesTouched ? await submitByFor({ projectId, record: { ...existing, ...upgrade, activityId } }) : undefined;

  const { row, patch } = await prisma.$transaction(async (tx) => {
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
        ...upgrade,
        ...(submitBy !== undefined ? { submitBy, ...(!existing.submittedOn && !payload.dueDate ? { dueDate: submitBy } : {}) } : {}),
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
    const workflowPatch = await submittalWorkflow.onStatusChange({ tx, orgId, projectId, existing, updated, actorId: userId });
    return { row: { ...updated, ...workflowPatch }, patch: workflowPatch };
  });
  await submittalWorkflow.afterStatusChange({ orgId, projectId, submittal: row, patch, actorId: userId });

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
  const submission = actionFields(payload, SUBMISSION_FIELDS);
  await ensureRevisionEvidence({ projectId, submittalId, payload: submission });

  return updateSubmittal({
    orgId,
    projectId,
    submittalId,
    payload: {
      ...submission,
      status: "under_review",
      submittedOn: submission.submittedOn || new Date().toISOString(),
      comment:
        submission.comment || submission.remarks || "Submittal submitted for review",
      statusComment:
        submission.statusComment ||
        submission.comment ||
        submission.remarks ||
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
      ...actionFields(payload, REVIEW_FIELDS),
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
        ...actionFields(payload, RETURN_FIELDS),
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

  const submission = actionFields(payload, SUBMISSION_FIELDS);
  await ensureRevisionEvidence({ projectId, submittalId, payload: submission });

  return updateSubmittal({
    orgId,
    projectId,
    submittalId,
    payload: {
      ...submission,
      status: "under_review",
      submittedOn: submission.submittedOn || new Date().toISOString(),
      comment:
        submission.comment ||
        submission.remarks ||
        "Submittal resubmitted for review",
      statusComment:
        submission.statusComment ||
        submission.comment ||
        submission.remarks ||
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
  viaWorkflow = false,
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
  if (!viaWorkflow) {
    await require("./workflow-engine.service").assertNotLocked({ tool: "submittal", projectId, recordId: submittalId });
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
  viaWorkflow = false,
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
  if (!viaWorkflow) {
    await require("./workflow-engine.service").assertNotLocked({ tool: "submittal", projectId, recordId: submittalId });
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
  projectAccess = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await prisma.submittal.findFirst({
    where: { id: submittalId, projectId },
  });

  if (!existing) {
    throw new HttpError(404, "SUBMITTAL_NOT_FOUND", "Submittal not found");
  }
  assertPartyWorkflowAccess({ projectAccess, record: existing });

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
  SUBMITTAL_STATUSES,
  assertDirectSubmittalChange,
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
