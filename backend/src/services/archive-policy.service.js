const { HttpError } = require("../utils/http-error");

const ARCHIVED_STATUS = "archived";

const includeArchived = (query = {}) =>
  query.includeArchived === true ||
  String(query.includeArchived || "").toLowerCase() === "true";

const isArchiveStatusFilter = (query = {}) =>
  String(query.status || "").toLowerCase() === ARCHIVED_STATUS;

const applyArchiveVisibility = (where, query = {}) => {
  if (!includeArchived(query) && !isArchiveStatusFilter(query)) {
    where.archivedAt = null;
  }
  return where;
};

const isArchivedRecord = (record) =>
  Boolean(record?.archivedAt) || record?.status === ARCHIVED_STATUS;

const assertNotArchived = (record, { code, message }) => {
  if (!isArchivedRecord(record)) return;
  throw new HttpError(409, code, message);
};

const archiveResult = ({ id, status = ARCHIVED_STATUS, archivedAt }) => ({
  id,
  status,
  archived: true,
  deleted: false,
  archivedAt,
});

module.exports = {
  ARCHIVED_STATUS,
  includeArchived,
  applyArchiveVisibility,
  isArchivedRecord,
  assertNotArchived,
  archiveResult,
};
