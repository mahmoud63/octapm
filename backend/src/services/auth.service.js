const {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} = require("crypto");
const bcrypt = require("bcryptjs");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const {
  createAccessToken,
  createRefreshToken,
  getAccessTokenExpiresInSeconds,
  getRefreshTokenExpiresAt,
  hashRefreshToken,
  verifyRefreshToken,
} = require("../utils/tokens");
const authAbuseService = require("./auth-abuse.service");
const { ensureSubscription } = require("./subscription.service");
const { sendEmail, templates } = require("./email.service");
const companyPartyService = require("./company-party.service");
const { isPublicRegistrationOpen } = require("../config/registration");

const PASSWORD_RESET_EXPIRY_MINUTES = 60;
const INVITATION_EXPIRY_DAYS = 7;

const normalizeEmail = (email) => email.trim().toLowerCase();

const readPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const addMinutes = (amount) => new Date(Date.now() + amount * 60 * 1000);

const createAccountToken = () => randomBytes(32).toString("base64url");

const hashAccountToken = (token) =>
  createHash("sha256").update(token).digest("hex");

const getPasswordResetExpiresAt = () =>
  addMinutes(
    readPositiveInt(
      process.env.PASSWORD_RESET_TOKEN_MINUTES,
      PASSWORD_RESET_EXPIRY_MINUTES,
    ),
  );

const getInvitationExpiresAt = () =>
  new Date(
    Date.now() +
      readPositiveInt(
        process.env.INVITATION_TOKEN_DAYS,
        INVITATION_EXPIRY_DAYS,
      ) *
        24 *
        60 *
        60 *
        1000,
  );

const getWebAppBaseUrl = () =>
  (
    process.env.WEB_APP_URL ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_APP_URL ||
    "http://localhost:5173"
  ).replace(/\/$/, "");

const buildWebAppUrl = (path, token) => {
  const url = new URL(path, `${getWebAppBaseUrl()}/`);
  url.searchParams.set("token", token);
  return url.toString();
};

const recordAuthAuditEvent = async ({
  tx = prisma,
  orgId = null,
  projectId = null,
  userId = null,
  actorId = null,
  actorRole = null,
  entityType,
  entityId = null,
  action,
  email = null,
  ipAddress = null,
  userAgent = null,
  metadata = {},
}) => {
  if (!tx.authAuditEvent?.create) {
    return null;
  }

  return tx.authAuditEvent.create({
    data: {
      orgId,
      projectId,
      userId,
      actorId,
      actorRole,
      entityType,
      entityId,
      action,
      email,
      ipAddress,
      userAgent,
      metadataJson: metadata,
    },
  });
};

const createInvalidResetTokenError = () =>
  new HttpError(
    400,
    "PASSWORD_RESET_TOKEN_INVALID",
    "Password reset token is invalid, expired, or already used",
  );

const createInvalidInvitationTokenError = () =>
  new HttpError(
    400,
    "INVITATION_TOKEN_INVALID",
    "Invitation token is invalid, expired, or already used",
  );

const sanitizeUser = (user) => ({
  id: user.id,
  orgId: user.orgId,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  isCompanyAdmin: Boolean(user.isCompanyAdmin),
  status: user.status,
  lastLogin: user.lastLogin,
  mfaEnabled: Boolean(user.mfaEnabled),
  ssoLinked: Boolean(user.ssoSubject),
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const buildTokenPayload = (user) => ({
  accessToken: createAccessToken(user),
  tokenType: "Bearer",
  expiresIn: getAccessTokenExpiresInSeconds(),
});

const buildAuthPayload = (user, refreshSession) => ({
  user: sanitizeUser(user),
  tokens: buildTokenPayload(user),
  refreshToken: refreshSession.refreshToken,
  refreshTokenExpiresAt: refreshSession.expiresAt,
});

const createRefreshSession = async (tx, user, context = {}) => {
  const sessionId = randomUUID();
  const refreshToken = createRefreshToken(
    user,
    sessionId,
    context.client || "web",
  );
  const expiresAt = getRefreshTokenExpiresAt(refreshToken);

  await tx.refreshSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      orgId: user.orgId,
      tokenHash: hashRefreshToken(refreshToken),
      userAgent: context.userAgent || null,
      ipAddress: context.ipAddress || null,
      expiresAt,
    },
  });

  return {
    id: sessionId,
    refreshToken,
    expiresAt,
  };
};

