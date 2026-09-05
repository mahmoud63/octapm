const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { toMoneyNumber } = require('../utils/money');
const auditService = require('./audit.service');

const PROGRESS_METHODS = [
  'percent',
  'quantity',
  'weighted_milestone',
  'inspection',
  'manual',
];

const SUBMISSION_STATUSES = ['draft', 'submitted', 'approved', 'rejected'];
const APPROVABLE_STATUSES = ['draft', 'submitted'];
const PROGRESS_ASSIGNMENT_OVERRIDE_ROLES = new Set(['pm', 'planning_eng']);

const METHOD_ALIASES = {
  percent_complete: 'percent',
  physical_percent: 'percent',
  duration: 'percent',
  milestone: 'weighted_milestone',
};

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clampPercent = (value) => Math.max(0, Math.min(100, toNumber(value)));

const parseDate = (value, field = 'date') => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'INVALID_DATE', `${field} is invalid`);
  }
  return date;
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const normalizeMethod = (method) => {
  const key = String(method || 'percent').trim().toLowerCase();
  const normalized = METHOD_ALIASES[key] || key;
  if (!PROGRESS_METHODS.includes(normalized)) {
    throw new HttpError(
      400,
      'INVALID_PROGRESS_METHOD',
      `Progress method must be one of: ${PROGRESS_METHODS.join(', ')}`,
    );
  }
  return normalized;
};

const normalizeEvidence = (payload = {}, fallbackPhotos = null) => {
  const evidence =
    payload.evidenceJson ??
    payload.evidence ??
    (fallbackPhotos ? { photos: fallbackPhotos } : null);

  if (!evidence) return null;
  if (Array.isArray(evidence)) return { photos: evidence };
  if (typeof evidence === 'object') return evidence;
  return { notes: String(evidence) };
};

const hasEvidence = (evidence) => {
  if (!evidence) return false;
  if (Array.isArray(evidence)) return evidence.length > 0;
  if (Array.isArray(evidence.photos)) return evidence.photos.length > 0;
  return Object.keys(evidence).length > 0;
};

const getEvidenceAttachments = (evidence) => {
  if (!evidence) return [];
  const photos = Array.isArray(evidence)
    ? evidence
    : Array.isArray(evidence.photos)
      ? evidence.photos
      : [];

  return photos.slice(0, 10).map((photo) => {
    if (typeof photo === 'string') return { url: photo };
    return {
      url: photo?.url || null,
      name: photo?.name || photo?.filename || null,
      type: photo?.type || 'photo',
    };
  });
};

const normalizeMilestones = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.milestones)) return value.milestones;

  return Object.entries(value).map(([key, raw]) => {
    if (typeof raw === 'object' && raw !== null) {
      return { id: key, ...raw };
    }
    return { id: key, pctComplete: raw };
  });
};

const mergeMilestoneWeights = (configured, submitted) => {
  const submittedRows = normalizeMilestones(submitted);
  const configuredRows = normalizeMilestones(configured);
  const configMap = new Map(
    configuredRows.map((row, index) => [
      String(row.id || row.name || index),
      row,
    ]),
  );

  if (!submittedRows.length) return configuredRows;

  return submittedRows.map((row, index) => {
    const key = String(row.id || row.name || index);
    const config = configMap.get(key) || {};
    return {
      ...config,
      ...row,
      weight: row.weight ?? config.weight ?? 0,
    };
  });
};

const calculateProgressPercent = ({
  method,
  methodConfig = null,
  payload = {},
}) => {
  const normalizedMethod = normalizeMethod(method || methodConfig?.method);

  if (normalizedMethod === 'quantity') {
    const planned = toNumber(
      payload.quantityPlanned ?? methodConfig?.plannedQuantity,
    );
    const complete = toNumber(payload.quantityComplete);
    if (planned <= 0) {
      throw new HttpError(
        400,
        'PLANNED_QUANTITY_REQUIRED',
        'Quantity progress requires a planned quantity greater than zero',
      );
    }
    return clampPercent((complete / planned) * 100);
  }

  if (normalizedMethod === 'weighted_milestone') {
    const rows = mergeMilestoneWeights(
      methodConfig?.milestoneWeightsJson,
      payload.milestoneProgressJson ?? payload.milestones,
    );
    const totalWeight = rows.reduce((sum, row) => sum + toNumber(row.weight), 0);
    if (rows.length && totalWeight > 0) {
      const earned = rows.reduce((sum, row) => {
        const pct =
          row.pctComplete !== undefined
            ? clampPercent(row.pctComplete)
            : row.complete || row.completed
              ? 100
              : 0;
        return sum + toNumber(row.weight) * pct;
      }, 0);
      return clampPercent(earned / totalWeight);
    }
    return clampPercent(payload.pctComplete);
  }

  if (normalizedMethod === 'inspection') {
    const inspectionStatus = String(payload.inspectionStatus || '').toLowerCase();
    if (['passed', 'approved', 'accepted'].includes(inspectionStatus)) {
      return payload.pctComplete !== undefined
        ? clampPercent(payload.pctComplete)
        : 100;
    }
    if (['failed', 'rejected'].includes(inspectionStatus)) return 0;
    return clampPercent(payload.pctComplete);
  }

  return clampPercent(payload.pctComplete);
};

