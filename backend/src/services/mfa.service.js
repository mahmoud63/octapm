const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { generateSecret, verifyTotp, otpauthUrl } = require("../utils/totp");
const { qrToSvg } = require("../utils/qr");
const authAbuseService = require("./auth-abuse.service");
const membershipService = require("./membership.service");
const { keyring } = require("../utils/keyring");
const { epochClaim, tokenEpochCurrent } = require("../utils/tokens");

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
  // SSO links live on the memberships, one per workspace (D-ID-1 Q2).
  const ssoLinks = membershipService.hasMembershipModel(prisma)
    ? await prisma.organizationMembership.count({ where: { userId, ssoSubject: { not: null } } })
    : 0;
  return { enabled: Boolean(user.mfaEnabled), enrolledAt: user.mfaEnrolledAt ? user.mfaEnrolledAt.toISOString() : null, backupCodesRemaining: user.mfaEnabled ? remainingBackupCodes(user) : 0, pending: Boolean(user.mfaPendingSecretEnc) && !user.mfaEnabled, required: Boolean(user.org?.mfaRequired), enrollmentRequired: Boolean(user.org?.mfaRequired) && !user.mfaEnabled, ssoLinked: ssoLinks > 0 };
};

/**
 * Writes a change to the person's own factor only onto the state it was
 * judged against (D-ID-1 N2): at the credential epoch the request was
 * authenticated at, and with the factor fields as they were read. A request
 * that proved itself before an admin reset or a password reset — and waited
 * behind it — would otherwise restore a cleared seed or enrol one on an
 * identity whose sessions were just ended.
 */
const writeOwnFactor = async ({ userId, epoch, expect = {}, data }) => {
  const { count } = await prisma.user.updateMany({
    where: { id: userId, status: "active", ...(Number.isInteger(epoch) ? { credentialEpoch: epoch } : {}), ...expect },
    data,
  });
  if (count === 1) return;
  const now = await prisma.user.findUnique({ where: { id: userId }, select: { credentialEpoch: true, status: true } });
  if (!now || now.status !== "active" || (Number.isInteger(epoch) && now.credentialEpoch !== epoch)) {
    throw new HttpError(401, "SESSION_REVOKED", "This session has ended; sign in again");
  }
  throw new HttpError(409, "MFA_STATE_CHANGED", "Your two-factor settings changed meanwhile; start again");
};

/** Creates a fresh secret and returns what the authenticator app needs (the secret is not stored in the clear). */
const beginEnrollment = async ({ userId, epoch = null }) => {
  const user = await loadUser(userId);
  // An enabled factor is not replaced by enrolling another: turning it off
  // takes the password and a current code, and only then can a new device
  // be enrolled (Phase 21D, CX21-429).
  if (user.mfaEnabled) throw new HttpError(409, "MFA_ALREADY_ENABLED", "Two-factor is already on; turn it off with your password and a current code before enrolling a new device");
  const secret = generateSecret();
  await writeOwnFactor({ userId, epoch, expect: { mfaEnabled: false }, data: { mfaPendingSecretEnc: seal(secret) } });
  const url = otpauthUrl({ issuer: ISSUER(), account: user.email, secret });
  return { secret, otpauthUrl: url, qrSvg: qrToSvg(url, { moduleSize: 5, quietZone: 3 }), issuer: ISSUER(), account: user.email };
};

/** Confirms the enrolment with a code from the app; returns the backup codes once. */
const enable = async ({ userId, code, epoch = null, context = {} }) => {
  const user = await loadUser(userId);
  const pending = unseal(user.mfaPendingSecretEnc);
  if (!pending) throw new HttpError(409, "MFA_NOT_PENDING", "Start the setup first to get a QR code");
  const step = verifyTotp(pending.value, code);
  if (step === null) throw new HttpError(400, "MFA_CODE_INVALID", "That code is not valid — check the time on your device and try the next code");
  const codes = newBackupCodes();
  // The enrolment code counts as used, so it cannot then sign in as well.
  // Enabled only from the pending seed that was read: one cleared meanwhile
  // (an admin reset) is not brought back.
  await writeOwnFactor({
    userId,
    epoch,
    expect: { mfaEnabled: false, mfaPendingSecretEnc: user.mfaPendingSecretEnc },
    data: { mfaEnabled: true, mfaSecretEnc: pending.stale ? seal(pending.value) : user.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaEnrolledAt: new Date(), mfaLastTotpStep: step, mfaBackupCodesJson: codes.map((value) => ({ hash: hashCode(value), usedAt: null })) },
  });
  await audit({ orgId: user.orgId, userId, action: "mfa.enabled", context });
  return { enabled: true, backupCodes: codes };
};

