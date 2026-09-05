const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const auditService = require("./audit.service");
const approvalWorkflowService = require("./approval-workflow.service");
const { deriveBallInCourt } = require("./workflow-support.service");
const {
  ARCHIVED_STATUS,
  applyArchiveVisibility,
  assertNotArchived,
  archiveResult,
} = require("./archive-policy.service");

const RISK_STATUSES = Object.freeze({
  OPEN: "open",
  MONITORING: "monitoring",
  SUBMITTED: "submitted",
  CLOSED: "closed",
  ARCHIVED: ARCHIVED_STATUS,
});

const LEVELS = new Set(["low", "medium", "high"]);
const SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const ESCALATION_LEVELS = new Set(["none", "watch", "escalated"]);
const WORKFLOW_STATUSES = new Set([
  RISK_STATUSES.SUBMITTED,
  RISK_STATUSES.CLOSED,
  RISK_STATUSES.ARCHIVED,
]);
const RISK_SEVERITY_RANK = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

const userRefSelect = { select: { id: true, name: true, email: true } };

const riskInclude = {
  ownerUser: userRefSelect,
  reviewerUser: userRefSelect,
  approverUser: userRefSelect,
  assigneeUser: userRefSelect,
  ballInCourtUser: userRefSelect,
  assigneeCompany: { select: { id: true, name: true } },
  activityLinks: {
    include: {
      activity: {
        select: {
          id: true,
          name: true,
          activityCode: true,
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
  },
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, orgId: true },
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

const toIso = (value) => value?.toISOString?.() || value || null;

const normalizeSeverity = (value, fallback = "MEDIUM") => {
  const normalized = trimOrNull(value)?.toUpperCase() || fallback;
  if (!SEVERITIES.has(normalized)) {
    throw new HttpError(
      400,
      "INVALID_RISK_SEVERITY",
      "Risk severity is invalid",
    );
  }
  return normalized;
};

const normalizeLevel = (value, fallback = "medium") => {
  const normalized = trimOrNull(value)?.toLowerCase() || fallback;
  if (!LEVELS.has(normalized)) {
    throw new HttpError(400, "INVALID_RISK_LEVEL", "Risk level is invalid");
  }
  return normalized;
};

const normalizeEscalation = (value, fallback = "none") => {
  const normalized = trimOrNull(value)?.toLowerCase() || fallback;
  if (!ESCALATION_LEVELS.has(normalized)) {
    throw new HttpError(
      400,
      "INVALID_RISK_ESCALATION",
      "Risk escalation level is invalid",
    );
  }
  return normalized;
};

const normalizeStatus = (value, fallback = RISK_STATUSES.OPEN) => {
  const normalized = trimOrNull(value)?.toLowerCase() || fallback;
  if (!Object.values(RISK_STATUSES).includes(normalized)) {
    throw new HttpError(400, "INVALID_RISK_STATUS", "Risk status is invalid");
  }
  return normalized;
};

const parseDate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "INVALID_RISK_DATE", "Risk date is invalid");
  }
  return date;
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeActivityLinks = (payload = {}) => {
  const raw =
    payload.activityLinks !== undefined
      ? payload.activityLinks
      : payload.activityIds !== undefined
        ? payload.activityIds
        : payload.activityId !== undefined
          ? payload.activityId
            ? [payload.activityId]
            : []
          : null;

  if (raw === null) return null;

  return (Array.isArray(raw) ? raw : [raw])
    .map((entry, index) => {
      if (typeof entry === "string") {
        return {
          activityId: trimOrNull(entry),
          relationType: index === 0 ? "primary" : "affected",
          scheduleImpactDays: 0,
          costImpact: 0,
          notes: null,
        };
      }

      return {
        activityId: trimOrNull(entry?.activityId || entry?.id),
        relationType:
          trimOrNull(entry?.relationType) ||
          (index === 0 ? "primary" : "affected"),
        scheduleImpactDays: Math.round(toNumber(entry?.scheduleImpactDays, 0)),
        costImpact: toNumber(entry?.costImpact, 0),
        notes: trimOrNull(entry?.notes),
      };
    })
    .filter((entry) => entry.activityId);
};

const assertActivitiesInProject = async ({
  tx = prisma,
  projectId,
  activityLinks,
}) => {
  const ids = [
    ...new Set((activityLinks || []).map((link) => link.activityId)),
  ];
  if (!ids.length) return;

  const activities = await tx.activity.findMany({
    where: { projectId, id: { in: ids }, isActive: true },
    select: { id: true },
  });
  const found = new Set(activities.map((activity) => activity.id));
  const missing = ids.filter((id) => !found.has(id));

  if (missing.length) {
    throw new HttpError(
      400,
      "RISK_ACTIVITY_INVALID",
      "One or more linked activities are invalid for this project",
      { activityIds: missing },
    );
  }
};

const replaceRiskActivityLinks = async ({
  tx,
  projectId,
  riskId,
  activityLinks,
}) => {
  if (activityLinks === null) return;

  await assertActivitiesInProject({ tx, projectId, activityLinks });
  await tx.riskActivityLink.deleteMany({ where: { projectId, riskId } });

  if (!activityLinks.length) return;

  await tx.riskActivityLink.createMany({
    data: activityLinks.map((link) => ({
      projectId,
      riskId,
      activityId: link.activityId,
      relationType: link.relationType,
      scheduleImpactDays: link.scheduleImpactDays,
      costImpact: link.costImpact,
      notes: link.notes,
    })),
    skipDuplicates: true,
  });
};

const serializeActivityLink = (link) => ({
  id: link.id,
  projectId: link.projectId,
  riskId: link.riskId,
  activityId: link.activityId,
  relationType: link.relationType,
  scheduleImpactDays: link.scheduleImpactDays,
  costImpact: toNumber(link.costImpact),
  notes: link.notes || null,
  createdAt: toIso(link.createdAt),
  updatedAt: toIso(link.updatedAt),
  activity: link.activity
    ? {
        id: link.activity.id,
        name: link.activity.name,
        activityCode: link.activity.activityCode || null,
        p6ActivityId: link.activity.p6ActivityId || null,
        wbsCode: link.activity.wbsCode || null,
        isCritical: Boolean(link.activity.isCritical),
        totalFloat: link.activity.totalFloat ?? null,
        startDate: toIso(link.activity.startDate),
        endDate: toIso(link.activity.endDate),
      }
    : null,
});

const riskSummary = (risk) => ({
  ref: risk.ref,
  description: risk.description,
  severity: risk.severity,
  status: risk.status,
  archivedAt: toIso(risk.archivedAt),
  archivedBy: risk.archivedBy || null,
  owner: risk.owner,
  dueDate: toIso(risk.dueDate),
  escalationLevel: risk.escalationLevel,
  activityCount: risk.activityLinks?.length || 0,
});

const serializeRisk = (risk, approvalHistory = []) => ({
  id: risk.id,
  projectId: risk.projectId,
  ref: risk.ref,
  description: risk.description,
  probability: risk.probability,
  impact: risk.impact,
  severity: risk.severity,
  mitigation: risk.mitigation || null,
  responsePlan: risk.responsePlan || null,
  residualProbability: risk.residualProbability,
  residualImpact: risk.residualImpact,
  residualSeverity: risk.residualSeverity,
  residualDescription: risk.residualDescription || null,
  phase: risk.phase || null,
  owner: risk.owner || null,
  ownerUserId: risk.ownerUserId || null,
  reviewerUserId: risk.reviewerUserId || null,
  approverUserId: risk.approverUserId || null,
  assigneeUserId: risk.assigneeUserId || null,
  assigneeCompanyId: risk.assigneeCompanyId || null,
  ballInCourtUserId: risk.ballInCourtUserId || null,
  ownerUser: risk.ownerUser || null,
  reviewerUser: risk.reviewerUser || null,
  approverUser: risk.approverUser || null,
  assigneeUser: risk.assigneeUser || null,
  ballInCourtUser: risk.ballInCourtUser || null,
  assigneeCompany: risk.assigneeCompany || null,
  dueDate: toIso(risk.dueDate),
  escalationLevel: risk.escalationLevel,
  escalationNotes: risk.escalationNotes || null,
  status: risk.status,
  closeoutComment: risk.closeoutComment || null,
  closeoutSubmittedBy: risk.closeoutSubmittedBy || null,
  closeoutSubmittedAt: toIso(risk.closeoutSubmittedAt),
  closedBy: risk.closedBy || null,
  closedAt: toIso(risk.closedAt),
  rejectedBy: risk.rejectedBy || null,
  rejectedAt: toIso(risk.rejectedAt),
  rejectionReason: risk.rejectionReason || null,
  reopenedBy: risk.reopenedBy || null,
  reopenedAt: toIso(risk.reopenedAt),
  archivedAt: toIso(risk.archivedAt),
  archivedBy: risk.archivedBy || null,
  activityLinks: (risk.activityLinks || []).map(serializeActivityLink),
  activityIds: (risk.activityLinks || []).map((link) => link.activityId),
  approvalHistory,
  createdAt: toIso(risk.createdAt),
  updatedAt: toIso(risk.updatedAt),
});

const summarizeRiskActivityLinks = (
  links = [],
  { today = new Date() } = {},
) => {
  const activeLinks = links.filter(
    (link) =>
      link.risk &&
      !link.risk.archivedAt &&
      ![RISK_STATUSES.CLOSED, RISK_STATUSES.ARCHIVED].includes(
        link.risk.status,
      ),
  );
  if (!activeLinks.length) return null;

  const items = activeLinks
    .map((link) => {
      const risk = link.risk;
      const dueDate = risk.dueDate ? new Date(risk.dueDate) : null;
      return {
        id: risk.id,
        linkId: link.id,
        ref: risk.ref,
        description: risk.description,
        severity: risk.severity,
        status: risk.status,
        owner: risk.owner || null,
        dueDate: toIso(risk.dueDate),
        escalationLevel: risk.escalationLevel,
        relationType: link.relationType,
        scheduleImpactDays: link.scheduleImpactDays || 0,
        costImpact: toNumber(link.costImpact),
        notes: link.notes || null,
        isOverdue:
          Boolean(dueDate) &&
          dueDate < today &&
          ![RISK_STATUSES.SUBMITTED, RISK_STATUSES.CLOSED].includes(
            risk.status,
          ),
      };
    })
    .sort((a, b) => {
      const severityDelta =
        (RISK_SEVERITY_RANK[b.severity] || 0) -
        (RISK_SEVERITY_RANK[a.severity] || 0);
      if (severityDelta !== 0) return severityDelta;
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return (b.scheduleImpactDays || 0) - (a.scheduleImpactDays || 0);
    });
  const top = items[0];

  return {
    count: items.length,
    openCount: items.filter((item) => item.status === RISK_STATUSES.OPEN)
      .length,
    monitoringCount: items.filter(
      (item) => item.status === RISK_STATUSES.MONITORING,
    ).length,
    submittedCount: items.filter(
      (item) => item.status === RISK_STATUSES.SUBMITTED,
    ).length,
    overdueCount: items.filter((item) => item.isOverdue).length,
    highestSeverity: top.severity,
    escalationLevel: top.escalationLevel,
    dueDate: top.dueDate,
    items,
  };
};

const attachApprovalHistory = async ({ projectId, risks }) => {
  const rows = Array.isArray(risks) ? risks : [risks];
  const historyById = await approvalWorkflowService.listEventsForRecords({
    projectId,
    recordType: approvalWorkflowService.RECORD_TYPES.RISK,
    recordIds: rows.map((risk) => risk.id),
  });

  const serialized = rows.map((risk) =>
    serializeRisk(risk, historyById.get(risk.id) || []),
  );
  return Array.isArray(risks) ? serialized : serialized[0];
};

const findRisk = async ({ tx = prisma, projectId, riskId }) => {
  const risk = await tx.risk.findFirst({
    where: { id: riskId, projectId },
    include: riskInclude,
  });

  if (!risk) {
    throw new HttpError(404, "RISK_NOT_FOUND", "Risk not found");
  }

  return risk;
};

const recordStatusHistory = async ({
  tx,
  projectId,
  riskId,
  oldStatus,
  newStatus,
  comment = null,
  userId = null,
  userRole = null,
  force = false,
}) => {
  if (!tx.workflowStatusHistory?.create) return null;
  if (!force && (oldStatus || null) === (newStatus || null) && !comment) {
    return null;
  }

  return tx.workflowStatusHistory.create({
    data: {
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: riskId,
      oldStatus: oldStatus || null,
      newStatus: newStatus || null,
      comment: trimOrNull(comment),
      createdBy: userId || null,
      actorRole: userRole || null,
    },
  });
};

const recordAudit = async ({
  tx,
  orgId,
  projectId,
  risk,
  action,
  actorId = null,
  actorRole = null,
  oldStatus = null,
  newStatus = null,
  reason = null,
  oldSummary = null,
  metadata = {},
}) =>
  auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.RISK,
    entityId: risk.id,
    action,
    actorId,
    actorRole,
    oldStatus,
    newStatus,
    reason,
    oldSummary,
    newSummary: riskSummary(risk),
    summary: riskSummary(risk),
    metadata,
  });

