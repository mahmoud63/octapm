/**
 * Forecast change-order impacts census — READ ONLY by construction.
 * (docs/project-controls/OCTAPM_FORECAST_CHANGE_IMPACTS_CENSUS.md, owner
 * decision R5-1: the census method is a reproducible command in the repo.)
 *
 * For every project of every organisation not named "LiveTest <uuid>", builds
 * the forecast in-process at one fixed instant and summarises it: projected
 * finish, slip, schedule level, critical driver, Σ impactDays, and the money
 * figures. With --before-ref it builds it twice — once with this checkout's
 * forecast.service.js ("after") and once with that git ref's
 * forecast.service.js ("before", compiled in memory from `git show`; no file is
 * written) — on the same data, the same dependencies and the same instant, and
 * reports what moves.
 *
 *   node scripts/project-controls/forecast-change-impacts-census.js \
 *     [--as-of <ISO instant>]       default: now
 *     [--before-ref <git ref>]      e.g. 06308dc, the commit before PC-7a item 4
 *     [--out <file.json>]           the full per-project result
 *     [--project <projectId>]       also print the trace of one project: its
 *                                   approved change-order links, repeated
 *                                   descriptions, and the forecast's schedule
 *
 * Read-only guarantees:
 *   - one database connection (DATABASE_CONNECTION_LIMIT=1, set before the
 *     client is loaded);
 *   - its session is `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`
 *     before anything else runs, and `SHOW transaction_read_only` must read
 *     `on` before the run, before every project and after the run — otherwise
 *     the script stops (exit 2) without reading further. Postgres refuses any
 *     write on that session ("cannot execute … in a read-only transaction");
 *   - forecast.service and buildOfficialEvReport issue no writes;
 *   - no model provider is configured (the forecast is deterministic).
 * Run it under the cross-wave database lock when other tracks share the
 * database: it builds hundreds of forecasts.
 */
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execFileSync } = require("child_process");

const backendDir = path.resolve(__dirname, "..", "..");

const parseArgs = (argv) => {
  const args = { asOf: null, beforeRef: null, out: null, project: null };
  const names = { "--as-of": "asOf", "--before-ref": "beforeRef", "--out": "out", "--project": "project" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = names[argv[index]];
    if (!key || argv[index + 1] === undefined) {
      console.error(`usage: node scripts/project-controls/forecast-change-impacts-census.js [--as-of <ISO>] [--before-ref <git ref>] [--out <file.json>] [--project <id>] (bad argument: ${argv[index]})`);
      process.exit(64);
    }
    args[key] = argv[index + 1];
    index += 1;
  }
  if (args.asOf !== null && Number.isNaN(new Date(args.asOf).getTime())) {
    console.error(`--as-of is not an instant: ${args.asOf}`);
    process.exit(64);
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));
const callerCwd = process.cwd();

process.chdir(backendDir);
require(require.resolve("dotenv", { paths: [backendDir] })).config({ path: path.join(backendDir, ".env") });
process.env.DATABASE_CONNECTION_LIMIT = "1";
for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "AI_PROVIDER"]) process.env[key] = "";

const { prisma } = require(path.join(backendDir, "src", "config", "db"));
const after = require(path.join(backendDir, "src", "services", "forecast.service"));

class NotReadOnly extends Error {}

const assertReadOnly = async (when) => {
  const [{ transaction_read_only: value }] = await prisma.$queryRawUnsafe("SHOW transaction_read_only");
  if (value !== "on") throw new NotReadOnly(`the session is not read-only ${when} (transaction_read_only = ${value}); stopping`);
  return value;
};

/** That ref's forecast.service.js, compiled in memory beside the real one so its requires resolve. */
const loadAtRef = (ref) => {
  const source = execFileSync("git", ["show", `${ref}:backend/src/services/forecast.service.js`], { cwd: backendDir, encoding: "utf8" });
  const filename = path.join(backendDir, "src", "services", `forecast.service.at-${ref.replace(/[^A-Za-z0-9]/g, "_")}.in-memory.js`);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(source, filename);
  return mod.exports;
};

