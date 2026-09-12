/**
 * Phase 21C · stage 12 — supplier invoices and the three-way match.
 *
 *   PO-A  100 bags @ 10.00, received 60 + 40    invoice A  100 @ 10.00 = 1,000.00   exact match
 *   PO-B   50 bags @ 13.00, received 50         invoice B   50 @ 14.00 =   700.00   price variance +50.00
 *
 * A supplier invoice is a direct cost of type `invoice` whose lines point at
 * PO lines (`poLineId`); the match reads order vs receipt vs invoice from
 * either side. The mismatch must be DETECTED, not silently accepted.
 *
 * The financial gate: the cement was stocked, and its cost was recognised at
 * material issue (704.00 already on the ledger). Invoicing it must not post a
 * second cost. The ledger is read before and after, and the expected delta is
 * 0.00. If the product posts anyway, this stage fails and the finding is
 * classified then — not assumed either way.
 *
 * Idempotent: invoices are found by their deterministic invoice number, and a
 * duplicate is refused by the product (409 DIRECT_COST_DUPLICATE_INVOICE).
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, probe, cents, money, check, note, section, summary, readLedger } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, finance, cost, warehouse, site } = ctx.people;

const INVOICES = [
  { key: "A", po: ctx.purchaseOrders.A, number: `${ctx.tag}-INV-CEM-A`, qty: 100, unitCost: 10, expectVariance: 0 },
  { key: "B", po: ctx.purchaseOrders.B, number: `${ctx.tag}-INV-CEM-B`, qty: 50, unitCost: 14, expectVariance: 50 },
];

/**
 * Booking a supplier invoice is the cost controller's job; finance records
 * the payment against it. The first run of this stage tried it as finance and
 * was refused (403), which is asserted below rather than worked around.
 *
 * Find or create; the product refuses a duplicate invoice number itself.
 */
async function ensureInvoice(spec, poLineId) {
  const list = await GET(cost, `/projects/${P}/direct-costs?limit=200`);
  const existing = (list.items || list).find((d) => d.invoiceNumber === spec.number);
  if (existing) {
    note(`  invoice ${spec.key} exists, reusing`, `${existing.ref} status=${existing.status}`);
    return existing;
  }
  const created = await probe(cost, "POST", `/projects/${P}/direct-costs`, {
    type: "invoice",
    description: `${ctx.tag} Cement OPC — supplier invoice against PO-${spec.key}`,
    vendorCompanyId: ctx.companies.supplier.id,
    invoiceNumber: spec.number,
    purchaseOrderId: spec.po,
    costDate: "2027-02-15",
    dueDate: "2027-03-15",
    lines: [
      {
        description: "Cement OPC 42.5N (50kg bag)",
        poLineId,
        costCodeId: ctx.costCodes["02-100"],
        budgetLineId: ctx.budgetLines["02-100"],
        activityId: ctx.activities.A130,
        costType: "material",
        quantity: spec.qty,
        unit: "bag",
        unitCost: spec.unitCost,
        amount: spec.qty * spec.unitCost,
      },
    ],
  });
  if (created.ok) return created.data;
  if (created.code === "DIRECT_COST_DUPLICATE_INVOICE") {
    note(`  invoice ${spec.key} already booked`, created.details?.ref);
    return await GET(cost, `/projects/${P}/direct-costs/${created.details.directCostId}`);
  }
  throw new Error(`invoice ${spec.key}: ${created.status} ${created.code} ${created.message}`);
}

