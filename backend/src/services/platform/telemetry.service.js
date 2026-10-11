/**
 * The one writer for product-usage events (ProductEvent) and API error counts
 * (PlatformErrorEvent). docs/platform/OCTAPM_SUPERADMIN_DESIGN.md §5–§6.
 *
 * - Non-blocking: callers push into an in-memory buffer and return at once; a
 *   timer flushes with one createMany per table. A construction workflow never
 *   waits on telemetry and never fails because of it.
 * - Bounded: the buffer holds at most MAX_BUFFER rows per table; beyond that
 *   new rows are dropped and counted. A flush writes at most FLUSH_BATCH rows.
 * - Observable: dropped rows, failed flushes and the last failure code are kept
 *   in stats() (shown on the platform System Health page) and a failed flush
 *   logs one JSON line to stderr.
 * - Tenant scoped: every usage row carries the orgId of the request's
 *   principal; rows without one are not recorded.
 * - Off under jest unless PLATFORM_TELEMETRY_ENABLED=true; off anywhere with
 *   PLATFORM_TELEMETRY_ENABLED=false.
 */
const { prisma } = require("../../config/db");
const { CLIENT_EVENTS } = require("./product-event-catalog");

const MAX_BUFFER = 5000;
const FLUSH_BATCH = 500;
const FLUSH_INTERVAL_MS = 2000;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PLATFORMS = new Set(["web", "mobile", "api"]);

const isEnabled = (env = process.env) => {
  const flag = String(env.PLATFORM_TELEMETRY_ENABLED ?? "").trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  if (flag === "true" || flag === "1") return true;
  return env.NODE_ENV !== "test";
};

const state = {
  product: [],
  errors: [],
  timer: null,
  flushing: null,
  stats: {
    productAccepted: 0,
    productWritten: 0,
    errorAccepted: 0,
    errorWritten: 0,
    dropped: 0,
    failedFlushes: 0,
    lastFailureAt: null,
    lastFailureCode: null,
    lastFlushAt: null,
  },
};

const uuidOrNull = (value) => (typeof value === "string" && UUID.test(value) ? value : null);

const schedule = () => {
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    flush().catch(() => null);
  }, FLUSH_INTERVAL_MS);
  // Never keep a process (a script, a test) alive for telemetry.
  if (typeof state.timer.unref === "function") state.timer.unref();
};

const push = (queue, row, acceptedKey) => {
  if (queue.length >= MAX_BUFFER) {
    state.stats.dropped += 1;
    return false;
  }
  queue.push(row);
  state.stats[acceptedKey] += 1;
  schedule();
  return true;
};

/**
 * Queue one usage event. `event` must be a catalogue entry
 * ({ eventName, module, action }); everything else is an id or a fixed word.
 * Returns false when nothing was queued.
 */
const trackProductEvent = ({ orgId, projectId = null, userId = null, event, platform = "web", source = "server" } = {}) => {
  if (!isEnabled()) return false;
  const org = uuidOrNull(orgId);
  if (!org || !event || !event.eventName || !event.module || !event.action) return false;
  return push(
    state.product,
    {
      orgId: org,
      projectId: uuidOrNull(projectId),
      userId: uuidOrNull(userId),
      eventName: event.eventName,
      module: event.module,
      action: event.action,
      platform: PLATFORMS.has(platform) ? platform : "web",
      source: source === "client" ? "client" : "server",
      createdAt: new Date(),
    },
    "productAccepted",
  );
};

/** A client-reported screen open; `name` must be in CLIENT_EVENTS. */
const trackClientEvent = ({ orgId, projectId = null, userId = null, name, platform }) => {
  const entry = Object.prototype.hasOwnProperty.call(CLIENT_EVENTS, name) ? CLIENT_EVENTS[name] : null;
  if (!entry) return false;
  return trackProductEvent({
    orgId,
    projectId,
    userId,
    platform,
    source: "client",
    event: { eventName: name, module: entry.module, action: entry.action },
  });
};

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Queue one API error response: status, code, route pattern, tenant. Nothing else. */
const recordErrorEvent = ({ status, code, method, routePattern, module = null, orgId = null, requestId = null }) => {
  if (!isEnabled()) return false;
  const numeric = Number(status);
  if (!Number.isInteger(numeric) || numeric < 400 || numeric > 599) return false;
  return push(
    state.errors,
    {
      status: numeric,
      code: CODE.test(String(code || "")) ? String(code) : numeric >= 500 ? "INTERNAL_ERROR" : "UNKNOWN",
      method: String(method || "GET").toUpperCase().slice(0, 10),
      routePattern: String(routePattern || "(unmatched)").slice(0, 200),
      module: module ? String(module).slice(0, 32) : null,
      orgId: uuidOrNull(orgId),
      // A client may choose its own request id; only a UUID is kept, never text.
      requestId: uuidOrNull(requestId),
      occurredAt: new Date(),
    },
    "errorAccepted",
  );
};

const writeBatch = async (queue, model, writtenKey) => {
  if (!queue.length) return;
  const batch = queue.splice(0, FLUSH_BATCH);
  try {
    await prisma[model].createMany({ data: batch });
    state.stats[writtenKey] += batch.length;
  } catch (error) {
    // The batch is not retried: telemetry must never pile up behind a broken
    // database. The loss is counted and shown on the health page.
    state.stats.dropped += batch.length;
    state.stats.failedFlushes += 1;
    state.stats.lastFailureAt = new Date().toISOString();
    state.stats.lastFailureCode = typeof error?.code === "string" ? error.code.slice(0, 32) : "UNKNOWN";
    process.stderr.write(
      `${JSON.stringify({ ts: state.stats.lastFailureAt, level: "error", msg: "platform_telemetry_flush_failed", model, rows: batch.length, code: state.stats.lastFailureCode })}\n`,
    );
  }
};

/** Write what is buffered (one batch per table per call). Safe to call concurrently. */
const flush = async () => {
  if (state.flushing) return state.flushing;
  state.flushing = (async () => {
    await writeBatch(state.product, "productEvent", "productWritten");
    await writeBatch(state.errors, "platformErrorEvent", "errorWritten");
    state.stats.lastFlushAt = new Date().toISOString();
  })().finally(() => {
    state.flushing = null;
    if (state.product.length || state.errors.length) schedule();
  });
  return state.flushing;
};

/** Flush until empty (shutdown, tests). Each flush removes its batch, written or not. */
const drain = async () => {
  if (state.flushing) await state.flushing;
  while (state.product.length || state.errors.length) {
    // eslint-disable-next-line no-await-in-loop
    await flush();
  }
};

const stats = () => ({
  enabled: isEnabled(),
  buffered: { product: state.product.length, errors: state.errors.length },
  maxBuffer: MAX_BUFFER,
  ...state.stats,
});

const resetForTests = () => {
  state.product.length = 0;
  state.errors.length = 0;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  for (const key of Object.keys(state.stats)) state.stats[key] = typeof state.stats[key] === "number" ? 0 : null;
};

module.exports = {
  FLUSH_BATCH,
  MAX_BUFFER,
  drain,
  flush,
  isEnabled,
  recordErrorEvent,
  resetForTests,
  stats,
  trackClientEvent,
  trackProductEvent,
};
