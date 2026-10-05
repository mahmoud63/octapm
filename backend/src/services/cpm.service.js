const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  assertNoDependencyCycle,
  buildActivityReferenceMap,
  getActivityDisplayRef,
  normalizeLagDays,
  normalizeRelationshipType,
  parsePredecessors,
} = require('./activity-dependency.service');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The days a schedule date can be: years 1 to 9999 (UTC), what utils/date-input
// accepts and the query engine converts. A conversion that lands outside them
// is no date (null) — a later year failed the critical-path pass's own write,
// and a day past what a Date holds is an invalid Date (CERT-2, trivial-7).
const FIRST_STORABLE_DAY = Date.parse('0001-01-01T00:00:00.000Z');
const LAST_STORABLE_DAY = Date.parse('9999-12-31T00:00:00.000Z');
const isStorableDay = (date) => {
  const time = date.getTime();
  return time >= FIRST_STORABLE_DAY && time <= LAST_STORABLE_DAY;
};

const CALENDAR_DEFINITIONS = {
  five_day: {
    id: 'five_day',
    label: 'Five-day workweek',
    workingDays: new Set([1, 2, 3, 4, 5]),
  },
  six_day: {
    id: 'six_day',
    label: 'Six-day workweek',
    workingDays: new Set([1, 2, 3, 4, 5, 6]),
  },
  seven_day: {
    id: 'seven_day',
    label: 'Seven-day calendar',
    workingDays: new Set([0, 1, 2, 3, 4, 5, 6]),
  },
};

const CALENDAR_ALIASES = new Map([
  ['5_day', 'five_day'],
  ['5-day', 'five_day'],
  ['5d', 'five_day'],
  ['five-day', 'five_day'],
  ['five_day', 'five_day'],
  ['standard-5d', 'five_day'],
  ['standard_5d', 'five_day'],
  ['mon-fri', 'five_day'],
  ['monday-friday', 'five_day'],
  ['6_day', 'six_day'],
  ['6-day', 'six_day'],
  ['6d', 'six_day'],
  ['six-day', 'six_day'],
  ['six_day', 'six_day'],
  ['standard-6d', 'six_day'],
  ['standard_6d', 'six_day'],
  ['mon-sat', 'six_day'],
  ['monday-saturday', 'six_day'],
  ['7_day', 'seven_day'],
  ['7-day', 'seven_day'],
  ['7d', 'seven_day'],
  ['seven-day', 'seven_day'],
  ['seven_day', 'seven_day'],
  ['calendar_days', 'seven_day'],
  ['calendar-days', 'seven_day'],
  ['24x7', 'seven_day'],
]);

function startOfUtcDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function normalizeCalendarId(calendarId, fallbackCalendarId = 'five_day') {
  const raw = String(calendarId || '').trim().toLowerCase();
  const fallbackRaw = String(fallbackCalendarId || '').trim().toLowerCase();
  const fallback = CALENDAR_ALIASES.get(fallbackRaw) || 'five_day';

  if (!raw || raw === 'custom') return fallback;
  return CALENDAR_ALIASES.get(raw) || fallback;
}

function resolveCalendar(calendarId, projectCalendar = 'five_day') {
  const normalizedId = normalizeCalendarId(calendarId, projectCalendar);
  return CALENDAR_DEFINITIONS[normalizedId] || CALENDAR_DEFINITIONS.five_day;
}

function isWorkingDate(dateValue, { calendarId, projectCalendar } = {}) {
  const date = startOfUtcDay(dateValue);
  if (!date) return false;
  return resolveCalendar(calendarId, projectCalendar).workingDays.has(
    date.getUTCDay(),
  );
}

