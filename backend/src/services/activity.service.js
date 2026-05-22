const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

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

const computeStatus = (latestProgress, endDate) => {
  const pct = latestProgress?.pctComplete ?? 0;
  if (pct >= 100) return 'complete';
  if (pct > 0) return 'in_progress';
  if (endDate && new Date() > new Date(endDate)) return 'delayed';
  return 'todo';
};

const activityInclude = {
  progress: { orderBy: { updatedAt: 'desc' }, take: 1 },
  assignments: {
    include: { user: { select: { id: true, name: true, email: true } } },
  },
};

const parsePredecessorRefs = (predecessors) => {
  if (!predecessors) return [];
  return String(predecessors)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(/\s+/)[0]?.trim())
    .filter(Boolean);
};

async function recalculateCpm(projectId, tx) {
  const acts = await tx.activity.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  if (acts.length === 0) return;

  const byId = new Map();
  const byRef = new Map();

  for (const act of acts) {
    const node = {
      ...act,
      duration: Math.max(0, Number(act.duration) || 0),
      predecessorsRefs: parsePredecessorRefs(act.predecessors),
      predecessorIds: new Set(),
      successorIds: new Set(),
      es: null,
      ef: null,
      ls: null,
      lf: null,
    };
    byId.set(act.id, node);
    byRef.set(act.id, act.id);
    if (act.wbsCode) byRef.set(act.wbsCode, act.id);
  }

  for (const node of byId.values()) {
    for (const ref of node.predecessorsRefs) {
      const predId = byRef.get(ref);
      if (!predId || predId === node.id) continue;
      node.predecessorIds.add(predId);
      byId.get(predId)?.successorIds.add(node.id);
    }
  }

  const indegree = new Map();
  for (const node of byId.values()) {
    indegree.set(node.id, node.predecessorIds.size);
  }

  const queue = [];
  for (const node of byId.values()) {
    if (indegree.get(node.id) === 0) queue.push(node.id);
  }

  const topoOrder = [];
  while (queue.length > 0) {
    const id = queue.shift();
    topoOrder.push(id);

    const current = byId.get(id);
    if (!current) continue;

    for (const succId of current.successorIds) {
      const next = (indegree.get(succId) || 0) - 1;
      indegree.set(succId, next);
      if (next === 0) queue.push(succId);
    }
  }

  for (const node of byId.values()) {
    if (topoOrder.includes(node.id)) continue;
    topoOrder.push(node.id);
  }

  for (const id of topoOrder) {
    const node = byId.get(id);
    if (!node) continue;

    let es = Number(node.earlyStart) || 0;
    for (const predId of node.predecessorIds) {
      const pred = byId.get(predId);
      const predEf =
        pred?.ef != null ? pred.ef : Number(pred?.earlyFinish) || 0;
      if (predEf > es) es = predEf;
    }

    node.es = Math.max(0, Math.round(es));
    node.ef = Math.max(0, Math.round(node.es + node.duration));
  }

  const projectFinish = topoOrder.reduce((max, id) => {
    const node = byId.get(id);
    return Math.max(max, node?.ef || 0);
  }, 0);

  for (let i = topoOrder.length - 1; i >= 0; i -= 1) {
    const id = topoOrder[i];
    const node = byId.get(id);
    if (!node) continue;

    let lf;
    if (node.successorIds.size === 0) {
      lf = projectFinish;
    } else {
      let minLs = Infinity;
      for (const succId of node.successorIds) {
        const succ = byId.get(succId);
        const succLs =
          succ?.ls != null ? succ.ls : Number(succ?.lateStart) || projectFinish;
        if (succLs < minLs) minLs = succLs;
      }
      lf = Number.isFinite(minLs) ? minLs : projectFinish;
    }

    node.lf = Math.max(0, Math.round(lf));
    node.ls = Math.max(0, Math.round(node.lf - node.duration));
  }

  for (const node of byId.values()) {
    const totalFloat = Math.max(0, (node.lf ?? 0) - (node.ef ?? 0));
    node.totalFloat = totalFloat;
    node.isCritical = totalFloat === 0;
  }

  for (const node of byId.values()) {
    await tx.activity.update({
      where: { id: node.id },
      data: {
        earlyStart: node.es,
        earlyFinish: node.ef,
        lateStart: node.ls,
        lateFinish: node.lf,
        totalFloat: node.totalFloat,
        isCritical: node.isCritical,
      },
    });
  }
}

