/**
 * Shared job error helpers used by the queue, the worker and job handlers.
 * Kept dependency-free so services can import it without pulling the worker.
 */

class JobError extends Error {
  constructor(code, message, { retryable = true, details = null } = {}) {
    super(message || code);
    this.name = "JobError";
    this.code = code || "JOB_FAILED";
    this.retryable = retryable;
    this.details = details;
  }
}

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EPIPE",
]);

/**
 * Decides whether a failure is worth an automatic retry. Explicit
 * `error.retryable` wins; otherwise HTTP status, socket error codes and a few
 * provider messages ("overloaded", "rate limit", "timeout") count as transient.
 */
const isTransientError = (error) => {
  if (!error) return false;
  if (typeof error.retryable === "boolean") return error.retryable;

  const status = Number(error.status || error.statusCode);
  if (Number.isFinite(status) && status > 0) {
    return TRANSIENT_STATUSES.has(status);
  }
  if (TRANSIENT_CODES.has(String(error.code || ""))) return true;

  return /timeout|timed out|overloaded|rate limit|temporarily unavailable|non-JSON/i.test(
    String(error.message || ""),
  );
};

module.exports = { JobError, isTransientError };
