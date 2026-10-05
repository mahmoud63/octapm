const fsp = require("fs/promises");
const { HttpError } = require("../utils/http-error");

/**
 * PostgreSQL stores no NUL (U+0000) in a text or jsonb value: a string
 * carrying one reaches the driver and the request answers 500 (22021 in a
 * text column, 22P05 "unsupported Unicode escape sequence" in a JSON one).
 * Prisma's query engine cannot take a string holding a lone UTF-16 surrogate
 * ("\ud800" in JSON) at all and fails with InvalidArg — a 500 too. Neither is
 * ever a legitimate value — no client sends one — so the whole request is
 * refused with 400 VALIDATION_ERROR before any route runs, whether the
 * character is in the parsed JSON body, a query parameter, a path segment,
 * or an object key.
 *
 * The body and query are scanned as parsed structures, iteratively: a value
 * nested at any depth is found (a recursion that stopped at depth 12 let a
 * NUL nested deeper through to a JSON column — CERT-2). The raw URL is
 * scanned for an encoded (%00) or literal NUL, which covers both the query
 * string and the path parameters, before they are decoded into req.params
 * by the router.
 *
 * The same walk refuses two shapes of a value no client sends and the code
 * behind the door cannot take (CERT-2, robustness-6):
 *
 * - a body nested deeper than MAX_BODY_DEPTH levels. JSON.parse reads any
 *   depth, but what reads the value next recurses: express-validator's
 *   sanitizers join a nested array element by element, the Prisma client
 *   serialises a JSON column recursively — 5,000 levels answered 500
 *   "Maximum call stack size exceeded". The query engine itself stores no
 *   JSON value deeper than about 120 levels; the deepest body any client
 *   sends is 6 levels (a form template, a bulk progress update);
 * - an object with its own "toString" or "valueOf" key. JavaScript turns an
 *   object into a string or a number through those two methods; a JSON key
 *   of that name shadows the method with a value that is not one, and every
 *   conversion of the object throws a TypeError — express-validator's
 *   isString().trim(), isIn(), isUUID() on {"toString": null} all answered
 *   500 "Cannot convert object to primitive value".
 *
 * A multipart body is parsed by multer inside the route, after this guard
 * has run at the application level, so every route that takes an upload runs
 * the guard again right after its multer middleware: the text fields multer
 * put in req.body and every file's original name and field name are scanned
 * the same way, and a refused request's temporary files are removed. (A NUL
 * inside a part header is busboy's own "Malformed part header", answered 400
 * by the error handler.) A multipart field is text: multer builds an object
 * for a field named "x[k]" (one with no prototype, which no validator can
 * convert — 500) and an array for "x[]", "x[0]" or a field sent twice, so a
 * field that is not one string is refused 400 naming it, before the route's
 * validators run — except the attachment door's lists, tags and documentIds,
 * which a client may send as repeated fields of text (the mobile app sends
 * one "tags" field per tag).
 *
 * A list with gaps is walked by the elements it holds, never by its length
 * (CERT-2, availability-7). multer builds an array from a bracketed index as
 * written: one field named "x[100000000]" is an array of length 100,000,001
 * holding one element. The walk counted to its length — 3.7 s of CPU for a
 * request of a few bytes, linear in an index the caller chooses, and on the
 * inbound e-mail door before the provider is verified (the commit before took
 * 8 ms). A JSON or query array has no gaps and is walked as before. A list
 * field with a gap ("tags[0]" and "tags[100000000]") is no repeated field of
 * text: it is refused like any other field that is not text — the route would
 * map it element by element, to its length.
 */
const NULL_CHAR = "\u0000";
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** How deeply a request body may nest objects and arrays (the body itself is level 1). */
const MAX_BODY_DEPTH = 256;

/** Keys that shadow how JavaScript converts an object to a primitive. */
const CONVERSION_KEYS = new Set(["toString", "valueOf"]);

/** Multipart fields a route reads as a list of text: the attachment door's tags and documentIds. */
const MULTIPART_LIST_FIELDS = new Set(["tags", "documentIds"]);

/**
 * Whether an array has no gaps: every index below its length holds an element
 * (and it has no other own key). Counted by its own keys — the elements
 * present — so a sparse array of any length is answered at once.
 */
const isDenseArray = (list) => Object.keys(list).length === list.length;

/** A string Postgres or the query engine cannot take: a NUL, or a lone surrogate. */
const isDisallowedString = (text) =>
  text.includes(NULL_CHAR) || (typeof text.isWellFormed === "function" ? !text.isWellFormed() : LONE_SURROGATE.test(text));

/**
 * The first problem anywhere in `root`, or null: "character" (a NUL or a lone
 * surrogate in a string or a key), "depth" (objects and arrays nested deeper
 * than `maxDepth`), "key" (an own toString / valueOf key). Iterative: any
 * depth is walked without recursion, and a too-deep value stops the walk at
 * the first level past the limit.
 */