const createAuthSessionPayload = async (tx, user, context = {}) => {
  const refreshSession = await createRefreshSession(tx, user, context);
  return buildAuthPayload(user, refreshSession);
};

const createInvalidRefreshTokenError = () =>
  new HttpError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid");

const compareTokenHashes = (left, right) => {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

const handleRefreshVerifyError = (error) => {
  if (error instanceof HttpError) {
    throw error;
  }

  if (error.name === "TokenExpiredError") {
    throw new HttpError(
      401,
      "REFRESH_TOKEN_EXPIRED",
      "Refresh token has expired",
    );
  }

  if (error.name === "JsonWebTokenError") {
    throw createInvalidRefreshTokenError();
  }

  throw error;
};

const revokeSessionFamily = async (tx, session, now) => {
  const sessionIds = [session.id];
  if (session.replacedBySessionId) {
    sessionIds.push(session.replacedBySessionId);
  }

  await tx.refreshSession.updateMany({
    where: {
      id: { in: sessionIds },
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
};

const revokeSessionIfActive = async (tx, sessionId, now) => {
  await tx.refreshSession.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
};

/**
 * A new organisation with its first company administrator, its subscription
 * and its default permission templates — everything self-service sign-up and
 * the first-administrator bootstrap have in common. Runs inside the caller's
 * transaction; the caller decides how the password hash was produced.
 */
const provisionOrganisation = async (
  tx,
  { orgName, name, email, phone = null, passwordHash },
) => {
  const createdOrg = await tx.organisation.create({
    data: {
      name: orgName?.trim() || `${name.trim()} Organisation`,
    },
  });

  const createdUser = await tx.user.create({
    data: {
      orgId: createdOrg.id,
      name: name.trim(),
      email,
      phone: phone || null,
      passwordHash,
      role: "pm",
      isCompanyAdmin: true,
    },
  });

  await ensureSubscription(createdOrg.id, tx);
  // System permission templates (8 internal roles + 4 external party types).
  await require("./permission-template.service").seedDefaultTemplates({
    tx,
    orgId: createdOrg.id,
  });

  return { org: createdOrg, user: createdUser };
};

const createRegistrationClosedError = () =>
  new HttpError(
    403,
    "REGISTRATION_CLOSED",
    "New organisations are created by invitation. Ask your company administrator for an invite.",
  );

const register = async (
  { orgName, name, email, password, phone },
  context = {},
) => {
  // Checked before any account lookup, so a closed deployment reveals
  // nothing — not even whether an email is already registered. The route's
  // field validation runs earlier, so a malformed body still gets its 400;
  // those errors describe only the request.
  if (!isPublicRegistrationOpen()) {
    throw createRegistrationClosedError();
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    throw new HttpError(
      409,
      "EMAIL_ALREADY_EXISTS",
      "An account with this email already exists",
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  return prisma.$transaction(async (tx) => {
    const { org: createdOrg, user: createdUser } = await provisionOrganisation(
      tx,
      { orgName, name, email: normalizedEmail, phone, passwordHash },
    );
    const authPayload = await createAuthSessionPayload(
      tx,
      createdUser,
      context,
    );

    return {
      organisation: {
        id: createdOrg.id,
        name: createdOrg.name,
        plan: createdOrg.plan,
        status: createdOrg.status,
      },
      ...authPayload,
    };
  });
};

const login = async ({ email, password }, context = {}) => {
  const normalizedEmail = email.trim().toLowerCase();
  await authAbuseService.assertLoginAllowed({
    email: normalizedEmail,
    ipAddress: context.ipAddress,
  });

  // Awaited, not fired and forgotten: with the counts in Postgres, a failure
  // that is still being written when the next attempt arrives would let that
  // attempt through uncounted.
  const recordInvalidLogin = () =>
    authAbuseService.recordLoginFailure({
      email: normalizedEmail,
      ipAddress: context.ipAddress,
    });

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    await recordInvalidLogin();
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password",
    );
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    await recordInvalidLogin();
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password",
    );
  }
  await authAbuseService.recordLoginSuccess({
    email: normalizedEmail,
    ipAddress: context.ipAddress,
  });

  if (user.status !== "active") {
    throw new HttpError(403, "USER_INACTIVE", "Your account is not active");
  }

  // Organisation policies (OCTA-SEC-AUTH-040): SSO-only domains and a second factor.
  const org = prisma.organisation?.findUnique
    ? await prisma.organisation.findUnique({
        where: { id: user.orgId },
        select: {
          ssoEnabled: true,
          ssoRequired: true,
          ssoDomainsJson: true,
          mfaRequired: true,
        },
      })
    : null;
  if (
    org?.ssoEnabled &&
    org.ssoRequired &&
    !user.isCompanyAdmin &&
    require("./sso.service").domainMatches(normalizedEmail, org.ssoDomainsJson)
  ) {
    throw new HttpError(
      403,
      "SSO_REQUIRED",
      "Your organisation signs in with single sign-on — use the SSO button",
    );
  }
  if (user.mfaEnabled) {
    const mfaService = require("./mfa.service");
    await recordAuthAuditEvent({
      orgId: user.orgId,
      userId: user.id,
      entityType: "user",
      entityId: user.id,
      action: "mfa.challenged",
      email: normalizedEmail,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    }).catch(() => null);
    return {
      mfaRequired: true,
      mfaToken: mfaService.createChallenge(user),
      methods: ["totp", "backup_code"],
    };
  }

  return prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const payload = await createAuthSessionPayload(tx, updatedUser, context);
    payload.user.mfaEnrollmentRequired = Boolean(
      org?.mfaRequired && !updatedUser.mfaEnabled,
    );
    return payload;
  });
};

/** Second step of a login with two-factor: the challenge token plus a code from the app or a backup code. */
const completeMfaLogin = async ({ mfaToken, code }, context = {}) => {
  const mfaService = require("./mfa.service");
  const user = await mfaService.resolveChallenge({ mfaToken, code, context });
  return prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });
    await recordAuthAuditEvent({
      tx,
      orgId: user.orgId,
      userId: user.id,
      entityType: "user",
      entityId: user.id,
      action: "mfa.verified",
      email: user.email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return createAuthSessionPayload(tx, updatedUser, context);
  });
};

