const { sendError } = require("../utils/api-response");
const { HttpError } = require("../utils/http-error");
const { catalogEntryFor, defaultCodeForStatus } = require("../utils/error-codes");
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

/**
 * An error raised by the Prisma client. Its message names models, columns,
 * the query and the engine's own Postgres error; none of it is ever sent to a
 * client, in any environment (CERT-2).
 */
const isPrismaError = (err) =>
  (typeof err?.name === "string" && err.name.startsWith("PrismaClient")) ||
  (typeof err?.clientVersion === "string" && typeof err?.code === "string");

/**
 * What a refusal of a value the database could not take says. The field and
 * the reason stay in the server's log: the database's own words are not a
 * client's to read.
 */
const DATABASE_INPUT_MESSAGE = "The request contains a value that cannot be stored.";

/**
 * Prisma's codes for a value the caller sent that the database cannot hold.
 * InvalidArg is the query engine refusing a JavaScript string it cannot
 * convert (a lone UTF-16 surrogate) — again the caller's value.
 */
const INPUT_PRISMA_CODES = new Set([
  "P2000", // the value is too long for the column
  "P2003", // a foreign key: the value names a row that does not exist
  "P2006", // the value is not valid for the field
  "P2007", // data validation error
  "P2019", // input error
  "P2020", // the value is out of range for the type
  "P2023", // inconsistent column data (a value that is not of the column's kind)
  "InvalidArg",
]);

/**
 * Postgres data exceptions the engine passes through unmapped (in a
 * PrismaClientUnknownRequestError's text, or a raw query's P2010 meta): each
 * is a value of the request that the column cannot take.
 */
const INPUT_POSTGRES_CODES = new Set([
  "22001", // string data right truncation
  "22003", // numeric value out of range
  "22007", // invalid datetime format
  "22008", // datetime field overflow
  "22021", // invalid byte sequence (a NUL in a text value)
  "22P02", // invalid text representation
  "22P05", // unsupported Unicode escape sequence (a NUL in a JSON value)
]);