function shiftUtcDate(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function nearestWorkingDate(dateValue, options = {}, direction = 1) {
  let date = startOfUtcDay(dateValue);
  if (!date) return null;
  const step = direction < 0 ? -1 : 1;
  // Every calendar works at least one day in any seven, so seven looks find
  // it. The walk was unbounded, and a step past what a Date holds is an
  // invalid Date — never a working day — so it never ended (CERT-2,
  // trivial-7): such a step is no date (null).
  const { workingDays } = resolveCalendar(options.calendarId, options.projectCalendar);
  for (let look = 0; look < 7; look += 1) {
    if (Number.isNaN(date.getTime())) return null;
    if (workingDays.has(date.getUTCDay())) return date;
    date = shiftUtcDate(date, step);
  }
  return null;
}

function workingDayToDate(projectStartDate, dayOffset, options = {}) {
  if (
    !projectStartDate ||
    dayOffset === null ||
    dayOffset === undefined ||
    dayOffset === ''
  ) {
    return null;
  }

  const offset = Math.round(Number(dayOffset));
  if (!Number.isFinite(offset)) return null;

  const direction = offset < 0 ? -1 : 1;
  let date = nearestWorkingDate(projectStartDate, options, direction);
  if (!date) return null;

  // Whole weeks at once (CERT-2, trivial-7). It walked one day at a time, on
  // every activity read (six offsets each) and for four offsets of every
  // activity in a PATCH's critical-path pass: 36,500 working days took about
  // 20 ms, a million 0.5 s — one activity of a million days held a PATCH's
  // transaction past its five seconds (500) — and past about 71 million the
  // Date became invalid and the walk never ended. The seven days after a
  // working day hold each weekday once, so exactly the calendar's working
  // days in a week, and end on the same weekday, a working one: whole weeks
  // land where the walk landed, and what is left (less than a week of working
  // days) is walked. A date outside years 1 to 9999 is no date (null).
  const { workingDays } = resolveCalendar(options.calendarId, options.projectCalendar);
  let remaining = Math.abs(offset);
  const weeks = Math.floor(remaining / workingDays.size);
  remaining -= weeks * workingDays.size;
  date = shiftUtcDate(date, direction * weeks * 7);
  if (!isStorableDay(date)) return null;

  while (remaining > 0) {
    date = shiftUtcDate(date, direction);
    if (Number.isNaN(date.getTime())) return null;
    if (workingDays.has(date.getUTCDay())) remaining -= 1;
  }

  return isStorableDay(date) ? date : null;
}

function dateToWorkingDay(projectStartDate, dateValue, options = {}) {
  const start = nearestWorkingDate(projectStartDate, options, 1);
  const rawTarget = startOfUtcDay(dateValue);
  if (!start || !rawTarget) return null;

  const targetDirection = rawTarget < start ? -1 : 1;
  const target = nearestWorkingDate(rawTarget, options, targetDirection);
  if (!target) return null;

  if (target.getTime() === start.getTime()) return 0;

  // Whole weeks at once, as workingDayToDate counts them (CERT-2,
  // trivial-7): it walked one day at a time between the two dates — up to
  // 3.6 million days for a schedule file's dates, four per imported activity.
  // Any seven days in a row hold each weekday once; the days after the whole
  // weeks (fewer than seven) are walked.
  const direction = target > start ? 1 : -1;
  const { workingDays } = resolveCalendar(options.calendarId, options.projectCalendar);
  const days = Math.round(Math.abs(target.getTime() - start.getTime()) / MS_PER_DAY);
  const weeks = Math.floor(days / 7);
  let count = weeks * workingDays.size;
  let date = shiftUtcDate(start, direction * weeks * 7);
  for (let step = weeks * 7; step < days; step += 1) {
    date = shiftUtcDate(date, direction);
    if (workingDays.has(date.getUTCDay())) count += 1;
  }

  return direction * count;
}

function collectStructuredDependencies(activities, dependencies) {
  if (Array.isArray(dependencies)) return dependencies;

  const rows = [];
  for (const activity of activities || []) {
    if (Array.isArray(activity.predecessorLinks)) {
      rows.push(...activity.predecessorLinks);
    }
  }
  return rows;
}

function buildDependencyLinks(activities, dependencies, { strict = true } = {}) {
  const refMap = buildActivityReferenceMap(activities);
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const structuredRows = collectStructuredDependencies(activities, dependencies);
  const linksBySuccessor = new Map();
  const successorsWithStructuredRows = new Set();

  for (const row of structuredRows) {
    const predecessorId = row.predecessorId;
    const successorId = row.successorId;

    if (!activityById.has(predecessorId) || !activityById.has(successorId)) {
      if (!strict) continue;
      throw new HttpError(
        400,
        'INVALID_DEPENDENCY_ACTIVITY',
        'Dependency references an activity outside this project.',
        { predecessorId, successorId },
      );
    }

    if (predecessorId === successorId) {
      throw new HttpError(
        400,
        'INVALID_DEPENDENCY_SELF_LINK',
        'An activity cannot depend on itself.',
        { activityId: successorId },
      );
    }

    successorsWithStructuredRows.add(successorId);
    if (!linksBySuccessor.has(successorId)) linksBySuccessor.set(successorId, []);
    linksBySuccessor.get(successorId).push({
      id: row.id,
      predId: predecessorId,
      succId: successorId,
      predecessorId,
      successorId,
      relType: normalizeRelationshipType(row.relationshipType || row.relType, {
        strict,
      }),
      relationshipType: normalizeRelationshipType(
        row.relationshipType || row.relType,
        { strict },
      ),
      lagDays: normalizeLagDays(row.lagDays),
      source: row.source || null,
      predecessor: row.predecessor || activityById.get(predecessorId),
      successor: row.successor || activityById.get(successorId),
    });
  }

  for (const activity of activities) {
    if (successorsWithStructuredRows.has(activity.id)) continue;

    const parsed = parsePredecessors(activity.predecessors, { strict });
    const resolved = parsed.map((link) => {
      const predecessor = refMap.get(link.predRef);
      if (!predecessor) {
        throw new HttpError(
          400,
          'INVALID_DEPENDENCY_PREDECESSOR',
          'Dependency predecessor activity was not found in this project.',
          { activityId: activity.id, predecessorRef: link.predRef },
        );
      }
      if (predecessor.id === activity.id) {
        throw new HttpError(
          400,
          'INVALID_DEPENDENCY_SELF_LINK',
          'An activity cannot depend on itself.',
          { activityId: activity.id },
        );
      }

      return {
        predId: predecessor.id,
        succId: activity.id,
        predecessorId: predecessor.id,
        successorId: activity.id,
        relType: link.relType,
        relationshipType: link.relType,
        lagDays: link.lagDays,
        source: 'legacy',
        predecessor,
        successor: activity,
      };
    });

    if (resolved.length > 0) linksBySuccessor.set(activity.id, resolved);
  }

  const flatLinks = Array.from(linksBySuccessor.values()).flat();
  assertNoDependencyCycle(activities, flatLinks);

  return linksBySuccessor;
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

  if (sortedIds.length !== activities.length) {
    throw new HttpError(
      400,
      'CPM_DEPENDENCY_CYCLE',
      'Activity dependencies contain a cycle. Remove one link before recalculating CPM.',
    );
  }

  return { sortedIds, successors };
}

function buildCalendarDateFields(activity, update, options = {}) {
  const { projectStartDate, projectCalendar } = options;
  if (!projectStartDate) return {};

  const calendarOptions = {
    calendarId: activity.calendarId || projectCalendar,
    projectCalendar,
  };

  return {
    earlyStartDate: workingDayToDate(
      projectStartDate,
      update.earlyStart,
      calendarOptions,
    ),
    earlyFinishDate: workingDayToDate(
      projectStartDate,
      update.earlyFinish,
      calendarOptions,
    ),
    lateStartDate: workingDayToDate(
      projectStartDate,
      update.lateStart,
      calendarOptions,
    ),
    lateFinishDate: workingDayToDate(
      projectStartDate,
      update.lateFinish,
      calendarOptions,
    ),
  };
}

function calculateCpm(
  activities,
  { dependencies, strict = true, projectStartDate = null, projectCalendar = null } = {},
) {
  if (!activities.length) {
    return {
      updates: {},
      sortedIds: [],
      predecessorLinks: new Map(),
      successors: new Map(),
      forwardDrivers: new Map(),
      backwardDrivers: new Map(),
      projectEnd: 0,
    };
  }

  const predecessorLinks = buildDependencyLinks(activities, dependencies, {
    strict,
  });
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const { sortedIds, successors } = topoSort(activities, predecessorLinks);

  const ES = {};
  const EF = {};
  const LS = {};
  const LF = {};
  const forwardDrivers = new Map();
  const backwardDrivers = new Map();

  for (const id of sortedIds) {
    const activity = byId.get(id);
    if (!activity) continue;

    const duration = Math.max(0, Number(activity.duration) || 0);
    const links = predecessorLinks.get(id) || [];

    let es = 0;
    let driver = null;
    for (const link of links) {
      const predEs = ES[link.predId] ?? 0;
      const predEf = EF[link.predId] ?? 0;
      let candidate = predEf + link.lagDays;

      if (link.relType === 'SS') {
        candidate = predEs + link.lagDays;
      } else if (link.relType === 'FF') {
        candidate = predEf + link.lagDays - duration;
      } else if (link.relType === 'SF') {
        candidate = predEs + link.lagDays - duration;
      }

      if (candidate >= es) {
        es = candidate;
        driver = { ...link, candidateStart: candidate };
      }
    }

    ES[id] = Math.max(0, Math.round(es));
    EF[id] = Math.max(0, Math.round(ES[id] + duration));
    if (driver) forwardDrivers.set(id, driver);
  }

  const projectEnd = Math.max(...Object.values(EF), 0);

  const reversed = [...sortedIds].reverse();
  for (const id of reversed) {
    const activity = byId.get(id);
    if (!activity) continue;

    const duration = Math.max(0, Number(activity.duration) || 0);
    const succLinks = successors.get(id) || [];

    let lf = projectEnd;
    let driver = null;

    if (succLinks.length > 0) {
      let minLf = Number.POSITIVE_INFINITY;

      for (const link of succLinks) {
        const succId = link.succId;
        const succLs = LS[succId] ?? projectEnd;
        const succLf = LF[succId] ?? projectEnd;
        let candidate = succLs - link.lagDays;

        if (link.relType === 'SS') {
          candidate = succLs - link.lagDays + duration;
        } else if (link.relType === 'FF') {
          candidate = succLf - link.lagDays;
        } else if (link.relType === 'SF') {
          candidate = succLf - link.lagDays + duration;
        }

        if (candidate <= minLf) {
          minLf = candidate;
          driver = { ...link, candidateLateFinish: candidate };
        }
      }

      lf = Number.isFinite(minLf) ? minLf : projectEnd;
    }

    LF[id] = Math.max(0, Math.round(lf));
    LS[id] = Math.max(0, Math.round(LF[id] - duration));
    if (driver) backwardDrivers.set(id, driver);
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
    Object.assign(
      updates[id],
      buildCalendarDateFields(byId.get(id), updates[id], {
        projectStartDate,
        projectCalendar,
      }),
    );
  }

  return {
    updates,
    sortedIds,
    predecessorLinks,
    successors,
    forwardDrivers,
    backwardDrivers,
    projectEnd,
  };
}

function runCpm(activities, options = {}) {
  return calculateCpm(activities, options).updates;
}

function driverText(link, byId, direction = 'from') {
  if (!link) return null;
  const other =
    direction === 'to' ? byId.get(link.succId) : byId.get(link.predId);
  const ref = getActivityDisplayRef(other) || other?.id || 'activity';
  const lag =
    link.lagDays === 0
      ? ''
      : link.lagDays > 0
        ? `+${link.lagDays}d`
        : `${link.lagDays}d`;
  return `${link.relType}${lag} ${direction} ${ref}`;
}

function buildCriticalPathExplanation(activities, options = {}) {
  const cpm = calculateCpm(activities, options);
  const byId = new Map(
    activities.map((activity) => [
      activity.id,
      { ...activity, ...(cpm.updates[activity.id] || {}) },
    ]),
  );

  const criticalIds = cpm.sortedIds.filter((id) => {
    const activity = byId.get(id);
    return activity && !activity.isMilestone && cpm.updates[id]?.isCritical;
  });

  const terminalId = criticalIds
    .slice()
    .sort(
      (a, b) =>
        (cpm.updates[b]?.earlyFinish || 0) - (cpm.updates[a]?.earlyFinish || 0),
    )[0];

  const reverseChain = [];
  const seen = new Set();
  let currentId = terminalId;

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const activity = byId.get(currentId);
    const driver = cpm.forwardDrivers.get(currentId) || null;

    reverseChain.push({
      activityId: activity.id,
      ref: getActivityDisplayRef(activity),
      name: activity.name,
      calendarId: activity.calendarId || null,
      duration: activity.duration,
      earlyStart: cpm.updates[currentId]?.earlyStart ?? activity.earlyStart,
      earlyFinish: cpm.updates[currentId]?.earlyFinish ?? activity.earlyFinish,
      lateStart: cpm.updates[currentId]?.lateStart ?? activity.lateStart,
      lateFinish: cpm.updates[currentId]?.lateFinish ?? activity.lateFinish,
      totalFloat: cpm.updates[currentId]?.totalFloat ?? activity.totalFloat,
      driver: driver
        ? {
            predecessorId: driver.predId,
            predecessorRef: getActivityDisplayRef(byId.get(driver.predId)),
            relationshipType: driver.relType,
            lagDays: driver.lagDays,
            reason: driverText(driver, byId, 'from'),
          }
        : {
            predecessorId: null,
            predecessorRef: null,
            relationshipType: null,
            lagDays: 0,
            reason: 'No driving predecessor',
          },
    });

    if (!driver || !cpm.updates[driver.predId]?.isCritical) break;
    currentId = driver.predId;
  }

  const floatDrivers = cpm.sortedIds
    .filter((id) => {
      const activity = byId.get(id);
      return activity && !activity.isMilestone && !cpm.updates[id]?.isCritical;
    })
    .map((id) => {
      const activity = byId.get(id);
      const driver = cpm.backwardDrivers.get(id) || null;
      return {
        activityId: activity.id,
        ref: getActivityDisplayRef(activity),
        name: activity.name,
        calendarId: activity.calendarId || null,
        totalFloat: cpm.updates[id]?.totalFloat ?? activity.totalFloat,
        driver: driver
          ? {
              successorId: driver.succId,
              successorRef: getActivityDisplayRef(byId.get(driver.succId)),
              relationshipType: driver.relType,
              lagDays: driver.lagDays,
              reason: driverText(driver, byId, 'to'),
            }
          : {
              successorId: null,
              successorRef: null,
              relationshipType: null,
              lagDays: 0,
              reason: 'Project finish controls available float',
            },
      };
    })
    .sort((a, b) => Number(a.totalFloat || 0) - Number(b.totalFloat || 0))
    .slice(0, 20);

  return {
    projectFinish: cpm.projectEnd,
    criticalActivityCount: criticalIds.length,
    dependencyCount: Array.from(cpm.predecessorLinks.values()).flat().length,
    calendars: Array.from(
      new Set(
        activities
          .map((activity) => activity.calendarId)
          .filter((calendarId) => Boolean(calendarId)),
      ),
    ),
    chain: reverseChain.reverse(),
    floatDrivers,
  };
}

