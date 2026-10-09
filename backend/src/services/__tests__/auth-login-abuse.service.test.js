const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../config/db', () => ({
  prisma: mockPrisma,
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const authAbuseService = require('../auth-abuse.service');
const authService = require('../auth.service');

const activeUser = {
  id: 'user-1',
  orgId: 'org-1',
  name: 'Project Manager',
  email: 'pm@example.com',
  phone: null,
  passwordHash: 'hashed-password',
  role: 'pm',
  status: 'active',
};

describe('auth login abuse integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authAbuseService.resetAuthAbuseState();
    authAbuseService.setAuthAbuseNow(new Date('2026-06-10T12:00:00.000Z'));
    mockPrisma.user.findUnique.mockResolvedValue(activeUser);
    bcrypt.compare.mockResolvedValue(false);
  });

  afterEach(() => {
    authAbuseService.setAuthAbuseNow(null);
  });

  it('locks repeated bad-password attempts before another password comparison is attempted', async () => {
    const credentials = {
      email: 'pm@example.com',
      password: 'wrong-password',
    };
    const context = { ipAddress: '203.0.113.11' };

    await expect(authService.login(credentials, context)).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    await expect(authService.login(credentials, context)).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    await expect(authService.login(credentials, context)).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });

    authAbuseService.setAuthAbuseNow(
      new Date('2026-06-10T12:00:06.000Z'),
    );
    await expect(authService.login(credentials, context)).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });

    authAbuseService.setAuthAbuseNow(
      new Date('2026-06-10T12:00:20.000Z'),
    );
    await expect(authService.login(credentials, context)).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });

    await expect(authService.login(credentials, context)).rejects.toMatchObject({
      status: 429,
      code: 'LOGIN_TEMPORARILY_LOCKED',
    });
    expect(bcrypt.compare).toHaveBeenCalledTimes(5);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(5);
  });

  // Owner decision D-ID-1 Q7: an unknown address does the same password work
  // as a known one (a comparison against a cost-12 hash of a secret nobody
  // holds), so the answer's timing does not say whether it has an account.
  it('compares the password for an unknown address too, and answers exactly as for a wrong password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    bcrypt.hash.mockResolvedValue('dummy-cost-12-hash');

    const unknown = await authService.login({ email: 'nobody@example.com', password: 'whatever-1' }, { ipAddress: '203.0.113.12' }).catch((error) => error);
    expect(unknown).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    expect(bcrypt.compare).toHaveBeenCalledWith('whatever-1', expect.any(String));
    // The stand-in hash is made at cost 12 (once per process, then reused).
    expect(bcrypt.hash).toHaveBeenCalledWith(expect.any(String), 12);
    expect(bcrypt.compare).toHaveBeenCalledWith('whatever-1', 'dummy-cost-12-hash');

    mockPrisma.user.findUnique.mockResolvedValue(activeUser);
    const wrong = await authService.login({ email: 'pm@example.com', password: 'whatever-1' }, { ipAddress: '203.0.113.13' }).catch((error) => error);
    expect(wrong).toMatchObject({ status: unknown.status, code: unknown.code, message: unknown.message });
    expect(bcrypt.compare).toHaveBeenLastCalledWith('whatever-1', 'hashed-password');
  });
});
