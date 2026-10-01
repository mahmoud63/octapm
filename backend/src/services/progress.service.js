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
// PC-6: a quantity entry a submission may bundle, and the submission
// statuses that keep the entries they bundle (an entry belongs to at most
// one open submission).
const BUNDLEABLE_ENTRY_STATUSES = ['draft', 'submitted'];
const OPEN_SUBMISSION_STATUSES = ['draft', 'submitted'];
const QUANTITY_ENTRY_ENTITY_TYPE = 'quantity_progress_entry';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}/;
const BUNDLED_ENTRY_SELECT = {
  id: true,
  activityId: true,
  boqItemId: true,
  quantity: true,
  unitCode: true,
  date: true,
  source: true,
  status: true,
  submissionId: true,
  dailyLogId: true,
  createdBy: true,
  submission: { select: { id: true, status: true } },
};

// quantity-progress.service requires this file (the assignment rule); the
// planned and installed figures are read from it lazily for the same reason
// form.service is.
const quantityProgressService = () => require('./quantity-progress.service');
const uomService = () => require('./uom.service');

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

/**
 * PROGRESS SOURCE provenance (PC-6, owner rule): where a figure came from,
 * who put it forward, who made it official and when, the daily log or import
 * it came through, and how many quantity entries it bundles. One shape for an
 * official figure (an ActivityProgress row, with its submission when the
 * link survives) and for a pending one (a submission). importDocumentId is
 * carried for the shape: no column links a submission to the import
 * document it came from (the import names itself in `source` and `notes`).
 */
const buildProgressSource = ({ submission = null, progress = null }) => {
  const entries = Array.isArray(submission?.quantityEntries) ? submission.quantityEntries : [];
  const dailyLogId = entries.find((entry) => entry?.dailyLogId)?.dailyLogId || null;
  const approved = progress || (submission?.status === 'approved' ? submission : null);
  return {
    source: progress?.source ?? submission?.source ?? null,
    submissionId: progress?.submissionId ?? submission?.id ?? null,
    dailyLogId,
    dailyReportId: submission?.dailyReportId || null,
    importDocumentId: null,
    submittedBy: submission?.submittedBy || null,
    submittedAt: toIso(submission?.submittedAt),
    approvedBy: progress?.approvedBy ?? (approved ? approved.reviewedBy || null : null),
    approvedAt: toIso(progress?.approvedAt ?? (approved ? approved.reviewedAt : null)),
    entries: entries.length,
  };
};

/** The activity payload's structured provenance of its official figure (additive beside approvedProgressSource). */
const serializeProgressSource = (progress) =>
  progress ? buildProgressSource({ progress, submission: progress.submission || null }) : null;

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
        // PC-6: the quantity entries this submission bundles (ids and their
        // state), and the structured PROGRESS SOURCE beside the string fields.
        quantityEntryIds: Array.isArray(row.quantityEntries) ? row.quantityEntries.map((entry) => entry.id) : [],
        progressSource: buildProgressSource({ submission: row }),
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

/**
 * The method an activity's progress is measured by today: its configured
 * method, else the method its latest official figure was approved under,
 * else percent (what resolveMethodConfig answers without a row).
 */
const effectiveMethodFor = async ({ projectId, activityId }, tx = prisma) => {
  const config = await getMethodConfigRow({ projectId, activityId }, tx);
  if (config) return { method: normalizeMethod(config.method), basis: 'method_config' };
  const latest = await tx.activityProgress.findFirst({
    where: { activityId, status: 'approved' },
    orderBy: { updatedAt: 'desc' },
    select: { progressMethod: true },
  });
  if (latest) {
    try {
      return { method: normalizeMethod(latest.progressMethod), basis: 'approved_progress' };
    } catch {
      return { method: 'percent', basis: 'approved_progress' };
    }
  }
  return { method: 'percent', basis: 'default' };
};

/**
 * PC-6 §2: a method change on an activity with approved progress is refused —
 * the frozen pctComplete history is source data, and a percentage approved
 * under one method does not read under another. Writing a row that names
 * the method the activity is already measured by is not a change (the
 * readiness engine counts configured methods, and an activity whose official
 * figures were approved under the default needs its row to clear
 * PROGRESS_METHODS_INCOMPLETE).
 */
