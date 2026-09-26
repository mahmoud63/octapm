const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

/**
 * BOQ ↔ activity mapping suggestions (mapping doc §6).
 *
 * One read-only service that ranks candidate activities for each BOQ row by
 * the structure the project already has — codes, WBS nodes, locations, names
 * and commitment cost codes — and reports each candidate with the rule that
 * matched it and a confidence. It never writes a row: a suggestion becomes a
 * draft allocation only when a user accepts it (POST the pair with
 * `suggestedBy` and `confidence`) or when the AI structuring job writes its
 * own drafts with source 'ai'.
 *
 *   rule:code      item code equals the activity's code, or one is the
 *                  other's dotted prefix                              0.90
 *   rule:wbs       item WBS node is the activity's node or an ancestor 0.80
 *   rule:costcode  item cost code is on a commitment SOV line that
 *                  names an activity                                  0.70
 *   rule:name      normalised description equals the activity name   0.60
 *   rule:location  same location subtree — a bonus on any rule       +0.05
 *
 * The strongest rule names the candidate; the location bonus is added on
 * top and the result is capped at 0.99 so no rule ever claims certainty.
 */

const CONFIDENCE = Object.freeze({
  'rule:code': 0.9,
  'rule:wbs': 0.8,
  'rule:costcode': 0.7,
  'rule:name': 0.6,
});
const LOCATION_BONUS = 0.05;
const MAX_CONFIDENCE = 0.99;
const DEFAULT_LIMIT_PER_ITEM = 5;
const MAX_LIMIT_PER_ITEM = 20;
const PATH_SEPARATOR = '/';
const NOT_APPLICABLE = 'not_applicable';

// The same normaliser schedule activation uses to match staged activities to
// existing ones by name (schedule.service.js normalizeNameKey): trimmed,
// lower-cased, inner whitespace collapsed. Kept identical on purpose so a
// bill and a programme that agree for activation agree here too.
const normalizeNameKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const normalizeCodeKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

const isDescendantPath = (candidatePath, ancestorPath) =>
  Boolean(candidatePath) &&
  Boolean(ancestorPath) &&
  (candidatePath === ancestorPath ||
    candidatePath.startsWith(`${ancestorPath}${PATH_SEPARATOR}`));

const sameLocationSubtree = (itemLocation, activityLocation) =>
  Boolean(itemLocation?.path) &&
  Boolean(activityLocation?.path) &&
  (isDescendantPath(activityLocation.path, itemLocation.path) ||
    isDescendantPath(itemLocation.path, activityLocation.path));

const codeMatches = (itemCode, activityCode) => {
  if (!itemCode || !activityCode) return false;
  if (itemCode === activityCode) return true;
  return (
    itemCode.startsWith(`${activityCode}.`) ||
    activityCode.startsWith(`${itemCode}.`)
  );
};

const activityLabel = (activity) =>
  activity.activityCode || activity.p6ActivityId || activity.id;

/**
 * Ranked candidates for the project's BOQ rows. `boqItemId` narrows the
 * answer to one row; `limit` caps the candidates per row. Rows marked
 * not_applicable get no candidates (an allocation to them is refused), and
 * a pair that already has an active allocation is never suggested again.
 */
