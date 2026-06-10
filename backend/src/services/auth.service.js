const { randomUUID, timingSafeEqual } = require('crypto');
const bcrypt = require('bcryptjs');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  createAccessToken,
  createRefreshToken,
  getAccessTokenExpiresInSeconds,
  getRefreshTokenExpiresAt,
  hashRefreshToken,
  verifyRefreshToken,
} = require('../utils/tokens');
const { ensureSubscription } = require('./subscription.service');

const sanitizeUser = (user) => ({
  id: user.id,
  orgId: user.orgId,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  status: user.status,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const buildTokenPayload = (user) => ({
  accessToken: createAccessToken(user),
  tokenType: 'Bearer',
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
  new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');

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

  if (error.name === 'TokenExpiredError') {
    throw new HttpError(
      401,
      'REFRESH_TOKEN_EXPIRED',
      'Refresh token has expired',
    );
  }

  if (error.name === 'JsonWebTokenError') {
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
      'EMAIL_ALREADY_EXISTS',
      'An account with this email already exists',
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
        role: 'pm',
      },
    });

    await ensureSubscription(createdOrg.id, tx);
    const authPayload = await createAuthSessionPayload(tx, createdUser, context);

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

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    throw new HttpError(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email or password',
    );
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new HttpError(
      401,
      'INVALID_CREDENTIALS',
      'Invalid email or password',
    );
  }

  if (user.status !== 'active') {
    throw new HttpError(403, 'USER_INACTIVE', 'Your account is not active');
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
        'REFRESH_TOKEN_REUSED',
        'Refresh token has already been used',
      );
    }

    if (session.expiresAt <= now) {
      await revokeSessionIfActive(tx, session.id, now);
      throw new HttpError(
        401,
        'REFRESH_TOKEN_EXPIRED',
        'Refresh token has expired',
      );
    }

    if (!session.user || session.user.status !== 'active') {
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
    throw new HttpError(404, 'USER_NOT_FOUND', 'User not found');
  }

  return sanitizeUser(user);
};

module.exports = {
  register,
  login,
  refresh,
  logout,
  getProfile,
};
