/**
 * Phase 21C · stage 10 — the client commercial chain.
 *
 *   Client -> Prime Contract -> IPC period (items from approved BOQ
 *   allocations) -> certify -> invoice -> payment -> receivables.
 *
 * The product caps certification at APPROVED PROGRESS on the linked
 * allocation, so the ceiling is set by stage 9, not by this stage:
 *
 *   B-001  A110 at 100%   5,000 m3 @  12.00  =  60,000.00
 *   B-002  A120 at  50%  +  A130 at 50%       =  60,000.00   (400 of 800 m3 @ 150.00)
 *   gross certified this period               = 120,000.00   <- equals the EV, and must
 *   retention 10%                             =  12,000.00
 *   net / invoice                             = 108,000.00
 *   client pays                               =  80,000.00
 *   outstanding receivable                    =  28,000.00
 *
 * Two rules under test: revenue never touches the cost ledger, and an
 * over-certification (B-002 at 100%) is refused rather than silently taken.
 *
 * Idempotent: the period is keyed by "2027-03"; certification, invoicing and
 * payment are each skipped when the record already shows them done.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, PATCH, probe, cents, money, check, note, section, summary, readLedger } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, qs, finance, cost, site } = ctx.people;

const PERIOD = "2027-03";
const RETENTION_RATE = 10;
/**
 * Certification is per ALLOCATION, not per bill row. B-002 is split across
 * A120 (200 m3) and A130 (600 m3), so the IPC carries two items for it, each
 * capped by its own allocation quantity and its activity's approved progress.
 * Both are at 50%, so 100 and 300 m3 respectively.
 */
const CERT = {
  "B-001/A110": { qty: 5000, rate: 12 }, // A110 at 100%
  "B-002/A120": { qty: 100, rate: 150 }, //  A120 at 50% of 200
  "B-002/A130": { qty: 300, rate: 150 }, //  A130 at 50% of 600
};
const EXPECTED_GROSS = 120_000;
const EXPECTED_RETENTION = 12_000;
const EXPECTED_NET = 108_000;
const PAYMENT = 80_000;
const PAY_REF = `${ctx.tag}-CLIENT-PMT-01`;
const INVOICE_NO = `${ctx.tag}-INV-01`;

