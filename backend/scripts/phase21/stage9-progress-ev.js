/**
 * Phase 21B · stage 9 — progress and earned value.
 *
 * The activities carry the BOQ money allocated to them in stage 3:
 *
 *   A110 excavation      60,000.00
 *   A120 blinding        30,000.00
 *   A130 foundations     90,000.00
 *   A310 blockwork      135,000.00
 *   A320 plastering      72,000.00
 *                       387,000.00 allocated  (B-003, 72,000, left unallocated)
 *
 * EV is computed here from those figures and the approved percentages, and
 * then compared with what the product reports. AC comes from the cost ledger.
 * PV is the product's, because planned value depends on the data date and its
 * calendar — so SPI is checked as arithmetic over an independently derived EV
 * rather than as a number the dashboard agrees with itself about.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, probe, cents, money, check, note, section, summary, readLedger } = require("./harness");

const CONTEXT = process.env.P21_CONTEXT || path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, planner, site, cost } = ctx.people;

/** activity code -> percent complete to book */
const PROGRESS = { A110: 100, A120: 50 };

/**
 * Only APPROVED allocations carry earned value — a draft allocation is a
 * proposal about where the money sits, not a fact. Stage 3 created them and
 * left them in draft, so they are walked through submit and approve here.
 */
async function approveAllocations() {
  const allocs = await GET(planner, `/projects/${P}/activity-boq-allocations`);
  const rows = allocs.items || allocs.allocations || [];
  for (const row of rows) {
    if (row.status === "approved") continue;
    if (row.status !== "submitted") {
      await probe(planner, "POST", `/projects/${P}/activity-boq-allocations/${row.id}/submit`, {});
    }
    const res = await probe(pm, "POST", `/projects/${P}/activity-boq-allocations/${row.id}/approve`, {});
    note(`  allocation ${row.id.slice(0, 8)} approve`, `${res.status} ${res.code ?? "ok"}`);
  }
}

async function allocatedByActivity() {
  const allocs = await GET(planner, `/projects/${P}/activity-boq-allocations`);
  const rows = allocs.items || allocs.allocations || [];
  const byActivity = new Map();
  for (const row of rows) {
    if (row.status !== "approved") continue;
    byActivity.set(row.activityId, (byActivity.get(row.activityId) ?? 0) + cents(row.amount));
  }
  return { byActivity, rows };
}