/**
 * Spends the time step a TOTP code matched. A code is good once (RFC 6238
 * §5.2): the newest accepted step is kept on the user, and a code only counts
 * for a later one. The write is conditional, so when the same code arrives
 * twice at once — on one API task or on two — exactly one request moves the
 * step forward and the other updates nothing and is refused.
 */
const spendTotpStep = async (userId, step) => {
  const { count } = await prisma.user.updateMany({ where: { id: userId, OR: [{ mfaLastTotpStep: null }, { mfaLastTotpStep: { lt: step } }] }, data: { mfaLastTotpStep: step } });
  return count > 0;
};

/**
 * Marks a backup code used. The codes live in one JSON column, so the write is
 * a compare-and-set on the list exactly as it was read: of two sign-ins
 * spending the same code at once only one succeeds, and neither can overwrite
 * the other's mark with its older copy of the list. The loser of a race reads
 * the list again and tries once more — its own code may still be unspent.
 */
const spendBackupCode = async (user, code) => {
  const hash = hashCode(code);
  let read = user.mfaBackupCodesJson;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { mfaBackupCodesJson: true } });
      if (!fresh) return false;
      read = fresh.mfaBackupCodesJson;
    }
    const rows = backupRows({ mfaBackupCodesJson: read });
    const index = rows.findIndex((row) => !row.usedAt && row.hash === hash);
    if (index < 0) return false;
    const next = rows.map((row, position) => (position === index ? { ...row, usedAt: new Date().toISOString() } : row));
    const { count } = await prisma.user.updateMany({ where: { id: user.id, mfaBackupCodesJson: { equals: read } }, data: { mfaBackupCodesJson: next } });
    if (count > 0) return true;
  }
  return false;
};

/** Checks a TOTP code or consumes a backup code; a replayed code fails exactly like a wrong one. */
const verifyCode = async ({ user, code }) => {
  const clean = String(code || "").trim();
  if (!clean) return false;
  const opened = unseal(user.mfaSecretEnc);
  const step = opened ? verifyTotp(opened.value, clean) : null;
  if (step !== null) {
    if (!(await spendTotpStep(user.id, step))) return false;
    await resealIfStale(user, opened);
    return true;
  }
  if (!(await spendBackupCode(user, clean))) return false;
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

/**
 * A current code from the person's authenticator app — never a backup code —
 * spent like a sign-in code, so it works once. For operator commands that must
 * be confirmed by the operator's own second factor (D-ID-1 Q13).
 */
const verifyAuthenticatorCode = async ({ user, code }) => {
  if (!user?.mfaEnabled) return false;
  const opened = unseal(user.mfaSecretEnc);
  const step = opened ? verifyTotp(opened.value, String(code || "").trim()) : null;
  if (step === null) return false;
  return spendTotpStep(user.id, step);
};

const disable = async ({ userId, password, code, epoch = null, context = {} }) => {
  const user = await loadUser(userId);
  if (!user.mfaEnabled) throw new HttpError(409, "MFA_NOT_ENABLED", "Two-factor authentication is not enabled");
  if (!password || !(await bcrypt.compare(String(password), user.passwordHash))) throw new HttpError(401, "INVALID_CREDENTIALS", "Password is incorrect");
  if (!(await verifyCode({ user, code }))) throw new HttpError(400, "MFA_CODE_INVALID", "That code is not valid");
  if (user.org?.mfaRequired && !user.isCompanyAdmin) throw new HttpError(403, "MFA_REQUIRED_BY_ORG", "Your organisation requires two-factor authentication; ask a company admin to reset it instead");
  // Only at the epoch the password and code were checked under: a reset that
  // landed meanwhile changed the password they proved (D-ID-1 N2).
  await writeOwnFactor({ userId, epoch, expect: { mfaEnabled: true, passwordHash: user.passwordHash }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnrolledAt: null, mfaLastTotpStep: null, mfaBackupCodesJson: [] } });
  await audit({ orgId: user.orgId, userId, action: "mfa.disabled", context });
  return { enabled: false };
};

