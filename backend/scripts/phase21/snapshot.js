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

const CONTEXT = process.env.P21_CONTEXT || path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, qs, cost, finance, planner, warehouse } = ctx.people;

/**
 * The figures of ONE CLEAN PASS of stages 1-18, each derived on paper from a
 * named transaction — a number here is never "whatever the API says now":
 *
 *   stage 3   seven budget lines                                 = 1,700,000.00 original
 *   stage 4   150 bags received at a weighted 11.00; 60 issued   =       660.00 material cost, 90 bags left
 *   stage 5   subcontract 100,000.00 executed; 60,000.00 certified, 10% retained, 54,000.00 paid
 *   stage 7   two probe bags issued and returned                 =         0.00
 *   stage 8   ONE variation approved, 125,000.00 on line 03-100 (a 40,000.00 draft moves nothing);
 *             crane hire booked as a direct cost                 =     8,500.00
 *   stage 9   A110 100%, A120 50%, A130 25% -> EV = 60,000 + 15,000 + 22,500 = 97,500.00
 *   stage 10  IPC 2027-03 gross 97,500.00, 10% retention 9,750.00, net 87,750.00; the client pays 80,000.00
 *   stage 13  labour 5 x 8 h @ 50.00                             =     2,000.00 on the ledger (timesheet)
 *   stage 14  the RFI's change approved, 4,500.00 on line 01-100
 *
 * These used to be the figures of the durable Phase 21 project, which had
 * stages 8 and 9 run twice (two approved 125,000.00 variations, A130 at 50%)
 * and whose approved changes all sat on the product's "CO" holding line,
 * because the change-order API then discarded budgetLineId (P21-012). That
 * defect is fixed (Phase 22B: the approved value lands on the order's own
 * budget line), so a clean pass has no holding line — each change sits on the
 * line it named.
 */
