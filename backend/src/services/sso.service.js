const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const secretBox = require("../utils/secret-box");
const { apiUrl } = require("../utils/api-url");
const { seal, open } = require("./mfa.service");
const membershipService = require("./membership.service");

/**
 * Single sign-on (OCTA-SEC-AUTH-040): one OpenID Connect provider per
 * organisation (Azure AD / Entra, Okta, Google Workspace, Auth0, Keycloak…)
 * with discovery, authorization code + PKCE, ID-token verification against
 * the provider's JWKS, email-domain routing, optional auto-provisioning and
 * an "SSO only" policy. The browser never sees tokens in a URL: the
 * callback hands out a one-time ticket that the app exchanges for the
 * normal session.
 */

const ROLES = Object.freeze(["pm", "planning_eng", "qs", "cost_controller", "procurement", "warehouse", "site_engineer", "finance"]);
const STATE_EXPIRY = "10m";
const TICKET_TTL_MS = 2 * 60 * 1000;
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const discoveryCache = new Map();

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const domainOf = (email) => String(email || "").trim().toLowerCase().split("@")[1] || null;
const normalizeDomains = (value) => [...new Set((Array.isArray(value) ? value : String(value || "").split(/[,\s]+/)).map((item) => String(item || "").trim().toLowerCase().replace(/^@/, "")).filter((item) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(item)))];
const domainMatches = (email, domains) => {
  const domain = domainOf(email);
  return Boolean(domain && (Array.isArray(domains) ? domains : []).some((item) => item === domain || domain.endsWith(`.${item}`)));
};
const secretFor = (name) => {
  const value = process.env[name];
  if (!value) throw new HttpError(500, "CONFIG_ERROR", `Missing environment variable: ${name}`);
  return value;
};
const encryptSecret = (value) => (secretBox.isConfigured() ? secretBox.encrypt(value) : seal(value));
const decryptSecret = (value) => {
  if (!value) return null;
  try {
    return secretBox.isConfigured() ? secretBox.decrypt(value) : open(value);
  } catch {
    return open(value);
  }
};
const webAppUrl = () => (process.env.WEB_APP_URL || "http://localhost:5173").replace(/\/$/, "");
const redirectUri = () => process.env.SSO_REDIRECT_URI || apiUrl("/auth/sso/callback");
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const fetcher = (fetchImpl) => fetchImpl || globalThis.fetch;

// ─── Settings ─────────────────────────────────────────────────────────────

const settingsOut = (org) => ({
  enabled: Boolean(org.ssoEnabled),
  provider: org.ssoProvider || "oidc",
  issuer: org.ssoIssuer || null,
  clientId: org.ssoClientId || null,
  clientSecretSet: Boolean(org.ssoClientSecretEnc),
  domains: Array.isArray(org.ssoDomainsJson) ? org.ssoDomainsJson : [],
  autoProvision: false,
  defaultRole: org.ssoDefaultRole || "site_engineer",
  required: Boolean(org.ssoRequired),
  mfaRequired: Boolean(org.mfaRequired),
  redirectUri: redirectUri(),
  updatedAt: org.ssoUpdatedAt ? org.ssoUpdatedAt.toISOString() : null,
});

const settingsFor = async ({ orgId }) => {
  const org = await prisma.organisation.findUnique({ where: { id: orgId } });
  if (!org) throw new HttpError(404, "ORG_NOT_FOUND", "Organisation not found");
  return settingsOut(org);
};