const refresh = async ({
  refreshToken,
  userAgent,
  ipAddress,
  client = "web",
}) => {
  let payload;

  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (error) {
    handleRefreshVerifyError(error);
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const now = new Date();

  // A refusal that must also revoke something is recorded here and acted on
  // after the transaction. Throwing from inside the transaction rolls back
  // everything it did, which would silently undo the very revocation that
  // makes a replayed token dangerous to keep around.
  let refusal = null;
  const refuse = (session, scope, error) => {
    refusal = { session, scope, error };
    return null;
  };

  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.refreshSession.findUnique({
      where: { id: payload.jti },
      include: { user: true },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.orgId !== payload.orgId ||
      !compareTokenHashes(session.tokenHash, tokenHash)
    ) {
      throw createInvalidRefreshTokenError();
    }

    // A token that turns up on the channel it was not issued for has left the
    // place it was stored. Treat it exactly like a replay.
    if ((payload.cli || "web") !== client) {
      return refuse(
        session,
        "family",
        new HttpError(
          401,
          "REFRESH_TOKEN_CHANNEL_MISMATCH",
          "Refresh token was issued for a different client",
        ),
      );
    }

    if (session.revokedAt) {
      return refuse(
        session,
        "family",
        new HttpError(
          401,
          "REFRESH_TOKEN_REUSED",
          "Refresh token has already been used",
        ),
      );
    }

    if (session.expiresAt <= now) {
      return refuse(
        session,
        "session",
        new HttpError(
          401,
          "REFRESH_TOKEN_EXPIRED",
          "Refresh token has expired",
        ),
      );
    }

    if (!session.user || session.user.status !== "active") {
      return refuse(session, "session", createInvalidRefreshTokenError());
    }

    // The read above is not a claim: two refreshes with the same token (a
    // retry, two tabs, two API tasks) both see revokedAt still empty. The
    // session is claimed by this conditional write instead. The loser waits
    // on the winner's row lock, then finds revokedAt set and matches nothing,
    // so exactly one of them mints a child session. The loser is treated as
    // the replay it is, and re-reads the session so the family it revokes
    // includes the child the winner has just created.
    const claimed = await tx.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (claimed.count !== 1) {
      const latest = await tx.refreshSession.findUnique({
        where: { id: session.id },
      });
      return refuse(
        latest || session,
        "family",
        new HttpError(
          401,
          "REFRESH_TOKEN_REUSED",
          "Refresh token has already been used",
        ),
      );
    }

    const nextSession = await createRefreshSession(tx, session.user, {
      userAgent,
      ipAddress,
      client,
    });

    await tx.refreshSession.update({
      where: { id: session.id },
      data: {
        replacedBySessionId: nextSession.id,
      },
    });

    return buildAuthPayload(session.user, nextSession);
  });

  if (refusal) {
    if (refusal.scope === "family") {
      await revokeSessionFamily(prisma, refusal.session, now);
    } else {
      await revokeSessionIfActive(prisma, refusal.session.id, now);
    }
    throw refusal.error;
  }

  return result;
};

