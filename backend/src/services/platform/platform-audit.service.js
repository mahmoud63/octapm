/**
 * The platform-admin audit trail (PlatformAuditEvent): one row per request to
 * /api/v1/platform-admin, reads included, plus one per refused attempt.
 *
 * Kept apart from AuditEvent on purpose: that trail is org-scoped and read by
 * customers; this one is OctaPM's record of what its own staff looked at.
 * Stored: actor, action, target, method, redacted path, query parameter NAMES,
 * status, request id, time. Never query values (a search term may be a
 * customer's name) and never response content.
 */
const { prisma } = require("../../config/db");
const { queryKeys, redactPath } = require("../../middleware/request-log");

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

const row = ({ actor, action, target = {}, req, statusCode }) => ({
  actorUserId: actor.userId,
  actorEmail: actor.email || "",
  actorRole: actor.role || "none",
  action: String(action).slice(0, 80),
  targetType: target.type || null,
  targetId: target.id && UUID.test(target.id) ? target.id : null,
  targetOrgId: target.orgId && UUID.test(target.orgId) ? target.orgId : null,
  method: req.method,
  path: redactPath(req.originalUrl).slice(0, 300),
  queryKeys: queryKeys(req.originalUrl),
  statusCode,
  requestId: typeof req.id === "string" ? req.id.slice(0, 64) : null,
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

/** A refused attempt (no platform access, MFA missing). Best effort, never blocks the refusal. */
const recordDenied = ({ userId, email, reason, req }) =>
  prisma.platformAuditEvent
    .create({
      data: row({
        actor: { userId, email, role: "none" },
        action: `platform.access_denied.${String(reason).toLowerCase()}`,
        req,
        statusCode: 403,
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
