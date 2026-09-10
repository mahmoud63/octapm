/**
 * Phase 21 · stage 3 — BOQ against the real schedule, and the budget anchor.
 *
 * Deterministic throughout: every figure below is chosen so the totals can be
 * checked on paper, and every comparison is made in integer cents.
 *
 *   BOQ            B-001  5,000 m3  @    12.00 =  60,000   → A110 whole
 *                  B-002    800 m3  @   150.00 = 120,000   → A120 200 + A130 600 (split)
 *                  B-003     60 t   @ 1,200.00 =  72,000   → left unallocated on purpose
 *                  B-004  3,000 m2  @    45.00 = 135,000   → A310 whole
 *                  B-005  4,000 m2  @    18.00 =  72,000   → A320 whole
 *                                              = 459,000
 *
 *   ORIGINAL BUDGET                              1,700,000   ← the anchor
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, PATCH, probe, cents, money, check, note, section, summary } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, planner, qs, cost } = ctx.people;

const BOQ = [
  { code: "B-001", description: "Bulk excavation to reduced level", quantity: 5000, unit: "m3", rate: 12 },
  { code: "B-002", description: "Foundation concrete C35", quantity: 800, unit: "m3", rate: 150 },
  { code: "B-003", description: "High tensile reinforcement", quantity: 60, unit: "ton", rate: 1200 },
  { code: "B-004", description: "Blockwork walls 200mm", quantity: 3000, unit: "m2", rate: 45 },
  { code: "B-005", description: "Internal plaster two coats", quantity: 4000, unit: "m2", rate: 18 },
];

const BUDGET = [
  ["01-100", "labour", "Site works and earthmoving", 120_000],
  ["02-100", "material", "Concrete supply", 400_000],
  ["02-200", "material", "Reinforcement supply", 250_000],
  ["03-100", "subcontract", "Blockwork subcontract", 300_000],
  ["04-100", "subcontract", "MEP first fix subcontract", 350_000],
  ["05-100", "subcontract", "Finishes subcontract", 180_000],
  ["09-100", "indirect", "Preliminaries and site establishment", 100_000],
];

const ORIGINAL_BUDGET = BUDGET.reduce((sum, row) => sum + row[3], 0); // 1,700,000

async function main() {
  section(`PHASE 21 · STAGE 3 — BOQ and budget   project=${ctx.projectName}`);

  // ── 3.1 BOQ items ────────────────────────────────────────────────────────
  section("3.1  BOQ — created from scratch, priced");

  const existing = await GET(qs, `/projects/${P}/boq`);
  const existingItems = existing.items || existing.boqItems || [];
  ctx.boq = Object.fromEntries(existingItems.map((i) => [i.code, i.id]));
  if (existingItems.length) note("BOQ rows already present, reusing", existingItems.length);

  for (const row of BOQ) {
    if (ctx.boq[row.code]) continue;
    const created = await POST(qs, `/projects/${P}/boq/items`, row);
    ctx.boq[row.code] = created.id ?? created.item?.id;
  }
  check("five BOQ rows on the project", 5, Object.keys(ctx.boq).length);

  const boqNow = await GET(qs, `/projects/${P}/boq`);
  const items = boqNow.items || boqNow.boqItems || [];
  const boqTotal = items.reduce((sum, i) => sum + cents(i.amount), 0);
  const expectedBoqTotal = BOQ.reduce((sum, r) => sum + cents(r.quantity * r.rate), 0);
  check("BOQ total is quantity x rate, to the cent", expectedBoqTotal, boqTotal);
  note("BOQ total", money(boqTotal));

  // ── 3.2 allocations to REAL activities ───────────────────────────────────
  section("3.2  BOQ to schedule — whole, split, and deliberately unallocated");

  const A = ctx.activities;
  const allocate = (boqCode, activityCode, quantity, amount) =>
    POST(planner, `/projects/${P}/activity-boq-allocations`, {
      boqItemId: ctx.boq[boqCode],
      activityId: A[activityCode],
      quantity,
      amount,
      source: "manual",
    });

  const before = await GET(planner, `/projects/${P}/activity-boq-allocations`);
  const beforeRows = before.items || before.allocations || [];
  ctx.allocations = {};

  if (beforeRows.length === 0) {
    ctx.allocations["B-001"] = [(await allocate("B-001", "A110", 5000, 60_000)).id];
    // one bill row across two activities
    ctx.allocations["B-002"] = [
      (await allocate("B-002", "A120", 200, 30_000)).id,
      (await allocate("B-002", "A130", 600, 90_000)).id,
    ];
    ctx.allocations["B-004"] = [(await allocate("B-004", "A310", 3000, 135_000)).id];
    ctx.allocations["B-005"] = [(await allocate("B-005", "A320", 4000, 72_000)).id];
  } else {
    note("allocations already present, reusing", beforeRows.length);
    for (const row of beforeRows) {
      const code = items.find((i) => i.id === row.boqItemId)?.code;
      if (!code) continue;
      (ctx.allocations[code] ||= []).push(row.id);
    }
  }

  const allocs = await GET(planner, `/projects/${P}/activity-boq-allocations`);
  const allocRows = allocs.items || allocs.allocations || [];
  check("five allocations exist (one of them a split)", 5, allocRows.length);
  check("B-002 is split across two activities", 2, (ctx.allocations["B-002"] || []).length);
  check("B-003 is deliberately unallocated", undefined, ctx.allocations["B-003"]);

  // No shadow activity was invented: still fourteen.
  const acts = await GET(planner, `/projects/${P}/activities`);
  const actRows = Array.isArray(acts) ? acts : acts.items || [];
  check("naming a real activity created no shadow activity", 14, actRows.length);

  const shadows = await probe(planner, "GET", `/projects/${P}/boq/shadow-activities`);
  if (shadows.ok) {
    const list = shadows.data?.items ?? shadows.data ?? [];
    check("no shadow activities reported", 0, Array.isArray(list) ? list.length : 0);
  }

  // ── 3.3 the allocations that must be refused ─────────────────────────────
  section("3.3  Allocations that must be refused");

  const bad = [
    ["negative quantity", { boqItemId: ctx.boq["B-001"], activityId: A.A110, quantity: -10, amount: -120 }],
    ["zero quantity", { boqItemId: ctx.boq["B-001"], activityId: A.A110, quantity: 0, amount: 0 }],
    [
      "more than the bill row holds",
      { boqItemId: ctx.boq["B-001"], activityId: A.A140, quantity: 99_999, amount: 1_199_988 },
    ],
    [
      "an activity on another project",
      { boqItemId: ctx.boq["B-001"], activityId: "00000000-0000-4000-8000-000000000000", quantity: 1, amount: 12 },
    ],
  ];
  ctx.allocationRefusals = {};
  for (const [label, payload] of bad) {
    const res = await probe(planner, "POST", `/projects/${P}/activity-boq-allocations`, payload);
    ctx.allocationRefusals[label] = `${res.status} ${res.code}`;
    check(`refused: ${label}`, true, res.status >= 400 && res.status < 500);
    note(`  ${label}`, `${res.status} ${res.code}`);
  }

  // ── 3.4 the budget anchor ────────────────────────────────────────────────
  section("3.4  Original budget — the anchor every later figure reconciles to");

  const budgetBefore = await GET(cost, `/projects/${P}/budget/lines`);
  const budgetRows = budgetBefore.items || budgetBefore.lines || [];
  ctx.budgetLines = {};

  if (budgetRows.length === 0) {
    for (const [code, costType, description, originalBudget] of BUDGET) {
      const line = await POST(cost, `/projects/${P}/budget/lines`, {
        costCodeId: ctx.costCodes[code],
        costType,
        description,
        originalBudget,
        status: "active",
      });
      ctx.budgetLines[code] = line.id;
    }
  } else {
    note("budget lines already present, reusing", budgetRows.length);
    for (const row of budgetRows) {
      const code = Object.entries(ctx.costCodes).find(([, id]) => id === row.costCodeId)?.[0];
      if (code) ctx.budgetLines[code] = row.id;
    }
  }
  check("seven budget lines", 7, Object.keys(ctx.budgetLines).length);

  const budgetNow = await GET(cost, `/projects/${P}/budget/lines`);
  const lines = budgetNow.items || budgetNow.lines || [];
  const originalTotal = lines.reduce((sum, l) => sum + cents(l.originalBudget), 0);
  check("ORIGINAL BUDGET is exactly the sum of its lines", cents(ORIGINAL_BUDGET), originalTotal);
  note("ORIGINAL BUDGET", money(originalTotal));

  ctx.financials = { originalBudgetCents: originalTotal };

  // Nothing has been committed or spent yet on a project this new.
  const recon = await probe(cost, "GET", `/projects/${P}/budget/reconciliation`);
  if (recon.ok) {
    note("reconciliation keys", Object.keys(recon.data).join(", "));
    ctx.reconciliationShape = Object.keys(recon.data);
  } else {
    note("budget reconciliation", `${recon.status} ${recon.code}`);
  }

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 3 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
