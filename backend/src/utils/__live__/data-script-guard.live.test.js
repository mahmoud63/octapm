/**
 * The data-script guard, driven through the real scripts.
 *
 * Every script runs as a real child process, the way an operator or an ECS
 * one-off task would run it. Destructive runs go to a throwaway database
 * (octapm_guard_<tag>, built with `prisma db push` and dropped afterwards), so
 * nothing here writes to the shared development database: the only run that
 * reaches it is `reset-e2e-org.js --count`, which only reads.
 *
 *   npm run test:live -- src/utils/__live__/data-script-guard.live.test.js
 */
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const path = require("path");
const { Client } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { BACKEND_ROOT, liveDescribe } = require("../../__live__/helpers");

const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");
// Hoisted to the root node_modules by the workspace install; resolve it the way node would.
const PRISMA_CLI = require.resolve("prisma/build/index.js", { paths: [BACKEND_ROOT] });
const FAKE_REMOTE = "postgresql://octapm_app:not-a-password@octapm-prod.invalid:5432/octapm";

// The shared URL without the pool parameters the live kit adds, pointed at another database.
const urlFor = (database, { connectionLimit } = {}) => {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  url.search = "";
  if (connectionLimit) url.searchParams.set("connection_limit", String(connectionLimit));
  return url.toString();
};

/**
 * The child's environment: this process's, minus everything the guard reads,
 * plus exactly what the case sets. A key set to undefined is left out, so the
 * child falls back to backend/.env for it — the way a developer runs a script.
 */
const childEnv = (overrides) => {
  const env = { ...process.env };
  for (const key of ["DATABASE_URL", "NODE_ENV", "ALLOW_DATA_SCRIPT"]) delete env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
};

const run = (args, { env, cwd = BACKEND_ROOT, timeoutMs = 240_000 } = {}) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output, ms: Date.now() - started });
    });
  });

