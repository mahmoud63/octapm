/**
 * The product-usage event catalogue: the ONLY event names, modules and actions
 * a ProductEvent row may carry (docs/platform/OCTAPM_SUPERADMIN_DESIGN.md §5).
 *
 * Privacy rule: an event records WHAT happened — a catalogue word, the tenant,
 * the project and the person's id — never the customer's content. There is no
 * metadata field to put content in, and the database CHECKs refuse anything
 * that is not a lower-case dotted word.
 *
 * Two sources:
 * - SERVER_EVENT_RULES: a successful (2xx) API response whose method + path
 *   match a rule. Recorded by middleware/platform-telemetry.js from the
 *   response, so no route handler or service is edited and a failed request
 *   never counts.
 * - CLIENT_EVENTS: "a screen was opened", which only the client knows. Sent in
 *   batches to POST /api/v1/telemetry/events and accepted only if the name is
 *   in this list.
 */

const MODULES = Object.freeze([
  "projects", "boq", "schedule", "mapping", "progress", "daily_reports", "daily_logs",
  "rfi", "submittals", "changes", "cost", "commercial", "procurement", "inventory",
  "quality", "safety", "documents", "drawings", "reports", "search", "dashboard",
  "tasks", "meetings", "punch", "company_admin",
]);

// A path is matched after `/api/v1` is removed and every UUID / date / number
// segment is replaced with `:id` (normalisePath below).
const SERVER_EVENT_RULES = Object.freeze([
  { method: "POST", pattern: /^\/projects$/, eventName: "project.created", module: "projects", action: "created" },
  { method: "POST", pattern: /^\/projects\/:id\/boq\/upload$/, eventName: "boq.imported", module: "boq", action: "imported" },
  { method: "POST", pattern: /^\/projects\/:id\/boq\/revisions\/:id\/approve$/, eventName: "boq.revision_approved", module: "boq", action: "approved" },
  { method: "POST", pattern: /^\/projects\/:id\/import\/(xer|p6xml|msp|xlsx)$/, eventName: "schedule.imported", module: "schedule", action: "imported" },
  { method: "POST", pattern: /^\/projects\/:id\/schedule\/generate$/, eventName: "schedule.generated", module: "schedule", action: "generated" },
  { method: "POST", pattern: /^\/projects\/:id\/schedule\/(baseline|revisions\/:id\/baseline)$/, eventName: "schedule.baseline_locked", module: "schedule", action: "baseline_locked" },
  { method: "POST", pattern: /^\/projects\/:id\/activity-boq-allocations\/import$/, eventName: "mapping.imported", module: "mapping", action: "imported" },
  { method: "POST", pattern: /^\/projects\/:id\/activity-boq-allocations\/:id\/approve$/, eventName: "mapping.approved", module: "mapping", action: "approved" },
  { method: "POST", pattern: /^\/projects\/:id\/activities\/:id\/progress$/, eventName: "progress.submitted", module: "progress", action: "submitted" },
  { method: "POST", pattern: /^\/projects\/:id\/quantity-progress$/, eventName: "progress.quantity_recorded", module: "progress", action: "recorded" },
  { method: "POST", pattern: /^\/projects\/:id\/activities\/:id\/progress-submissions\/:id\/approve$/, eventName: "progress.approved", module: "progress", action: "approved" },
  { method: "POST", pattern: /^\/projects\/:id\/import\/progress$/, eventName: "progress.imported", module: "progress", action: "imported" },
  { method: "POST", pattern: /^\/projects\/:id\/daily-reports$/, eventName: "daily_report.created", module: "daily_reports", action: "created" },
  { method: "POST", pattern: /^\/projects\/:id\/daily-reports\/:id\/approve$/, eventName: "daily_report.approved", module: "daily_reports", action: "approved" },
  { method: "POST", pattern: /^\/projects\/:id\/daily-logs\/:id\/submit$/, eventName: "daily_log.submitted", module: "daily_logs", action: "submitted" },
  { method: "POST", pattern: /^\/projects\/:id\/daily-logs\/:id\/approve$/, eventName: "daily_log.approved", module: "daily_logs", action: "approved" },
  { method: "POST", pattern: /^\/projects\/:id\/rfi$/, eventName: "rfi.created", module: "rfi", action: "created" },
  { method: "POST", pattern: /^\/projects\/:id\/rfi\/:id\/submit$/, eventName: "rfi.submitted", module: "rfi", action: "submitted" },
  { method: "POST", pattern: /^\/projects\/:id\/rfi\/:id\/answer$/, eventName: "rfi.answered", module: "rfi", action: "answered" },
  { method: "POST", pattern: /^\/projects\/:id\/rfi\/:id\/close$/, eventName: "rfi.closed", module: "rfi", action: "closed" },
  { method: "POST", pattern: /^\/projects\/:id\/submittals$/, eventName: "submittal.created", module: "submittals", action: "created" },
  { method: "POST", pattern: /^\/projects\/:id\/change-events$/, eventName: "change_event.created", module: "changes", action: "created" },
  { method: "POST", pattern: /^\/projects\/:id\/change-orders$/, eventName: "change_order.created", module: "changes", action: "created" },
  { method: "POST", pattern: /^\/projects\/:id\/ncr$/, eventName: "ncr.created", module: "quality", action: "created" },
  { method: "POST", pattern: /^\/projects\/:id\/punch$/, eventName: "punch.created", module: "punch", action: "created" },
  { method: "POST", pattern: /^\/inventory\/(stock\/receive|goods-receipt|transfers\/:id\/receive)$/, eventName: "inventory.received", module: "inventory", action: "received" },
  { method: "POST", pattern: /^\/inventory\/stock\/issue$/, eventName: "inventory.issued", module: "inventory", action: "issued" },
  { method: "POST", pattern: /^\/reports\/export$/, eventName: "report.generated", module: "reports", action: "generated" },
  // Every document/spreadsheet export (`…/export.pdf`, `…/export.xlsx`, `/export/xlsx`,
  // `/export/schedule/:format`) except the accounting-integration feed, which is a sync.
  { method: "GET", pattern: /^\/(?!integrations\/|projects\/:id\/accounting\/)(?:[a-z0-9._:-]+\/)*export(?:\.(?:pdf|xlsx|csv)|(?:\/[a-z0-9]+){1,2})$/,eventName: "report.generated", module: "reports", action: "generated" },
  { method: "GET", pattern: /^\/search$/, eventName: "search.executed", module: "search", action: "executed" },
]);

