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
  const refreshToken = createRefreshToken(user, sessionId);
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

const register = async (
  { orgName, name, email, password, phone },
  context = {},
) => {
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
    const createdOrg = await tx.organisation.create({
      data: {
        name: orgName?.trim() || `${name.trim()} Organisation`,
      },
    });

    const createdUser = await tx.user.create({
      data: {
        orgId: createdOrg.id,
        name: name.trim(),
        email: normalizedEmail,
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
  authAbuseService.assertLoginAllowed({
    email: normalizedEmail,
    ipAddress: context.ipAddress,
  });

  const recordInvalidLogin = () =>
    authAbuseService.recordLoginFailure({
      email: normalizedEmail,
      ipAddress: context.ipAddress,
    });

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    recordInvalidLogin();
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password",
    );
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    recordInvalidLogin();
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password",
    );
  }
  authAbuseService.recordLoginSuccess({ email: normalizedEmail });

  if (user.status !== "active") {
    throw new HttpError(403, "USER_INACTIVE", "Your account is not active");
  }

  return prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return createAuthSessionPayload(tx, updatedUser, context);
  });
};

const refresh = async ({ refreshToken, userAgent, ipAddress }) => {
  let payload;

  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (error) {
    handleRefreshVerifyError(error);
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
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

    if (session.revokedAt) {
      await revokeSessionFamily(tx, session, now);
      throw new HttpError(
        401,
        "REFRESH_TOKEN_REUSED",
        "Refresh token has already been used",
      );
    }

    if (session.expiresAt <= now) {
      await revokeSessionIfActive(tx, session.id, now);
      throw new HttpError(
        401,
        "REFRESH_TOKEN_EXPIRED",
        "Refresh token has expired",
      );
    }

    if (!session.user || session.user.status !== "active") {
      await revokeSessionIfActive(tx, session.id, now);
      throw createInvalidRefreshTokenError();
    }

    const nextSession = await createRefreshSession(tx, session.user, {
      userAgent,
      ipAddress,
    });

    await tx.refreshSession.update({
      where: { id: session.id },
      data: {
        revokedAt: now,
        replacedBySessionId: nextSession.id,
      },
    });

    return buildAuthPayload(session.user, nextSession);
  });
};

const logout = async ({ refreshToken }) => {
  if (!refreshToken) {
    return { revoked: false };
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (_error) {
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
    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    await tx.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: now },
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

module.exports = {
  register,
  login,
  refresh,
  logout,
  getProfile,
  requestPasswordReset,
  resetPassword,
  getInvitationPreview,
  acceptInvitation,
};
