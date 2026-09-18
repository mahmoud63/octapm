const mockTx = {
  refreshSession: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(),
  refreshSession: {
    updateMany: jest.fn(),
  },
};

jest.mock('../../config/db', () => ({
  prisma: mockPrisma,
}));

const authService = require('../auth.service');
const { createRefreshToken, hashRefreshToken } = require('../../utils/tokens');

const activeUser = {
  id: 'user-1',
  orgId: 'org-1',
  name: 'Project Manager',
  email: 'pm@example.com',
  phone: null,
  role: 'pm',
  status: 'active',
};

describe('auth refresh sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'access-secret-with-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret-with-at-least-32-characters';
    process.env.JWT_EXPIRY = '15m';
    process.env.JWT_REFRESH_EXPIRY = '7d';
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback(mockTx),
    );
  });

  it('rotates refresh sessions and persists only token hashes', async () => {
    const originalToken = createRefreshToken(activeUser, 'session-1');
    const originalHash = hashRefreshToken(originalToken);

    mockTx.refreshSession.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: activeUser.id,
      orgId: activeUser.orgId,
      tokenHash: originalHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: null,
      replacedBySessionId: null,
      user: activeUser,
    });
    mockTx.refreshSession.create.mockImplementation(async ({ data }) => data);
    mockTx.refreshSession.update.mockResolvedValue({});

    const result = await authService.refresh({
      refreshToken: originalToken,
      userAgent: 'Jest',
      ipAddress: '127.0.0.1',
    });

    expect(result.tokens).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 900,
      }),
    );
    expect(result.tokens.refreshToken).toBeUndefined();
    expect(result.refreshToken).toEqual(expect.any(String));

    const createCall = mockTx.refreshSession.create.mock.calls[0][0];
    expect(createCall.data).toEqual(
      expect.objectContaining({
        userId: activeUser.id,
        orgId: activeUser.orgId,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        userAgent: 'Jest',
        ipAddress: '127.0.0.1',
      }),
    );
    expect(createCall.data.tokenHash).not.toBe(result.refreshToken);
    expect(createCall.data.tokenHash).not.toBe(originalToken);

    expect(mockTx.refreshSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
        replacedBySessionId: createCall.data.id,
      }),
    });
  });

  it('rejects replayed rotated tokens and revokes their replacement session', async () => {
    const originalToken = createRefreshToken(activeUser, 'session-1');
    const originalHash = hashRefreshToken(originalToken);

    mockTx.refreshSession.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: activeUser.id,
      orgId: activeUser.orgId,
      tokenHash: originalHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: new Date(),
      replacedBySessionId: 'session-2',
      user: activeUser,
    });
    mockPrisma.refreshSession.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      authService.refresh({ refreshToken: originalToken }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'REFRESH_TOKEN_REUSED',
    });

    // The revocation is issued outside the transaction that found the replay,
    // so the refusal cannot roll it back.
    expect(mockTx.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['session-1', 'session-2'] },
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