const assertMethodChangeAllowed = async ({ projectId, activityId, method }, tx = prisma) => {
  const approvedProgressCount = await tx.activityProgress.count({
    where: { activityId, status: 'approved' },
  });
  if (!approvedProgressCount) return;
  const effective = await effectiveMethodFor({ projectId, activityId }, tx);
  if (effective.method === method) return;
  throw new HttpError(
    409,
    'PROGRESS_METHOD_LOCKED',
    `This activity has ${approvedProgressCount} approved progress record${approvedProgressCount === 1 ? '' : 's'} measured by ${effective.method}; its method is not changed to ${method}`,
    { activityId, effectiveMethod: effective.method, effectiveMethodBasis: effective.basis, requestedMethod: method, approvedProgressCount },
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
    await assertMethodChangeAllowed({ projectId, activityId, method }, tx);
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

// ─── PC-6: quantity bundles ────────────────────────────────────────────────

const uniqueIds = (value) =>
  Array.isArray(value)
    ? [...new Set(value.map((id) => (id === null || id === undefined ? '' : String(id).trim())).filter(Boolean))]
    : [];

const isOpenlyBundled = (entry) =>
  Boolean(entry.submissionId && entry.submission && OPEN_SUBMISSION_STATUSES.includes(entry.submission.status));

/**
 * The quantity entries a quantity-method submission bundles: the ones named
 * (`entryIds`, each on this activity, draft or submitted, in no other open
 * submission) and/or every submitted entry of the activity dated on or before
 * `bundleSubmittedThrough` that no open submission holds. null when the
 * payload bundles nothing (a submission typed the old way).
 */
const resolveQuantityBundle = async ({ orgId, projectId, activityId, payload }, tx) => {
  const entryIds = uniqueIds(payload.entryIds);
  const through = payload.bundleSubmittedThrough ?? payload.bundleThrough ?? null;
  if (!entryIds.length && !through) return null;

  const bundled = new Map();
  if (entryIds.length) {
    const rows = await tx.quantityProgressEntry.findMany({
      where: { id: { in: entryIds }, projectId, orgId },
      select: BUNDLED_ENTRY_SELECT,
    });
    const found = new Set(rows.map((row) => row.id));
    const missing = entryIds.filter((id) => !found.has(id));
    if (missing.length) {
      throw new HttpError(404, 'QUANTITY_ENTRY_NOT_FOUND', 'Quantity entry not found', { entryIds: missing });
    }
    for (const row of rows) {
      if (row.activityId !== activityId) {
        throw new HttpError(
          400,
          'QUANTITY_ENTRY_ACTIVITY_MISMATCH',
          'A submission bundles entries of its own activity only',
          { entryId: row.id, entryActivityId: row.activityId, activityId },
        );
      }
      if (!BUNDLEABLE_ENTRY_STATUSES.includes(row.status)) {
        throw new HttpError(
          409,
          'QUANTITY_ENTRY_LOCKED',
          `A ${row.status} quantity entry is not bundled again; record a correction as a new entry`,
          { entryId: row.id, status: row.status },
        );
      }
      if (isOpenlyBundled(row)) {
        throw new HttpError(
          409,
          'QUANTITY_ENTRY_BUNDLED',
          'This entry is part of a progress submission awaiting approval; reject the submission first',
          { entryId: row.id, submissionId: row.submissionId, submissionStatus: row.submission.status },
        );
      }
      bundled.set(row.id, row);
    }
  }
  if (through) {
    const text = String(through).trim();
    if (!DATE_ONLY.test(text)) throw new HttpError(400, 'INVALID_DATE', 'bundleSubmittedThrough is invalid');
    const date = parseDate(`${text.slice(0, 10)}T00:00:00.000Z`, 'bundleSubmittedThrough');
    const rows = await tx.quantityProgressEntry.findMany({
      where: { projectId, orgId, activityId, status: 'submitted', date: { lte: date } },
      select: BUNDLED_ENTRY_SELECT,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    for (const row of rows) {
      if (!isOpenlyBundled(row)) bundled.set(row.id, row);
    }
  }
  if (!bundled.size) {
    throw new HttpError(
      400,
      'QUANTITY_NO_ENTRIES_TO_BUNDLE',
      'No submitted quantity entry of this activity is free to bundle',
      { activityId, entryIds, bundleSubmittedThrough: through || null },
    );
  }
  return [...bundled.values()];
};

/**
 * The figures of a quantity-method submission (PC-6 §2, §3):
 *
 * - planned: the typed method-configuration figure when there is one (basis
 *   method_config), else Σ approved, active allocation quantity of the
 *   activity (basis approved_allocations) — quantity-progress.service
 *   plannedQuantityFor. A client-sent quantityPlanned never overrides either;
 *   it counts only when neither exists (basis client — an activity measured
 *   by quantity with nothing mapped and nothing typed, the pre-PC-6 shape),
 *   and without it the submission is refused as before. At approval, when
 *   still nothing is typed and nothing mapped, the figure the submission
 *   was put forward with (its frozen quantityPlanned — `frozen`) is the
 *   planned quantity (basis submission): the bundle a client planned is
 *   approvable, not stuck between an approval that cannot derive and an
 *   edit the bundle refuses.
 * - installed: when the submission bundles entries, Σ the bundled entries +
 *   Σ entries already approved on the activity (basis approved_entries), in
 *   one unit — the planned figure's when it has one; otherwise the client's
 *   typed quantityComplete (basis client), the pre-PC-6 shape.
 * - pctComplete = installed ÷ planned, clamped to 0..100.
 */
const deriveQuantityFigures = async ({ orgId, projectId, activityId, payload, bundled, methodConfig, frozen = null }, tx) => {
  const qp = quantityProgressService();
  const planned = await qp.plannedQuantityFor({ orgId, projectId, activityId, tx });
  const clientPlanned = payload.quantityPlanned !== undefined && payload.quantityPlanned !== null ? toNumber(payload.quantityPlanned) : null;
  const frozenPlanned = frozen && frozen.planned !== undefined && frozen.planned !== null ? toNumber(frozen.planned) : null;
  const figures = {
    planned: planned.planned,
    plannedBasis: planned.basis,
    unitCode: planned.unitCode || null,
    installed: null,
    installedBasis: 'client',
    approvedBefore: null,
    bundledEntries: 0,
    clientQuantityPlannedIgnored: false,
  };
  if (planned.basis === 'none') {
    if (clientPlanned !== null && clientPlanned > 0) {
      figures.planned = clientPlanned;
      figures.plannedBasis = 'client';
    } else if (frozenPlanned !== null && frozenPlanned > 0) {
      figures.planned = frozenPlanned;
      figures.plannedBasis = 'submission';
    } else {
      figures.planned = null;
      figures.plannedBasis = 'none';
    }
    figures.unitCode =
      payload.quantityUnit?.trim() || (figures.plannedBasis === 'submission' ? frozen.unitCode?.trim() : null) || methodConfig.quantityUnit || null;
    figures.plannedReason = planned.reason || null;
  } else if (clientPlanned !== null && clientPlanned !== figures.planned) {
    figures.clientQuantityPlannedIgnored = true;
  }

  if (bundled) {
    const approvedRows = await tx.quantityProgressEntry.findMany({
      where: { projectId, orgId, activityId, status: 'approved' },
      select: { id: true, quantity: true, unitCode: true },
    });
    const unitKey = uomService().unitKey;
    const units = [...new Set([...bundled, ...approvedRows].map((row) => row.unitCode))];
    const expectedUnit = figures.unitCode;
    const foreign = expectedUnit ? units.filter((unit) => unitKey(unit) !== unitKey(expectedUnit)) : units.length > 1 ? units : [];
    if (foreign.length) {
      throw new HttpError(
        400,
        'QUANTITY_UNIT_MISMATCH',
        expectedUnit
          ? `The entries are in "${foreign.join('", "')}" but the activity's planned quantity is in "${expectedUnit}"; no conversion is made`
          : `The entries are in more than one unit (${units.join(', ')}); nothing is summed across units`,
        { units, plannedUnit: expectedUnit, activityId },
      );
    }
    const approvedBefore = qp.sumQuantities(approvedRows.map((row) => row.quantity));
    const installed = approvedBefore.plus(qp.sumQuantities(bundled.map((row) => row.quantity)));
    figures.installed = qp.quantityNumber(installed);
    figures.installedBasis = 'approved_entries';
    figures.approvedBefore = qp.quantityNumber(approvedBefore);
    figures.approvedEntries = approvedRows.length;
    figures.bundledEntries = bundled.length;
    figures.unitCode = expectedUnit || units[0] || null;
  } else {
    figures.installed = payload.quantityComplete !== undefined && payload.quantityComplete !== null ? toNumber(payload.quantityComplete) : null;
  }
  if (!figures.unitCode) figures.unitCode = payload.quantityUnit?.trim() || methodConfig.quantityUnit || null;
  figures.pctComplete = calculateProgressPercent({
    method: 'quantity',
    methodConfig,
    payload: { quantityComplete: figures.installed ?? 0, quantityPlanned: figures.planned },
  });
  return figures;
};

const buildSubmissionData = async ({
  orgId = null,
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

  // PC-6: a quantity submission's figures are derived, never typed over
  // what the planner mapped; the other methods are untouched.
  let bundled = null;
  let quantity = null;
  if (method === 'quantity') {
    bundled = await resolveQuantityBundle({ orgId, projectId, activityId, payload }, tx);
    quantity = await deriveQuantityFigures({ orgId, projectId, activityId, payload, bundled, methodConfig }, tx);
  } else if (uniqueIds(payload.entryIds).length || payload.bundleSubmittedThrough || payload.bundleThrough) {
    throw new HttpError(
      400,
      'QUANTITY_BUNDLE_METHOD_MISMATCH',
      `Quantity entries are bundled by a quantity-method submission; this one is measured by ${method}`,
      { method },
    );
  }

  const pctComplete = quantity
    ? quantity.pctComplete
    : calculateProgressPercent({
        method,
        methodConfig,
        payload,
      });
  const now = new Date();

  return {
    bundled,
    quantity,
    data: {
    projectId,
    activityId,
    dailyReportId,
    method,
    source: payload.source || (dailyReportId ? 'daily_report' : 'manual'),
    pctComplete,
    quantityComplete: quantity
      ? quantity.installed
      : payload.quantityComplete !== undefined
        ? toNumber(payload.quantityComplete)
        : null,
    quantityPlanned: quantity
      ? quantity.planned
      : payload.quantityPlanned !== undefined
        ? toNumber(payload.quantityPlanned)
        : methodConfig.plannedQuantity,
    quantityUnit: quantity
      ? quantity.unitCode
      : payload.quantityUnit?.trim() || methodConfig.quantityUnit || null,
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
    },
  };
};

/** The submission's entries as they stand after some were settled. */
const withSettledEntries = (entries, settled) => {
  const byId = new Map((settled || []).map((entry) => [entry.id, entry]));
  return (entries || []).map((entry) => byId.get(entry.id) || entry);
};

/** Marks a bundled entry approved or rejected, with its own audit trail. */
const settleBundledEntries = async ({ tx, orgId, projectId, submission, entries, outcome, userId, now, reason = null }) => {
  if (!entries.length) return [];
  const data =
    outcome === 'approved'
      ? { status: 'approved', approvedBy: userId || null, approvedAt: now, submissionId: submission.id }
      : { status: 'rejected', rejectedBy: userId || null, rejectedAt: now, rejectionReason: reason, submissionId: submission.id };
  await tx.quantityProgressEntry.updateMany({ where: { id: { in: entries.map((entry) => entry.id) } }, data });
  const summaryOf = (entry, status) => ({
    activityId: entry.activityId,
    boqItemId: entry.boqItemId,
    quantity: quantityProgressService().quantityNumber(entry.quantity),
    unitCode: entry.unitCode,
    source: entry.source,
    status,
    submissionId: submission.id,
  });
  for (const entry of entries) {
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: QUANTITY_ENTRY_ENTITY_TYPE,
      entityId: entry.id,
      action: outcome === 'approved' ? auditService.ACTIONS.APPROVED : auditService.ACTIONS.REJECTED,
      actorId: userId,
      occurredAt: now,
      oldStatus: entry.status,
      newStatus: outcome,
      reason: reason || undefined,
      oldSummary: summaryOf(entry, entry.status),
      newSummary: summaryOf(entry, outcome),
      summary: { transition: outcome === 'approved' ? 'quantity_entry.approve' : 'quantity_entry.reject', ...summaryOf(entry, outcome) },
    });
  }
  return entries.map((entry) => ({ ...entry, ...data }));
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
    const { data, bundled, quantity } = await buildSubmissionData({
      orgId,
      projectId,
      activityId,
      userId,
      payload,
      dailyReportId,
      fallbackPhotos,
      tx: client,
    });
    const row = await client.progressSubmission.create({ data });
    if (bundled) {
      // The entries are the submission's figure from here on: one open
      // submission each (quantity-progress.service refuses to edit them
      // under it), submitted with it, approved or rejected with it.
      const submitted = row.status === 'draft' ? {} : { status: 'submitted' };
      await client.quantityProgressEntry.updateMany({
        where: { id: { in: bundled.map((entry) => entry.id) } },
        data: { submissionId: row.id, ...submitted },
      });
      row.quantityEntries = bundled.map((entry) => ({ ...entry, submissionId: row.id, ...submitted }));
    }
    const quantitySummary = quantity
      ? {
          quantityInstalled: quantity.installed,
          quantityPlanned: quantity.planned,
          quantityUnit: quantity.unitCode,
          plannedBasis: quantity.plannedBasis,
          installedBasis: quantity.installedBasis,
          quantityEntries: bundled ? bundled.length : 0,
          clientQuantityPlannedIgnored: quantity.clientQuantityPlannedIgnored,
        }
      : {};
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
        ...quantitySummary,
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
        ...quantitySummary,
      },
      attachments: getEvidenceAttachments(row.evidenceJson),
    });
    const serialized = serializeSubmission(row);
    // The answer's basis: where the planned and installed figures came from
    // (a transient block; the columns above are the frozen values).
    return quantity ? { ...serialized, quantity } : serialized;
  };

  return tx ? runner(tx) : prisma.$transaction(runner);
};

