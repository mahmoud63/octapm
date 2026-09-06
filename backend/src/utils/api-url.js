/**
 * This API's own public URL.
 *
 * `API_BASE_URL` gets written both ways in practice — the bare origin
 * (`https://api.example.com`) and the mounted API root
 * (`https://api.example.com/api/v1`) — and an OAuth redirect URI has to match
 * what was registered with the provider exactly. So accept either spelling:
 * strip a trailing `/api/v<n>` and build every path from the origin.
 */
const API_ROOT = "/api/v1";

const apiOrigin = (env = process.env) =>
  String(env.API_BASE_URL || env.WEB_APP_URL || "http://localhost:5000")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/v\d+$/i, "");

/** Absolute URL for a path below the API root, e.g. `/auth/sso/callback`. */
const apiUrl = (path, env = process.env) =>
  `${apiOrigin(env)}${API_ROOT}/${String(path || "").replace(/^\/+/, "")}`;

module.exports = { API_ROOT, apiOrigin, apiUrl };