async function main() {
  section(`PHASE 21C · STAGE 10 — client commercial chain   period ${PERIOD}`);

  const ledgerBefore = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  note("cost ledger before any client activity", money(ledgerBefore.ledgerCents));

  // ── 10.1 the prime contract, and what already flowed into it ────────────
  section("10.1  Prime contract — the client, terms, and changes already there");

  const before = await GET(qs, `/projects/${P}/prime-contract`);
  note("contract", `${before.ref} original=${before.originalValue} approvedChanges=${before.approvedChangesValue} revised=${before.revisedValue}`);
  check("original value is the project's contract value", cents(2_000_000), cents(before.originalValue));
  check("the two approved variations reached the client contract", cents(250_000), cents(before.approvedChangesValue));
  check("revised client value = original + approved changes", cents(before.originalValue) + cents(before.approvedChangesValue), cents(before.revisedValue));
  check("draft variations are not in the revised value", true, cents(before.revisedValue) === cents(2_250_000));

  const contract = await PATCH(qs, `/projects/${P}/prime-contract`, {
    clientCompanyId: ctx.companies.client.id,
    retentionRate: RETENTION_RATE,
    paymentTermsDays: 30,
    status: "active",
  });
  check("the client is the company created in stage 1", ctx.companies.client.id, contract.clientCompanyId);
  check("retention is 10%", RETENTION_RATE, Number(contract.retentionRate));

  // ── 10.2 the IPC period, items from approved allocations ─────────────────
  section("10.2  IPC period — items come from the BOQ allocations, not retyped");

  const periods = await GET(qs, `/projects/${P}/ipc`);
  const list = Array.isArray(periods) ? periods : periods.items || [];
  let period = list.find((p) => p.period === PERIOD);
  if (period) {
    note("period already exists, reusing", `${PERIOD} status=${period.status}`);
  } else {
    period = await POST(qs, `/projects/${P}/ipc`, { period: PERIOD });
    note("period created", `${PERIOD} status=${period.status}`);
  }

  const detail = await GET(qs, `/projects/${P}/ipc/${PERIOD}`);
  const items = detail.items || detail.certificationItems || [];
  note("item fields", Object.keys(items[0] ?? {}).join(", "));
  check("the period carries certification items", true, items.length > 0);

  const boq = await GET(qs, `/projects/${P}/boq`);
  const boqById = new Map((boq.items || boq.boqItems || []).map((b) => [b.id, b.code]));
  const activityCodeById = new Map(Object.entries(ctx.activities).map(([code, id]) => [id, code]));
  // keyed "B-002/A130": one item per allocation, which is how the product
  // models it and why a split bill row appears twice.
  const byKey = new Map();
  const boqCodes = new Set();
  for (const it of items) {
    const code = boqById.get(it.boqItemId) ?? it.boqItem?.code;
    const act = activityCodeById.get(it.allocation?.activityId ?? it.activityId) ?? "?";
    if (code) {
      byKey.set(`${code}/${act}`, it);
      boqCodes.add(code);
    }
  }
  note("items by allocation", [...byKey.keys()].join(", "));
  check("B-001 and B-002 are among the items", true, boqCodes.has("B-001") && boqCodes.has("B-002"));
  check("the split B-002 appears once per allocation", 2, [...byKey.keys()].filter((k) => k.startsWith("B-002/")).length);
  check("the deliberately unallocated B-003 is NOT an item", false, boqCodes.has("B-003"));
  for (const key of Object.keys(CERT)) {
    if (!byKey.has(key)) throw new Error(`expected IPC item ${key} is missing; items are ${[...byKey.keys()].join(", ")}`);
  }
  ctx.ipcItemKeys = [...byKey.keys()];

  // ── 10.3 certify to the cap, and prove the cap ───────────────────────────
  const alreadyCertified = ["certified", "invoiced", "paid", "partially_paid"].includes(detail.status);
  if (alreadyCertified) {
    section("10.3  Already certified — skipping the irreversible steps");
    note("status", detail.status);
  } else {
    section("10.3  Certify — capped at approved progress");

    for (const [key, { qty, rate }] of Object.entries(CERT)) {
      const it = byKey.get(key);
      await PATCH(qs, `/projects/${P}/ipc/${PERIOD}/items/${it.id}`, { qty, rate, retentionRate: RETENTION_RATE });
      note(`  ${key}`, `${qty} @ ${rate} = ${money(cents(qty * rate))}`);
    }

    // Two mismatch cases, both of which must be REFUSED rather than taken.
    // (a) more than the allocation holds: A120's slice of B-002 is 200 m3.
    const overAlloc = await probe(qs, "PATCH", `/projects/${P}/ipc/${PERIOD}/items/${byKey.get("B-002/A120").id}`, {
      qty: 400,
      rate: 150,
    });
    check("certifying more than the allocation holds is refused", 400, overAlloc.status);
    check("  and it says why", "IPC_ALLOCATION_QTY_EXCEEDED", overAlloc.code);

    // (b) within the allocation but beyond approved progress: A130 is at 50%
    //     of 600 m3, so 600 must be refused — at the edit or at submission.
    const a130 = byKey.get("B-002/A130");
    const overProgress = await probe(qs, "PATCH", `/projects/${P}/ipc/${PERIOD}/items/${a130.id}`, { qty: 600, rate: 150 });
    let progressRefusal = overProgress;
    if (overProgress.ok) {
      progressRefusal = await probe(qs, "POST", `/projects/${P}/ipc/${PERIOD}/submit`, {});
      // whichever way it was stopped, restore the honest figure before the real submit
      await PATCH(qs, `/projects/${P}/ipc/${PERIOD}/items/${a130.id}`, { qty: 300, rate: 150, retentionRate: RETENTION_RATE });
    }
    check("certifying beyond approved progress is refused, not taken", false, progressRefusal.ok);
    note("  over-progress refusal", `${progressRefusal.status} ${progressRefusal.code ?? ""}`);
    ctx.ipcRefusals = { allocation: overAlloc.code, progress: progressRefusal.code ?? progressRefusal.status };

    for (const [step, who] of [["submit", qs], ["certify", pm]]) {
      const res = await probe(who, "POST", `/projects/${P}/ipc/${PERIOD}/${step}`, { comment: `${ctx.tag} ${step}` });
      note(`  ${step}`, `${res.status} ${res.code ?? "ok"}`);
      if (!res.ok && res.status !== 409) throw new Error(`ipc ${step} failed: ${res.status} ${res.code} ${res.message}`);
    }
  }

  const certified = await GET(qs, `/projects/${P}/ipc/${PERIOD}`);
  note("certified period", JSON.stringify(certified).slice(0, 400));
  // The certificate's own names: totalCert / totalRet / netPayable.
  const gross = cents(certified.grossThisPeriod ?? certified.totalCert ?? 0);
  const retention = cents(certified.totalRet ?? 0);
  const net = cents(certified.netPayable ?? 0);
  check("the period is certified", "certified", ["certified", "invoiced", "paid", "partially_paid"].includes(certified.status) ? "certified" : certified.status);
  check("gross certified is 120,000.00 — the same figure as EV", cents(EXPECTED_GROSS), gross);
  check("retention at 10% is 12,000.00", cents(EXPECTED_RETENTION), retention);
  check("net is 108,000.00", cents(EXPECTED_NET), net);
  check("gross - retention = net, to the cent", gross - retention, net);
  ctx.client = { gross, retention, net };

  // ── 10.4 invoice ─────────────────────────────────────────────────────────
  section("10.4  Invoice — issued from the certificate, not typed");

  // The period says whether an invoice exists through `invoiceStatus` and its
  // `invoices` array — not through its own status. Getting this wrong makes
  // the stage try to issue twice, which the product refuses (409
  // IPC_INVOICE_ALREADY_ISSUED); the stage must recognise it instead.
  const alreadyInvoiced =
    (certified.invoiceStatus && certified.invoiceStatus !== "not_issued") || (certified.invoices || []).length > 0;
  if (alreadyInvoiced) {
    note("invoice already issued, reusing", (certified.invoices || [])[0]?.invoiceNumber ?? certified.invoiceStatus);
  } else {
    const inv = await POST(finance, `/projects/${P}/ipc/${PERIOD}/invoice/issue`, {
      invoiceNumber: INVOICE_NO,
      invoiceDate: "2027-04-05",
      dueDate: "2027-05-05",
    });
    note("invoice issued", `${inv.invoiceNumber ?? INVOICE_NO} amount=${inv.invoiceAmount ?? inv.totalDue ?? "?"}`);
  }
  const invoiced = await GET(finance, `/projects/${P}/ipc/${PERIOD}`);
  note("invoice fields on the period", Object.keys(invoiced).filter((k) => /invoice/i.test(k)).map((k) => `${k}=${JSON.stringify(invoiced[k])}`).join(" "));
  check("the period shows its invoice as issued", true, /issued|invoiced|paid/.test(String(invoiced.invoiceStatus ?? invoiced.status)));
  const invoice = (invoiced.invoices || [])[0] ?? {};
  check("exactly one invoice on the period", 1, (invoiced.invoices || []).length);
  check("invoice gross is the certified 120,000.00", cents(EXPECTED_GROSS), cents(invoice.grossAmount));
  check("invoice retention held is 12,000.00", cents(EXPECTED_RETENTION), cents(invoice.retentionHeld));
  check("invoice net is 108,000.00", cents(EXPECTED_NET), cents(invoice.netAmount));
  check("gross - retention held = net, on the invoice itself", cents(invoice.grossAmount) - cents(invoice.retentionHeld), cents(invoice.netAmount));
  ctx.client.invoiceId = invoice.id;

  // ── 10.5 payment, deliberately short ─────────────────────────────────────
  section("10.5  Client payment — 80,000 of 108,000, so receivable stays visible");

  const rcBefore = await GET(finance, `/projects/${P}/prime-contract/receivables`);
  if (cents(rcBefore.received) >= cents(PAYMENT)) {
    note("payment already recorded, not posting again", money(cents(rcBefore.received)));
  } else {
    await POST(finance, `/projects/${P}/ipc/${PERIOD}/payments`, {
      amount: PAYMENT,
      paymentReference: PAY_REF,
      paymentDate: "2027-04-28",
      paymentMethod: "bank_transfer",
    });
    note("payment recorded", `${money(cents(PAYMENT))} ref ${PAY_REF}`);
  }

  const rc = await GET(finance, `/projects/${P}/prime-contract/receivables`);
  note("receivables", JSON.stringify({ invoiced: rc.invoiced, received: rc.received, outstanding: rc.outstanding, overdue: rc.overdue }));
  check("invoiced 108,000.00", cents(EXPECTED_NET), cents(rc.invoiced));
  check("received 80,000.00", cents(PAYMENT), cents(rc.received));
  check("outstanding receivable 28,000.00", cents(EXPECTED_NET - PAYMENT), cents(rc.outstanding));
  check("invoiced - received = outstanding", cents(rc.invoiced) - cents(rc.received), cents(rc.outstanding));
  ctx.client.invoiced = cents(rc.invoiced);
  ctx.client.received = cents(rc.received);
  ctx.client.outstanding = cents(rc.outstanding);

  // ── 10.6 revenue and cash never touch cost ───────────────────────────────
  section("10.6  Revenue is not cost, and client cash is not cost");

  const ledgerAfter = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  check("the cost ledger did not move through certify, invoice and payment", ledgerBefore.ledgerCents, ledgerAfter.ledgerCents);
  check("still balanced", true, ledgerAfter.balanced);

  // The invoice and the receivables both already know about the payment.
  const afterPay = await GET(finance, `/projects/${P}/ipc/${PERIOD}`);
  const paidInvoice = (afterPay.invoices || [])[0] ?? {};
  check("the invoice records 80,000.00 paid", cents(PAYMENT), cents(paidInvoice.amountPaid));
  check("and 28,000.00 balance due", cents(EXPECTED_NET - PAYMENT), cents(paidInvoice.balanceDue));
  check("and calls itself partially paid", "partially_paid", paidInvoice.status);

  /**
   * P21-009 — cash flow is a materialised projection, and recording a CLIENT
   * payment does not refresh it (the subcontract-payment path does). On the
   * first run of this stage the projection showed inflow 0.00 while the
   * receivables showed 80,000.00 received, and POST /cash-flow/rebuild made
   * them agree. The stage reads the projection before touching it, so the
   * defect is measured on any project it has not already been rebuilt on,
   * and then rebuilds so the figures below are the reconciled ones.
   */
  const cashBefore = await GET(finance, `/projects/${P}/cash-flow`);
  note("cash flow before rebuild", JSON.stringify(cashBefore.summary));
  ctx.client.cashInflowBeforeRebuild = cents(cashBefore.summary?.inflow ?? 0);
  await POST(finance, `/projects/${P}/cash-flow/rebuild`, {});
  const cash = await GET(finance, `/projects/${P}/cash-flow`);
  note("cash flow after rebuild", JSON.stringify(cash.summary));
  check("cash in is the client payment (after rebuild)", cents(PAYMENT), cents(cash.summary?.inflow ?? 0));
  check("cash out is still the subcontract payment", cents(54_000), cents(cash.summary?.outflow ?? 0));
  check("net cash = in - out", cents(cash.summary?.inflow ?? 0) - cents(cash.summary?.outflow ?? 0), cents(cash.summary?.net ?? 0));

  // ── 10.7 who may not ─────────────────────────────────────────────────────
  const bySite = await probe(site, "POST", `/projects/${P}/ipc/${PERIOD}/certify`, {});
  check("a site engineer cannot certify a client valuation", 403, bySite.status);

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 10 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