const updateSettings = async ({ orgId, payload = {}, actor = null }) => {
  const org = await prisma.organisation.findUnique({ where: { id: orgId } });
  if (!org) throw new HttpError(404, "ORG_NOT_FOUND", "Organisation not found");
  const data = { ssoUpdatedAt: new Date() };
  if (payload.enabled !== undefined) data.ssoEnabled = Boolean(payload.enabled);
  if (payload.issuer !== undefined) {
    const issuer = trimOrNull(payload.issuer);
    if (issuer && !/^https:\/\//i.test(issuer) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(issuer)) throw new HttpError(400, "SSO_ISSUER_INVALID", "The issuer must be an https URL");
    data.ssoIssuer = issuer ? issuer.replace(/\/$/, "") : null;
  }
  if (payload.clientId !== undefined) data.ssoClientId = trimOrNull(payload.clientId);
  if (trimOrNull(payload.clientSecret)) data.ssoClientSecretEnc = encryptSecret(String(payload.clientSecret).trim());
  if (payload.domains !== undefined) data.ssoDomainsJson = normalizeDomains(payload.domains);
  // SSO no longer creates accounts or memberships (owner decision D-ID-1 Q1):
  // the setting is retired, and asking to turn it on is refused rather than
  // silently ignored, so an administrator is not misled about who can get in.
  if (payload.autoProvision === true) throw new HttpError(400, "SSO_AUTO_PROVISION_RETIRED", "Single sign-on no longer creates accounts; invite people and they can use SSO after accepting");
  if (payload.autoProvision !== undefined) data.ssoAutoProvision = false;
  if (payload.defaultRole !== undefined) {
    if (!ROLES.includes(payload.defaultRole)) throw new HttpError(400, "SSO_ROLE_INVALID", `Default role must be one of ${ROLES.join(", ")}`);
    data.ssoDefaultRole = payload.defaultRole;
  }
  if (payload.required !== undefined) data.ssoRequired = Boolean(payload.required);
  if (payload.mfaRequired !== undefined) data.mfaRequired = Boolean(payload.mfaRequired);
  data.ssoProvider = "oidc";
  const enabled = data.ssoEnabled ?? org.ssoEnabled;
  const issuer = data.ssoIssuer !== undefined ? data.ssoIssuer : org.ssoIssuer;
  const clientId = data.ssoClientId !== undefined ? data.ssoClientId : org.ssoClientId;
  const secretSet = Boolean(data.ssoClientSecretEnc || org.ssoClientSecretEnc);
  const domains = data.ssoDomainsJson ?? (Array.isArray(org.ssoDomainsJson) ? org.ssoDomainsJson : []);
  if (enabled && (!issuer || !clientId || !secretSet)) throw new HttpError(400, "SSO_INCOMPLETE", "Issuer, client id and client secret are needed before SSO can be enabled");
  if ((data.ssoRequired ?? org.ssoRequired) && !domains.length) throw new HttpError(400, "SSO_DOMAINS_REQUIRED", "Add at least one email domain before making SSO mandatory");
  const updated = await prisma.organisation.update({ where: { id: orgId }, data });
  if (prisma.authAuditEvent?.create) await prisma.authAuditEvent.create({ data: { orgId, actorId: actor?.id || null, actorRole: actor?.role || null, entityType: "organisation", entityId: orgId, action: "sso.settings_updated", metadataJson: { enabled: updated.ssoEnabled, issuer: updated.ssoIssuer, domains: updated.ssoDomainsJson, required: updated.ssoRequired, mfaRequired: updated.mfaRequired } } }).catch(() => null);
  return settingsOut(updated);
};

// ─── Discovery and verification ───────────────────────────────────────────

const discover = async (issuer, { fetchImpl = null } = {}) => {
  const base = String(issuer || "").replace(/\/$/, "");
  if (!base) throw new HttpError(400, "SSO_ISSUER_INVALID", "No issuer configured");
  const cached = discoveryCache.get(base);
  if (cached && cached.expiresAt > Date.now()) return cached.document;
  const response = await fetcher(fetchImpl)(`${base}/.well-known/openid-configuration`, { headers: { accept: "application/json" } });
  if (!response?.ok) throw new HttpError(502, "SSO_DISCOVERY_FAILED", `The identity provider's discovery document could not be read (${response?.status || "no response"})`);
  const document = await response.json();
  for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) if (!document?.[field]) throw new HttpError(502, "SSO_DISCOVERY_INVALID", `The discovery document has no ${field}`);
  discoveryCache.set(base, { document, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return document;
};

const jwkToPem = (jwk) => crypto.createPublicKey({ key: jwk, format: "jwk" }).export({ type: "spki", format: "pem" });

const verifyIdToken = async ({ idToken, document, issuer, clientId, nonce, fetchImpl = null }) => {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header) throw new HttpError(401, "SSO_TOKEN_INVALID", "The identity provider returned an unreadable token");
  const response = await fetcher(fetchImpl)(document.jwks_uri, { headers: { accept: "application/json" } });
  if (!response?.ok) throw new HttpError(502, "SSO_JWKS_FAILED", "The identity provider's signing keys could not be read");
  const { keys = [] } = await response.json();
  const key = keys.find((item) => item.kid === decoded.header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!key) throw new HttpError(401, "SSO_TOKEN_INVALID", "The token was signed with an unknown key");
  let claims;
  try {
    claims = jwt.verify(idToken, jwkToPem(key), { algorithms: ["RS256", "RS384", "RS512", "PS256", "ES256", "ES384"], audience: clientId, issuer: [issuer, `${issuer}/`, document.issuer].filter(Boolean) });
  } catch (error) {
    throw new HttpError(401, "SSO_TOKEN_INVALID", `The identity token could not be verified: ${error?.message || "unknown error"}`);
  }
  if (nonce && claims.nonce !== nonce) throw new HttpError(401, "SSO_TOKEN_INVALID", "The identity token does not match this sign-in");
  return claims;
};

// ─── Login flow ───────────────────────────────────────────────────────────

const orgForEmail = async (email) => {
  const domain = domainOf(email);
  if (!domain) return null;
  const orgs = await prisma.organisation.findMany({ where: { ssoEnabled: true, status: "active" }, select: { id: true, name: true, ssoDomainsJson: true, ssoRequired: true } });
  return orgs.find((org) => domainMatches(email, org.ssoDomainsJson)) || null;
};

/** Whether an email address signs in through SSO (by domain), for the sign-in form. */
const lookup = async ({ email }) => {
  const org = await orgForEmail(email);
  if (org) return { sso: true, required: Boolean(org.ssoRequired), orgName: org.name };
  const user = trimOrNull(email) ? await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() }, select: { org: { select: { id: true, name: true, ssoEnabled: true, ssoRequired: true, ssoDomainsJson: true } } } }) : null;
  if (user?.org?.ssoEnabled) return { sso: true, required: Boolean(user.org.ssoRequired && domainMatches(email, user.org.ssoDomainsJson)), orgName: user.org.name };
  return { sso: false, required: false, orgName: null };
};

