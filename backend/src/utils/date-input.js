/**
 * A date a client sends, checked at the door (CERT-2).
 *
 * express-validator's isISO8601() accepts forms that JavaScript's Date does
 * not read — the compact "20261001", the week date "2026-W40", the ordinal
 * "2026-275", "2026-10-01T10Z" — so a service's new Date(value) became an
 * Invalid Date, Prisma refused it at the write and the request answered 500.
 * It also checks an array element by element, so ["2026-10-01"] and [] passed.
 *
 * A date input is ONE string, in the shapes every client of the API sends:
 *
 *   YYYY-MM-DD                          a calendar date (date inputs)
 *   YYYY-MM-DDTHH:mm[:ss[.fff]][zone]   a date-time (toISOString(), datetime-local)
 *   YYYY-MM-DD HH:mm[:ss[.fff]][zone]   the same with a space
 *   YYYY-MM, YYYY                       a month or a year (always accepted; Date reads them)
 *
 * where zone is Z, ±HH:mm or ±HHmm; the year is 0001-9999 (what the
 * database's timestamp holds), the date is a real calendar date (no
 * 2026-02-30), the time a real time of day, and JavaScript's Date reads the
 * string as a valid instant — which is what every service then does with it.
 *
 * The year that counts is the instant's, in UTC, not the one written: an
 * offset moves the instant across a year boundary. "9999-12-31T23:59:59-14:00"
 * is 10000-01-01T13:59:59Z, which the query engine cannot convert (the write
 * or the filter answered 500), and "0001-01-01T00:00:00+14:00" is
 * 0000-12-31T10:00:00Z, stored as a date before the common era (CERT-2).
 * A date-time without a zone is read the way the services read it, as the
 * server's local time.
 */
const DATE_INPUT_SHAPE =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?)?)?$/;
const DATE_ONLY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const FIRST_YEAR = 1;
const LAST_YEAR = 9999;

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Whether `value` is one string that is a date in the accepted shapes. */
const isDateInput = (value) => {
  if (typeof value !== "string") return false;
  const parts = DATE_INPUT_SHAPE.exec(value);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, zoneHour, zoneMinute] = parts.map((part) => (part === undefined ? undefined : Number(part)));
  if (year < 1) return false;
  if (month !== undefined && (month < 1 || month > 12)) return false;
  if (day !== undefined && (day < 1 || day > daysInMonth(year, month))) return false;
  if (hour !== undefined && (hour > 23 || minute > 59)) return false;
  if (second !== undefined && second > 59) return false;
  if (zoneHour !== undefined && (zoneHour > 23 || zoneMinute > 59)) return false;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return false;
  // The instant's own year, which an offset can move past 9999 or before 1.
  const instantYear = instant.getUTCFullYear();
  return instantYear >= FIRST_YEAR && instantYear <= LAST_YEAR;
};

/** Whether `value` is one string that is a calendar date YYYY-MM-DD, and nothing more. */
const isDateOnlyInput = (value) => typeof value === "string" && DATE_ONLY_SHAPE.test(value) && isDateInput(value);

const DATE_INPUT_MESSAGE = "must be a date (YYYY-MM-DD or an ISO 8601 date-time)";
const DATE_ONLY_MESSAGE = "must be a date (YYYY-MM-DD)";

/**
 * For an express-validator chain: body("dueDate").optional({ nullable: true }).custom(dateInput).
 * The chain's own .optional() decides what an absent (or null) value means.
 */
const dateInput = (value) => {
  if (!isDateInput(value)) throw new Error(DATE_INPUT_MESSAGE);
  return true;
};

/** As dateInput, for a field that is a calendar day and never a time: body("date").custom(dateOnlyInput). */
const dateOnlyInput = (value) => {
  if (!isDateOnlyInput(value)) throw new Error(DATE_ONLY_MESSAGE);
  return true;
};

module.exports = { dateInput, dateOnlyInput, isDateInput, isDateOnlyInput, DATE_INPUT_MESSAGE, DATE_ONLY_MESSAGE };