const listSuggestions = async ({ orgId, projectId, boqItemId = null, limit = DEFAULT_LIMIT_PER_ITEM }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const perItem = Math.max(1, Math.min(MAX_LIMIT_PER_ITEM, Number(limit) || DEFAULT_LIMIT_PER_ITEM));

  const [items, activities, existingPairs, sovLines] = await Promise.all([
    prisma.boqItem.findMany({
      where: {
        projectId,
        isActive: true,
        ...(boqItemId ? { id: boqItemId } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        code: true,
        ref: true,
        description: true,
        mappingRule: true,
        wbsNodeId: true,
        locationId: true,
        costCodeId: true,
        wbsNode: { select: { id: true, code: true, path: true } },
        location: { select: { id: true, path: true } },
      },
    }),
    prisma.activity.findMany({
      where: { projectId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        activityCode: true,
        p6ActivityId: true,
        wbsCode: true,
        wbsNodeId: true,
        locationId: true,
        duration: true,
        wbsNode: { select: { id: true, code: true, path: true } },
        location: { select: { id: true, path: true } },
      },
    }),
    prisma.activityBoqAllocation.findMany({
      where: { projectId, isActive: true },
      select: { boqItemId: true, activityId: true },
    }),
    prisma.commitmentSovLine.findMany({
      where: {
        commitment: { projectId },
        costCodeId: { not: null },
        activityId: { not: null },
      },
      select: { costCodeId: true, activityId: true },
    }),
  ]);

  if (boqItemId && items.length === 0) {
    throw new HttpError(404, 'BOQ_ITEM_NOT_FOUND', 'BOQ item not found');
  }

  const taken = new Set(existingPairs.map((pair) => `${pair.boqItemId}:${pair.activityId}`));
  const activitiesByCostCode = new Map();
  for (const line of sovLines) {
    const set = activitiesByCostCode.get(line.costCodeId) || new Set();
    set.add(line.activityId);
    activitiesByCostCode.set(line.costCodeId, set);
  }
  const activitiesByName = new Map();
  for (const activity of activities) {
    const key = normalizeNameKey(activity.name);
    if (!key) continue;
    const list = activitiesByName.get(key) || [];
    list.push(activity);
    activitiesByName.set(key, list);
  }

  const suggestions = [];
  const byItem = [];

  for (const item of items) {
    if ((item.mappingRule || 'required') === NOT_APPLICABLE) {
      byItem.push({ boqItemId: item.id, code: item.code || item.ref || '', candidates: [], skipped: 'not_applicable' });
      continue;
    }
    const itemCode = normalizeCodeKey(item.code || item.ref);
    const itemName = normalizeNameKey(item.description);
    const costCodeActivities = item.costCodeId ? activitiesByCostCode.get(item.costCodeId) : null;
    const candidates = [];

    for (const activity of activities) {
      if (taken.has(`${item.id}:${activity.id}`)) continue;

      const reasons = [];
      let rule = null;
      let confidence = 0;
      const consider = (name) => {
        reasons.push(name);
        if (CONFIDENCE[name] > confidence) {
          confidence = CONFIDENCE[name];
          rule = name;
        }
      };

      if (
        codeMatches(itemCode, normalizeCodeKey(activity.activityCode)) ||
        codeMatches(itemCode, normalizeCodeKey(activity.p6ActivityId))
      ) {
        consider('rule:code');
      }
      if (
        item.wbsNode?.path &&
        activity.wbsNode?.path &&
        isDescendantPath(activity.wbsNode.path, item.wbsNode.path)
      ) {
        consider('rule:wbs');
      }
      if (costCodeActivities?.has(activity.id)) {
        consider('rule:costcode');
      }
      if (itemName && normalizeNameKey(activity.name) === itemName) {
        consider('rule:name');
      }

      if (!rule) continue;

      let score = confidence;
      if (sameLocationSubtree(item.location, activity.location)) {
        reasons.push('rule:location');
        score = Math.min(MAX_CONFIDENCE, score + LOCATION_BONUS);
      }

      candidates.push({
        boqItemId: item.id,
        boqCode: item.code || item.ref || '',
        activityId: activity.id,
        activityCode: activityLabel(activity),
        activityName: activity.name,
        wbsCode: activity.wbsCode ?? null,
        suggestedBy: rule,
        confidence: Number(score.toFixed(2)),
        reasons,
      });
    }

    candidates.sort(
      (a, b) =>
        b.confidence - a.confidence ||
        a.activityCode.localeCompare(b.activityCode, undefined, { numeric: true }),
    );
    const top = candidates.slice(0, perItem);
    suggestions.push(...top);
    byItem.push({ boqItemId: item.id, code: item.code || item.ref || '', candidates: top, skipped: null });
  }

  return {
    suggestions,
    byItem,
    summary: {
      items: items.length,
      itemsWithCandidates: byItem.filter((row) => row.candidates.length > 0).length,
      candidates: suggestions.length,
      limitPerItem: perItem,
    },
  };
};

module.exports = {
  CONFIDENCE,
  LOCATION_BONUS,
  listSuggestions,
  normalizeNameKey,
};
