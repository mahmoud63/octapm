/**
 * An access token is honoured only while the account it names is active,
 * and with the role the account holds now (Phase 21D, CX21-485) — and only
 * while it was minted at the identity's current credential epoch (owner
 * decision D-ID-1 Q6: a reset, a closed identity or an admin second-factor
 * reset ends every earlier session).
 */
const mockPrisma = { user: { findUnique: jest.fn() } };
const mockVerifyAccessToken = jest.fn();
jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
// The real epoch comparison; only the signature check is stubbed.
jest.mock('../../utils/tokens', () => ({
  ...jest.requireActual('../../utils/tokens'),
  verifyAccessToken: (...args) => mockVerifyAccessToken(...args),
}));
jest.mock('../../services/api-client.service', () => ({ API_KEY_PREFIX: 'octapm_', authenticateApiKey: jest.fn() }));
const { authenticate, requireCredentialSession } = require('../auth');

const accessPayload = (extra = {}) => ({ sub: 'u1', orgId: 'org-1', role: 'pm', email: 'pm@x.test', name: 'Pat', isCompanyAdmin: false, type: 'access', ...extra });
const account = (extra = {}) => ({ id: 'u1', orgId: 'org-1', role: 'pm', status: 'active', isCompanyAdmin: false, ...extra });

const run = ({ method = 'GET', baseUrl = '/api/v1/projects', path = '/' } = {}) =>
  new Promise((resolve) => {
    const req = { headers: { authorization: 'Bearer token' }, method, baseUrl, path };
    authenticate(req, {}, (err) => resolve({ err: err ?? null, user: req.user }));
  });

describe('authenticate against the account as it is now', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset();
    mockVerifyAccessToken.mockReset();
    mockVerifyAccessToken.mockReturnValue(accessPayload());
  });

  it('CX21-485: refuses a deactivated account\'s token, and takes the role from the account, not the token', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(account({ status: 'inactive' }));
    const inactive = await run();
    expect(inactive.err).toMatchObject({ status: 401, code: 'USER_INACTIVE' });
    mockPrisma.user.findUnique.mockResolvedValueOnce(account({ role: 'site_engineer' }));
    const demoted = await run();
    expect(demoted.err).toBeNull();
    expect(demoted.user.role).toBe('site_engineer');
  });

  describe('credential epoch (D-ID-1 Q6)', () => {
    it('refuses an access token minted before the identity\'s last credential event with 401 SESSION_REVOKED', async () => {
      mockVerifyAccessToken.mockReturnValue(accessPayload({ cep: 0 }));
      mockPrisma.user.findUnique.mockResolvedValueOnce(account({ credentialEpoch: 1 }));
      const revoked = await run();
      expect(revoked.err).toMatchObject({ status: 401, code: 'SESSION_REVOKED' });
      expect(revoked.user).toBeUndefined();
    });

    it('honours a token minted at the current epoch, and a token with no epoch while the identity has none', async () => {
      mockVerifyAccessToken.mockReturnValue(accessPayload({ cep: 2 }));
      mockPrisma.user.findUnique.mockResolvedValueOnce(account({ credentialEpoch: 2 }));
      expect((await run()).err).toBeNull();

      // Tokens minted before the epoch existed count as epoch 0.
      mockVerifyAccessToken.mockReturnValue(accessPayload());
      mockPrisma.user.findUnique.mockResolvedValueOnce(account({ credentialEpoch: 0 }));
      expect((await run()).err).toBeNull();

      mockVerifyAccessToken.mockReturnValue(accessPayload());
      mockPrisma.user.findUnique.mockResolvedValueOnce(account({ credentialEpoch: 1 }));
      expect((await run()).err).toMatchObject({ status: 401, code: 'SESSION_REVOKED' });
    });

    it('applies to identity tokens too, reading the epoch with the account', async () => {
      mockVerifyAccessToken.mockReturnValue({ sub: 'u1', email: 'pm@x.test', name: 'Pat', type: 'identity', cep: 0 });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', status: 'active', credentialEpoch: 3 });
      const revoked = await run({ baseUrl: '/api/v1/auth', path: '/me' });
      expect(revoked.err).toMatchObject({ status: 401, code: 'SESSION_REVOKED' });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
        select: { id: true, status: true, credentialEpoch: true },
      });

      mockVerifyAccessToken.mockReturnValue({ sub: 'u1', email: 'pm@x.test', name: 'Pat', type: 'identity', cep: 3 });
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', status: 'active', credentialEpoch: 3 });
      const current = await run({ baseUrl: '/api/v1/auth', path: '/me' });
      expect(current.err).toBeNull();
      expect(current.user).toMatchObject({ id: 'u1', identityOnly: true });
    });
  });

  it('records which company\'s single sign-on issued the session (null for a password session)', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(account());
    expect((await run()).user.ssoOrgId).toBeNull();
    mockVerifyAccessToken.mockReturnValue(accessPayload({ sso: 'org-1' }));
    mockPrisma.user.findUnique.mockResolvedValueOnce(account());
    expect((await run()).user.ssoOrgId).toBe('org-1');
  });
});

describe('requireCredentialSession (D-ID-1 Q2)', () => {
  const guard = (user) => new Promise((resolve) => requireCredentialSession({ user }, {}, (err) => resolve(err ?? null)));

  it('refuses a session a company\'s single sign-on issued, the home company\'s included, with 403 SSO_SESSION_BOUND', async () => {
    await expect(guard({ id: 'u1', orgId: 'org-1', ssoOrgId: 'org-1' })).resolves.toMatchObject({ status: 403, code: 'SSO_SESSION_BOUND' });
    await expect(guard({ id: 'u1', orgId: 'org-1', ssoOrgId: 'org-2' })).resolves.toMatchObject({ status: 403, code: 'SSO_SESSION_BOUND' });
  });

  it('lets a session the person opened with their own credentials through', async () => {
    await expect(guard({ id: 'u1', orgId: 'org-1', ssoOrgId: null })).resolves.toBeNull();
    await expect(guard({ id: 'u1', orgId: 'org-1' })).resolves.toBeNull();
  });
});