const logout = async ({ refreshToken, client = "web" }) => {
  if (!refreshToken) {
    return { revoked: false };
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (_error) {
    return { revoked: false };
  }

  // Only the channel a token was issued on may end its session.
  if ((payload.cli || "web") !== client) {
    return { revoked: false };
  }

  const result = await prisma.refreshSession.updateMany({
    where: {
      id: payload.jti,
      tokenHash: hashRefreshToken(refreshToken),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  return { revoked: result.count > 0 };
};

const getProfile = async ({ userId, orgId }) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      orgId,
    },
  });

  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  }

  return sanitizeUser(user);
};

const requestPasswordReset = async ({ email }, context = {}) => {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { org: true },
  });

  if (!user || user.status !== "active") {
    await recordAuthAuditEvent({
      orgId: user?.orgId || null,
      userId: user?.id || null,
      entityType: "password_reset",
      action: user
        ? "password_reset_requested_inactive"
        : "password_reset_requested_unknown",
      email: normalizedEmail,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return { sent: true };
  }

  const rawToken = createAccountToken();
  const tokenHash = hashAccountToken(rawToken);
  const expiresAt = getPasswordResetExpiresAt();
  const now = new Date();

  const resetToken = await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    const created = await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        orgId: user.orgId,
        email: normalizedEmail,
        tokenHash,
        userAgent: context.userAgent || null,
        ipAddress: context.ipAddress || null,
        expiresAt,
      },
    });

    await recordAuthAuditEvent({
      tx,
      orgId: user.orgId,
      userId: user.id,
      entityType: "password_reset",
      entityId: created.id,
      action: "password_reset_requested",
      email: normalizedEmail,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { expiresAt },
    });

    return created;
  });

  const resetUrl = buildWebAppUrl("/reset-password", rawToken);
  const template = templates.passwordReset({
    name: user.name,
    resetUrl,
    expiresAt: resetToken.expiresAt,
  });

  // A failed send is recorded, never reported. The answer has to be the same
  // {sent:true} whether or not the address belongs to anyone: a 5xx here only
  // for real accounts would tell a stranger which emails are registered. The
  // person can simply ask again; the operator finds the failure in the audit
  // trail and the log.
  try {
    await sendEmail({
      to: normalizedEmail,
      ...template,
      metadata: {
        orgId: user.orgId,
        userId: user.id,
        tokenId: resetToken.id,
        type: "password_reset",
      },
    });
  } catch (error) {
    console.error(
      `[auth] password reset email for user ${user.id} was not delivered: ${error?.code || error?.name || "ERROR"}`,
    );
    await recordAuthAuditEvent({
      orgId: user.orgId,
      userId: user.id,
      entityType: "password_reset",
      entityId: resetToken.id,
      action: "password_reset_delivery_failed",
      email: normalizedEmail,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        code: error?.code || null,
        status: error?.details?.status || error?.status || null,
      },
    }).catch(() => null);
  }

  return { sent: true };
};

