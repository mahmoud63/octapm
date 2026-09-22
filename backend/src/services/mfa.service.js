const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { generateSecret, verifyTotp, otpauthUrl } = require("../utils/totp");
const { qrToSvg } = require("../utils/qr");
const authAbuseService = require("./auth-abuse.service");
const { keyring } = require("../utils/keyring");

/**
 * Two-factor authentication (OCTA-SEC-AUTH-040): TOTP with an authenticator
 * app, ten single-use backup codes, an organisation-wide requirement, and
 * a short-lived challenge token between the password and the code at login.
 * Secrets are stored encrypted (AES-256-GCM) under MFA_SECRET_KEY, and still
 * open under MFA_SECRET_KEY_PREVIOUS during a rotation; backup codes are
 * stored hashed. Outside production the key falls back to the variables it
 * was once derived from (INTEGRATION_SECRET_KEY, then JWT_SECRET), so local
 * enrolments keep working — production never derives it from a JWT secret.
 */

const BACKUP_CODE_COUNT = 10;
const CHALLENGE_EXPIRY = "5m";
const ISSUER = () => process.env.MFA_ISSUER || process.env.APP_NAME || "OctaPM";

const mfaKeys = () => keyring({ primary: "MFA_SECRET_KEY", previous: "MFA_SECRET_KEY_PREVIOUS", legacy: ["INTEGRATION_SECRET_KEY", "JWT_SECRET"] });
const derive = (source) => crypto.createHash("sha256").update(String(source)).digest();
const seal = (value) => {
  const { write } = mfaKeys();
  if (!write) throw new HttpError(500, "CONFIG_ERROR", "Missing environment variable: MFA_SECRET_KEY");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", derive(write), iv);
  const payload = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${payload.toString("base64url")}`;
};
/**
 * Opens a sealed value with whichever key authenticates it. GCM rejects a
 * wrong key outright, so trying each in turn cannot produce a false match.
 * Returns null — never throws — when nothing opens it: an unreadable seed
 * must fail the code check, not the whole request, so backup codes still work.
 * `stale` says the value opened under a key other than the current one.
 */
const unseal = (text) => {
  if (!text) return null;
  const [version, iv, tag, payload] = String(text).split(".");
  if (version !== "v1" || !iv || !tag || !payload) return null;
  const { write, read } = mfaKeys();
  for (const key of read) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", derive(key), Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const value = Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
      return { value, stale: key !== write };
    } catch {
      // Not this key; try the next.
    }
  }
  return null;
};
const open = (text) => unseal(text)?.value ?? null;

const hashCode = (code) => crypto.createHash("sha256").update(String(code).toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
const newBackupCodes = () => Array.from({ length: BACKUP_CODE_COUNT }, () => {
  const raw = crypto.randomBytes(5).toString("hex").slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
});
const backupRows = (user) => (Array.isArray(user.mfaBackupCodesJson) ? user.mfaBackupCodesJson : []);
const remainingBackupCodes = (user) => backupRows(user).filter((row) => !row.usedAt).length;

const audit = async ({ orgId, userId, actorId = null, action, metadata = {}, context = {} }) => {
  if (!prisma.authAuditEvent?.create) return null;
  return prisma.authAuditEvent.create({ data: { orgId, userId, actorId: actorId || userId, entityType: "user", entityId: userId, action, ipAddress: context.ipAddress || null, userAgent: context.userAgent || null, metadataJson: metadata } }).catch(() => null);
};

const loadUser = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { org: { select: { id: true, name: true, mfaRequired: true } } } });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  return user;
};

// ─── Status and enrolment ─────────────────────────────────────────────────

const status = async ({ userId }) => {
  const user = await loadUser(userId);
  return { enabled: Boolean(user.mfaEnabled), enrolledAt: user.mfaEnrolledAt ? user.mfaEnrolledAt.toISOString() : null, backupCodesRemaining: user.mfaEnabled ? remainingBackupCodes(user) : 0, pending: Boolean(user.mfaPendingSecretEnc) && !user.mfaEnabled, required: Boolean(user.org?.mfaRequired), enrollmentRequired: Boolean(user.org?.mfaRequired) && !user.mfaEnabled, ssoLinked: Boolean(user.ssoSubject) };
};

/** Creates a fresh secret and returns what the authenticator app needs (the secret is not stored in the clear). */
const beginEnrollment = async ({ userId }) => {
  const user = await loadUser(userId);
  // An enabled factor is not replaced by enrolling another: turning it off
  // takes the password and a current code, and only then can a new device
  // be enrolled (Phase 21D, CX21-429).
  if (user.mfaEnabled) throw new HttpError(409, "MFA_ALREADY_ENABLED", "Two-factor is already on; turn it off with your password and a current code before enrolling a new device");
  const secret = generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaPendingSecretEnc: seal(secret) } });
  const url = otpauthUrl({ issuer: ISSUER(), account: user.email, secret });
  return { secret, otpauthUrl: url, qrSvg: qrToSvg(url, { moduleSize: 5, quietZone: 3 }), issuer: ISSUER(), account: user.email };
};

/** Confirms the enrolment with a code from the app; returns the backup codes once. */
const enable = async ({ userId, code, context = {} }) => {
  const user = await loadUser(userId);
  const pending = unseal(user.mfaPendingSecretEnc);
  if (!pending) throw new HttpError(409, "MFA_NOT_PENDING", "Start the setup first to get a QR code");
  if (!verifyTotp(pending.value, code)) throw new HttpError(400, "MFA_CODE_INVALID", "That code is not valid — check the time on your device and try the next code");
  const codes = newBackupCodes();
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true, mfaSecretEnc: pending.stale ? seal(pending.value) : user.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaEnrolledAt: new Date(), mfaBackupCodesJson: codes.map((value) => ({ hash: hashCode(value), usedAt: null })) } });
  await audit({ orgId: user.orgId, userId, action: "mfa.enabled", context });
  return { enabled: true, backupCodes: codes };
};

/** Checks a TOTP code or consumes a backup code. */
const verifyCode = async ({ user, code }) => {
  const clean = String(code || "").trim();
  if (!clean) return false;
  const opened = unseal(user.mfaSecretEnc);
  if (opened && verifyTotp(opened.value, clean)) {
    await resealIfStale(user, opened);
    return true;
  }
  const rows = backupRows(user);
  const hash = hashCode(clean);
  const index = rows.findIndex((row) => !row.usedAt && row.hash === hash);
  if (index < 0) return false;
  rows[index] = { ...rows[index], usedAt: new Date().toISOString() };
  await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodesJson: rows } });
  await resealIfStale(user, opened);
  return true;
};

/**
 * A seed that only opened under MFA_SECRET_KEY_PREVIOUS (or a local legacy
 * key) is sealed again under the current key the first time it proves
 * itself, so PREVIOUS can be retired once everyone has signed in. The write is
 * conditional on the stored value being the one just read, so it can never
 * resurrect a seed that a concurrent disable or admin reset has cleared.
 */
const resealIfStale = async (user, opened) => {
  if (!opened?.stale) return;
  await prisma.user.updateMany({ where: { id: user.id, mfaSecretEnc: user.mfaSecretEnc }, data: { mfaSecretEnc: seal(opened.value) } });
};

const disable = async ({ userId, password, code, context = {} }) => {
  const user = await loadUser(userId);
  if (!user.mfaEnabled) throw new HttpError(409, "MFA_NOT_ENABLED", "Two-factor authentication is not enabled");
  if (!password || !(await bcrypt.compare(String(password), user.passwordHash))) throw new HttpError(401, "INVALID_CREDENTIALS", "Password is incorrect");
  if (!(await verifyCode({ user, code }))) throw new HttpError(400, "MFA_CODE_INVALID", "That code is not valid");
  if (user.org?.mfaRequired && !user.isCompanyAdmin) throw new HttpError(403, "MFA_REQUIRED_BY_ORG", "Your organisation requires two-factor authentication; ask a company admin to reset it instead");
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnrolledAt: null, mfaBackupCodesJson: [] } });
  await audit({ orgId: user.orgId, userId, action: "mfa.disabled", context });
  return { enabled: false };
};

const regenerateBackupCodes = async ({ userId, code, context = {} }) => {
  const user = await loadUser(userId);
  if (!user.mfaEnabled) throw new HttpError(409, "MFA_NOT_ENABLED", "Two-factor authentication is not enabled");
  const secret = open(user.mfaSecretEnc);
  if (!secret || !verifyTotp(secret, code)) throw new HttpError(400, "MFA_CODE_INVALID", "Enter a current code from your authenticator app");
  const codes = newBackupCodes();
  await prisma.user.update({ where: { id: userId }, data: { mfaBackupCodesJson: codes.map((value) => ({ hash: hashCode(value), usedAt: null })) } });
  await audit({ orgId: user.orgId, userId, action: "mfa.backup_codes_regenerated", context });
  return { backupCodes: codes };
};

/** Company admin: clears a colleague's second factor so they can enrol again. */
const adminReset = async ({ orgId, userId, actor, context = {} }) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnrolledAt: null, mfaBackupCodesJson: [] } });
  await audit({ orgId, userId, actorId: actor?.id || null, action: "mfa.reset_by_admin", context });
  return { reset: true };
};

// ─── Login challenge ──────────────────────────────────────────────────────

const secretFor = (name) => {
  const value = process.env[name];
  if (!value) throw new HttpError(500, "CONFIG_ERROR", `Missing environment variable: ${name}`);
  return value;
};

const createChallenge = (user) => jwt.sign({ sub: user.id, orgId: user.orgId, type: "mfa" }, secretFor("JWT_SECRET"), { expiresIn: CHALLENGE_EXPIRY });

const verifyChallenge = (token) => {
  let payload;
  try {
    payload = jwt.verify(String(token || ""), secretFor("JWT_SECRET"));
  } catch (error) {
    throw new HttpError(401, error?.name === "TokenExpiredError" ? "MFA_CHALLENGE_EXPIRED" : "MFA_CHALLENGE_INVALID", error?.name === "TokenExpiredError" ? "The sign-in timed out — enter your password again" : "Start the sign-in again");
  }
  if (payload.type !== "mfa" || !payload.sub) throw new HttpError(401, "MFA_CHALLENGE_INVALID", "Start the sign-in again");
  return payload;
};

/** Verifies the code for a challenge and returns the user (the caller issues the session). */
const resolveChallenge = async ({ mfaToken, code, context = {} }) => {
  const payload = verifyChallenge(mfaToken);
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status !== "active") throw new HttpError(401, "MFA_CHALLENGE_INVALID", "Start the sign-in again");
  await authAbuseService.assertLoginAllowed({ email: user.email, ipAddress: context.ipAddress });
  if (!user.mfaEnabled || !(await verifyCode({ user, code }))) {
    await authAbuseService.recordLoginFailure({ email: user.email, ipAddress: context.ipAddress });
    await audit({ orgId: user.orgId, userId: user.id, action: "mfa.failed", context });
    throw new HttpError(401, "MFA_CODE_INVALID", "That code is not valid");
  }
  await authAbuseService.recordLoginSuccess({ email: user.email, ipAddress: context.ipAddress });
  return user;
};

module.exports = { BACKUP_CODE_COUNT, seal, open, hashCode, status, beginEnrollment, enable, disable, regenerateBackupCodes, adminReset, verifyCode, createChallenge, verifyChallenge, resolveChallenge };