const inspectValue = (root, { maxDepth = MAX_BODY_DEPTH, conversionKeys = true, characters = true } = {}) => {
  if (typeof root === "string") return characters && isDisallowedString(root) ? "character" : null;
  if (!root || typeof root !== "object") return null;
  // Only objects and arrays are stacked, each with its level; a string is
  // judged where it is found. A JSON body shares no object, so the walk keeps
  // no visited set when the depth is bounded (a cycle would only deepen until
  // the bound refused it); without a bound it does.
  const values = [root];
  const depths = [1];
  const seen = maxDepth === Infinity ? new Set() : null;
  while (values.length) {
    const value = values.pop();
    const depth = depths.pop();
    if (depth > maxDepth) return "depth";
    if (Buffer.isBuffer(value)) continue;
    if (seen) {
      if (seen.has(value)) continue;
      seen.add(value);
    }
    if (Array.isArray(value)) {
      // By index while the array has no gap (a JSON or query array never
      // has one); from the first gap on, by the indexes it holds (multer's
      // "x[100000000]"): never counted to a length the caller chose.
      const { length } = value;
      let index = 0;
      for (; index < length; index += 1) {
        const item = value[index];
        if (item === undefined && !(index in value)) break;
        if (typeof item === "string") {
          if (characters && isDisallowedString(item)) return "character";
        } else if (item && typeof item === "object") {
          values.push(item);
          depths.push(depth + 1);
        }
      }
      if (index < length) {
        const from = index;
        for (const key of Object.keys(value)) {
          if (Number(key) < from) continue;
          const item = value[key];
          if (typeof item === "string") {
            if (characters && isDisallowedString(item)) return "character";
          } else if (item && typeof item === "object") {
            values.push(item);
            depths.push(depth + 1);
          }
        }
      }
      continue;
    }
    for (const key of Object.keys(value)) {
      if (characters && isDisallowedString(key)) return "character";
      if (conversionKeys && CONVERSION_KEYS.has(key)) return "key";
      const item = value[key];
      if (typeof item === "string") {
        if (characters && isDisallowedString(item)) return "character";
      } else if (item && typeof item === "object") {
        values.push(item);
        depths.push(depth + 1);
      }
    }
  }
  return null;
};

/** Whether any string or object key anywhere in `root` is disallowed. No depth limit. */
const hasDisallowed = (root) => inspectValue(root, { maxDepth: Infinity, conversionKeys: false }) === "character";

/** The files multer put on the request: req.file, req.files as a list or by field. */
const uploadedFiles = (req) => {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files && typeof req.files === "object") {
    for (const list of Object.values(req.files)) if (Array.isArray(list)) files.push(...list);
  }
  return files;
};

/** What of an uploaded file is text the server keeps: its original name and its field name. */
const fileTexts = (files) => files.flatMap((file) => [file?.originalname, file?.fieldname]).filter((text) => typeof text === "string");

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

const isMultipart = (req) => /^multipart\/form-data\b/i.test(String(req.headers?.["content-type"] || ""));

/** The first multipart text field that is not one string (or, for a list field, a list of strings with no gap). */
const nonTextMultipartField = (req) => {
  if (!isMultipart(req) || !req.body || typeof req.body !== "object") return null;
  for (const key of Object.keys(req.body)) {
    const value = req.body[key];
    if (typeof value === "string") continue;
    if (MULTIPART_LIST_FIELDS.has(key) && Array.isArray(value) && isDenseArray(value) && value.every((item) => typeof item === "string")) continue;
    return key;
  }
  return null;
};

const disallowedCharacter = () =>
  new HttpError(
    400,
    "VALIDATION_ERROR",
    "The request contains a disallowed character.",
  );

const REFUSALS = {
  character: disallowedCharacter,
  depth: () => new HttpError(400, "VALIDATION_ERROR", `The request body is nested more than ${MAX_BODY_DEPTH} levels deep.`),
  key: () => new HttpError(400, "VALIDATION_ERROR", "The request contains a field named toString or valueOf, which is not allowed."),
};

/**
 * Why the request is refused, as the HttpError to answer, or null. With
 * `characters: false` the characters are not judged, only the body's shape
 * (its depth, its keys) — what the inbound e-mail door checks before it
 * verifies the provider. `multipartText: false` leaves a multipart field's
 * shape to the route (the inbound e-mail door parses its provider's form
 * itself).
 */
const requestRefusal = (req, { characters = true, multipartText = true } = {}) => {
  if (characters && urlHasNull(req)) return disallowedCharacter();
  let query = null;
  try {
    query = inspectValue(req.query, { characters });
  } catch {
    query = null;
  }
  const body = inspectValue(req.body, { characters });
  for (const found of [query, body]) if (found) return REFUSALS[found]();
  if (characters && hasDisallowed(fileTexts(uploadedFiles(req)))) return disallowedCharacter();
  const field = multipartText ? nonTextMultipartField(req) : null;
  if (field !== null) {
    return new HttpError(400, "VALIDATION_ERROR", "Validation failed", [{ field, message: "must be text", location: "body" }]);
  }
  return null;
};

/** Whether the request carries a disallowed character, or a shape refused, anywhere this guard can see. */
const requestHasDisallowed = (req) => requestRefusal(req) !== null;

const rejectNullBytes = (req, _res, next) => {
  const refusal = requestRefusal(req);
  if (refusal) {
    const files = uploadedFiles(req).filter((file) => file?.path);
    if (!files.length) return next(refusal);
    // Nothing of a refused upload is kept: multer already wrote its files.
    return Promise.all(files.map((file) => fsp.rm(file.path, { force: true }).catch(() => null))).then(() => next(refusal));
  }
  return next();
};

module.exports = {
  rejectNullBytes,
  requestRefusal,
  requestHasDisallowed,
  hasDisallowed,
  inspectValue,
  isDisallowedString,
  MAX_BODY_DEPTH,
  MULTIPART_LIST_FIELDS,
};
