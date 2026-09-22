/**
 * The production boot check reads DATABASE_URL the way Prisma will.
 *
 * Before: the check read the FIRST copy of each query parameter while Prisma
 * honours the LAST, so `sslmode=require&...&sslmode=disable` passed the check
 * and then connected in plaintext; a connection_limit written into the URL
 * was checked for presence only, so `connection_limit=0` (no bound) and
 * `connection_limit=abc` (every query fails after boot) both booted; and
 * INBOUND_EMAIL_DOMAIN, out of scope at launch, was accepted whenever its
 * secret was set.
 *
 * The first block proves the premise against the real local Postgres (which
 * speaks no TLS): Prisma refuses sslmode=require, but connects when a second
 * sslmode=disable follows it. The second block boots the real app under the
 * production check and expects it to refuse each of those environments.
 */
const { freePort, liveDescribe, spawnNode } = require("./helpers");
const { productionEnv, rawDatabaseUrl } = require("./fixtures/edge-env");

const APP = "src/__live__/fixtures/edge-app-server.js";
const PROBE = "src/__live__/fixtures/pool-probe.js";

const withParams = (url, params) => `${url}${url.includes("?") ? "&" : "?"}${params}`;

liveDescribe("production DATABASE_URL as Prisma reads it", () => {
  const started = [];
  const start = (entry, env) => {
    const proc = spawnNode(entry, { env });
    started.push(proc);
    return proc;
  };

  afterAll(async () => {
    await Promise.all(started.map((proc) => proc.kill()));
  });

  describe("Prisma honours the last copy of a repeated parameter", () => {
    const probe = async (params) => {
      const proc = start(PROBE, {
        NODE_ENV: "development",
        DATABASE_URL: withParams(rawDatabaseUrl(), params),
        DATABASE_CONNECTION_LIMIT: "1",
        DATABASE_POOL_TIMEOUT_SECONDS: undefined,
        PROBE_CONCURRENCY: "1",
        PROBE_SLEEP_SECONDS: "0",
      });
      return proc.exited;
    };

    it("refuses sslmode=require on a server without TLS", async () => {
      const { code, output } = await probe("sslmode=require");
      expect(code).not.toBe(0);
      expect(output).toMatch(/POOL_ERROR/);
    });

    it("connects in plaintext when sslmode=disable follows sslmode=require", async () => {
      const { code, output } = await probe("sslmode=require&sslmode=disable");
      expect({ code, ok: /POOL_RESULT/.test(output) }).toEqual({ code: 0, ok: true });
    });
  });

  describe("the production boot check", () => {
    const base = () => productionEnv().DATABASE_URL;

    it("still boots with a bounded pool written into the URL", async () => {
      const port = await freePort();
      const api = start(APP, productionEnv({
        PORT: String(port),
        DATABASE_CONNECTION_LIMIT: "",
        DATABASE_URL: withParams(base(), "connection_limit=4&pool_timeout=5"),
      }));
      await api.waitForOutput(/running on port/);
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
    });

    it.each([
      ["a second sslmode that turns TLS off", () => ({ DATABASE_URL: withParams(base(), "sslmode=disable") }), /DATABASE_URL sets sslmode more than once/],
      ["a second sslaccept that turns certificate checks off", () => ({ DATABASE_URL: withParams(base(), "sslaccept=strict&sslaccept=accept_invalid_certs") }), /DATABASE_URL sets sslaccept more than once/],
      ["an unbounded pool in the URL", () => ({ DATABASE_CONNECTION_LIMIT: "", DATABASE_URL: withParams(base(), "connection_limit=0") }), /DATABASE_URL connection_limit must be a positive whole number \(got "0"\)/],
      ["a pool size in the URL that is not a number", () => ({ DATABASE_CONNECTION_LIMIT: "", DATABASE_URL: withParams(base(), "connection_limit=abc") }), /DATABASE_URL connection_limit must be a positive whole number \(got "abc"\)/],
      ["inbound email at launch, even with its key", () => ({ INBOUND_EMAIL_DOMAIN: "in.example.com", INBOUND_EMAIL_SECRET: "inbound-secret-with-at-least-32-characters" }), /INBOUND_EMAIL_DOMAIN must not be set in production/],
    ])("refuses to boot with %s", async (_label, overrides, message) => {
      const port = await freePort();
      const api = start(APP, productionEnv({ PORT: String(port), ...overrides() }));
      // Whichever comes first: the process exiting, or the app listening. An
      // app that boots when it should not fails here at once, not at jest's
      // timeout.
      const booted = api
        .waitForOutput(/running on port/, 20_000)
        .then((output) => ({ code: "still running", output }), () => new Promise(() => {}));
      const { code, output } = await Promise.race([api.exited, booted]);
      expect(code).not.toBe("still running");
      expect(code).not.toBe(0);
      expect(output).toMatch(/Production environment validation failed/);
      expect(output).toMatch(message);
      expect(output).not.toMatch(/running on port/);
    });
  });
});
