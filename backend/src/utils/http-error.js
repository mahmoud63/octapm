const {
  catalogEntryFor,
  normalizeErrorCode,
  normalizeStatus,
} = require("./error-codes");

class HttpError extends Error {
  constructor(status, code, message, details) {
    const normalizedStatus = normalizeStatus(status);
    const normalizedCode = normalizeErrorCode(code, normalizedStatus);
    const catalogEntry = catalogEntryFor(normalizedCode);
    super(message || catalogEntry?.message || "Something went wrong");
    this.status = normalizedStatus;
    this.code = normalizedCode;
    this.details = details;
  }
}

module.exports = { HttpError };