async function main() {
  section("PHASE 21B · STAGE 9 — progress and earned value");

  const ledger = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  const lifetimeAC = ledger.ledgerCents;
  note("lifetime actual cost, from the ledger", money(lifetimeAC));

  /**
   * AC-to-date is not the lifetime ledger. The EV report says so itself:
   * "AC = sum(latest CostRecord.actual where actualThroughDate <= cutoffDate)".
   * Cost booked against a future period is real cost that has not been
   * incurred yet as of the reporting cutoff, and it is right to leave it out.
   *
   * This project runs in 2027 and the clock says 2026, so two of its three
   * cost records are dated beyond the cutoff. That is a property of the test
   * data, not of the product, and it is measured rather than worked around.
   */
  const summaryRows = await GET(cost, `/projects/${P}/cost/summary`);
  const records = summaryRows.records || [];
  const cutoffProbe = await probe(cost, "GET", `/projects/${P}/reports/ev`);
  const cutoffDate = cutoffProbe.ok
    ? new Date(cutoffProbe.data?.reporting?.cutoffDate ?? Date.now())
    : new Date();
  note("reporting cutoff", cutoffDate.toISOString().slice(0, 10));

  let expectedACToDate = 0;
  for (const r of records) {
    const through = r.actualThroughDate ? new Date(r.actualThroughDate) : null;
    const within = through && through <= cutoffDate;
    note(
      `  cost record ${String(r.activityId).slice(0, 8)}`,
      `${money(cents(r.actual))} through ${through ? through.toISOString().slice(0, 10) : "-"} ${within ? "<= cutoff" : "AFTER cutoff, excluded"}`,
    );
    if (within) expectedACToDate += cents(r.actual);
  }
  note("EXPECTED AC-to-date", money(expectedACToDate));
  check(
    "lifetime ledger less the post-cutoff records is AC-to-date",
    lifetimeAC - expectedACToDate,
    records
      .filter((r) => !(r.actualThroughDate && new Date(r.actualThroughDate) <= cutoffDate))
      .reduce((s, r) => s + cents(r.actual), 0),
  );
  const AC = expectedACToDate;

  section("9.0  Approve the BOQ allocations — draft money earns nothing");
  await approveAllocations();

  const { byActivity, rows } = await allocatedByActivity();
  const totalAllocated = [...byActivity.values()].reduce((s, v) => s + v, 0);
  note("allocations counted", `${rows.length} rows, ${money(totalAllocated)} across ${byActivity.size} activities`);
  check("387,000.00 of BOQ money sits on the schedule", cents(387_000), totalAllocated);

  const acts = await GET(planner, `/projects/${P}/activities`);
  const actRows = Array.isArray(acts) ? acts : acts.items || [];
  const byCode = new Map(actRows.map((a) => [a.activityCode, a]));

  // ── 9.1 progress, submitted and approved ─────────────────────────────────
  section("9.1  Progress — booked by the site engineer, approved by the PM");

  for (const [code, pct] of Object.entries(PROGRESS)) {
    const activity = byCode.get(code);
    const submitted = await POST(site, `/projects/${P}/activities/${activity.id}/progress`, {
      pctComplete: pct,
      progressMethod: "percent",
      status: "submitted",
      source: "manual",
      notes: `${ctx.tag} progress claim`,
    });
    note(`${code} claimed at ${pct}%`, `status=${submitted.status ?? "submitted"}`);

    const pending = await GET(pm, `/projects/${P}/activities/${activity.id}/progress-submissions`);
    const list = pending.items || pending.submissions || (Array.isArray(pending) ? pending : []);
    const open = list.find((s) => s.status === "submitted" || s.status === "pending");
    if (open) {
      const approved = await probe(pm, "POST", `/projects/${P}/activities/${activity.id}/progress-submissions/${open.id}/approve`, {});
      note(`  ${code} approved`, `${approved.status} ${approved.code ?? "ok"}`);
    } else {
      note(`  ${code}`, "no open submission — already approved");
    }
  }

  // ── 9.2 EV, computed here before anything is read from the product ───────
  section("9.2  Earned value, worked out independently first");

  const after = await GET(planner, `/projects/${P}/activities`);
  const afterRows = Array.isArray(after) ? after : after.items || [];

  let expectedEV = 0;
  const workings = [];
  for (const activity of afterRows) {
    const allocated = byActivity.get(activity.id) ?? 0;
    if (!allocated) continue;
    const pct = Number(activity.pctComplete ?? 0);
    const earned = Math.round((allocated * pct) / 100);
    expectedEV += earned;
    if (pct > 0) workings.push(`${activity.activityCode} ${money(allocated)} x ${pct}% = ${money(earned)}`);
  }
  for (const line of workings) note("  ", line);
  note("EXPECTED EV", money(expectedEV));

  const expectedCPI = expectedEV / AC;
  note("EXPECTED CPI = EV / AC", `${money(expectedEV)} / ${money(AC)} = ${expectedCPI.toFixed(4)}`);

  // ── 9.3 what the product says ────────────────────────────────────────────
  section("9.3  What the product reports");

  const ev = await probe(cost, "GET", `/projects/${P}/reports/ev`);
  if (!ev.ok) {
    note("EV report", `${ev.status} ${ev.code} — recorded, not assumed`);
    ctx.evReport = `${ev.status} ${ev.code}`;
  } else {
    const r = ev.data;
    note("EV report keys", Object.keys(r).join(", "));
    const totals = r.totals ?? r.summary ?? r;
    note("EV totals", JSON.stringify(totals).slice(0, 400));

    const reportedPV = cents(totals.pv ?? totals.plannedValue ?? 0);
    const reportedEV = cents(totals.ev ?? totals.earnedValue ?? 0);
    const reportedAC = cents(totals.ac ?? totals.actualCost ?? 0);

    check("the product's EV matches the one worked out here", expectedEV, reportedEV);
    check("the product's AC matches the cost ledger", AC, reportedAC);
    note("PV (the product's, from its data date and calendar)", money(reportedPV));

    if (reportedPV > 0) {
      const expectedSPI = expectedEV / reportedPV;
      const reportedSPI = Number(totals.spi ?? 0);
      note("EXPECTED SPI = EV / PV", `${money(expectedEV)} / ${money(reportedPV)} = ${expectedSPI.toFixed(4)}`);
      check("SPI is EV / PV to four places", expectedSPI.toFixed(4), reportedSPI.toFixed(4));
    }
    const reportedCPI = Number(totals.cpi ?? 0);
    check("CPI is EV / AC to four places", expectedCPI.toFixed(4), reportedCPI.toFixed(4));

    ctx.ev = { pv: reportedPV, ev: reportedEV, ac: reportedAC, spi: totals.spi, cpi: totals.cpi };
  }

  // ── 9.4 progress moves EV, and only EV ───────────────────────────────────
  section("9.4  Progressing more work moves EV, and leaves cost alone");

  const before = expectedEV;
  const a130 = byCode.get("A130");
  // Advance from wherever it stands, so a repeated run still measures a real
  // movement rather than re-booking a percentage it already has.
  const currentPct = Number(afterRows.find((a) => a.activityCode === "A130")?.pctComplete ?? 0);
  const nextPct = Math.min(currentPct + 25, 100);
  note("A130 advancing", `${currentPct}% -> ${nextPct}%`);
  await POST(site, `/projects/${P}/activities/${a130.id}/progress`, {
    pctComplete: nextPct,
    progressMethod: "percent",
    status: "submitted",
    source: "manual",
  });
  const subs = await GET(pm, `/projects/${P}/activities/${a130.id}/progress-submissions`);
  const list = subs.items || subs.submissions || (Array.isArray(subs) ? subs : []);
  const open = list.find((s) => s.status === "submitted" || s.status === "pending");
  if (open) await probe(pm, "POST", `/projects/${P}/activities/${a130.id}/progress-submissions/${open.id}/approve`, {});

  const ledgerAfter = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  check("booking progress is not a cost", lifetimeAC, ledgerAfter.ledgerCents);

  const evAfter = await probe(cost, "GET", `/projects/${P}/reports/ev`);
  if (evAfter.ok) {
    const t = evAfter.data.totals ?? evAfter.data.summary ?? evAfter.data;
    const newEV = cents(t.ev ?? t.earnedValue ?? 0);
    const expectedNew = before + Math.round(((byActivity.get(a130.id) ?? 0) * (nextPct - currentPct)) / 100);
    check("EV rose by exactly the extra percentage of the foundations allocation", expectedNew, newEV);
    note("EV now", money(newEV));
    ctx.evAfter = { ev: newEV, ac: ledgerAfter.ledgerCents };
  }

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 9 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
