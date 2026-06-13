const { HttpError } = require('../utils/http-error');

const VALID_RELATIONSHIP_TYPES = ['FS', 'SS', 'FF', 'SF'];
const VALID_SOURCES = ['manual', 'import', 'ai', 'migration'];

function normalizeRelationshipType(value, { strict = false } = {}) {
  const relType = String(value || 'FS')
    .trim()
    .toUpperCase();

  if (VALID_RELATIONSHIP_TYPES.includes(relType)) return relType;

  if (strict) {
    throw new HttpError(
      400,
      'INVALID_DEPENDENCY_RELATIONSHIP',
      'Dependency relationship type must be FS, SS, FF, or SF.',
      { relationshipType: value },
    );
  }

  return 'FS';
}

function normalizeSource(value) {
  const source = String(value || 'manual').trim().toLowerCase();
  return VALID_SOURCES.includes(source) ? source : 'manual';
}

function normalizeLagDays(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function parsePredecessors(predecessorsStr, { strict = false } = {}) {
  if (!predecessorsStr) return [];

  return String(predecessorsStr)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.includes(':')) {
        const [predRef, relRaw = 'FS', lagRaw = '0'] = part.split(':');
        const ref = predRef.trim();
        if (!ref && strict) {
          throw new HttpError(
            400,
            'MALFORMED_DEPENDENCY',
            'Each dependency must include a predecessor reference.',
            { dependency: part },
          );
        }

        return {
          predRef: ref,
          relType: normalizeRelationshipType(relRaw, { strict }),
          lagDays: normalizeLagDays(lagRaw),
          raw: part,
        };
      }

      const match = part.match(/^(\S+)(?:\s+([A-Za-z]{2})(?:\s*([+-]\d+))?)?$/);
      if (!match) {
        if (strict) {
          throw new HttpError(
            400,
            'MALFORMED_DEPENDENCY',
            'Dependency text must use "<predecessor> <FS|SS|FF|SF><+/-lag>".',
            { dependency: part },
          );
        }

        return {
          predRef: part.split(/\s+/)[0],
          relType: 'FS',
          lagDays: 0,
          raw: part,
        };
      }

      return {
        predRef: match[1],
        relType: normalizeRelationshipType(match[2] || 'FS', { strict }),
        lagDays: normalizeLagDays(match[3] || 0),
        raw: part,
      };
    });
}

function buildActivityReferenceMap(activities) {
  const map = new Map();

  for (const activity of activities || []) {
    map.set(activity.id, activity);
    if (activity.activityCode) map.set(String(activity.activityCode), activity);
    if (activity.wbsCode) map.set(String(activity.wbsCode), activity);
    if (activity.p6ActivityId) map.set(String(activity.p6ActivityId), activity);
  }

  return map;
}

function getActivityDisplayRef(activity) {
  if (!activity) return null;
  return activity.activityCode || activity.p6ActivityId || activity.id;
}

function formatLag(lagDays) {
  const lag = normalizeLagDays(lagDays);
  if (lag === 0) return '';
  return lag > 0 ? `+${lag}` : String(lag);
}

function serializeDependencyLink(link) {
  const predecessorRef =
    getActivityDisplayRef(link.predecessor) ||
    link.predecessorRef ||
    link.externalPredecessorRef ||
    link.predecessorId;

  return `${predecessorRef} ${normalizeRelationshipType(
    link.relationshipType || link.relType,
  )}${formatLag(link.lagDays)}`;
}

function serializeDependencyLinks(links) {
  return (links || [])
    .slice()
    .sort((a, b) => {
      const aOrder = a.predecessor?.sortOrder ?? 0;
      const bOrder = b.predecessor?.sortOrder ?? 0;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a.predecessorId).localeCompare(String(b.predecessorId));
    })
    .map(serializeDependencyLink)
    .join(', ');
}