liveDescribe("data-script guard (live)", () => {
  describe("a database that is not on this machine", () => {
    // Nothing listens at octapm-prod.invalid and the name never resolves. A
    // script that got as far as Prisma would fail with P1001 or ENOTFOUND; a
    // guarded one stops first and names the override it would need.
    const scripts = [
      ["seed", ["prisma/seed.js"], BACKEND_ROOT],
      ["E2E reset", ["scripts/e2e/reset-e2e-org.js"], BACKEND_ROOT],
      ["E2E reset --count", ["scripts/e2e/reset-e2e-org.js", "--count"], BACKEND_ROOT],
      ["QA harness", ["-e", "require('./scripts/qa/harness')"], BACKEND_ROOT],
      ["residue archiver --apply", ["scripts/demo/archive-e2e-residue.js", "--apply"], BACKEND_ROOT],
      ["UAT fixtures", ["e2e/uat/seed-uat-fixtures.mjs"], REPO_ROOT],
    ];

    test.each(scripts)("%s is refused before it connects", async (_name, args, cwd) => {
      const result = await run(args, {
        cwd,
        env: childEnv({ DATABASE_URL: FAKE_REMOTE, NODE_ENV: "development" }),
        timeoutMs: 30_000,
      });
      expect(result.output).toContain("DATA_SCRIPT_REFUSED");
      expect(result.output).toContain("ALLOW_DATA_SCRIPT=octapm-prod.invalid/octapm");
      expect(result.output).not.toMatch(/P1001|Can't reach database|ENOTFOUND|getaddrinfo/);
      expect(result.code).toBe(1);
    });
  });

  describe("a database on this machine", () => {
    test("backend/.env alone lets the E2E reset read the local database (--count)", async () => {
      // No DATABASE_URL and no NODE_ENV in the child's environment: they can
      // only come from backend/.env, which the guard has to load itself —
      // Prisma would load it too, but only after the guard has decided.
      const result = await run(["scripts/e2e/reset-e2e-org.js", "--count"], {
        env: childEnv({ DATABASE_URL: undefined, NODE_ENV: undefined }),
        timeoutMs: 60_000,
      });
      expect(result.output).not.toContain("DATA_SCRIPT_REFUSED");
      expect(result.output).toMatch(/organisations: \d+ — E2E \d+/);
      expect(result.code).toBe(0);
    });
  });

  describe("a throwaway database under NODE_ENV=production", () => {
    const database = `octapm_guard_${crypto.randomBytes(4).toString("hex")}`;
    const target = `localhost/${database}`;
    const scriptUrl = urlFor(database, { connectionLimit: 3 });
    let admin;
    let prisma;
    let acme;
    let customerOrder;

    beforeAll(async () => {
      admin = new Client({ connectionString: urlFor("postgres") });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${database}"`);
      const push = spawnSync(process.execPath, [PRISMA_CLI, "db", "push", "--skip-generate"], {
        cwd: BACKEND_ROOT,
        env: childEnv({ DATABASE_URL: scriptUrl, NODE_ENV: "development" }),
        encoding: "utf8",
        windowsHide: true,
      });
      if (push.status !== 0) throw new Error(`prisma db push failed:\n${push.stdout}\n${push.stderr}`);

      prisma = new PrismaClient({ datasourceUrl: scriptUrl.replace("connection_limit=3", "connection_limit=2") });
      // A customer whose name happens to carry the E2E marker — exactly what
      // the reset would delete on a customer database.
      acme = await prisma.organisation.create({
        data: { name: "Acme E2E Builders", projects: { create: { name: "Acme Tower" } } },
        include: { projects: true },
      });
      // Another tenant with an order whose user-typed ref looks like test residue.
      const customer = await prisma.organisation.create({
        data: { name: "Harbour Customer Ltd", projects: { create: { name: "Quay Wall" } } },
        include: { projects: true },
      });
      customerOrder = await prisma.procurementOrder.create({
        data: { projectId: customer.projects[0].id, ref: "PO-E2E-CUSTOMER", item: "Sheet piles" },
      });
    }, 180_000);

    afterAll(async () => {
      await prisma?.$disconnect().catch(() => null);
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => null);
        await admin.end().catch(() => null);
      }
    });

    const organisationNamed = (name) => prisma.organisation.findFirst({ where: { name } });

    test("the E2E reset refuses and deletes nothing", async () => {
      const result = await run(["scripts/e2e/reset-e2e-org.js"], {
        env: childEnv({ DATABASE_URL: scriptUrl, NODE_ENV: "production" }),
        timeoutMs: 30_000,
      });
      expect(result.output).toContain(`DATA_SCRIPT_REFUSED: e2e:reset will not write to ${target} (NODE_ENV=production)`);
      expect(result.code).toBe(1);
      expect(await prisma.organisation.findUnique({ where: { id: acme.id } })).not.toBeNull();
      expect(await prisma.project.count({ where: { orgId: acme.id } })).toBe(1);
    });

    test("an override naming another database does not unlock this one", async () => {
      const result = await run(["scripts/e2e/reset-e2e-org.js"], {
        env: childEnv({ DATABASE_URL: scriptUrl, NODE_ENV: "production", ALLOW_DATA_SCRIPT: "localhost/octapm_verify" }),
        timeoutMs: 30_000,
      });
      expect(result.output).toContain("DATA_SCRIPT_REFUSED");
      expect(result.code).toBe(1);
      expect(await prisma.organisation.findUnique({ where: { id: acme.id } })).not.toBeNull();
    });

    test("the UAT fixtures and the residue archiver's --apply refuse; its dry run is not the guard's business", async () => {
      const env = childEnv({ DATABASE_URL: scriptUrl, NODE_ENV: "production" });
      const uat = await run(["e2e/uat/seed-uat-fixtures.mjs"], { cwd: REPO_ROOT, env, timeoutMs: 60_000 });
      expect(uat.output).toContain("DATA_SCRIPT_REFUSED: uat:seed");
      expect(uat.code).toBe(1);
      expect(await organisationNamed("PMcopilots UAT Fixtures")).toBeNull();

      const apply = await run(["scripts/demo/archive-e2e-residue.js", "--apply"], { env, timeoutMs: 30_000 });
      expect(apply.output).toContain("DATA_SCRIPT_REFUSED: demo:archive-residue --apply");
      expect(apply.code).toBe(1);

      // The dry run reads and classifies; on this database it stops on its own
      // "refusing to guess" check, which is the script's, not the guard's.
      const dry = await run(["scripts/demo/archive-e2e-residue.js"], { env, timeoutMs: 60_000 });
      expect(dry.output).not.toContain("DATA_SCRIPT_REFUSED");
    }, 180_000);

    test("the exact override runs the reset: the E2E-named org goes, the seed lands, another tenant's order stays", async () => {
      const result = await run(["scripts/e2e/reset-e2e-org.js"], {
        env: childEnv({ DATABASE_URL: scriptUrl, NODE_ENV: "production", ALLOW_DATA_SCRIPT: target }),
      });
      if (result.code !== 0) throw new Error(`reset failed (${result.code}):\n${result.output.slice(-4000)}`);
      expect(result.output).not.toContain("DATA_SCRIPT_REFUSED");

      expect(await prisma.organisation.findUnique({ where: { id: acme.id } })).toBeNull();
      const seeded = await organisationNamed("OctaPM E2E");
      expect(seeded).not.toBeNull();
      expect(await prisma.user.count({ where: { orgId: seeded.id, email: { endsWith: "@octapm-e2e.test" } } })).toBeGreaterThanOrEqual(8);

      // The seed sweeps PO-E2E-* residue from its own organisation only.
      expect(await prisma.procurementOrder.findUnique({ where: { id: customerOrder.id } })).not.toBeNull();
      expect(await organisationNamed("Harbour Customer Ltd")).not.toBeNull();
    }, 300_000);
  });
});