const assertUsablePasswordResetToken = (resetToken, now = new Date()) => {
  if (
    !resetToken ||
    resetToken.usedAt ||
    resetToken.revokedAt ||
    resetToken.expiresAt <= now
  ) {
    throw createInvalidResetTokenError();
  }

  if (!resetToken.user || resetToken.user.status !== "active") {
    throw createInvalidResetTokenError();
  }
};

const resetPassword = async ({ token, password }, context = {}) => {
  const tokenHash = hashAccountToken(token);
  const now = new Date();
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  try {
    assertUsablePasswordResetToken(resetToken, now);
  } catch (error) {
    await recordAuthAuditEvent({
      orgId: resetToken?.orgId || null,
      userId: resetToken?.userId || null,
      entityType: "password_reset",
      entityId: resetToken?.id || null,
      action: "password_reset_rejected",
      email: resetToken?.email || null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { reason: error.code || "invalid_token" },
    });
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction(async (tx) => {
    // Claimed first, by a conditional write: two submissions of one link both
    // pass the check above, and only the one that wins this claim may set a
    // password. The other throws here, which rolls its transaction back.
    const claimed = await tx.passwordResetToken.updateMany({
      where: {
        id: resetToken.id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      throw createInvalidResetTokenError();
    }

    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    await tx.passwordResetToken.updateMany({
      where: {
        userId: resetToken.userId,
        id: { not: resetToken.id },
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    await tx.refreshSession.updateMany({
      where: {
        userId: resetToken.userId,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    await recordAuthAuditEvent({
      tx,
      orgId: resetToken.orgId,
      userId: resetToken.userId,
      entityType: "password_reset",
      entityId: resetToken.id,
      action: "password_reset_completed",
      email: resetToken.email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  });

  return { reset: true };
};

const assertUsableInvitationToken = (invitation, now = new Date()) => {
  if (
    !invitation ||
    invitation.status !== "pending" ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    invitation.expiresAt <= now
  ) {
    throw createInvalidInvitationTokenError();
  }
};

const getInvitationByRawToken = async (token) =>
  prisma.invitationToken.findUnique({
    where: { tokenHash: hashAccountToken(token) },
    include: {
      org: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      projectParty: {
        select: {
          id: true,
          role: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  });

const getInvitationPreview = async ({ token }) => {
  const invitation = await getInvitationByRawToken(token);
  assertUsableInvitationToken(invitation);

  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, orgId: true, status: true },
  });

  if (existingUser && existingUser.orgId !== invitation.orgId) {
    throw new HttpError(
      409,
      "INVITATION_EMAIL_IN_OTHER_ORG",
      "Email is already registered to another organization",
    );
  }

  return {
    email: invitation.email,
    role: invitation.role,
    org: invitation.org,
    project: invitation.project || null,
    company: invitation.company || invitation.projectParty?.company || null,
    projectParty: invitation.projectParty
      ? {
          id: invitation.projectParty.id,
          role: invitation.projectParty.role,
          company: invitation.projectParty.company,
        }
      : null,
    expiresAt: invitation.expiresAt,
    existingUser: Boolean(existingUser),
    requiresPassword: !existingUser || existingUser.status !== "active",
  };
};

const acceptInvitation = async (
  { token, name, password, phone },
  context = {},
) => {
  const tokenHash = hashAccountToken(token);
  const now = new Date();
  const invitation = await prisma.invitationToken.findUnique({
    where: { tokenHash },
    include: {
      org: true,
      project: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      projectParty: {
        select: {
          id: true,
          role: true,
          companyId: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  });

  try {
    assertUsableInvitationToken(invitation, now);
  } catch (error) {
    await recordAuthAuditEvent({
      orgId: invitation?.orgId || null,
      projectId: invitation?.projectId || null,
      entityType: "invitation",
      entityId: invitation?.id || null,
      action: "invitation_accept_rejected",
      email: invitation?.email || null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { reason: error.code || "invalid_token" },
    });
    throw error;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
  });

  if (existingUser && existingUser.orgId !== invitation.orgId) {
    throw new HttpError(
      409,
      "INVITATION_EMAIL_IN_OTHER_ORG",
      "Email is already registered to another organization",
    );
  }

  const requiresPassword = !existingUser || existingUser.status !== "active";
  if (requiresPassword && !password) {
    throw new HttpError(
      400,
      "INVITATION_PASSWORD_REQUIRED",
      "A password is required to accept this invitation",
    );
  }

  const passwordHash = password ? await bcrypt.hash(password, 12) : null;

  return prisma.$transaction(async (tx) => {
    let user;
    if (existingUser) {
      const data = {
        role: invitation.role,
        status: "active",
      };
      if (name?.trim()) data.name = name.trim();
      if (phone !== undefined) data.phone = phone || null;
      if (passwordHash) data.passwordHash = passwordHash;

      user = await tx.user.update({
        where: { id: existingUser.id },
        data,
      });
    } else {
      user = await tx.user.create({
        data: {
          orgId: invitation.orgId,
          name: name.trim(),
          email: invitation.email,
          phone: phone || null,
          passwordHash,
          role: invitation.role,
          status: "active",
        },
      });
    }

    if (invitation.projectPartyId || invitation.companyId) {
      await companyPartyService.acceptProjectPartyInvitation({
        tx,
        invitation,
        user,
      });
    } else if (invitation.projectId) {
      await tx.projectAssignment.upsert({
        where: {
          projectId_userId: {
            projectId: invitation.projectId,
            userId: user.id,
          },
        },
        create: {
          projectId: invitation.projectId,
          userId: user.id,
          role: invitation.role,
        },
        update: {
          role: invitation.role,
        },
      });
    }

    await tx.invitationToken.update({
      where: { id: invitation.id },
      data: {
        status: "accepted",
        acceptedAt: now,
        acceptedById: user.id,
      },
    });

    await tx.invitationToken.updateMany({
      where: {
        orgId: invitation.orgId,
        email: invitation.email,
        id: { not: invitation.id },
        status: "pending",
        acceptedAt: null,
        revokedAt: null,
      },
      data: {
        status: "revoked",
        revokedAt: now,
      },
    });

    await recordAuthAuditEvent({
      tx,
      orgId: invitation.orgId,
      projectId: invitation.projectId,
      userId: user.id,
      actorId: invitation.invitedById || null,
      entityType: "invitation",
      entityId: invitation.id,
      action: "invitation_accepted",
      email: invitation.email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        role: invitation.role,
        projectId: invitation.projectId,
        companyId: invitation.companyId,
        projectPartyId: invitation.projectPartyId,
      },
    });

    return createAuthSessionPayload(tx, user, context);
  });
};

// ─── First administrator ────────────────────────────────────────────────────
//
// With self-service registration closed in production, a brand-new deployment
// has no way in: nobody can register, and invitations need an inviter. These
// two functions, run from `npm run admin:bootstrap` as a one-off task, create
// the first organisation and its company administrator.
//
// No password is ever supplied. The administrator gets an unusable random
// password (the plaintext is discarded at once, as SSO provisioning does) and
// a single-use set-password link — an ordinary password-reset token, completed
// by the existing reset page and POST /auth/reset-password.

// Two-int advisory lock key: its own namespace, so it can never collide with
// the single-bigint hashtext() locks the financial services take.
const BOOTSTRAP_LOCK_CLASS = 918274;
const BOOTSTRAP_LOCK_ID = 1;
const BOOTSTRAP_TRANSACTION = { maxWait: 10_000, timeout: 30_000 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const takeBootstrapLock = (tx) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_CLASS}::int, ${BOOTSTRAP_LOCK_ID}::int)`;

const createBootstrapRefusal = (message) =>
  new HttpError(409, "BOOTSTRAP_NOT_EMPTY", message);

const issueSetPasswordToken = async (tx, user, now) => {
  const rawToken = createAccountToken();
  const created = await tx.passwordResetToken.create({
    data: {
      userId: user.id,
      orgId: user.orgId,
      email: user.email,
      tokenHash: hashAccountToken(rawToken),
      expiresAt: getPasswordResetExpiresAt(),
      createdAt: now,
    },
  });
  return { rawToken, token: created };
};

const bootstrapFirstAdministrator = async ({ orgName, name, email }) => {
  const cleanOrgName = String(orgName || "").trim();
  const cleanName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!cleanOrgName || !cleanName || !EMAIL_PATTERN.test(normalizedEmail)) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "An organisation name, an administrator name and a valid email are required",
    );
  }

  // Hashed outside the transaction: bcrypt at 12 rounds is slow, and the
  // advisory lock should be held only while the database is being read and
  // written.
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Serialises concurrent runs: the second waits here, then sees the first
    // one's organisation and refuses, instead of both seeing an empty database.
    await takeBootstrapLock(tx);

    const [organisations, users] = await Promise.all([
      tx.organisation.count(),
      tx.user.count(),
    ]);
    if (organisations > 0 || users > 0) {
      throw createBootstrapRefusal(
        "The database already holds organisations or users; the first administrator can only be created in an empty database",
      );
    }

    const { org, user } = await provisionOrganisation(tx, {
      orgName: cleanOrgName,
      name: cleanName,
      email: normalizedEmail,
      passwordHash,
    });
    const { rawToken, token } = await issueSetPasswordToken(tx, user, now);

    await recordAuthAuditEvent({
      tx,
      orgId: org.id,
      userId: user.id,
      entityType: "organisation",
      entityId: org.id,
      action: "organisation_bootstrapped",
      email: normalizedEmail,
      metadata: { tokenId: token.id, expiresAt: token.expiresAt },
    });

    return { org, user, rawToken, token };
  }, BOOTSTRAP_TRANSACTION);

  return {
    organisation: { id: result.org.id, name: result.org.name },
    user: sanitizeUser(result.user),
    setPasswordUrl: buildWebAppUrl("/reset-password", result.rawToken),
    expiresAt: result.token.expiresAt,
  };
};

/**
 * A fresh link when the first one expired unused. Only while the deployment
 * is still exactly as bootstrap left it — one organisation, one administrator
 * who has never signed in or set a password — so it can never be used to take
 * over an account that is already in use.
 */
const reissueBootstrapLink = async ({ email }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    await takeBootstrapLock(tx);

    const [organisations, users] = await Promise.all([
      tx.organisation.count(),
      tx.user.count(),
    ]);
    const user = normalizedEmail
      ? await tx.user.findUnique({ where: { email: normalizedEmail } })
      : null;
    const passwordsSet = user
      ? await tx.passwordResetToken.count({
          where: { userId: user.id, usedAt: { not: null } },
        })
      : 0;
    if (
      organisations !== 1 ||
      users !== 1 ||
      !user ||
      !user.isCompanyAdmin ||
      user.status !== "active" ||
      user.lastLogin ||
      passwordsSet > 0
    ) {
      throw createBootstrapRefusal(
        "A new link is only issued to the bootstrapped administrator, before their first sign-in",
      );
    }

    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const { rawToken, token } = await issueSetPasswordToken(tx, user, now);

    await recordAuthAuditEvent({
      tx,
      orgId: user.orgId,
      userId: user.id,
      entityType: "organisation",
      entityId: user.orgId,
      action: "organisation_bootstrap_link_reissued",
      email: normalizedEmail,
      metadata: { tokenId: token.id, expiresAt: token.expiresAt },
    });

    return { user, rawToken, token };
  }, BOOTSTRAP_TRANSACTION);

  return {
    user: sanitizeUser(result.user),
    setPasswordUrl: buildWebAppUrl("/reset-password", result.rawToken),
    expiresAt: result.token.expiresAt,
  };
};

module.exports = {
  bootstrapFirstAdministrator,
  provisionOrganisation,
  reissueBootstrapLink,
  register,
  login,
  completeMfaLogin,
  refresh,
  logout,
  getProfile,
  requestPasswordReset,
  resetPassword,
  getInvitationPreview,
  acceptInvitation,
  createAuthSessionPayload,
  sanitizeUser,
};
