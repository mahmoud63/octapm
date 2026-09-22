/**
 * `npm run admin:bootstrap` against throwaway databases.
 *
 * Never against the shared development database: the command refuses any
 * database that is not empty, and this test needs empty ones. A template
 * database is created on the local cluster and given the schema with
 * `prisma db push`; each case gets its own copy of it; all of them are
 * dropped at the end.
 *
 * What must hold:
 *   - one organisation and one company administrator, with a subscription and
 *     the default permission templates, and no usable password;
 *   - a single-use set-password link that really works, once;
 *   - a second run, or a run on any non-empty database, refuses (409);
 *   - concurrent runs create exactly one organisation;
 *   - --reissue replaces an unused link, and only before the first sign-in;
 *   - the link lives BOOTSTRAP_LINK_MINUTES (30 by default), never the
 *     password-reset lifetime, and a value outside 5..60 is refused before
 *     anything is written.
 */
const crypto = require("crypto");
const path = require("path");
const { spawnSync } = require("child_process");
const { Client } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { BACKEND_ROOT, liveDescribe, spawnNode } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const baseUrl = new URL(process.env.DATABASE_URL);
const stamp = crypto.randomBytes(4).toString("hex");
const TEMPLATE = `octapm_bootstrap_${stamp}`;
const created = [];

const urlFor = (database, connectionLimit = 5) => {
  const url = new URL(baseUrl.toString());
  url.pathname = `/${database}`;
  url.searchParams.set("connection_limit", String(connectionLimit));
  url.searchParams.delete("schema");
  return url.toString();
};

const adminQuery = async (sql) => {
  const url = new URL(baseUrl.toString());
  url.pathname = "/postgres";
  url.search = "";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
};

