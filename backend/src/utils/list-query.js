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
    nextCursor = rows.pop()?.id || null;
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
  normalizeListQuery,
  toCursorPage,
  trimToNull,
};
