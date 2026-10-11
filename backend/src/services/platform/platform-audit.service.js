/**
 * The platform-admin audit trail (PlatformAuditEvent): one row per request to
 * /api/v1/platform-admin, reads included, plus one per refused attempt.
 *
 * Kept apart from AuditEvent on purpose: that trail is org-scoped and read by
 * customers; this one is OctaPM's record of what its own staff looked at.
 * Stored: actor, action, target, method, the route pattern (every segment that
 * is not a documented route word becomes `:id`), the NAMES of recognised query
 * parameters, status, request id (UUIDs only), time. Never query values or
 * unrecognised query names (either may be a customer's text), never response
 * content (pre-merge review CX-1).
 */
const { prisma } = require("../../config/db");
const { queryKeys } = require("../../middleware/request-log");
const { normalisePath } = require("./product-event-catalog");

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// Every query parameter the platform-admin routes accept (routes/platform-admin.js).
const KNOWN_QUERY_KEYS = new Set([
  "page", "pageSize", "q", "sort", "plan", "subscriptionStatus", "status", "kind", "activity", "size",
  "createdFrom", "createdTo", "orgId", "multiCompany", "lastLogin", "paymentIssue", "trialEndingDays",
  "windowDays", "actorUserId", "targetOrgId", "action", "days",
]);
const auditQueryKeys = (originalUrl) => {
  const keys = queryKeys(originalUrl);
  const known = keys.filter((k) => KNOWN_QUERY_KEYS.has(k));
  return known.length === keys.length ? known : [...known, "(unrecognised)"];
};

const row = ({ actor, action, target = {}, req, statusCode }) => ({
  actorUserId: actor.userId,
  actorEmail: actor.email || "",
  actorRole: actor.role || "none",
  action: String(action).slice(0, 80),
  targetType: target.type || null,
  targetId: target.id && UUID.test(target.id) ? target.id : null,
  targetOrgId: target.orgId && UUID.test(target.orgId) ? target.orgId : null,
  method: req.method,
  path: `/api/v1${normalisePath(req.originalUrl)}`.slice(0, 300),
  queryKeys: auditQueryKeys(req.originalUrl),
  statusCode,
  requestId: typeof req.id === "string" && UUID.test(req.id) ? req.id : null,
});

/**
 * Written BEFORE the handler runs and awaited: if the trail cannot be written
 * the request is refused (fail closed). statusCode 0 = in progress; the final
 * status is filled in when the response finishes.
 */
const openEntry = async ({ actor, action, target, req }) =>
  prisma.platformAuditEvent.create({ data: row({ actor, action, target, req, statusCode: 0 }), select: { id: true } });

const closeEntry = (id, { statusCode, target } = {}) => {
  const data = { statusCode };
  if (target?.orgId && UUID.test(target.orgId)) data.targetOrgId = target.orgId;
  return prisma.platformAuditEvent
    .update({ where: { id }, data })
    .catch((error) => logFailure("close", error));
};

/**
 * A refused attempt by a verified token subject (no platform access, MFA
 * missing, account inactive — 401 for the last). Best effort, never blocks the
 * refusal.
 */
const recordDenied = ({ userId, email, reason, req, statusCode = 403 }) =>
  prisma.platformAuditEvent
    .create({
      data: row({
        actor: { userId, email, role: "none" },
        action: `platform.access_denied.${String(reason).toLowerCase()}`,
        req,
        statusCode,
      }),
    })
    .catch((error) => logFailure("denied", error));

const logFailure = (stage, error) => {
  process.stderr.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "platform_audit_write_failed", stage, code: typeof error?.code === "string" ? error.code : null })}\n`,
  );
  return null;
};

/** Paged list for the Audit page (newest first). */
const listAuditEvents = async ({ page, pageSize, actorUserId, targetOrgId, action, from, to }) => {
  const where = {
    ...(actorUserId ? { actorUserId } : {}),
    ...(targetOrgId ? { targetOrgId } : {}),
    ...(action ? { action: { startsWith: action } } : {}),
    occurredAt: { gte: from, lte: to },
  };
  const [total, rows] = await Promise.all([
    prisma.platformAuditEvent.count({ where }),
    prisma.platformAuditEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, rows };
};

module.exports = { closeEntry, listAuditEvents, openEntry, recordDenied };
