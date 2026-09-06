/**
 * Date formatting for calendar dates.
 *
 * The backend stores calendar dates — contract start and finish, the data date,
 * due dates, cost dates — as UTC midnight. Passing one of those through
 * `new Date(value).toLocaleDateString()` renders it in the viewer's timezone,
 * so anyone west of UTC sees the previous day: a contract finishing on
 * 27 November displays as the 26th in Chicago. On a construction project that
 * is a liquidated-damages date, so it has to be right.
 *
 * `formatDate` renders the calendar date that was stored, in every timezone.
 * Use `formatDateTime` only for genuine instants — when something happened,
 * such as an audit timestamp — where local time is what the reader wants.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const toDate = (value: string | number | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  // A bare `YYYY-MM-DD` is already parsed as UTC midnight by the Date
  // constructor, which is what we want to read back out below.
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * A stored calendar date, rendered as the same calendar date everywhere.
 * Reads the UTC components, so no timezone shift can move it a day.
 */
export const formatDate = (
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
  locale?: string,
): string => {
  const date = toDate(value);
  if (!date) return '-';
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date);
};

/** `formatDate` in the short numeric form the tables use. */
export const formatShortDate = (
  value: string | number | Date | null | undefined,
  locale?: string,
): string => formatDate(value, { year: 'numeric', month: 'numeric', day: 'numeric' }, locale);

/** `formatDate` spelled out, for headings and printed documents. */
export const formatLongDate = (
  value: string | number | Date | null | undefined,
  locale?: string,
): string => formatDate(value, { year: 'numeric', month: 'short', day: 'numeric' }, locale);

/**
 * A genuine instant — when something happened — in the viewer's own timezone.
 * Correct for audit trails, comments and notifications; wrong for a due date.
 */
export const formatDateTime = (
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  locale?: string,
): string => {
  const date = toDate(value);
  if (!date) return '-';
  return new Intl.DateTimeFormat(locale, options).format(date);
};

/**
 * The `YYYY-MM-DD` a date input expects, taken from the UTC components so the
 * value round-trips through a form without drifting a day.
 */
export const toDateInputValue = (value: string | number | Date | null | undefined): string => {
  const date = toDate(value);
  if (!date) return '';
  return date.toISOString().slice(0, 10);
};

/** True when the value is a bare calendar date with no time part. */
export const isDateOnly = (value: unknown): boolean =>
  typeof value === 'string' && DATE_ONLY.test(value);
