/**
 * Phase 21C · stage 13 — a crew day of labour, posted through the ledger.
 *
 *   5 steelfixers x 8 hours regular @ 50.00/h on A130 (foundations), 01-100
 *   = 40 hours x 50.00 = 2,000.00 exactly
 *
 * The product caps a worker at 24 hours a day, so "40 hours" is a crew of five
 * at eight each — which is also what a foundation day looks like. Approval
 * snapshots each worker's rate and posts the amount to the cost ledger; the
 * gate is that it reaches the authoritative ledger as a labour source, not
 * merely an activity's actual column.
 *
 * Dated in the project's 2027 construction period, so — like the subcontract
 * and crane costs — it sits beyond the EV report's 2026 cutoff and is counted
 * in the lifetime ledger, not in AC-to-date. That is the established as-of
 * rule, and it is stated rather than hidden.
 *
 * Idempotent: workers are found by employee number; the day's timesheet is
 * keyed by clientRequestId; an approved sheet is left alone.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, probe, cents, money, check, note, section, summary, readLedger } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, cost, site, warehouse } = ctx.people;

const RATE = 50;
const HOURS = 8;
const CREW = ["Ahmed Farouk", "Samuel Okoro", "Deepak Nair", "Carlos Mendes", "Tomasz Nowak"];
const DAY = "2027-02-01";
const REQUEST_ID = `${ctx.tag}-TS-${DAY}`;
const EXPECTED = CREW.length * HOURS * RATE; // 2,000.00

async function main() {
  section(`PHASE 21C · STAGE 13 — labour: ${CREW.length} x ${HOURS}h @ ${RATE} = ${money(cents(EXPECTED))}`);

  const before = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  note("ledger before labour", `${money(before.ledgerCents)} sources ${JSON.stringify(Object.fromEntries(Object.entries(before.bySource).map(([k, v]) => [k, money(v)])))}`);

  // ── 13.1 the crew ────────────────────────────────────────────────────────
  section("13.1  Workers — each with the rate that will be snapshotted");

  const existing = await GET(site, `/projects/${P}/timesheets/workers`);
  const rows = existing.items || existing;
  const workers = [];
  for (const [i, name] of CREW.entries()) {
    const employeeNumber = `${ctx.stamp}-W${i + 1}`;
    let w = rows.find((r) => r.employeeNumber === employeeNumber);
    if (!w) {
      w = await POST(site, `/projects/${P}/timesheets/workers`, {
        name,
        employeeNumber,
        trade: "Steelfixer",
        classification: "skilled",
        hourlyRate: RATE,
        overtimeMultiplier: 1.5,
        status: "active",
      });
    }
    workers.push(w);
  }
  check("five workers on the project", 5, workers.length);
  check("every worker carries the 50.00 rate", true, workers.every((w) => cents(w.hourlyRate) === cents(RATE)));

  // ── 13.2 the day ─────────────────────────────────────────────────────────
  section("13.2  The timesheet — one day, five entries on the foundation activity");

  const sheets = await GET(site, `/projects/${P}/timesheets?limit=200`);
  const sheetRows = sheets.items || sheets;
  let sheet = sheetRows.find((s) => s.clientRequestId === REQUEST_ID || (String(s.date).slice(0, 10) === DAY && (s.notes || "").includes(REQUEST_ID)));
  if (sheet) {
    note("timesheet exists, reusing", `${sheet.ref ?? sheet.id} status=${sheet.status}`);
  } else {
    sheet = await POST(site, `/projects/${P}/timesheets`, {
      date: DAY,
      clientRequestId: REQUEST_ID,
      notes: `${REQUEST_ID} foundation steelfixing, grid A-D`,
      entries: workers.map((w) => ({
        workerId: w.id,
        activityId: ctx.activities.A130,
        costCodeId: ctx.costCodes["01-100"],
        timeType: "regular",
        hours: HOURS,
        startTime: "07:00",
        endTime: "15:00",
      })),
    });
    note("timesheet created", `${sheet.ref ?? sheet.id} status=${sheet.status}`);
  }
  ctx.timesheetId = sheet.id;
  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));

  const detail = await GET(site, `/projects/${P}/timesheets/${sheet.id}`);
  const entries = detail.entries || [];
  check("five entries", 5, entries.length);
  check("forty hours in total", CREW.length * HOURS, entries.reduce((s, e) => s + Number(e.hours), 0));
  check("every entry is on the foundation activity", true, entries.every((e) => e.activityId === ctx.activities.A130));
  check("every entry is on cost code 01-100", true, entries.every((e) => e.costCodeId === ctx.costCodes["01-100"]));

  // ── 13.3 submit, approve — and the post ──────────────────────────────────
  section("13.3  Approval posts the labour cost");

  if (["approved", "posted"].includes(detail.status)) {
    note("already approved, not repeating", detail.status);
  } else {
    if (detail.status !== "submitted") {
      const sub = await probe(site, "POST", `/projects/${P}/timesheets/${sheet.id}/submit`, {});
      note("  submit (site engineer)", `${sub.status} ${sub.code ?? "ok"}`);
      if (!sub.ok && sub.status !== 409) throw new Error(`submit failed: ${sub.status} ${sub.code} ${sub.message}`);
    }
    // A storeman may not approve labour; the cost controller may.
    const byStore = await probe(warehouse, "POST", `/projects/${P}/timesheets/${sheet.id}/approve`, {});
    check("a storeman cannot approve a timesheet", 403, byStore.status);
    const app = await probe(cost, "POST", `/projects/${P}/timesheets/${sheet.id}/approve`, {});
    note("  approve (cost controller)", `${app.status} ${app.code ?? "ok"}`);
    if (!app.ok && app.status !== 409) throw new Error(`approve failed: ${app.status} ${app.code} ${app.message}`);
  }

  const approved = await GET(cost, `/projects/${P}/timesheets/${sheet.id}`);
  check("the timesheet is approved", "approved", approved.status);
  const postedTotal = (approved.entries || []).reduce((s, e) => s + cents(e.amount ?? e.postedAmount ?? 0), 0);
  check("the sheet's own total is 2,000.00", cents(EXPECTED), postedTotal);
  check("each entry snapshotted the 50.00 rate", true, (approved.entries || []).every((e) => cents(e.rate) === cents(RATE)));

  // ── 13.4 the ledger, independently ───────────────────────────────────────
  section("13.4  The authoritative ledger moved by exactly 2,000.00");

  const after = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  const delta = after.ledgerCents - before.ledgerCents;
  note("ledger after", `${money(after.ledgerCents)} sources ${JSON.stringify(Object.fromEntries(Object.entries(after.bySource).map(([k, v]) => [k, money(v)])))}`);
  check("ACTUAL COST rose by exactly 2,000.00", cents(EXPECTED), delta);
  const labourSource = Object.entries(after.bySource).find(([k]) => /timesheet|labour|labor/i.test(k));
  check("it is on the ledger as a labour source, not only an activity column", cents(EXPECTED), labourSource ? labourSource[1] : 0);
  note("  labour source key", labourSource ? labourSource[0] : "(none)");
  check("it is classified as labour cost", cents(EXPECTED), after.byCostType.labour ?? 0);
  check("the budget-line projection agrees", after.ledgerCents, after.budgetProjectionCents);
  check("the activity projection agrees", after.ledgerCents, after.activityProjectionCents);
  check("still balanced", true, after.balanced);
  ctx.financials.labourCents = delta;
  ctx.financials.afterLabour = after;

  // The 01-100 site works budget line now shows the actual.
  const budget = await GET(cost, `/projects/${P}/budget/lines`);
  const siteWorks = (budget.items || budget.lines || []).find((l) => l.id === ctx.budgetLines["01-100"]);
  check("budget line 01-100 shows 2,000.00 actual", cents(EXPECTED), cents(siteWorks?.actual ?? 0));

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 13 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
