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
