/**
 * The production request log: one JSON line per request on stdout.
 *
 * morgan('dev') prints the full URL in colour. On CloudWatch that means ANSI
 * noise, no request id to find a support ticket's line, and — worse — every
 * secret that travels in a URL: vendor portal tokens (/public/bids/:token,
 * /public/rfqs/:token), invitation tokens, OAuth `code` and `state`, the
 * inbound webhook's `?token=`. This logger writes the path with those segments
 * masked and only the *names* of query parameters, never their values.
 *
 * REQUEST_LOG_FORMAT picks the logger: `json` (the production default), `dev`
 * (morgan, as local development always had) or `off` (the default under jest).
 */

const REQUEST_LOG_FORMATS = Object.freeze(["json", "dev", "off"]);

const HEALTH_PATHS = new Set(["/api/health", "/api/health/live", "/api/health/ready"]);

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
// A long run of token characters that also has a digit, a capital or an
// underscore: base64url and hex tokens always do, and route names — lower-case
// words joined by hyphens — never do, so the backstop masks the first without
// hiding the second.
const TOKEN_LIKE = /^[A-Za-z0-9_.~-]{20,}$/;
const looksLikeToken = (segment) =>
  TOKEN_LIKE.test(segment) && !UUID.test(segment) && /[0-9A-Z_]/.test(segment);

/**
 * `originalUrl` without its query and with secret-bearing segments masked.
 *
 * The named routes are masked by position, so even a short token is caught;
 * the backstop masks any other segment that looks like a token, so a route
 * added later is covered without anyone remembering this file. UUIDs are kept:
 * they are the record ids a support engineer needs.
 */
const redactPath = (originalUrl) => {
  const pathOnly = String(originalUrl || "").split("?")[0].split("#")[0];
  const segments = pathOnly.split("/");
  return segments
    .map((segment, index) => {
      const previous = segments[index - 1];
      const beforePrevious = segments[index - 2];
      if (beforePrevious === "public" && (previous === "bids" || previous === "rfqs") && segment) {
        return ":token";
      }
      if (beforePrevious === "auth" && previous === "invitations" && segment && segment !== "accept") {
        return ":token";
      }
      return looksLikeToken(segment) ? ":redacted" : segment;
    })
    .join("/");
};

/** The sorted names of the query parameters, never their values. */
const queryKeys = (originalUrl) => {
  const url = String(originalUrl || "");
  const index = url.indexOf("?");
  if (index === -1) return [];
  const keys = new Set();
  for (const key of new URLSearchParams(url.slice(index + 1).split("#")[0]).keys()) {
    // A bare `?<token>` puts the secret in the key's place.
    keys.add(looksLikeToken(key) || key.length > 64 ? ":redacted" : key);
  }
  return [...keys].sort();
};

const resolveRequestLogFormat = (env = process.env) => {
  const requested = String(env.REQUEST_LOG_FORMAT ?? "").trim().toLowerCase();
  if (REQUEST_LOG_FORMATS.includes(requested)) return requested;
  if (env.NODE_ENV === "production") return "json";
  if (env.NODE_ENV === "test") return "off";
  return "dev";
};

const levelFor = (status) => (status >= 500 ? "error" : status >= 400 ? "warn" : "info");

const requestLog = (req, res, next) => {
  const started = process.hrtime.bigint();
  let written = false;

  const write = () => {
    if (written) return;
    written = true;

    const status = res.statusCode;
    const path = redactPath(req.originalUrl);
    // Load-balancer health checks arrive every few seconds from every target
    // group; a healthy one is not worth a line. A failing one still is.
    if (req.method === "GET" && HEALTH_PATHS.has(path.replace(/\/+$/, "")) && status < 400) return;

    const length = Number(res.getHeader("content-length"));
    const line = {
      ts: new Date().toISOString(),
      level: levelFor(status),
      msg: "request",
      requestId: req.id || null,
      method: req.method,
      path,
      queryKeys: queryKeys(req.originalUrl),
      status,
      durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10,
      userId: req.user?.id || null,
      orgId: req.user?.orgId || null,
      apiClientId: req.apiClient?.id || null,
      ip: req.ip || null,
      bytes: Number.isFinite(length) ? length : null,
    };
    if (res.locals?.errorCode) line.code = res.locals.errorCode;
    // A client that hung up before the response finished is worth knowing.
    if (!res.writableFinished) line.aborted = true;

    process.stdout.write(`${JSON.stringify(line)}\n`);
  };

  res.once("finish", write);
  res.once("close", write);
  next();
};

module.exports = {
  HEALTH_PATHS,
  REQUEST_LOG_FORMATS,
  queryKeys,
  redactPath,
  requestLog,
  resolveRequestLogFormat,
};
