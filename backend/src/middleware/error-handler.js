const { sendError } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { redactPath } = require("./request-log");

const notFoundHandler = (req, _res, next) => {
  next(
    new HttpError(
      404,
      "NOT_FOUND",
      `Route not found: ${req.method} ${req.originalUrl}`,
    ),
  );
};

const isProduction = () => process.env.NODE_ENV === "production";

const statusOf = (err) => Number(err?.status || err?.statusCode) || null;

const isPrismaKnownError = (err) =>
  typeof err?.code === "string" && /^P\d{4}$/.test(err.code) && Boolean(err.clientVersion);

/**
 * What a client is allowed to see of an error.
 *
 * Only errors somebody wrote on purpose keep their words. Everything else —
 * a Prisma validation error that lists every column of the users table, a
 * raw-query failure naming a relation, a TypeError, an upstream provider's
 * 401 that the web app would read as "your session expired" — becomes a plain
 * 500 in production. The request id in the envelope is the way from the
 * client's screen to the full error in the log.
 *
 * In order:
 * 1. HttpError: deliberate, passed through unchanged (details are still
 *    dropped in production by sendError).
 * 2. Multer: its messages are fixed library text; an oversized file is a 413,
 *    anything else a 400 — today both were 500s.
 * 3. body-parser / http-errors 4xx marked `expose`: malformed JSON, a body over
 *    the limit. The status and message are meant for the client; the code is
 *    taken from the status.
 * 4. Prisma P2002 (unique) and P2025 (record not found) in every environment:
 *    they are the client's conflict or missing record, not a server fault.
 *    The Prisma text is kept only outside production, for developers.
 * 5. Anything else: 500 INTERNAL_ERROR in production; unchanged elsewhere, so
 *    local development sees exactly what it always saw.
 */
const toClientError = (err) => {
  if (err instanceof HttpError) return err;

  const production = isProduction();

  if (err?.name === "MulterError") {
    return err.code === "LIMIT_FILE_SIZE"
      ? new HttpError(413, "FILE_TOO_LARGE", err.message)
      : new HttpError(400, "VALIDATION_ERROR", err.message);
  }

  const status = statusOf(err);
  if (err?.expose === true && status >= 400 && status < 500) {
    return new HttpError(status, null, err.message);
  }
  // Express's own answer to a %-escape it cannot decode in a route parameter.
  if (err instanceof URIError && status === 400) {
    return new HttpError(400, "VALIDATION_ERROR", "The URL is malformed");
  }

  if (isPrismaKnownError(err)) {
    if (err.code === "P2002") return new HttpError(409, "CONFLICT", production ? undefined : err.message);
    if (err.code === "P2025") return new HttpError(404, "NOT_FOUND", production ? undefined : err.message);
  }

  return production ? new HttpError(500, "INTERNAL_ERROR") : err;
};

/**
 * A 5xx in production is logged as a single JSON line: CloudWatch splits a
 * multi-line stack into one event per line, which makes the failure
 * unsearchable by request id. The path is redacted like the request log.
 */
const logServerError = (req, err, clientError) => {
  const line = {
    ts: new Date().toISOString(),
    level: "error",
    msg: "unhandled_error",
    requestId: req.id || null,
    method: req.method,
    path: redactPath(req.originalUrl),
    status: clientError.status,
    name: err?.name || null,
    code: err?.code ?? null,
    message: String(err?.message ?? err).slice(0, 2000),
    stack: typeof err?.stack === "string" ? err.stack.slice(0, 8000) : null,
  };
  process.stderr.write(`${JSON.stringify(line)}\n`);
};

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const clientError = toClientError(err);
  // The request log reports the code the client was given.
  res.locals.errorCode = clientError.code;

  if (process.env.NODE_ENV !== "test") {
    if (isProduction()) {
      if (clientError.status >= 500) logServerError(req, err, clientError);
    } else if (!err.status || err.status >= 500) {
      // Suppress logging for expected client errors (like 401 Unauthorized or 404 Not Found)
      console.error(req.id ? `[${req.id}]` : "", err.stack || err);
    }
  }

  return sendError(res, clientError, undefined, undefined, undefined, {
    includeDetails: process.env.NODE_ENV !== "production",
    requestId: req.id,
  });
};

module.exports = {
  errorHandler,
  notFoundHandler,
  toClientError,
};