const MONEY_KEYS = new Set(["budget", "bac", "eac", "bottomUp", "projected", "overrun", "overrunPct", "actual", "committed", "revised", "forecast"]);
const moneyPaths = (value, at = "", out = []) => {
  if (Array.isArray(value)) value.forEach((entry, index) => moneyPaths(entry, `${at}[${index}]`, out));
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (MONEY_KEYS.has(key) && (typeof inner === "number" || inner === null)) out.push([`${at}.${key}`, inner]);
      moneyPaths(inner, `${at}.${key}`, out);
    }
  }
  return out;
};
const moneyOf = (forecast) => JSON.stringify(moneyPaths(forecast?.cost)) + JSON.stringify((forecast?.activities || []).map((activity) => moneyPaths(activity.cost)));

const summaryOf = (forecast) => {
  if (!forecast || forecast.available === false) return { available: false, reason: forecast?.reason || null };
  return {
    available: true,
    plannedFinish: forecast.schedule?.plannedFinish ?? null,
    projectedFinish: forecast.schedule?.projectedFinish ?? null,
    slipDays: forecast.schedule?.slipDays ?? null,
    basis: forecast.schedule?.basis ?? null,
    activityBasedFinish: forecast.schedule?.activityBasedFinish ?? null,
    scheduleLevel: forecast.summary?.scheduleLevel ?? null,
    costLevel: forecast.summary?.costLevel ?? null,
    atRisk: forecast.schedule?.counts?.atRisk ?? null,
    criticalDriver: forecast.schedule?.criticalDriver ?? null,
    impactDaysTotal: (forecast.activities || []).reduce((sum, activity) => sum + (Number(activity.impactDays) || 0), 0),
    activitiesWithImpact: (forecast.activities || []).filter((activity) => Number(activity.impactDays) > 0).length,
  };
};

const build = async (service, projectArgs) => {
  try {
    return await service.buildForecast(projectArgs);
  } catch (error) {
    return { available: false, reason: `error: ${error.code || error.message}` };
  }
};

const arrow = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? `${a ?? "—"}` : `${a ?? "—"} → ${b ?? "—"}`);

const printTables = (result) => {
  const { rows } = result;
  const compared = Boolean(result.beforeRef);
  const withLinks = rows.filter((row) => row.approvedCoLinks > 0);
  const errors = rows.filter((row) => [row.before, row.after].some((summary) => summary && !summary.available && String(summary.reason || "").startsWith("error:")));
  const noSchedule = rows.filter((row) => !row.after.available && !String(row.after.reason || "").startsWith("error:"));
  console.log(`\nForecast change-order impacts census — asOf ${result.asOf}${compared ? `, before = ${result.beforeRef}, after = this checkout` : ""}; session read-only: ${result.sessionReadOnly}\n`);
  console.log("| | projects |\n|---|---|");
  console.log(`| durable projects | ${rows.length} |`);
  console.log(`| with an approved, unarchived CO link with approvedScheduleImpactDays > 0 | ${withLinks.length} |`);
  if (compared) {
    const moving = rows.filter((row) => row.moves);
    console.log(`| **move** (projected finish, slip or level) | **${moving.length}** |`);
    console.log(`| with links that do not move | ${withLinks.filter((row) => !row.moves).length} |`);
    console.log(`| without such links | ${rows.length - withLinks.length} (of which moving: ${rows.filter((row) => row.approvedCoLinks === 0 && row.moves).length}) |`);
    console.log(`| any money figure of the forecast changed | ${rows.filter((row) => !row.moneyIdentical).length} |`);
    console.log(`| cost block not identical | ${rows.filter((row) => !row.costBlockIdentical).length} (${rows.filter((row) => !row.costBlockIdentical).map((row) => row.projectId.slice(0, 8)).join(", ") || "none"}) |`);
    console.log(`| EV figures (SPI, CPI, cutoff) not identical | ${rows.filter((row) => !row.evIdentical).length} |`);
  }
  console.log(`| no schedule (forecast not available, same reason ${compared ? "before and after" : ""}) | ${noSchedule.length} |`);
  console.log(`| forecast errored | ${errors.length} |`);
  console.log(`| approved-order groups with one repeated description on one project | ${result.repeatedDescriptions.length}${result.repeatedDescriptions.length ? ` (${result.repeatedDescriptions.map((group) => `${group.projectId.slice(0, 8)} ×${group.count}`).join(", ")})` : ""} |`);
  console.log("\n| project | name | approved CO links / days | Σ impactDays | projected finish | slip | level | moves |\n|---|---|---|---|---|---|---|---|");
  for (const row of withLinks) {
    const b = compared ? row.before : row.after;
    const a = row.after;
    console.log(`| \`${row.projectId.slice(0, 8)}\` | ${row.project} | ${row.approvedCoLinks} / ${row.approvedCoImpactDays} | ${arrow(b.impactDaysTotal, a.impactDaysTotal)} | ${arrow(b.projectedFinish, a.projectedFinish)} | ${arrow(b.slipDays, a.slipDays)} | ${arrow(b.scheduleLevel, a.scheduleLevel)} | ${compared ? (row.moves ? "yes" : "no") : "—"} |`);
  }
};

