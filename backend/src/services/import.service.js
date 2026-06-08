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
const { parseMspXml, parseDurationDays } = require('../parsers/msp-parser');
const { applyCpmToProject } = require('./cpm.service');
const { runPostImportSeeding } = require('./post-import.service');
const {
  getApprovedActivityAllocationTotals,
} = require('./activity-boq-allocation.service');

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

function dayOffset(dateValue, projectStartDate) {
  const date = parseMaybeDate(dateValue);
  if (!date || !projectStartDate) return null;

  const diffMs = date.getTime() - projectStartDate.getTime();
  const days = diffMs / (1000 * 60 * 60 * 24);
  return Math.round(days);
}

function normalizePct(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

async function clearExistingScheduleData(tx, projectId) {
  await tx.activityProgress.deleteMany({ where: { activity: { projectId } } });
  await tx.costRecord.deleteMany({ where: { projectId } });
  await tx.longLeadItem.deleteMany({ where: { projectId } });
  await tx.activityAssignment.deleteMany({
    where: { activity: { projectId } },
  });
  await tx.activityEquipment.deleteMany({ where: { activity: { projectId } } });
  await tx.activityMaterial.deleteMany({ where: { activity: { projectId } } });
  await tx.activity.deleteMany({ where: { projectId } });
}

function createProgressRecords(rows) {
  return rows
    .filter((row) => row.activityId)
    .map((row) => ({
      activityId: row.activityId,
      pctComplete: normalizePct(row.physComplete),
      actualCost: row.derivedActualCost,
      notes: 'Imported from schedule source',
      updatedBy: 'import',
    }));
}

async function persistImport({
  project,
  replaceExisting,
  activities,
  relationships,
  wbsNodes,
  source,
  calendars = [],
}) {
  const projectStart = project.startDate ? new Date(project.startDate) : null;

  await prisma.$transaction(async (tx) => {
    if (replaceExisting) {
      await clearExistingScheduleData(tx, project.id);
    }

    const createdRows = [];
    const referenceMap = new Map();

    for (let i = 0; i < activities.length; i += 1) {
      const item = activities[i];
      const duration = Math.max(
        0,
        Number(item.originalDuration ?? item.duration ?? 0) || 0,
      );

      const created = await tx.activity.create({
        data: {
          projectId: project.id,
          name: item.name || 'Imported Activity',
          p6ActivityId: item.p6ActivityId || null,
          wbsCode: item.wbsCode || null,
          calendarId: item.calendarId || null,
          duration,
          originalDuration:
            item.originalDuration != null
              ? Number(item.originalDuration)
              : null,
          remainingDuration:
            item.remainingDuration != null
              ? Number(item.remainingDuration)
              : null,
          physComplete: normalizePct(item.physComplete),
          earlyStart: dayOffset(item.earlyStartDate, projectStart),
          earlyFinish: dayOffset(item.earlyFinishDate, projectStart),
          lateStart: dayOffset(item.lateStartDate, projectStart),
          lateFinish: dayOffset(item.lateFinishDate, projectStart),
          totalFloat:
            item.totalFloat != null
              ? Math.round(Number(item.totalFloat) || 0)
              : null,
          isCritical: Math.round(Number(item.totalFloat) || 0) === 0,
          startDate: parseMaybeDate(item.earlyStartDate),
          endDate: parseMaybeDate(item.earlyFinishDate),
          sortOrder: i,
        },
      });

      createdRows.push({
        activityId: created.id,
        physComplete: normalizePct(item.physComplete),
        derivedActualCost: undefined,
      });

      if (item.sourceTaskId)
        referenceMap.set(String(item.sourceTaskId), created.id);
      if (item.sourceActivityId) {
        referenceMap.set(String(item.sourceActivityId), created.id);
      }
      if (item.uid) referenceMap.set(String(item.uid), created.id);
      if (item.p6ActivityId)
        referenceMap.set(String(item.p6ActivityId), created.id);
      referenceMap.set(created.id, created.id);
    }

    const predecessorMap = new Map();

    for (const rel of relationships) {
      const succRef = String(
        rel.succTaskId || rel.succId || rel.succUid || '',
      ).trim();
      const predRef = String(
        rel.predTaskId || rel.predId || rel.predUid || '',
      ).trim();

      const succDbId = referenceMap.get(succRef);
      const predDbId = referenceMap.get(predRef);

      if (!succDbId || !predDbId || succDbId === predDbId) continue;

      const parts = predecessorMap.get(succDbId) || [];
      parts.push(
        `${predDbId}:${rel.relType || rel.type || 'FS'}:${Math.round(Number(rel.lagDays) || 0)}`,
      );
      predecessorMap.set(succDbId, parts);
    }

    for (const [activityId, parts] of predecessorMap.entries()) {
      await tx.activity.update({
        where: { id: activityId },
        data: { predecessors: parts.join(',') },
      });
    }

    const progressRows = createProgressRecords(createdRows);
    if (progressRows.length > 0) {
      await tx.activityProgress.createMany({ data: progressRows });
    }

    await tx.scheduleRevision.create({
      data: {
        projectId: project.id,
        label: `${source.toUpperCase()} Import`,
        activityCount: activities.length,
        criticalCount: activities.filter((item) => (item.totalFloat || 0) === 0)
          .length,
        totalBudget: 0,
        snapshotJson: {
          source,
          importedAt: new Date().toISOString(),
          activityCount: activities.length,
          wbs: wbsNodes,
          calendars,
        },
      },
    });
  });

  const cpm = await applyCpmToProject(project.id);
  const seeded = await runPostImportSeeding(project.id);

  return {
    imported: activities.length,
    wbsNodes: wbsNodes.length,
    criticalActivities: cpm.criticalActivities,
    costRecordsSeeded: seeded.costSeeded,
    longLeadItemsSeeded: seeded.longLeadSeeded,
  };
}

async function importXer({
  projectId,
  orgId,
  xerContent,
  replaceExisting = false,
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
  });
}

async function importP6Xml({
  projectId,
  orgId,
  xmlContent,
  replaceExisting = false,
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
  });
}

async function importMsp({
  projectId,
  orgId,
  xmlContent,
  replaceExisting = false,
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
    const totalFloat = Math.round((Number(task.totalSlackMinutes) || 0) / 480);

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
        lagDays: parseDurationDays(pred.lagDurationIso),
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
      p6ActivityId: { not: null },
    },
    select: {
      id: true,
      p6ActivityId: true,
      budget: true,
    },
  });
  const allocationTotals = await getApprovedActivityAllocationTotals({
    projectId,
  });

  const updates = [];
  const matched = new Set();

  for (const activity of dbActivities) {
    const key = String(activity.p6ActivityId || '');
    if (!progressMap.has(key)) continue;

    const pct = normalizePct(progressMap.get(key));
    const approvedBudget = allocationTotals.get(activity.id)?.amount || 0;
    const actualCost = (pct / 100) * approvedBudget * 1.03;

    updates.push({
      activityId: activity.id,
      pctComplete: pct,
      actualCost,
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
