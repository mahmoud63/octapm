const {
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  resetAuthAbuseState,
  resolveAuthThrottleStoreKind,
  setAuthAbuseNow,
} = require('../auth-abuse.service');

const EMAIL = 'pm@example.com';
const IP = '203.0.113.10';

describe('auth abuse protection', () => {
  beforeEach(() => {
    resetAuthAbuseState();
    setAuthAbuseNow(new Date('2026-06-10T12:00:00.000Z'));
  });

  afterEach(() => {
    setAuthAbuseNow(null);
  });

  it('backs off repeated failed logins before temporary account lockout', async () => {
    await expect(
      assertLoginAllowed({ email: EMAIL, ipAddress: IP }),
    ).resolves.toBeUndefined();

    await recordLoginFailure({ email: EMAIL, ipAddress: IP });
    await recordLoginFailure({ email: EMAIL, ipAddress: IP });
    await recordLoginFailure({ email: EMAIL, ipAddress: IP });

    await expect(
      assertLoginAllowed({ email: EMAIL, ipAddress: IP }),
    ).rejects.toMatchObject({ status: 429, code: 'LOGIN_BACKOFF' });

    setAuthAbuseNow(new Date('2026-06-10T12:00:20.000Z'));
    await expect(
      assertLoginAllowed({ email: EMAIL, ipAddress: IP }),
    ).resolves.toBeUndefined();

    await recordLoginFailure({ email: EMAIL, ipAddress: IP });
    await recordLoginFailure({ email: EMAIL, ipAddress: IP });

    await expect(
      assertLoginAllowed({ email: EMAIL, ipAddress: IP }),
    ).rejects.toMatchObject({
      status: 429,
      code: 'LOGIN_TEMPORARILY_LOCKED',
    });
  });

  it('clears email backoff state after a successful login', async () => {
    await recordLoginFailure({ email: EMAIL, ipAddress: IP });
    await recordLoginFailure({ email: EMAIL, ipAddress: IP });
    await recordLoginFailure({ email: EMAIL, ipAddress: IP });
    await recordLoginSuccess({ email: EMAIL });

    await expect(
      assertLoginAllowed({ email: EMAIL, ipAddress: IP }),
    ).resolves.toBeUndefined();
  });
});

/**
 * The per-address count used to be a ratchet: failures only ever added to it,
 * and nothing — not even a hundred correct passwords — ever took one away.
 * After thirty lifetime failures from one address the fifteen-minute lock
 * expired but the count stayed at thirty, so the next single mistyped password
 * re-locked every person behind that address. A shared office reaches thirty in
 * ordinary use, and there was no way out of it.
 */
describe('a successful sign-in repays the address it came from', () => {
  const OFFICE = '203.0.113.77';
  const failTimes = async (n, email) => {
    for (let i = 0; i < n; i += 1) {
      await recordLoginFailure({ email: email || `person${i}@example.com`, ipAddress: OFFICE });
    }
  };

  beforeEach(() => {
    resetAuthAbuseState();
    setAuthAbuseNow(new Date('2026-06-10T12:00:00.000Z'));
  });

  afterEach(() => {
    setAuthAbuseNow(null);
  });

  it('does not re-lock the whole office on one stray password after the lock has run out', async () => {
    await failTimes(30);
    await expect(assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).rejects.toMatchObject(
      { status: 429, code: 'LOGIN_TEMPORARILY_LOCKED' },
    );

    // The lock runs its fifteen minutes and the address is free again.
    setAuthAbuseNow(new Date('2026-06-10T12:16:00.000Z'));
    await expect(assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).resolves.toBeUndefined();

    // Ordinary work resumes: people sign in correctly, which drains the count.
    for (let i = 0; i < 20; i += 1) {
      await recordLoginSuccess({ email: `person${i}@example.com`, ipAddress: OFFICE });
    }

    // One person now mistypes their password. The office must stay working.
    await recordLoginFailure({ email: 'tired@example.com', ipAddress: OFFICE });
    await expect(assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).resolves.toBeUndefined();
  });

  it('still locks an address that only ever fails', async () => {
    await failTimes(29);
    await expect(assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).rejects.toMatchObject(
      { status: 429 },
    );
    await failTimes(1);
    await expect(assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).rejects.toMatchObject(
      { code: 'LOGIN_TEMPORARILY_LOCKED' },
    );
  });

  it('will not let a valid password cut a lock that is already running', async () => {
    await failTimes(30);
    await recordLoginSuccess({ email: 'insider@example.com', ipAddress: OFFICE });
    await expect(assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).rejects.toMatchObject(
      { code: 'LOGIN_TEMPORARILY_LOCKED' },
    );
  });
});

describe('where the counts are kept', () => {
  it('keeps them in memory outside production and in Postgres in production', () => {
    expect(resolveAuthThrottleStoreKind({ NODE_ENV: 'development' })).toBe('memory');
    expect(resolveAuthThrottleStoreKind({ NODE_ENV: 'test' })).toBe('memory');
    expect(resolveAuthThrottleStoreKind({})).toBe('memory');
    expect(resolveAuthThrottleStoreKind({ NODE_ENV: 'production' })).toBe('postgres');
  });

  it('lets AUTH_THROTTLE_STORE name either one', () => {
    expect(resolveAuthThrottleStoreKind({ NODE_ENV: 'development', AUTH_THROTTLE_STORE: 'postgres' })).toBe('postgres');
    expect(resolveAuthThrottleStoreKind({ NODE_ENV: 'production', AUTH_THROTTLE_STORE: 'memory' })).toBe('memory');
    expect(resolveAuthThrottleStoreKind({ NODE_ENV: 'production', AUTH_THROTTLE_STORE: 'redis' })).toBe('postgres');
  });
});
