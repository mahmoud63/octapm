/**
 * An access token is honoured only while the account it names is active,
 * and with the role the account holds now (Phase 21D, CX21-485).
 */
const mockPrisma = { user: { findUnique: jest.fn() } };
jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../../utils/tokens', () => ({ verifyAccessToken: jest.fn(() => ({ sub: 'u1', orgId: 'org-1', role: 'pm', email: 'pm@x.test', name: 'Pat', isCompanyAdmin: false })) }));
jest.mock('../../services/api-client.service', () => ({ API_KEY_PREFIX: 'octapm_', authenticateApiKey: jest.fn() }));
const { authenticate } = require('../auth');

const run = () => new Promise((resolve) => { const req = { headers: { authorization: 'Bearer token' } }; authenticate(req, {}, (err) => resolve({ err: err ?? null, user: req.user })); });

describe('authenticate against the account as it is now', () => {
  it('CX21-485: refuses a deactivated account\'s token, and takes the role from the account, not the token', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', orgId: 'org-1', role: 'pm', status: 'inactive', isCompanyAdmin: false });
    const inactive = await run();
    expect(inactive.err).toMatchObject({ status: 401, code: 'USER_INACTIVE' });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', orgId: 'org-1', role: 'site_engineer', status: 'active', isCompanyAdmin: false });
    const demoted = await run();
    expect(demoted.err).toBeNull();
    expect(demoted.user.role).toBe('site_engineer');
  });
});
