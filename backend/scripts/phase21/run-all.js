/**
 * Runs the Phase 21 stages in order, in one process, against one fresh
 * project. Financial figures are only meaningful on a project nothing has
 * touched twice, so this is how the certifying run is produced.
 *
 *   node run-all.js            fresh stamp, fresh project
 *   node run-all.js --keep     reuse the stamp in context.json
 *
 * A stage that fails stops the run. Nothing is swallowed.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const NODE = process.execPath;
const STAGES = [
  "stage1-foundation.js",
  "stage2-schedule.js",
  "stage3-boq-budget.js",
  "stage4-procurement-inventory.js",
  "stage5-subcontract.js",
  "stage6-change-progress.js",
  "stage7-security.js",
];

const keep = process.argv.includes("--keep");
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

if (!keep) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  process.env.P21_STAMP = stamp;
  const ctxPath = path.join(__dirname, "context.json");
  if (fs.existsSync(ctxPath)) fs.rmSync(ctxPath);
  console.log(`fresh run, stamp ${stamp}\n`);
} else {
  const ctx = JSON.parse(fs.readFileSync(path.join(__dirname, "context.json"), "utf8"));
  process.env.P21_STAMP = ctx.stamp;
  console.log(`continuing stamp ${ctx.stamp}\n`);
}

let failed = 0;
for (const stage of STAGES) {
  if (only && !stage.includes(only)) continue;
  if (!fs.existsSync(path.join(__dirname, stage))) {
    console.log(`--- ${stage}: not written yet, skipping ---`);
    continue;
  }
  console.log(`\n########## ${stage} ##########`);
  try {
    execFileSync(NODE, [path.join(__dirname, stage)], {
      stdio: "inherit",
      env: process.env,
    });
  } catch (err) {
    failed += 1;
    console.error(`\n########## ${stage} FAILED (exit ${err.status}) ##########`);
    break;
  }
}

process.exit(failed === 0 ? 0 : 1);