const serializeMethodConfig = (row) =>
  row
    ? {
        id: row.id,
        projectId: row.projectId,
        activityId: row.activityId,
        method: row.method,
        plannedQuantity: row.plannedQuantity,
        quantityUnit: row.quantityUnit,
        milestoneWeights: row.milestoneWeightsJson || [],
        inspectionRequired: Boolean(row.inspectionRequired),
        evidenceRequired: Boolean(row.evidenceRequired),
        notes: row.notes || null,
        updatedAt: toIso(row.updatedAt),
      }
    : null;

const serializeSubmission = (row) =>
  row
    ? {
        id: row.id,
        projectId: row.projectId,
        activityId: row.activityId,
        dailyReportId: row.dailyReportId || null,
        method: row.method,
        source: row.source,
        pctComplete: row.pctComplete,
        quantityComplete: row.quantityComplete,
        quantityPlanned: row.quantityPlanned,
        quantityUnit: row.quantityUnit,
        milestoneProgress: row.milestoneProgressJson || null,
        inspectionStatus: row.inspectionStatus || null,
        actualCost: row.actualCost,
        actualStart: toIso(row.actualStart),
        actualFinish: toIso(row.actualFinish),
        notes: row.notes || null,
        evidence: row.evidenceJson || null,
        status: row.status,
        submittedBy: row.submittedBy || null,
        submittedAt: toIso(row.submittedAt),
        reviewedBy: row.reviewedBy || null,
        reviewedAt: toIso(row.reviewedAt),
        rejectionReason: row.rejectionReason || null,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
        activity: row.activity
          ? {
              id: row.activity.id,
              name: row.activity.name,
              wbsCode: row.activity.wbsCode,
              p6ActivityId: row.activity.p6ActivityId,
            }
          : undefined,
      }
    : null;

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  return project;
};

const ensureActivity = async ({ projectId, activityId }, tx = prisma) => {
  const activity = await tx.activity.findFirst({
    where: { id: activityId, projectId, isActive: true },
  });
  if (!activity) {
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  }
  return activity;
};

const canOverrideProgressAssignment = (userRole) =>
  PROGRESS_ASSIGNMENT_OVERRIDE_ROLES.has(String(userRole || '').toLowerCase());

const assertProgressSubmitAllowed = async ({
  projectId,
  activityIds,
  userId,
  userRole,
  tx = prisma,
}) => {
  const uniqueActivityIds = [...new Set((activityIds || []).filter(Boolean))];
  if (!uniqueActivityIds.length || canOverrideProgressAssignment(userRole)) {
    return;
  }

  if (!userId) {
    throw new HttpError(
      403,
      'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED',
      'Progress can only be submitted by assigned activity users or PM/planning overrides',
      { activityIds: uniqueActivityIds },
    );
  }

  const assignments = await tx.activityAssignment.findMany({
    where: {
      userId,
      activityId: { in: uniqueActivityIds },
      activity: { projectId },
    },
    select: { activityId: true },
  });
  const assignedIds = new Set(assignments.map((row) => row.activityId));
  const missing = uniqueActivityIds.filter(
    (activityId) => !assignedIds.has(activityId),
  );

  if (missing.length) {
    throw new HttpError(
      403,
      'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED',
      'Progress can only be submitted by assigned activity users or PM/planning overrides',
      { activityIds: missing },
    );
  }
};

const getMethodConfigRow = async ({ projectId, activityId }, tx = prisma) =>
  tx.activityProgressMethod.findFirst({
    where: { projectId, activityId },
  });