function normalizeDependencyRows({
  activities,
  dependencies = [],
  predecessors = undefined,
  successorId = undefined,
  source = 'manual',
  importSource = null,
  importMetadata = null,
  strict = true,
}) {
  const refMap = buildActivityReferenceMap(activities);
  const activityById = new Map((activities || []).map((activity) => [activity.id, activity]));
  const rows = [];

  const inputRows =
    predecessors !== undefined
      ? parsePredecessors(predecessors, { strict }).map((link) => ({
          predecessorRef: link.predRef,
          relationshipType: link.relType,
          lagDays: link.lagDays,
          externalPredecessorRef: link.raw,
        }))
      : dependencies || [];

  for (const row of inputRows) {
    const nextSuccessorId =
      successorId ||
      row.successorId ||
      row.successorActivityId ||
      refMap.get(String(row.successorRef || '').trim())?.id;
    const predecessorRef =
      row.predecessorRef ||
      row.predRef ||
      row.predecessorCode ||
      row.externalPredecessorRef ||
      row.predecessorId ||
      row.predecessorActivityId;
    const predecessor =
      activityById.get(row.predecessorId || row.predecessorActivityId) ||
      refMap.get(String(predecessorRef || '').trim());
    const successor = activityById.get(nextSuccessorId);

    if (!nextSuccessorId || !successor) {
      throw new HttpError(
        400,
        'INVALID_DEPENDENCY_SUCCESSOR',
        'Dependency successor activity was not found in this project.',
        { successorId: nextSuccessorId || null },
      );
    }

    if (!predecessor) {
      throw new HttpError(
        400,
        'INVALID_DEPENDENCY_PREDECESSOR',
        'Dependency predecessor activity was not found in this project.',
        { predecessorRef: predecessorRef || null, successorId: nextSuccessorId },
      );
    }

    if (predecessor.id === nextSuccessorId) {
      throw new HttpError(
        400,
        'INVALID_DEPENDENCY_SELF_LINK',
        'An activity cannot depend on itself.',
        { activityId: nextSuccessorId },
      );
    }

    rows.push({
      predecessorId: predecessor.id,
      successorId: nextSuccessorId,
      predecessor,
      successor,
      relationshipType: normalizeRelationshipType(
        row.relationshipType || row.relType || row.type || 'FS',
        { strict },
      ),
      lagDays: normalizeLagDays(row.lagDays),
      source: normalizeSource(row.source || source),
      importSource: row.importSource || importSource,
      externalPredecessorRef:
        row.externalPredecessorRef ||
        row.predecessorRef ||
        row.predRef ||
        row.predecessorCode ||
        null,
      externalSuccessorRef:
        row.externalSuccessorRef ||
        row.successorRef ||
        row.succRef ||
        row.successorCode ||
        null,
      importMetadata: row.importMetadata || importMetadata,
    });
  }

  const deduped = new Map();
  for (const row of rows) {
    deduped.set(`${row.projectId || ''}:${row.predecessorId}:${row.successorId}`, row);
  }

  return Array.from(deduped.values());
}

function findDependencyCycle(activities, dependencies) {
  const activityIds = new Set((activities || []).map((activity) => activity.id));
  const adjacency = new Map();

  for (const id of activityIds) adjacency.set(id, []);

  for (const dependency of dependencies || []) {
    if (
      !activityIds.has(dependency.predecessorId) ||
      !activityIds.has(dependency.successorId)
    ) {
      continue;
    }

    adjacency.get(dependency.predecessorId).push(dependency.successorId);
  }

  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function dfs(id) {
    visiting.add(id);
    stack.push(id);

    for (const nextId of adjacency.get(id) || []) {
      if (!visited.has(nextId) && !visiting.has(nextId)) {
        const cycle = dfs(nextId);
        if (cycle) return cycle;
      }

      if (visiting.has(nextId)) {
        const start = stack.indexOf(nextId);
        return [...stack.slice(start), nextId];
      }
    }

    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const id of activityIds) {
    if (visited.has(id)) continue;
    const cycle = dfs(id);
    if (cycle) return cycle;
  }

  return null;
}

function assertNoDependencyCycle(activities, dependencies) {
  const cycle = findDependencyCycle(activities, dependencies);
  if (!cycle) return;

  const byId = new Map((activities || []).map((activity) => [activity.id, activity]));
  throw new HttpError(
    400,
    'CPM_DEPENDENCY_CYCLE',
    'Activity dependencies contain a cycle. Remove one link before recalculating CPM.',
    {
      cycle: cycle.map((id) => ({
        activityId: id,
        ref: getActivityDisplayRef(byId.get(id)),
        name: byId.get(id)?.name || null,
      })),
    },
  );
}

async function updateLegacyPredecessorText(tx, successorId, dependencyRows) {
  await tx.activity.update({
    where: { id: successorId },
    data: {
      predecessors: serializeDependencyLinks(dependencyRows) || null,
    },
  });
}

