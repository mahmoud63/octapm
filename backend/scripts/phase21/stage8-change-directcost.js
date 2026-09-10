/**
 * Phase 21B · stage 8 — change management, and a direct cost.
 *
 *   APPROVED CHANGE  125,000.00   Original 1,700,000 -> Revised 1,825,000
 *   DIRECT COST        8,500.00   Actual   60,704.00 -> 69,204.00
 *
 * Two rules are under test, and they pull in opposite directions:
 *
 *   an approved change moves the REVISED budget and leaves Original alone,
 *   and it is not a cost — the ledger must not move;
 *
 *   a direct cost IS a cost — the ledger must move by exactly 8,500.00 and
 *   the budget must not.
 *
 * A draft change must move neither.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, PATCH, probe, cents, money, check, note, section, summary, readLedger, upload } = require("./harness");

const CONTEXT = path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, qs, cost, finance, site } = ctx.people;

const APPROVED_CHANGE = 125_000;
const DRAFT_CHANGE = 40_000; // raised and left unapproved on purpose
const DIRECT_COST = 8_500;

/** Reads Original / Approved changes / Revised straight off the budget lines. */
async function budgetTotals() {
  const budget = await GET(cost, `/projects/${P}/budget/lines`);
  const lines = budget.items || budget.lines || [];
  return {
    original: lines.reduce((s, l) => s + cents(l.originalBudget), 0),
    approvedChanges: lines.reduce((s, l) => s + cents(l.approvedChanges ?? l.approvedChangeOrders ?? 0), 0),
    revisions: lines.reduce((s, l) => s + cents(l.revisions ?? 0), 0),
    revised: lines.reduce((s, l) => s + cents(l.revisedBudget ?? l.revised ?? 0), 0),
    sample: lines[0] ? Object.keys(lines[0]) : [],
  };
}

