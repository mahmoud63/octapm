const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const trimToNull = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const normalizeLimit = (
  value,
  { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {},
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultLimit;
  return Math.min(Math.max(Math.trunc(parsed), 1), maxLimit);
};

const normalizeListQuery = (
  query = {},
  {
    allowedSorts = [],
    defaultSortBy = 'created',
    defaultSortDir = 'desc',
    defaultLimit = DEFAULT_LIMIT,
    maxLimit = MAX_LIMIT,
  } = {},
) => {
  const requestedSort = trimToNull(query.sortBy);
  const sortBy = allowedSorts.includes(requestedSort)
    ? requestedSort
    : defaultSortBy;
  const sortDir = query.sortDir === 'asc' || query.sortDir === 'desc'
    ? query.sortDir
    : defaultSortDir;

  return {
    cursor: trimToNull(query.cursor),
    limit: normalizeLimit(query.limit, { defaultLimit, maxLimit }),
    search: trimToNull(query.search),
    sortBy,
    sortDir,
  };
};

// Prisma's cursor is inclusive: the next page starts AT the cursor row, and
// skip: 1 steps over it. So the cursor must be the last row a page RETURNED
// — not the look-ahead row (fetched by take: limit + 1 only to tell whether
// another page exists), which skip: 1 would step over and no page would
// ever return: one row lost at every page boundary (closure review,
// 2026-09-29; the same class as OCTA-API-PAGING-110).
const cursorArgs = (cursor) =>
  cursor
    ? {
        cursor: { id: cursor },
        skip: 1,
      }
    : {};

const toCursorPage = (records, limit) => {
  const rows = [...records];
  let nextCursor = null;

  if (rows.length > limit) {
    rows.pop();
    nextCursor = rows[rows.length - 1]?.id || null;
  }

  return {
    rows,
    pagination: {
      limit,
      nextCursor,
    },
  };
};

const containsInsensitive = (value) => ({
  contains: value,
  mode: 'insensitive',
});

const equalsInsensitive = (value) => ({
  equals: value,
  mode: 'insensitive',
});

const dateRangeFilter = ({ after, before }) => {
  const range = {};
  if (after) range.gte = new Date(after);
  if (before) range.lte = new Date(before);
  return Object.keys(range).length ? range : null;
};

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  containsInsensitive,
  cursorArgs,
  dateRangeFilter,
  equalsInsensitive,
  normalizeLimit,
  normalizeListQuery,
  toCursorPage,
  trimToNull,
};