function toPersistedCpmUpdate(data) {
  const {
    earlyStartDate,
    earlyFinishDate,
    lateStartDate: _lateStartDate,
    lateFinishDate: _lateFinishDate,
    ...persisted
  } = data;

  if (earlyStartDate) persisted.startDate = earlyStartDate;
  if (earlyFinishDate) persisted.endDate = earlyFinishDate;

  return persisted;
}

async function applyCpmToProject(projectId, db = prisma) {
  const [project, activities, dependencies] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: { startDate: true, projectCalendar: true },
    }),
    db.activity.findMany({
      where: { projectId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    db.activityDependency.findMany({
      where: {
        projectId,
        predecessor: { isActive: true },
        successor: { isActive: true },
      },
      include: {
        predecessor: {
          select: {
            id: true,
            name: true,
            wbsCode: true,
            p6ActivityId: true,
            sortOrder: true,
          },
        },
      },
      orderBy: [{ successorId: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  if (!activities.length) {
    return { recalculated: 0, criticalActivities: 0 };
  }

  const updates = runCpm(activities, {
    dependencies,
    projectStartDate: project?.startDate || null,
    projectCalendar: project?.projectCalendar || null,
  });
  const entries = Object.entries(updates);

  if (entries.length > 0 && typeof db.$transaction === 'function') {
    await db.$transaction(
      entries.map(([id, data]) =>
        db.activity.update({ where: { id }, data: toPersistedCpmUpdate(data) }),
      ),
    );
  } else {
    for (const [id, data] of entries) {
      await db.activity.update({
        where: { id },
        data: toPersistedCpmUpdate(data),
      });
    }
  }

  const criticalActivities = entries.filter(
    ([, data]) => data.isCritical,
  ).length;

  return { recalculated: entries.length, criticalActivities };
}

module.exports = {
  parsePredecessors,
  buildDependencyLinks,
  calculateCpm,
  runCpm,
  resolveCalendar,
  isWorkingDate,
  workingDayToDate,
  dateToWorkingDay,
  buildCriticalPathExplanation,
  applyCpmToProject,
};