const resolveMethodConfig = async ({ projectId, activityId }, tx = prisma) => {
  const row = await getMethodConfigRow({ projectId, activityId }, tx);
  return (
    row || {
      projectId,
      activityId,
      method: 'percent',
      plannedQuantity: null,
      quantityUnit: null,
      milestoneWeightsJson: null,
      inspectionRequired: false,
      evidenceRequired: false,
      notes: null,
    }
  );
};

const getProgressMethod = async ({ orgId, projectId, activityId }) => {
  await ensureProject({ orgId, projectId });
  await ensureActivity({ projectId, activityId });
  return serializeMethodConfig(
    await resolveMethodConfig({ projectId, activityId }),
  );
};

const upsertProgressMethod = async ({
  orgId,
  projectId,
  activityId,
  userId,
  payload,
}) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    await ensureActivity({ projectId, activityId }, tx);

    const method = normalizeMethod(payload.method);
    const row = await tx.activityProgressMethod.upsert({
      where: { activityId },
      create: {
        projectId,
        activityId,
        method,
        plannedQuantity:
          payload.plannedQuantity !== undefined
            ? toNumber(payload.plannedQuantity)
            : null,
        quantityUnit: payload.quantityUnit?.trim() || null,
        milestoneWeightsJson: payload.milestoneWeights ?? null,
        inspectionRequired: Boolean(payload.inspectionRequired),
        evidenceRequired: Boolean(payload.evidenceRequired),
        notes: payload.notes?.trim() || null,
        createdBy: userId || null,
        updatedBy: userId || null,
      },
      update: {
        method,
        plannedQuantity:
          payload.plannedQuantity !== undefined
            ? toNumber(payload.plannedQuantity)
            : null,
        quantityUnit: payload.quantityUnit?.trim() || null,
        milestoneWeightsJson: payload.milestoneWeights ?? null,
        inspectionRequired: Boolean(payload.inspectionRequired),
        evidenceRequired: Boolean(payload.evidenceRequired),
        notes: payload.notes?.trim() || null,
        updatedBy: userId || null,
      },
    });

    return serializeMethodConfig(row);
  });

const buildSubmissionData = async ({
  projectId,
  activityId,
  userId,
  payload,
  dailyReportId = null,
  fallbackPhotos = null,
  tx = prisma,
}) => {
  const methodConfig = await resolveMethodConfig({ projectId, activityId }, tx);
  const method = normalizeMethod(payload.method || payload.progressMethod || methodConfig.method);
  const status = payload.status || 'submitted';
  if (!SUBMISSION_STATUSES.includes(status)) {
    throw new HttpError(
      400,
      'INVALID_PROGRESS_STATUS',
      `Progress status must be one of: ${SUBMISSION_STATUSES.join(', ')}`,
    );
  }

  const evidence = normalizeEvidence(payload, fallbackPhotos);
  if (
    status !== 'draft' &&
    methodConfig.evidenceRequired &&
    !hasEvidence(evidence)
  ) {
    throw new HttpError(
      400,
      'PROGRESS_EVIDENCE_REQUIRED',
      'This activity requires evidence before progress can be submitted',
    );
  }

  const pctComplete = calculateProgressPercent({
    method,
    methodConfig,
    payload,
  });
  const now = new Date();

  return {
    projectId,
    activityId,
    dailyReportId,
    method,
    source: payload.source || (dailyReportId ? 'daily_report' : 'manual'),
    pctComplete,
    quantityComplete:
      payload.quantityComplete !== undefined
        ? toNumber(payload.quantityComplete)
        : null,
    quantityPlanned:
      payload.quantityPlanned !== undefined
        ? toNumber(payload.quantityPlanned)
        : methodConfig.plannedQuantity,
    quantityUnit:
      payload.quantityUnit?.trim() || methodConfig.quantityUnit || null,
    milestoneProgressJson:
      payload.milestoneProgressJson ?? payload.milestones ?? null,
    inspectionStatus: payload.inspectionStatus?.trim() || null,
    actualCost:
      payload.actualCost !== undefined && payload.actualCost !== null
        ? toMoneyNumber(payload.actualCost)
        : null,
    actualStart:
      payload.actualStart !== undefined
        ? parseDate(payload.actualStart, 'actualStart')
        : null,
    actualFinish:
      payload.actualFinish !== undefined
        ? parseDate(payload.actualFinish, 'actualFinish')
        : null,
    notes: payload.notes?.trim() || null,
    evidenceJson: evidence,
    status,
    submittedBy: status === 'draft' ? null : userId || null,
    submittedAt: status === 'draft' ? null : now,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdBy: userId || null,
    updatedBy: userId || null,
  };
};

