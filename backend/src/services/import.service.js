const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  parseXer,
  extractActivities: extractXerActivities,
  extractRelationships: extractXerRelationships,
} = require('../parsers/xer-parser');
const {
  parseP6Xml,
  hoursToDays: p6HoursToDays,
} = require('../parsers/p6xml-parser');
const {
  parseMspXml,
  parseDurationDays,
  parseLagDays,
  tenthsOfMinutesToDays,
} = require('../parsers/msp-parser');
const { applyCpmToProject, dateToWorkingDay } = require('./cpm.service');
const { runPostImportSeeding } = require('./post-import.service');

const REVISION_STATUS = Object.freeze({
  DRAFT: 'draft',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  BASELINED: 'baselined',
  SUPERSEDED: 'superseded',
});

const OPEN_REVISION_STATUSES = [
  REVISION_STATUS.DRAFT,
  REVISION_STATUS.UNDER_REVIEW,
  REVISION_STATUS.APPROVED,
];

const normalizeRevisionStatus = (status) =>
  Object.values(REVISION_STATUS).includes(status)
    ? status
    : REVISION_STATUS.DRAFT;

const statusTransitionLog = (revision) =>
  Array.isArray(revision?.statusTransitionLog)
    ? revision.statusTransitionLog
    : [];

const appendStatusTransition = (revision, { to, userId, at, comment }) => [
  ...statusTransitionLog(revision),
  {
    from: normalizeRevisionStatus(revision?.status),
    to,
    by: userId || null,
    at: at.toISOString(),
    comment,
    reason: null,
  },
];

async function supersedeOpenScheduleRevisions(tx, { projectId, userId = null }) {
  const revisions = await tx.scheduleRevision.findMany({
    where: {
      projectId,
      isActive: false,
      status: { in: OPEN_REVISION_STATUSES },
    },
  });

  const at = new Date();
  for (const revision of revisions) {
    await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: {
        status: REVISION_STATUS.SUPERSEDED,
        supersededBy: userId,
        supersededAt: at,
        statusTransitionLog: appendStatusTransition(revision, {
          to: REVISION_STATUS.SUPERSEDED,
          userId,
          at,
          comment: 'Superseded by an imported schedule revision',
        }),
      },
    });
  }
}

async function ensureProject(orgId, projectId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
  });

  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return project;
}

function parseMaybeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function dayOffset(dateValue, projectStartDate, calendarOptions = {}) {
  const date = parseMaybeDate(dateValue);
  if (!date || !projectStartDate) return null;

  const workingDayOffset = dateToWorkingDay(
    projectStartDate,
    date,
    calendarOptions,
  );
  if (workingDayOffset !== null) return workingDayOffset;

  const diffMs = date.getTime() - projectStartDate.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function normalizePct(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

const trimOrNull = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

function stagedActivityKey(item, index) {
  return (
    trimOrNull(
      item.sourceActivityId ||
        item.sourceTaskId ||
        item.uid ||
        item.p6ActivityId ||
        item.wbsCode,
    ) || `import-${index + 1}`
  );
}

function isoOrNull(value) {
  const date = parseMaybeDate(value);
  return date ? date.toISOString() : null;
}

function buildImportSnapshot({ project, activities, relationships, wbsNodes, source, calendars }) {
  const projectStart = project.startDate ? new Date(project.startDate) : null;
  const refToDraftKey = new Map();
  const seen = new Set();

  const stagedActivities = activities.map((item, index) => {
    let draftKey = stagedActivityKey(item, index);
    if (seen.has(draftKey)) draftKey = `${draftKey}#${index + 1}`;
    seen.add(draftKey);

    const refs = [
      item.sourceTaskId,
      item.sourceActivityId,
      item.uid,
      item.p6ActivityId,
      item.wbsCode,
      draftKey,
    ];
    for (const ref of refs) {
      const key = trimOrNull(ref);
      if (key && !refToDraftKey.has(key)) refToDraftKey.set(key, draftKey);
    }

    const duration = Math.max(
      0,
      Number(item.originalDuration ?? item.duration ?? 0) || 0,
    );
    const calendarId =
      trimOrNull(item.calendarId) || project.projectCalendar || null;
    const calendarOptions = {
      calendarId,
      projectCalendar: project.projectCalendar,
    };

    return {
      draftKey,
      sourceActivityId: trimOrNull(item.sourceActivityId || item.sourceTaskId),
      uid: trimOrNull(item.uid),
      p6ActivityId: trimOrNull(item.p6ActivityId),
      name: item.name || 'Imported Activity',
      wbsCode: trimOrNull(item.wbsCode),
      calendarId,
      duration,
      originalDuration:
        item.originalDuration != null ? Number(item.originalDuration) : null,
      remainingDuration:
        item.remainingDuration != null ? Number(item.remainingDuration) : null,
      physComplete: normalizePct(item.physComplete),
      earlyStart: dayOffset(item.earlyStartDate, projectStart, calendarOptions),
      earlyFinish: dayOffset(
        item.earlyFinishDate,
        projectStart,
        calendarOptions,
      ),
      lateStart: dayOffset(item.lateStartDate, projectStart, calendarOptions),
      lateFinish: dayOffset(item.lateFinishDate, projectStart, calendarOptions),
      totalFloat:
        item.totalFloat != null ? Math.round(Number(item.totalFloat) || 0) : null,
      isCritical: Math.round(Number(item.totalFloat) || 0) === 0,
      startDate: isoOrNull(item.earlyStartDate),
      endDate: isoOrNull(item.earlyFinishDate),
      sortOrder: index,
    };
  });

  const dependencies = [];
  for (const rel of relationships) {
    const succRef = trimOrNull(rel.succTaskId || rel.succId || rel.succUid);
    const predRef = trimOrNull(rel.predTaskId || rel.predId || rel.predUid);
    const successorRef = succRef ? refToDraftKey.get(succRef) : null;
    const predecessorRef = predRef ? refToDraftKey.get(predRef) : null;

    if (!successorRef || !predecessorRef || successorRef === predecessorRef) {
      continue;
    }

    dependencies.push({
      predecessorRef,
      successorRef,
      relationshipType: rel.relType || rel.type || 'FS',
      lagDays: Math.round(Number(rel.lagDays) || 0),
      source: 'import',
      importSource: source,
      externalPredecessorRef: predRef,
      externalSuccessorRef: succRef,
      importMetadata: {
        source,
        rawRelationship: rel,
      },
    });
  }

  return {
    source,
    importedAt: new Date().toISOString(),
    activityCount: stagedActivities.length,
    wbs: wbsNodes,
    calendars,
    activities: stagedActivities,
    dependencies,
  };
}

async function persistImport({
  project,
  activities,
  relationships,
  wbsNodes,
  source,
  calendars = [],
  userId = null,
}) {
  const snapshot = buildImportSnapshot({
    project,
    activities,
    relationships,
    wbsNodes,
    source,
    calendars,
  });
  let revisionId = null;

  await prisma.$transaction(async (tx) => {
    await supersedeOpenScheduleRevisions(tx, {
      projectId: project.id,
      userId,
    });

    const createdAt = new Date();
    const revision = await tx.scheduleRevision.create({
      data: {
        projectId: project.id,
        label: `${source.toUpperCase()} Import`,
        activityCount: activities.length,
        criticalCount: activities.filter((item) => (item.totalFloat || 0) === 0)
          .length,
        totalBudget: 0,
        source,
        isActive: false,
        status: REVISION_STATUS.DRAFT,
        snapshotJson: snapshot,
        statusTransitionLog: [
          {
            from: null,
            to: REVISION_STATUS.DRAFT,
            by: userId,
            at: createdAt.toISOString(),
            comment: 'Staged imported schedule revision created',
            reason: null,
          },
        ],
      },
    });
    revisionId = revision.id;
  });

  return {
    staged: true,
    revisionId,
    imported: activities.length,
    wbsNodes: wbsNodes.length,
    criticalActivities: activities.filter((item) => (item.totalFloat || 0) === 0)
      .length,
    dependencyCount: snapshot.dependencies.length,
    message:
      'Schedule import staged as a draft revision. Activate after mapping review and approval.',
  };
}

async function importXer({
  projectId,
  orgId,
  xerContent,
  replaceExisting = false,
  userId = null,
}) {
  const project = await ensureProject(orgId, projectId);

  const tables = parseXer(xerContent);
  const parsed = extractXerActivities(tables);
  const relationships = extractXerRelationships(tables);

  if (!parsed.activities.length) {
    throw new HttpError(400, 'PARSE_ERROR', 'No activities found in XER file');
  }

  return persistImport({
    project,
    replaceExisting,
    activities: parsed.activities,
    relationships,
    wbsNodes: parsed.wbsNodes,
    calendars: parsed.calendars,
    source: 'xer',
    userId,
  });
}

async function importP6Xml({
  projectId,
  orgId,
  xmlContent,
  replaceExisting = false,
  userId = null,
}) {
  const project = await ensureProject(orgId, projectId);
  const parsed = await parseP6Xml(xmlContent);

  const wbsCodeMap = new Map(
    parsed.wbsNodes.map((wbs) => [
      String(wbs.objectId || ''),
      wbs.code || null,
    ]),
  );

  const activities = parsed.activities.map((activity) => ({
    sourceActivityId: activity.sourceActivityId,
    p6ActivityId: activity.p6ActivityId,
    name: activity.name,
    wbsCode:
      wbsCodeMap.get(String(activity.wbsId || '')) || activity.wbsId || null,
    calendarId: activity.calendarId || null,
    originalDuration: p6HoursToDays(activity.plannedDurationHours),
    remainingDuration: p6HoursToDays(activity.remainingDurationHours),
    physComplete: normalizePct(activity.physComplete),
    earlyStartDate: activity.earlyStart,
    earlyFinishDate: activity.earlyFinish,
    lateStartDate: activity.lateStart,
    lateFinishDate: activity.lateFinish,
    totalFloat: p6HoursToDays(activity.totalFloatHours),
  }));

  if (!activities.length) {
    throw new HttpError(400, 'PARSE_ERROR', 'No activities found in P6 XML');
  }

  const relationships = parsed.relationships.map((rel) => ({
    succId: rel.succId,
    predId: rel.predId,
    relType: rel.type,
    lagDays: rel.lagDays,
  }));

  return persistImport({
    project,
    replaceExisting,
    activities,
    relationships,
    wbsNodes: parsed.wbsNodes,
    source: 'p6xml',
    userId,
  });
}

async function importMsp({
  projectId,
  orgId,
  xmlContent,
  replaceExisting = false,
  userId = null,
}) {
  const project = await ensureProject(orgId, projectId);
  const parsed = await parseMspXml(xmlContent);

  const workTasks = parsed.tasks.filter(
    (task) =>
      !task.isSummary && task.uid !== '0' && String(task.name || '').trim(),
  );

  if (!workTasks.length) {
    throw new HttpError(400, 'PARSE_ERROR', 'No work tasks found in MSP XML');
  }

  const activities = workTasks.map((task) => {
    const duration = parseDurationDays(task.durationIso);
    // MSPDI TotalSlack is in tenths of a minute (4800 per 8-hour day).
    const totalFloat = tenthsOfMinutesToDays(task.totalSlackMinutes);

    return {
      uid: task.uid,
      sourceTaskId: task.uid,
      p6ActivityId: task.uid,
      name: task.name,
      wbsCode: task.wbsCode,
      calendarId: null,
      originalDuration: duration,
      remainingDuration: duration,
      physComplete: normalizePct(task.percentComplete),
      earlyStartDate: task.start,
      earlyFinishDate: task.finish,
      lateStartDate: null,
      lateFinishDate: null,
      totalFloat,
    };
  });

  const relationships = [];
  for (const task of workTasks) {
    for (const pred of task.predecessors || []) {
      relationships.push({
        succUid: task.uid,
        predUid: pred.predUid,
        relType: pred.type,
        lagDays: parseLagDays(pred.lagDurationIso),
      });
    }
  }

  return persistImport({
    project,
    replaceExisting,
    activities,
    relationships,
    wbsNodes: [],
    source: 'msp',
    userId,
  });
}

async function importProgress({ projectId, orgId, format, content }) {
  await ensureProject(orgId, projectId);

  const normalized = String(format || '').toLowerCase();
  let progressMap = new Map();

  if (normalized === 'xer') {
    const tables = parseXer(content);
    const parsed = extractXerActivities(tables);
    progressMap = new Map(
      parsed.activities
        .filter((a) => a.p6ActivityId)
        .map((a) => [String(a.p6ActivityId), normalizePct(a.physComplete)]),
    );
  } else if (normalized === 'p6xml') {
    const parsed = await parseP6Xml(content);
    progressMap = new Map(
      parsed.activities
        .filter((a) => a.p6ActivityId)
        .map((a) => [String(a.p6ActivityId), normalizePct(a.physComplete)]),
    );
  } else {
    throw new HttpError(400, 'INVALID_FORMAT', 'format must be xer or p6xml');
  }

  const dbActivities = await prisma.activity.findMany({
    where: {
      projectId,
      isActive: true,
      p6ActivityId: { not: null },
    },
    select: {
      id: true,
      p6ActivityId: true,
      budget: true,
    },
  });
  const updates = [];
  const matched = new Set();

  for (const activity of dbActivities) {
    const key = String(activity.p6ActivityId || '');
    if (!progressMap.has(key)) continue;

    const pct = normalizePct(progressMap.get(key));

    updates.push({
      activityId: activity.id,
      pctComplete: pct,
      actualCost: null,
      progressMethod: 'percent_complete',
      source: 'import',
      status: 'approved',
      approvedBy: 'import',
      approvedAt: new Date(),
      notes: 'Imported from progress file',
      updatedBy: 'import',
    });
    matched.add(key);
  }

  if (updates.length > 0) {
    await prisma.activityProgress.createMany({ data: updates });
  }

  return {
    updated: updates.length,
    notMatched: Math.max(0, progressMap.size - matched.size),
    message: `Updated progress for ${updates.length} activities`,
  };
}

async function recalculateProjectCpm({ projectId, orgId }) {
  await ensureProject(orgId, projectId);
  return applyCpmToProject(projectId);
}

async function seedLinkedModules({ projectId, orgId }) {
  await ensureProject(orgId, projectId);
  return runPostImportSeeding(projectId);
}

module.exports = {
  importXer,
  importP6Xml,
  importMsp,
  importProgress,
  recalculateProjectCpm,
  seedLinkedModules,
};
