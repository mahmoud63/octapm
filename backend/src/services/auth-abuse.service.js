const { HttpError } = require('../utils/http-error');

const EMAIL_BACKOFF_AFTER = 3;
const EMAIL_LOCK_AFTER = 5;
const IP_BACKOFF_AFTER = 15;
const IP_LOCK_AFTER = 30;
const LOCKOUT_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 60_000;

const emailAttempts = new Map();
const ipAttempts = new Map();
let nowOverride = null;

function nowMs() {
  return nowOverride ? nowOverride.getTime() : Date.now();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getEntry(store, key) {
  const entry = store.get(key) || {
    failures: 0,
    backoffUntil: null,
    lockedUntil: null,
  };
  store.set(key, entry);
  return entry;
}

function retryAfterSeconds(until, now) {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

function throwIfBlocked(entry, scope, currentNow) {
  if (entry.lockedUntil && entry.lockedUntil > currentNow) {
    throw new HttpError(
      429,
      'LOGIN_TEMPORARILY_LOCKED',
      'Too many failed login attempts. Try again later.',
      {
        scope,
        retryAfterSeconds: retryAfterSeconds(entry.lockedUntil, currentNow),
      },
    );
  }

  if (entry.backoffUntil && entry.backoffUntil > currentNow) {
    throw new HttpError(
      429,
      'LOGIN_BACKOFF',
      'Too many failed login attempts. Wait briefly before trying again.',
      {
        scope,
        retryAfterSeconds: retryAfterSeconds(entry.backoffUntil, currentNow),
      },
    );
  }
}

function computeBackoffMs(failures, backoffAfter) {
  if (failures < backoffAfter) return null;
  return Math.min(MAX_BACKOFF_MS, 2 ** (failures - backoffAfter) * 5_000);
}

function recordFailure(store, key, { backoffAfter, lockAfter }) {
  if (!key) return;

  const currentNow = nowMs();
  const entry = getEntry(store, key);
  entry.failures += 1;

  if (entry.failures >= lockAfter) {
    entry.lockedUntil = currentNow + LOCKOUT_MS;
    entry.backoffUntil = null;
    return;
  }

  const backoffMs = computeBackoffMs(entry.failures, backoffAfter);
  if (backoffMs) {
    entry.backoffUntil = currentNow + backoffMs;
  }
}

function assertLoginAllowed({ email, ipAddress }) {
  const currentNow = nowMs();
  const normalizedEmail = normalizeEmail(email);

  if (normalizedEmail && emailAttempts.has(normalizedEmail)) {
    throwIfBlocked(emailAttempts.get(normalizedEmail), 'email', currentNow);
  }

  if (ipAddress && ipAttempts.has(ipAddress)) {
    throwIfBlocked(ipAttempts.get(ipAddress), 'ip', currentNow);
  }
}

function recordLoginFailure({ email, ipAddress }) {
  const normalizedEmail = normalizeEmail(email);
  recordFailure(emailAttempts, normalizedEmail, {
    backoffAfter: EMAIL_BACKOFF_AFTER,
    lockAfter: EMAIL_LOCK_AFTER,
  });
  recordFailure(ipAttempts, ipAddress, {
    backoffAfter: IP_BACKOFF_AFTER,
    lockAfter: IP_LOCK_AFTER,
  });
}

function recordLoginSuccess({ email }) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    emailAttempts.delete(normalizedEmail);
  }
}

function resetAuthAbuseState() {
  emailAttempts.clear();
  ipAttempts.clear();
}

function setAuthAbuseNow(value) {
  nowOverride = value ? new Date(value) : null;
}

module.exports = {
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  resetAuthAbuseState,
  setAuthAbuseNow,
};