const codeChallenge = (verifier) => crypto.createHash("sha256").update(verifier).digest("base64url");

/** Builds the provider's authorization URL for an email's organisation (or an explicit org). */
const start = async ({ email = null, orgId = null, redirectTo = null, fetchImpl = null }) => {
  let org = null;
  if (orgId) org = await prisma.organisation.findFirst({ where: { id: orgId, ssoEnabled: true } });
  else if (email) {
    const match = await orgForEmail(email);
    org = match ? await prisma.organisation.findUnique({ where: { id: match.id } }) : null;
    if (!org) {
      const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() }, select: { orgId: true } });
      org = user ? await prisma.organisation.findFirst({ where: { id: user.orgId, ssoEnabled: true } }) : null;
    }
  }
  if (!org) throw new HttpError(404, "SSO_NOT_CONFIGURED", "Single sign-on is not set up for this email address");
  const document = await discover(org.ssoIssuer, { fetchImpl });
  const verifier = crypto.randomBytes(32).toString("base64url");
  const nonce = crypto.randomBytes(16).toString("base64url");
  const state = jwt.sign({ type: "sso_state", orgId: org.id, nonce, verifier, redirectTo: trimOrNull(redirectTo)?.slice(0, 500) || null, hint: trimOrNull(email)?.toLowerCase() || null }, secretFor("JWT_SECRET"), { expiresIn: STATE_EXPIRY });
  const url = new URL(document.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", org.ssoClientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (email) url.searchParams.set("login_hint", String(email).trim().toLowerCase());
  return { authorizationUrl: url.toString(), orgName: org.name };
};

const verifyState = (state) => {
  let payload;
  try {
    payload = jwt.verify(String(state || ""), secretFor("JWT_SECRET"));
  } catch {
    throw new HttpError(400, "SSO_STATE_INVALID", "The sign-in took too long or was tampered with — start again");
  }
  if (payload.type !== "sso_state" || !payload.orgId) throw new HttpError(400, "SSO_STATE_INVALID", "Start the sign-in again");
  return payload;
};

