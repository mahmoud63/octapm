const bcrypt = require("bcryptjs");

const store = { users: [], memberships: [], sessions: [], audit: [] };
const ORG = { id: "org-1", name: "Constech", mfaRequired: false, ssoEnabled: false, ssoRequired: false, ssoDomainsJson: [] };

// Just enough of Prisma's filters for the service's conditional writes.
const matches = (row, where) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((branch) => matches(row, branch));
    // The identity guard (D-ID-1 ID-GUARD): `memberships: { none: {...} }` on a User row.
    if (key === "memberships" && condition?.none) {
      return !store.memberships.some((membership) => membership.userId === row.id && matches(membership, condition.none));
    }
    if (condition && typeof condition === "object" && "lt" in condition) return row[key] !== null && row[key] < condition.lt;
    if (condition && typeof condition === "object" && "equals" in condition) return JSON.stringify(row[key]) === JSON.stringify(condition.equals);
    if (condition && typeof condition === "object" && "not" in condition) return row[key] !== condition.not;
    if (condition && typeof condition === "object" && "in" in condition) return condition.in.includes(row[key]);
    return row[key] === condition;
  });

// Prisma's `{ increment }` on a numeric column, as the credential epoch is written.
const applyData = (row, data) => {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    next[key] = value && typeof value === "object" && "increment" in value ? (row[key] ?? 0) + value.increment : value;
  }
  return next;
};

const mockSendEmail = jest.fn(async () => ({ delivered: true }));
jest.mock("../email.service", () => ({
  ...jest.requireActual("../email.service"),
  sendEmail: (...args) => mockSendEmail(...args),
}));

// What happened, in order: raw statements (the epoch hold, advisory locks),
// sessions written, and whether each ran inside a transaction.
const trace = [];
let txDepth = 0;

// The epoch hold (auth.service holdCredentialEpoch) is a raw
// `SELECT "id" FROM "User" WHERE "id" = $1 AND "credentialEpoch" = $2 AND "status" = 'active' FOR NO KEY UPDATE`
// (FOR SHARE until D-ID-1 R1: two shared holds upgrading to the lastLogin
// update deadlocked concurrent sign-ins of one person).
// Evaluated against the store by the columns the statement names, so a
// statement that stops naming the epoch also stops being held to it.
const evaluateUserHold = (strings, values) => {
  const sql = strings.join("?");
  if (!/FROM "User"/.test(sql)) throw new Error(`unexpected raw query: ${sql}`);
  const conditions = [];
  strings.slice(0, -1).forEach((segment, index) => {
    const column = segment.match(/"(\w+)"\s*=\s*$/);
    if (column) conditions.push([column[1], values[index]]);
  });
  for (const literal of sql.matchAll(/"(\w+)"\s*=\s*'([^']*)'/g)) conditions.push([literal[1], literal[2]]);
  return store.users
    .filter((user) => conditions.every(([column, value]) => (column === "credentialEpoch" ? user[column] ?? 0 : user[column]) === value))
    .map((user) => ({ id: user.id }));
};

