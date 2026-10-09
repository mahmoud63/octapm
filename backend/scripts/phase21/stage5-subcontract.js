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
const { API, login, GET, POST, probe, cents, money, check, note, section, summary, readLedger, upload, download } = require("./harness");

const CONTEXT = process.env.P21_CONTEXT || path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, qs, cost, finance, procurement } = ctx.people;

const SUBCONTRACT_VALUE = 100_000;
const CERTIFIED_GROSS = 60_000;
const RETENTION_RATE = 10;
const EXPECTED_RETENTION = 6_000;
const EXPECTED_PAYMENT = 54_000;

/**
 * Where each record stands in its life (CERT-3 WP-0). A step answered 409 is
 * accepted only when the record already stands at or beyond the status the
 * step leads to — the answer to a step repeated on a record that is past it.
 * A 409 on a record that has not got there (a workflow lock, a guard) fails.
 */
const COMMITMENT_ORDER = ["draft", "pending", "approved", "executed", "closed"];
const PAY_APP_ORDER = ["draft", "submitted", "under_review", "approved", "paid"];

/**
 * One request, answered with the status the server actually sent — a payment
 * must answer 201. Written when probe() reported every success as 200; probe()
 * now reports the real status too (harness.js, CERT-3 WP-0), and this local
 * send() is kept so the asserted steps below stay as they were.
 */
async function send(who, method, urlPath, payload) {
  const token = await login(who);
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${urlPath} -> ${res.status} but the body was not JSON: ${text.slice(0, 200)}`);
    }
  }
  return { status: res.status, ok: res.ok, code: body?.error?.code ?? null, message: body?.error?.message ?? null, data: body?.data };
}

/** One workflow step, asserted: 200 and the expected status, or a 409 on a record already past it. */
async function advance(label, who, urlPath, expected, order, readStatus) {
  const res = await send(who, "POST", urlPath, {});
  note(`  ${label}`, `${res.status} ${res.code ?? "ok"}`);
  if (res.status === 409) {
    const now = await readStatus();
    const past = order.includes(now) && order.indexOf(now) >= order.indexOf(expected);
    check(`${label}: a 409 is accepted only on a record already ${expected} or beyond (it is ${now})`, true, past);
    return res;
  }
  check(`${label} answers 200`, 200, res.status);
  check(`${label} leaves it ${expected}`, expected, res.data?.status ?? null);
  return res;
}

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

  const commitmentStatus = async () => (await GET(qs, `/projects/${P}/commitments/${commitment.id}`)).status;
  for (const [step, expected] of [["submit", "pending"], ["approve", "approved"]]) {
    // The QS raises and submits it; approving and executing a subcontract is
    // the project manager's, which is why the QS is refused those.
    const who = step === "submit" ? qs : pm;
    const res = await advance(`commitment ${step}`, who, `/projects/${P}/commitments/${commitment.id}/${step}`, expected, COMMITMENT_ORDER, commitmentStatus);
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
    const updated = await send(qs, "PATCH", `/projects/${P}/pay-apps/${payApp.id}`, {
      lines: [{ sovLineId: lineId, thisPeriodAmount: CERTIFIED_GROSS }],
    });
    note("  set this period to 60,000", `${updated.status} ${updated.code ?? "ok"}`);
    ctx.payAppLineUpdate = `${updated.status} ${updated.code ?? "ok"}`;
    check("setting this period's claim answers 200", 200, updated.status);
    const claimed = (updated.data?.lines || []).find((l) => l.sovLineId === lineId);
    check("the line now claims 60,000.00 this period", cents(CERTIFIED_GROSS), claimed ? cents(claimed.thisPeriodAmount) : null);
  }

  // Submitted by the QS, reviewed by the QS, approved by the PM — each step
  // asserted, so a refused step can no longer pass as a note.
  const payAppStatus = async () => (await GET(qs, `/projects/${P}/pay-apps/${payApp.id}`)).status;
  for (const [step, expected] of [["submit", "submitted"], ["review", "under_review"], ["approve", "approved"]]) {
    const who = step === "approve" ? pm : qs;
    await advance(`pay app ${step}`, who, `/projects/${P}/pay-apps/${payApp.id}/${step}`, expected, PAY_APP_ORDER, payAppStatus);
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

  const payment = await send(finance, "POST", `/projects/${P}/pay-apps/${payApp.id}/payments`, {
    amount: EXPECTED_PAYMENT,
    paidAt: "2027-04-15",
    reference: `${ctx.tag}-PMT-1`,
    method: "bank_transfer",
  });
  note("payment", `${payment.status} ${payment.code ?? "recorded"}`);
  // Now the HTTP status itself (probe() recorded every success as 200).
  ctx.paymentStatus = payment.status;
  // A payment that did not happen must fail here: the cost check below would
  // otherwise pass on a payment that was never made.
  check("the payment answers 201", 201, payment.status);
  check("the payment pays the application in full", "paid", payment.data?.status ?? null);
  check("paid 54,000.00", cents(EXPECTED_PAYMENT), cents(payment.data?.paidAmount ?? 0));
  const paidApp = await GET(qs, `/projects/${P}/pay-apps/${payApp.id}`);
  check("read back, the application is paid", "paid", paidApp.status);
  check("read back, 54,000.00 paid", cents(EXPECTED_PAYMENT), cents(paidApp.paidAmount ?? 0));

  const afterPayment = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  check("paying the subcontractor did not change actual cost", afterCertify.ledgerCents, afterPayment.ledgerCents);
  ctx.financials.afterPayment = afterPayment;

  const cashFlow = await probe(finance, "GET", `/projects/${P}/cash-flow`);
  check("the cash flow answers", 200, cashFlow.status);
  if (cashFlow.ok) {
    note("cash flow keys", Object.keys(cashFlow.data).join(", "));
    ctx.cashFlow = cashFlow.data;
  } else {
    note("cash flow", `${cashFlow.status} ${cashFlow.code}`);
  }
  check("cash out is the 54,000.00 paid", cents(EXPECTED_PAYMENT), cents(cashFlow.data?.summary?.outflow ?? 0));

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