const EXPECTED = {
  originalBudget: 1_700_000,
  // 125,000 (stage 8, the one approved variation) + 4,500 (stage 14, the RFI's change).
  approvedChanges: 125_000 + 4_500,
  approvedChangesOn03100: 125_000, // stage 8 names budget line 03-100
  approvedChangesOn01100: 4_500, // stage 14 names budget line 01-100; the 40,000 draft on it moves nothing
  // 1,700,000 + 125,000 + 4,500.
  revisedBudget: 1_700_000 + 125_000 + 4_500,
  // The client contract: 2,000,000 (stage 1) plus every approved change.
  contractOriginal: 2_000_000,
  contractApprovedChanges: 125_000 + 4_500,
  // Stage 9: 60,000 x 100% + 30,000 x 50% + 90,000 x 25%.
  earnedValue: 60_000 + 15_000 + 22_500,
  // Stage 10: 5,000 x 12 + 100 x 150 + 150 x 150 = 97,500; 10% retained; net 87,750.
  ipcGross: 97_500,
  ipcRetention: 9_750,
  ipcNet: 87_750,
  // 90 bags at the weighted average of 11.00.
  stockValue: 990,
  committed: 100_000,
  // One clean pass: 660 material + 60,000 subcontract + 8,500 direct + 2,000 labour.
  actual: 69_160 + 2_000,
  labour: 2_000,
  cashIn: 80_000,
  directCost: 8_500,
  certifiedSubcontract: 60_000,
  // 60 bags issued at 11.00; the security stage's probe bags are returned (T-14).
  materialIssue: 660,
  stockOnHand: 90,
  cashOut: 54_000,
  retention: 6_000,
  activities: 14,
  boqItems: 5,
  // The 7 of stage 3. A clean pass has no "Unassigned approved changes" holding
  // line: every approved change names its budget line. (It was 8 on the durable
  // project, whose changes were approved while P21-012 was open.)
  budgetLines: 7,
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
  check("budget lines (the 7 planned, and no holding line)", EXPECTED.budgetLines, lines.length);
  const holding = lines.find((l) => (l.costCode?.code ?? l.costCode) === "CO");
  check("there is no holding line: every approved change landed on the line it named", false, Boolean(holding));
  const line03100 = lines.find((l) => l.costCode?.code === "03-100" || l.costCodeCode === "03-100" || l.description === "Blockwork subcontract");
  check("budget line 03-100 carries the 125,000.00 variation (stage 8)", cents(EXPECTED.approvedChangesOn03100), cents(line03100?.approvedChanges ?? 0));
  const line01100 = lines.find((l) => l.costCode?.code === "01-100" || l.costCodeCode === "01-100" || l.description === "Site works and earthmoving");
  check("budget line 01-100 carries the RFI's 4,500.00 (stage 14) and nothing of the 40,000.00 draft", cents(EXPECTED.approvedChangesOn01100), cents(line01100?.approvedChanges ?? 0));
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
  check("  of which labour (timesheet)", cents(EXPECTED.labour), L.bySource.timesheet ?? L.bySource.labour ?? 0);
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
  check("cash in (the client's 80,000.00, stage 10)", cents(EXPECTED.cashIn), cents(cash.summary?.inflow ?? 0));

  const item = await GET(warehouse, `/inventory/items/${ctx.itemId}`);
  const onHand = Number(item.onHand ?? item.stockOnHand ?? item.quantity ?? 0);
  const wa = Number(item.averageCost ?? item.weightedAverageCost ?? item.unitCost ?? 0);
  note("stock on hand", `${onHand} bags @ ${wa}`);
  check("weighted average is still 11.00", 11, wa);
  check("stock left is 150 less the 60 issued", EXPECTED.stockOnHand, onHand);
  check("stock value is 90 bags at 11.00 = 990.00", cents(EXPECTED.stockValue), cents(item.stockValue ?? item.value ?? 0));

  // ── earned value and the client side ─────────────────────────────────────
  section("2.3  Earned value, the client contract and the certificate");

  const ev = await GET(cost, `/projects/${P}/reports/ev`);
  const evTotals = ev.totals ?? ev.summary ?? ev;
  check("EARNED VALUE is 60,000 + 15,000 + 22,500 = 97,500.00", cents(EXPECTED.earnedValue), cents(evTotals.ev ?? evTotals.earnedValue ?? 0));

  const contract = await GET(qs, `/projects/${P}/prime-contract`);
  check("client contract: original value", cents(EXPECTED.contractOriginal), cents(contract.originalValue));
  check("client contract: approved changes are the same 129,500.00 the budget carries", cents(EXPECTED.contractApprovedChanges), cents(contract.approvedChangesValue));
  check("client contract: revised = original + approved changes", cents(EXPECTED.contractOriginal + EXPECTED.contractApprovedChanges), cents(contract.revisedValue));

  const ipc = await GET(qs, `/projects/${P}/ipc/2027-03`);
  check("IPC 2027-03 gross certified", cents(EXPECTED.ipcGross), cents(ipc.grossThisPeriod ?? ipc.totalCert ?? 0));
  check("IPC 2027-03 retention at 10%", cents(EXPECTED.ipcRetention), cents(ipc.totalRet ?? 0));
  check("IPC 2027-03 net payable", cents(EXPECTED.ipcNet), cents(ipc.netPayable ?? 0));
  check("the certificate's gross is the earned value", cents(EXPECTED.earnedValue), cents(ipc.grossThisPeriod ?? ipc.totalCert ?? 0));

  const receivables = await GET(finance, `/projects/${P}/prime-contract/receivables`);
  check("invoiced to the client", cents(EXPECTED.ipcNet), cents(receivables.invoiced));
  check("received from the client", cents(EXPECTED.cashIn), cents(receivables.received));
  check("outstanding receivable is 87,750 - 80,000 = 7,750.00", cents(EXPECTED.ipcNet - EXPECTED.cashIn), cents(receivables.outstanding));

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
