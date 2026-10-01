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
  projectId: true,
  activityId: true,
  boqItemId: true,
  allocationId: true,
  locationId: true,
  quantity: true,
  unitCode: true,
  date: true,
  source: true,
  status: true,
  submissionId: true,
  dailyLogId: true,
  dailyLogQuantityId: true,
  note: true,
  clientRequestId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  approvedBy: true,
  approvedAt: true,
  rejectedBy: true,
  rejectedAt: true,
  rejectionReason: true,
  submission: { select: { id: true, status: true, source: true, pctComplete: true } },
  boqItem: { select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true } },
  location: { select: { id: true, name: true, code: true } },
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
  // The day(s) of the daily log(s) the figure came through: an entry minted
  // from a daily log is dated the log's day.
  const dailyLogDates = [
    ...new Set(
      entries
        .filter((entry) => entry?.dailyLogId && entry.date)
        .map((entry) => new Date(entry.date).toISOString().slice(0, 10)),
    ),
  ].sort();
  const approved = progress || (submission?.status === 'approved' ? submission : null);
  // How a quantity figure's installed quantity was arrived at: Σ entries, a
  // typed figure (the legacy shape — minted into one entry at approval), or
  // Σ entries over the legacy typed floor (the official row's own note says
  // so; the note carries no figure). null for the other methods.
  const method = progress?.progressMethod ?? submission?.method ?? null;
  let installedBasis = null;
  if (method === 'quantity') {
    if (String(progress?.notes || '').includes(LEGACY_FLOOR_NOTE)) installedBasis = LEGACY_FLOOR_BASIS;
    else if (!entries.length || entries.every((entry) => entry?.source === MINTED_ENTRY_SOURCE)) installedBasis = 'client';
    else installedBasis = 'approved_entries';
  }
  return {
    source: progress?.source ?? submission?.source ?? null,
    installedBasis,
    legacyFloor: installedBasis === LEGACY_FLOOR_BASIS,
    submissionId: progress?.submissionId ?? submission?.id ?? null,
    dailyLogId,
    dailyLogDate: dailyLogDates.length ? dailyLogDates[dailyLogDates.length - 1] : null,
    dailyLogDates,
    dailyReportId: submission?.dailyReportId || null,
    importDocumentId: null,
    submittedBy: submission?.submittedBy || null,
    submittedAt: toIso(submission?.submittedAt),
    approvedBy: progress?.approvedBy ?? (approved ? approved.reviewedBy ?? submission?.reviewedBy ?? null : null),
    approvedAt: toIso(progress?.approvedAt ?? (approved ? approved.reviewedAt ?? submission?.reviewedAt ?? null : null)),
    entries: entries.length,
    entryCount: entries.length,
  };
};

/**
 * The entries a submission bundles, as the ledger serialises them, when the
 * rows were read whole (the queue and the activity's pending submission) —
 * so the approver sees what they are approving: the item, the quantity in
 * its unit, the day and where it came from. The route withholds each from a
 * member who may not read the BOQ (utils/boq-figures).
 */
