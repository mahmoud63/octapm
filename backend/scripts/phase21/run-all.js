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
// Every stage of the certification, in the order it was driven. There is no
// stage 6: change and progress became stages 8 and 9 in 21B. A stage named
// here that is not on disk fails the run — a runner that skips what it cannot
// find can exit green having proved nothing (Phase 21D, CX21-008).
const STAGES = [
  "stage1-foundation.js",
  "stage2-schedule.js",
  "stage3-boq-budget.js",
  "stage4-procurement-inventory.js",
  "stage5-subcontract.js",
  "stage7-security.js",
  "stage8-change-directcost.js",
  "stage9-progress-ev.js",
  "stage10-client.js",
  "stage11-rfq.js",
  "stage12-three-way-match.js",
  "stage13-labour.js",
  "stage14-rfi.js",
  "stage15-document-control.js",
  "stage16-quality.js",
  "stage17-field-safety.js",
  "stage18-meetings-tasks.js",
  "stage19-browser.js",
  "snapshot.js",
];

const keep = process.argv.includes("--keep");
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

if (process.env.P21_CONTEXT) {
  console.error("run-all.js is the demo runner; a certification run goes through scripts/cert/run-certified-lifecycle.js");
  process.exit(1);
}

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

if (only && !STAGES.some((stage) => stage.includes(only))) {
  console.error(`--only=${only} matches no stage; nothing was run`);
  process.exit(1);
}

let failed = 0;
for (const stage of STAGES) {
  if (only && !stage.includes(only)) continue;
  if (!fs.existsSync(path.join(__dirname, stage))) {
    console.error(`--- ${stage}: MISSING — the certification cannot be reproduced without it ---`);
    failed += 1;
    break;
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