const createProgressSubmission = async ({
  orgId,
  projectId,
  activityId,
  userId,
  userRole,
  payload,
  dailyReportId = null,
  fallbackPhotos = null,
  tx = null,
}) => {
  const runner = async (client) => {
    await ensureProject({ orgId, projectId }, client);
    await ensureActivity({ projectId, activityId }, client);
    await assertProgressSubmitAllowed({
      projectId,
      activityIds: [activityId],
      userId,
      userRole,
      tx: client,
    });
    const data = await buildSubmissionData({
      projectId,
      activityId,
      userId,
      payload,
      dailyReportId,
      fallbackPhotos,
      tx: client,
    });
    const row = await client.progressSubmission.create({ data });
    await auditService.recordEvent({
      tx: client,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.PROGRESS_SUBMISSION,
      entityId: row.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      newStatus: row.status,
      newSummary: {
        activityId: row.activityId,
        status: row.status,
        pctComplete: row.pctComplete,
        method: row.method,
        source: row.source,
      },
      summary: {
        transition:
          row.status === 'draft'
            ? 'submission.create_draft'
            : 'submission.submit',
        activityId: row.activityId,
        pctComplete: row.pctComplete,
        method: row.method,
        source: row.source,
      },
      attachments: getEvidenceAttachments(row.evidenceJson),
    });
    return serializeSubmission(row);
  };

  return tx ? runner(tx) : prisma.$transaction(runner);
};

const listProgressSubmissions = async ({
  orgId,
  projectId,
  activityId = null,
  status = null,
}) => {
  await ensureProject({ orgId, projectId });
  const where = { projectId };
  if (activityId) where.activityId = activityId;
  if (status) where.status = status;

  const rows = await prisma.progressSubmission.findMany({
    where,
    include: {
      activity: {
        select: {
          id: true,
          name: true,
          wbsCode: true,
          p6ActivityId: true,
        },
      },
    },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return rows.map(serializeSubmission);
};

const ensureSubmission = async ({ projectId, submissionId }, tx = prisma) => {
  const submission = await tx.progressSubmission.findFirst({
    where: { id: submissionId, projectId },
    include: { activity: true },
  });
  if (!submission) {
    throw new HttpError(
      404,
      'PROGRESS_SUBMISSION_NOT_FOUND',
      'Progress submission not found',
    );
  }
  return submission;
};

const approveProgressSubmissionWithClient = async ({
  tx = prisma,
  orgId,
  projectId,
  activityId = null,
  submissionId,
  userId,
}) => {
  await ensureProject({ orgId, projectId }, tx);
  const submission = await ensureSubmission({ projectId, submissionId }, tx);
  if (activityId && submission.activityId !== activityId) {
    throw new HttpError(
      404,
      'PROGRESS_SUBMISSION_NOT_FOUND',
      'Progress submission not found for this activity',
    );
  }

  if (submission.status === 'approved') {
    return serializeSubmission(submission);
  }
  if (!APPROVABLE_STATUSES.includes(submission.status)) {
    throw new HttpError(
      400,
      'PROGRESS_NOT_APPROVABLE',
      'Only draft or submitted progress can be approved',
    );
  }

  const methodConfig = await resolveMethodConfig(
    { projectId, activityId: submission.activityId },
    tx,
  );
  if (methodConfig.evidenceRequired && !hasEvidence(submission.evidenceJson)) {
    throw new HttpError(
      400,
      'PROGRESS_EVIDENCE_REQUIRED',
      'This activity requires evidence before progress can be approved',
    );
  }

  // ITP hold points on the activity must pass before progress is approved
  // (OCTA-QA-TEMPLATE-014). Required lazily to avoid a service cycle.
  const holdPoints = await require('./form.service').openHoldPoints(
    { projectId, activityId: submission.activityId },
    tx,
  );
  if (holdPoints.length) {
    const first = holdPoints[0];
    throw new HttpError(
      409,
      'ITP_HOLD_POINT_OPEN',
      `${holdPoints.length} ITP hold point${holdPoints.length === 1 ? '' : 's'} on this activity ${holdPoints.length === 1 ? 'has' : 'have'} not passed (${first.ref}: ${first.label} — ${first.state})`,
      { holdPoints },
    );
  }

  const now = new Date();
  const approved = await tx.progressSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'approved',
      reviewedBy: userId || null,
      reviewedAt: now,
      rejectionReason: null,
      submittedBy: submission.submittedBy || userId || null,
      submittedAt: submission.submittedAt || now,
      updatedBy: userId || null,
    },
  });

  const approvedProgress = await tx.activityProgress.create({
    data: {
      activityId: approved.activityId,
      submissionId: approved.id,
      pctComplete: clampPercent(approved.pctComplete),
      actualCost: approved.actualCost,
      actualStart: approved.actualStart,
      actualFinish: approved.actualFinish,
      progressMethod: approved.method,
      source: approved.source,
      quantityComplete: approved.quantityComplete,
      quantityPlanned: approved.quantityPlanned,
      quantityUnit: approved.quantityUnit,
      milestoneProgressJson: approved.milestoneProgressJson,
      inspectionStatus: approved.inspectionStatus,
      evidenceJson: approved.evidenceJson,
      status: 'approved',
      approvedBy: userId || null,
      approvedAt: now,
      notes: approved.notes,
      updatedBy: userId || null,
    },
  });

  await auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.PROGRESS_SUBMISSION,
    entityId: approved.id,
    action: auditService.ACTIONS.APPROVED,
    actorId: userId,
    occurredAt: now,
    oldStatus: submission.status,
    newStatus: 'approved',
    oldSummary: {
      activityId: submission.activityId,
      status: submission.status,
      pctComplete: submission.pctComplete,
      method: submission.method,
      source: submission.source,
    },
    newSummary: {
      activityId: approved.activityId,
      status: approved.status,
      pctComplete: approved.pctComplete,
      method: approved.method,
      source: approved.source,
      approvedProgressId: approvedProgress.id,
    },
    summary: {
      transition: 'submission.approve',
      activityId: approved.activityId,
      activityName: submission.activity?.name || null,
      pctComplete: approved.pctComplete,
      method: approved.method,
      source: approved.source,
    },
    attachments: getEvidenceAttachments(approved.evidenceJson),
  });

  return serializeSubmission(approved);
};