async function replaceActivityDependencies(tx, {
  projectId,
  successorId,
  dependencies,
  predecessors,
  source = 'manual',
  importSource = null,
  importMetadata = null,
}) {
  const activities = await tx.activity.findMany({
    where: { projectId, isActive: true },
    select: {
      id: true,
      name: true,
      activityCode: true,
      wbsCode: true,
      p6ActivityId: true,
      sortOrder: true,
      createdAt: true,
    },
  });

  const normalized = normalizeDependencyRows({
    activities,
    dependencies,
    predecessors,
    successorId,
    source,
    importSource,
    importMetadata,
    strict: true,
  });

  const existing = await tx.activityDependency.findMany({
    where: { projectId },
    select: {
      predecessorId: true,
      successorId: true,
      relationshipType: true,
      lagDays: true,
    },
  });
  const merged = [
    ...existing.filter((row) => row.successorId !== successorId),
    ...normalized,
  ];

  assertNoDependencyCycle(activities, merged);

  await tx.activityDependency.deleteMany({ where: { projectId, successorId } });

  if (normalized.length > 0) {
    await tx.activityDependency.createMany({
      data: normalized.map((row) => ({
        projectId,
        predecessorId: row.predecessorId,
        successorId: row.successorId,
        relationshipType: row.relationshipType,
        lagDays: row.lagDays,
        source: row.source,
        importSource: row.importSource,
        externalPredecessorRef: row.externalPredecessorRef,
        externalSuccessorRef: row.externalSuccessorRef,
        importMetadata: row.importMetadata,
      })),
    });
  }

  await updateLegacyPredecessorText(tx, successorId, normalized);

  return normalized;
}

async function createProjectDependencies(tx, {
  projectId,
  dependencies,
  source = 'manual',
  importSource = null,
  importMetadata = null,
  replaceExisting = false,
}) {
  const activities = await tx.activity.findMany({
    where: { projectId, isActive: true },
    select: {
      id: true,
      name: true,
      activityCode: true,
      wbsCode: true,
      p6ActivityId: true,
      sortOrder: true,
      createdAt: true,
    },
  });

  const normalized = normalizeDependencyRows({
    activities,
    dependencies,
    source,
    importSource,
    importMetadata,
    strict: true,
  });

  const existing = replaceExisting
    ? []
    : await tx.activityDependency.findMany({
        where: { projectId },
        select: {
          predecessorId: true,
          successorId: true,
          relationshipType: true,
          lagDays: true,
        },
      });

  assertNoDependencyCycle(activities, [...existing, ...normalized]);

  if (replaceExisting) {
    await tx.activityDependency.deleteMany({ where: { projectId } });
  }

  if (normalized.length > 0) {
    await tx.activityDependency.createMany({
      data: normalized.map((row) => ({
        projectId,
        predecessorId: row.predecessorId,
        successorId: row.successorId,
        relationshipType: row.relationshipType,
        lagDays: row.lagDays,
        source: row.source,
        importSource: row.importSource,
        externalPredecessorRef: row.externalPredecessorRef,
        externalSuccessorRef: row.externalSuccessorRef,
        importMetadata: row.importMetadata,
      })),
      skipDuplicates: true,
    });
  }

  const bySuccessor = new Map();
  for (const row of normalized) {
    if (!bySuccessor.has(row.successorId)) bySuccessor.set(row.successorId, []);
    bySuccessor.get(row.successorId).push(row);
  }

  for (const [successorId, rows] of bySuccessor.entries()) {
    await updateLegacyPredecessorText(tx, successorId, rows);
  }

  return normalized;
}

function serializeDependencyDto(row) {
  return {
    id: row.id,
    projectId: row.projectId,
    predecessorId: row.predecessorId,
    successorId: row.successorId,
    relationshipType: normalizeRelationshipType(row.relationshipType),
    lagDays: normalizeLagDays(row.lagDays),
    source: row.source,
    importSource: row.importSource,
    externalPredecessorRef: row.externalPredecessorRef,
    externalSuccessorRef: row.externalSuccessorRef,
    importMetadata: row.importMetadata,
    predecessor: row.predecessor
      ? {
          id: row.predecessor.id,
          name: row.predecessor.name,
          activityCode: row.predecessor.activityCode,
          wbsCode: row.predecessor.wbsCode,
          p6ActivityId: row.predecessor.p6ActivityId,
        }
      : null,
  };
}

module.exports = {
  VALID_RELATIONSHIP_TYPES,
  parsePredecessors,
  normalizeRelationshipType,
  normalizeLagDays,
  buildActivityReferenceMap,
  getActivityDisplayRef,
  serializeDependencyLink,
  serializeDependencyLinks,
  normalizeDependencyRows,
  findDependencyCycle,
  assertNoDependencyCycle,
  replaceActivityDependencies,
  createProjectDependencies,
  serializeDependencyDto,
};