const traceProject = async (projectId, asOf) => {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, orgId: true, projectCalendar: true, endDate: true } });
  if (!project) return { projectId, error: "not found" };
  const links = await prisma.changeOrderActivityLink.findMany({
    where: { projectId, approvedScheduleImpactDays: { gt: 0 }, changeOrder: { projectId, status: "approved", archivedAt: null } },
    select: { approvedScheduleImpactDays: true, relationType: true, activity: { select: { name: true, activityCode: true } }, changeOrder: { select: { id: true, ref: true, description: true, value: true, approvedAt: true, createdAt: true, scheduleImpactSummary: true } } },
    orderBy: { createdAt: "asc" },
  });
  const forecast = await after.buildForecast({ orgId: project.orgId, projectId, asOf });
  const trace = {
    project: { id: project.id, name: project.name, projectCalendar: project.projectCalendar, endDate: project.endDate },
    approvedLinks: links.map((link) => ({ ref: link.changeOrder.ref, id: link.changeOrder.id, description: link.changeOrder.description, value: String(link.changeOrder.value), createdAt: link.changeOrder.createdAt, approvedAt: link.changeOrder.approvedAt, scheduleImpactSummary: link.changeOrder.scheduleImpactSummary, activity: `${link.activity.activityCode || ""} ${link.activity.name}`.trim(), relationType: link.relationType, approvedScheduleImpactDays: link.approvedScheduleImpactDays })),
    schedule: forecast.available ? { ...forecast.schedule, topRisks: undefined } : { available: false, reason: forecast.reason },
    impactedActivities: (forecast.activities || []).filter((activity) => activity.impactDays > 0).map((activity) => ({ name: activity.name, code: activity.code, plannedFinish: activity.plannedFinish, projectedFinish: activity.projectedFinish, basis: activity.basis, slipDays: activity.slipDays, impactDays: activity.impactDays, float: activity.float, isCritical: activity.isCritical })),
  };
  console.log(`\nTrace of ${project.name} (${project.id}), calendar ${project.projectCalendar || "—"}`);
  console.log("| order | approved | activity | days | description |\n|---|---|---|---|---|");
  for (const link of trace.approvedLinks) console.log(`| ${link.ref} | ${link.approvedAt ? new Date(link.approvedAt).toISOString() : "—"} | ${link.activity} | ${link.approvedScheduleImpactDays} | ${link.description.slice(0, 90)} |`);
  if (forecast.available) {
    const s = forecast.schedule;
    console.log(`planned finish ${s.plannedFinish}, projected ${s.projectedFinish} (activity-based ${s.activityBasedFinish}, EV-based ${s.evBasedFinish ?? "—"}), slip ${s.slipDays}, basis ${s.basis}, driver ${s.criticalDriver ? `${s.criticalDriver.name} (${s.criticalDriver.slipDays})` : "—"}`);
    for (const activity of trace.impactedActivities) console.log(`  ${activity.code || ""} ${activity.name}: planned ${activity.plannedFinish}, projected ${activity.projectedFinish} (${activity.basis}), slip ${activity.slipDays} + impact ${activity.impactDays}, float ${activity.float ?? "—"}${activity.isCritical ? ", critical" : ""}`);
  } else console.log(`forecast not available: ${forecast.reason}`);
  return trace;
};

