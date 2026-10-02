/**
 * Phase 21 · stage 5 — subcontract to certified cost, and payment that is not
 * cost.
 *
 *   executed subcontract      100,000.00   (2,000 m2 @ 50.00, blockwork, A310)
 *   certified gross work       60,000.00
 *   retention at 10%            6,000.00
 *   paid                       54,000.00
 *
 * The gate: actual cost recognised at certification is the GROSS 60,000 —
 * not the 54,000 that left the bank, and retention does not reduce it.
 * Payment moves cash and nothing else.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, probe, cents, money, check, note, section, summary, readLedger, upload, download } = require("./harness");

const CONTEXT = process.env.P21_CONTEXT || path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, qs, cost, finance, procurement } = ctx.people;

const SUBCONTRACT_VALUE = 100_000;
const CERTIFIED_GROSS = 60_000;
const RETENTION_RATE = 10;
const EXPECTED_RETENTION = 6_000;
const EXPECTED_PAYMENT = 54_000;

async function main() {
  section(`PHASE 21 · STAGE 5 — subcontract, certification and payment`);

  const ledgerBefore = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  note("ledger before the subcontract", money(ledgerBefore.ledgerCents));

  // ── 5.1 the commitment ───────────────────────────────────────────────────
  section("5.1  Subcontract — raised against the blockwork activity and cost code");

  const commitment = await POST(qs, `/projects/${P}/commitments`, {
    type: "subcontract",
    title: `${ctx.tag} Blockwork subcontract`,
    description: "Supply and lay 200mm blockwork to level 1 and 2",
    vendorCompanyId: ctx.companies.subcontractor.id,
    retentionRate: RETENTION_RATE,
    currency: "USD",
    startDate: "2027-03-01",
    endDate: "2027-06-30",
    lines: [
      {
        lineNumber: 1,
        description: "Blockwork walls 200mm",
        costCodeId: ctx.costCodes["03-100"],
        budgetLineId: ctx.budgetLines["03-100"],
        boqItemId: ctx.boq["B-004"],
        activityId: ctx.activities.A310,
        unit: "m2",
        qty: 2000,
        rate: 50,
        amount: SUBCONTRACT_VALUE,
      },
    ],
  });
  ctx.commitmentId = commitment.id;
  note("commitment", `${commitment.ref ?? commitment.number ?? commitment.id} status=${commitment.status}`);

  // Reuse proof: the subcontractor came from the directory, not retyped.
  check(
    "the subcontractor is the company created in stage 1",
    ctx.companies.subcontractor.id,
    commitment.vendorCompanyId ?? commitment.vendorCompany?.id,
  );

  // ── 5.2 execute it ───────────────────────────────────────────────────────
  // The agreement is assembled from what the system already knows, goes out
  // for signature, and the signed copy comes back on execution. Nothing about
  // the scope or the money is retyped to get there.
  const agreement = await GET(qs, `/projects/${P}/commitments/${commitment.id}/agreement`);
  note("agreement assembled", `gaps=${(agreement.gaps || agreement.outstanding || []).length}`);
  const pdf = await download(qs, `/projects/${P}/commitments/${commitment.id}/agreement.pdf`);
  check("the agreement renders as a PDF for signature", "%PDF", pdf.subarray(0, 4).toString());
  ctx.agreementBytes = pdf.length;

  for (const step of ["submit", "approve"]) {
    // The QS raises and submits it; approving and executing a subcontract is
    // the project manager's, which is why the QS is refused those.
    const who = step === "submit" ? qs : pm;
    const res = await probe(who, "POST", `/projects/${P}/commitments/${commitment.id}/${step}`, {});
    note(`  ${step}`, `${res.status} ${res.code ?? "ok"}`);
    if (!res.ok && res.status !== 409) {
      throw new Error(`commitment ${step} failed: ${res.status} ${res.code} ${res.message}`);
    }
  }

  // Execution takes the signed agreement itself, not a tickbox saying it was
  // signed — so the countersigned PDF goes back up.
  await upload(pm, "POST", `/projects/${P}/commitments/${commitment.id}/execute`, {
    field: "file",
    filename: `${ctx.tag}-subcontract-signed.pdf`,
    contentType: "application/pdf",
    body: pdf,
    fields: { note: "Countersigned by both parties" },
  });

  const executed = await GET(qs, `/projects/${P}/commitments/${commitment.id}`);
  check("the subcontract is executed", "executed", executed.status);
  check(
    "executed value is 100,000.00",
    cents(SUBCONTRACT_VALUE),
    cents(executed.original ?? 0),
  );
  ctx.financials.committedCents = cents(executed.revised ?? executed.original ?? 0);

  // Committed cost appears; actual cost does not move on execution.
  const afterExecute = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  check("executing a subcontract is not a cost", ledgerBefore.ledgerCents, afterExecute.ledgerCents);

  // ── 5.3 pay application ──────────────────────────────────────────────────
  section("5.3  Pay application — certify 60,000 of the 100,000");

  const payApp = await POST(qs, `/projects/${P}/pay-apps`, {
    commitmentId: commitment.id,
    periodLabel: `${ctx.tag} PA-01`,
    periodStart: "2027-03-01",
    periodEnd: "2027-03-31",
    retentionRate: RETENTION_RATE,
  });
  ctx.payAppId = payApp.id;
  note("pay app", `${payApp.ref ?? payApp.number ?? payApp.id} status=${payApp.status}`);

  // The SOV line the subcontract already knows about — no retyping of scope.
  const detail = await GET(qs, `/projects/${P}/pay-apps/${payApp.id}`);
  const lines = detail.lines || detail.payAppLines || [];
  check("the pay app inherits the subcontract's SOV line", 1, lines.length);
  note("SOV line", JSON.stringify(lines[0] ?? {}).slice(0, 240));

  // Certify 60% of the line.
  if (lines[0]) {
    const lineId = lines[0].sovLineId;
    const updated = await probe(qs, "PATCH", `/projects/${P}/pay-apps/${payApp.id}`, {
      lines: [{ sovLineId: lineId, thisPeriodAmount: CERTIFIED_GROSS }],
    });
    note("  set this period to 60,000", `${updated.status} ${updated.code ?? "ok"}`);
    ctx.payAppLineUpdate = `${updated.status} ${updated.code ?? "ok"}`;
  }

  for (const step of ["submit", "review", "approve"]) {
    const who = step === "approve" ? pm : qs;
    const res = await probe(who, "POST", `/projects/${P}/pay-apps/${payApp.id}/${step}`, {});
    note(`  ${step}`, `${res.status} ${res.code ?? "ok"}`);
  }

  const certified = await GET(qs, `/projects/${P}/pay-apps/${payApp.id}`);
  note("certified pay app", JSON.stringify({
    status: certified.status,
    gross: certified.grossThisPeriod,
    retention: certified.retentionThisPeriod,
    net: certified.netThisPeriod,
  }));
  ctx.certifiedPayApp = certified;

  const grossCents = cents(certified.grossThisPeriod ?? 0);
  const retentionCents = cents(certified.retentionThisPeriod ?? 0);
  const netCents = cents(certified.netThisPeriod ?? 0);

  check("gross certified is 60,000.00", cents(CERTIFIED_GROSS), grossCents);
  check("retention at 10% is 6,000.00", cents(EXPECTED_RETENTION), retentionCents);
  check("net payable is 54,000.00", cents(EXPECTED_PAYMENT), netCents);
  check("gross less retention is exactly the net", grossCents - retentionCents, netCents);

  // ── 5.4 the gate: cost is the gross, not the payment ─────────────────────
  section("5.4  Certified cost is the GROSS, and retention does not reduce it");

  const afterCertify = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  const delta = afterCertify.ledgerCents - ledgerBefore.ledgerCents;
  check("actual cost rose by the gross 60,000.00", cents(CERTIFIED_GROSS), delta);
  check("not by the 54,000.00 that will leave the bank", true, delta !== cents(EXPECTED_PAYMENT));
  note("ledger by source", JSON.stringify(afterCertify.bySource));
  note("ledger by cost type", JSON.stringify(afterCertify.byCostType));
  check("the projections still agree with the ledger", afterCertify.ledgerCents, afterCertify.budgetProjectionCents);
  check("the service reports itself balanced", true, afterCertify.balanced);
  ctx.financials.certifiedSubcontractCents = delta;

  // ── 5.5 payment moves cash, not cost ─────────────────────────────────────
  section("5.5  Payment — cash out, cost unchanged");

  const payment = await probe(finance, "POST", `/projects/${P}/pay-apps/${payApp.id}/payments`, {
    amount: EXPECTED_PAYMENT,
    paidAt: "2027-04-15",
    reference: `${ctx.tag}-PMT-1`,
    method: "bank_transfer",
  });
  note("payment", `${payment.status} ${payment.code ?? "recorded"}`);
  ctx.paymentStatus = payment.status;

  const afterPayment = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  check("paying the subcontractor did not change actual cost", afterCertify.ledgerCents, afterPayment.ledgerCents);
  ctx.financials.afterPayment = afterPayment;

  const cashFlow = await probe(finance, "GET", `/projects/${P}/cash-flow`);
  if (cashFlow.ok) {
    note("cash flow keys", Object.keys(cashFlow.data).join(", "));
    ctx.cashFlow = cashFlow.data;
  } else {
    note("cash flow", `${cashFlow.status} ${cashFlow.code}`);
  }

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 5 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