const sanitizeActivity = (activity) => {
  const latestProgress = activity.progress?.[0] ?? null;

  return {
    id: activity.id,
    projectId: activity.projectId,
    name: activity.name,
    wbsCode: activity.wbsCode,
    category: activity.category,
    earlyStart: activity.earlyStart,
    earlyFinish: activity.earlyFinish,
    lateStart: activity.lateStart,
    lateFinish: activity.lateFinish,
    totalFloat: activity.totalFloat,
    predecessors: activity.predecessors,
    startDate: activity.startDate,
    endDate: activity.endDate,
    duration: activity.duration,
    budget: activity.budget,
    isMilestone: activity.isMilestone,
    isCritical: activity.isCritical,
    sortOrder: activity.sortOrder,
    pctComplete: latestProgress?.pctComplete ?? 0,
    actualCost: latestProgress?.actualCost ?? null,
    actualStart: latestProgress?.actualStart ?? null,
    actualFinish: latestProgress?.actualFinish ?? null,
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
    throw new HttpError(400, 'INVALID_DATES', 'endDate must be after startDate');
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
  await ensureProject(orgId, projectId);

  const activities = await prisma.activity.findMany({
    where: { projectId },
    include: activityInclude,
    orderBy: { sortOrder: 'asc' },
  });

  return activities.map(sanitizeActivity);
};

const createActivity = async ({ orgId, projectId, payload }) => {
  const project = await ensureProject(orgId, projectId);

  const startDate = payload.startDate ? new Date(payload.startDate) : null;
  const endDate = payload.endDate ? new Date(payload.endDate) : null;
  assertDates({ startDate, endDate });
  const dateWarnings = collectDateWarnings({ project, startDate, endDate });

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

  const activity = await prisma.activity.create({
    data: {
      projectId,
      name: payload.name,
      wbsCode: payload.wbsCode ?? null,
      category: payload.category ?? null,
      startDate,
      endDate,
      budget: payload.budget ?? 0,
      isMilestone: payload.isMilestone ?? false,
      sortOrder: payload.sortOrder ?? 0,
      assignments: {
        create: engineerIds.map((userId) => ({ userId })),
      },
    },
    include: activityInclude,
  });

  return { ...sanitizeActivity(activity), warnings: dateWarnings };
};

const getActivityById = async ({ orgId, projectId, activityId }) => {
  await ensureProject(orgId, projectId);
  const activity = await ensureActivity(projectId, activityId);
  return sanitizeActivity(activity);
};

const updateActivity = async ({ orgId, projectId, activityId, payload }) => {
  await ensureProject(orgId, projectId);
  const existing = await ensureActivity(projectId, activityId);

  const data = {};

  if (payload.name !== undefined) data.name = payload.name;
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
  if (payload.predecessors !== undefined) {
    data.predecessors = payload.predecessors?.trim() || null;
  }
  if (payload.isCritical !== undefined) data.isCritical = payload.isCritical;

  if (payload.budget !== undefined) data.budget = payload.budget;
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

    if (shouldRecalculateCpm) {
      await recalculateCpm(projectId, tx);
    }

    return tx.activity.findFirst({
      where: { id: activityId, projectId },
      include: activityInclude,
    });
  });

  if (!updated) {
    throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');
  }

  return sanitizeActivity(updated);
};

const deleteActivity = async ({ orgId, projectId, activityId }) => {
  await ensureProject(orgId, projectId);
  await ensureActivity(projectId, activityId);

  await prisma.activity.delete({ where: { id: activityId } });
  return { deleted: true };
};

const updateProgress = async ({
  orgId,
  projectId,
  activityId,
  userId,
  payload,
}) => {
  await ensureProject(orgId, projectId);
  const activity = await ensureActivity(projectId, activityId);

  const pctComplete = Math.max(
    0,
    Math.min(100, Number(payload.pctComplete) || 0),
  );
  const derivedCost =
    payload.actualCost != null
      ? payload.actualCost
      : (pctComplete / 100) * (activity.budget || 0) * 1.03;

  const progressData = {
    activityId,
    pctComplete,
    actualCost: derivedCost,
    notes: payload.notes?.trim() || null,
    updatedBy: userId || null,
  };

  if (payload.actualStart !== undefined) {
    progressData.actualStart = payload.actualStart
      ? new Date(payload.actualStart)
      : null;
  }

  if (payload.actualFinish !== undefined) {
    progressData.actualFinish = payload.actualFinish
      ? new Date(payload.actualFinish)
      : null;
  }

  await prisma.activityProgress.create({ data: progressData });

  const updated = await ensureActivity(projectId, activityId);
  return sanitizeActivity(updated);
};

const bulkUpdateProgress = async ({ orgId, projectId, userId, updates }) => {
  await ensureProject(orgId, projectId);

  const activityIds = [...new Set((updates || []).map((u) => u.activityId))];
  const activities = await prisma.activity.findMany({
    where: { projectId, id: { in: activityIds } },
    select: { id: true, budget: true },
  });
  const activityMap = new Map(
    activities.map((activity) => [activity.id, activity]),
  );

  const records = [];
  for (const update of updates || []) {
    const activity = activityMap.get(update.activityId);
    if (!activity) continue;

    const pctComplete = Math.max(
      0,
      Math.min(100, Number(update.pctComplete) || 0),
    );
    const actualCost =
      update.actualCost != null
        ? Number(update.actualCost) || 0
        : (pctComplete / 100) * (activity.budget || 0) * 1.03;

    records.push({
      activityId: update.activityId,
      pctComplete,
      actualCost,
      updatedBy: userId || null,
    });
  }

  if (records.length > 0) {
    await prisma.activityProgress.createMany({ data: records });
  }

  return { updated: records.length };
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