(async () => {
  await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  const readOnlyBefore = await assertReadOnly("before the run");
  const before = args.beforeRef ? loadAtRef(args.beforeRef) : null;
  const asOf = args.asOf ? new Date(args.asOf) : new Date();

  const projects = await prisma.project.findMany({
    where: { org: { NOT: { name: { startsWith: "LiveTest " } } } },
    select: { id: true, name: true, orgId: true, org: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const links = await prisma.changeOrderActivityLink.groupBy({
    by: ["projectId"],
    where: { approvedScheduleImpactDays: { gt: 0 }, changeOrder: { status: "approved", archivedAt: null } },
    _count: { _all: true },
    _sum: { approvedScheduleImpactDays: true },
  });
  const linkBy = new Map(links.map((row) => [row.projectId, { links: row._count._all, days: Number(row._sum.approvedScheduleImpactDays || 0) }]));
  const durable = new Set(projects.map((project) => project.id));
  const repeated = await prisma.changeOrder.groupBy({
    by: ["projectId", "description"],
    where: { status: "approved", archivedAt: null },
    _count: { _all: true },
    having: { description: { _count: { gt: 1 } } },
  });
  const repeatedDescriptions = repeated.filter((group) => durable.has(group.projectId)).map((group) => ({ projectId: group.projectId, description: group.description, count: group._count._all }));

  const rows = [];
  for (const project of projects) {
    await assertReadOnly(`before project ${project.id}`);
    const projectArgs = { orgId: project.orgId, projectId: project.id, asOf };
    const now = await build(after, projectArgs);
    const old = before ? await build(before, projectArgs) : null;
    const a = summaryOf(now);
    const b = old ? summaryOf(old) : null;
    rows.push({
      projectId: project.id,
      project: project.name,
      org: project.org?.name || null,
      approvedCoLinks: linkBy.get(project.id)?.links || 0,
      approvedCoImpactDays: linkBy.get(project.id)?.days || 0,
      before: b,
      after: a,
      ...(old
        ? {
            moves: ["projectedFinish", "slipDays", "scheduleLevel"].some((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key])),
            impactMoves: b.impactDaysTotal !== a.impactDaysTotal,
            moneyIdentical: moneyOf(old) === moneyOf(now),
            costBlockIdentical: JSON.stringify(old?.cost ?? null) === JSON.stringify(now?.cost ?? null),
            evIdentical: JSON.stringify([old?.schedule?.spi, old?.schedule?.cpi, old?.earnedValueCutoff]) === JSON.stringify([now?.schedule?.spi, now?.schedule?.cpi, now?.earnedValueCutoff]),
          }
        : {}),
    });
  }
  const trace = args.project ? await traceProject(args.project, asOf) : null;
  const readOnlyAfter = await assertReadOnly("after the run");
  const result = { asOf: asOf.toISOString(), beforeRef: args.beforeRef, afterRef: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: backendDir, encoding: "utf8" }).trim(), sessionReadOnly: readOnlyBefore === "on" && readOnlyAfter === "on" ? "on" : "off", projects: rows.length, repeatedDescriptions, rows, trace };
  printTables(result);
  if (args.out) {
    fs.writeFileSync(path.resolve(callerCwd, args.out), JSON.stringify(result, null, 2));
    console.log(`\nfull result: ${path.resolve(callerCwd, args.out)}`);
  }
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error instanceof NotReadOnly ? error.message : error);
  await prisma.$disconnect().catch(() => {});
  process.exit(error instanceof NotReadOnly ? 2 : 1);
});
