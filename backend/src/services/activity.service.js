const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  getApprovedActivityAllocationTotals,
} = require('./activity-boq-allocation.service');
const { applyCpmToProject, workingDayToDate } = require('./cpm.service');
const { deriveActivityStatus } = require('../utils/activity-status');
const {
  replaceActivityDependencies,
  serializeDependencyDto,
} = require('./activity-dependency.service');
const { toMoneyNumber } = require('../utils/money');
const progressService = require('./progress.service');
const { summarizeRiskActivityLinks } = require('./risk.service');

const VALID_CATEGORIES = [
  'civil',
  'structural',
  'mechanical',
  'electrical',
  'plumbing',
  'finishing',
  'landscaping',
  'demolition',
  'inspection',
  'other',
];

const computeStatus = (latestProgress, endDate) =>
  deriveActivityStatus(latestProgress?.pctComplete ?? 0, endDate);

const normalizeActivityCode = (value) => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const assertUniqueActivityCode = async ({
  projectId,
  activityCode,
  excludeActivityId = null,
  tx = prisma,
}) => {
  if (!activityCode) return;

  const existing = await tx.activity.findFirst({
    where: {
      projectId,
      isActive: true,
      activityCode,
      ...(excludeActivityId ? { id: { not: excludeActivityId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw new HttpError(
      409,
      'ACTIVITY_CODE_CONFLICT',
      'Activity code must be unique among active activities in this project.',
      { activityCode },
    );
  }
};

const activityInclude = {
  progress: {
    where: { status: 'approved' },
    orderBy: { updatedAt: 'desc' },
    take: 1,
    // PC-6: the submission that made the figure official, for its PROGRESS
    // SOURCE provenance (who put it forward, the daily log it came through,
    // the quantity entries it bundled). Null for a row whose link SET NULL.
    include: {
      submission: {
        select: {
          id: true,
          source: true,
          status: true,
          submittedBy: true,
          submittedAt: true,
          reviewedBy: true,
          reviewedAt: true,
          dailyReportId: true,
          quantityEntries: { select: { id: true, status: true, source: true, dailyLogId: true } },
        },
      },
    },
  },
  assignments: {
    include: { user: { select: { id: true, name: true, email: true } } },
  },
  predecessorLinks: {
    include: {
      predecessor: {
        select: {
          id: true,
          name: true,
          activityCode: true,
          wbsCode: true,
          p6ActivityId: true,
          sortOrder: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  riskLinks: {
    include: {
      risk: {
        select: {
          id: true,
          ref: true,
          description: true,
          severity: true,
          status: true,
          owner: true,
          dueDate: true,
          escalationLevel: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  },
  progressMethod: true,
  progressSubmissions: {
    where: { status: { in: ['draft', 'submitted'] } },
    orderBy: { updatedAt: 'desc' },
    take: 1,
    include: { quantityEntries: { select: { id: true, status: true, source: true, dailyLogId: true } } },
  },
};

const buildPlannedDateFields = (activity, project = null) => {
  if (!project?.startDate) {
    return {
      earlyStartDate: null,
      earlyFinishDate: null,
      lateStartDate: null,
      lateFinishDate: null,
      baselineStartDate: null,
      baselineFinishDate: null,
    };
  }

  const options = {
    calendarId: activity.calendarId || project.projectCalendar,
    projectCalendar: project.projectCalendar,
  };

  return {
    earlyStartDate: workingDayToDate(
      project.startDate,
      activity.earlyStart,
      options,
    ),
    earlyFinishDate: workingDayToDate(
      project.startDate,
      activity.earlyFinish,
      options,
    ),
    lateStartDate: workingDayToDate(
      project.startDate,
      activity.lateStart,
      options,
    ),
    lateFinishDate: workingDayToDate(
      project.startDate,
      activity.lateFinish,
      options,
    ),
    baselineStartDate: workingDayToDate(
      project.startDate,
      activity.baselineStart,
      options,
    ),
    baselineFinishDate: workingDayToDate(
      project.startDate,
      activity.baselineFinish,
      options,
    ),
  };
};

const sanitizeActivity = (activity, allocationTotals = null, project = null) => {
  const latestProgress = activity.progress?.[0] ?? null;
  const approvedAllocation = allocationTotals || {
    quantity: 0,
    amount: 0,
    weight: 0,
    count: 0,
  };

  return {
    id: activity.id,
    projectId: activity.projectId,
    name: activity.name,
    activityCode: activity.activityCode ?? null,
    // The identifier the programme came in with. Imported activities carry no
    // activityCode of ours, so without this an imported P6 schedule lists every
    // row with a blank code and the planner cannot find the activity they are
    // being asked about by its real name. Kept separate from activityCode
    // rather than folded into it: they are two different identifiers.
    p6ActivityId: activity.p6ActivityId ?? null,
    wbsCode: activity.wbsCode,
    category: activity.category,
    earlyStart: activity.earlyStart,
    earlyFinish: activity.earlyFinish,
    lateStart: activity.lateStart,
    lateFinish: activity.lateFinish,
    totalFloat: activity.totalFloat,
    predecessors: activity.predecessors,
    dependencies:
      activity.predecessorLinks?.map((row) => serializeDependencyDto(row)) ??
      [],
    ...buildPlannedDateFields(activity, project),
    startDate: activity.startDate,
    endDate: activity.endDate,
    duration: activity.duration,
    budget: activity.budget,
    allocatedBoqQuantity: approvedAllocation.quantity,
    allocatedBoqAmount: approvedAllocation.amount,
    allocatedBoqWeight: approvedAllocation.weight,
    approvedAllocationCount: approvedAllocation.count,
    isMilestone: activity.isMilestone,
    isCritical: activity.isCritical,
    sortOrder: activity.sortOrder,
    pctComplete: latestProgress?.pctComplete ?? 0,
    actualCost: latestProgress?.actualCost ?? null,
    actualStart: latestProgress?.actualStart ?? null,
    actualFinish: latestProgress?.actualFinish ?? null,
    approvedProgressUpdatedAt: latestProgress?.updatedAt ?? null,
    approvedProgressSource: latestProgress?.source ?? null,
    // PC-6: the structured PROGRESS SOURCE of the official figure (additive).
    progressSource: progressService.serializeProgressSource(latestProgress),
    progressMethod:
      activity.progressMethod?.method ||
      latestProgress?.progressMethod ||
      'percent',
    progressMethodConfig:
      progressService.serializeMethodConfig(activity.progressMethod),
    pendingProgress:
      progressService.serializeSubmission(activity.progressSubmissions?.[0]) ||
      null,
    projectRiskSummary: summarizeRiskActivityLinks(activity.riskLinks || []),
    progressApprovalStatus: activity.progressSubmissions?.[0]
      ? activity.progressSubmissions[0].status
      : latestProgress
        ? 'approved'
        : 'missing',
    status: computeStatus(latestProgress, activity.endDate),
    assignedEngineers:
      activity.assignments?.map((a) => ({
        id: a.user.id,
        name: a.user.name,
        email: a.user.email,
      })) ?? [],
    createdAt: activity.createdAt,
  };
};

const ensureProject = async (orgId, projectId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project)
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  return project;
};

const ensureActivity = async (projectId, activityId) => {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, projectId },
    include: activityInclude,
  });

  if (!activity)
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');

  return activity;
};

// Hard rule: end must be after start. Throws.
const assertDates = ({ startDate, endDate }) => {
  if (startDate && endDate && endDate <= startDate) {
    throw new HttpError(
      400,
      'INVALID_DATES',
      'endDate must be after startDate',
    );
  }
};

// Soft rule: project-boundary breaches are warnings, not errors (BRD 2.2).
const collectDateWarnings = ({ project, startDate, endDate }) => {
  const warnings = [];
  if (startDate && project.startDate && startDate < project.startDate) {
    warnings.push('Activity start date is before the project start date.');
  }
  if (endDate && project.endDate && endDate > project.endDate) {
    warnings.push('Activity end date is after the project end date.');
  }
  return warnings;
};

const listActivities = async ({ orgId, projectId }) => {
  const project = await ensureProject(orgId, projectId);

  const [activities, allocationTotals] = await Promise.all([
    prisma.activity.findMany({
      where: { projectId, isActive: true },
      include: activityInclude,
      orderBy: { sortOrder: 'asc' },
    }),
    getApprovedActivityAllocationTotals({ projectId }),
  ]);

  return activities.map((activity) =>
    sanitizeActivity(activity, allocationTotals.get(activity.id), project),
  );
};

const createActivity = async ({ orgId, projectId, payload }) => {
  const project = await ensureProject(orgId, projectId);

  const startDate = payload.startDate ? new Date(payload.startDate) : null;
  const endDate = payload.endDate ? new Date(payload.endDate) : null;
  assertDates({ startDate, endDate });
  const dateWarnings = collectDateWarnings({ project, startDate, endDate });
  const activityCode = normalizeActivityCode(payload.activityCode);
  await assertUniqueActivityCode({ projectId, activityCode });

  const engineerIds = payload.engineerIds ?? [];
  if (!engineerIds.length) {
    throw new HttpError(
      400,
      'ENGINEERS_REQUIRED',
      'At least one engineer must be assigned',
    );
  }

  const engineers = await prisma.user.findMany({
    where: {
      id: { in: engineerIds },
      orgId,
      status: 'active',
    },
  });

  if (engineers.length !== engineerIds.length) {
    throw new HttpError(
      400,
      'INVALID_ENGINEERS',
      'One or more engineer IDs are invalid',
    );
  }

  if (payload.category && !VALID_CATEGORIES.includes(payload.category)) {
    throw new HttpError(
      400,
      'INVALID_CATEGORY',
      'Activity category is invalid',
    );
  }

  const shouldRecalculateCpm = [
    'earlyStart',
    'earlyFinish',
    'lateStart',
    'lateFinish',
    'totalFloat',
    'duration',
    'predecessors',
    'dependencies',
    'isCritical',
  ].some((key) => payload[key] !== undefined);

  const activity = await prisma.$transaction(async (tx) => {
    const created = await tx.activity.create({
      data: {
        projectId,
        name: payload.name,
        activityCode,
        wbsCode: payload.wbsCode ?? null,
        calendarId: project.projectCalendar ?? null,
        category: payload.category ?? null,
        startDate,
        endDate,
        duration: payload.duration ?? 0,
        earlyStart: payload.earlyStart ?? null,
        earlyFinish: payload.earlyFinish ?? null,
        lateStart: payload.lateStart ?? null,
        lateFinish: payload.lateFinish ?? null,
        totalFloat: payload.totalFloat ?? null,
        budget: toMoneyNumber(payload.budget),
        isMilestone: payload.isMilestone ?? false,
        isCritical: payload.isCritical ?? false,
        sortOrder: payload.sortOrder ?? 0,
        assignments: {
          create: engineerIds.map((userId) => ({ userId })),
        },
      },
    });

    if (payload.dependencies !== undefined || payload.predecessors !== undefined) {
      await replaceActivityDependencies(tx, {
        projectId,
        successorId: created.id,
        dependencies: payload.dependencies,
        predecessors: payload.predecessors,
        source: 'manual',
      });
    }

    if (shouldRecalculateCpm) {
      await applyCpmToProject(projectId, tx);
    }

    return tx.activity.findFirst({
      where: { id: created.id, projectId },
      include: activityInclude,
    });
  });

  return { ...sanitizeActivity(activity, null, project), warnings: dateWarnings };
};

const getActivityById = async ({ orgId, projectId, activityId }) => {
  const project = await ensureProject(orgId, projectId);
  const [activity, allocationTotals] = await Promise.all([
    ensureActivity(projectId, activityId),
    getApprovedActivityAllocationTotals({ projectId }),
  ]);
  return sanitizeActivity(activity, allocationTotals.get(activity.id), project);
};

const updateActivity = async ({ orgId, projectId, activityId, payload }) => {
  const project = await ensureProject(orgId, projectId);
  const existing = await ensureActivity(projectId, activityId);

  const data = {};

  if (payload.name !== undefined) data.name = payload.name;
  if (payload.activityCode !== undefined) {
    data.activityCode = normalizeActivityCode(payload.activityCode);
    await assertUniqueActivityCode({
      projectId,
      activityCode: data.activityCode,
      excludeActivityId: activityId,
    });
  }
  if (payload.wbsCode !== undefined) data.wbsCode = payload.wbsCode;
  if (payload.category !== undefined) {
    if (payload.category && !VALID_CATEGORIES.includes(payload.category)) {
      throw new HttpError(
        400,
        'INVALID_CATEGORY',
        'Activity category is invalid',
      );
    }
    data.category = payload.category;
  }

  if (payload.startDate !== undefined) {
    data.startDate = payload.startDate ? new Date(payload.startDate) : null;
  }

  if (payload.endDate !== undefined) {
    data.endDate = payload.endDate ? new Date(payload.endDate) : null;
  }

  if (payload.earlyStart !== undefined) data.earlyStart = payload.earlyStart;
  if (payload.earlyFinish !== undefined) data.earlyFinish = payload.earlyFinish;
  if (payload.lateStart !== undefined) data.lateStart = payload.lateStart;
  if (payload.lateFinish !== undefined) data.lateFinish = payload.lateFinish;
  if (payload.totalFloat !== undefined) data.totalFloat = payload.totalFloat;
  if (payload.duration !== undefined) data.duration = payload.duration;
  if (payload.isCritical !== undefined) data.isCritical = payload.isCritical;

  if (payload.budget !== undefined) data.budget = toMoneyNumber(payload.budget);
  if (payload.isMilestone !== undefined) data.isMilestone = payload.isMilestone;
  if (payload.sortOrder !== undefined) data.sortOrder = payload.sortOrder;

  const nextStartDate =
    data.startDate !== undefined ? data.startDate : existing.startDate;
  const nextEndDate =
    data.endDate !== undefined ? data.endDate : existing.endDate;
  assertDates({ startDate: nextStartDate, endDate: nextEndDate });

  const engineerIds = payload.engineerIds;
  if (engineerIds !== undefined) {
    if (!Array.isArray(engineerIds) || !engineerIds.length) {
      throw new HttpError(
        400,
        'ENGINEERS_REQUIRED',
        'At least one engineer must be assigned',
      );
    }

    const engineers = await prisma.user.findMany({
      where: {
        id: { in: engineerIds },
        orgId,
        status: 'active',
      },
    });

    if (engineers.length !== engineerIds.length) {
      throw new HttpError(
        400,
        'INVALID_ENGINEERS',
        'One or more engineer IDs are invalid',
      );
    }
  }

  const shouldRecalculateCpm = [
    'earlyStart',
    'earlyFinish',
    'lateStart',
    'lateFinish',
    'totalFloat',
    'duration',
    'predecessors',
    'dependencies',
    'isCritical',
  ].some((key) => payload[key] !== undefined);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.activity.update({
      where: { id: activityId },
      data,
    });

    if (engineerIds !== undefined) {
      await tx.activityAssignment.deleteMany({ where: { activityId } });
      await tx.activityAssignment.createMany({
        data: engineerIds.map((userId) => ({ activityId, userId })),
      });
    }

    if (payload.dependencies !== undefined || payload.predecessors !== undefined) {
      await replaceActivityDependencies(tx, {
        projectId,
        successorId: activityId,
        dependencies: payload.dependencies,
        predecessors: payload.predecessors,
        source: 'manual',
      });
    }

    if (shouldRecalculateCpm) {
      await applyCpmToProject(projectId, tx);
    }

    return tx.activity.findFirst({
      where: { id: activityId, projectId },
      include: activityInclude,
    });
  });

  if (!updated) {
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  }

  return sanitizeActivity(updated, null, project);
};

// The records that keep an activity (ON DELETE RESTRICT on their activityId):
// the activity-linked data model never lets a cost record, a progress record
// or a daily report lose its activity. An activated revision writes a cost
// record per activated activity, so an activity of the active schedule leaves
// the programme through a schedule revision, never through this endpoint —
// the raw delete used to hit the constraint (Prisma P2003) and answer 500.
const ACTIVITY_KEEPERS = [
  { key: 'costRecords', model: 'costRecord', noun: 'cost record' },
  { key: 'progress', model: 'activityProgress', noun: 'progress record' },
  { key: 'dailyReports', model: 'dailyReport', noun: 'daily report' },
  // PC-6: installed quantities recorded against the activity, source data
  // for an official figure (RESTRICT, like ActivityProgress).
  { key: 'quantityEntries', model: 'quantityProgressEntry', noun: 'quantity progress entry' },
  { key: 'dailyLogQuantities', model: 'dailyLogQuantity', noun: 'daily-log quantity row' },
];

const plural = (count, noun) => `${count} ${count === 1 ? noun : noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;

// The activity's code, or the P6 id an import gave it, or its name.
const activityLabel = (activity) =>
  activity.activityCode || activity.p6ActivityId || null;

const activityInUse = (activity, keptBy, kept) =>
  new HttpError(
    409,
    'ACTIVITY_IN_USE',
    `Activity ${activityLabel(activity) || activity.name} cannot be deleted: ${kept} linked to it. Records stay on their activity; take it out of the programme through a schedule revision instead.`,
    {
      activityId: activity.id,
      activityCode: activityLabel(activity),
      partOfActiveSchedule: Boolean(activity.isActive),
      keptBy,
    },
  );

const deleteActivity = async ({ orgId, projectId, activityId }) => {
  await ensureProject(orgId, projectId);
  const activity = await ensureActivity(projectId, activityId);

  const counts = await Promise.all(
    ACTIVITY_KEEPERS.map(({ model }) =>
      prisma[model].count({ where: { activityId } }),
    ),
  );
  const keptBy = Object.fromEntries(
    ACTIVITY_KEEPERS.map(({ key }, index) => [key, counts[index]]),
  );
  const kept = ACTIVITY_KEEPERS.filter(({ key }) => keptBy[key] > 0)
    .map(({ key, noun }) => plural(keptBy[key], noun))
    .join(', ');
  if (kept) {
    throw activityInUse(
      activity,
      keptBy,
      `${kept} ${counts.reduce((sum, count) => sum + count, 0) === 1 ? 'is' : 'are'}`,
    );
  }

  try {
    await prisma.activity.delete({ where: { id: activityId } });
  } catch (error) {
    // A record this list does not know keeps it: still a refusal, naming the
    // constraint, never a 500.
    if (error?.code === 'P2003') {
      throw activityInUse(
        activity,
        { ...keptBy, constraint: error.meta?.field_name || error.meta?.constraint || null },
        'another record is',
      );
    }
    throw error;
  }
  return { deleted: true };
};

const updateProgress = async ({
  orgId,
  projectId,
  activityId,
  userId,
  userRole,
  payload,
}) => {
  const project = await ensureProject(orgId, projectId);
  await ensureActivity(projectId, activityId);

  const submission = await progressService.createProgressSubmission({
    orgId,
    projectId,
    activityId,
    userId,
    userRole,
    payload,
  });

  const updated = await ensureActivity(projectId, activityId);
  return {
    activity: sanitizeActivity(updated, null, project),
    submission,
  };
};

const bulkUpdateProgress = async ({
  orgId,
  projectId,
  userId,
  userRole,
  updates,
}) => {
  await ensureProject(orgId, projectId);

  const activityIds = [...new Set((updates || []).map((u) => u.activityId))];
  const activities = await prisma.activity.findMany({
    where: { projectId, id: { in: activityIds } },
    select: { id: true, budget: true },
  });
  const activityMap = new Map(
    activities.map((activity) => [activity.id, activity]),
  );
  await progressService.assertProgressSubmitAllowed({
    projectId,
    activityIds: activities.map((activity) => activity.id),
    userId,
    userRole,
  });

  const submissions = [];
  for (const update of updates || []) {
    const activity = activityMap.get(update.activityId);
    if (!activity) continue;

    const submission = await progressService.createProgressSubmission({
      orgId,
      projectId,
      activityId: update.activityId,
      userId,
      userRole,
      payload: update,
    });
    submissions.push(submission);
  }

  return { submitted: submissions.length, submissions };
};

module.exports = {
  listActivities,
  createActivity,
  getActivityById,
  updateActivity,
  deleteActivity,
  updateProgress,
  bulkUpdateProgress,
  collectDateWarnings,
};
