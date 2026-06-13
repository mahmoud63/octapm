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
});
