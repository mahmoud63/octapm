/**
 * Records, when a /api/v1 response finishes:
 * - an API error count (PlatformErrorEvent) for every 4xx/5xx except an
 *   expired access token (the normal refresh cycle, not a fault);
 * - a product-usage event (ProductEvent) for a 2xx response whose method and
 *   path are in the catalogue (services/platform/product-event-catalog.js).
 *
 * Nothing from the request or response body is read. The stored route is the
 * normalised path (ids, dates, numbers and any non-word segment → `:id`), the
 * tenant and person come from the authenticated principal, and the write is
 * queued in the telemetry buffer — this middleware never delays or fails a
 * response.
 */
const telemetry = require("../services/platform/telemetry.service");
const { matchServerEvent, moduleOfPath, normalisePath } = require("../services/platform/product-event-catalog");

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const IGNORED_ERROR_CODES = new Set(["TOKEN_EXPIRED"]);
// The console's own traffic and the telemetry intake are not product usage.
const NOT_PRODUCT = /^\/(platform-admin|telemetry)(\/|$)/;

const platformOf = (req) => {
  if (req.apiClient) return "api";
  return String(req.headers["x-octapm-client"] || "").toLowerCase() === "mobile" ? "mobile" : "web";
};

const projectIdOf = (originalUrl) => {
  const segments = String(originalUrl || "").split("?")[0].split("/");
  const index = segments.indexOf("projects");
  const candidate = index >= 0 ? segments[index + 1] : null;
  return candidate && UUID.test(candidate) ? candidate : null;
};

const recordOutcome = (req, res) => {
  const status = res.statusCode;
  const normalised = normalisePath(req.originalUrl);
  const principal = req.user || null;

  if (status >= 400) {
    const code = res.locals?.errorCode || null;
    if (IGNORED_ERROR_CODES.has(code)) return;
    // A refusal by router-level middleware (authentication, a gate) happens
    // before Express matches a route, so req.route is unset; only a 404 that
    // no route claimed is "(unmatched)". The normalised path holds route words
    // only, so recording it is safe either way.
    const unmatched = !req.route && status === 404;
    telemetry.recordErrorEvent({
      status,
      code,
      method: req.method,
      routePattern: unmatched ? "(unmatched)" : normalised,
      module: unmatched ? null : moduleOfPath(normalised),
      orgId: principal?.orgId || null,
      requestId: req.id || null,
    });
    return;
  }

  if (status < 200 || status >= 300 || NOT_PRODUCT.test(normalised) || !principal?.orgId) return;
  const event = matchServerEvent(req.method, normalised);
  if (!event) return;
  telemetry.trackProductEvent({
    orgId: principal.orgId,
    userId: principal.id,
    projectId: projectIdOf(req.originalUrl),
    event,
    platform: platformOf(req),
    source: "server",
  });
};

const platformTelemetry = (req, res, next) => {
  if (!telemetry.isEnabled()) return next();
  res.once("finish", () => {
    try {
      recordOutcome(req, res);
    } catch {
      // Telemetry must never surface as a request failure.
    }
  });
  return next();
};

module.exports = { platformTelemetry, platformOf, projectIdOf, recordOutcome };