const approveProgressSubmission = async (params) =>
  prisma.$transaction((tx) => approveProgressSubmissionWithClient({ ...params, tx }));

const rejectProgressSubmissionWithClient = async ({
  tx = prisma,
  orgId,
  projectId,
  activityId = null,
  submissionId,
  userId,
  reason,
}) => {
  await ensureProject({ orgId, projectId }, tx);
  const submission = await ensureSubmission({ projectId, submissionId }, tx);
  if (activityId && submission.activityId !== activityId) {
    throw new HttpError(
      404,
      'PROGRESS_SUBMISSION_NOT_FOUND',
      'Progress submission not found for this activity',
    );
  }

  if (submission.status === 'rejected') {
    return serializeSubmission(submission);
  }

  if (submission.status === 'approved') {
    throw new HttpError(
      400,
      'APPROVED_PROGRESS_LOCKED',
      'Approved progress cannot be rejected',
    );
  }

  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) {
    throw new HttpError(
      400,
      'REJECTION_REASON_REQUIRED',
      'A rejection reason is required',
    );
  }

  const row = await tx.progressSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'rejected',
      reviewedBy: userId || null,
      reviewedAt: new Date(),
      rejectionReason: trimmedReason,
      updatedBy: userId || null,
    },
  });

  await auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.PROGRESS_SUBMISSION,
    entityId: row.id,
    action: auditService.ACTIONS.REJECTED,
    actorId: userId,
    occurredAt: row.reviewedAt || new Date(),
    oldStatus: submission.status,
    newStatus: 'rejected',
    reason: trimmedReason,
    oldSummary: {
      activityId: submission.activityId,
      status: submission.status,
      pctComplete: submission.pctComplete,
      method: submission.method,
    },
    newSummary: {
      activityId: row.activityId,
      status: row.status,
      pctComplete: row.pctComplete,
      method: row.method,
    },
    summary: {
      transition: 'submission.reject',
      activityId: row.activityId,
      activityName: submission.activity?.name || null,
    },
  });

  return serializeSubmission(row);
};

const rejectProgressSubmission = async (params) =>
  prisma.$transaction((tx) => rejectProgressSubmissionWithClient({ ...params, tx }));

module.exports = {
  PROGRESS_METHODS,
  SUBMISSION_STATUSES,
  calculateProgressPercent,
  normalizeMethod,
  serializeMethodConfig,
  serializeSubmission,
  getProgressMethod,
  upsertProgressMethod,
  createProgressSubmission,
  assertProgressSubmitAllowed,
  listProgressSubmissions,
  approveProgressSubmissionWithClient,
  approveProgressSubmission,
  rejectProgressSubmissionWithClient,
  rejectProgressSubmission,
};
