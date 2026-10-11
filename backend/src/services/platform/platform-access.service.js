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
 * How long a session's second-factor proof opens the platform console:
 * PLATFORM_ADMIN_SESSION_MAX_HOURS, 1 to 24, default 12. A longer-lived
 * refresh session of the customer application keeps working there; the
 * console asks for the code again.
 */
const platformSessionMaxSeconds = (env = process.env) => {
  const hours = Number.parseInt(String(env.PLATFORM_ADMIN_SESSION_MAX_HOURS ?? ""), 10);
  return (Number.isInteger(hours) && hours >= 1 && hours <= 24 ? hours : 12) * 3600;
};

/**
 * The platform principal for a user id, or a refusal reason.
 *
 * With `session` (the verified token's claims, as the console's gate passes
 * them) the session itself is held too, not only the account:
 *   - minted before the identity's last credential event → SESSION_REVOKED;
 *   - where MFA is required, the session must have proven a second factor
 *     (token claim `mfa`) within platformSessionMaxSeconds → MFA_SESSION_REQUIRED.
 * A session from the customer application's password-only sign-in, a
 * company's single sign-on or an invitation acceptance never carries that
 * proof, so being signed in to app.octapm.com is never enough for
 * admin.octapm.com. Without `session` only the account is described (the
 * profile's "is a platform operator" flag).
 *
 * @returns {Promise<{ ok: true, principal: object } | { ok: false, reason: 'USER_INACTIVE'|'NO_ACCESS'|'MFA_REQUIRED'|'SESSION_REVOKED'|'MFA_SESSION_REQUIRED' }>}
 */
const resolvePlatformPrincipal = async (userId, { tx = prisma, env = process.env, session = null, now = Date.now() } = {}) => {
  if (typeof userId !== "string" || !userId) return { ok: false, reason: "NO_ACCESS" };
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      mfaEnabled: true,
      credentialEpoch: true,
      platformAccess: { select: { role: true, status: true, revokedAt: true } },
    },
  });
  if (!user || user.status !== "active") return { ok: false, reason: "USER_INACTIVE", user };
  const access = user.platformAccess;
  if (!access || access.status !== "active" || access.revokedAt || !KNOWN_ROLES.has(access.role)) {
    return { ok: false, reason: "NO_ACCESS", user };
  }
  if (platformMfaRequired(env) && !user.mfaEnabled) return { ok: false, reason: "MFA_REQUIRED", user };
  if (session) {
    const stored = Number.isInteger(user.credentialEpoch) ? user.credentialEpoch : 0;
    const presented = Number.isInteger(session.epoch) ? session.epoch : 0;
    if (presented !== stored) return { ok: false, reason: "SESSION_REVOKED", user };
    if (platformMfaRequired(env)) {
      const provenAt = Number.isInteger(session.mfaAt) ? session.mfaAt : null;
      const age = provenAt ? Math.floor(now / 1000) - provenAt : Infinity;
      if (!(age >= -60 && age <= platformSessionMaxSeconds(env))) {
        return { ok: false, reason: "MFA_SESSION_REQUIRED", user };
      }
    }
  }
  return {
    ok: true,
    principal: { userId: user.id, email: user.email, name: user.name, role: access.role },
  };
};

module.exports = { KNOWN_ROLES, PLATFORM_ROLES, platformMfaRequired, platformSessionMaxSeconds, resolvePlatformPrincipal };