const mockPrisma = {
  organisation: { findUnique: jest.fn(async ({ where }) => (where.id === ORG.id ? { ...ORG } : null)) },
  user: {
    findUnique: jest.fn(async ({ where, include }) => {
      const row = store.users.find((user) => (where.id && user.id === where.id) || (where.email && user.email === where.email));
      if (!row) return null;
      return include?.org ? { ...row, org: { ...ORG } } : { ...row };
    }),
    findFirst: jest.fn(async ({ where }) => {
      const row = store.users.find((user) => user.id === where.id && user.orgId === where.orgId);
      return row ? { ...row } : null;
    }),
    update: jest.fn(async ({ where, data }) => {
      const index = store.users.findIndex((user) => user.id === where.id);
      store.users[index] = { ...store.users[index], ...data };
      return { ...store.users[index] };
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      let count = 0;
      store.users = store.users.map((user) => (matches(user, where) ? (count += 1, applyData(user, data)) : user));
      return { count };
    }),
  },
  refreshSession: {
    create: jest.fn(async ({ data }) => {
      trace.push({ kind: "session", inTransaction: txDepth > 0 });
      return store.sessions.push({ revokedAt: null, ...data });
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      let count = 0;
      store.sessions = store.sessions.map((session) => (matches(session, where) ? (count += 1, { ...session, ...data }) : session));
      return { count };
    }),
  },
  // A credential event also spends the identity's unexchanged SSO tickets (Codex D-ID-1 diff review #3).
  ssoTicket: { updateMany: jest.fn(async () => ({ count: 0 })) },
  authAuditEvent: { create: jest.fn(async ({ data }) => store.audit.push(data)) },
  $queryRaw: jest.fn(async (strings, ...values) => {
    trace.push({ kind: "query", sql: strings.join("?"), values, inTransaction: txDepth > 0 });
    return evaluateUserHold(strings, values);
  }),
  $executeRaw: jest.fn(async (strings, ...values) => {
    trace.push({ kind: "lock", sql: strings.join("?"), values, inTransaction: txDepth > 0 });
    return 1;
  }),
  $transaction: jest.fn(async (fn) => {
    txDepth += 1;
    try {
      return await fn(mockPrisma);
    } finally {
      txDepth -= 1;
    }
  }),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const { totp } = require("../../utils/totp");
const mfaService = require("../mfa.service");
const authService = require("../auth.service");
const authAbuse = require("../auth-abuse.service");

const password = "Sunny-Day-42";
// A code is good once, so each accepted use takes its own step inside the
// drift window: -1 the previous step's code, 0 the current one, 1 the next.
const codeFor = (secret, offset = 0) => totp(secret, { time: Date.now() + offset * 30_000 });
// The admin-reset notice is sent in setImmediate, after the answer (D-ID-1 R3):
// let that callback (queued before this one) and its promise chain run.
const afterNotice = () => new Promise((resolve) => setImmediate(resolve));

describe("two-factor authentication", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.MFA_SECRET_KEY = "test-mfa-key";
  });
  beforeEach(() => {
    store.users = [{ id: "u-1", orgId: "org-1", name: "Pat", email: "pat@example.com", passwordHash: bcrypt.hashSync(password, 4), role: "pm", isCompanyAdmin: false, status: "active", mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnrolledAt: null, mfaLastTotpStep: null, mfaBackupCodesJson: [], ssoSubject: null, credentialEpoch: 0 }];
    store.memberships = [];
    store.sessions = [];
    store.audit = [];
    ORG.mfaRequired = false;
    trace.length = 0;
    txDepth = 0;
    authAbuse.resetAuthAbuseState();
    jest.clearAllMocks();
    mockSendEmail.mockImplementation(async () => ({ delivered: true }));
  });

  it("enrols with a QR code, confirms with a live code and hands out backup codes once", async () => {
    const setup = await mfaService.beginEnrollment({ userId: "u-1" });
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUrl).toContain("otpauth://totp/OctaPM:pat%40example.com?secret=");
    expect(setup.qrSvg).toContain("<svg");
    expect(store.users[0].mfaPendingSecretEnc).toMatch(/^v1\./);
    expect(store.users[0].mfaPendingSecretEnc).not.toContain(setup.secret);
    await expect(mfaService.enable({ userId: "u-1", code: "000000" })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    const enabled = await mfaService.enable({ userId: "u-1", code: totp(setup.secret) });
    expect(enabled.enabled).toBe(true);
    expect(enabled.backupCodes).toHaveLength(10);
    expect(enabled.backupCodes[0]).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(store.users[0]).toMatchObject({ mfaEnabled: true, mfaPendingSecretEnc: null });
    expect(store.users[0].mfaBackupCodesJson.every((row) => row.hash && !row.usedAt)).toBe(true);
    expect((await mfaService.status({ userId: "u-1" })).backupCodesRemaining).toBe(10);
    expect(store.audit.at(-1)).toMatchObject({ action: "mfa.enabled", userId: "u-1" });
  });

  it("challenges at login, accepts a TOTP or a backup code once, and issues the session", async () => {
    const setup = await mfaService.beginEnrollment({ userId: "u-1" });
    const { backupCodes } = await mfaService.enable({ userId: "u-1", code: totp(setup.secret) });

    const challenge = await authService.login({ email: "pat@example.com", password }, { ipAddress: "10.0.0.1" });
    expect(challenge).toMatchObject({ mfaRequired: true, methods: ["totp", "backup_code"] });
    expect(challenge.mfaToken).toMatch(/^eyJ/);
    expect(challenge.tokens).toBeUndefined();
    expect(store.sessions).toHaveLength(0);

    await expect(authService.completeMfaLogin({ mfaToken: challenge.mfaToken, code: "123456" })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    await expect(authService.completeMfaLogin({ mfaToken: "not-a-token", code: totp(setup.secret) })).rejects.toMatchObject({ code: "MFA_CHALLENGE_INVALID" });
    // The enrolment code is spent; the next step's code is not.
    await expect(authService.completeMfaLogin({ mfaToken: challenge.mfaToken, code: totp(setup.secret) })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    const loginCode = codeFor(setup.secret, 1);
    const session = await authService.completeMfaLogin({ mfaToken: challenge.mfaToken, code: loginCode }, { ipAddress: "10.0.0.1" });
    expect(session.user).toMatchObject({ id: "u-1", mfaEnabled: true });
    expect(session.tokens.accessToken).toMatch(/^eyJ/);
    expect(session.refreshToken).toMatch(/^eyJ/);
    expect(store.sessions).toHaveLength(1);
    expect(store.audit.map((row) => row.action)).toEqual(expect.arrayContaining(["mfa.challenged", "mfa.verified"]));
    await expect(authService.completeMfaLogin({ mfaToken: challenge.mfaToken, code: loginCode })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });

    const again = await authService.login({ email: "pat@example.com", password }, {});
    const viaBackup = await authService.completeMfaLogin({ mfaToken: again.mfaToken, code: backupCodes[3] });
    expect(viaBackup.tokens.accessToken).toBeTruthy();
    expect((await mfaService.status({ userId: "u-1" })).backupCodesRemaining).toBe(9);
    const third = await authService.login({ email: "pat@example.com", password }, {});
    await expect(authService.completeMfaLogin({ mfaToken: third.mfaToken, code: backupCodes[3] })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
  });

  it("flags enrolment as required by the organisation and lets admins reset a factor", async () => {
    ORG.mfaRequired = true;
    const session = await authService.login({ email: "pat@example.com", password }, {});
    expect(session.user.mfaEnrollmentRequired).toBe(true);
    expect((await mfaService.status({ userId: "u-1" })).enrollmentRequired).toBe(true);
    const setup = await mfaService.beginEnrollment({ userId: "u-1" });
    await mfaService.enable({ userId: "u-1", code: totp(setup.secret) });
    await expect(mfaService.disable({ userId: "u-1", password, code: codeFor(setup.secret, 1) })).rejects.toMatchObject({ code: "MFA_REQUIRED_BY_ORG" });
    await expect(mfaService.disable({ userId: "u-1", password: "wrong", code: totp(setup.secret) })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const reset = await mfaService.adminReset({ orgId: "org-1", userId: "u-1", actor: { id: "u-admin" } });
    expect(reset.reset).toBe(true);
    // A credential event (D-ID-1 Q6): the epoch moves, sessions end, the person is told.
    expect(store.users[0]).toMatchObject({ mfaEnabled: false, mfaSecretEnc: null, mfaLastTotpStep: null, mfaBackupCodesJson: [], credentialEpoch: 1 });
    expect(store.sessions.length).toBeGreaterThan(0);
    expect(store.sessions.every((row) => row.revokedAt instanceof Date)).toBe(true);
    expect(store.audit.map((row) => row.action)).toContain("mfa.reset_by_admin");
    expect(store.audit.find((row) => row.action === "mfa.reset_by_admin")).toMatchObject({ actorId: "u-admin" });
    await afterNotice();
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "pat@example.com", metadata: expect.objectContaining({ type: "mfa_reset_notice" }) }));
    ORG.mfaRequired = false;
    const setupAgain = await mfaService.beginEnrollment({ userId: "u-1" });
    await mfaService.enable({ userId: "u-1", code: codeFor(setupAgain.secret, -1) });
    const regenerateCode = codeFor(setupAgain.secret, 0);
    const regenerated = await mfaService.regenerateBackupCodes({ userId: "u-1", code: regenerateCode });
    expect(regenerated.backupCodes).toHaveLength(10);
    await expect(mfaService.regenerateBackupCodes({ userId: "u-1", code: regenerateCode })).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    const disabled = await mfaService.disable({ userId: "u-1", password, code: codeFor(setupAgain.secret, 1) });
    expect(disabled.enabled).toBe(false);
    expect(store.users[0].mfaLastTotpStep).toBeNull();
  });

  // D-ID-1 ID-GUARD: an identity-wide action one workspace takes is refused
  // while the person is part of any other workspace, active or suspended there.
  it.each(["active", "suspended"])("refuses an admin reset while the person is %s in another workspace, and changes nothing", async (status) => {
    store.users[0] = { ...store.users[0], mfaEnabled: true, mfaSecretEnc: "v1.sealed" };
    store.memberships = [{ id: "m-2", orgId: "org-2", userId: "u-1", status }];
    await expect(mfaService.adminReset({ orgId: "org-1", userId: "u-1", actor: { id: "u-admin" } })).rejects.toMatchObject({ status: 403, code: "IDENTITY_SHARED" });
    expect(store.users[0]).toMatchObject({ mfaEnabled: true, mfaSecretEnc: "v1.sealed", credentialEpoch: 0 });
    expect(mockPrisma.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("resets when the person only left another workspace, and refuses a person homed elsewhere", async () => {
    store.memberships = [{ id: "m-2", orgId: "org-2", userId: "u-1", status: "left" }];
    await expect(mfaService.adminReset({ orgId: "org-1", userId: "u-1", actor: { id: "u-admin" } })).resolves.toEqual({ reset: true });

    store.users.push({ ...store.users[0], id: "u-2", orgId: "org-2", email: "visitor@example.com" });
    // The visitor is not found in org-1 by the lookup (homed in org-2).
    await expect(mfaService.adminReset({ orgId: "org-1", userId: "u-2", actor: { id: "u-admin" } })).rejects.toMatchObject({ status: 404 });
  });

  it("still resets when the notice cannot be e-mailed, and audits the failed notice", async () => {
    store.users[0] = { ...store.users[0], mfaEnabled: true, mfaSecretEnc: "v1.sealed" };
    mockSendEmail.mockRejectedValue(Object.assign(new Error("provider down"), { code: "EMAIL_DELIVERY_FAILED" }));
    await expect(mfaService.adminReset({ orgId: "org-1", userId: "u-1", actor: { id: "u-admin" } })).resolves.toEqual({ reset: true });
    expect(store.users[0]).toMatchObject({ mfaEnabled: false, credentialEpoch: 1 });
    await afterNotice();
    expect(store.audit.at(-1)).toMatchObject({ action: "mfa.reset_notice_failed", metadataJson: { code: "EMAIL_DELIVERY_FAILED" } });
  });

  // D-ID-1 R3: the route drops the person's sockets when the service answers,
  // so the answer must not wait for the mail provider (up to its timeout).
  it("answers the admin reset before the notice is sent, even when the provider never answers", async () => {
    store.users[0] = { ...store.users[0], mfaEnabled: true, mfaSecretEnc: "v1.sealed" };
    mockSendEmail.mockImplementation(() => new Promise(() => {}));
    await expect(mfaService.adminReset({ orgId: "org-1", userId: "u-1", actor: { id: "u-admin" } })).resolves.toEqual({ reset: true });
    // Answered, and the notice has not even been handed to the provider yet.
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(store.users[0]).toMatchObject({ mfaEnabled: false, credentialEpoch: 1 });
    expect(store.sessions.every((row) => row.revokedAt instanceof Date)).toBe(true);
    await afterNotice();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "pat@example.com", metadata: expect.objectContaining({ type: "mfa_reset_notice" }) }));
  });

  it("voids a login challenge minted before a credential event (D-ID-1 Q6)", async () => {
    const setup = await mfaService.beginEnrollment({ userId: "u-1" });
    await mfaService.enable({ userId: "u-1", code: totp(setup.secret) });
    const challenge = await authService.login({ email: "pat@example.com", password }, {});
    expect(require("jsonwebtoken").decode(challenge.mfaToken)).toMatchObject({ sub: "u-1", type: "mfa", cep: 0 });
    // A password reset (or any credential event) meanwhile.
    store.users[0].credentialEpoch = 1;
    // Owner decision D-ID-1 Q6 names the answer: the session has ended, not a
    // malformed challenge (Codex D-ID-1 diff review, LOW "wrong MFA revocation code").
    await expect(authService.completeMfaLogin({ mfaToken: challenge.mfaToken, code: codeFor(setup.secret, 1) })).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
    expect(store.sessions).toHaveLength(0);
  });

  // Codex D-ID-1 diff review #1: the code is checked against the identity as it
  // was read; the session is minted in a transaction that first holds the User
  // row at that epoch (SELECT … FOR NO KEY UPDATE since D-ID-1 R1; FOR SHARE
  // before), before any session is written.
  it("holds the identity at the epoch the code was checked against, inside the issuing transaction, before the session is written", async () => {
    const setup = await mfaService.beginEnrollment({ userId: "u-1" });
    await mfaService.enable({ userId: "u-1", code: totp(setup.secret) });
    const challenge = await authService.login({ email: "pat@example.com", password }, {});
    trace.length = 0;
    const session = await authService.completeMfaLogin({ mfaToken: challenge.mfaToken, code: codeFor(setup.secret, 1) });
    const holds = trace.filter((entry) => entry.kind === "query");
    expect(holds.length).toBeGreaterThanOrEqual(1);
    for (const hold of holds) {
      expect(hold.sql).toMatch(/FROM "User" WHERE "id" = \? AND "credentialEpoch" = \? AND "status" = 'active' FOR NO KEY UPDATE$/);
      expect(hold.values).toEqual(["u-1", 0]);
      expect(hold.inTransaction).toBe(true);
    }
    const firstHold = trace.findIndex((entry) => entry.kind === "query");
    const firstSession = trace.findIndex((entry) => entry.kind === "session");
    expect(firstHold).toBeGreaterThanOrEqual(0);
    expect(firstSession).toBeGreaterThan(firstHold);
    expect(require("jsonwebtoken").decode(session.tokens.accessToken)).toMatchObject({ sub: "u-1", cep: 0 });
  });

  it("answers SESSION_REVOKED, and writes no session, when a reset commits between the code check and the issuance", async () => {
    const setup = await mfaService.beginEnrollment({ userId: "u-1" });
    await mfaService.enable({ userId: "u-1", code: totp(setup.secret) });
    const challenge = await authService.login({ email: "pat@example.com", password }, {});
    // The reset commits while this request waits for the row: the hold then
    // reads the User row as the reset left it (epoch 1).
    mockPrisma.$queryRaw.mockImplementationOnce(async (strings, ...values) => {
      store.users[0].credentialEpoch = 1;
      trace.push({ kind: "query", sql: strings.join("?"), values, inTransaction: txDepth > 0 });
      return evaluateUserHold(strings, values);
    });
    await expect(
      authService.completeMfaLogin({ mfaToken: challenge.mfaToken, code: codeFor(setup.secret, 1) }),
    ).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
    expect(store.sessions).toHaveLength(0);
    expect(mockPrisma.refreshSession.create).not.toHaveBeenCalled();
  });

  it("answers SESSION_REVOKED, and writes no session, when a reset commits between the password check and the issuance", async () => {
    mockPrisma.$queryRaw.mockImplementationOnce(async (strings, ...values) => {
      store.users[0].credentialEpoch = 1;
      return evaluateUserHold(strings, values);
    });
    await expect(authService.login({ email: "pat@example.com", password }, {})).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
    expect(store.sessions).toHaveLength(0);
    // At the epoch it was checked against, the same password signs in.
    store.users[0].credentialEpoch = 0;
    const session = await authService.login({ email: "pat@example.com", password }, {});
    expect(session.tokens.accessToken).toBeTruthy();
    expect(store.sessions).toHaveLength(1);
  });

  // Codex D-ID-1 diff review #4 and #3: the admin reset takes the identity lock
  // before its conditional write (so a membership another workspace is
  // accepting now is either committed and seen, or waits), and spends the
  // identity's unexchanged SSO tickets with its sessions.
  it("takes the identity lock before the guarded write, and spends the identity's SSO tickets with its sessions", async () => {
    store.users[0] = { ...store.users[0], mfaEnabled: true, mfaSecretEnc: "v1.sealed" };
    await expect(mfaService.adminReset({ orgId: "org-1", userId: "u-1", actor: { id: "u-admin" } })).resolves.toEqual({ reset: true });
    const identityLocks = trace.filter((entry) => entry.kind === "lock" && /hashtext\('identity'\)/.test(entry.sql));
    expect(identityLocks).toEqual([expect.objectContaining({ values: ["u-1"], inTransaction: true })]);
    expect(identityLocks[0].sql).toMatch(/pg_advisory_xact_lock/);
    expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mockPrisma.user.updateMany.mock.invocationCallOrder[0]);
    expect(mockPrisma.ssoTicket.updateMany).toHaveBeenCalledWith({ where: { userId: "u-1", usedAt: null }, data: { usedAt: expect.any(Date) } });
  });

  it("refuses the admin reset when another workspace's acceptance commits while it waits for the identity lock", async () => {
    store.users[0] = { ...store.users[0], mfaEnabled: true, mfaSecretEnc: "v1.sealed" };
    // The acceptance elsewhere held the identity lock; it commits, and only then
    // is the lock granted to the reset.
    mockPrisma.$executeRaw.mockImplementationOnce(async (strings, ...values) => {
      trace.push({ kind: "lock", sql: strings.join("?"), values, inTransaction: txDepth > 0 });
      store.memberships.push({ id: "m-2", orgId: "org-2", userId: "u-1", status: "active" });
      return 1;
    });
    await expect(mfaService.adminReset({ orgId: "org-1", userId: "u-1", actor: { id: "u-admin" } })).rejects.toMatchObject({ status: 403, code: "IDENTITY_SHARED" });
    expect(store.users[0]).toMatchObject({ mfaEnabled: true, mfaSecretEnc: "v1.sealed", credentialEpoch: 0 });
    expect(mockPrisma.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.ssoTicket.updateMany).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // D-ID-1 N2: the person's own factor changes (setup, enable, disable, new
  // backup codes) are written through writeOwnFactor — one conditional
  // updateMany at the epoch the request was authenticated at, and on the factor
  // state the request judged. A credential event in between answers 401
  // SESSION_REVOKED; any other change to that state answers 409
  // MFA_STATE_CHANGED. Nothing is written either way.
  describe("own-factor writes at the request's epoch and on the state read (D-ID-1 N2)", () => {
    const realUserUpdateMany = mockPrisma.user.updateMany.getMockImplementation();
    // `landed` commits just before the own-factor write (the only User
    // updateMany whose where names `status`; spending a code does not): the
    // other transaction committed while this request waited for the row.
    const beforeOwnFactorWrite = (landed) => {
      mockPrisma.user.updateMany.mockImplementation(async (args) => {
        if (args.where.status === "active") {
          mockPrisma.user.updateMany.mockImplementation(realUserUpdateMany);
          landed(store.users[0]);
        }
        return realUserUpdateMany(args);
      });
    };
    const ownFactorWrites = () => mockPrisma.user.updateMany.mock.calls.map(([args]) => args).filter((args) => args.where.status === "active");
    const enabledFactor = async () => {
      const setup = await mfaService.beginEnrollment({ userId: "u-1", epoch: 0 });
      await mfaService.enable({ userId: "u-1", code: totp(setup.secret), epoch: 0 });
      jest.clearAllMocks();
      store.audit = [];
      return setup;
    };
    afterEach(() => {
      mockPrisma.user.updateMany.mockImplementation(realUserUpdateMany);
    });

    it("enables at the request's epoch, on the pending seed it read", async () => {
      const setup = await mfaService.beginEnrollment({ userId: "u-1", epoch: 0 });
      const seed = store.users[0].mfaPendingSecretEnc;
      expect(ownFactorWrites()).toEqual([{ where: { id: "u-1", status: "active", credentialEpoch: 0, mfaEnabled: false }, data: { mfaPendingSecretEnc: seed } }]);
      jest.clearAllMocks();
      await expect(mfaService.enable({ userId: "u-1", code: totp(setup.secret), epoch: 0 })).resolves.toMatchObject({ enabled: true });
      expect(ownFactorWrites()).toEqual([expect.objectContaining({ where: { id: "u-1", status: "active", credentialEpoch: 0, mfaEnabled: false, mfaPendingSecretEnc: seed } })]);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(store.users[0]).toMatchObject({ mfaEnabled: true, mfaSecretEnc: seed, mfaPendingSecretEnc: null });
    });

    it("answers 401 SESSION_REVOKED to a setup from a session minted before a credential event, and writes no seed", async () => {
      store.users[0].credentialEpoch = 1;
      await expect(mfaService.beginEnrollment({ userId: "u-1", epoch: 0 })).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
      expect(store.users[0].mfaPendingSecretEnc).toBeNull();
    });

    it("answers 401 SESSION_REVOKED when the identity was closed meanwhile at the same epoch, and writes no seed", async () => {
      beforeOwnFactorWrite((user) => { user.status = "inactive"; });
      await expect(mfaService.beginEnrollment({ userId: "u-1", epoch: 0 })).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
      expect(store.users[0].mfaPendingSecretEnc).toBeNull();
    });

    it("refuses an enable whose code was checked before an admin reset committed (401 SESSION_REVOKED), and does not bring the cleared seed back", async () => {
      const setup = await mfaService.beginEnrollment({ userId: "u-1", epoch: 0 });
      jest.clearAllMocks();
      // The admin reset clears the pending seed and moves the epoch while this
      // enable, its code already verified, waits for the row.
      beforeOwnFactorWrite((user) => Object.assign(user, { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaBackupCodesJson: [], credentialEpoch: user.credentialEpoch + 1 }));
      await expect(mfaService.enable({ userId: "u-1", code: totp(setup.secret), epoch: 0 })).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
      expect(store.users[0]).toMatchObject({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaBackupCodesJson: [], credentialEpoch: 1 });
      expect(store.audit.map((row) => row.action)).not.toContain("mfa.enabled");
    });

    it("answers 409 MFA_STATE_CHANGED when another setup replaced the pending seed at the same epoch, and keeps the newer seed", async () => {
      const setup = await mfaService.beginEnrollment({ userId: "u-1", epoch: 0 });
      const newer = mfaService.seal("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
      jest.clearAllMocks();
      beforeOwnFactorWrite((user) => { user.mfaPendingSecretEnc = newer; });
      await expect(mfaService.enable({ userId: "u-1", code: totp(setup.secret), epoch: 0 })).rejects.toMatchObject({ status: 409, code: "MFA_STATE_CHANGED" });
      expect(store.users[0]).toMatchObject({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: newer, credentialEpoch: 0 });
      expect(store.audit.map((row) => row.action)).not.toContain("mfa.enabled");
    });

    it("refuses a disable proven before a password reset committed (401 SESSION_REVOKED), and the factor stays on", async () => {
      const setup = await enabledFactor();
      const sealed = store.users[0].mfaSecretEnc;
      beforeOwnFactorWrite((user) => Object.assign(user, { passwordHash: bcrypt.hashSync("Reset-Pass-99", 4), credentialEpoch: user.credentialEpoch + 1 }));
      await expect(mfaService.disable({ userId: "u-1", password, code: codeFor(setup.secret, 1), epoch: 0 })).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
      expect(store.users[0]).toMatchObject({ mfaEnabled: true, mfaSecretEnc: sealed, credentialEpoch: 1 });
      expect(ownFactorWrites()).toEqual([expect.objectContaining({ where: expect.objectContaining({ credentialEpoch: 0, mfaEnabled: true, passwordHash: expect.any(String) }) })]);
      expect(store.audit.map((row) => row.action)).not.toContain("mfa.disabled");
    });

    it("answers 409 MFA_STATE_CHANGED to a disable whose password changed meanwhile at the same epoch, and the factor stays on", async () => {
      const setup = await enabledFactor();
      beforeOwnFactorWrite((user) => { user.passwordHash = bcrypt.hashSync("Other-Pass-77", 4); });
      await expect(mfaService.disable({ userId: "u-1", password, code: codeFor(setup.secret, 1), epoch: 0 })).rejects.toMatchObject({ status: 409, code: "MFA_STATE_CHANGED" });
      expect(store.users[0]).toMatchObject({ mfaEnabled: true, credentialEpoch: 0 });
      expect(store.audit.map((row) => row.action)).not.toContain("mfa.disabled");
    });

    it("answers 409 MFA_STATE_CHANGED to new backup codes when the seed changed meanwhile, and keeps the codes there are", async () => {
      const setup = await enabledFactor();
      const codesBefore = store.users[0].mfaBackupCodesJson;
      const otherSeed = mfaService.seal("KRUGS4ZANFZSAYJAORSXG5BAONSWG4TF");
      beforeOwnFactorWrite((user) => { user.mfaSecretEnc = otherSeed; });
      await expect(mfaService.regenerateBackupCodes({ userId: "u-1", code: codeFor(setup.secret, 1), epoch: 0 })).rejects.toMatchObject({ status: 409, code: "MFA_STATE_CHANGED" });
      expect(store.users[0].mfaBackupCodesJson).toBe(codesBefore);
      expect(store.users[0].mfaSecretEnc).toBe(otherSeed);
      expect(store.audit.map((row) => row.action)).not.toContain("mfa.backup_codes_regenerated");
    });

    it("refuses new backup codes from a session minted before a credential event (401 SESSION_REVOKED)", async () => {
      const setup = await enabledFactor();
      const codesBefore = store.users[0].mfaBackupCodesJson;
      store.users[0].credentialEpoch = 1;
      await expect(mfaService.regenerateBackupCodes({ userId: "u-1", code: codeFor(setup.secret, 1), epoch: 0 })).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
      expect(store.users[0].mfaBackupCodesJson).toBe(codesBefore);
    });
  });

  it("refuses password login for SSO-only domains except company admins", async () => {
    mockPrisma.organisation.findUnique.mockImplementation(async () => ({ ...ORG, ssoEnabled: true, ssoRequired: true, ssoDomainsJson: ["example.com"] }));
    await expect(authService.login({ email: "pat@example.com", password }, {})).rejects.toMatchObject({ code: "SSO_REQUIRED" });
    store.users[0].isCompanyAdmin = true;
    const session = await authService.login({ email: "pat@example.com", password }, {});
    expect(session.tokens.accessToken).toBeTruthy();
  });
});

describe("Phase 21D — integrity (release challenge, second pass)", () => {
  it("CX21-429: enrolling a new device while two-factor is on is refused; it must be turned off first", async () => {
    store.users[0].mfaEnabled = true;
    await expect(mfaService.beginEnrollment({ userId: "u-1" })).rejects.toMatchObject({ code: "MFA_ALREADY_ENABLED", status: 409 });
    store.users[0].mfaEnabled = false;
  });
});
