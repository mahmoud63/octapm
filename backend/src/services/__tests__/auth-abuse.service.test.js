const {
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  resetAuthAbuseState,
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

  it('backs off repeated failed logins before temporary account lockout', () => {
    expect(() =>
      assertLoginAllowed({ email: EMAIL, ipAddress: IP }),
    ).not.toThrow();

    recordLoginFailure({ email: EMAIL, ipAddress: IP });
    recordLoginFailure({ email: EMAIL, ipAddress: IP });
    recordLoginFailure({ email: EMAIL, ipAddress: IP });

    expect(() =>
      assertLoginAllowed({ email: EMAIL, ipAddress: IP }),
    ).toThrow(expect.objectContaining({ status: 429, code: 'LOGIN_BACKOFF' }));

    setAuthAbuseNow(new Date('2026-06-10T12:00:20.000Z'));
    expect(() =>
      assertLoginAllowed({ email: EMAIL, ipAddress: IP }),
    ).not.toThrow();

    recordLoginFailure({ email: EMAIL, ipAddress: IP });
    recordLoginFailure({ email: EMAIL, ipAddress: IP });

    expect(() =>
      assertLoginAllowed({ email: EMAIL, ipAddress: IP }),
    ).toThrow(
      expect.objectContaining({
        status: 429,
        code: 'LOGIN_TEMPORARILY_LOCKED',
      }),
    );
  });

  it('clears email backoff state after a successful login', () => {
    recordLoginFailure({ email: EMAIL, ipAddress: IP });
    recordLoginFailure({ email: EMAIL, ipAddress: IP });
    recordLoginFailure({ email: EMAIL, ipAddress: IP });
    recordLoginSuccess({ email: EMAIL });

    expect(() =>
      assertLoginAllowed({ email: EMAIL, ipAddress: IP }),
    ).not.toThrow();
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
  const failTimes = (n, email) => {
    for (let i = 0; i < n; i += 1) {
      recordLoginFailure({ email: email || `person${i}@example.com`, ipAddress: OFFICE });
    }
  };

  beforeEach(() => {
    resetAuthAbuseState();
    setAuthAbuseNow(new Date('2026-06-10T12:00:00.000Z'));
  });

  afterEach(() => {
    setAuthAbuseNow(null);
  });

  it('does not re-lock the whole office on one stray password after the lock has run out', () => {
    failTimes(30);
    expect(() => assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).toThrow(
      expect.objectContaining({ status: 429, code: 'LOGIN_TEMPORARILY_LOCKED' }),
    );

    // The lock runs its fifteen minutes and the address is free again.
    setAuthAbuseNow(new Date('2026-06-10T12:16:00.000Z'));
    expect(() => assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).not.toThrow();

    // Ordinary work resumes: people sign in correctly, which drains the count.
    for (let i = 0; i < 20; i += 1) {
      recordLoginSuccess({ email: `person${i}@example.com`, ipAddress: OFFICE });
    }

    // One person now mistypes their password. The office must stay working.
    recordLoginFailure({ email: 'tired@example.com', ipAddress: OFFICE });
    expect(() => assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).not.toThrow();
  });

  it('still locks an address that only ever fails', () => {
    failTimes(29);
    expect(() => assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).toThrow(
      expect.objectContaining({ status: 429 }),
    );
    failTimes(1);
    expect(() => assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).toThrow(
      expect.objectContaining({ code: 'LOGIN_TEMPORARILY_LOCKED' }),
    );
  });

  it('will not let a valid password cut a lock that is already running', () => {
    failTimes(30);
    recordLoginSuccess({ email: 'insider@example.com', ipAddress: OFFICE });
    expect(() => assertLoginAllowed({ email: 'anyone@example.com', ipAddress: OFFICE })).toThrow(
      expect.objectContaining({ code: 'LOGIN_TEMPORARILY_LOCKED' }),
    );
  });
});