const serializeBundledEntries = (entries) => {
  if (!Array.isArray(entries) || !entries.length) return [];
  if (!entries.every((entry) => entry && entry.quantity !== undefined && entry.boqItemId !== undefined)) return undefined;
  return entries.map((entry) => quantityProgressService().serializeEntry(entry));
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
        quantityEntries: serializeBundledEntries(row.quantityEntries),
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

// PC-6 integration: the legacy typed-quantity floor. Carried on the official
// row's notes (no figure in it — a note is progress data every reader sees)
// so PROGRESS SOURCE can say the floor applied.
const LEGACY_FLOOR_BASIS = 'legacy_typed_floor';
const LEGACY_FLOOR_NOTE = 'Legacy typed quantity carried as the floor of the installed figure (PC-6)';
const MINTED_ENTRY_SOURCE = 'submission';

/**
 * A typed quantityComplete (the legacy shape, still what the mobile
 * ProgressSheet sends) is accepted only while the activity has no quantity
 * entry at all. Once entries exist they are the one truth of installed
 * quantity, per BOQ item; an activity-level typed figure cannot be
 * attributed to an item and would be a second truth — 409
 * QUANTITY_ENTRIES_REQUIRED says so.
 */
const assertTypedQuantityAllowed = async ({ orgId, projectId, activityId, payload }, tx) => {
  if (payload.quantityComplete === undefined || payload.quantityComplete === null) return;
  const entries = await tx.quantityProgressEntry.count({ where: { projectId, orgId, activityId } });
  if (!entries) return;
  throw new HttpError(
    409,
    'QUANTITY_ENTRIES_REQUIRED',
    `This activity's installed quantity is recorded as quantity entries per BOQ item (${entries} so far); a typed quantity is not a second truth. Record an entry and bundle it`,
    { activityId, entries },
  );
};

/**
 * The latest official installed figure of the activity when it stands above
 * Σ approved entries: a quantityComplete approved the legacy way (typed, no
 * entries behind it), or a row that itself carried the floor. Installed is
 * then max(Σ approved entries, that figure) + the bundle, so an official
 * figure never regresses by the act of deriving. A legacy row in another
 * unit cannot be a floor (nothing is converted) and is reported as skipped.
 */
const legacyInstalledFloor = async ({ activityId, approvedBefore, expectedUnit }, tx) => {
  const qp = quantityProgressService();
  const latest = await tx.activityProgress.findFirst({
    where: { activityId, status: 'approved', quantityComplete: { not: null } },
    orderBy: [{ approvedAt: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, quantityComplete: true, quantityUnit: true, approvedAt: true },
  });
  if (!latest) return { floor: null, skipped: null };
  const official = qp.quantityDecimal(latest.quantityComplete);
  if (!official || !official.greaterThan(approvedBefore)) return { floor: null, skipped: null };
  const unitKey = uomService().unitKey;
  const unit = latest.quantityUnit?.trim() || null;
  if (unit && expectedUnit && unitKey(unit) !== unitKey(expectedUnit)) {
    return {
      floor: null,
      skipped: {
        progressId: latest.id,
        quantity: qp.quantityNumber(official),
        unitCode: unit,
        reason: `The latest official installed figure is in "${unit}", the entries in "${expectedUnit}"; no conversion is made, so it is not carried as the floor`,
      },
    };
  }
  return { floor: { quantity: official, unitCode: unit || expectedUnit || null, progressId: latest.id, approvedAt: latest.approvedAt }, skipped: null };
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
    // The floor: an official figure never goes backwards by the act of
    // deriving (owner rule). An activity approved the legacy way — a typed
    // quantityComplete with no entries behind it — stands at that figure, and
    // the first bundle after PC-6 adds to it rather than discarding it.
    const { floor, skipped } = await legacyInstalledFloor({ activityId, approvedBefore, expectedUnit: expectedUnit || units[0] || null }, tx);
    const base = floor ? floor.quantity : approvedBefore;
    const installed = base.plus(qp.sumQuantities(bundled.map((row) => row.quantity)));
    figures.installed = qp.quantityNumber(installed);
    figures.installedBasis = floor ? LEGACY_FLOOR_BASIS : 'approved_entries';
    figures.approvedBefore = qp.quantityNumber(approvedBefore);
    figures.approvedEntries = approvedRows.length;
    figures.bundledEntries = bundled.length;
    figures.unitCode = expectedUnit || units[0] || null;
    if (floor) {
      figures.legacyFloor = { quantity: qp.quantityNumber(floor.quantity), unitCode: floor.unitCode, progressId: floor.progressId, approvedAt: toIso(floor.approvedAt), note: LEGACY_FLOOR_NOTE };
    } else if (skipped) {
      figures.legacyFloorSkipped = skipped;
    }
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

/**
 * The method a submission is measured by is the activity's, never the
 * client's (PC-6 integration, owner rule: respect the activity's progress
 * method). With a configured ActivityProgressMethod row the submission takes
 * that method; a client naming another is refused — 409
 * PROGRESS_METHOD_MISMATCH naming both — never silently coerced, so a
 * percentage typed against a quantity-measured activity cannot bypass the
 * derivation and reach the approver as a figure with no entries behind it.
 * Without a configured row the client's method is accepted as before (the
 * default is percent).
 */
const resolveSubmissionMethod = ({ activityId, payload, configRow }) => {
  const requested = payload.method ?? payload.progressMethod ?? null;
  if (!configRow) return normalizeMethod(requested || 'percent');
  const effectiveMethod = normalizeMethod(configRow.method);
  if (requested === null || requested === undefined || String(requested).trim() === '') return effectiveMethod;
  const requestedMethod = normalizeMethod(requested);
  if (requestedMethod === effectiveMethod) return effectiveMethod;
  throw new HttpError(
    409,
    'PROGRESS_METHOD_MISMATCH',
    `This activity is measured by ${effectiveMethod}; a ${requestedMethod} submission is not recorded against it. The submission's method is the activity's — record ${effectiveMethod === 'quantity' ? 'quantity entries and bundle them' : `${effectiveMethod} progress`} instead`,
    { activityId, effectiveMethod, effectiveMethodBasis: 'method_config', requestedMethod },
  );
};

/**
 * The same rule in the one writer (verification finding: the bypass by
 * ordering). The rule above is asked when a submission is made; a percent
 * submission put forward while the activity was unconfigured — or one
 * already pending when the rule shipped — would otherwise stay approvable
 * after the planner configures the activity as quantity (the method lock
 * reads approved progress only), and the approver would make a percentage
 * with no entries behind it official; the first bundle afterwards would
 * then derive from its entries and the official figure would regress. So
 * approval asks again: a submission whose method is not the activity's
 * configured method is 409 PROGRESS_METHOD_MISMATCH, naming both and the
 * submission. The approver rejects it and the site records it the
 * activity's way. Without a configured row nothing is asked, as before.
 */
const assertSubmissionMethodStands = ({ submission, configRow }) => {
  if (!configRow) return;
  const effectiveMethod = normalizeMethod(configRow.method);
  let submittedMethod;
  try {
    submittedMethod = normalizeMethod(submission.method);
  } catch {
    submittedMethod = String(submission.method || '').trim() || null;
  }
  if (submittedMethod === effectiveMethod) return;
  throw new HttpError(
    409,
    'PROGRESS_METHOD_MISMATCH',
    `This activity is measured by ${effectiveMethod}; a ${submittedMethod} submission is not approved against it. Reject it and record ${effectiveMethod === 'quantity' ? 'quantity entries and bundle them' : `${effectiveMethod} progress`} instead`,
    { activityId: submission.activityId, effectiveMethod, effectiveMethodBasis: 'method_config', requestedMethod: submittedMethod, submissionId: submission.id },
  );
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
  const configRow = await getMethodConfigRow({ projectId, activityId }, tx);
  const methodConfig = configRow || (await resolveMethodConfig({ projectId, activityId }, tx));
  const method = resolveSubmissionMethod({ activityId, payload, configRow });
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
    if (!bundled) await assertTypedQuantityAllowed({ orgId, projectId, activityId, payload }, tx);
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
  const known = new Set((entries || []).map((entry) => entry.id));
  // A settled entry the submission did not list before (the one minted from
  // a typed figure at approval) is its entry from now on.
  return [...(entries || []).map((entry) => byId.get(entry.id) || entry), ...(settled || []).filter((entry) => !known.has(entry.id))];
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

/**
 * A typed quantityComplete approved (the legacy shape; what the mobile
 * ProgressSheet sends) mints ONE approved QuantityProgressEntry (source
 * 'submission') carrying the typed figure as a delta over the previous
 * official installed figure — max(Σ approved entries, the latest official
 * installed figure), the floor — so the activity has one truth of installed
 * quantity from then on and the next bundle adds to it. Nothing is minted
 * when the delta is zero or negative (the floor rule keeps the figure from
 * regressing by derivation; the approved row stands as approved), when the
 * activity has no single allocated BOQ item (an entry names an item; an
 * activity-level figure on several items cannot be attributed to one — the
 * answer says so, and such an activity is served by entries from then on,
 * 409 QUANTITY_ENTRIES_REQUIRED on the next typed figure) or when the typed
 * unit is not the item's. Replay-safe by clientRequestId 'submission:<id>'.
 */
const mintTypedQuantityEntry = async ({ tx, orgId, projectId, submission, userId, now }) => {
  const qp = quantityProgressService();
  const activityId = submission.activityId;
  const typedUnit = submission.quantityUnit?.trim() || null;
  const answer = { installed: toNumber(submission.quantityComplete), planned: submission.quantityPlanned ?? null, unitCode: typedUnit, plannedBasis: 'submission', installedBasis: 'client', mintedEntry: null, mintSkipped: null };
  const result = { installed: answer.installed, planned: answer.planned, unitCode: typedUnit, entry: null, skipped: null, answer };
  const skip = (reason, extra = {}) => {
    result.skipped = { reason, ...extra };
    answer.mintSkipped = result.skipped;
    return result;
  };
  const typed = qp.quantityDecimal(submission.quantityComplete);
  const approvedRows = await tx.quantityProgressEntry.findMany({ where: { projectId, orgId, activityId, status: 'approved' }, select: { quantity: true } });
  const approvedBefore = qp.sumQuantities(approvedRows.map((row) => row.quantity));
  const { floor } = await legacyInstalledFloor({ activityId, approvedBefore, expectedUnit: typedUnit }, tx);
  const base = floor ? floor.quantity : approvedBefore;
  const delta = typed.minus(base);
  if (!delta.greaterThan(0)) {
    return skip('The typed figure does not exceed the official installed figure; nothing is minted and the official figure is not lowered by derivation', { typed: qp.quantityNumber(typed), officialBefore: qp.quantityNumber(base) });
  }
  const allocations = await tx.activityBoqAllocation.findMany({
    where: { projectId, activityId, status: 'approved', isActive: true },
    select: { id: true, boqItemId: true, boqItem: { select: { id: true, unit: true, unitCode: true } } },
  });
  const items = [...new Set(allocations.map((row) => row.boqItemId))];
  if (items.length !== 1) {
    return skip(
      items.length
        ? `The activity has ${items.length} allocated BOQ items; a typed activity-level figure cannot be attributed to one, so no entry is minted (the floor rule carries the figure)`
        : 'The activity has no approved allocation; an entry names a BOQ item, so none is minted (the floor rule carries the figure)',
      { items: items.length },
    );
  }
  const item = allocations[0].boqItem || {};
  const boqItemId = items[0];
  const unitKey = uomService().unitKey;
  const itemUnit = item.unitCode?.trim() || item.unit?.trim() || null;
  if (typedUnit && itemUnit && unitKey(typedUnit) !== unitKey(itemUnit)) {
    return skip(`The typed figure is in "${typedUnit}", the allocated item in "${itemUnit}"; no conversion is made, so no entry is minted`, { itemUnit });
  }
  const when = submission.submittedAt || now;
  const row = await tx.quantityProgressEntry.create({
    data: {
      orgId,
      projectId,
      activityId,
      boqItemId,
      allocationId: allocations.length === 1 ? allocations[0].id : null,
      unitCode: itemUnit || typedUnit,
      quantity: delta,
      date: new Date(`${toIso(when).slice(0, 10)}T00:00:00.000Z`),
      source: MINTED_ENTRY_SOURCE,
      status: 'approved',
      submissionId: submission.id,
      approvedBy: userId || null,
      approvedAt: now,
      createdBy: submission.submittedBy || userId || null,
      clientRequestId: `submission:${submission.id}`,
      note: 'Minted from a typed quantity submission: the typed figure as a delta over the previous official installed figure',
    },
  });
  const summary = { activityId, boqItemId, quantity: qp.quantityNumber(delta), unitCode: row.unitCode, source: row.source, status: row.status, submissionId: submission.id, typed: qp.quantityNumber(typed), officialBefore: qp.quantityNumber(base) };
  await auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: QUANTITY_ENTRY_ENTITY_TYPE,
    entityId: row.id,
    action: auditService.ACTIONS.CREATED,
    actorId: userId,
    occurredAt: now,
    newStatus: 'approved',
    newSummary: summary,
    summary: { transition: 'quantity_entry.mint_from_typed_submission', ...summary },
  });
  result.entry = { ...row, submission: { id: submission.id, status: 'approved' } };
  answer.mintedEntry = { id: row.id, boqItemId, quantity: summary.quantity, unitCode: row.unitCode, officialBefore: summary.officialBefore };
  return result;
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
      // The queue shows what each submission bundles: the entries, whole.
      quantityEntries: { select: BUNDLED_ENTRY_SELECT, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
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

  // The method rule, asked again where a figure becomes official.
  const configRow = await getMethodConfigRow({ projectId, activityId: submission.activityId }, tx);
  assertSubmissionMethodStands({ submission, configRow });
  const methodConfig = configRow || (await resolveMethodConfig(
    { projectId, activityId: submission.activityId },
    tx,
  ));
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
  // A quantity submission typed the old way (no entries): approved as it
  // stands, and ONE approved entry is minted from it so the activity has one
  // truth of installed quantity from here on (see mintTypedQuantityEntry).
  const typed =
    submission.method === 'quantity' && !pending.length && submission.quantityComplete !== null && submission.quantityComplete !== undefined
      ? await mintTypedQuantityEntry({ tx, orgId, projectId, submission, userId, now })
      : null;

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
  approved.quantityEntries = withSettledEntries(submission.quantityEntries, typed?.entry ? [...bundledEntries, typed.entry] : bundledEntries);

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
      // The floor's trace on the official row itself: a sentence, never a figure.
      notes: quantity?.legacyFloor ? [approved.notes, LEGACY_FLOOR_NOTE].filter(Boolean).join('\n') : approved.notes,
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
            ...(quantity.legacyFloor ? { legacyFloor: quantity.legacyFloor } : {}),
          }
        : {}),
      ...(typed ? { quantityInstalled: typed.installed, quantityPlanned: typed.planned, quantityUnit: typed.unitCode, installedBasis: 'client', mintedEntryId: typed.entry?.id || null, mintSkipped: typed.skipped || null } : {}),
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

  // PROGRESS SOURCE of the answer reads the official row just written (its
  // note says whether the legacy floor applied), as the activity payload will.
  const serialized = { ...serializeSubmission(approved), progressSource: buildProgressSource({ submission: approved, progress: approvedProgress }) };
  if (quantity) return { ...serialized, quantity, approvedProgressId: approvedProgress.id };
  if (typed) return { ...serialized, quantity: typed.answer, approvedProgressId: approvedProgress.id };
  return serialized;
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
  BUNDLED_ENTRY_SELECT,
  effectiveMethodFor,
  resolveSubmissionMethod,
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
