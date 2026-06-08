const { prisma } = require('../config/db');

function parsePredecessors(predecessorsStr) {
  if (!predecessorsStr) return [];

  return String(predecessorsStr)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      // Format: <predId>:<relType>:<lagDays>
      if (part.includes(':')) {
        const [predRef, relRaw = 'FS', lagRaw = '0'] = part.split(':');
        const relType = String(relRaw || 'FS').toUpperCase();
        const lagDays = Number.parseInt(lagRaw, 10) || 0;
        return { predRef: predRef.trim(), relType, lagDays };
      }

      // Format: <predRef> [FS|SS|FF|SF][+/-lag]
      const match = part.match(/^(\S+)(?:\s+([FS]{1}[FS]{1})([+-]\d+)?)?/i);
      const predRef = match?.[1] || part;
      const relType = String(match?.[2] || 'FS').toUpperCase();
      const lagDays = Number.parseInt(match?.[3] || '0', 10) || 0;
      return { predRef, relType, lagDays };
    });
}

function buildReferenceMap(activities) {
  const map = new Map();
  for (const activity of activities) {
    map.set(activity.id, activity.id);
    if (activity.wbsCode) map.set(String(activity.wbsCode), activity.id);
    if (activity.p6ActivityId)
      map.set(String(activity.p6ActivityId), activity.id);
  }
  return map;
}

function topoSort(activities, predecessorLinks) {
  const inDegree = new Map();
  const successors = new Map();

  for (const activity of activities) {
    inDegree.set(activity.id, 0);
    successors.set(activity.id, []);
  }

  for (const activity of activities) {
    const links = predecessorLinks.get(activity.id) || [];
    for (const link of links) {
      if (!inDegree.has(link.predId)) continue;
      inDegree.set(activity.id, (inDegree.get(activity.id) || 0) + 1);
      successors.get(link.predId).push({ succId: activity.id, ...link });
    }
  }

  const queue = [];
  for (const activity of activities) {
    if ((inDegree.get(activity.id) || 0) === 0) queue.push(activity.id);
  }

  const sortedIds = [];
  while (queue.length > 0) {
    const current = queue.shift();
    sortedIds.push(current);

    for (const succ of successors.get(current) || []) {
      const next = (inDegree.get(succ.succId) || 0) - 1;
      inDegree.set(succ.succId, next);
      if (next === 0) queue.push(succ.succId);
    }
  }

  // Keep unresolved nodes at the end so cycles are handled gracefully.
  for (const activity of activities) {
    if (!sortedIds.includes(activity.id)) sortedIds.push(activity.id);
  }

  return { sortedIds, successors };
}

function runCpm(activities) {
  if (!activities.length) return {};

  const refMap = buildReferenceMap(activities);
  const predecessorLinks = new Map();

  for (const activity of activities) {
    const parsed = parsePredecessors(activity.predecessors);
    const resolved = parsed
      .map((link) => ({
        predId: refMap.get(link.predRef),
        relType: link.relType,
        lagDays: link.lagDays,
      }))
      .filter((link) => Boolean(link.predId) && link.predId !== activity.id);

    predecessorLinks.set(activity.id, resolved);
  }

  const byId = new Map(activities.map((a) => [a.id, a]));
  const { sortedIds, successors } = topoSort(activities, predecessorLinks);

  const ES = {};
  const EF = {};
  const LS = {};
  const LF = {};

  for (const id of sortedIds) {
    const activity = byId.get(id);
    if (!activity) continue;

    const duration = Math.max(0, Number(activity.duration) || 0);
    const links = predecessorLinks.get(id) || [];

    let es = 0;
    for (const link of links) {
      const predEs = ES[link.predId] ?? 0;
      const predEf = EF[link.predId] ?? 0;

      if (link.relType === 'FS') es = Math.max(es, predEf + link.lagDays);
      else if (link.relType === 'SS') es = Math.max(es, predEs + link.lagDays);
      else if (link.relType === 'FF') {
        es = Math.max(es, predEf + link.lagDays - duration);
      } else if (link.relType === 'SF') {
        es = Math.max(es, predEs + link.lagDays - duration);
      } else {
        es = Math.max(es, predEf + link.lagDays);
      }
    }

    ES[id] = Math.max(0, Math.round(es));
    EF[id] = Math.max(0, Math.round(ES[id] + duration));
  }

  const projectEnd = Math.max(...Object.values(EF), 0);

  const reversed = [...sortedIds].reverse();
  for (const id of reversed) {
    const activity = byId.get(id);
    if (!activity) continue;

    const duration = Math.max(0, Number(activity.duration) || 0);
    const succLinks = successors.get(id) || [];

    let lf = projectEnd;

    if (succLinks.length > 0) {
      let minLf = Number.POSITIVE_INFINITY;

      for (const link of succLinks) {
        const succId = link.succId;
        const succLs = LS[succId] ?? projectEnd;
        const succLf = LF[succId] ?? projectEnd;

        if (link.relType === 'FS') {
          minLf = Math.min(minLf, succLs - link.lagDays);
        } else if (link.relType === 'SS') {
          minLf = Math.min(minLf, succLs - link.lagDays + duration);
        } else if (link.relType === 'FF') {
          minLf = Math.min(minLf, succLf - link.lagDays);
        } else if (link.relType === 'SF') {
          minLf = Math.min(minLf, succLf - link.lagDays + duration);
        } else {
          minLf = Math.min(minLf, succLs - link.lagDays);
        }
      }

      lf = Number.isFinite(minLf) ? minLf : projectEnd;
    }

    LF[id] = Math.max(0, Math.round(lf));
    LS[id] = Math.max(0, Math.round(LF[id] - duration));
  }

  const updates = {};
  for (const id of sortedIds) {
    const tf = Math.round((LS[id] ?? 0) - (ES[id] ?? 0));
    updates[id] = {
      earlyStart: ES[id] ?? 0,
      earlyFinish: EF[id] ?? 0,
      lateStart: LS[id] ?? 0,
      lateFinish: LF[id] ?? 0,
      totalFloat: tf,
      isCritical: tf <= 0,
    };
  }

  return updates;
}

async function applyCpmToProject(projectId) {
  const activities = await prisma.activity.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  if (!activities.length) {
    return { recalculated: 0, criticalActivities: 0 };
  }

  const updates = runCpm(activities);
  const entries = Object.entries(updates);

  if (entries.length > 0) {
    await prisma.$transaction(
      entries.map(([id, data]) =>
        prisma.activity.update({ where: { id }, data }),
      ),
    );
  }

  const criticalActivities = entries.filter(
    ([, data]) => data.isCritical,
  ).length;

  return { recalculated: entries.length, criticalActivities };
}

module.exports = {
  parsePredecessors,
  runCpm,
  applyCpmToProject,
};
