/**
 * Phase 21 · stage 2 — cost coding, WBS and the schedule spine.
 *
 * The network is chosen so the critical path can be worked out on paper:
 *
 *   SUB   A100 clearance 5 → A110 excavation 10 → A120 blinding 3 → A130 foundations 12
 *                                                                    ├→ A140 backfill 4      (spur, must float)
 *   SUP   A130 → A200 columns L1 8 → A210 beams L1 6 → A220 slab L1 7 → A230 columns L2 8
 *                                                       └→ A300 MEP rough-in 10             (spur, must float)
 *   ARC   A230 → A310 blockwork 9 → A320 plastering 7 → A330 painting 6 → M900 completion 0
 *
 * Longest path = 5+10+3+12+8+6+7+8+9+7+6 = 81 working days, and the two spurs
 * (A140, A300) must carry float because nothing depends on them.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, PUT, PATCH, probe, check, note, section, summary } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, planner } = ctx.people;

/** code, name, category — the organisation's cost breakdown for this job. */
const COST_CODES = [
  ["01-100", "Site works", "labour"],
  ["02-100", "Concrete", "material"],
  ["02-200", "Reinforcement", "material"],
  ["03-100", "Blockwork", "subcontract"],
  ["04-100", "MEP first fix", "subcontract"],
  ["05-100", "Finishes", "subcontract"],
  ["09-100", "Preliminaries", "other"],
];

const WBS = {
  SUB: "1 Substructure",
  SUP: "2 Superstructure",
  ARC: "3 Architectural & MEP",
};

/** code, name, wbs, duration, predecessor code, category, milestone */
const ACTIVITIES = [
  ["A100", "Site clearance", "SUB", 5, null, "civil", false],
  ["A110", "Bulk excavation", "SUB", 10, "A100", "civil", false],
  ["A120", "Blinding concrete", "SUB", 3, "A110", "structural", false],
  ["A130", "Foundation concrete", "SUB", 12, "A120", "structural", false],
  ["A140", "Backfill and compaction", "SUB", 4, "A130", "civil", false],
  ["A200", "Columns level 1", "SUP", 8, "A130", "structural", false],
  ["A210", "Beams level 1", "SUP", 6, "A200", "structural", false],
  ["A220", "Slab level 1", "SUP", 7, "A210", "structural", false],
  ["A230", "Columns level 2", "SUP", 8, "A220", "structural", false],
  ["A300", "MEP first fix rough-in", "ARC", 10, "A220", "mechanical", false],
  ["A310", "Blockwork walls", "ARC", 9, "A230", "structural", false],
  ["A320", "Internal plastering", "ARC", 7, "A310", "finishing", false],
  ["A330", "Painting and decoration", "ARC", 6, "A320", "finishing", false],
  ["M900", "Practical completion", "ARC", 0, "A330", "inspection", true],
];

/** Activities that must sit on the critical path. */
const CRITICAL = ["A100", "A110", "A120", "A130", "A200", "A210", "A220", "A230", "A310", "A320", "A330", "M900"];
/** Spurs nothing depends on: they must carry float. */
const FLOATERS = ["A140", "A300"];

