const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { generateSecret, verifyTotp, otpauthUrl } = require("../utils/totp");
const { qrToSvg } = require("../utils/qr");
const authAbuseService = require("./auth-abuse.service");

/**
 * Two-factor authentication (OCTA-SEC-AUTH-040): TOTP with an authenticator
 * app, ten single-use backup codes, an organisation-wide requirement, and
 * a short-lived challenge token between the password and the code at login.
 * Secrets are stored encrypted (AES-256-GCM, key from MFA_SECRET_KEY,
 * INTEGRATION_SECRET_KEY or JWT_SECRET); backup codes are stored hashed.
 */

const BACKUP_CODE_COUNT = 10;
const CHALLENGE_EXPIRY = "5m";
const ISSUER = () => process.env.MFA_ISSUER || process.env.APP_NAME || "OctaPM";

const keyMaterial = () => {
  const source = process.env.MFA_SECRET_KEY || process.env.INTEGRATION_SECRET_KEY || process.env.JWT_SECRET;
  if (!source) throw new HttpError(500, "CONFIG_ERROR", "Missing environment variable: MFA_SECRET_KEY (or JWT_SECRET)");
  return crypto.createHash("sha256").update(String(source)).digest();
};
const seal = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const payload = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${payload.toString("base64url")}`;
};
const open = (text) => {
  if (!text) return null;
  const [version, iv, tag, payload] = String(text).split(".");
  if (version !== "v1" || !iv || !tag || !payload) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
};

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
  const secret = generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaPendingSecretEnc: seal(secret) } });
  const url = otpauthUrl({ issuer: ISSUER(), account: user.email, secret });
  return { secret, otpauthUrl: url, qrSvg: qrToSvg(url, { moduleSize: 5, quietZone: 3 }), issuer: ISSUER(), account: user.email };
};

/** Confirms the enrolment with a code from the app; returns the backup codes once. */
const enable = async ({ userId, code, context = {} }) => {
  const user = await loadUser(userId);
  const secret = open(user.mfaPendingSecretEnc);
  if (!secret) throw new HttpError(409, "MFA_NOT_PENDING", "Start the setup first to get a QR code");
  if (!verifyTotp(secret, code)) throw new HttpError(400, "MFA_CODE_INVALID", "That code is not valid — check the time on your device and try the next code");
  const codes = newBackupCodes();
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true, mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaEnrolledAt: new Date(), mfaBackupCodesJson: codes.map((value) => ({ hash: hashCode(value), usedAt: null })) } });
  await audit({ orgId: user.orgId, userId, action: "mfa.enabled", context });
  return { enabled: true, backupCodes: codes };
};

/** Checks a TOTP code or consumes a backup code. */
const verifyCode = async ({ user, code }) => {
  const clean = String(code || "").trim();
  if (!clean) return false;
  const secret = open(user.mfaSecretEnc);
  if (secret && verifyTotp(secret, clean)) return true;
  const rows = backupRows(user);
  const hash = hashCode(clean);
  const index = rows.findIndex((row) => !row.usedAt && row.hash === hash);
  if (index < 0) return false;
  rows[index] = { ...rows[index], usedAt: new Date().toISOString() };
  await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodesJson: rows } });
  return true;
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
  authAbuseService.assertLoginAllowed({ email: user.email, ipAddress: context.ipAddress });
  if (!user.mfaEnabled || !(await verifyCode({ user, code }))) {
    authAbuseService.recordLoginFailure({ email: user.email, ipAddress: context.ipAddress });
    await audit({ orgId: user.orgId, userId: user.id, action: "mfa.failed", context });
    throw new HttpError(401, "MFA_CODE_INVALID", "That code is not valid");
  }
  authAbuseService.recordLoginSuccess({ email: user.email });
  return user;
};

module.exports = { BACKUP_CODE_COUNT, seal, open, hashCode, status, beginEnrollment, enable, disable, regenerateBackupCodes, adminReset, verifyCode, createChallenge, verifyChallenge, resolveChallenge };