const riskWorkflowMetadata = (risk, extra = {}) => ({
  ref: risk.ref,
  severity: risk.severity,
  residualSeverity: risk.residualSeverity,
  dueDate: toIso(risk.dueDate),
  escalationLevel: risk.escalationLevel,
  activityIds: (risk.activityLinks || []).map((link) => link.activityId),
  ...extra,
});

const buildRiskData = (payload, existing = null) => {
  const data = {};
  const fallback = existing || {};

  if (payload.description !== undefined) {
    data.description = trimOrNull(payload.description);
  }
  if (payload.probability !== undefined || !existing) {
    data.probability = normalizeLevel(
      payload.probability,
      fallback.probability || "medium",
    );
  }
  if (payload.impact !== undefined || !existing) {
    data.impact = normalizeLevel(payload.impact, fallback.impact || "medium");
  }
  if (payload.severity !== undefined || !existing) {
    data.severity = normalizeSeverity(
      payload.severity,
      fallback.severity || "MEDIUM",
    );
  }
  if (payload.mitigation !== undefined) {
    data.mitigation = trimOrNull(payload.mitigation);
  }
  if (payload.responsePlan !== undefined) {
    data.responsePlan = trimOrNull(payload.responsePlan);
  }
  if (payload.residualProbability !== undefined || !existing) {
    data.residualProbability = normalizeLevel(
      payload.residualProbability,
      fallback.residualProbability || "medium",
    );
  }
  if (payload.residualImpact !== undefined || !existing) {
    data.residualImpact = normalizeLevel(
      payload.residualImpact,
      fallback.residualImpact || "medium",
    );
  }
  if (payload.residualSeverity !== undefined || !existing) {
    data.residualSeverity = normalizeSeverity(
      payload.residualSeverity,
      fallback.residualSeverity || "MEDIUM",
    );
  }
  if (payload.residualDescription !== undefined) {
    data.residualDescription = trimOrNull(payload.residualDescription);
  }
  if (payload.phase !== undefined) data.phase = trimOrNull(payload.phase);
  if (payload.owner !== undefined) data.owner = trimOrNull(payload.owner);
  for (const field of [
    "ownerUserId",
    "reviewerUserId",
    "approverUserId",
    "assigneeUserId",
    "assigneeCompanyId",
    "ballInCourtUserId",
  ]) {
    if (payload[field] !== undefined) data[field] = trimOrNull(payload[field]);
  }
  if (payload.dueDate !== undefined) data.dueDate = parseDate(payload.dueDate);
  if (payload.escalationLevel !== undefined || !existing) {
    data.escalationLevel = normalizeEscalation(
      payload.escalationLevel,
      fallback.escalationLevel || "none",
    );
  }
  if (payload.escalationNotes !== undefined) {
    data.escalationNotes = trimOrNull(payload.escalationNotes);
  }
  if (payload.status !== undefined || !existing) {
    data.status = normalizeStatus(payload.status, fallback.status || "open");
  }

  if (payload.ballInCourtUserId === undefined) {
    data.ballInCourtUserId = deriveBallInCourt({
      status: data.status ?? fallback.status,
      refs: { ...fallback, ...data },
    });
  }

  return data;
};

