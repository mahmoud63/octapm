/**
 * Cross-site request protection for the routes that use the refresh cookie
 * (/api/v1/auth: sign-in, refresh, sign-out, workspace sessions, SSO, MFA).
 *
 * CORS already stops another site from READING these answers, but not from
 * SENDING a form-style request the browser would attach the cookie to
 * (signing a victim out, rotating their session, a login CSRF that plants
 * someone else's session). A browser always names the page's origin on such a
 * request, so a state-changing request whose Origin is present and not one of
 * OctaPM's approved application origins (the CORS allowlist: app, portal,
 * admin — exact hosts, never *.octapm.com) is refused before any handler runs.
 *
 * A request with no Origin is not a browser cross-site request (the mobile
 * app, a server, curl) and goes on to the route's own checks; so do GET, HEAD
 * and OPTIONS, which change nothing (the SSO callback is a GET by design).
 */
const { HttpError } = require("../utils/http-error");
const { isCorsOriginAllowed } = require("../config/security");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const requireApprovedOrigin = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin === undefined) return next();
  // "null" is what sandboxed frames and some cross-site redirects send.
  if (typeof origin === "string" && origin !== "null" && isCorsOriginAllowed(origin)) return next();
  return next(new HttpError(403, "ORIGIN_NOT_ALLOWED", "This request did not come from an OctaPM application"));
};

module.exports = { requireApprovedOrigin, SAFE_METHODS };
