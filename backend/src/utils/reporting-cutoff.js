/**
 * The earned-value reporting cutoff (owner decision D1, 2026-09-27).
 *
 * A reporting period's cutoff is a calendar date, and it ends at the END OF
 * THAT DATE in the project's time zone: Project.timezone, falling back to the
 * workspace's Organisation.defaultTimezone, falling back to UTC. Planned
 * value, earned value and actual cost are all selected against the one
 * resulting instant — a cost loading planned on the cutoff day, a progress
 * approval at 23:30 local that day and a cost record's actualThroughDate
 * that evening all count; anything after local midnight belongs to the next
 * period.
 *
 * The server's own time zone plays no part. The end of a local day is found
 * from the zone's offset at that moment (Intl.DateTimeFormat), so a day on
 * which daylight saving begins or ends — 23 or 25 hours long — ends at its
 * real local midnight. No dependency beyond the platform's Intl data.
 */

const UTC = "UTC";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

const TIME_ZONE_SOURCES = Object.freeze({
  PROJECT: "project",
  ORGANISATION: "organisation",
  UTC: "utc",
});

const formatters = new Map();

/** A cached formatter giving a zone's wall clock, hours 00-23. */
const wallClockFormatter = (timeZone) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/** Whether the platform knows this IANA zone name. */
const isValidTimeZone = (timeZone) => {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    wallClockFormatter(timeZone.trim());
    return true;
  } catch {
    return false;
  }
};

/** The zone's wall clock at an instant (whole seconds). */
const wallClockAt = (instantMs, timeZone) => {
  const parts = {};
  for (const part of wallClockFormatter(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Some engines still write midnight as 24 under h23.
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
};

/** The zone's offset from UTC at an instant, in milliseconds (east positive). */
const zoneOffsetMs = (instantMs, timeZone) => {
  const whole = Math.floor(instantMs / 1000) * 1000;
  const wall = wallClockAt(whole, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - whole;
};

const pad = (value, length = 2) => String(value).padStart(length, "0");

/** The calendar date (YYYY-MM-DD) an instant falls on in a zone. */
const localDateOf = (instant, timeZone = UTC) => {
  const ms = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  const wall = wallClockAt(ms, timeZone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
};

const parseDateKey = (key) => {
  const match = DATE_ONLY.exec(String(key || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  // 2026-02-30 is not a date.
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
};

const nextDateKey = (key) => {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day) + DAY_MS).toISOString().slice(0, 10);
};

/**
 * The first instant of a local calendar date in a zone, as a UTC epoch.
 * The wall-clock midnight is converted with the offset in force there — the
 * offset is read twice, once at a first guess and once at the instant that
 * guess gives, so a transition between the two is honoured. When local
 * midnight does not exist (a zone whose clocks jump forward at 00:00), the
 * day starts at the first instant that carries its date.
 */
const startOfLocalDayMs = (key, timeZone) => {
  const { year, month, day } = parseDateKey(key);
  const wall = Date.UTC(year, month - 1, day);
  const first = wall - zoneOffsetMs(wall, timeZone);
  const second = wall - zoneOffsetMs(first, timeZone);
  const onTheDay = [first, second]
    .filter((candidate) => localDateOf(candidate, timeZone) === key)
    .sort((a, b) => a - b);
  return onTheDay.length > 0 ? onTheDay[0] : Math.max(first, second);
};

/** The last millisecond of a local calendar date in a zone, as a Date. */
const endOfLocalDay = (key, timeZone = UTC) => {
  if (!parseDateKey(key)) throw new RangeError(`Not a calendar date: ${key}`);
  const zone = isValidTimeZone(timeZone) ? timeZone.trim() : UTC;
  return new Date(startOfLocalDayMs(nextDateKey(key), zone) - 1);
};

/**
 * The zone a project's reporting cutoff is read in: the project's own,
 * else its workspace's default, else UTC. A name the platform does not know
 * is passed over, as if it were not set.
 */
const resolveReportingTimeZone = ({ project = null, organisation = null } = {}) => {
  const projectZone = typeof project?.timezone === "string" ? project.timezone.trim() : "";
  if (isValidTimeZone(projectZone)) {
    return { timeZone: projectZone, source: TIME_ZONE_SOURCES.PROJECT };
  }
  const orgZone =
    typeof organisation?.defaultTimezone === "string" ? organisation.defaultTimezone.trim() : "";
  if (isValidTimeZone(orgZone)) {
    return { timeZone: orgZone, source: TIME_ZONE_SOURCES.ORGANISATION };
  }
  return { timeZone: UTC, source: TIME_ZONE_SOURCES.UTC };
};

/**
 * THE cutoff instant for a reporting date. `value` is either a calendar date
 * (YYYY-MM-DD: that date) or an instant (a Date or a date-time: the date it
 * falls on in the zone — a stored period's cutoff, "now" for an ad hoc
 * report). Returns the end of that local day with what it was read in:
 *
 *   { cutoffDate: Date, localDate: "YYYY-MM-DD", timeZone, timeZoneSource }
 *
 * Throws a RangeError for a value that is not a date.
 */
const resolveReportingCutoff = ({ value, timeZone = UTC, timeZoneSource = TIME_ZONE_SOURCES.UTC }) => {
  const valid = isValidTimeZone(timeZone);
  const zone = valid ? timeZone.trim() : UTC;
  const source = valid ? timeZoneSource : TIME_ZONE_SOURCES.UTC;
  let localDate;
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) {
    localDate = value.trim();
    if (!parseDateKey(localDate)) throw new RangeError(`Not a calendar date: ${value}`);
  } else {
    const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (value === null || value === undefined || Number.isNaN(instant.getTime())) {
      throw new RangeError(`Not a date: ${value}`);
    }
    localDate = localDateOf(instant, zone);
  }
  return {
    cutoffDate: endOfLocalDay(localDate, zone),
    localDate,
    timeZone: zone,
    timeZoneSource: source,
  };
};

module.exports = {
  TIME_ZONE_SOURCES,
  endOfLocalDay,
  isValidTimeZone,
  localDateOf,
  resolveReportingCutoff,
  resolveReportingTimeZone,
  zoneOffsetMs,
};