const assertDirectStatusUpdateAllowed = ({ existingStatus, nextStatus }) => {
  if (!nextStatus || nextStatus === existingStatus) return;
  if (
    WORKFLOW_STATUSES.has(existingStatus) ||
    WORKFLOW_STATUSES.has(nextStatus)
  ) {
    throw new HttpError(
      400,
      "RISK_WORKFLOW_ACTION_REQUIRED",
      "Risk closeout status changes must use submit, approve, reject, or reopen workflow endpoints",
    );
  }
};

const listRisks = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });

  const where = { projectId };
  if (Object.values(RISK_STATUSES).includes(query.status)) {
    where.status = query.status;
  }
  applyArchiveVisibility(where, query);

  const risks = await prisma.risk.findMany({
    where,
    include: riskInclude,
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
  });

  return attachApprovalHistory({ projectId, risks });
};

const createRisk = async ({
  orgId,
  projectId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const status = normalizeStatus(payload.status, RISK_STATUSES.OPEN);
  if (WORKFLOW_STATUSES.has(status)) {
    throw new HttpError(
      400,
      "RISK_WORKFLOW_ACTION_REQUIRED",
      "Risk closeout status changes must use submit, approve, reject, or reopen workflow endpoints",
    );
  }

  const activityLinks = normalizeActivityLinks(payload);
  const count = await prisma.risk.count({ where: { projectId } });
  const ref = `RSK-${String(count + 1).padStart(2, "0")}`;

  const risk = await prisma.$transaction(async (tx) => {
    if (activityLinks !== null) {
      await assertActivitiesInProject({ tx, projectId, activityLinks });
    }

    const created = await tx.risk.create({
      data: {
        projectId,
        ref,
        ...buildRiskData({ ...payload, status }),
      },
    });

    await replaceRiskActivityLinks({
      tx,
      projectId,
      riskId: created.id,
      activityLinks,
    });

    const row = await tx.risk.findFirst({
      where: { id: created.id, projectId },
      include: riskInclude,
    });

    await recordStatusHistory({
      tx,
      projectId,
      riskId: row.id,
      oldStatus: null,
      newStatus: row.status,
      comment: payload.comment || payload.description,
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: row.id,
      fromStatus: null,
      toStatus: row.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.description,
      metadata: riskWorkflowMetadata(row),
    });
    await recordAudit({
      tx,
      orgId,
      projectId,
      risk: row,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      actorRole: userRole,
    });

    return row;
  });

  return attachApprovalHistory({ projectId, risks: risk });
};

const updateRisk = async ({
  orgId,
  projectId,
  riskId,
  payload,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });

  const existing = await findRisk({ projectId, riskId });
  assertNotArchived(existing, {
    code: "RISK_ARCHIVED",
    message: "Archived risks cannot be updated through normal workflow actions",
  });
  const data = buildRiskData(payload, existing);
  const nextStatus = data.status ?? existing.status;
  assertDirectStatusUpdateAllowed({
    existingStatus: existing.status,
    nextStatus,
  });
  const activityLinks = normalizeActivityLinks(payload);

  const risk = await prisma.$transaction(async (tx) => {
    const updated = await tx.risk.update({
      where: { id: riskId },
      data,
    });

    await replaceRiskActivityLinks({
      tx,
      projectId,
      riskId,
      activityLinks,
    });

    const row = await tx.risk.findFirst({
      where: { id: updated.id, projectId },
      include: riskInclude,
    });

    await recordStatusHistory({
      tx,
      projectId,
      riskId,
      oldStatus: existing.status,
      newStatus: row.status,
      comment: payload.comment || payload.statusComment,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: riskId,
      fromStatus: existing.status,
      toStatus: row.status,
      actorId: userId,
      actorRole: userRole,
      comment: payload.comment || payload.statusComment,
      metadata: riskWorkflowMetadata(row),
    });
    await recordAudit({
      tx,
      orgId,
      projectId,
      risk: row,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: row.status,
      oldSummary: riskSummary(existing),
    });

    return row;
  });

  return attachApprovalHistory({ projectId, risks: risk });
};