const postgresCodeOf = (err) => {
  const fromMeta = err?.meta?.code;
  if (typeof fromMeta === "string" && /^[0-9A-Z]{5}$/.test(fromMeta)) return fromMeta;
  const text = String(err?.message || "");
  const match = /PostgresError \{ code: "([0-9A-Z]{5})"/.exec(text) || /\bCode: `([0-9A-Z]{5})`/.exec(text);
  return match ? match[1] : null;
};

/**
 * The query engine's own refusal to bind a value to its column type, before
 * Postgres sees it: "Unable to fit integer value '2147483648' into an INT4
 * (32-bit signed integer)" (kind: ToSql, ConversionError) — an integer of
 * the request too large for an Int column.
 */
const isEngineConversionError = (err) => /\bkind: ToSql\(|\bConversionError\("Unable to fit /.test(String(err?.message || ""));

/**
 * Prisma's own explanation of an error: the last line of its message. The
 * lines before it render the query, with the request's values in it (a
 * string value's own line breaks are escaped there), so a value a client
 * sent can never be mistaken for the explanation.
 */
const explanationOf = (err) => String(err?.message || "").trim().split(/\r?\n/).pop() || "";

/**
 * A PrismaClientValidationError is the query engine refusing the query it
 * was handed, and it is one of two different things (CERT-2):
 *
 * - a VALUE the request carried that the column or the filter cannot take —
 *   a Date that is not a date, an array or a number where one string
 *   belongs, a word outside an enum, null for a required column. Prisma
 *   says so in these words, and the request is answered 400;
 * - the service's own use of the schema — an argument or a field that does
 *   not exist ("Unknown argument", "Unknown field … for select / include
 *   statement"), a required argument left out ("Argument `where` is
 *   missing."), select and include together. That is a code fault: 500, and
 *   an error-level line in the log, so production alerting sees it. A caller's
 *   value that Prisma happens to word this way (an object where a string
 *   belongs is read as a filter: "Unknown argument `a`") is the route's door
 *   to refuse, not this handler's to excuse.
 *
 * Anything Prisma words otherwise is not assumed to be the caller's.
 */
const VALUE_REFUSALS = [
  /Provided Date object is invalid/,
  /\bInvalid value provided\. Expected /,
  /^Invalid value for argument `[^`]*`/,
  /^Argument `[^`]*`: Invalid value/,
  /^Argument `[^`]*` must not be null\.?$/,
];
const isValueRefusal = (err) => err?.name === "PrismaClientValidationError" && VALUE_REFUSALS.some((pattern) => pattern.test(explanationOf(err)));

/**
 * The query engine's refusal to convert a typed value the client library
 * serialised: a Date whose instant is outside years 1-9999 ("Could not
 * convert argument value Object {"$type": String("DateTime"), "value":
 * String("+010000-01-01T13:59:59.000Z")} to ArgumentValue."), a Decimal of
 * NaN or Infinity. The value came from the request; the door refuses it
 * first (dateInput, the figure bounds), and this is the backstop.
 */
const isEngineValueConversionError = (err) =>
  /^Could not convert argument value Object \{"\$type": String\("(DateTime|Decimal|BigInt)"\)/.test(explanationOf(err));

/** A Prisma error caused by a value of the request rather than by the server. */
const isDatabaseInputError = (err) =>
  isPrismaError(err) &&
  (isValueRefusal(err) ||
    INPUT_PRISMA_CODES.has(err.code) ||
    INPUT_POSTGRES_CODES.has(postgresCodeOf(err)) ||
    isEngineConversionError(err) ||
    isEngineValueConversionError(err));

/** A query the service built that the schema does not have: a code fault, never the caller's. */
const isQueryFault = (err) => err?.name === "PrismaClientValidationError" && !isValueRefusal(err);

/**
 * busboy's own refusals of a multipart body it cannot parse (multer passes
 * them on unchanged): a NUL in a part header, a body cut short, a missing
 * boundary. They are plain Errors, recognised by their fixed text and by
 * having been raised inside busboy.
 */
const MULTIPART_PARSE_MESSAGES = new Set([
  "Malformed part header",
  "Unexpected end of form",
  "Unexpected end of file",
  "Multipart: Boundary not found",
  "Malformed content type",
  "Missing Content-Type",
  "Malformed urlencoded form",
]);
const isMultipartParseError = (err) =>
  err instanceof Error &&
  statusOf(err) === null &&
  (MULTIPART_PARSE_MESSAGES.has(err.message) || /^Unsupported content type: /.test(err.message)) &&
  /[\\/]busboy[\\/]/.test(String(err.stack || ""));

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
 *    dropped in production by sendError) — except a 5xx in production, which
 *    keeps its status and code but takes the catalogue message for the code
 *    (or the status default). A server-side failure is where upstream text
 *    ends up: ai-provider wraps the provider's own error sentence into a 503,
 *    and that sentence can carry hostnames or a masked API key. A 5xx whose
 *    message was written for the client says so with `err.expose = true`.
 * 2. Multer: its messages are fixed library text; an oversized file is a 413,
 *    anything else a 400 — today both were 500s.
 * 3. body-parser / http-errors 4xx marked `expose`: a body over the limit.
 *    The status and message are meant for the client; the code is taken
 *    from the status. Malformed JSON is 400 VALIDATION_ERROR "The request
 *    body is not valid JSON." — the parser's own sentence quotes positions
 *    and tokens a client cannot act on.
 *    busboy's refusal of a multipart body it cannot parse (a NUL in a part
 *    header, a body cut short) is the client's malformed request: 400.
 * 4. Prisma, in every environment and never with Prisma's text (CERT-2):
 *    P2002 (unique) is 409 CONFLICT and P2025 (record not found) 404
 *    NOT_FOUND — the client's conflict or missing record; a value of the
 *    request the database cannot take (a PrismaClientValidationError Prisma
 *    words as a value refusal — a date that is not a date, an array where
 *    one value belongs — the input codes P2000/P2003/P2006/P2007/P2019/
 *    P2020/P2023, the engine's InvalidArg for a lone surrogate, Postgres data
 *    exceptions 22001/22003/22007/22008/22021/22P02/22P05, the engine's ToSql
 *    conversion error for an integer too large for its column, its refusal
 *    to convert a DateTime or Decimal it was handed) is 400 VALIDATION_ERROR
 *    with a generic sentence; any other Prisma error — a
 *    PrismaClientValidationError for an unknown argument, field or include
 *    or a missing argument among them: the service's own query — is a
 *    server fault, 500 INTERNAL_ERROR, with the catalogue's sentence. The
 *    full error stays in the server's log.
 * 5. Anything else: 500 INTERNAL_ERROR in production; unchanged elsewhere, so
 *    local development sees exactly what it always saw.
 */
const toClientError = (err) => {
  const production = isProduction();

  if (err instanceof HttpError) {
    if (production && err.status >= 500 && err.expose !== true) {
      const message =
        catalogEntryFor(err.code)?.message ||
        catalogEntryFor(defaultCodeForStatus(err.status))?.message;
      return new HttpError(err.status, err.code, message);
    }
    return err;
  }

  if (err?.name === "MulterError") {
    return err.code === "LIMIT_FILE_SIZE"
      ? new HttpError(413, "FILE_TOO_LARGE", err.message)
      : new HttpError(400, "VALIDATION_ERROR", err.message);
  }
  if (isMultipartParseError(err)) {
    return new HttpError(400, "VALIDATION_ERROR", "The multipart body is malformed.");
  }

  const status = statusOf(err);
  // A body that is not JSON: said in the client's terms, never as the
  // parser's own sentence ("Expected property name or '}' in JSON at …").
  if (err?.type === "entity.parse.failed" && status === 400) {
    return new HttpError(400, "VALIDATION_ERROR", "The request body is not valid JSON.");
  }
  if (err?.expose === true && status >= 400 && status < 500) {
    return new HttpError(status, null, err.message);
  }
  // Express's own answer to a %-escape it cannot decode in a route parameter.
  if (err instanceof URIError && status === 400) {
    return new HttpError(400, "VALIDATION_ERROR", "The URL is malformed");
  }

  if (isPrismaError(err)) {
    if (err.code === "P2002") return new HttpError(409, "CONFLICT");
    if (err.code === "P2025") return new HttpError(404, "NOT_FOUND");
    if (isDatabaseInputError(err)) {
      const refused = new HttpError(400, "VALIDATION_ERROR", DATABASE_INPUT_MESSAGE);
      refused.databaseInput = true;
      return refused;
    }
    const fault = new HttpError(500, "INTERNAL_ERROR");
    if (isQueryFault(err)) fault.queryFault = true;
    return fault;
  }

  return production ? new HttpError(500, "INTERNAL_ERROR") : err;
};

/**
 * A 5xx in production is logged as a single JSON line: CloudWatch splits a
 * multi-line stack into one event per line, which makes the failure
 * unsearchable by request id. The path is redacted like the request log.
 */
const logServerError = (req, err, clientError, { level = "error", msg = "unhandled_error" } = {}) => {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
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
      // A query the service built that the schema does not have is named as such.
      if (clientError.status >= 500) logServerError(req, err, clientError, clientError.queryFault ? { msg: "database_query_fault" } : undefined);
      // A value the database refused is answered 400, but its Prisma error is
      // kept: were it ever a code fault rather than the caller's value, the
      // log is where it shows.
      else if (clientError.databaseInput) logServerError(req, err, clientError, { level: "warn", msg: "database_input_refused" });
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
  isDatabaseInputError,
  isQueryFault,
};