/**
 * Handles the provider's redirect: exchanges the code, verifies the ID
 * token, finds or provisions the user and returns the URL the browser is
 * sent to (with a one-time ticket, or an error code).
 */
const callback = async ({ code, state, error = null, errorDescription = null }, context = {}, { fetchImpl = null } = {}) => {
  const fail = (codeName) => ({ redirectUrl: `${webAppUrl()}/sign-in?ssoError=${encodeURIComponent(codeName)}`, error: codeName });
  if (error) return fail(String(errorDescription || error).slice(0, 120));
  let payload;
  try {
    payload = verifyState(state);
  } catch (err) {
    return fail(err.code || "SSO_STATE_INVALID");
  }
  const org = await prisma.organisation.findFirst({ where: { id: payload.orgId, ssoEnabled: true } });
  if (!org) return fail("SSO_NOT_CONFIGURED");
  try {
    const document = await discover(org.ssoIssuer, { fetchImpl });
    const body = new URLSearchParams({ grant_type: "authorization_code", code: String(code || ""), redirect_uri: redirectUri(), client_id: org.ssoClientId, client_secret: decryptSecret(org.ssoClientSecretEnc) || "", code_verifier: payload.verifier });
    const response = await fetcher(fetchImpl)(document.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString() });
    const tokens = response?.ok ? await response.json() : null;
    if (!tokens?.id_token) throw new HttpError(401, "SSO_TOKEN_EXCHANGE_FAILED", `The identity provider refused the code (${response?.status || "no response"})`);
    const claims = await verifyIdToken({ idToken: tokens.id_token, document, issuer: org.ssoIssuer, clientId: org.ssoClientId, nonce: payload.nonce, fetchImpl });
    const email = trimOrNull(claims.email || claims.preferred_username || claims.upn)?.toLowerCase();
    if (!email || !email.includes("@")) throw new HttpError(401, "SSO_EMAIL_MISSING", "The identity provider did not return an email address");
    if (claims.email_verified === false) throw new HttpError(401, "SSO_EMAIL_UNVERIFIED", "The identity provider reports the email as unverified");
    // SSO signs people in; it never makes them (owner decision D-ID-1 Q1). The
    // person must already be part of this workspace — a membership here, or a
    // person homed here before memberships — which only an invitation they
    // accepted themselves (or the workspace's own creation) can have made.
    // Anyone else, whatever their account's state elsewhere, gets the same
    // refusal, decided before anything about their account is looked at.
    //
    // The provider's subject is linked per workspace (owner decision D-ID-1
    // Q2): this workspace's provider binds the person's sign-in here and
    // nowhere else, and another company's provider can never bind, block or
    // replace it.
    const subject = String(claims.sub);
    const notFound = () => new HttpError(403, "SSO_USER_NOT_FOUND", "No account here matches this sign-in — ask a company admin to invite you");
    const user = await prisma.user.findUnique({ where: { email } });
    let membership = user ? await membershipService.findMembership({ tx: prisma, orgId: org.id, userId: user.id }) : null;
    const legacyHome = Boolean(user) && !membership && user.orgId === org.id;
    const partOfWorkspace = legacyHome || (membership && membershipService.PRESENT_STATUSES.includes(membership.status));
    if (!partOfWorkspace) throw notFound();

    // From here the person is part of this workspace, whose administrators
    // already see them, so the specific answers tell nobody anything new.
    if (user.status !== "active") throw new HttpError(403, "USER_INACTIVE", "Your account is not active");
    if (membership && membership.status !== membershipService.MEMBERSHIP_STATUSES.ACTIVE) {
      throw new HttpError(403, "USER_INACTIVE", "Your account is not active");
    }
    const linkedHere = await prisma.organizationMembership.findFirst({
      where: { orgId: org.id, ssoSubject: subject },
      select: { userId: true },
    });
    if (linkedHere && linkedHere.userId !== user.id) {
      throw new HttpError(403, "SSO_IDENTITY_CONFLICT", "This sign-in belongs to a different account");
    }
    if (membership?.ssoSubject && membership.ssoSubject !== subject) {
      throw new HttpError(403, "SSO_IDENTITY_CONFLICT", "This sign-in belongs to a different account");
    }

    // A person homed here before memberships gets their row from their own
    // User columns — the entitlement they already had, not a new one.
    if (legacyHome) {
      // Under the lock a deactivation of this person here takes, so the row is
      // written before it (and then suspended by it) or after it (and then it
      // already exists, suspended) — never alongside it (D-ID-1 R2).
      const written = await prisma.$transaction(async (tx) => {
        if (typeof tx.$executeRaw === "function") {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org.id}), hashtext(${user.email}))`;
        }
        const row = await membershipService.ensureMembershipForUser({ tx, user, orgId: org.id });
        if (row && row.status !== membershipService.MEMBERSHIP_STATUSES.ACTIVE) {
          throw new HttpError(403, "USER_INACTIVE", "Your account is not active");
        }
        return row;
      });
      if (written) {
        membership = written;
        await membershipService.recordMembershipEvent({ tx: prisma, orgId: org.id, membership, action: "membership.created", context, metadata: { via: "sso_legacy_home", role: membership.role } });
      }
    }
    if (membership && !membership.ssoSubject) {
      // Linked only while still unlinked: two first sign-ins at once with two
      // different subjects cannot both bind, the second finds the link made.
      let linked;
      try {
        linked = await prisma.organizationMembership.updateMany({
          where: { id: membership.id, ssoSubject: null },
          data: { ssoSubject: subject, ssoLinkedAt: new Date() },
        });
      } catch (error) {
        // Another person's sign-in linked the same subject here a moment ago.
        if (error?.code === "P2002") throw new HttpError(403, "SSO_IDENTITY_CONFLICT", "This sign-in belongs to a different account");
        throw error;
      }
      const current = await prisma.organizationMembership.findUnique({ where: { id: membership.id } });
      if (linked.count !== 1 && current?.ssoSubject !== subject) {
        throw new HttpError(403, "SSO_IDENTITY_CONFLICT", "This sign-in belongs to a different account");
      }
      membership = current || membership;
    }
    const ticket = crypto.randomBytes(32).toString("base64url");
    // Written while the identity is held at the epoch read above (D-ID-1 Q6):
    // a reset landing before this either makes the hold refuse, or waits for
    // the ticket to exist and then voids it with the person's other tickets.
    await prisma.$transaction(async (tx) => {
      await require("./auth.service").holdCredentialEpoch(tx, user.id, Number.isInteger(user.credentialEpoch) ? user.credentialEpoch : 0);
      await tx.ssoTicket.create({ data: { orgId: org.id, userId: user.id, tokenHash: hashToken(ticket), expiresAt: new Date(Date.now() + TICKET_TTL_MS), ipAddress: context.ipAddress || null, ...(membership ? { membershipId: membership.id } : {}) } });
    });
    const target = new URL(`${webAppUrl()}/sso/complete`);
    target.searchParams.set("ticket", ticket);
    if (payload.redirectTo && payload.redirectTo.startsWith("/")) target.searchParams.set("redirect", payload.redirectTo);
    return { redirectUrl: target.toString(), userId: user.id, error: null };
  } catch (err) {
    if (prisma.authAuditEvent?.create) await prisma.authAuditEvent.create({ data: { orgId: org.id, entityType: "organisation", entityId: org.id, action: "sso.login_failed", ipAddress: context.ipAddress || null, userAgent: context.userAgent || null, metadataJson: { code: err?.code || "SSO_FAILED", message: String(err?.message || "").slice(0, 300) } } }).catch(() => null);
    return fail(err?.code || "SSO_FAILED");
  }
};

/** Exchanges the one-time ticket for the normal session payload. */
const complete = async ({ ticket }, context = {}) => {
  const row = trimOrNull(ticket) ? await prisma.ssoTicket.findUnique({ where: { tokenHash: hashToken(String(ticket).trim()) }, include: { user: true } }) : null;
  const now = new Date();
  if (!row || row.usedAt || row.expiresAt < now) throw new HttpError(401, "SSO_TICKET_INVALID", "The sign-in link has expired — start again");
  // The ticket is claimed by a conditional write, not by the read above: two
  // requests carrying the same ticket (a double-submit, or a retry that lands
  // on another API task) both pass the read, and only one may win the claim.
  const claimed = await prisma.ssoTicket.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gte: now } }, data: { usedAt: now } });
  if (claimed.count !== 1) throw new HttpError(401, "SSO_TICKET_INVALID", "The sign-in link has expired — start again");
  if (!row.user || row.user.status !== "active") throw new HttpError(403, "USER_INACTIVE", "Your account is not active");
  const authService = require("./auth.service");
  const user = await prisma.user.update({ where: { id: row.user.id }, data: { lastLogin: new Date() } });
  // The session is bound to the membership in the organisation the ticket was issued for — the SSO org, not the identity's home.
  // At the epoch the identity had when the ticket was read: a reset that lands
  // now is not answered with a session (D-ID-1 Q6).
  const payload = await prisma.$transaction((tx) =>
    authService.createAuthSessionPayload(tx, user, context, { orgId: row.orgId, ssoOrgId: row.orgId, expectedEpoch: row.user.credentialEpoch ?? 0 }),
  );
  if (prisma.authAuditEvent?.create) await prisma.authAuditEvent.create({ data: { orgId: user.orgId, userId: user.id, entityType: "user", entityId: user.id, action: "sso.login", email: user.email, ipAddress: context.ipAddress || null, userAgent: context.userAgent || null, metadataJson: {} } }).catch(() => null);
  return payload;
};

/** Reads the discovery document and reports the endpoints (for the settings page). */
const testConnection = async ({ orgId, fetchImpl = null }) => {
  const org = await prisma.organisation.findUnique({ where: { id: orgId } });
  if (!org?.ssoIssuer) throw new HttpError(400, "SSO_ISSUER_INVALID", "Enter the issuer first");
  discoveryCache.delete(org.ssoIssuer.replace(/\/$/, ""));
  const document = await discover(org.ssoIssuer, { fetchImpl });
  return { ok: true, issuer: document.issuer || org.ssoIssuer, authorizationEndpoint: document.authorization_endpoint, tokenEndpoint: document.token_endpoint, jwksUri: document.jwks_uri, scopes: Array.isArray(document.scopes_supported) ? document.scopes_supported : [], codeChallengeMethods: Array.isArray(document.code_challenge_methods_supported) ? document.code_challenge_methods_supported : [], redirectUri: redirectUri() };
};

/** Company admins' overview: who has MFA, who is linked to SSO. */
const securityOverview = async ({ orgId }) => {
  const [settings, users, links] = await Promise.all([
    settingsFor({ orgId }),
    prisma.user.findMany({ where: { orgId }, select: { id: true, name: true, email: true, role: true, status: true, isCompanyAdmin: true, mfaEnabled: true, mfaEnrolledAt: true, lastLogin: true }, orderBy: { name: "asc" } }),
    // This workspace's own SSO links (D-ID-1 Q2), not another company's.
    prisma.organizationMembership.findMany({ where: { orgId, ssoSubject: { not: null } }, select: { userId: true, ssoLinkedAt: true } }),
  ]);
  const linkedAt = new Map(links.map((link) => [link.userId, link.ssoLinkedAt]));
  return { sso: settings, mfaRequired: settings.mfaRequired, users: users.map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, isCompanyAdmin: user.isCompanyAdmin, mfaEnabled: user.mfaEnabled, mfaEnrolledAt: user.mfaEnrolledAt ? user.mfaEnrolledAt.toISOString() : null, ssoLinked: linkedAt.has(user.id), ssoLinkedAt: linkedAt.get(user.id) ? linkedAt.get(user.id).toISOString() : null, lastLogin: user.lastLogin ? user.lastLogin.toISOString() : null })), summary: { users: users.length, mfaEnabled: users.filter((user) => user.mfaEnabled).length, ssoLinked: users.filter((user) => linkedAt.has(user.id)).length } };
};

const clearDiscoveryCache = () => discoveryCache.clear();

module.exports = { ROLES, normalizeDomains, domainMatches, redirectUri, settingsFor, updateSettings, discover, verifyIdToken, lookup, start, verifyState, callback, complete, testConnection, securityOverview, clearDiscoveryCache };
