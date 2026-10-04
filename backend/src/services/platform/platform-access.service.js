/**
 * Platform access: who is an OctaPM platform operator.
 *
 * Separate from every organisation concept on purpose: a membership role, a
 * company admin flag, an owner flag or a catalogue permission never grants
 * it. The only source is an active PlatformUserAccess row for an active User,
 * and the only writer is scripts/platform/platform-access.js (there is no API).
 */
const { prisma } = require("../../config/db");

const PLATFORM_ROLES = Object.freeze({ SUPERADMIN: "platform_superadmin" });
const KNOWN_ROLES = new Set(Object.values(PLATFORM_ROLES));

/**
 * MFA is required for platform access everywhere unless
 * PLATFORM_ADMIN_REQUIRE_MFA=false — and that opt-out is ignored in
 * production (NODE_ENV or APP_ENV), so a misconfigured production task fails
 * closed.
 */
const platformMfaRequired = (env = process.env) => {
  const production = env.NODE_ENV === "production" || String(env.APP_ENV || "").toLowerCase() === "production";
  if (production) return true;
  return String(env.PLATFORM_ADMIN_REQUIRE_MFA ?? "").trim().toLowerCase() !== "false";
};

/**
 * The platform principal for a user id, or a refusal reason.
 * @returns {Promise<{ ok: true, principal: object } | { ok: false, reason: 'USER_INACTIVE'|'NO_ACCESS'|'MFA_REQUIRED' }>}
 */
const resolvePlatformPrincipal = async (userId, { tx = prisma, env = process.env } = {}) => {
  if (typeof userId !== "string" || !userId) return { ok: false, reason: "NO_ACCESS" };
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      mfaEnabled: true,
      platformAccess: { select: { role: true, status: true, revokedAt: true } },
    },
  });
  if (!user || user.status !== "active") return { ok: false, reason: "USER_INACTIVE", user };
  const access = user.platformAccess;
  if (!access || access.status !== "active" || access.revokedAt || !KNOWN_ROLES.has(access.role)) {
    return { ok: false, reason: "NO_ACCESS", user };
  }
  if (platformMfaRequired(env) && !user.mfaEnabled) return { ok: false, reason: "MFA_REQUIRED", user };
  return {
    ok: true,
    principal: { userId: user.id, email: user.email, name: user.name, role: access.role },
  };
};

module.exports = { KNOWN_ROLES, PLATFORM_ROLES, platformMfaRequired, resolvePlatformPrincipal };
