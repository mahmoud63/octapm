const { HttpError } = require("../utils/http-error");

/**
 * PostgreSQL stores no NUL (U+0000) in a text or jsonb value: a string
 * carrying one reaches the driver and the request answers 500 (22P05,
 * "unsupported Unicode escape sequence"). A NUL in any field is never a
 * legitimate value — no client sends one — so the whole request is refused
 * with 400 VALIDATION_ERROR before any route runs, whether the NUL is in the
 * parsed JSON body, a query parameter, or a path segment.
 *
 * The body and query are scanned as parsed structures (so a NUL nested in an
 * object, an array, or a JSON field is found); the raw URL is scanned for an
 * encoded (%00) or literal NUL, which covers both the query string and the
 * path parameters, before they are decoded into req.params by the router.
 */
const NULL_CHAR = "\u0000";

const hasNull = (value, depth = 0) => {
  if (depth > 12) return false;
  if (typeof value === "string") return value.includes(NULL_CHAR);
  if (Array.isArray(value)) return value.some((item) => hasNull(item, depth + 1));
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key.includes(NULL_CHAR) || hasNull(item, depth + 1)) return true;
    }
  }
  return false;
};

const urlHasNull = (req) => {
  const raw = String(req.originalUrl || req.url || "");
  if (raw.includes(NULL_CHAR) || /%00/i.test(raw)) return true;
  try {
    if (decodeURIComponent(raw).includes(NULL_CHAR)) return true;
  } catch {
    // A malformed %-escape is Express's own 400 later; not this guard's concern.
  }
  return false;
};

const rejectNullBytes = (req, _res, next) => {
  let queryHasNull = false;
  try {
    queryHasNull = hasNull(req.query);
  } catch {
    queryHasNull = false;
  }
  if (urlHasNull(req) || queryHasNull || hasNull(req.body)) {
    return next(
      new HttpError(
        400,
        "VALIDATION_ERROR",
        "The request contains a disallowed character.",
      ),
    );
  }
  return next();
};

module.exports = { rejectNullBytes };