async function main() {
  section(`PHASE 21 · STAGE 2 — cost coding, WBS and schedule   project=${ctx.projectName}`);

  // ── 2.1 cost codes, created once at company level then selected ──────────
  section("2.1  Cost codes — company master, selected onto the project");

  ctx.costCodes = {};
  const library = await GET(pm, "/company/cost-codes?includeArchived=false");
  const existing = new Map((library.items || []).map((c) => [c.code, c]));

  for (const [code, name, category] of COST_CODES) {
    let row = existing.get(code);
    if (!row) {
      row = await POST(pm, "/company/cost-codes", { code, name, category, status: "active" });
      note(`cost code created: ${code} ${name}`, row.id);
    } else {
      note(`cost code reused from the company master: ${code} ${name}`, row.id);
    }
    ctx.costCodes[code] = row.id;
  }
  check("seven cost codes are available", 7, Object.keys(ctx.costCodes).length);

  const selected = await PUT(pm, `/projects/${P}/budget/cost-codes`, {
    costCodeIds: Object.values(ctx.costCodes),
  });
  const onProject = (selected.items || []).filter((c) => ctx.costCodes[c.code]);
  check("all seven are selected onto the project", 7, onProject.length);
  ctx.projectCostCodes = Object.fromEntries((selected.items || []).map((c) => [c.code, c.id ?? c.costCodeId]));

  // ── 2.2 activities ───────────────────────────────────────────────────────
  section("2.2  Schedule — fourteen activities across three WBS branches");

  // Re-runnable: activities already on the project are reused rather than
  // duplicated, so a stage can be repeated after a fix without rebuilding the
  // whole project.
  const already = await GET(planner, `/projects/${P}/activities`);
  const alreadyRows = Array.isArray(already) ? already : already.items || [];
  ctx.activities = Object.fromEntries(alreadyRows.map((a) => [a.activityCode, a.id]));
  if (alreadyRows.length) note("activities already on the project, reusing", alreadyRows.length);

  for (const [code, name, wbs, duration, pred, category, milestone] of ACTIVITIES) {
    if (ctx.activities[code]) continue;
    const payload = {
      name,
      activityCode: code,
      wbsCode: WBS[wbs],
      category,
      duration,
      isMilestone: milestone,
      sortOrder: ACTIVITIES.findIndex((a) => a[0] === code),
      // The API refuses an activity with nobody responsible for it — a real
      // construction rule, and the right one. (OpenAPI does not mark
      // engineerIds required: recorded as a documentation defect.)
      engineerIds: [category === "mechanical" ? ctx.userIds.site : ctx.userIds.site],
    };
    if (pred) {
      payload.dependencies = [{ predecessorId: ctx.activities[pred], relationshipType: "FS", lagDays: 0 }];
    }
    const created = await POST(planner, `/projects/${P}/activities`, payload);
    ctx.activities[code] = created.id;
  }
  check("fourteen activities created", 14, Object.keys(ctx.activities).length);

  const listed = await GET(planner, `/projects/${P}/activities`);
  const rows = Array.isArray(listed) ? listed : listed.items || [];
  check("all fourteen are listed on the project", 14, rows.length);

  const branches = new Set(rows.map((a) => a.wbsCode).filter(Boolean));
  check("three WBS branches", 3, branches.size);

  // ── 2.3 CPM ──────────────────────────────────────────────────────────────
  section("2.3  CPM — critical path, float and project finish");

  const schedule = await GET(planner, `/projects/${P}/schedule`);
  const byCode = new Map(
    (schedule.activities || rows).map((a) => [a.activityCode, a]),
  );
  note("schedule payload keys", Object.keys(schedule).join(", "));

  let criticalOk = 0;
  for (const code of CRITICAL) {
    const a = byCode.get(code);
    if (!a) { check(`critical activity ${code} present`, true, false); continue; }
    if (Number(a.totalFloat) === 0) criticalOk += 1;
    else note(`${code} totalFloat`, a.totalFloat);
  }
  check("every activity on the longest path has zero float", CRITICAL.length, criticalOk);

  for (const code of FLOATERS) {
    const a = byCode.get(code);
    check(`${code} (nothing depends on it) carries float`, true, Number(a?.totalFloat) > 0);
    note(`${code} float`, a?.totalFloat);
  }

  // Longest path by duration, computed here rather than read from the API.
  const durationOf = (code) => ACTIVITIES.find((a) => a[0] === code)[3];
  const expectedLongest = CRITICAL.reduce((sum, code) => sum + durationOf(code), 0);
  note("longest path computed independently (working days)", expectedLongest);

  const milestone = byCode.get("M900");
  ctx.plannedFinish = milestone?.earlyFinishDate ?? milestone?.endDate ?? null;
  note("project finish (milestone early finish)", ctx.plannedFinish);
  check("the completion milestone is on the critical path", 0, Number(milestone?.totalFloat));

  // ── 2.4 CPM recomputes, on the same activity identities ──────────────────
  section("2.4  Lengthen a predecessor — CPM must move, identities must not");

  const beforeIds = new Set(rows.map((a) => a.id));
  const excavation = ctx.activities.A110;
  await PATCH(planner, `/projects/${P}/activities/${excavation}`, { duration: 20 });

  const after = await GET(planner, `/projects/${P}/schedule`);
  const afterRows = after.activities || (await GET(planner, `/projects/${P}/activities`));
  const afterByCode = new Map(afterRows.map((a) => [a.activityCode, a]));
  const afterIds = new Set(afterRows.map((a) => a.id));

  check("no activity was invented by the recalculation", 14, afterIds.size);
  check("every activity kept its identity", true, [...beforeIds].every((id) => afterIds.has(id)));

  const newFinish = afterByCode.get("M900")?.earlyFinishDate ?? afterByCode.get("M900")?.endDate ?? null;
  note("finish after +10 days on excavation", newFinish);
  check("the project finish moved", true, newFinish !== ctx.plannedFinish);

  // put it back so later stages work against the planned network
  await PATCH(planner, `/projects/${P}/activities/${excavation}`, { duration: 10 });
  const restored = await GET(planner, `/projects/${P}/schedule`);
  const restoredRows = restored.activities || (await GET(planner, `/projects/${P}/activities`));
  const restoredFinish =
    restoredRows.find((a) => a.activityCode === "M900")?.earlyFinishDate ??
    restoredRows.find((a) => a.activityCode === "M900")?.endDate ??
    null;
  check("restoring the duration restores the finish", ctx.plannedFinish, restoredFinish);

  // ── 2.5 a planner may plan; a warehouse storeman may not ─────────────────
  const bySite = await probe(ctx.people.warehouse, "POST", `/projects/${P}/activities`, {
    name: "Unauthorised activity",
    activityCode: "X999",
    duration: 1,
  });
  check("a storeman cannot create schedule activities", 403, bySite.status);

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 2 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
