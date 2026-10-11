/**
 * Platform access holds the session, not only the account (domain
 * architecture §21): an operator's customer-application session that did not
 * prove the second factor itself, proved it too long ago, or predates a
 * credential event does not open the console — on any host.
 */
jest.mock("../../../config/db", () => ({ prisma: {} }));
const { resolvePlatformPrincipal, platformSessionMaxSeconds } = require("../platform-access.service");

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const nowSeconds = Math.floor(NOW / 1000);
const operator = (overrides = {}) => ({
  id: "u1",
  email: "ops@octapm-platform.test",
  name: "Ops",
  status: "active",
  mfaEnabled: true,
  credentialEpoch: 2,
  platformAccess: { role: "platform_superadmin", status: "active", revokedAt: null },
  ...overrides,
});
const tx = (user) => ({ user: { findUnique: async () => user } });
const env = { NODE_ENV: "production" };

const resolve = (user, session) => resolvePlatformPrincipal("u1", { tx: tx(user), env, session, now: NOW });

describe("platform console session", () => {
  it("opens for a session that proved the second factor recently", async () => {
    await expect(resolve(operator(), { epoch: 2, mfaAt: nowSeconds - 60 })).resolves.toMatchObject({ ok: true });
  });

  it("refuses a session that never proved the second factor (password-only, company SSO, invitation)", async () => {
    await expect(resolve(operator(), { epoch: 2, mfaAt: null })).resolves.toMatchObject({ ok: false, reason: "MFA_SESSION_REQUIRED" });
  });

  it("refuses a proof older than PLATFORM_ADMIN_SESSION_MAX_HOURS (12 h by default)", async () => {
    expect(platformSessionMaxSeconds({})).toBe(12 * 3600);
    await expect(resolve(operator(), { epoch: 2, mfaAt: nowSeconds - 13 * 3600 })).resolves.toMatchObject({ reason: "MFA_SESSION_REQUIRED" });
    expect(platformSessionMaxSeconds({ PLATFORM_ADMIN_SESSION_MAX_HOURS: "48" })).toBe(12 * 3600);
    expect(platformSessionMaxSeconds({ PLATFORM_ADMIN_SESSION_MAX_HOURS: "2" })).toBe(2 * 3600);
  });

  it("refuses a token from before the identity's last credential event", async () => {
    await expect(resolve(operator(), { epoch: 1, mfaAt: nowSeconds })).resolves.toMatchObject({ ok: false, reason: "SESSION_REVOKED" });
  });

  it("never opens for someone without platform access, whatever the session", async () => {
    const companyAdmin = operator({ platformAccess: null });
    await expect(resolve(companyAdmin, { epoch: 2, mfaAt: nowSeconds })).resolves.toMatchObject({ ok: false, reason: "NO_ACCESS" });
  });

  it("describes the account alone when no session is given (the profile's operator flag)", async () => {
    await expect(resolvePlatformPrincipal("u1", { tx: tx(operator()), env })).resolves.toMatchObject({ ok: true });
  });
});
