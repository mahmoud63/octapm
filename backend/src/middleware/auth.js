const { tokenEpochCurrent, verifyAccessToken } = require('../utils/tokens');
const { HttpError } = require('../utils/http-error');

const sessionRevoked = () =>
  new HttpError(401, 'SESSION_REVOKED', 'This session has ended; sign in again');
const { prisma } = require('../config/db');
const { API_KEY_PREFIX, authenticateApiKey } = require('../services/api-client.service');
const { resolveRequestPrincipal } = require('../services/membership.service');

const parseBearerToken = (authorizationHeader) => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
};

/**
 * The one place an identity token (a sign-in with no single workspace to
 * enter, membership doc §6) is honoured by the ordinary authenticate: the
 * caller's own profile, which is where the workspace picker reads the list
 * from. The workspace-session route verifies identity tokens itself.
 */
const IDENTITY_TOKEN_ROUTES = new Set(['GET /api/v1/auth/me']);
const routeKey = (req) =>
  `${req.method} ${String(req.baseUrl || '') + String(req.path || '')}`.replace(/\/$/, '');

const identityPrincipal = (payload) => ({
  id: payload.sub,
  orgId: null,
  membershipId: null,
  role: null,
  isAdmin: false,
  isOwner: false,
  isCompanyAdmin: false,
  orgKind: null,
  orgSlug: null,
  kind: null,
  email: payload.email,
  name: payload.name,
  identityOnly: true,
});

const authenticate = (req, res, next) => {
  try {
    // A router that mounts behind requireOrganizationMembership has already
    // been authenticated on this request; the header cannot have changed.
    if (req.user && req.authResolved) {
      return next();
    }

    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      return next(
        new HttpError(
          401,
          'AUTH_REQUIRED',
          'Missing or invalid Authorization header',
        ),
      );
    }

    // Public API keys (OCTA-INT-API-026) act as their owner, limited by scopes.
    if (token.startsWith(API_KEY_PREFIX)) {
      return authenticateApiKey(token)
        .then(({ user, apiClient }) => {
          req.user = user;
          req.apiClient = apiClient;
          req.authResolved = true;
          return next();
        })
        .catch(next);
    }

    const payload = verifyAccessToken(token, { allowIdentity: true });
    if (payload.type === 'identity') {
      if (!IDENTITY_TOKEN_ROUTES.has(routeKey(req))) {
        return next(
          new HttpError(
            401,
            'WORKSPACE_REQUIRED',
            'Choose a workspace before using this token',
          ),
        );
      }
      return prisma.user
        .findUnique({ where: { id: payload.sub }, select: { id: true, status: true, credentialEpoch: true } })
        .then((account) => {
          if (!account || account.status !== 'active') {
            return next(new HttpError(401, 'USER_INACTIVE', 'This account is no longer active'));
          }
          if (!tokenEpochCurrent(payload, account)) {
            return next(sessionRevoked());
          }
          req.user = identityPrincipal(payload);
          req.authResolved = true;
          return next();
        })
        .catch(next);
    }

    // The token is honoured only while the membership it names is active,
    // and with the role and standing that membership holds now — not those
    // it held when the token was minted: a deactivated or demoted person kept
    // their old authority until the token expired (Phase 21D, CX21-485). A
    // token minted before memberships existed carries no `mid`; it is held
    // to the person's membership in its organisation when one exists, and to
    // the User columns when none does (M4 dual-read).
    return resolveRequestPrincipal({
      tx: prisma,
      userId: payload.sub,
      orgId: payload.orgId,
      membershipId: payload.mid || null,
    })
      .then((principal) => {
        if (!principal) {
          return next(new HttpError(401, 'USER_INACTIVE', 'This account is no longer active'));
        }
        // A token minted before the identity's last credential event (a
        // reset, the identity closed) is dead (owner decision D-ID-1 Q6).
        if (!tokenEpochCurrent(payload, principal)) {
          return next(sessionRevoked());
        }
        req.user = {
          ...principal,
          email: principal.email || payload.email,
          name: principal.name || payload.name,
          // The company whose single sign-on issued this session, if any:
          // such a session cannot change the identity's own security (D-ID-1 Q2).
          ssoOrgId: payload.sso || null,
        };
        req.authResolved = true;
        return next();
      })
      .catch(next);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(
        new HttpError(401, 'TOKEN_EXPIRED', 'Access token has expired'),
      );
    }

    if (error.name === 'JsonWebTokenError') {
      return next(
        new HttpError(401, 'INVALID_TOKEN', 'Access token is invalid'),
      );
    }

    return next(error);
  }
};

/**
 * The gate every org-level router stands behind (architecture doc §2.3): the
 * caller must be in a workspace — an identity token is not — and, with
 * `{ kind: 'member' }`, must be a member of it rather than a guest: a party
 * member reaches their projects through the party predicate and nothing
 * org-wide (users, company workspace, inventory, portfolio, reports,
 * permissions). authenticate already guarantees an active membership, so
 * this is an assertion and the guest gate, not a second lookup. It runs
 * authenticate itself when the request has not been through it yet, so it
 * can be mounted in app.js ahead of routers that authenticate on their own.
 */
const requireOrganizationMembership = ({ kind = null } = {}) => {
  const guard = (req, res, next) => {
    if (!req.user) {
      return next(new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required'));
    }
    if (!req.user.orgId) {
      return next(
        new HttpError(401, 'WORKSPACE_REQUIRED', 'Choose a workspace before using this token'),
      );
    }
    if (kind === 'member' && req.user.kind === 'guest') {
      return next(
        new HttpError(403, 'GUEST_FORBIDDEN', 'Guests of this workspace cannot reach company-wide features'),
      );
    }
    return next();
  };
  return (req, res, next) => {
    if (req.user && req.authResolved) return guard(req, res, next);
    return authenticate(req, res, (error) => (error ? next(error) : guard(req, res, next)));
  };
};

/**
 * Changes to the identity's own security — its second factor — are made only
 * from a session the person opened with their own credentials (owner decision
 * D-ID-1 Q2). A session a company's single sign-on issued speaks for that
 * company's access to that company, not for the person's identity: with it,
 * one company could enrol a factor that then locks the person out of every
 * other workspace. Applied whichever company's SSO it was, the home one too.
 */
const requireCredentialSession = (req, _res, next) => {
  if (req.user?.ssoOrgId) {
    return next(
      new HttpError(
        403,
        'SSO_SESSION_BOUND',
        "This session came from a company's single sign-on; sign in with your own password to change your account security",
      ),
    );
  }
  return next();
};

module.exports = { authenticate, requireOrganizationMembership, requireCredentialSession };