async function main() {
  section("PHASE 21B · STAGE 8 — change management and direct cost");

  const before = await budgetTotals();
  const ledgerBefore = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  note("budget line fields", before.sample.join(", "));
  note("before", `original=${money(before.original)} approvedChanges=${money(before.approvedChanges)} revised=${money(before.revised)} actual=${money(ledgerBefore.ledgerCents)}`);

  // ── 8.1 a change nobody has approved ─────────────────────────────────────
  section("8.1  A change that is only a draft moves nothing");

  const draft = await POST(qs, `/projects/${P}/change-orders`, {
    description: `${ctx.tag} Additional retaining wall to grid line F — DRAFT, not approved`,
    activityId: ctx.activities.A130,
    budgetLineId: ctx.budgetLines["01-100"],
    value: DRAFT_CHANGE,
    scheduleImpact: 5,
  });
  ctx.draftChangeId = draft.id;
  check("the draft carries its 40,000.00", cents(DRAFT_CHANGE), cents(draft.value));
  note("draft change", `${draft.ref} status=${draft.status} value=${draft.value}`);

  const afterDraft = await budgetTotals();
  const ledgerAfterDraft = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  check("a draft change does not touch Original Budget", before.original, afterDraft.original);
  check("a draft change does not touch Revised Budget", before.revised, afterDraft.revised);
  check("a draft change is not a cost", ledgerBefore.ledgerCents, ledgerAfterDraft.ledgerCents);

  // ── 8.2 a change that is approved ────────────────────────────────────────
  section("8.2  An approved change moves the Revised Budget, and only that");

  const CHANGE_DESCRIPTION = `${ctx.tag} Client instruction: upgrade blockwork to fair-faced, grid A-F`;

  // Re-runnable: approving a second identical variation would move the budget
  // again and make the arithmetic below meaningless.
  const existingRegister = await GET(qs, `/projects/${P}/change-orders?limit=200`);
  const alreadyApproved = (existingRegister.orders || []).find(
    (c) => c.description === CHANGE_DESCRIPTION && c.status === "approved",
  );

  let change = alreadyApproved;
  if (change) {
    note("this variation is already approved, reusing", `${change.ref} value=${change.value}`);
  } else {
    change = await POST(qs, `/projects/${P}/change-orders`, {
      description: CHANGE_DESCRIPTION,
      activityId: ctx.activities.A310,
      // The change says which budget line it lands on, so the money has a
      // home before anybody approves it.
      budgetLineId: ctx.budgetLines["03-100"],
      value: APPROVED_CHANGE,
      scheduleImpact: 10,
    });
    note("change raised", `${change.ref} value=${change.value} on budget line 03-100`);
  }
  ctx.changeOrderId = change.id;
  check("the change carries its 125,000.00", cents(APPROVED_CHANGE), cents(change.value));

  if (!alreadyApproved) {
  // A variation may not be approved until somebody has written down what it
  // does to the programme and to the money, named the activities it hits, and
  // attached the instruction it came from. Three real rules, and the right
  // ones: this is the evidence a claim is later argued from.
  await PATCH(qs, `/projects/${P}/change-orders/${change.id}`, {
    scheduleImpactSummary:
      "Ten working days on the blockwork chain (A310). The completion milestone moves ten days; the MEP spur absorbs its share in float.",
    costImpactSummary:
      "125,000.00 added to blockwork budget line 03-100: 2,000 m2 upgraded to fair-faced at an agreed 62.50 uplift per m2.",
    activityLinks: [
      {
        activityId: ctx.activities.A310,
        relationType: "impacted",
        scheduleImpactDays: 10,
        costImpact: APPROVED_CHANGE,
        notes: "Blockwork upgraded to fair-faced",
      },
    ],
  });

  const instruction = Buffer.from(
    `CLIENT INSTRUCTION 07\n\nProject: ${ctx.projectName}\n` +
      `Upgrade blockwork to fair-faced finish, grid A-F.\n` +
      `Agreed uplift 62.50/m2 over 2,000 m2 = 125,000.00\n` +
      `Programme effect: 10 working days.\n`,
    "utf8",
  );
  const attached = await upload(qs, "POST", `/projects/${P}/attachments`, {
    field: "files",
    filename: `${ctx.tag}-client-instruction-07.txt`,
    contentType: "text/plain",
    body: instruction,
    fields: { recordType: "change_order", recordId: change.id, caption: "Client instruction 07" },
  });
  const attachments = attached.items || attached.attachments || (Array.isArray(attached) ? attached : []);
  const documentId = attachments[0]?.documentId ?? attachments[0]?.document?.id ?? attachments[0]?.id ?? null;
  if (!documentId) {
    throw new Error(`the instruction uploaded but no document id came back: ${JSON.stringify(attached).slice(0, 300)}`);
  }
  note("  supporting instruction attached", `${instruction.length} bytes, document ${documentId}`);
  ctx.changeDocumentId = documentId;

  // The commercial record keeps its own reference to the evidence, which is
  // what the approval gate counts.
  await PATCH(qs, `/projects/${P}/change-orders/${change.id}`, { documentIds: [documentId] });

  for (const step of ["submit", "approve"]) {
    const who = step === "submit" ? qs : pm;
    const res = await probe(who, "POST", `/projects/${P}/change-orders/${change.id}/${step}`, {
      comment: step === "approve" ? "Approved by the client under instruction 07" : "For approval",
    });
    note(`  ${step}`, `${res.status} ${res.code ?? "ok"}`);
      if (!res.ok && res.status !== 409) {
        throw new Error(`change ${step} failed: ${res.status} ${res.code} ${res.message}`);
      }
    }
  }

  // There is no GET by id for a change order; the register is the read model.
  // Found by id, not by taking the first row of a page.
  const register = await GET(qs, `/projects/${P}/change-orders?limit=200`);
  const orders = register.orders || register.items || [];
  const approved = orders.find((c) => c.id === change.id);
  if (!approved) {
    throw new Error(
      `change order ${change.id} is not in the register of ${orders.length}: ${orders.map((o) => o.id).join(", ")}`,
    );
  }
  note("register summary", JSON.stringify(register.summary ?? {}).slice(0, 240));
  check("the change is approved", "approved", approved.status);
  check("its value is 125,000.00", cents(APPROVED_CHANGE), cents(approved.value));

  // Every approved variation, counted from the register itself.
  const approvedOrders = orders.filter((c) => c.status === "approved");
  const approvedFromRegister = approvedOrders.reduce((s, c) => s + cents(c.value), 0);
  note("approved variations", approvedOrders.map((c) => `${c.ref}=${money(cents(c.value))}`).join(" "));
  check("the register's approved total is the sum of its approved rows", approvedFromRegister, cents(register.summary?.totalApproved ?? 0));

  const afterApproval = await budgetTotals();
  note("after", `original=${money(afterApproval.original)} approvedChanges=${money(afterApproval.approvedChanges)} revised=${money(afterApproval.revised)}`);

  // ── 8.3 the reconciliation ───────────────────────────────────────────────
  section("8.3  Original + approved changes + approved revisions = Revised");

  check("ORIGINAL BUDGET is immutable", cents(1_700_000), afterApproval.original);
  check(
    "the budget's approved-change total equals the register's",
    approvedFromRegister,
    afterApproval.approvedChanges,
  );
  check("approved budget revisions are nil", 0, afterApproval.revisions);
  check(
    "REVISED = ORIGINAL + approved changes + approved revisions, to the cent",
    afterApproval.original + afterApproval.approvedChanges + afterApproval.revisions,
    afterApproval.revised,
  );
  check(
    "this variation contributed exactly 125,000.00 of it",
    true,
    approvedFromRegister % cents(APPROVED_CHANGE) === 0 && approvedFromRegister >= cents(APPROVED_CHANGE),
  );
  check("the unapproved 40,000 draft is excluded", true, afterApproval.approvedChanges % cents(DRAFT_CHANGE) !== cents(DRAFT_CHANGE));

  // An approved variation is a contractual fact, not a draft. Proven, because
  // a duplicate raised by a repeated stage run could not be taken back.
  for (const verb of ["reopen", "disapprove", "reject"]) {
    const res = await probe(pm, "POST", `/projects/${P}/change-orders/${approved.id}/${verb}`, { reason: "test" });
    check(`an approved change order cannot be ${verb}ed`, 409, res.status);
  }
  const edit = await probe(pm, "PATCH", `/projects/${P}/change-orders/${approved.id}`, { value: 1 });
  check("nor can its value be edited", 409, edit.status);
  check("  and the reason says so", "CHANGE_ORDER_APPROVED_LOCKED", edit.code);

  const ledgerAfterChange = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  check("approving a change is not a cost", ledgerBefore.ledgerCents, ledgerAfterChange.ledgerCents);

  ctx.financials.approvedChangeCents = afterApproval.approvedChanges;
  ctx.financials.revisedBudgetCents = afterApproval.revised;

  // ── 8.4 a direct cost ────────────────────────────────────────────────────
  section("8.4  Direct cost — this one IS a cost");

  // The same supplier invoice number cannot be booked twice — a real rule and
  // a good one, so a repeat of this stage reuses the existing record rather
  // than double-posting the cost.
  const attempt = await probe(cost, "POST", `/projects/${P}/direct-costs`, {
    type: "invoice",
    description: `${ctx.tag} Tower crane monthly hire`,
    vendorCompanyId: ctx.companies.supplier.id,
    invoiceNumber: `${ctx.tag}-INV-CRANE-01`,
    costDate: "2027-03-20",
    lines: [
      {
        description: "Tower crane hire, March",
        costCodeId: ctx.costCodes["09-100"],
        budgetLineId: ctx.budgetLines["09-100"],
        activityId: ctx.activities.A200,
        costType: "equipment",
        quantity: 1,
        unit: "month",
        unitCost: DIRECT_COST,
        amount: DIRECT_COST,
      },
    ],
  });

  let alreadyBooked = false;
  let directId;
  if (attempt.ok) {
    directId = attempt.data.id;
    note("direct cost", `${attempt.data.ref} status=${attempt.data.status} total=${attempt.data.total ?? DIRECT_COST}`);
    for (const step of ["submit", "approve"]) {
      const res = await probe(step === "submit" ? cost : pm, "POST", `/projects/${P}/direct-costs/${directId}/${step}`, {});
      note(`  ${step}`, `${res.status} ${res.code ?? "ok"}`);
    }
  } else if (attempt.code === "DIRECT_COST_DUPLICATE_INVOICE") {
    alreadyBooked = true;
    directId = attempt.details?.directCostId ?? null;
    check("the same supplier invoice cannot be booked twice", 409, attempt.status);
    note("direct cost already booked as", `${attempt.details?.ref} — reusing, not double-posting`);
  } else {
    throw new Error(`direct cost failed: ${attempt.status} ${attempt.code} ${attempt.message}`);
  }
  ctx.directCostId = directId;

  const ledgerAfterDirect = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  const directDelta = ledgerAfterDirect.ledgerCents - ledgerAfterChange.ledgerCents;
  check(
    alreadyBooked
      ? "the duplicate attempt posted nothing"
      : "ACTUAL COST rose by exactly 8,500.00",
    alreadyBooked ? 0 : cents(DIRECT_COST),
    directDelta,
  );
  check("the direct cost stands at 8,500.00", cents(DIRECT_COST), ledgerAfterDirect.bySource.direct_cost ?? 0);
  check("total actual is 60,704 + 8,500 = 69,204.00", cents(60_704 + DIRECT_COST), ledgerAfterDirect.ledgerCents);
  check("the projections keep up", ledgerAfterDirect.ledgerCents, ledgerAfterDirect.budgetProjectionCents);
  check("still balanced", true, ledgerAfterDirect.balanced);
  note("ledger by source", JSON.stringify(Object.fromEntries(Object.entries(ledgerAfterDirect.bySource).map(([k, v]) => [k, money(v)]))));

  // A direct cost is not a budget movement.
  const budgetAfterDirect = await budgetTotals();
  check("a direct cost does not change the Revised Budget", afterApproval.revised, budgetAfterDirect.revised);

  ctx.financials.directCostCents = directDelta;
  ctx.financials.afterDirect = ledgerAfterDirect;

  // ── 8.5 who may do this ──────────────────────────────────────────────────
  const bySite = await probe(site, "POST", `/projects/${P}/change-orders/${change.id}/approve`, {});
  check("a site engineer cannot approve a change order", 403, bySite.status);

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 8 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
