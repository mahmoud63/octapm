const express = require('express');
const request = require('supertest');

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
  getProfile: jest.fn(),
};

jest.mock('../../services/auth.service', () => mockAuthService);

const authRouter = require('../auth');

const user = {
  id: 'user-1',
  orgId: 'org-1',
  name: 'Project Manager',
  email: 'pm@example.com',
  phone: null,
  role: 'pm',
  status: 'active',
};

const sessionResult = (refreshToken = 'refresh-token-1') => ({
  user,
  tokens: {
    accessToken: 'access-token-1',
    tokenType: 'Bearer',
    expiresIn: 900,
  },
  refreshToken,
  refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message,
        details: err.details,
      },
    }),
  );
  return app;
}

describe('auth refresh cookie security contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('sets a httpOnly refresh cookie and does not leak refresh tokens in the login response body', async () => {
    mockAuthService.login.mockResolvedValue(sessionResult('refresh-token-login'));

    const res = await request(buildApp()).post('/auth/login').send({
      email: 'pm@example.com',
      password: 'Password1',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.tokens).toEqual({
      accessToken: 'access-token-1',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(res.body.data.tokens.refreshToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();

    const setCookie = res.get('Set-Cookie') || [];
    expect(setCookie.join(';')).toContain('pmc_refresh_token=refresh-token-login');
    expect(setCookie.join(';')).toContain('HttpOnly');
    expect(setCookie.join(';')).toContain('SameSite=Lax');
  });

  it('refreshes from the httpOnly cookie, rotates the cookie, and rejects body-only refresh tokens', async () => {
    mockAuthService.refresh.mockResolvedValue(sessionResult('refresh-token-rotated'));

    const bodyOnly = await request(buildApp())
      .post('/auth/refresh')
      .send({ refreshToken: 'body-token' });

    expect(bodyOnly.status).toBe(401);
    expect(mockAuthService.refresh).not.toHaveBeenCalled();

    const res = await request(buildApp())
      .post('/auth/refresh')
      .set('Cookie', ['pmc_refresh_token=refresh-token-original'])
      .send({});

    expect(res.status).toBe(200);
    expect(mockAuthService.refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: 'refresh-token-original',
      }),
    );
    expect(res.body.data.tokens.refreshToken).toBeUndefined();
    expect(res.get('Set-Cookie').join(';')).toContain(
      'pmc_refresh_token=refresh-token-rotated',
    );
  });

  it('revokes the refresh session and clears the cookie on logout', async () => {
    mockAuthService.logout.mockResolvedValue({ revoked: true });

    const res = await request(buildApp())
      .post('/auth/logout')
      .set('Cookie', ['pmc_refresh_token=refresh-token-original'])
      .send({});

    expect(res.status).toBe(200);
    expect(mockAuthService.logout).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: 'refresh-token-original',
      }),
    );
    expect(res.body).toEqual({
      success: true,
      data: { revoked: true },
    });
    expect(res.get('Set-Cookie').join(';')).toContain('pmc_refresh_token=;');
    expect(res.get('Set-Cookie').join(';')).toContain('HttpOnly');
    expect(res.get('Set-Cookie').join(';')).toContain('Max-Age=0');
  });
});