const createDatabase = async (name, template = null) => {
  await adminQuery(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ""}`);
  created.push(name);
  return name;
};

const copyOfTemplate = (label) => createDatabase(`${TEMPLATE}_${label}`, TEMPLATE);

const bootstrap = async (database, { email, args = ["--print-link"], viaNpm = false, env: extra = {} } = {}) => {
  const env = {
    DATABASE_URL: urlFor(database),
    // Pinned so a value in backend/.env or the shell cannot change what these
    // cases see; the reset lifetime is set far from 30 so the two cannot be
    // confused.
    BOOTSTRAP_LINK_MINUTES: "",
    PASSWORD_RESET_TOKEN_MINUTES: "240",
    ...extra,
    BOOTSTRAP_ORG_NAME: "Bootstrap Builders",
    BOOTSTRAP_ADMIN_NAME: "First Admin",
    BOOTSTRAP_ADMIN_EMAIL: email,
  };
  if (viaNpm) {
    // Exactly the command the runbook gives: npm run admin:bootstrap -- --print-link
    const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    const result = spawnSync(process.execPath, [npmCli, "run", "admin:bootstrap", "--", ...args], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  }
  const proc = spawnNode("src/cli/bootstrap-admin.js", { env, args });
  const { code, output } = await proc.exited;
  return { code, output };
};

const tokenFrom = (output) => {
  const link = output.split(/\r?\n/).find((line) => /^https?:\/\/\S+\/reset-password\?token=/.test(line.trim()));
  return link ? new URL(link.trim()).searchParams.get("token") : null;
};

const clientFor = (database) => new PrismaClient({ datasourceUrl: urlFor(database, 2) });

liveDescribe("first-administrator bootstrap", () => {
  const clients = [];
  const apis = [];
  const openClient = (database) => {
    const client = clientFor(database);
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    await createDatabase(TEMPLATE);
    const prismaCli = require.resolve("prisma/build/index.js");
    const push = spawnSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: urlFor(TEMPLATE, 2) },
      encoding: "utf8",
      timeout: 180_000,
      windowsHide: true,
    });
    if (push.status !== 0) throw new Error(`prisma db push failed:\n${push.stdout}\n${push.stderr}`);
  }, 240_000);

  afterAll(async () => {
    for (const api of apis) await api.stop();
    for (const client of clients) await client.$disconnect().catch(() => {});
    for (const name of created.reverse()) {
      await adminQuery(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch((error) => console.error(`could not drop ${name}: ${error.message}`));
    }
  }, 120_000);

  it("creates one organisation and one administrator whose link sets a password, once", async () => {
    const database = await copyOfTemplate("flow");
    const email = `first-admin-${stamp}@octapm-live.test`;
    const run = await bootstrap(database, { email, viaNpm: true });
    expect(run.code).toBe(0);
    const token = tokenFrom(run.output);
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const db = openClient(database);
    const [organisations, users] = await Promise.all([db.organisation.findMany(), db.user.findMany()]);
    expect(organisations).toHaveLength(1);
    expect(organisations[0].name).toBe("Bootstrap Builders");
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email, role: "pm", isCompanyAdmin: true, status: "active", lastLogin: null });
    expect(await db.subscription.count({ where: { orgId: organisations[0].id } })).toBe(1);
    expect(await db.permissionTemplate.count({ where: { orgId: organisations[0].id } })).toBeGreaterThan(0);
    expect(await db.passwordResetToken.count({ where: { userId: users[0].id, usedAt: null } })).toBe(1);
    expect(await db.authAuditEvent.count({ where: { action: "organisation_bootstrapped", userId: users[0].id } })).toBe(1);

    const api = await startApi({ DATABASE_URL: urlFor(database) });
    apis.push(api);
    const login = (password) => api.post("/api/v1/auth/login", { email, password });

    // Nothing guessable signs in: not the email, not the organisation's name.
    expect((await login(email)).status).toBe(401);
    expect((await login("Bootstrap Builders")).status).toBe(401);

    const password = `Str0ng-${crypto.randomBytes(6).toString("hex")}`;
    const reset = await api.post("/api/v1/auth/reset-password", { token, password });
    expect(reset.status).toBe(200);

    const signedIn = await login(password);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.user).toMatchObject({ email, isCompanyAdmin: true });

    const again = await api.post("/api/v1/auth/reset-password", { token, password: `${password}x` });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("PASSWORD_RESET_TOKEN_INVALID");

    // A second run, with anyone, is refused and changes nothing.
    const second = await bootstrap(database, { email: `second-${stamp}@octapm-live.test` });
    expect(second.code).toBe(1);
    expect(second.output).toContain("BOOTSTRAP_NOT_EMPTY");
    expect(await db.organisation.count()).toBe(1);
    expect(await db.user.count()).toBe(1);

    // And no fresh link once the administrator has signed in.
    const reissue = await bootstrap(database, { email, args: ["--reissue", "--print-link"] });
    expect(reissue.code).toBe(1);
    expect(tokenFrom(reissue.output)).toBeNull();
  }, 180_000);

  it("reissues an unused link, which retires the old one", async () => {
    const database = await copyOfTemplate("reissue");
    const email = `reissue-admin-${stamp}@octapm-live.test`;
    const first = await bootstrap(database, { email });
    expect(first.code).toBe(0);
    const oldToken = tokenFrom(first.output);

    const someoneElse = await bootstrap(database, { email: `stranger-${stamp}@octapm-live.test`, args: ["--reissue", "--print-link"] });
    expect(someoneElse.code).toBe(1);

    const reissued = await bootstrap(database, { email, args: ["--reissue", "--print-link"] });
    expect(reissued.code).toBe(0);
    const newToken = tokenFrom(reissued.output);
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(oldToken);

    const api = await startApi({ DATABASE_URL: urlFor(database) });
    apis.push(api);
    const password = `Str0ng-${crypto.randomBytes(6).toString("hex")}`;
    expect((await api.post("/api/v1/auth/reset-password", { token: oldToken, password })).status).toBe(400);
    expect((await api.post("/api/v1/auth/reset-password", { token: newToken, password })).status).toBe(200);
  }, 180_000);

  it("gives the link its own short lifetime and refuses one outside 5..60", async () => {
    const database = await copyOfTemplate("lifetime");
    const email = `lifetime-admin-${stamp}@octapm-live.test`;
    const db = openClient(database);
    const lifetimeOf = (token) => token.expiresAt.getTime() - token.createdAt.getTime();

    // Out of range, or not a whole number: refused, and nothing is created.
    for (const value of ["61", "4", "0", "abc", "15.5", "1440"]) {
      const refused = await bootstrap(database, { email, env: { BOOTSTRAP_LINK_MINUTES: value } });
      expect({ value, code: refused.code }).toEqual({ value, code: 1 });
      expect(refused.output).toContain("BOOTSTRAP_LINK_MINUTES_INVALID");
      expect(refused.output).toContain("5 to 60");
      expect(tokenFrom(refused.output)).toBeNull();
    }
    expect(await db.organisation.count()).toBe(0);
    expect(await db.user.count()).toBe(0);

    // Default: 30 minutes, not PASSWORD_RESET_TOKEN_MINUTES (240 here).
    const first = await bootstrap(database, { email });
    expect(first.code).toBe(0);
    const firstToken = await db.passwordResetToken.findFirst({ where: { email } });
    expect(lifetimeOf(firstToken)).toBe(30 * 60 * 1000);
    // The printed output says when the link dies, and warns about the logs.
    expect(first.output).toContain(`valid 30 minutes, expires ${firstToken.expiresAt.toISOString()}`);
    expect(first.output).toMatch(/WARNING: .*CloudWatch.*restricted readers and short retention.*email/);

    // A reissue honours BOOTSTRAP_LINK_MINUTES.
    const reissued = await bootstrap(database, { email, args: ["--reissue", "--print-link"], env: { BOOTSTRAP_LINK_MINUTES: "10" } });
    expect(reissued.code).toBe(0);
    const reissuedToken = await db.passwordResetToken.findFirst({ where: { email, revokedAt: null, usedAt: null } });
    expect(reissuedToken.id).not.toBe(firstToken.id);
    expect(lifetimeOf(reissuedToken)).toBe(10 * 60 * 1000);
    expect(reissued.output).toContain(`valid 10 minutes, expires ${reissuedToken.expiresAt.toISOString()}`);

    // And a reissue with a refused value leaves the current link alone.
    const refusedReissue = await bootstrap(database, { email, args: ["--reissue", "--print-link"], env: { BOOTSTRAP_LINK_MINUTES: "90" } });
    expect(refusedReissue.code).toBe(1);
    expect(refusedReissue.output).toContain("BOOTSTRAP_LINK_MINUTES_INVALID");
    const current = await db.passwordResetToken.findMany({ where: { email, revokedAt: null, usedAt: null } });
    expect(current.map((token) => token.id)).toEqual([reissuedToken.id]);
  }, 180_000);

  it("creates exactly one organisation when two runs start together", async () => {
    const database = await copyOfTemplate("cli_race");
    const [a, b] = await Promise.all([
      bootstrap(database, { email: `race-a-${stamp}@octapm-live.test` }),
      bootstrap(database, { email: `race-b-${stamp}@octapm-live.test` }),
    ]);
    expect([a.code, b.code].sort()).toEqual([0, 1]);
    const db = openClient(database);
    expect(await db.organisation.count()).toBe(1);
    expect(await db.user.count()).toBe(1);
  }, 180_000);

  it("creates exactly one organisation when four runs reach an empty database at the same instant", async () => {
    // Processes start hundreds of milliseconds apart, so left alone they only
    // sometimes overlap. To make the overlap certain, this test holds an
    // exclusive lock on the Organisation table while four runs start: each
    // one queues (behind the bootstrap lock, or on the table itself) until
    // all four are waiting, then the table is released at once. Without the
    // bootstrap lock all four would then count zero organisations together.
    const database = await copyOfTemplate("race4");
    const url = new URL(urlFor(database));
    url.search = "";
    const gate = new Client({ connectionString: url.toString() });
    await gate.connect();
    let runs;
    try {
      await gate.query("BEGIN");
      await gate.query('LOCK TABLE "Organisation" IN ACCESS EXCLUSIVE MODE');
      const pending = [0, 1, 2, 3].map((index) => bootstrap(database, { email: `racer-${index}-${stamp}@octapm-live.test` }));
      const deadline = Date.now() + 60_000;
      for (;;) {
        const { rows } = await gate.query(
          "SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = $1)",
          [database],
        );
        if (rows[0].waiting >= 4) break;
        if (Date.now() > deadline) throw new Error(`only ${rows[0].waiting} of 4 runs reached the database`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await gate.query("COMMIT");
      runs = await Promise.all(pending);
    } finally {
      await gate.end();
    }
    expect(runs.map((run) => run.code).sort()).toEqual([0, 1, 1, 1]);
    for (const refused of runs.filter((run) => run.code === 1)) expect(refused.output).toContain("BOOTSTRAP_NOT_EMPTY");
    const db = openClient(database);
    expect(await db.organisation.count()).toBe(1);
    expect(await db.user.count()).toBe(1);
  }, 180_000);

  it("keeps no password in the command, its arguments or its source", () => {
    const source = require("fs").readFileSync(path.join(BACKEND_ROOT, "src", "cli", "bootstrap-admin.js"), "utf8");
    expect(source).not.toMatch(/process\.env\.[A-Z_]*PASSWORD/);
    expect(source).not.toMatch(/--password/);
  });
});
