const { parseStringPromise } = require('xml2js');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function text(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    if (typeof value._ === 'string') return value._.trim();
  }
  return '';
}

function findNodes(node, tagName, acc = []) {
  if (!node || typeof node !== 'object') return acc;

  if (Object.prototype.hasOwnProperty.call(node, tagName)) {
    for (const match of asArray(node[tagName])) {
      acc.push(match);
    }
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) findNodes(item, tagName, acc);
    } else if (value && typeof value === 'object') {
      findNodes(value, tagName, acc);
    }
  }

  return acc;
}

function pick(node, keys) {
  for (const key of keys) {
    if (node && Object.prototype.hasOwnProperty.call(node, key)) {
      return text(node[key]);
    }
  }
  return '';
}

function hoursToDays(hours) {
  const n = Number.parseFloat(hours);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n / 8));
}

function mapP6Status(status) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  if (normalized === 'completed') return 100;
  if (normalized === 'in progress') return 50;
  return 0;
}

function mapRelType(type) {
  const map = {
    'finish to start': 'FS',
    'start to start': 'SS',
    'finish to finish': 'FF',
    'start to finish': 'SF',
    fs: 'FS',
    ss: 'SS',
    ff: 'FF',
    sf: 'SF',
  };

  return (
    map[
      String(type || '')
        .trim()
        .toLowerCase()
    ] || 'FS'
  );
}

async function parseP6Xml(content) {
  const parsed = await parseStringPromise(String(content || ''), {
    explicitArray: false,
    trim: true,
    mergeAttrs: true,
  });

  const project = findNodes(parsed, 'Project')[0] || parsed;
  const activityNodes = findNodes(project, 'Activity');
  const relationshipNodes = findNodes(project, 'Relationship');
  const wbsNodesRaw = findNodes(parsed, 'WBS');

  const activities = activityNodes.map((a) => {
    const p6ActivityId = pick(a, ['Id', 'ActivityId', 'ObjectId']);
    const sourceActivityId = pick(a, ['ObjectId', 'Id', 'ActivityObjectId']);
    const pct = Number.parseFloat(
      pick(a, ['PhysicalPercentComplete', 'PercentComplete']) ||
        String(mapP6Status(pick(a, ['Status']))),
    );

    return {
      sourceActivityId,
      p6ActivityId,
      name: pick(a, ['Name', 'ActivityName']) || 'Imported Activity',
      wbsId: pick(a, ['WBSObjectId', 'WBSId']),
      calendarId: pick(a, ['CalendarObjectId', 'CalendarId']),
      plannedDurationHours: Number.parseFloat(
        pick(a, ['PlannedDuration', 'OriginalDuration']) || '0',
      ),
      remainingDurationHours: Number.parseFloat(
        pick(a, ['RemainingDuration']) || '0',
      ),
      physComplete: Number.isFinite(pct) ? pct : 0,
      earlyStart: pick(a, ['EarlyStartDate', 'PlannedStartDate']),
      earlyFinish: pick(a, ['EarlyFinishDate', 'PlannedFinishDate']),
      lateStart: pick(a, ['LateStartDate']),
      lateFinish: pick(a, ['LateFinishDate']),
      totalFloatHours: Number.parseFloat(pick(a, ['TotalFloat']) || '0'),
      status: pick(a, ['Status']),
    };
  });

  const relationships = relationshipNodes.map((r) => ({
    succId: pick(r, ['SuccessorActivityObjectId', 'SuccessorActivityId']),
    predId: pick(r, ['PredecessorActivityObjectId', 'PredecessorActivityId']),
    type: mapRelType(pick(r, ['Type'])),
    lagDays: hoursToDays(pick(r, ['Lag', 'LagHours'])),
  }));

  const wbsNodes = wbsNodesRaw.map((w) => ({
    objectId: pick(w, ['ObjectId', 'Id']),
    parentObjectId: pick(w, ['ParentObjectId']) || null,
    name: pick(w, ['Name']),
    code: pick(w, ['Code']) || pick(w, ['Name']) || pick(w, ['ObjectId']),
  }));

  return { activities, relationships, wbsNodes };
}

module.exports = {
  parseP6Xml,
  hoursToDays,
  mapRelType,
};
