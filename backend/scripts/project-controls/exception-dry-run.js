#!/usr/bin/env node
/**
 * Exception dry run — READ ONLY by construction (PC-7b,
 * docs/project-controls/OCTAPM_CHANGE_INTELLIGENCE.md §6-§7).
 *
 * For every project of every durable organisation (any organisation not named
 * "LiveTest <uuid>"), asks the exception engine what it WOULD open —
 * exception-engine.service evaluateProject({ dryRun: true }), which writes
 * nothing — and prints how many rows each kind would open, and on how many
 * projects. Nothing is written: no exception row, no job, no notification.
 *
 *   node scripts/project-controls/exception-dry-run.js
 *     [--org <orgId>]        only this organisation (a LiveTest one included)
 *     [--rules-only]         evaluate the data-quality rules
 *                            (exception-rules/data-quality.js) directly instead
 *                            of the engine: the rows each rule returns, before
 *                            the engine's dismissal and snooze handling
 *     [--cutoff <ISO>]       the instant evaluated at (default: now)
 *     [--json <file>]        the full result, per project and per kind
 *
 * Exit 0 = done; 1 = an error (a project's error is reported and counted, and
 * the run exits 1 at the end); 2 = the session was not read-only (stopped
 * before reading further); 3 = exception-engine.service.js is not on this base
 * (use --rules-only, or run it after the engine merges); 64 = bad arguments.
 *
 * Read-only guarantees (the forecast census's, scripts/project-controls/
 * forecast-change-impacts-census.js):
 *   - one database connection (connection_limit=1 written into the URL, a
 *     limit already in it replaced, before the client is loaded), opened
 *     read-only (`options=-c default_transaction_read_only=on`);
 *   - its session is `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`
 *     before anything else runs, and `SHOW transaction_read_only` must read
 *     `on` before the run, before every project and after the run — otherwise
 *     the script stops (exit 2). PostgreSQL refuses any write on that session,
 *     so a write anywhere below fails the project instead of happening;
 *   - EXCEPTIONS_ENGINE_ENABLED=false: no trigger or tick is registered.
 * Run it under the cross-wave database lock (C:/Temp/octapm-dblock.js).
 */
const path = require("path");
const fs = require("fs");

const backendDir = path.resolve(__dirname, "..", "..");
const LIVE_TEST_ORG = /^LiveTest [0-9a-f-]{36}$/;

const parseArgs = (argv) => {
  const args = { org: null, rulesOnly: false, cutoff: null, json: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--rules-only") {
      args.rulesOnly = true;
      continue;
    }
    const key = { "--org": "org", "--cutoff": "cutoff", "--json": "json" }[flag];
    if (!key || argv[index + 1] === undefined) {
      console.error(`usage: node scripts/project-controls/exception-dry-run.js [--org <orgId>] [--rules-only] [--cutoff <ISO>] [--json <file>] (bad argument: ${flag})`);
      process.exit(64);
    }
    args[key] = argv[index + 1];
    index += 1;
  }
  if (args.cutoff !== null && Number.isNaN(new Date(args.cutoff).getTime())) {
    console.error(`--cutoff is not an instant: ${args.cutoff}`);
    process.exit(64);
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));
const callerCwd = process.cwd();
process.chdir(backendDir);
require(require.resolve("dotenv", { paths: [backendDir] })).config({ path: path.join(backendDir, ".env") });
process.env.DATABASE_CONNECTION_LIMIT = "1";
// A connection_limit written into the URL would win over the variable
// (config/db.js buildDatasourceUrl): the one-connection pool is written into
// the URL itself, and every connection the client opens starts read-only
// (`options=-c default_transaction_read_only=on`, which PostgreSQL applies to
// the session before any statement) — the SET SESSION below and the SHOW
// checks then verify what the connection already is.
if (process.env.DATABASE_URL) {
  if (/[?&]options=/.test(process.env.DATABASE_URL)) {
    console.error("DATABASE_URL already carries `options`; refusing to guess how to make its sessions read-only.");
    process.exit(2);
  }
  const url = process.env.DATABASE_URL.replace(/([?&])connection_limit=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  process.env.DATABASE_URL = `${url}${url.includes("?") ? "&" : "?"}connection_limit=1&options=${encodeURIComponent("-c default_transaction_read_only=on")}`;
}
process.env.EXCEPTIONS_ENGINE_ENABLED = "false";
for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "AI_PROVIDER"]) process.env[key] = "";

const loadEngine = () => {
  try {
    return require(path.join(backendDir, "src", "services", "exception-engine.service"));
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND" && String(error.message).includes("exception-engine.service")) return null;
    throw error;
  }
};

const engine = args.rulesOnly ? null : loadEngine();
if (!args.rulesOnly && !engine) {
  console.error("exception-engine.service.js is not on this base: run with --rules-only, or after the engine track merges.");
  process.exit(3);
}

const { prisma } = require(path.join(backendDir, "src", "config", "db"));
const RULES = require(path.join(backendDir, "src", "services", "exception-rules", "data-quality"));