const regenerateBackupCodes = async ({ userId, code, epoch = null, context = {} }) => {
  const user = await loadUser(userId);
  if (!user.mfaEnabled) throw new HttpError(409, "MFA_NOT_ENABLED", "Two-factor authentication is not enabled");
  const secret = open(user.mfaSecretEnc);
  const step = secret ? verifyTotp(secret, code) : null;
  if (step === null || !(await spendTotpStep(userId, step))) throw new HttpError(400, "MFA_CODE_INVALID", "Enter a current code from your authenticator app");
  const codes = newBackupCodes();
  await writeOwnFactor({ userId, epoch, expect: { mfaEnabled: true, mfaSecretEnc: user.mfaSecretEnc }, data: { mfaBackupCodesJson: codes.map((value) => ({ hash: hashCode(value), usedAt: null })) } });
  await audit({ orgId: user.orgId, userId, action: "mfa.backup_codes_regenerated", context });
  return { backupCodes: codes };
};

/** Company admin: clears a colleague's second factor so they can enrol again. */
const adminReset = async ({ orgId, userId, actor, context = {} }) => {
  const user = await prisma.user.findFirst({ where: { id: userId, orgId } });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  // Clearing the second factor from a workspace this person only visits would
  // weaken their sign-in to the companies they belong to (certification
  // finding L39): refused while the identity is part of any other workspace —
  // active or suspended there (D-ID-1 ID-GUARD). The check is the write's own
  // condition, so an acceptance elsewhere cannot land between them. Clearing
  // a factor is a credential event: the person's sessions end, and they are
  // told by e-mail.
  const shared = () => new HttpError(403, "IDENTITY_SHARED", "This person's second factor is managed from their own workspace");
  if (user.orgId !== orgId) throw shared();
  const cleared = await prisma.$transaction(async (tx) => {
    // Taken before the conditional write, so a membership another workspace is
    // accepting for this identity right now is either committed and seen, or
    // waits for this (D-ID-1 ID-GUARD).
    await membershipService.lockIdentity(tx, userId);
    const { count } = await tx.user.updateMany({
      where: { id: userId, orgId, ...membershipService.noOtherPresentMembershipWhere(orgId) },
      data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnrolledAt: null, mfaLastTotpStep: null, mfaBackupCodesJson: [], credentialEpoch: { increment: 1 } },
    });
    if (count === 1) {
      // Sessions, SSO tickets and the API keys the person created (Q-KEY).
      await require("./auth.service").endIdentitySessions(tx, userId, new Date(), { reason: "mfa_reset_by_admin", actorId: actor?.id || null });
    }
    return count === 1;
  });
  if (!cleared) throw shared();
  await audit({ orgId, userId, actorId: actor?.id || null, action: "mfa.reset_by_admin", context });
  // The notice goes after the answer, so the route drops the person's live
  // sockets at once rather than after the mail provider (D-ID-1 R3).
  setImmediate(() => {
    const { sendEmail, templates } = require("./email.service");
    sendEmail({ to: user.email, ...templates.mfaResetNotice({ name: user.name }), metadata: { orgId, userId, type: "mfa_reset_notice" } })
      .catch((error) => audit({ orgId, userId, actorId: actor?.id || null, action: "mfa.reset_notice_failed", metadata: { code: error?.code || null }, context }))
      .catch(() => null);
  });
  return { reset: true };
};

// ─── Login challenge ──────────────────────────────────────────────────────

const secretFor = (name) => {
  const value = process.env[name];
  if (!value) throw new HttpError(500, "CONFIG_ERROR", `Missing environment variable: ${name}`);
  return value;
};

const createChallenge = (user) => jwt.sign({ sub: user.id, orgId: user.orgId, type: "mfa", ...epochClaim(user) }, secretFor("JWT_SECRET"), { expiresIn: CHALLENGE_EXPIRY });

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
  // A challenge from before a credential event (a reset meanwhile) is void (D-ID-1 Q6).
  if (!user || user.status !== "active") throw new HttpError(401, "MFA_CHALLENGE_INVALID", "Start the sign-in again");
  if (!tokenEpochCurrent(payload, user)) throw new HttpError(401, "SESSION_REVOKED", "This session has ended; sign in again");
  await authAbuseService.assertLoginAllowed({ email: user.email, ipAddress: context.ipAddress });
  if (!user.mfaEnabled || !(await verifyCode({ user, code }))) {
    await authAbuseService.recordLoginFailure({ email: user.email, ipAddress: context.ipAddress });
    await audit({ orgId: user.orgId, userId: user.id, action: "mfa.failed", context });
    throw new HttpError(401, "MFA_CODE_INVALID", "That code is not valid");
  }
  await authAbuseService.recordLoginSuccess({ email: user.email, ipAddress: context.ipAddress });
  return user;
};

module.exports = { BACKUP_CODE_COUNT, seal, open, hashCode, status, beginEnrollment, enable, disable, regenerateBackupCodes, adminReset, verifyCode, verifyAuthenticatorCode, createChallenge, verifyChallenge, resolveChallenge };
