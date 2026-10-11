/**
 * OctaPM's canonical hosts — the one place the backend learns them
 * (docs/platform/OCTAPM_DOMAIN_ARCHITECTURE.md).
 *
 *   public  octapm.com          PUBLIC_SITE_URL  marketing site
 *   app     app.octapm.com      WEB_APP_URL      the customer application
 *   portal  portal.octapm.com   PORTAL_URL       external collaboration (consultants, project parties)
 *   admin   admin.octapm.com    ADMIN_URL        OctaPM platform administration
 *   market  market.octapm.com   MARKET_URL       OctaMarket (its own product; never in CORS)
 *
 * A host chooses the experience; it never grants anything. Every link the
 * backend writes into an e-mail, a redirect or an export is built here from
 * the audience it is for (an invitation's party, a notification's recipient),
 * never from the recipient's e-mail address.
 *
 * One frontend serving every surface (local development, a single-host
 * deployment) is the default: portal and admin fall back to the app's URL.
 */

const SURFACES = Object.freeze({
  PUBLIC: "public",
  APP: "app",
  PORTAL: "portal",
  ADMIN: "admin",
  MARKET: "market",
});
const SURFACE_LIST = Object.freeze(Object.values(SURFACES));
// The surfaces a person can ask a link to come back to (a reset, a sign-in).
const RETURN_SURFACES = Object.freeze([SURFACES.APP, SURFACES.PORTAL, SURFACES.ADMIN]);

const DEVELOPMENT_APP_URL = "http://localhost:5173";

const first = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .find(Boolean) || null;

/** An origin (scheme://host[:port]) with no trailing slash, or null when unset or unparseable. */
const originOf = (value) => {
  const raw = first(value);
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
};

/**
 * The app's URL: WEB_APP_URL, then the older FRONTEND_URL / PUBLIC_APP_URL
 * spellings every link builder used to read on its own.
 */
const appUrl = (env = process.env) =>
  originOf(env.WEB_APP_URL) || originOf(env.FRONTEND_URL) || originOf(env.PUBLIC_APP_URL) || DEVELOPMENT_APP_URL;

/** The base URL of a surface; null only for a market that is not configured. */
const surfaceUrl = (surface, env = process.env) => {
  switch (surface) {
    case SURFACES.APP:
      return appUrl(env);
    case SURFACES.PORTAL:
      return originOf(env.PORTAL_URL) || appUrl(env);
    case SURFACES.ADMIN:
      return originOf(env.ADMIN_URL) || appUrl(env);
    case SURFACES.PUBLIC:
      return originOf(env.PUBLIC_SITE_URL) || originOf(env.BRAND_PUBLIC_URL) || appUrl(env);
    case SURFACES.MARKET:
      return originOf(env.MARKET_URL);
    default:
      throw new Error(`Unknown surface "${surface}"`);
  }
};

/** Whether a configuration gives the portal or the admin console a host of its own. */
const isSplitHosting = (env = process.env) => Boolean(originOf(env.PORTAL_URL) || originOf(env.ADMIN_URL));

/**
 * An absolute URL on a surface for an application path ("/accept-invite",
 * "/o/acme/projects/…?recordId=…"). Only a path is accepted: a value that is
 * already absolute, or protocol-relative, is refused rather than trusted.
 */
const buildUrl = (surface, path = "/", query = {}, env = process.env) => {
  const base = surfaceUrl(surface, env);
  if (!base) throw new Error(`${surface} has no configured URL`);
  const value = String(path || "/");
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    throw new Error(`Links are built from an application path, not "${value.slice(0, 40)}"`);
  }
  const url = new URL(value, `${base}/`);
  for (const [key, val] of Object.entries(query || {})) {
    if (val !== undefined && val !== null) url.searchParams.set(key, String(val));
  }
  return url.toString();
};

/** A surface name from untrusted input, or the fallback. */
const parseReturnSurface = (value, fallback = SURFACES.APP) =>
  RETURN_SURFACES.includes(value) ? value : fallback;

/**
 * Where an invitation is accepted. A project-party invitation (a consultant,
 * any external company on a project) belongs to the external collaboration
 * portal; every other one — a workspace member, a project member — to the app.
 */
const invitationSurface = (invitation = {}) => (invitation.projectPartyId ? SURFACES.PORTAL : SURFACES.APP);

/**
 * A same-application return path, or null: one leading slash, no scheme, no
 * protocol-relative or backslash trick, no control characters.
 */
const safeReturnPath = (value) => {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(path) || path.length > 500) return null;
  return path;
};

/**
 * The origins of OctaPM's own browser surfaces that call this API. Market is
 * a separate product and the public site does not call the authenticated API,
 * so neither is here.
 */
const applicationOrigins = (env = process.env) =>
  [...new Set([originOf(env.PORTAL_URL), originOf(env.ADMIN_URL)].filter(Boolean))];

module.exports = {
  SURFACES,
  SURFACE_LIST,
  RETURN_SURFACES,
  appUrl,
  surfaceUrl,
  isSplitHosting,
  buildUrl,
  parseReturnSurface,
  invitationSurface,
  safeReturnPath,
  applicationOrigins,
  originOf,
};
