const bcrypt = require('bcryptjs');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
} = require('../utils/tokens');

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

const buildAuthPayload = (user) => ({
  user: sanitizeUser(user),
  tokens: {
    accessToken: createAccessToken(user),
    refreshToken: createRefreshToken(user),
    tokenType: 'Bearer',
  },
});

const register = async ({ orgName, name, email, password, phone }) => {
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

  const { org, user } = await prisma.$transaction(async (tx) => {
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

    return { org: createdOrg, user: createdUser };
  });

  return {
    organisation: {
      id: org.id,
      name: org.name,
      plan: org.plan,
      status: org.status,
    },
    ...buildAuthPayload(user),
  };
};

const login = async ({ email, password }) => {
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

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  return buildAuthPayload(updatedUser);
};

const refresh = async ({ refreshToken }) => {
  let payload;

  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new HttpError(
        401,
        'REFRESH_TOKEN_EXPIRED',
        'Refresh token has expired',
      );
    }

    if (error.name === 'JsonWebTokenError') {
      throw new HttpError(
        401,
        'INVALID_REFRESH_TOKEN',
        'Refresh token is invalid',
      );
    }

    throw error;
  }

  const user = await prisma.user.findFirst({
    where: {
      id: payload.sub,
      orgId: payload.orgId,
    },
  });

  if (!user || user.status !== 'active') {
    throw new HttpError(
      401,
      'INVALID_REFRESH_TOKEN',
      'Refresh token is invalid',
    );
  }

  return buildAuthPayload(user);
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
  getProfile,
};
