const jwt = require('jsonwebtoken');
const { HttpError } = require('./http-error');

const getEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new HttpError(
      500,
      'CONFIG_ERROR',
      `Missing environment variable: ${name}`,
    );
  }

  return value;
};

const createAccessToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      email: user.email,
      name: user.name,
      type: 'access',
    },
    getEnv('JWT_SECRET'),
    { expiresIn: process.env.JWT_EXPIRY || '15m' },
  );
};

const createRefreshToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      type: 'refresh',
    },
    getEnv('JWT_REFRESH_SECRET'),
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' },
  );
};

const verifyAccessToken = (token) => {
  const payload = jwt.verify(token, getEnv('JWT_SECRET'));
  if (payload.type !== 'access') {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid access token type');
  }

  return payload;
};

const verifyRefreshToken = (token) => {
  const payload = jwt.verify(token, getEnv('JWT_REFRESH_SECRET'));
  if (payload.type !== 'refresh') {
    throw new HttpError(401, 'INVALID_TOKEN', 'Invalid refresh token type');
  }

  return payload;
};

module.exports = {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
