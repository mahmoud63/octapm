/**
 * Small helpers the identity live tests share: start a real API (or a bare
 * createApp() server) on a free port and talk JSON to it.
 */
const path = require("path");
const { freePort, spawnNode } = require("../../__live__/helpers");

// Generous limits: these tests fire many auth requests on purpose, and the
// per-process rate limiters are not what they are measuring.
const RELAXED_LIMITS = {
  RATE_LIMIT_AUTH_MAX: "10000",
  RATE_LIMIT_LOGIN_MAX: "10000",
  RATE_LIMIT_REFRESH_MAX: "10000",
  RATE_LIMIT_API_MAX: "10000",
};

const SERVE_APP = path.join(__dirname, "fixtures", "serve-app.js");

/**
 * Starts `src/index.js` (the real API entry point), or with `appOnly` a bare
 * createApp() server — for NODE_ENV=production runs, where index.js would
 * first insist on the complete production environment, which is not what a
 * test of one production behaviour is about.
 */
const startApi = async (env = {}, { appOnly = false } = {}) => {
  const port = await freePort();
  const proc = spawnNode(appOnly ? SERVE_APP : "src/index.js", {
    env: { ...RELAXED_LIMITS, ...env, PORT: String(port) },
  });
  await proc.waitForOutput(/running on port/, 30_000);
  const base = `http://127.0.0.1:${port}`;
  return {
    proc,
    port,
    base,
    async request(method, route, { body, headers = {} } = {}) {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, body: json, text, headers: response.headers };
    },
    post(route, body, headers) {
      return this.request("POST", route, { body, headers });
    },
    get(route, headers) {
      return this.request("GET", route, { headers });
    },
    stop() {
      return proc.kill();
    },
  };
};

module.exports = { RELAXED_LIMITS, startApi };