const listProgressSubmissions = async ({
  orgId,
  projectId,
  activityId = null,
  status = null,
  from = null,
  to = null,
}) => {
  await ensureProject({ orgId, projectId });
  const where = { projectId };
  if (activityId) where.activityId = activityId;
  if (status) where.status = status;
  // A daily report asks what was recorded on one day, and a day on site is a
  // local one: work recorded at eight in the evening in Baton Rouge already
  // belongs to tomorrow in UTC. So a caller that knows its own offset sends
  // instants ("2026-09-20T05:00:00.000Z") and gets exactly its day; a caller
  // that sends a bare date gets that date in UTC, which is what every reader
  // of these timestamps assumed before there was a filter at all.
  //
  // A submission is dated by when it was sent, and one not sent yet by when it
  // was made — the same pair these rows are already ordered by.
  const boundary = (value, endOfDay) =>
    String(value).includes("T")
      ? new Date(value)
      : new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (from || to) {
    const range = {};
    if (from) range.gte = boundary(from, false);
    if (to) range.lte = boundary(to, true);
    where.OR = [{ submittedAt: range }, { submittedAt: null, createdAt: range }];
  }

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
      quantityEntries: { select: { id: true, status: true, dailyLogId: true } },
    },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return rows.map(serializeSubmission);
};