async function main() {
  section("PHASE 21C · STAGE 12 — supplier invoices and the three-way match");

  const before = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  note("ledger before any supplier invoice", `${money(before.ledgerCents)} (material_issue ${money(before.bySource.material_issue ?? 0)}, direct_cost ${money(before.bySource.direct_cost ?? 0)})`);

  // Who may book a supplier invoice — attacked, not assumed.
  const financeTries = await probe(finance, "POST", `/projects/${P}/direct-costs`, {
    type: "invoice",
    description: "probe",
    invoiceNumber: `${ctx.tag}-INV-PROBE`,
    costDate: "2027-02-15",
    lines: [{ description: "probe", costType: "material", quantity: 1, unitCost: 1, amount: 1 }],
  });
  check("finance cannot book a supplier invoice — that is the cost controller's", 403, financeTries.status);

  // ── 12.1 the two invoices, each against a PO line the system already knows ─
  section("12.1  Invoices — against the PO lines, quantities and prices from the order");

  ctx.supplierInvoices = {};
  for (const spec of INVOICES) {
    const po = await GET(cost, `/projects/${P}/purchase-orders/${spec.po}`);
    const line = (po.lines || [])[0];
    check(`PO-${spec.key} is fully received before invoicing`, Number(line.orderedQty), Number(line.receivedQty));
    const inv = await ensureInvoice(spec, line.id);
    ctx.supplierInvoices[spec.key] = inv.id;
    check(`invoice ${spec.key} is linked to PO-${spec.key}`, spec.po, inv.purchaseOrderId);
    check(`invoice ${spec.key} total is ${money(cents(spec.qty * spec.unitCost))}`, cents(spec.qty * spec.unitCost), cents(inv.total ?? inv.subtotal));
    // Whether the invoice read model exposes the line's PO link is recorded;
    // the authoritative proof that the link exists is the match itself (12.2).
    ctx.invoiceReadExposesPoLine = Boolean((inv.lines || [])[0]?.poLineId);

    for (const step of ["submit", "approve"]) {
      if (["pending", "approved", "paid"].includes(inv.status) && step === "submit") continue;
      if (["approved", "paid"].includes(inv.status) && step === "approve") continue;
      const res = await probe(step === "submit" ? cost : pm, "POST", `/projects/${P}/direct-costs/${inv.id}/${step}`, {});
      note(`  ${spec.key} ${step}`, `${res.status} ${res.code ?? "ok"}`);
      if (!res.ok && res.status !== 409) throw new Error(`invoice ${spec.key} ${step}: ${res.status} ${res.code} ${res.message}`);
      inv.status = res.ok ? (step === "submit" ? "pending" : "approved") : inv.status;
    }
    ctx.supplierInvoices[`${spec.key}Status`] = inv.status;
  }

  // ── 12.2 the match, from the order's side ────────────────────────────────
  section("12.2  Three-way match — ordered vs received vs invoiced");

  for (const spec of INVOICES) {
    const m = await GET(warehouse, `/inventory/match/order/${spec.po}`);
    note(`match PO-${spec.key} keys`, Object.keys(m).join(", "));
    const lines = m.lines || [];
    const l = lines[0] ?? {};
    note(`  PO-${spec.key} line`, JSON.stringify(l).slice(0, 360));
    const orderedQty = Number(l.orderedQty ?? l.ordered?.quantity ?? 0);
    const receivedQty = Number(l.receivedQty ?? l.received?.quantity ?? 0);
    const invoicedQty = Number(l.invoicedQty ?? l.invoiced?.quantity ?? 0);
    const orderedVal = cents(l.orderedValue ?? 0);
    const receivedVal = cents(l.receivedValue ?? 0);
    const invoicedVal = cents(l.invoicedValue ?? 0);

    // The match names the PO line it reconciled — this is the proof that the
    // invoice line was attached to the order line, from the product's side.
    const poDetail = await GET(cost, `/projects/${P}/purchase-orders/${spec.po}`);
    check(`PO-${spec.key}: the match reconciles against the order's own line`, (poDetail.lines || [])[0]?.id, l.poLineId);
    check(`PO-${spec.key}: ordered quantity ${spec.qty}`, spec.qty, orderedQty);
    check(`PO-${spec.key}: received quantity ${spec.qty}`, spec.qty, receivedQty);
    check(`PO-${spec.key}: invoiced quantity ${spec.qty}`, spec.qty, invoicedQty);
    const orderedRate = spec.key === "A" ? 10 : 13;
    check(`PO-${spec.key}: ordered value ${money(cents(spec.qty * orderedRate))}`, cents(spec.qty * orderedRate), orderedVal);
    check(`PO-${spec.key}: received value ${money(cents(spec.qty * orderedRate))}`, cents(spec.qty * orderedRate), receivedVal);
    check(`PO-${spec.key}: invoiced value ${money(cents(spec.qty * spec.unitCost))}`, cents(spec.qty * spec.unitCost), invoicedVal);
    check(`PO-${spec.key}: variance is exactly ${money(cents(spec.expectVariance))}`, cents(spec.expectVariance), invoicedVal - receivedVal);

    const flags = l.flags ?? m.flags ?? [];
    const status = m.verdict ?? null;
    note(`  PO-${spec.key} match status`, `${status} flags=${JSON.stringify(flags).slice(0, 200)}`);
    if (spec.expectVariance === 0) {
      check(`PO-${spec.key}: reported as matched with no blocking flag`, false, (flags || []).some((f) => f.severity === "blocking"));
      check(`PO-${spec.key}: the verdict is a clean match`, true, /match|clean|ok/i.test(String(status)) && !/mismatch|variance|hold|block/i.test(String(status)));
    } else {
      check(`PO-${spec.key}: the price variance is DETECTED, not accepted as clean`, true, (flags || []).some((f) => f.code === "price_variance" && f.severity === "blocking"));
      check(`PO-${spec.key}: the verdict is not a clean match`, false, /^(matched|clean|ok)$/i.test(String(status)));
      note(`  PO-${spec.key} verdict`, status);
    }
    ctx.match = ctx.match || {};
    ctx.match[spec.key] = { status, flags, orderedVal, receivedVal, invoicedVal };
  }

  // From the invoice's side, the same truth.
  const fromInvoice = await GET(warehouse, `/inventory/match/invoice/${ctx.supplierInvoices.B}`);
  note("match from invoice B's side keys", Object.keys(fromInvoice).join(", "));
  check("the invoice-side match sees the same order", ctx.purchaseOrders.B, fromInvoice.order?.id ?? fromInvoice.orderId ?? fromInvoice.purchaseOrderId);

  // ── 12.3 the PO knows it has been invoiced ───────────────────────────────
  const poA = await GET(cost, `/projects/${P}/purchase-orders/${ctx.purchaseOrders.A}`);
  check("PO-A shows 1,000.00 invoiced", cents(1000), cents(poA.invoicedAmount));
  check("PO-A shows nothing left to invoice", 0, cents(poA.uninvoiced));
  note("PO-A invoice status", poA.invoiceStatus);

  // ── 12.4 the capitalization gate ─────────────────────────────────────────
  section("12.4  Stocked goods: the invoice must NOT post a second project cost");

  const after = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  const delta = after.ledgerCents - before.ledgerCents;
  note("ledger after both invoices approved", `${money(after.ledgerCents)} by source ${JSON.stringify(Object.fromEntries(Object.entries(after.bySource).map(([k, v]) => [k, money(v)])))}`);
  check("cost recognised at issue is unchanged — the invoice posts no second cost (delta 0.00)", 0, delta);
  check("material_issue is still the only material cost source", cents(704), after.bySource.material_issue ?? 0);
  check("the projections still agree", after.ledgerCents, after.budgetProjectionCents);
  check("still balanced", true, after.balanced);
  ctx.financials.stockedInvoiceLedgerDelta = delta;
  ctx.financials.afterInvoices = after;

  // ── 12.5 who may not ─────────────────────────────────────────────────────
  const bySite = await probe(site, "POST", `/projects/${P}/direct-costs/${ctx.supplierInvoices.A}/approve`, {});
  check("a site engineer cannot approve a supplier invoice", 403, bySite.status);

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 12 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
