const bcrypt = require("bcryptjs");

const store = { users: [], sessions: [], audit: [] };
const ORG = { id: "org-1", name: "Constech", mfaRequired: false, ssoEnabled: false, ssoRequired: false, ssoDomainsJson: [] };

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
  },
  refreshSession: { create: jest.fn(async ({ data }) => store.sessions.push(data)) },
  authAuditEvent: { create: jest.fn(async ({ data }) => store.audit.push(data)) },
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const { totp } = require("../../utils/totp");
const mfaService = require("../mfa.service");
const authService = require("../auth.service");
const authAbuse = require("../auth-abuse.service");

const password = "Sunny-Day-42";

describe("two-factor authentication", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.MFA_SECRET_KEY = "test-mfa-key";
  });
  beforeEach(() => {
    store.users = [{ id: "u-1", orgId: "org-1", name: "Pat", email: "pat@example.com", passwordHash: bcrypt.hashSync(password, 4), role: "pm", isCompanyAdmin: false, status: "active", mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnrolledAt: null, mfaBackupCodesJson: [], ssoSubject: null }];
    store.sessions = [];
    store.audit = [];
    ORG.mfaRequired = false;
    authAbuse.resetAuthAbuseState();
    jest.clearAllMocks();
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
    const session = await authService.completeMfaLogin({ mfaToken: challenge.mfaToken, code: totp(setup.secret) }, { ipAddress: "10.0.0.1" });
    expect(session.user).toMatchObject({ id: "u-1", mfaEnabled: true });
    expect(session.tokens.accessToken).toMatch(/^eyJ/);
    expect(session.refreshToken).toMatch(/^eyJ/);
    expect(store.sessions).toHaveLength(1);
    expect(store.audit.map((row) => row.action)).toEqual(expect.arrayContaining(["mfa.challenged", "mfa.verified"]));

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
    await expect(mfaService.disable({ userId: "u-1", password, code: totp(setup.secret) })).rejects.toMatchObject({ code: "MFA_REQUIRED_BY_ORG" });
    await expect(mfaService.disable({ userId: "u-1", password: "wrong", code: totp(setup.secret) })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const reset = await mfaService.adminReset({ orgId: "org-1", userId: "u-1", actor: { id: "u-admin" } });
    expect(reset.reset).toBe(true);
    expect(store.users[0]).toMatchObject({ mfaEnabled: false, mfaSecretEnc: null, mfaBackupCodesJson: [] });
    expect(store.audit.at(-1)).toMatchObject({ action: "mfa.reset_by_admin", actorId: "u-admin" });
    ORG.mfaRequired = false;
    const setupAgain = await mfaService.beginEnrollment({ userId: "u-1" });
    await mfaService.enable({ userId: "u-1", code: totp(setupAgain.secret) });
    const regenerated = await mfaService.regenerateBackupCodes({ userId: "u-1", code: totp(setupAgain.secret) });
    expect(regenerated.backupCodes).toHaveLength(10);
    const disabled = await mfaService.disable({ userId: "u-1", password, code: totp(setupAgain.secret) });
    expect(disabled.enabled).toBe(false);
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