const ensureSubmission = async ({ projectId, submissionId }, tx = prisma) => {
  const submission = await tx.progressSubmission.findFirst({
    where: { id: submissionId, projectId },
    include: { activity: true, quantityEntries: { select: BUNDLED_ENTRY_SELECT } },
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
  let submission = await ensureSubmission({ projectId, submissionId }, tx);
  if (activityId && submission.activityId !== activityId) {
    throw new HttpError(
      404,
      'PROGRESS_SUBMISSION_NOT_FOUND',
      'Progress submission not found for this activity',
    );
  }

  // PC-6: approvals are serialised per activity. A quantity bundle's
  // installed figure is Σ approved entries on the activity read in this
  // transaction; two bundles approved at once would each read "approved so
  // far" before the other commits and the later official row would carry
  // less than its own source data (the lens's race). Holding the activity's
  // row makes the second wait for the first and read what it wrote; the
  // submission is read again under the lock (the same one approved twice at
  // once answers idempotently). Prisma without $queryRaw (a mocked client)
  // skips the hold — the pattern boq.service uses for the item row.
  if (typeof tx.$queryRaw === 'function') {
    await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${submission.activityId} FOR UPDATE`;
    submission = await ensureSubmission({ projectId, submissionId }, tx);
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

  // PC-6: a quantity submission that bundles entries is approved with them,
  // in this transaction, and its figures are read again now — installed is
  // Σ approved entries on the activity, and another bundle may have been
  // approved since this one was put forward; planned may have been typed or
  // mapped since — and when still neither exists, the planned figure the
  // submission was put forward with (its frozen column) stands, so a bundle
  // a client planned is approvable. The columns are then the frozen values
  // of this approval. A quantity submission typed the old way (no entries)
  // is approved as it stands.
  const pending = (submission.quantityEntries || []).filter(
    (entry) => BUNDLEABLE_ENTRY_STATUSES.includes(entry.status) && entry.submissionId === submission.id,
  );
  let quantity = null;
  let bundledEntries = [];
  if (submission.method === 'quantity' && pending.length) {
    quantity = await deriveQuantityFigures(
      {
        orgId,
        projectId,
        activityId: submission.activityId,
        payload: {},
        bundled: pending,
        methodConfig,
        frozen: { planned: submission.quantityPlanned, unitCode: submission.quantityUnit },
      },
      tx,
    );
    bundledEntries = await settleBundledEntries({ tx, orgId, projectId, submission, entries: pending, outcome: 'approved', userId, now });
  }

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
      ...(quantity
        ? {
            pctComplete: quantity.pctComplete,
            quantityComplete: quantity.installed,
            quantityPlanned: quantity.planned,
            quantityUnit: quantity.unitCode,
          }
        : {}),
    },
  });
  approved.quantityEntries = withSettledEntries(submission.quantityEntries, bundledEntries);

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
      ...(quantity
        ? {
            quantityInstalled: quantity.installed,
            quantityPlanned: quantity.planned,
            quantityUnit: quantity.unitCode,
            plannedBasis: quantity.plannedBasis,
            installedBasis: quantity.installedBasis,
            quantityEntries: bundledEntries.length,
          }
        : {}),
    },
    summary: {
      transition: 'submission.approve',
      activityId: approved.activityId,
      activityName: submission.activity?.name || null,
      pctComplete: approved.pctComplete,
      method: approved.method,
      source: approved.source,
      ...(quantity ? { quantityEntries: bundledEntries.length, plannedBasis: quantity.plannedBasis } : {}),
    },
    attachments: getEvidenceAttachments(approved.evidenceJson),
  });

  const serialized = serializeSubmission(approved);
  return quantity ? { ...serialized, quantity, approvedProgressId: approvedProgress.id } : serialized;
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

  const now = new Date();
  // PC-6: the entries the submission bundles are rejected with it — their
  // trail (rejectedBy/At/Reason) is the only way an entered quantity stops
  // counting, and nothing official is written.
  const pending = (submission.quantityEntries || []).filter(
    (entry) => BUNDLEABLE_ENTRY_STATUSES.includes(entry.status) && entry.submissionId === submission.id,
  );
  const rejectedEntries = await settleBundledEntries({
    tx,
    orgId,
    projectId,
    submission,
    entries: pending,
    outcome: 'rejected',
    userId,
    now,
    reason: trimmedReason,
  });

  const row = await tx.progressSubmission.update({
    where: { id: submissionId },
    data: {
      status: 'rejected',
      reviewedBy: userId || null,
      reviewedAt: now,
      rejectionReason: trimmedReason,
      updatedBy: userId || null,
    },
  });
  row.quantityEntries = withSettledEntries(submission.quantityEntries, rejectedEntries);

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
      ...(rejectedEntries.length ? { quantityEntries: rejectedEntries.length } : {}),
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
  hasEvidence,
  serializeMethodConfig,
  serializeSubmission,
  serializeProgressSource,
  buildProgressSource,
  effectiveMethodFor,
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