const submitRiskCloseout = async ({
  orgId,
  projectId,
  riskId,
  payload = {},
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  const existing = await findRisk({ projectId, riskId });

  if (
    ![RISK_STATUSES.OPEN, RISK_STATUSES.MONITORING].includes(existing.status)
  ) {
    throw new HttpError(
      409,
      "RISK_NOT_READY_FOR_CLOSEOUT",
      "Only open or monitoring risks can be submitted for closeout approval",
    );
  }

  const closeoutComment = trimOrNull(
    payload.closeoutComment || payload.comment || payload.statusComment,
  );
  if (!closeoutComment) {
    throw new HttpError(
      400,
      "RISK_CLOSEOUT_COMMENT_REQUIRED",
      "A closeout comment is required before risk closeout can be submitted",
    );
  }

  const responsePlan =
    payload.responsePlan !== undefined
      ? trimOrNull(payload.responsePlan)
      : existing.responsePlan || existing.mitigation;
  if (!responsePlan) {
    throw new HttpError(
      400,
      "RISK_RESPONSE_PLAN_REQUIRED",
      "A response plan or mitigation is required before risk closeout can be submitted",
    );
  }

  const dueDate =
    payload.dueDate !== undefined
      ? parseDate(payload.dueDate)
      : existing.dueDate;
  if (!dueDate) {
    throw new HttpError(
      400,
      "RISK_DUE_DATE_REQUIRED",
      "A mitigation due date is required before risk closeout can be submitted",
    );
  }

  const now = new Date();
  const risk = await prisma.$transaction(async (tx) => {
    const updated = await tx.risk.update({
      where: { id: riskId },
      data: {
        status: RISK_STATUSES.SUBMITTED,
        responsePlan,
        dueDate,
        closeoutComment,
        closeoutSubmittedBy: userId || null,
        closeoutSubmittedAt: now,
        closedBy: null,
        closedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
      },
    });

    const row = await tx.risk.findFirst({
      where: { id: updated.id, projectId },
      include: riskInclude,
    });

    await recordStatusHistory({
      tx,
      projectId,
      riskId,
      oldStatus: existing.status,
      newStatus: row.status,
      comment: closeoutComment,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: riskId,
      fromStatus: existing.status,
      toStatus: row.status,
      actorId: userId,
      actorRole: userRole,
      comment: closeoutComment,
      metadata: riskWorkflowMetadata(row),
    });
    await recordAudit({
      tx,
      orgId,
      projectId,
      risk: row,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: row.status,
      oldSummary: riskSummary(existing),
    });

    return row;
  });

  return attachApprovalHistory({ projectId, risks: risk });
};

const approveRiskCloseout = async ({
  orgId,
  projectId,
  riskId,
  comment = null,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  const existing = await findRisk({ projectId, riskId });

  if (existing.status !== RISK_STATUSES.SUBMITTED) {
    throw new HttpError(
      409,
      "RISK_NOT_READY_FOR_APPROVAL",
      "Only submitted risk closeouts can be approved",
    );
  }

  const now = new Date();
  const risk = await prisma.$transaction(async (tx) => {
    const updated = await tx.risk.update({
      where: { id: riskId },
      data: {
        status: RISK_STATUSES.CLOSED,
        closedBy: userId || null,
        closedAt: now,
      },
    });

    const row = await tx.risk.findFirst({
      where: { id: updated.id, projectId },
      include: riskInclude,
    });

    await recordStatusHistory({
      tx,
      projectId,
      riskId,
      oldStatus: existing.status,
      newStatus: row.status,
      comment,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: riskId,
      fromStatus: existing.status,
      toStatus: row.status,
      actorId: userId,
      actorRole: userRole,
      comment,
      metadata: riskWorkflowMetadata(row),
    });
    await recordAudit({
      tx,
      orgId,
      projectId,
      risk: row,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: row.status,
      oldSummary: riskSummary(existing),
    });

    return row;
  });

  return attachApprovalHistory({ projectId, risks: risk });
};

const rejectRiskCloseout = async ({
  orgId,
  projectId,
  riskId,
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
  const existing = await findRisk({ projectId, riskId });

  if (existing.status !== RISK_STATUSES.SUBMITTED) {
    throw new HttpError(
      409,
      "RISK_NOT_READY_FOR_REJECTION",
      "Only submitted risk closeouts can be rejected",
    );
  }

  const now = new Date();
  const risk = await prisma.$transaction(async (tx) => {
    const updated = await tx.risk.update({
      where: { id: riskId },
      data: {
        status: RISK_STATUSES.MONITORING,
        rejectedBy: userId || null,
        rejectedAt: now,
        rejectionReason,
        closedBy: null,
        closedAt: null,
      },
    });

    const row = await tx.risk.findFirst({
      where: { id: updated.id, projectId },
      include: riskInclude,
    });

    await recordStatusHistory({
      tx,
      projectId,
      riskId,
      oldStatus: existing.status,
      newStatus: row.status,
      comment: rejectionReason,
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: riskId,
      fromStatus: existing.status,
      toStatus: row.status,
      actorId: userId,
      actorRole: userRole,
      reason: rejectionReason,
      comment: rejectionReason,
      metadata: riskWorkflowMetadata(row),
      force: true,
    });
    await recordAudit({
      tx,
      orgId,
      projectId,
      risk: row,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: row.status,
      reason: rejectionReason,
      oldSummary: riskSummary(existing),
    });

    return row;
  });

  return attachApprovalHistory({ projectId, risks: risk });
};

const reopenRisk = async ({
  orgId,
  projectId,
  riskId,
  reason,
  userId = null,
  userRole = null,
}) => {
  const reopenReason = trimOrNull(reason);
  if (!reopenReason) {
    throw new HttpError(
      400,
      "RISK_REOPEN_REASON_REQUIRED",
      "A reason is required to reopen a risk",
    );
  }

  await ensureProject({ orgId, projectId });
  const existing = await findRisk({ projectId, riskId });

  if (existing.status !== RISK_STATUSES.CLOSED) {
    throw new HttpError(
      409,
      "RISK_NOT_READY_FOR_REOPEN",
      "Only closed risks can be reopened",
    );
  }

  const now = new Date();
  const risk = await prisma.$transaction(async (tx) => {
    const updated = await tx.risk.update({
      where: { id: riskId },
      data: {
        status: RISK_STATUSES.MONITORING,
        reopenedBy: userId || null,
        reopenedAt: now,
        closedBy: null,
        closedAt: null,
      },
    });

    const row = await tx.risk.findFirst({
      where: { id: updated.id, projectId },
      include: riskInclude,
    });

    await recordStatusHistory({
      tx,
      projectId,
      riskId,
      oldStatus: existing.status,
      newStatus: row.status,
      comment: reopenReason,
      userId,
      userRole,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: riskId,
      fromStatus: existing.status,
      toStatus: row.status,
      actorId: userId,
      actorRole: userRole,
      comment: reopenReason,
      metadata: riskWorkflowMetadata(row),
    });
    await recordAudit({
      tx,
      orgId,
      projectId,
      risk: row,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: row.status,
      reason: reopenReason,
      oldSummary: riskSummary(existing),
    });

    return row;
  });

  return attachApprovalHistory({ projectId, risks: risk });
};

const deleteRisk = async ({
  orgId,
  projectId,
  riskId,
  userId = null,
  userRole = null,
}) => {
  await ensureProject({ orgId, projectId });
  const existing = await findRisk({ projectId, riskId });

  if (existing.status === ARCHIVED_STATUS || existing.archivedAt) {
    return archiveResult({
      id: riskId,
      status: ARCHIVED_STATUS,
      archivedAt: existing.archivedAt,
    });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.risk.update({
      where: { id: riskId },
      data: {
        status: ARCHIVED_STATUS,
        archivedAt: now,
        archivedBy: userId || null,
      },
    });
    const row =
      (await tx.risk.findFirst({
        where: { id: updated.id, projectId },
        include: riskInclude,
      })) || updated;

    await recordStatusHistory({
      tx,
      projectId,
      riskId,
      oldStatus: existing.status,
      newStatus: ARCHIVED_STATUS,
      comment: "Risk archived",
      userId,
      userRole,
      force: true,
    });
    await approvalWorkflowService.recordTransition({
      tx,
      orgId,
      projectId,
      recordType: approvalWorkflowService.RECORD_TYPES.RISK,
      recordId: riskId,
      fromStatus: existing.status,
      toStatus: ARCHIVED_STATUS,
      actorId: userId,
      actorRole: userRole,
      comment: "Risk archived",
      metadata: riskWorkflowMetadata(row, {
        archivedAt: now.toISOString(),
      }),
    });
    await recordAudit({
      tx,
      orgId,
      projectId,
      risk: row,
      action: auditService.ACTIONS.ARCHIVED,
      actorId: userId,
      actorRole: userRole,
      oldStatus: existing.status,
      newStatus: ARCHIVED_STATUS,
      oldSummary: riskSummary(existing),
      metadata: { source: "risk.archive" },
    });
  });

  return archiveResult({ id: riskId, archivedAt: now });
};

module.exports = {
  RISK_STATUSES,
  listRisks,
  createRisk,
  updateRisk,
  submitRiskCloseout,
  approveRiskCloseout,
  rejectRiskCloseout,
  reopenRisk,
  deleteRisk,
  summarizeRiskActivityLinks,
};