class NotReadOnly extends Error {}
const assertReadOnly = async (when) => {
  const [{ transaction_read_only: value }] = await prisma.$queryRawUnsafe("SHOW transaction_read_only");
  if (value !== "on") throw new NotReadOnly(`the session is not read-only ${when} (transaction_read_only = ${value}); stopping`);
  return value;
};

// The engine's own tallies (opened / refreshed / resolved / unchanged), summed.
const engineTotals = { opened: 0, refreshed: 0, resolved: 0, unchanged: 0 };

/**
 * The rows one project's evaluation returns: the engine's dry-run rows (what
 * it would hold open after the pass; its tallies say how many of them are new),
 * or each data-quality rule's own answer.
 */
const wouldOpen = async ({ orgId, projectId, cutoff }) => {
  if (engine) {
    const result = await engine.evaluateProject({ orgId, projectId, cutoff, trigger: "dry_run", dryRun: true });
    for (const key of Object.keys(engineTotals)) engineTotals[key] += Number(result?.[key]) || 0;
    return Array.isArray(result?.rows) ? result.rows : [];
  }
  const ctx = {};
  const rows = [];
  for (const rule of RULES) {
    for (const row of await rule.evaluate({ orgId, projectId, cutoff, ctx })) rows.push({ kind: rule.kind, severity: rule.severity, ...row });
  }
  return rows;
};

(async () => {
  const cutoff = args.cutoff ? new Date(args.cutoff) : new Date();
  await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  const readOnlyBefore = await assertReadOnly("before the run");
  const orgs = await prisma.organisation.findMany({ where: args.org ? { id: args.org } : {}, select: { id: true, name: true }, orderBy: { id: "asc" } });
  const scoped = args.org ? orgs : orgs.filter((org) => !LIVE_TEST_ORG.test(org.name));
  const projects = await prisma.project.findMany({ where: { orgId: { in: scoped.map((org) => org.id) } }, select: { id: true, orgId: true, name: true }, orderBy: [{ orgId: "asc" }, { id: "asc" }] });
  console.log(`exception dry run (${engine ? "engine evaluateProject dryRun" : "data-quality rules only"}) at ${cutoff.toISOString()}: ${scoped.length} organisation(s), ${projects.length} project(s); read-only session verified`);

  const perKind = new Map();
  const perProject = [];
  const errors = [];
  for (const project of projects) {
    await assertReadOnly(`before project ${project.id}`);
    try {
      const rows = await wouldOpen({ orgId: project.orgId, projectId: project.id, cutoff });
      const counts = {};
      for (const row of rows) {
        counts[row.kind] = (counts[row.kind] || 0) + 1;
        const entry = perKind.get(row.kind) || { rows: 0, projects: new Set() };
        entry.rows += 1;
        entry.projects.add(project.id);
        perKind.set(row.kind, entry);
      }
      perProject.push({ projectId: project.id, orgId: project.orgId, counts });
    } catch (error) {
      if (error instanceof NotReadOnly) throw error;
      errors.push({ projectId: project.id, orgId: project.orgId, error: `${error.code || error.name}: ${error.message}`.slice(0, 500) });
    }
  }
  const readOnlyAfter = await assertReadOnly("after the run");

  console.log("\n| kind | rows it would open | projects |\n|---|---|---|");
  const kinds = [...new Set([...RULES.map((rule) => rule.kind), ...perKind.keys()])];
  for (const kind of kinds) {
    const entry = perKind.get(kind);
    console.log(`| ${kind} | ${entry ? entry.rows : 0} | ${entry ? entry.projects.size : 0} |`);
  }
  if (engine) console.log(`\nengine tallies (dry run, nothing written): ${JSON.stringify(engineTotals)}`);
  console.log(`\nprojects evaluated: ${perProject.length}; errors: ${errors.length}; session read-only before/after: ${readOnlyBefore}/${readOnlyAfter}`);
  for (const error of errors) console.log(`  error on ${error.projectId}: ${error.error}`);

  if (args.json) {
    const out = path.resolve(callerCwd, args.json);
    const result = {
      cutoff: cutoff.toISOString(),
      mode: engine ? "engine_dry_run" : "rules_only",
      sessionReadOnly: readOnlyBefore === "on" && readOnlyAfter === "on" ? "on" : "off",
      ...(engine ? { engineTotals } : {}),
      organisations: scoped.length,
      projects: perProject.length,
      kinds: Object.fromEntries(kinds.map((kind) => [kind, { rows: perKind.get(kind)?.rows || 0, projects: perKind.get(kind)?.projects.size || 0 }])),
      perProject,
      errors,
    };
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`written ${out}`);
  }
  await prisma.$disconnect();
  process.exit(errors.length ? 1 : 0);
})().catch(async (error) => {
  console.error(error instanceof NotReadOnly ? error.message : error);
  await prisma.$disconnect().catch(() => {});
  process.exit(error instanceof NotReadOnly ? 2 : 1);
});
