#!/usr/bin/env node
/**
 * Runs live test files against a throwaway database that has EVERY migration
 * in prisma/migrations deployed — including ones not yet applied to the shared
 * database — so a behaviour that depends on a pending constraint can be proven
 * before the orchestrator applies it.
 *
 *   node scripts/db/live-on-migtest.js src/services/__live__/<file>.live.test.js [...more]
 *
 * Like verify-additive-migration.js it creates `octapm_migtest_<timestamp>` on
 * the cluster DATABASE_URL names, runs `prisma migrate deploy` into it from a
 * staged copy of the migrations, and drops it in a finally whatever happened.
 * It never migrates or writes the database DATABASE_URL names: the live run
 * gets DATABASE_URL pointing at the throwaway (dotenv does not override it).
 * The generated Prisma client is the shared one, unchanged; columns a pending
 * migration adds are simply not selected by it.
 *
 * Exit: the jest run's exit code; 1 on a setup error.
 */
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const backend = path.resolve(__dirname, "..", "..");
const nodeModules = [path.join(backend, "node_modules"), path.join(backend, "..", "node_modules")].find((p) => fs.existsSync(path.join(p, "pg")));
require(path.join(nodeModules, "dotenv")).config({ path: path.join(backend, ".env") });
const { Client } = require(path.join(nodeModules, "pg"));
const prismaCli = path.join(nodeModules, "prisma", "build", "index.js");
const jestCli = path.join(nodeModules, "jest", "bin", "jest.js");

const files = process.argv.slice(2);
if (!files.length || files.some((f) => !/\.live\.test\.js$/.test(f))) {
  console.error("usage: node scripts/db/live-on-migtest.js <live test file> [...]");
  process.exit(1);
}

const base = new URL(process.env.DATABASE_URL);
const dbName = `octapm_migtest_${Date.now()}`;
if (!/^octapm_migtest_\d+$/.test(dbName) || dbName === base.pathname.slice(1)) throw new Error("refusing: not a throwaway database name");
const urlFor = (name) => {
  const u = new URL(base.toString());
  u.pathname = `/${name}`;
  u.searchParams.delete("connection_limit");
  return u.toString();
};

const main = async () => {
  const admin = new Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "octapm-migtest-live-"));
  let code = 1;
  await admin.query(`CREATE DATABASE "${dbName}"`);
  console.log(`[live-on-migtest] created ${dbName}`);
  try {
    const stage = path.join(work, "stage");
    fs.mkdirSync(stage, { recursive: true });
    fs.cpSync(path.join(backend, "prisma", "migrations"), path.join(stage, "migrations"), { recursive: true });
    fs.copyFileSync(path.join(backend, "prisma", "schema.prisma"), path.join(stage, "schema.prisma"));
    const out = execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path.join(stage, "schema.prisma")], {
      env: { ...process.env, DATABASE_URL: urlFor(dbName) },
      encoding: "utf8",
    });
    console.log(`[live-on-migtest] ${out.split("\n").filter((l) => /migrations? found|All migrations|applied/i.test(l)).join(" | ")}`);
    const run = spawnSync(process.execPath, [jestCli, "--config", "jest.live.config.js", "--runInBand", "--forceExit", ...files], {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: urlFor(dbName), RUN_LIVE_DB: "1" },
      stdio: "inherit",
    });
    code = run.status ?? 1;
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    const left = await admin.query("select count(*)::int as n from pg_database where datname = $1", [dbName]);
    console.log(`[live-on-migtest] dropped ${dbName} (remaining: ${left.rows[0].n})`);
    await admin.end();
    fs.rmSync(work, { recursive: true, force: true });
  }
  return code;
};

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