// Screens the web and mobile clients report as opened. `<module>.opened`.
const CLIENT_EVENTS = Object.freeze(
  Object.fromEntries(
    [
      "projects", "boq", "schedule", "mapping", "progress", "daily_reports", "daily_logs", "rfi",
      "submittals", "changes", "cost", "commercial", "procurement", "inventory", "quality", "safety",
      "documents", "drawings", "reports", "dashboard", "tasks", "meetings", "punch", "company_admin",
    ].map((module) => [`${module}.opened`, { module, action: "opened" }]),
  ),
);

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d+$/;
const WORD = /^[a-z][a-z0-9._-]{0,39}$/i;

/**
 * `/api/v1/projects/<uuid>/rfi/<uuid>/close?x=1` → `/projects/:id/rfi/:id/close`.
 * Any segment that is not a plain route word (an id, a date, a number, a token,
 * free text a client put in a URL) becomes `:id`, so no customer string can
 * reach a stored pattern.
 */
const normalisePath = (originalUrl) => {
  const pathOnly = String(originalUrl || "").split("?")[0].split("#")[0].replace(/^\/api\/v1/, "");
  const segments = pathOnly.split("/").filter(Boolean).map((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return ":id";
    }
    if (UUID.test(decoded) || DATE.test(decoded) || NUMBER.test(decoded) || !WORD.test(decoded)) return ":id";
    return decoded.toLowerCase();
  });
  return `/${segments.join("/")}`.slice(0, 200);
};

/** The API area a path belongs to: `/projects/:id/rfi/...` → `rfi`; `/inventory/...` → `inventory`. */
const moduleOfPath = (normalised) => {
  const segments = normalised.split("/").filter(Boolean);
  const area = segments[0] === "projects" && segments[1] === ":id" && segments[2] ? segments[2] : segments[0];
  return area && area !== ":id" ? area.slice(0, 32) : null;
};

const matchServerEvent = (method, normalised) =>
  SERVER_EVENT_RULES.find((rule) => rule.method === method && rule.pattern.test(normalised)) || null;

const SERVER_EVENT_NAMES = Object.freeze([...new Set(SERVER_EVENT_RULES.map((r) => r.eventName))]);

module.exports = {
  CLIENT_EVENTS,
  MODULES,
  SERVER_EVENT_NAMES,
  SERVER_EVENT_RULES,
  matchServerEvent,
  moduleOfPath,
  normalisePath,
};
