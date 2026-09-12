/**
 * Phase 21B · step 2 — prove which project we are continuing, then reconcile
 * it against the figures Phase 21A reported.
 *
 * Identity is established by id and by state, never by name: earlier runs
 * created copies with the same name pattern, and continuing the wrong one
 * would silently invalidate every figure that follows.
 */
const fs = require("fs");
const path = require("path");
const { GET, cents, money, check, note, section, summary, readLedger } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, qs, cost, finance, planner, warehouse } = ctx.people;

/** What Phase 21A certified. */
const EXPECTED = {
  originalBudget: 1_700_000,
  approvedChanges: 250_000,
  revisedBudget: 1_950_000,
  committed: 100_000,
  actual: 69_204,
  directCost: 8_500,
  certifiedSubcontract: 60_000,
  materialIssue: 704,
  stockOnHand: 86,
  cashOut: 54_000,
  retention: 6_000,
  activities: 14,
  boqItems: 5,
  // 7 from stage 3, plus the "Unassigned approved changes" holding line the
  // product created when approved variations arrived with no budget line.
  budgetLines: 8,
  teamMembers: 8,
  costCodes: 7,
};

async function main() {
  section("PHASE 21C · STEP 0 — snapshot and prove the project we are continuing");

  // ── identity ─────────────────────────────────────────────────────────────
  const project = await GET(pm, `/projects/${P}`);
  note("project id", project.id);
  note("project name", project.name);
  note("created", project.createdAt);
  check("the id matches the one Phase 21A recorded", P, project.id);
  check("it is not archived", null, project.archivedAt ?? null);
  check("contract value is the one 21A set", cents(2_000_000), cents(project.contractValue));

  // Is there more than one Phase 21 project? Name them all, then show why this
  // one is the canonical one.
  const all = await GET(pm, "/projects?limit=100&includeArchived=true&search=PHASE21");
  const candidates = (all.items || []).filter((p) => String(p.name).includes("PHASE21"));
  note("projects matching PHASE21", candidates.length);
  for (const c of candidates) {
    const mark = c.id === P ? " <= CONTINUING" : c.archivedAt ? " (archived)" : "";
    note(`  ${c.id}`, `${c.name}${mark}`);
  }
  const live = candidates.filter((c) => !c.archivedAt);
  check("exactly one live PHASE21 project, and it is this one", 1, live.length);

  // ── the structure 21A built ──────────────────────────────────────────────
  section("2.1  Structure");

  const team = await GET(pm, `/projects/${P}/team`);
  check("team members", EXPECTED.teamMembers, (team.items || team.members || []).length);

  const acts = await GET(planner, `/projects/${P}/activities`);
  const actRows = Array.isArray(acts) ? acts : acts.items || [];
  check("activities", EXPECTED.activities, actRows.length);
  check("WBS branches", 3, new Set(actRows.map((a) => a.wbsCode).filter(Boolean)).size);
  check("critical path activities", 12, actRows.filter((a) => Number(a.totalFloat) === 0).length);

  const schedule = await GET(planner, `/projects/${P}/schedule`);
  check("the schedule module reports the activities (the P21-001 fix)", EXPECTED.activities, schedule?.revision?.activityCount);

  const boq = await GET(qs, `/projects/${P}/boq`);
  check("BOQ items", EXPECTED.boqItems, (boq.items || boq.boqItems || []).length);

  const codes = await GET(cost, `/projects/${P}/budget/cost-codes`);
  note("cost codes on the project", (codes.items || []).length);

  const budget = await GET(cost, `/projects/${P}/budget/lines`);
  const lines = budget.items || budget.lines || [];
  check("budget lines (7 planned + 1 system holding line for unassigned changes)", EXPECTED.budgetLines, lines.length);
  const holding = lines.find((l) => (l.costCode?.code ?? l.costCode) === "CO");
  check("the holding line carries the approved changes and no original budget", true, Boolean(holding) && cents(holding.originalBudget) === 0 && cents(holding.approvedChanges) === cents(EXPECTED.approvedChanges));
  const originalTotal = lines.reduce((s, l) => s + cents(l.originalBudget), 0);
  check("ORIGINAL BUDGET", cents(EXPECTED.originalBudget), originalTotal);
  const approvedTotal = lines.reduce((s, l) => s + cents(l.approvedChanges ?? 0), 0);
  const revisedTotal = lines.reduce((s, l) => s + cents(l.revisedBudget ?? 0), 0);
  check("APPROVED CHANGES", cents(EXPECTED.approvedChanges), approvedTotal);
  check("REVISED BUDGET", cents(EXPECTED.revisedBudget), revisedTotal);
  check("Revised = Original + approved changes", originalTotal + approvedTotal, revisedTotal);

  // ── the money 21A left behind ────────────────────────────────────────────
  section("2.2  Financial baseline");

  const commitments = await GET(qs, `/projects/${P}/commitments`);
  const commitRows = commitments.items || commitments.commitments || [];
  const executed = commitRows.filter((c) => c.status === "executed");
  check("executed commitments", 1, executed.length);
  const committedTotal = executed.reduce((s, c) => s + cents(c.revised ?? c.original ?? 0), 0);
  check("EXECUTED COMMITMENTS", cents(EXPECTED.committed), committedTotal);

  const L = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  note("ledger entries", L.entries);
  note("ledger by source", JSON.stringify(Object.fromEntries(Object.entries(L.bySource).map(([k, v]) => [k, money(v)]))));
  note("ledger by cost type", JSON.stringify(Object.fromEntries(Object.entries(L.byCostType).map(([k, v]) => [k, money(v)]))));

  check("CostLedgerEntry total", cents(EXPECTED.actual), L.ledgerCents);
  check("  of which certified subcontract", cents(EXPECTED.certifiedSubcontract), L.bySource.sub_pay_app ?? 0);
  check("  of which material issue", cents(EXPECTED.materialIssue), L.bySource.material_issue ?? 0);
  check("  of which direct cost", cents(EXPECTED.directCost), L.bySource.direct_cost ?? 0);
  check("budget-line actual projection", cents(EXPECTED.actual), L.budgetProjectionCents);
  check("activity actual projection", cents(EXPECTED.actual), L.activityProjectionCents);
  check("no legacy opening balance", 0, L.legacyOpeningCents);
  check("the service reports itself balanced", true, L.balanced);

  const payApps = await GET(qs, `/projects/${P}/pay-apps`);
  const paRows = payApps.items || payApps.payApps || [];
  const approved = paRows.filter((p) => p.status === "approved" || p.status === "paid");
  check("approved pay apps", 1, approved.length);
  check("certified gross", cents(EXPECTED.certifiedSubcontract), cents(approved[0]?.grossThisPeriod ?? 0));
  check("retention held", cents(EXPECTED.retention), cents(approved[0]?.retentionThisPeriod ?? 0));
  check("paid", cents(EXPECTED.cashOut), cents(approved[0]?.paidAmount ?? 0));

  const cash = await GET(finance, `/projects/${P}/cash-flow`);
  check("cash out", cents(EXPECTED.cashOut), cents(cash.summary?.outflow ?? 0));
  check("cash in", 0, cents(cash.summary?.inflow ?? 0));

  const item = await GET(warehouse, `/inventory/items/${ctx.itemId}`);
  const onHand = Number(item.onHand ?? item.stockOnHand ?? item.quantity ?? 0);
  const wa = Number(item.averageCost ?? item.weightedAverageCost ?? item.unitCost ?? 0);
  note("stock on hand", `${onHand} bags @ ${wa}`);
  check("weighted average is still 11.00", 11, wa);
  check("stock left is 150 less the 64 issued", EXPECTED.stockOnHand, onHand);

  // ── the anchors Phase 21B will build on ──────────────────────────────────
  ctx.baseline21B = {
    verifiedAt: new Date().toISOString(),
    projectId: P,
    originalBudgetCents: originalTotal,
    committedCents: committedTotal,
    actualCents: L.ledgerCents,
    bySource: L.bySource,
    cashOutCents: cents(cash.summary?.outflow ?? 0),
    stockOnHand: onHand,
    weightedAverage: wa,
  };
  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));

  return summary();
}

main()
  .then((failed) => {
    if (failed) {
      console.error("\nSNAPSHOT DID NOT RECONCILE — diagnose before adding any transaction.");
    }
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("\nSNAPSHOT ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
