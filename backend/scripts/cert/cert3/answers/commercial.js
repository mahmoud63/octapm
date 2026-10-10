/**
 * CERT-3 WP-0 answer book: the COMMERCIAL section.
 *
 * Scope (docs/certification/OCTAPM_CERT3_PLAN.md):
 *   - the WP-0 stage-table rows stage3:109, stage4:167/:170 and stage5:82-204 (plan 453-455);
 *   - WP-4 change, commitments, IPC, pay applications, cash flow (plan 631-692);
 *   - WP-5 bids, award, PO, goods receipt, inventory, direct costs, three-way match (plan 694-753);
 *   - WP-6 BOQ, allocations, budgets, cost codes (plan 755-795);
 *   - WP-7 EOT and the weather 70% rule (plan 797-830);
 *   - the §3.2 contents of 087-COM, 087-COM-B, 087-COM-C and 052-COM (plan 387-389, 404),
 *     plus the D3 retention-default case (plan 409) because owner decision HR-C1 changes it.
 *
 * Every leaf is a figure: { value, unit, derivation, source, assumption, planDisagrees,
 * [planValue], [today], [note] }.
 *   - money is INTEGER CENTS of the project currency (087 = EGP, 052 = USD);
 *   - `today` is what HEAD 886c9f1 answers now, where the plan or a reading of the code says
 *     it differs (a reproduction script exits 2 while `today` is still observed);
 *   - `planValue` is the plan's own figure where this book derives something else
 *     (planDisagrees: true, with the reason in `note`);
 *   - error answers are { status, code } with unit 'error'; a code of null means the plan
 *     fixes the status but the code is chosen by the fix (assumption: true);
 *   - unit 'refusal' is a refusal the owner has decided whose refusing step, status and code
 *     the fix chooses: { status: null, code: null, rule } (integration-owner adjudication C2).
 *
 * The integration owner's WP-0 adjudication (C:\Temp\octapm-cert\scratch\wp0\adjudication.md,
 * section A "commercial.js", C1-C8, 2026-10-09) is applied; its arithmetic is in
 * C:\Temp\octapm-cert\scratch\wp0\commercial-adjudication-calc.js (pure JS).
 *
 * Sources: plan line numbers are those of the working-tree plan read on 2026-10-09 (one line,
 * the Q-KEY decision at line 36, is added over HEAD b0ec5b0, so lines after 36 are HEAD + 1).
 * Product references are file:line at HEAD 886c9f1, read with `git show HEAD:<path>` only.
 * Nothing here was run against the API or the database; the arithmetic was recomputed in
 * C:\Temp\octapm-cert\scratch\wp0\commercial-calc.js (pure JS, no product code loaded).
 *
 * Owner decision HR-C1 (plan 29) is applied: there is no silent 5% retention. Retention comes
 * from authoritative contract configuration (the contract rate, else an explicitly configured
 * project default) or an explicitly configured "no retention"; otherwise configuration is
 * required. Where the plan still states a 5% answer, it is kept as planValue.
 *
 * The integration owner's adjudication of the WP-0 deep-company builders (2026-10-09,
 * C:\Temp\octapm-cert\scratch\wp0\builders-adjudication.md, 087-COM item 3) adds
 * deep["087-COM"].ipc04: IPC-04 certified last, net 6,000.00 including 750.00 of advance
 * recovery, derived from this book's I6 / I8 figures and 087-COM's advance terms. Its plan
 * lines are numbered at f599e67 (PF); its product citations (prime-contract.service.js,
 * ipc.service.js) are unchanged at f599e67. Changed keys: answers/CHANGES-WP0-BUILDERS.md.
 * Its round 2 (R2-B) adds deep["087-COM"].ipc09 / .ipc10 (B2: IPC-09 submitted with the
 * deduction, IPC-10 a draft) and deep["087-COM-C"].billRows / billTotal / ipc01 (B3), each
 * derived from this book's keys; every product file they cite (schema.prisma included) is
 * unchanged at f599e67.
 * Its round 3 adds deep["052-COM"].ipc03 (R3-1: the submitted IPC-03 on the B-001 row,
 * 12,000.00 / 1,200.00 / 10,800.00) and deep["087-COM"].contractEnd (R3-3: the prime
 * contract's approved 147,000.00 / pending 49,500.00 / revised 2,147,000.00 once every prime
 * CO exists, with the CO list that composes each), again from this book's keys; the product
 * files they cite are unchanged at f599e67 (git diff 886c9f1 f599e67 is empty for them).
 * Changed keys: answers/CHANGES-WP0-BUILDERS-r3-com.md.
 */
"use strict";

const HEAD = "886c9f1";
const PLAN = "docs/certification/OCTAPM_CERT3_PLAN.md";
const AREA = "C:/Temp/octapm-cert/scratch/cert3-areas.json (commercial area map, read-only review 2026-10-05)";
const ADJ = (item) => `C:/Temp/octapm-cert/scratch/wp0/adjudication.md A.${item} (integration owner, 2026-10-09)`;

const P = (lines) => `${PLAN}:${lines}`;
const S = (file, lines) => `backend/src/services/${file}:${lines} @${HEAD}`;
const R = (file, lines) => `backend/src/routes/${file}:${lines} @${HEAD}`;
// Stage-script lines are those committed at HEAD (the plan's stage-table keys use them too);
// the WP-0 stage edits being made in the working tree shift them.
const ST = (file, lines) => `backend/scripts/phase21/${file}:${lines} @${HEAD}`;

/** Major currency units -> integer cents. Inputs carry at most two decimals. */
const cents = (major) => Math.round(major * 100);
/** The product's pct(): round2(amount x rate / 100), here on integer cents. */
const pctOf = (amountCents, ratePct) => Math.round((amountCents * ratePct) / 100);

function fig(value, unit, derivation, source, extra = {}) {
  return {
    value,
    unit,
    derivation,
    source: [].concat(source).join("; "),
    assumption: false,
    planDisagrees: false,
    ...extra,
  };
}
const money = (value, derivation, source, extra) => fig(value, "cents", derivation, source, extra);
const err = (status, code, derivation, source, extra) => fig({ status, code }, "error", derivation, source, extra);
const refusal = (rule, derivation, source, extra) => fig({ status: null, code: null, rule }, "refusal", derivation, source, extra);
const http = (status, derivation, source, extra) => fig(status, "http-status", derivation, source, extra);
const state = (value, derivation, source, extra) => fig(value, "state", derivation, source, extra);
const count = (value, derivation, source, extra) => fig(value, "count", derivation, source, extra);

// ─── shared known quantities (recomputed, see commercial-calc.js) ───────────────────────────

// stage-3 bill (stage3-boq-budget.js:25-31) and allocations (:88-95)
const BOQ = {
  "B-001": { qty: 5000, unit: "m3", rate: 12 },
  "B-002": { qty: 800, unit: "m3", rate: 150 },
  "B-003": { qty: 60, unit: "t", rate: 1200 },
  "B-004": { qty: 3000, unit: "m2", rate: 45 },
  "B-005": { qty: 4000, unit: "m2", rate: 18 },
};
const boqAmount = (code) => cents(BOQ[code].qty * BOQ[code].rate);
const BOQ_TOTAL = Object.keys(BOQ).reduce((sum, code) => sum + boqAmount(code), 0); // 45,900,000
const ALLOC = {
  "B-001/A110": cents(5000 * 12),
  "B-002/A120": cents(200 * 150),
  "B-002/A130": cents(600 * 150),
  "B-004/A310": cents(3000 * 45),
  "B-005/A320": cents(4000 * 18),
};
const ALLOCATED = Object.values(ALLOC).reduce((a, b) => a + b, 0); // 38,700,000
const UNALLOCATED = BOQ_TOTAL - ALLOCATED; // 7,200,000

// the certificate of stage 10 / WP-4 (A110 100%, A120 50%, A130 25%)
const GROSS = cents(5000 * 12) + cents(100 * 150) + cents(150 * 150); // 9,750,000
const RET10 = pctOf(GROSS, 10); // 975,000
const NET = GROSS - RET10; // 8,775,000

// 087-COM client contract (derived: E5 revised 2,125,000 = original + approved 125,000)
const CONTRACT_ORIGINAL = cents(2000000);
const APPROVED_CO = cents(125000);
const REVISED = CONTRACT_ORIGINAL + APPROVED_CO; // 212,500,000
const RET_CAP_RATE = 0.4; // percent of the revised value (area map I7: 0.4% x 2,125,000 = 8,500)
const RET_CAP = pctOf(REVISED, RET_CAP_RATE); // 850,000
const ADVANCE = cents(200000);
const ADVANCE_RECOVERY_RATE = 10;
const RECOVERY = Math.min(ADVANCE, pctOf(GROSS, ADVANCE_RECOVERY_RATE)); // 975,000

// the I1 row (area map I1): 1,000 m3 @ 100 = 100,000, activity approved 40%, qty 400 certified
const I1_CERT = cents(400 * 100); // 4,000,000

// stage-4 cement (stage4-procurement-inventory.js:8-14)
const PO_A = cents(100 * 10);
const PO_B = cents(50 * 13);
const WA = (PO_A + PO_B) / 150; // 1,100 cents per bag

// stage-5 subcontract (stage5-subcontract.js:5-9)
const SC_VALUE = cents(2000 * 50);
const SC_GROSS = cents(60000);
const SC_RET = pctOf(SC_GROSS, 10);
const SC_NET = SC_GROSS - SC_RET;

// stage-11 bids (stage11-rfq.js:7-9, 39-43)
const BID = { gulf: cents(60 * 1150), emirates: cents(60 * 1240), northern: cents(60 * 1190), estimate: cents(60 * 1200) };

// weather arithmetic exactly as weather.service.js:161-200 (HEAD) computes it
function weatherSummary(allowanceDays, contractualDays) {
  const allowance = Number(allowanceDays) || 20;
  const used = contractualDays.reduce((s, d) => s + d, 0);
  const consumedPct = allowance > 0 ? (used / allowance) * 100 : 0;
  return { allowance, used, consumedPct, warning: consumedPct >= 70, remaining: Math.max(allowance - used, 0) };
}

const HR_C1_NOTE =
  "Owner decision HR-C1 (plan 29): no silent 5% fallback; retention comes from authoritative contract configuration or an explicitly configured 'no retention', otherwise configuration is required.";
const HR_C1_REFUSAL_RULE =
  "HR-C1: configuration required; no certificate settles at a silent rate; the refusing step and code are chosen by the fix";
const HR_C1_REFUSAL_NOTE =
  "Adjudication C2: the refusing step, the status and the code are chosen by the HR-C1 fix, so the book records { status: null, code: null } with the rule and invents no code. Certification is the step that settles retention (ipc.service.js:1414-1447, the certify gate is analogous to 409 CONTRACT_VALUE_NOT_ESTABLISHED at prime-contract.service.js:96-118, ipc.service.js:1288), but where the fix refuses is its choice.";

// ─── WP-0 stage table (plan 453-455) ──────────────────────────────────────────────────────────

const stages = {
  "stage3:109": {
    boqRowCount: count(5, "B-001..B-005, read from GET /boq (not the script's context map).", [P(453), ST("stage3-boq-budget.js", "25-31, 61")]),
    boqTotal: money(BOQ_TOTAL, "5,000 x 12 + 800 x 150 + 60 x 1,200 + 3,000 x 45 + 4,000 x 18 = 60,000 + 120,000 + 72,000 + 135,000 + 72,000 = 459,000.00.", [ST("stage3-boq-budget.js", "7-13, 67"), P(788)]),
    allocationCount: count(5, "Five rows from GET /activity-boq-allocations: one each for B-001, B-004, B-005 and two for the split B-002.", [P(453), ST("stage3-boq-budget.js", "88-95, 107")]),
    "allocation.B-001/A110": money(ALLOC["B-001/A110"], "5,000 m3 x 12.00 = 60,000.00 (whole row).", [P(453), ST("stage3-boq-budget.js", "88")]),
    "allocation.B-002/A120": money(ALLOC["B-002/A120"], "200 m3 x 150.00 = 30,000.00 (split row, first slice).", [P(453), ST("stage3-boq-budget.js", "91")]),
    "allocation.B-002/A130": money(ALLOC["B-002/A130"], "600 m3 x 150.00 = 90,000.00 (split row, second slice); 200 + 600 = 800 = the row.", [P(453), ST("stage3-boq-budget.js", "92")]),
    "allocation.B-004/A310": money(ALLOC["B-004/A310"], "3,000 m2 x 45.00 = 135,000.00 (whole row).", [P(453), ST("stage3-boq-budget.js", "94")]),
    "allocation.B-005/A320": money(ALLOC["B-005/A320"], "4,000 m2 x 18.00 = 72,000.00 (whole row).", [P(453), ST("stage3-boq-budget.js", "95")]),
    allocatedTotal: money(ALLOCATED, "60,000 + 30,000 + 90,000 + 135,000 + 72,000 = 387,000.00.", [P(453)]),
    unallocatedTotal: money(UNALLOCATED, "459,000 - 387,000 = 72,000.00 = B-003 (60 t x 1,200.00), the deliberately unallocated row.", [P(453), ST("stage3-boq-budget.js", "9")]),
    "B-003.allocationRows": count(0, "No row of GET /activity-boq-allocations carries B-003's boqItemId; the check reads the API, not ctx.allocations (the weak check at :109).", [P(453), ST("stage3-boq-budget.js", "109")]),
    "B-002.splitRows": count(2, "B-002 appears on two allocation rows (A120 and A130).", [ST("stage3-boq-budget.js", "108")]),
  },
  "stage4:167": {
    "PO-A.line.activity": fig("A130", "ref", "The PO-A line is created with activityId = A130 (stage4:143); the check must read lines[0].activityId from GET /purchase-orders/:id and compare it with ctx.activities.A130, not just test that the order has an id.", [P(454), ST("stage4-procurement-inventory.js", "143, 167")]),
    "PO-A.line.costCode": fig("02-100", "ref", "lines[0].costCodeId must equal ctx.costCodes['02-100'] (stage4:144).", [P(454), ST("stage4-procurement-inventory.js", "144")]),
    "PO-B.line.activity": fig("A130", "ref", "Same line shape as PO-A (makeOrder is shared).", [P(454), ST("stage4-procurement-inventory.js", "132-163")]),
    "PO-B.line.costCode": fig("02-100", "ref", "Same line shape as PO-A.", [P(454), ST("stage4-procurement-inventory.js", "144")]),
  },
  "stage4:170": {
    "PO-A.value": money(PO_A, "100 bags x 10.00 = 1,000.00; tax 0 so value = subtotal. Read from the named field `value` (serializeOrder), which must exist: no `?? 1000` fallback.", [P(454), ST("stage4-procurement-inventory.js", "8, 170"), S("purchase-order.service.js", "255, 381-387")]),
    "PO-B.value": money(PO_B, "50 bags x 13.00 = 650.00; read from `value`.", [P(454), ST("stage4-procurement-inventory.js", "9")]),
    "mutation.unitCost10.5": money(cents(100 * 10.5), "Mutation: PO-A unit cost 10 -> 10.5 gives 100 x 10.50 = 1,050.00, which must FAIL the PO-A check (expected 1,000.00).", [P(454)], { note: "Mutation value, not an expected product answer." }),
    weightedAverage: money(WA, "(1,000.00 + 650.00) / 150 bags = 11.00 per bag (already asserted at stage4:234).", [ST("stage4-procurement-inventory.js", "11, 30, 234")]),
    issue60Cost: money(60 * WA, "60 bags x 11.00 = 660.00 material_issue (stage4:262).", [ST("stage4-procurement-inventory.js", "13, 262")]),
  },
  "stage5:82-204": {
    "commitment.submit": state("pending", "POST /commitments/:id/submit answers 200 and the commitment reads 'pending' (draft -> pending).", [P(455), S("commitment.service.js", "25, 655-657")]),
    "commitment.approve": state("approved", "PM approve answers 200; pending -> approved.", [P(455), S("commitment.service.js", "657")]),
    "commitment.execute": state("executed", "Execute with the signed PDF answers 200; approved -> executed (stage5:104 already asserts it).", [P(455), S("commitment.service.js", "659, 756-789"), ST("stage5-subcontract.js", "104")]),
    "commitment.original": money(SC_VALUE, "2,000 m2 x 50.00 = 100,000.00.", [ST("stage5-subcontract.js", "5, 56-58, 105-109")]),
    "commitment.replay409": err(409, "COMMITMENT_TRANSITION_INVALID", "A 409 is accepted on a re-run only when GET shows the commitment already past the step (e.g. submit on a pending one: pending is not in allowedFrom[pending] = [draft]).", [P(455), S("commitment.service.js", "655-663")]),
    "payApp.linePatch": http(200, "PATCH /pay-apps/:id {lines:[{sovLineId, thisPeriodAmount: 60000}]} answers 200 (today only noted at stage5:141).", [P(455), ST("stage5-subcontract.js", "136-143")]),
    "payApp.line.thisPeriodAmount": money(SC_GROSS, "60,000.00 of the 100,000.00 line.", [ST("stage5-subcontract.js", "24, 139")]),
    "payApp.submit": state("submitted", "draft -> submitted, 200.", [P(455), S("sub-pay-app.service.js", "22"), R("sub-pay-apps.js", "89-94")]),
    "payApp.review": state("under_review", "submitted -> under_review, 200.", [P(455), R("sub-pay-apps.js", "96-101")]),
    "payApp.approve": state("approved", "under_review -> approved (PM), 200.", [P(455), R("sub-pay-apps.js", "103-110")]),
    "payApp.replay409": err(409, "SUB_PAY_APP_TRANSITION_INVALID", "Accepted on a re-run only when the application is already past the step.", [P(455), S("sub-pay-app.service.js", "771")]),
    "payApp.gross": money(SC_GROSS, "Certified gross 60,000.00.", [ST("stage5-subcontract.js", "6, 164")]),
    "payApp.retention": money(SC_RET, "10% x 60,000.00 = 6,000.00 (rate given explicitly on the application, retentionRate 10).", [ST("stage5-subcontract.js", "7, 25, 124, 165"), S("sub-pay-app.service.js", "357")]),
    "payApp.net": money(SC_NET, "60,000.00 - 6,000.00 = 54,000.00.", [ST("stage5-subcontract.js", "8, 166"), S("sub-pay-app.service.js", "358-363")]),
    "payment.status": http(201, "POST /pay-apps/:id/payments answers 201 (it was only noted at stage5:191, so a failed payment passed).", [P(455), R("sub-pay-apps.js", "131-143")]),
    "payment.paidAmount": money(SC_NET, "Payment 54,000.00 = the whole net, so paidAmount 54,000.00.", [P(455), S("sub-pay-app.service.js", "1035")]),
    "payment.payAppStatus": state("paid", "paidAmount >= net - 0.01 -> status 'paid' (the field is `status`; sub-pay-apps have no paymentStatus field).", [P(455), S("sub-pay-app.service.js", "1036-1037")], { note: "The area map named the field paymentStatus; HEAD stores the payment state in status." }),
    "cashFlow.outflow": money(SC_NET, "GET /cash-flow without a manual rebuild: the payment path rebuilds (sub-pay-app.service.js:1042); summary.outflow 54,000.00 in month 2027-04 (paidAt 2027-04-15, toMonth = UTC ISO month).", [P(455), S("sub-pay-app.service.js", "1042"), S("cash-flow.service.js", "17-22, 160-169")]),
    "cashFlow.month": fig("2027-04", "month", "toMonth('2027-04-15') = '2027-04'.", [ST("stage5-subcontract.js", "187"), S("cash-flow.service.js", "21")]),
    "ledger.afterPayment": money(cents(60000), "The payment moves cash only: ledger delta across certification is the gross 60,000.00 and the payment adds 0.00 (stage5:174, :195 now meaningful because the payment is asserted 201).", [ST("stage5-subcontract.js", "174, 195")]),
  },
};

// ─── WP-4 commercial core (plan 631-692) ──────────────────────────────────────────────────────

const WP4 = {
  E1: {
    romTotal: money(cents(6000) + cents(4000), "Two event lines, ROM 6,000 + 4,000 = 10,000.00.", [P(643), AREA]),
    afterRfqSend: state("pricing", "Sending an RFQ moves an open event to pricing.", [S("change-event.service.js", "716")]),
    quoteA: money(cents(9500), "Vendor A quotes 9,500.00 in total through the public link.", [P(643)], { assumption: true, note: "A's RFQ must cover BOTH lines (e.g. 5,700 + 3,800) for the event estimate to be 9,500: estimate = sum over lines of (quoted ?? ROM) (change-event.service.js:187). An RFQ for line 1 only, quoted 9,500, converts to 9,500 + 4,000 = 13,500.00. The two-vendors-on-one-line case of §3.2 (HR-C12) is a separate event." }),
    afterAccept: state("priced", "Accepting A's quote writes quotedAmount on the lines and prices the event.", [S("change-event.service.js", "771-776")]),
    convertedValue: money(cents(5700) + cents(3800), "Convert value = Σ(quoted ?? ROM) = 5,700 + 3,800 = 9,500.00 (the quote beats the ROM 10,000).", [P(643), S("change-event.service.js", "181-188, 808-809")]),
    coStatus: state("draft", "The prime CO is created as a draft.", [P(643), S("change-event.service.js", "812-828")]),
    eventStatus: state("converted", "The event is converted and linked to the CO.", [S("change-event.service.js", "848")]),
    convertAgain: err(409, "CHANGE_EVENT_CONVERTED", "A second convert finds status converted / changeOrderId set.", [P(643), S("change-event.service.js", "804")]),
    patchConverted: err(409, "CHANGE_EVENT_LOCKED", "Edits are refused once converted.", [P(643), S("change-event.service.js", "536")]),
    voidConverted: err(409, "CHANGE_EVENT_CONVERTED", "Void of a converted event (with a reason) is refused.", [P(643), S("change-event.service.js", "867")]),
    deleteWithRfqs: err(409, "CHANGE_EVENT_LOCKED", "Delete is only for open events without RFQs.", [S("change-event.service.js", "644"), AREA]),
    voidWithoutReason: err(400, "VALIDATION_ERROR", "The route validator (reason min length 1) answers before the service's CHANGE_EVENT_REASON_REQUIRED.", [R("change-events.js", "76"), S("change-event.service.js", "870")], { note: "The area map expected CHANGE_EVENT_REASON_REQUIRED; at HEAD the route answers first." }),
  },
  E2: {
    concurrentConverts: fig({ ok2xx: 1, conflict409: 1, changeOrders: 1 }, "outcome", "Two concurrent POST /change-events/:id/convert: exactly one 2xx, one 409 CHANGE_EVENT_CONVERTED, exactly one ChangeOrder.", [P(644)], { today: "The converted check is outside any transaction (L199); two prime COs are possible." }),
    pendingDelta: money(cents(9500), "pendingChangesValue rises by the one draft CO only: +9,500.00 (draft counts as pending: PENDING_CHANGE_STATUSES = draft, pending).", [P(644), S("prime-contract.service.js", "37, 288-300")], { today: cents(19000), note: "today = 19,000.00 if both converts succeed." }),
    midwayRefusalOrphans: count(0, "A commitment CO refused mid-convert (e.g. 409 COMMITMENT_LOCKED on a closed commitment) leaves no prime CO behind; a retry then succeeds once.", [P(644), S("change-event.service.js", "812-846"), S("commitment.service.js", "848")]),
  },
  E3: {
    createWithStatusPending: err(400, "VALIDATION_ERROR", "body('status').isIn(['draft']) refuses 'pending' before the service.", [P(645), R("change-orders.js", "119")], { note: "The area map expected CHANGE_ORDER_WORKFLOW_ACTION_REQUIRED (change-order.service.js:444); the route answers first at HEAD." }),
    submitWithoutSummaries: err(400, "CHANGE_ORDER_IMPACT_SUMMARY_REQUIRED", "Submit needs both impact summaries.", [P(645), S("change-order.service.js", "541")]),
    submitWithoutDocument: err(400, "CHANGE_ORDER_IMPACT_PROOF_REQUIRED", "With summaries but no document.", [P(645), S("change-order.service.js", "552")]),
    rejectWithoutReason: err(400, "VALIDATION_ERROR", "Route validator reason notEmpty.", [R("change-orders.js", "331-343")], { note: "Area map expected APPROVAL_WORKFLOW_REASON_REQUIRED." }),
    reopenRejected: state("draft", "rejected -> reopen -> draft.", [P(645), AREA]),
    archivePendingDelta: money(-cents(40000), "Archiving the pending 40,000 CO lowers pendingChangesValue by 40,000.00 (archivedAt excluded from the aggregate).", [P(645), S("prime-contract.service.js", "288-300")]),
    archiveApproved: err(409, "CHANGE_ORDER_APPROVED_LOCKED", "An approved CO cannot be archived.", [S("change-order.service.js", "1658-1664")]),
  },
  E4: {
    split01_100: money(cents(6000), "Value 10,000 split 6,000 on 01-100.", [P(646)]),
    split02_100: money(cents(4000), "and 4,000 on 02-100; approval writes change_order budget-line rows 6,000.00 / 4,000.00.", [P(646)]),
    revisedDelta: money(cents(10000), "Revised budget +6,000 + 4,000 = +10,000.00.", [P(646)]),
    splitMismatch: err(400, "CHANGE_ORDER_ALLOCATION_MISMATCH", "A split summing 9,000 against a 10,000 CO is refused.", [P(646), S("change-order.service.js", "304")]),
  },
  E5: {
    pendingChangesValue: money(cents(40000), "One pending 40,000 CO.", [P(647)], { assumption: true, note: "Holds only while the 40,000 CO is the project's only draft/pending CO (E1's 9,500 draft also counts as pending); read on a project where only these two COs are live, or as a delta." }),
    approvedChangesValue: money(APPROVED_CO, "One approved 125,000 CO.", [P(647)]),
    revisedValue: money(REVISED, "2,000,000 + 125,000 = 2,125,000.00.", [P(647), S("prime-contract.service.js", "263")]),
    budgetRevision: money(APPROVED_CO, "Approval writes BudgetRevision BR-<CO ref> approved 125,000.00.", [P(634), S("change-order.service.js", "857-922")]),
  },
  E6: {
    deductiveCo: err(400, "VALIDATION_ERROR", "POST value -1,000 is refused by moneyBody('value') today.", [P(648), R("change-orders.js", "118")], { assumption: true, note: "Expected answer waits on HR-C13 (owner's call on deductive prime COs); this records today's answer." }),
  },
  HRC12: {
    secondAcceptOnSameLine: err(409, null, "087-COM's event with RFQs to two vendors on ONE line: once one quote is accepted, accepting the second is refused (HR-C12 recommendation: one accepted quote per line).", [P(387), P(688), P(1040)], { assumption: true, today: "both RFQs become accepted; the later one overwrites the line's quotedAmount and convert raises commitment COs for both (change-event.service.js:771-776, 832-845)", note: "HR-C12 is not decided; status and code wait on the fix." }),
    archivedCoEvent: state("priced", "Archiving the CO of a converted event returns the event to priced (HR-C12 recommendation).", [P(688), P(1040)], { assumption: true, today: "stuck: neither re-convertible (change-event.service.js:804) nor voidable (:867)" }),
  },
  rfiCo: {
    createdAs: state("draft", "A CO raised from an RFI starts as a draft (stage14:158).", [P(387), ST("stage14-rfi.js", "158")]),
    convertTwice: err(409, "RFI_ALREADY_CONVERTED", "Second conversion of the same RFI.", [ST("stage14-rfi.js", "162")]),
    value: money(cents(4500), "The RFI's cost impact 4,500.00 carried to the CO.", [ST("stage14-rfi.js", "29, 169")]),
    revisedDeltaOnApproval: money(cents(4500), "Approval raises Revised and approved changes by exactly 4,500.00 and is not a cost.", [ST("stage14-rfi.js", "199-203")], { note: "On 087-COM this moves the contract's revised value too, which changes I7's cap (0.4% x 2,129,500 = 8,518.00) if approved before I7." }),
  },
  existing: {
    "stage8.approvedChange": money(APPROVED_CO, "One approved 125,000.00 CO; Original 1,700,000 -> Revised 1,825,000.", [P(683), ST("stage8-change-directcost.js", "4, 186-200")]),
    "stage8.revisedBudget": money(cents(1700000) + APPROVED_CO, "1,700,000 + 125,000 = 1,825,000.00.", [ST("stage8-change-directcost.js", "4, 193-197")]),
    "stage8.draftChange": money(cents(40000), "The 40,000.00 draft moves neither budget nor ledger.", [ST("stage8-change-directcost.js", "27, 62-69")]),
    "stage8.directCost": money(cents(8500), "Direct cost 8,500.00; actual 660 + 60,000 + 8,500 = 69,160.00.", [ST("stage8-change-directcost.js", "5, 279")]),
    "stage8.actualAfterDirect": money(cents(660) + cents(60000) + cents(8500), "660 + 60,000 + 8,500 = 69,160.00.", [ST("stage8-change-directcost.js", "279")]),
    "stage10.contractRevised": money(REVISED, "2,000,000 + 125,000 = 2,125,000.00.", [ST("stage10-client.js", "73-80")]),
    "stage10.gross": money(GROSS, "5,000 x 12 + 100 x 150 + 150 x 150 = 60,000 + 15,000 + 22,500 = 97,500.00 (= EV).", [ST("stage10-client.js", "10-13, 53-55")]),
    "stage10.retention": money(RET10, "10% x 97,500 = 9,750.00 (the contract rate PATCHed onto every item, stage10:143).", [ST("stage10-client.js", "14, 56, 143")]),
    "stage10.net": money(NET, "97,500 - 9,750 = 87,750.00.", [ST("stage10-client.js", "15, 57")]),
    "stage10.received": money(cents(80000), "Client pays 80,000.00.", [ST("stage10-client.js", "16, 58")]),
    "stage10.outstanding": money(NET - cents(80000), "87,750 - 80,000 = 7,750.00.", [ST("stage10-client.js", "17, 240")]),
    "stage10.cashInflow": money(cents(80000), "Cash in 80,000.00 (after stage 10's rebuild).", [ST("stage10-client.js", "281")]),
    "stage10.cashOutflow": money(SC_NET, "Cash out 54,000.00 (the stage-5 payment).", [ST("stage10-client.js", "282")]),
    "stage10.ledgerDelta": money(0, "Certify, invoice and payment move the cost ledger by 0.00: client money is not cost.", [P(636), ST("stage10-client.js", "250")]),
  },
  mutations: {
    retentionDefaultGuard: fig(["WP4.I1.certifyUnconfigured"], "mutation", "Drop the HR-C1 guard (let an unconfigured project certify at a silent rate): I1 must turn red.", [P(681), P(1108)]),
    variationScopeMatch: fig(["WP4.I3.A130LimitQuantity", "WP4.I3.patchA130Qty650"], "mutation", "Match the variation on the BOQ item again: A130 reads 650 and I3 turns red.", [P(681), P(1108)]),
    convertLock: fig(["WP4.E2.concurrentConverts", "WP4.E2.pendingDelta"], "mutation", "Remove the convert lock: two COs, pending +19,000.", [P(681), P(1108)]),
    oneOpenPayApp: fig(["WP4.P1.secondOpen"], "mutation", "Remove the one-open rule.", [P(681), P(1108)]),
    payAppPaymentCeiling: fig(["WP4.P4.payOverNetPlus2"], "mutation", "Remove the payment ceiling: the +0.02 probe (45,000.02, refused at HEAD) turns red. recordPayment holds the ceiling TWICE with the same test, addMoney(paid, amount) > net + EPSILON: the pre-check (sub-pay-app.service.js:1012-1016) and the re-check under the row lock (:1021 FOR UPDATE, check :1029-1033). The mutation must remove BOTH: with only one removed, the other still answers 400 SUB_PAY_APP_PAYMENT_EXCEEDS and the probe stays green, so the mutation survives. The plan's +0.01 probe cannot catch it: with the 0.01 tolerance it is already accepted at HEAD (adjudication C1).", [P(681), P(1108), S("sub-pay-app.service.js", "27, 1012-1016, 1021, 1029-1033"), ADJ("C1")]),
    approvedCoLock: fig(["WP4.E3.archiveApproved"], "mutation", "Remove the lock on approved COs: archive (and stage8's PATCH value check, CHANGE_ORDER_APPROVED_LOCKED) turns red.", [P(681), P(1108), ST("stage8-change-directcost.js", "204-210")]),
  },

  C1: {
    submitNoLines: err(409, "COMMITMENT_LINES_REQUIRED", "Submit with no SOV lines.", [P(650), S("commitment.service.js", "709")]),
    submitNoVendor: err(409, "COMMITMENT_VENDOR_REQUIRED", "Submit with no vendor.", [P(650), S("commitment.service.js", "710")]),
    qsApprove: err(403, "FORBIDDEN", "commitment.approve is pm only (shared/permissions.json), RBAC answers 403 FORBIDDEN.", [P(650), "shared/permissions.json modules.commitment @" + HEAD]),
    returnWithoutReason: err(400, "VALIDATION_ERROR", "Route validator reason notEmpty answers before COMMITMENT_RETURN_REASON_REQUIRED.", [R("commitments.js", "179-184"), S("commitment.service.js", "717")], { note: "Area map expected COMMITMENT_RETURN_REASON_REQUIRED." }),
    executeWithoutDocument: err(400, "COMMITMENT_DOCUMENT_REQUIRED", "Execute with no executed agreement.", [P(650), S("commitment.service.js", "780")]),
    insuranceMissing: err(409, "COMMITMENT_INSURANCE_MISSING", "Required insurance missing or expired, no override.", [P(650), S("commitment.service.js", "781-786")]),
    overrideWithoutReason: err(400, "COMMITMENT_OVERRIDE_REASON_REQUIRED", "PM override without a reason.", [P(650), S("commitment.service.js", "787")]),
    linesAfterApproval: err(409, "COMMITMENT_LOCKED", "PUT lines once approved.", [P(650), S("commitment.service.js", "587")]),
    voidExecuted: err(409, "COMMITMENT_TRANSITION_INVALID", "void is allowed only from draft/pending/approved.", [P(650), S("commitment.service.js", "661-663")]),
  },
  C2: {
    committedExecuted: money(cents(100000), "Executed SC 100,000 on 03-100: committed 100,000.00.", [P(651), S("commitment.service.js", "30, 454-505")]),
    committedCoDraftPending: money(cents(100000), "A +10,000 commitment CO in draft or pending does not count.", [P(651)]),
    committedCoApproved: money(cents(110000), "Approved: 100,000 + 10,000 = 110,000.00.", [P(651), S("commitment.service.js", "454-505")]),
    committedCoRejected: money(cents(110000), "A rejected CO changes nothing (still 110,000.00 after the approved one).", [AREA]),
    approvedNotExecuted: money(0, "An approved but not executed commitment posts nothing (POSTING_STATUSES = executed, closed).", [S("commitment.service.js", "30")]),
    coOnClosed: err(409, "COMMITMENT_LOCKED", "A CO on a closed (or void) commitment.", [S("commitment.service.js", "848"), AREA]),
  },
  C3: {
    noDefaultNoRate: fig("configuration required", "state", "087-COM has no defaultRetentionRate and the commitment names no rate: under HR-C1 there is no silent 5%, so the commitment must be refused (or held) until a rate or an explicit 'no retention' is configured.", [P(652), P(29), S("commitment.service.js", "381")], { assumption: true, planDisagrees: true, planValue: 5, today: 5, note: HR_C1_NOTE + " HR-C1 is worded for the IPC basis (plan 1029); applying it to commitment.service.js:381 (`defaultRetentionRate ?? 5`) is this book's reading and needs the owner's confirmation." }),
    projectDefault: fig(7.5, "percent", "087-COM-B (adjudication C3): project defaultRetentionRate 7.5%, prime contract 10%. A commitment without retentionRate takes Number(project.defaultRetentionRate ?? 5) = Number(7.5) = 7.5; the commitment never reads the prime contract's rate.", [P(652), P(388), S("commitment.service.js", "381"), ADJ("C3")], { note: "Plan §3.2's 087-COM-B cell (:388, 'Project retention 10%, prime contract 7.5%') is swapped; the integration owner decided project 7.5 / contract 10 and the plan gets corrected. With that, plan C3 ('a project at 7.5 gives 7.5') and plan I2 ('the contract rate of 10 gives net 36,000.00') both hold on 087-COM-B." }),
  },
  C4: {
    sameLine: fig("same budget line", "state", "L108: a purchase_order commitment whose SOV line names cost code X only, with budget lines X/material and X/subcontract; execute, approve a 1,000 pay app: committed and actual must land on the same line.", [P(653), AREA], { assumption: true, today: "lead predicts committed on X/material, actual on X/subcontract (sub-pay-app.service.js:708 posts costType subcontract)" }),
    actualPosted: money(cents(1000), "The 1,000.00 pay application posts 1,000.00 of actual.", [AREA], { assumption: true }),
  },
  C5: {
    closeWithRetentionHeld: err(409, "CLOSEOUT_OUTSTANDING", "L116: SC at 10% certified and paid to 100%, retention held; POST /close without override is refused by the closeout gate (retention_released outstanding) and no endpoint releases subcontract retention.", [P(654), S("commitment.service.js", "727-744"), "backend/src/services/closeout.service.js:154-165, 471 @" + HEAD], { assumption: true, note: "Expected behaviour after the fix waits on HR-C13 (owner's call); this is today's refusal." }),
  },

  I1: {
    currentCert: money(I1_CERT, "Row 1,000 m3 @ 100 = 100,000, activity approved 40%; item qty 400 x 100.00 = 40,000.00.", [P(656), AREA]),
    certifyUnconfigured: refusal(HR_C1_REFUSAL_RULE, "087-COM is created without defaultRetentionRate and its contract rate is not explicitly configured, so no certificate may settle retention at a silent rate: the lane is refused until retention is configured (an explicit rate or an explicit 'no retention'). Which step refuses, with which status and code, is the fix's choice.", [P(656), P(29), P(387), ADJ("C2")], {
      planDisagrees: true,
      planValue: { retention: pctOf(I1_CERT, 5), net: I1_CERT - pctOf(I1_CERT, 5) },
      today: { itemRetentionRate: 0, retention: 0, net: I1_CERT },
      note: `${HR_C1_NOTE} ${HR_C1_REFUSAL_NOTE} Today Number(null) = 0 is finite, so resolveRetentionRate gives 0 (ipc.service.js:51-54, 779, 872).`,
    }),
    silentContractRate: fig("not authoritative", "state", "ensureContract writes retentionRate 5 when the project default is null (prime-contract.service.js:264-266); under HR-C1 that stored 5 is the silent fallback and must not count as configuration.", [S("prime-contract.service.js", "264-266"), P(29)], { assumption: true }),
    configured5Retention: money(pctOf(I1_CERT, 5), "After an explicit contract retention of 5%: 5% x 40,000.00 = 2,000.00.", [P(656), P(69)], { assumption: true, note: "Only if the builder configures 5% explicitly; 5 is then configuration, not a fallback. This pair is the CLAUDE.md rule's reference (plan 69). 087-COM itself is configured at 10% after the I1 refusal (adjudication C8, deep.087-COM.contractRetentionRate), where the same 40,000.00 item, once certified, holds 4,000.00 and pays 36,000.00." }),
    configured5Net: money(I1_CERT - pctOf(I1_CERT, 5), "40,000.00 - 2,000.00 = 38,000.00.", [P(656), P(69)], { assumption: true }),
    explicitNoRetention: money(I1_CERT, "With an explicitly configured 'no retention': retention 0.00, net 40,000.00.", [P(29)], { assumption: true }),
  },
  I2: {
    retention: money(pctOf(I1_CERT, 10), "087-COM-B (adjudication C3): project 7.5%, prime contract 10%. HR-C1: the contract rate is authoritative, so the I1-shaped item (400 x 100.00 = 40,000.00) holds 10% x 40,000.00 = 4,000.00.", [P(657), P(388), P(29), ADJ("C3")], { today: pctOf(I1_CERT, 7.5), note: "today 7.5% x 40,000.00 = 3,000.00: HEAD never reads the contract rate. createIpcPeriod resolves the item rate from the PROJECT default (ipc.service.js:51-54 resolveRetentionRate, :779, written to every item at :872), the item PATCH keeps it (Number(payload.retentionRate ?? existing.retentionRate), :934-935) and retention = currentCert x rate / 100 (:938); certification sums the items (:108-122, :1417) and certificateFinancials only caps them (prime-contract.service.js:661-667). A real red-to-green suspect (L114). The proof must not PATCH retentionRate onto the item (stage10:143 does), or HEAD passes trivially." }),
    net: money(I1_CERT - pctOf(I1_CERT, 10), "40,000.00 - 4,000.00 = 36,000.00 (§3.2 configures no retention cap, advance or tax on 087-COM-B, so certificateFinancials subtracts nothing else: prime-contract.service.js:657-691).", [P(657), P(388), ADJ("C3")], { today: I1_CERT - pctOf(I1_CERT, 7.5), note: "today 40,000.00 - 3,000.00 = 37,000.00 (see WP4.I2.retention)." }),
    netIfRatesSwapped: money(I1_CERT - pctOf(I1_CERT, 10), "The swap, settled: the first draft of §3.2 had 087-COM-B at project 10 / contract 7.5; adjudication C3 swapped it to project 7.5 / contract 10, the only reading under which both plan C3 ('a project at 7.5 gives 7.5') and plan I2 ('the contract rate of 10 gives net 36,000.00') hold, and the plan was corrected in WP-0. With the swapped (now decided) rates the contract's 10 is authoritative (HR-C1): 40,000.00 - 10% x 40,000.00 = 40,000.00 - 4,000.00 = 36,000.00, the same figure as WP4.I2.net.", [P(657), P(388), P(652), ADJ("C3")], { today: I1_CERT - pctOf(I1_CERT, 7.5), note: "Kept under its first name so the independent recomputation (C:/Temp/octapm-cert/scratch/wp0/verify-commercial.js) still finds it. today 40,000.00 - 7.5% x 40,000.00 = 37,000.00: HEAD reads the project default 7.5, never the contract rate (see WP4.I2.retention)." }),
  },
  I3: {
    A120LimitQuantity: fig(200 + 50, "m3", "B-002 split A120 200 m3 / A130 600 m3, both approved, both activities at 100%; CO 7,500 approved with allocationLinks [{A120, qty 50, amount 7,500}]: A120 limit 200 + 50 = 250 m3.", [P(658), AREA]),
    A120LimitAmount: money(cents(30000) + cents(7500), "30,000 + 7,500 = 37,500.00.", [P(658), AREA]),
    A130LimitQuantity: fig(600, "m3", "The variation names A120 only, so A130 stays 600 m3.", [P(658)], { today: 650, note: "today 600 + 50: variationLinkNames matches the BOQ item too (ipc.service.js:187-191, change-order.service.js:748)." }),
    A130LimitAmount: money(cents(90000), "A130 stays 90,000.00.", [P(658)], { today: cents(97500) }),
    patchA130Qty650: err(400, "IPC_ALLOCATION_QTY_EXCEEDED", "650 > 600 m3.", [P(658), S("ipc.service.js", "471-477")], { today: "accepted (limit 650)", assumption: true, note: "Holds only while A130 has no earlier certified amount; with I6's 30,000 already certified the amount check (127,500 > 97,500) answers IPC_ALLOCATION_AMOUNT_EXCEEDED today. Run I3 before any A130 certification or on 052-COM." }),
  },
  I4: {
    patchItemStatus: err(400, "IPC_ITEM_STATUS_DIRECT_UPDATE_FORBIDDEN", "PATCH item {status:'certified'} (a value the route enum accepts).", [P(659), R("ipc.js", "96"), S("ipc.service.js", "915-921")]),
    submitTwice: err(409, "IPC_INVALID_SUBMISSION_STATE", "Only draft periods submit.", [P(659), S("ipc.service.js", "1177-1183")]),
    patchAfterSubmit: err(409, "IPC_PERIOD_NOT_EDITABLE", "Items edit only in draft.", [P(659), S("ipc.service.js", "908-914")]),
    certifyDraft: err(409, "IPC_INVALID_CERTIFICATION_STATE", "Only submitted periods certify.", [P(659), S("ipc.service.js", "1276-1282")]),
    invoiceBeforeCertify: err(409, "IPC_CERTIFICATE_NOT_CERTIFIED", "Invoice only on certified/paid.", [P(659), S("ipc.service.js", "1566-1572")]),
    paymentBeforeInvoice: err(409, "IPC_INVOICE_REQUIRED", "Payment needs an issued invoice.", [P(659), S("ipc.service.js", "1706-1712")]),
    secondInvoice: err(409, "IPC_INVOICE_ALREADY_ISSUED", "One non-void invoice per period.", [P(659), S("ipc.service.js", "1581-1587")]),
    periodTwice: err(400, "IPC_PERIOD_EXISTS", "Same period code twice.", [P(659), S("ipc.service.js", "789-794")]),
  },
  I5: {
    certifyOnBoqFallback: err(409, "CONTRACT_VALUE_NOT_ESTABLISHED", "087-COM-C's contract value is only the BOQ fallback (originalValueSource boq_fallback), so certify refuses before any amount is read.", [P(660), P(389), S("prime-contract.service.js", "55-64, 99-118"), S("ipc.service.js", "1288")]),
    afterValueEntered: state("certified", "After PATCH /prime-contract originalValue (source becomes contract_entry) the same certify succeeds.", [P(660), S("prime-contract.service.js", "368, 400")]),
    valueSourceBefore: state("boq_fallback", "Source recorded by ensureContract when the project has no value.", [S("prime-contract.service.js", "215-220")]),
    valueSourceAfter: state("contract_entry", "Set by updateContract.", [S("prime-contract.service.js", "368, 400")]),
  },
  I6: {
    earnedCap: money(pctOf(cents(90000), 25), "A130 allocation 600 m3 x 150 = 90,000 at 25% approved = 22,500.00.", [P(661), AREA]),
    claimed: money(cents(200 * 150), "qty 200 x 150.00 = 30,000.00.", [P(661)]),
    overCertificationAmount: money(cents(200 * 150) - pctOf(cents(90000), 25), "max(over approved limit 0, over earned 30,000 - 22,500) = 7,500.00.", [P(661), S("ipc.service.js", "543-583, 1434-1437")]),
    noReason: err(400, "IPC_PM_OVERRIDE_REASON_REQUIRED", "Certify (PM or finance) without overrideReason.", [S("ipc.service.js", "1333-1340")]),
    financeWithReason: err(403, "IPC_PM_OVERRIDE_REQUIRED", "Finance may certify (period.certify pm/finance) but not over the limit.", [S("ipc.service.js", "1341-1348")]),
    qsCertify: err(403, "FORBIDDEN", "QS has no period.certify (pm, finance only), so RBAC refuses before the service.", ["shared/permissions.json modules.ipc.transitions['period.certify'] @" + HEAD, R("ipc.js", "166-170")], { note: "Area map expected 400 for the QS; the policy answers 403 first." }),
    pmWithReason: state("certified", "PM with a reason: certified, reason and actor stored.", [P(661), S("ipc.service.js", "1425-1447")]),
    setupObstacle: err(400, "IPC_APPROVED_PROGRESS_EXCEEDED", "At HEAD the item PATCH itself refuses qty 200 at 25% (assertApprovedProgressBasis without allowOverride), so the over-limit certificate cannot be prepared through the item PATCH.", [S("ipc.service.js", "954-964, 433-461")], { assumption: true, note: "Open: the builder must reach an over-earned item another way (patch at higher approved progress, then an authorised downward correction under HR-P1), or the plan's I6 setup changes." }),
  },
  I7: {
    retentionCap: money(RET_CAP, "retentionCapRate 0.4% x revised 2,125,000 = 8,500.00.", [P(662), S("prime-contract.service.js", "662-667")], { assumption: true, note: "Needs revised = 2,125,000 at certification (before E4's +10,000 or the RFI CO is approved) and no earlier certified retention on the project (room = cap - retention certified so far, ipc.service.js:140-151, prime-contract.service.js:665): if I1's period is certified after 087-COM's rate is configured at 10% (adjudication C8), it holds 4,000.00 and the room is 8,500 - 4,000 = 4,500.00." }),
    itemRetention: money(RET10, "Items: 10% x 97,500 = 9,750.00 before the cap.", [P(662)]),
    totalRetCapped: money(Math.min(RET10, RET_CAP), "min(9,750, 8,500 - 0) = 8,500.00.", [P(662), S("prime-contract.service.js", "664-666")]),
    netCapped: money(GROSS - Math.min(RET10, RET_CAP), "97,500 - 8,500 = 89,000.00.", [P(662)]),
    advanceRecovery: money(RECOVERY, "Advance 200,000 received, recovery 10%: min(outstanding 200,000, 10% x 97,500) = 9,750.00.", [P(662), S("prime-contract.service.js", "669-674")], { assumption: true }),
    netWithAdvance: money(GROSS - RET10 - RECOVERY, "97,500 - 9,750 - 9,750 = 78,000.00.", [P(662)], { assumption: true, note: "78,000 needs the cap OFF for this certificate. With the 0.4% cap still on: 97,500 - 8,500 - 9,750 = 79,250.00; a later certificate on the same contract has cap room 0, giving 87,750.00." }),
    netWithAdvanceAndCap: money(GROSS - Math.min(RET10, RET_CAP) - RECOVERY, "Alternative if the cap stays configured: 97,500 - 8,500 - 9,750 = 79,250.00.", [S("prime-contract.service.js", "657-691")], { assumption: true }),
    deductionWithoutNote: err(400, "IPC_DEDUCTION_REASON_REQUIRED", "Deduction 1,000 with no note.", [S("ipc.service.js", "1119-1131"), AREA]),
    taxAmount: money(pctOf(GROSS - RET10, 5), "Tax (plan names no rate; 5% is an assumption, adjudication C7): beforeTax 97,500 - 9,750 = 87,750; 5% = 4,387.50.", [P(387), S("prime-contract.service.js", "676-690"), ADJ("C7")], { assumption: true, note: "The 5% is set on the contract only for I7's certification and put back to 0 before I8 and I10 are certified (build note in meta.buildNotes: HEAD allows it, so I7 stays on 087-COM). Read I7's tax from the certified certificate (taxAmount stored at certification), not from the statement, once the rate is back to 0." }),
    netWithTax: money(GROSS - RET10 + pctOf(GROSS - RET10, 5), "87,750 + 4,387.50 = 92,137.50 (no cap, no advance on that certificate).", [P(387), ADJ("C7")], { assumption: true }),
  },
  I8: {
    certifiedNet: money(NET, "97,500 - 9,750 = 87,750.00 at the configured 10%.", [P(663), ST("stage10-client.js", "10-17")]),
    payOverBalance: err(400, "IPC_PAYMENT_EXCEEDS_PAYABLE_BALANCE", "Pay 87,750.01 > balance 87,750.00.", [P(663), S("ipc.service.js", "1727-1736")]),
    payFull: state("paid", "Pay 87,750.00: status paid, paymentStatus paid, balanceDue 0.00.", [P(663), S("ipc.service.js", "292-357")]),
    balanceDueAfterPay: money(0, "87,750 - 87,750.", [S("ipc.service.js", "301-303")]),
    cashInflowWithoutRebuild: money(NET, "GET /cash-flow with no manual rebuild shows +87,750.00 in the payment month (the payment path rebuilds).", [P(663), S("ipc.service.js", "1819-1829")]),
    releaseOverHeld: err(400, "IPC_RETENTION_RELEASE_EXCEEDS_HELD", "Release 9,750.01 > 9,750.00 held.", [P(663), S("ipc.service.js", "1888-1901")]),
    afterReleasePaymentStatus: state("partially_paid", "After releasing 9,750: payable to date 87,750 + 9,750 = 97,500, paid 87,750, so paymentStatus partially_paid and balanceDue 9,750.00.", [S("ipc.service.js", "292-327")]),
    afterReleaseStatus: state("certified", "Status and paymentStatus must agree: with 9,750.00 still due after the release, a status that follows payment (HR-C3 recommendation) reads 'certified', not 'paid'.", [P(663), P(1031)], { assumption: true, today: "paid (one-way, ipc.service.js:352-357) while paymentStatus is partially_paid", note: "HR-C3 is not decided; the fixed point is the invariant (status agrees with paymentStatus), the value 'certified' is this book's reading of the recommendation." }),
    afterReleaseBalanceDue: money(RET10, "97,500 - 87,750 = 9,750.00.", [S("ipc.service.js", "301-303")]),
    paySecond: state("paid", "Pay 9,750.00: paid / paid, retentionStatus released, amountPaid 97,500.00.", [P(663), S("ipc.service.js", "306-318")]),
    amountPaidTotal: money(NET + RET10, "87,750 + 9,750 = 97,500.00.", [S("ipc.service.js", "293-296")]),
  },
  I9: {
    statementInvoiced: money(NET, "Statement invoiced = Σ netPayable of certificates with an issued invoice = 87,750.00.", [P(664), S("prime-contract.service.js", "846-848")], { assumption: true, note: "Must equal receivables invoiced; which definition wins is HR-C4 (CERT-5 decides, CERT-3 records)." }),
    receivablesInvoiced: money(NET + RET10, "Receivables invoiced = Σ invoice.netAmount, which includes the released 9,750: 97,500.00.", [P(664), S("ipc.service.js", "359-365")], { assumption: true }),
    disagreement: money(RET10, "97,500 - 87,750 = 9,750.00 = the released retention; expected 0.00 after HR-C4.", [P(664), P(1032)], { assumption: true, today: RET10 }),
  },
  I10: {
    materialsOnSite: money(cents(5000), "Materials on site 5,000.00 on the certificate.", [P(665)]),
    gross: money(GROSS + cents(5000), "97,500 + 5,000 = 102,500.00 (gross = totalCert + materials).", [P(665), S("prime-contract.service.js", "657")], { today: GROSS, note: "today the invoice grossAmount = totalCert 97,500.00 (ipc.service.js:1621)." }),
    retentionHeld: money(RET10, "Client retention is on the items only: 9,750.00.", [P(665)]),
    net: money(GROSS + cents(5000) - RET10, "102,500 - 9,750 = 92,750.00.", [P(665)]),
    preconditions: fig(
      { deductions: 0, advanceRecovery: 0, taxRate: 0, retentionCapRoomMin: RET10 },
      "outcome",
      "I10's 102,500 - 9,750 = 92,750.00 holds only when that certificate carries no deduction (deductions 0), no advance recovery and no tax, and the retention cap leaves room (certificateFinancials, prime-contract.service.js:657-691). Left on, each moves the net: advance recovery at 10% = min(outstanding 200,000 - 9,750 = 190,250, 10% x gross 102,500) = 10,250.00 (gross includes materials, :671-674); tax at 5% = 5% x 92,750 = 4,637.50 (:676-680); retention = max(0, min(9,750, room)) with room = 0.4% x revised - retention certified so far (:663-666, ipc.service.js:140-151). Adjudication C8 states the cap condition as room > 0; the 9,750.00 retention itself needs room >= 9,750.00 (or no cap): a room of 0 < r < 9,750 caps retention at r, and after I7 takes the whole 8,500.00 cap the room is 0.00 (retention 0.00, net 102,500.00).",
      [P(665), P(387), S("prime-contract.service.js", "657-691"), S("ipc.service.js", "140-160"), ADJ("C8")],
      { note: "Build note (meta.buildNotes): if the 0.4% cap is used up after I7, put I10 on a period whose cap room exists, or raise the cap first. Tax is back to 0 before I10 is certified (adjudication C7)." }
    ),
  },
  I11: {
    submittedBackToDraft: state("route back to draft", "A submitted certificate needs a return path (HR-C3 recommendation, QS or PM with a reason).", [P(666), P(1031)], { assumption: true, today: "none: items stay locked (PATCH -> 409 IPC_PERIOD_NOT_EDITABLE)" }),
  },
  I12: {
    pmRecordsPayment: err(403, "FORBIDDEN", "payment.record is finance only (L211).", [P(667), "shared/permissions.json modules.ipc.transitions['payment.record'] @" + HEAD], { assumption: true, note: "Conflicts with CLAUDE.md 'PM (all access)'; the plan states the check as written, the owner rules on L211." }),
  },

  P1: {
    notExecuted: err(409, "SUB_PAY_APP_COMMITMENT_NOT_EXECUTED", "Against an approved, not executed, commitment.", [P(669), S("sub-pay-app.service.js", "442")]),
    noPeriod: err(400, "SUB_PAY_APP_PERIOD_REQUIRED", "No periodLabel.", [P(669), S("sub-pay-app.service.js", "445")]),
    secondOpen: err(409, "SUB_PAY_APP_OPEN_EXISTS", "A second while the first is draft (details.reasonCode DUPLICATE_PERIOD).", [P(669), S("sub-pay-app.service.js", "453")]),
    submitEmpty: err(409, "SUB_PAY_APP_EMPTY", "Submit with nothing claimed.", [P(669), S("sub-pay-app.service.js", "895")]),
  },
  P2: {
    progressCap: money(pctOf(cents(100000), 50), "SC line 100,000 on A310 at 50% approved: cap 50,000.00.", [P(670), S("sub-pay-app.service.js", "320-323")]),
    overClaimAmount: money(cents(60000) - pctOf(cents(100000), 50), "Claim 60,000 - cap 50,000 = 10,000.00; submit 400 SUB_PAY_APP_OVER_CLAIM.", [P(670), S("sub-pay-app.service.js", "323, 659")]),
    overClaimRefusal: err(400, "SUB_PAY_APP_OVER_CLAIM", "Submit refuses the over-claim.", [P(670), S("sub-pay-app.service.js", "659")]),
    exceedsSchedule: err(400, "SUB_PAY_APP_EXCEEDS_SCHEDULED", "Claim 120,000 > scheduled 100,000 (refused when the claim is written).", [P(670), S("sub-pay-app.service.js", "309-318")]),
    withApprovedCo: money(cents(120000), "An approved commitment CO +20,000 naming the line: revised schedule 120,000.00, still capped by progress (50% x 120,000 = 60,000.00).", [AREA]),
  },
  P3: {
    gross: money(cents(50000), "Claim 50,000.00.", [P(671)]),
    retention: money(pctOf(cents(50000), 10), "10% = 5,000.00.", [AREA]),
    net: money(cents(50000) - pctOf(cents(50000), 10), "45,000.00.", [AREA]),
    approvePosts: money(cents(50000), "Approval posts the GROSS +50,000.00 (source sub_pay_app).", [P(671), S("sub-pay-app.service.js", "686-753")]),
    revokeMirror: money(-cents(50000), "Revoke to draft by the approver with a reason writes -50,000.00; source net 0.00; certificationRevision 1.", [P(671)]),
    reapprovePosts: money(cents(50000), "Re-approval posts +50,000.00 under the suffix r1; source total 50,000.00.", [P(671)]),
    sourceTotalAfter: money(cents(50000), "50,000 - 50,000 + 50,000.", [P(671)]),
    qsRevoke: err(403, "SUB_PAY_APP_REVOKE_FORBIDDEN", "QS has sub_pay_app update but not approve.", [P(671), S("sub-pay-app.service.js", "777"), R("sub-pay-apps.js", "124-128")]),
    revokeWithoutReason: err(400, "SUB_PAY_APP_REASON_REQUIRED", "The reopen route takes an optional reason; the service requires it for a certified application.", [S("sub-pay-app.service.js", "751"), R("sub-pay-apps.js", "127")]),
  },
  P4: {
    payOverNet: err(400, "SUB_PAY_APP_PAYMENT_EXCEEDS", "The plan's probe: a first payment of 45,000.01 against net 45,000.00 is expected refused (plan).", [P(672), S("sub-pay-app.service.js", "1011-1013"), ADJ("C1")], {
      today: { status: 201, paidAmount: cents(45000.01), payAppStatus: "paid", cashOutflow: cents(45000.01) },
      note: "today accepted: the ceiling is addMoney(alreadyPaid, amount) > net + EPSILON with EPSILON 0.01 (sub-pay-app.service.js:27, 1012, again under the lock at 1029); 0 + 45,000.01 > 45,000.00 + 0.01 is false in doubles (45,000 + 0.01 = 45,000.01), so the route answers 201 (sub-pay-apps.js:143), paidAmount 45,000.01 >= net - 0.01 marks it paid (:1035-1037) and the rebuild books 45,000.01 out (:1042). Confirm-first suspect (adjudication C1): 'money ceilings allow one cent over (0.01 tolerance)'; a tolerance only needs to absorb floating-point noise and should be < 0.005. Proposed P3, classified after reproduction. At HEAD this probe pays the application in full, so the lane's 20,000 / 25,000 steps would then answer 400 SUB_PAY_APP_PAYMENT_EXCEEDS on it: a HEAD reproduction runs it on its own approved application (net 45,000.00, nothing paid). Once fixed it writes nothing and its place in the lane does not matter.",
    }),
    payOverNetPlus2: err(400, "SUB_PAY_APP_PAYMENT_EXCEEDS", "Second probe (adjudication C1): 45,000.02 > net 45,000.00 + the 0.01 tolerance = 45,000.01, refused at HEAD by the pre-check (sub-pay-app.service.js:1012-1016) and nothing written; the same test is repeated under the row lock (:1029-1033). It is the catcher for the guard-removal mutation (WP4.mutations.payAppPaymentCeiling), which must remove BOTH checks: with either one left, this probe is still refused and stays green.", [P(672), S("sub-pay-app.service.js", "27, 1011-1016, 1029-1033"), ADJ("C1")]),
    payPartStatus: state("approved", "20,000 paid: still approved, paidAmount 20,000.00.", [P(672), S("sub-pay-app.service.js", "1035-1037")]),
    paidAmount: money(cents(20000), "20,000.00.", [P(672)]),
    cashOutflowWithoutRebuild: money(cents(20000), "+20,000.00 in the payment month, no manual rebuild.", [P(672), S("sub-pay-app.service.js", "1042")]),
    revokeAfterPayment: err(409, "SUB_PAY_APP_ALREADY_PAID", "Revoking a part-paid application.", [S("sub-pay-app.service.js", "740-748"), AREA]),
    paySecond: state("paid", "25,000 more: 20,000 + 25,000 = 45,000 = net, so paid.", [AREA]),
  },
  P5: {
    complianceMissing: err(409, "SUB_PAY_APP_COMPLIANCE", "waiverRequired without a waiver (MISSING_COMPLIANCE).", [P(673), S("sub-pay-app.service.js", "953")]),
    complianceOverride: state("approved", "With complianceOverrideReason: approved, reason in the audit.", [AREA]),
  },
  P6: {
    finalCloseoutGate: err(409, "CLOSEOUT_OUTSTANDING", "A final application reaching the revised value is refused by the closeout gate unless ready or overridden.", [P(673), "backend/src/services/closeout.service.js:471 @" + HEAD], { assumption: true }),
  },
  P7: {
    rejectWithoutReason: err(400, "VALIDATION_ERROR", "Route validator reason notEmpty.", [P(673), R("sub-pay-apps.js", "115")]),
    rejectedReopen: state("draft", "rejected -> reopen -> draft -> resubmit.", [P(673), AREA]),
  },

  CF1: {
    "2026-08.outflow": money(cents(8500), "Direct-cost payment 8,500 dated 2026-08-31 -> month 2026-08 (toMonth is the UTC ISO month).", [P(675), S("cash-flow.service.js", "17-22, 171-180")], { assumption: true, note: "Dates from the area map (CF1); all three payments are read without any manual rebuild." }),
    "2026-09.inflow": money(cents(80000), "Client payment 80,000 dated 2026-09-15.", [P(675)], { assumption: true }),
    "2026-09.outflow": money(cents(54000), "Subcontract payment 54,000 dated 2026-09-20.", [P(675)], { assumption: true }),
    "summary.inflow": money(cents(80000), "80,000.00.", [P(675), AREA], { assumption: true }),
    "summary.outflow": money(cents(54000) + cents(8500), "54,000 + 8,500 = 62,500.00 (net 17,500 = 80,000 - 62,500, plan 675).", [P(675), AREA], { assumption: true }),
    "summary.net": money(cents(80000) - cents(54000) - cents(8500), "80,000 - 62,500 = 17,500.00.", [P(675)], { assumption: true, note: "Project totals only on a project whose only payments are these three (087-COM carries I8, P4 and D3 payments too): read CF1 as month deltas or on its own project." }),
  },
  CF2: {
    advanceInflow: money(ADVANCE, "Advance receipt 200,000 dated 2026-07-01 -> expected 2026-07 inflow 200,000.00.", [P(676), S("prime-contract.service.js", "596-608"), S("cash-flow.service.js", "93-180")], { assumption: true, today: 0, note: "L115/HR-C16: CERT-5 decides; today the advance never reaches cash flow." }),
  },
  CF3: {
    manualSurvivesRebuild: money(cents(1000), "A manual 1,000 inflow (source manual) survives a rebuild (only source system rows are deleted).", [P(677), S("cash-flow.service.js", "182-185")]),
    period2026_13: http(400, "A month 13 is not a month.", [P(677), AREA], { assumption: true, today: 201, note: "Both checks are /^\\d{4}-\\d{2}$/ (route.cash-flow.js:34, cash-flow.service.js:73), so '2026-13' is accepted today; the code of the fix is VALIDATION_ERROR or INVALID_PERIOD." }),
    deleteSystemRow: http(409, "Deleting a system row should be refused.", [P(677), AREA], { assumption: true, today: 200, note: "L120: today any row is deleted (cash-flow.service.js:203-219) until the next rebuild." }),
  },
  CF4: {
    concurrentRebuilds: fig({ systemRowSets: 1, totalsEqualCF1: true }, "outcome", "Five concurrent POST /cash-flow/rebuild leave one set of system rows and CF1's totals.", [P(678), S("cash-flow.service.js", "182-198")], { assumption: true, today: "deleteMany + createMany with no lock or unique key (L120)" }),
  },
  CF5: {
    financeRebuild: err(403, "FORBIDDEN", "Rebuild needs cost:update = pm, qs, cost_controller.", [P(679), R("cash-flow.js", "53-55")]),
    costControllerRebuild: http(200, "Cost controller may rebuild.", [P(679), R("cash-flow.js", "53-64")]),
  },
};

// ─── WP-5 supply chain (plan 694-753) ─────────────────────────────────────────────────────────

const WP5 = {
  R1: {
    "bid.gulf.total": money(BID.gulf, "60 t x 1,150.00 = 69,000.00 (lowest).", [P(739), ST("stage11-rfq.js", "7, 255")], { assumption: true, note: "087-COM's bid package reuses the stage-11 rebar figures (§3.2 gives none)." }),
    "bid.emirates.total": money(BID.emirates, "60 x 1,240.00 = 74,400.00.", [P(739), ST("stage11-rfq.js", "8, 256")], { assumption: true }),
    "bid.northern.total": money(BID.northern, "60 x 1,190.00 = 71,400.00.", [P(739), ST("stage11-rfq.js", "9, 257")], { assumption: true }),
    estimate: money(BID.estimate, "60 x 1,200.00 BOQ rate = 72,000.00.", [ST("stage11-rfq.js", "5, 249")], { assumption: true }),
    ranking: fig(["gulf", "northern", "emirates"], "list", "By total: 69,000 < 71,400 < 74,400.", [ST("stage11-rfq.js", "254")], { assumption: true }),
    awardedNotLowestGap: money(BID.emirates - BID.gulf, "74,400 - 69,000 = 5,400.00 paid for the 14-day lead.", [P(387), ST("stage11-rfq.js", "288")], { assumption: true }),
    unqualifiedAward: err(409, "PREQUAL_AWARD_BLOCKED", "Award confirm to an unqualified ad-hoc bidder without the PM override reason.", [ST("stage11-rfq.js", "295-297")]),
    packageStates: fig(["draft", "open", "closed", "awarded"], "list", "draft -> open (publish needs a future dueAt) -> closed -> awarded (or cancelled).", [P(696), AREA]),
    submitAfterDue: err(409, "BID_PAST_DUE", "Late bid: submit after dueAt.", [P(708), S("bid.service.js", "816")]),
    publishPastDue: err(400, "BID_DUE_DATE_REQUIRED", "Publish with a past dueAt.", [S("bid.service.js", "637")]),
    inviteOnDraft: err(409, "BID_PACKAGE_NOT_OPEN", "Invitation on a draft package.", [S("bid.service.js", "609")]),
    cancelAwarded: err(409, "BID_PACKAGE_LOCKED", "An awarded package cannot be cancelled.", [S("bid.service.js", "395, 415")]),
    confirmNoBid: err(400, "BID_NOT_FOUND", "Confirm with no submitted winning bid (the confirm path answers 400; the soft award answers 404 for the same lookup).", [S("bid.service.js", "988, 1038")]),
    withdrawResubmit: state("submitted", "A withdrawn bid may be resubmitted while the package is open.", [P(696), S("bid.service.js", "843-869")]),
  },
  R2: {
    concurrentConfirms: fig({ commitments: 1, conflict409: 1 }, "outcome", "Two concurrent POST /bids/:id/award/confirm: one commitment (awardedCommitmentId), one 409 BID_PACKAGE_LOCKED.", [P(709), S("bid.service.js", "1035")], { today: "status check outside a transaction (bid.service.js:1034-1035): two commitments possible" }),
  },
  R3: {
    secondOrder: err(409, null, "Ordering twice from one award must refuse (one order per award).", [P(710)], { assumption: true, today: "201, a second identical PO (procurement.service.js:1762-1840 has no already-ordered check)" }),
  },
  R4: {
    lineCoding: fig(["costCodeId", "budgetLineId", "boqItemId", "activityId"], "list", "The order raised from the award carries the package lines' cost code, budget line and BOQ item, not only the activity.", [P(711), S("procurement.service.js", "1762-1840")], { today: ["activityId"] }),
    awardPoValue: money(BID.emirates, "60 x 1,240.00 = 74,400.00 (stage11:347).", [ST("stage11-rfq.js", "347")], { assumption: true }),
  },
  R5: {
    singleAwardLimit: money(cents(250000), "The directory vendor's prequalification singleAwardLimit (stage11:156).", [ST("stage11-rfq.js", "156")], { assumption: true }),
    overLimitOrExpired: err(409, "PREQUAL_AWARD_BLOCKED", "An award above 250,000.00 or with an expired prequalification is refused unless the PM overrides with a reason.", [P(712), AREA]),
  },
  O1: {
    submitNoLines: err(400, "PO_NO_LINES", "Submit with no lines.", [P(714), S("purchase-order.service.js", "515-518")]),
    submitNoSupplier: err(400, "PO_SUPPLIER_REQUIRED", "No supplier.", [S("purchase-order.service.js", "521-523")]),
    submitNoRequiredBy: err(400, "PO_REQUIRED_DATE", "No requiredBy.", [S("purchase-order.service.js", "524-526")]),
    rejectNoReason: err(400, "PO_REJECT_REASON_REQUIRED", "Reject without a reason (route reason optional).", [S("purchase-order.service.js", "601-606"), R("purchase-orders.js", "33")]),
    patchIssued: err(409, "PO_LOCKED", "Edits only planned/draft/pending.", [S("purchase-order.service.js", "56, 664-720")]),
    issuePending: err(409, "PO_TRANSITION_INVALID", "pending_approval -> issued is not allowed.", [S("purchase-order.service.js", "116-136")]),
  },
  O2: {
    ordered: fig(100, "bag", "PO 100 bags @ 10 issued.", [P(715)]),
    received: fig(60, "bag", "Receipt of 60.", [P(715)]),
    statusAfterPartial: state("partial", "Goods receipt writes status partial / warehouseStatus partial.", [P(715), S("goods-receipt.service.js", "769-778")]),
    closeOutstanding: err(409, "PO_CLOSE_OUTSTANDING", "details.lines [1].", [P(715), S("purchase-order.service.js", "628-641")]),
    forceNoReason: err(400, "PO_CLOSE_REASON_REQUIRED", "force:true, no reason.", [P(715), S("purchase-order.service.js", "642-648")]),
    forceWithReason: state("closed", "With a reason: 200, closed.", [P(715), P(1036)], { today: { status: 409, code: "PO_TRANSITION_INVALID" }, note: "ALLOWED has no row for partial (purchase-order.service.js:116-125)." }),
    receiveAfterClose: err(409, "PO_NOT_ISSUED", "Receiving 40 more after the close.", [P(715), S("goods-receipt.service.js", "365, 471-483")]),
    fullyReceivedClose: state("closed", "A fully received PO closes without force.", [P(715)], { today: { status: 409, code: "PO_TRANSITION_INVALID" } }),
    order1000: money(cents(100 * 10), "100 x 10.00 = 1,000.00.", [AREA]),
  },
  O3: {
    cancelAfterDelivery: err(409, "PO_CANCEL_AFTER_DELIVERY", "Cancel after a partial delivery.", [P(716), S("purchase-order.service.js", "551-558")], { today: { status: 409, code: "PO_TRANSITION_INVALID" }, note: "assertTransition runs first and partial has no ALLOWED row." }),
  },
  O4: {
    draftReceipt: err(409, "PO_NOT_ISSUED", "Receipt on a draft PO.", [P(717), S("goods-receipt.service.js", "471-483")]),
    acknowledgedReceipt: http(201, "An acknowledged PO accepts a receipt.", [S("goods-receipt.service.js", "365")], { assumption: true, note: "Status 201 assumed for a created receipt." }),
    duplicateLine: err(400, "RECEIPT_DUPLICATE_LINE", "Same poLineId twice.", [S("goods-receipt.service.js", "503-509")]),
    overOrder: err(409, "RECEIPT_OVER_ORDER", "41 against 40 outstanding.", [S("goods-receipt.service.js", "633-642")]),
    alreadyPosted: err(409, "RECEIPT_ALREADY_POSTED", "Same receipt number twice.", [S("goods-receipt.service.js", "582-598")]),
    acceptedStock: fig(10, "bag", "10 accepted + 2 rejected: stock +10.", [P(717)]),
    rejectedQty: fig(2, "bag", "rejectedQty 2, never stocked.", [P(717)]),
    matchFlag: state("rejected_on_delivery", "Match flag (warning).", [S("goods-receipt.service.js", "886-892")]),
  },
  O5: {
    receivableList: fig(["issued", "acknowledged", "partial"], "list", "Only orders a receipt accepts.", [P(718), S("goods-receipt.service.js", "365")], { today: ["draft", "issued", "partial"], note: "goods-receipt.service.js:196-197." }),
  },
  O6: {
    refCollision: err(409, null, "087-COM and 087-COM-B both hold PO-00001: the scan answers 409 ambiguous or requires projectId (HR-C9).", [P(719), P(388), P(1037)], { assumption: true, today: "an arbitrary one of the two (goods-receipt.service.js:165-181)" }),
  },
  O7: {
    ignoredFields: fig({ stockIssued: 0, ledgerEntries: 0 }, "outcome", "The procurement door with issueToActivity=true, issuedQty 60 issues no stock and posts no ledger entry (fields ignored today; HR-C7 recommends 400).", [P(720), R("procurement.js", "312, 327")], { assumption: true }),
  },
  N1: {
    noTarget: err(400, "INV_NO_COST_TARGET", "Issue with no activity and no cost code.", [P(722), S("inventory.service.js", "1205-1211")]),
    costCodeOnly: fig(false, "boolean", "A cost-code-only issue answers costPosted false with costNote.", [S("inventory.service.js", "1240-1253")]),
    availableAfterReserve: fig(90 - 50, "bag", "On hand 90, reserve 50: available 40.", [P(722)], { assumption: true, note: "Stock 90 @ 11 as stage 4 leaves it (snapshot 990.00)." }),
    issue41: err(409, "INV_INSUFFICIENT_AVAILABLE", "41 > 40 available (reserved > 0).", [P(722), S("inventory.service.js", "1031-1040")]),
    issue40Cost: money(40 * WA, "40 accepted at 11.00 = 440.00 material_issue.", [P(722)], { assumption: true }),
    release51: err(409, "INV_RESERVATION_NEGATIVE", "Reserved is still 50 after issuing 40 of the free stock; releasing 51 > 50.", [S("inventory.service.js", "1369-1375")]),
  },
  N2: {
    returnNeverIssued: err(400, null, "L36: receive 100 @ 10, return 50 never issued: expected 4xx.", [P(723)], { assumption: true, today: "accepted" }),
    stockAfterRefusal: fig({ qty: 100, valueCents: cents(1000) }, "stock", "Stock stays 100 / 1,000.00 and project cost 0.00.", [P(723)]),
    projectCostAfterRefusal: money(0, "Nothing was issued, so the refused return of 50 leaves the project cost from this item at 0.00 (no material_issue entry).", [P(723), ADJ("C8")], {
      today: -(50 * cents(10)),
      note: "today the return is accepted (L36) and gives back cost that was never charged: a return must name the activity or project (inventory.service.js:1428-1436) and posts sign -1 x value through the ledger as material_issue (:933, 958-985), value = 50 x the item average 10.00 = 500.00 (:770, :891), so the project cost reads -500.00 (stock 150 / 1,500.00).",
    }),
    return30After10: err(400, null, "Issue 10 (100.00), then return 30 > 10 issued: refused.", [AREA], { assumption: true }),
    activityAfterReturn4: money(cents(100) - 4 * cents(10), "Return 4 accepted: activity 100.00 - 40.00 = 60.00.", [AREA]),
  },
  N3: {
    credit: money(5 * cents(10), "X-FINANCE-1: receive 10 @ 10, issue 10 (100.00), receive 10 @ 14, return 5 valued at the ISSUE cost 10: credit 50.00.", [P(724)], { today: 5 * cents(14), note: "today valued at the current average 14: credit 70.00." }),
    activity: money(cents(100) - 5 * cents(10), "100.00 - 50.00 = 50.00.", [P(724)], { today: cents(100) - 5 * cents(14) }),
    stock: fig({ qty: 15, valueCents: cents(140) + 5 * cents(10) }, "stock", "10 @ 14 = 140.00 on hand + 5 returned @ 10 = 15 / 190.00.", [P(724)], { today: { qty: 15, valueCents: cents(140) + 5 * cents(14) } }),
    secondReturnActivity: money(0, "Return 5 more: activity 50.00 - 50.00 = 0.00.", [AREA]),
    secondReturnStock: fig({ qty: 20, valueCents: cents(190) + 5 * cents(10) }, "stock", "20 / 240.00.", [AREA]),
  },
  N4: {
    sentValue: money(10 * WA, "Send 10 at WA 11 = 110.00.", [P(725)]),
    receivedValue: money(7 * WA, "7 received = 77.00 on hand at the destination.", [P(725), S("inventory.service.js", "1729-1739")]),
    writtenOff: money(3 * WA, "1 damaged (11.00) + 2 short written off by adjust -2 (22.00) = 33.00.", [P(725), S("inventory.service.js", "1740-1786")]),
    conserved: fig(true, "boolean", "110.00 = 77.00 + 33.00; source in transit 0.", [P(725)]),
    receiveAgain: err(409, "TRANSFER_STATE", "A received transfer cannot be received again.", [S("inventory.service.js", "1703-1705")]),
    overReceipt: err(400, "TRANSFER_OVER_RECEIPT", "9 + 2 damaged > 10 sent.", [S("inventory.service.js", "1722-1724")]),
  },
  N5: {
    releaseOverQuarantine: err(409, "INV_INSUFFICIENT_STOCK", "Quarantine 5, release 6.", [P(726), S("inventory.service.js", "765")]),
    release5: fig("on hand restored", "state", "Release 5 brings the 5 back.", [P(726)]),
  },
  N6: {
    issuedQty: fig(60, "bag", "Plan row 100 bags on a PO line, receive 100, issue 60 to the activity: plan row issuedQty 60.", [P(727), P(1035)], { today: 0, note: "nothing writes ActivityMaterial.issuedQty (HR-C7)." }),
    usage50: http(200, "Usage 50 <= 60 available.", [P(727), S("procurement.service.js", "2127-2141")], { today: { status: 409, code: "MATERIAL_USAGE_EXCEEDS_ISSUED_QTY" } }),
    usage70: err(409, "MATERIAL_USAGE_EXCEEDS_ISSUED_QTY", "After 50 used, 10 left; 70 > 10.", [P(727), S("procurement.service.js", "2133-2141")]),
  },
  N7: {
    adjustNoNotes: err(400, "INV_ADJUST_REASON", "Adjust without notes.", [P(728), S("inventory.service.js", "1422-1425")]),
    damageOverReceipt: err(400, "INV_DAMAGE_EXCEEDS_RECEIPT", "6 damaged on a receipt of 5.", [P(728), S("inventory.service.js", "1145")]),
  },
  D1: {
    uncodedSubmit: err(400, "DIRECT_COST_LINE_COST_CODE_REQUIRED", "Submit with an uncoded line.", [P(730), S("direct-cost.service.js", "435")]),
    emptySubmit: err(400, "DIRECT_COST_EMPTY", "Submit with no lines.", [S("direct-cost.service.js", "433")]),
    approveDraft: err(409, "DIRECT_COST_NOT_PENDING", "Approve a draft.", [S("direct-cost.service.js", "480")]),
    returnNoReason: err(400, "VALIDATION_ERROR", "Route validator reason min 1 answers before DIRECT_COST_REASON_REQUIRED.", [R("direct-costs.js", "59"), S("direct-cost.service.js", "535")], { note: "Area map expected DIRECT_COST_REASON_REQUIRED." }),
    returnedState: state("draft", "pending -> returned to draft with a reason, then edit and resubmit.", [S("direct-cost.service.js", "531-543")]),
    patchApproved: err(409, "DIRECT_COST_LOCKED", "Edit an approved cost.", [S("direct-cost.service.js", "363")]),
    deletePending: err(409, "DIRECT_COST_LOCKED", "Only drafts delete.", [S("direct-cost.service.js", "399")]),
  },
  D2: {
    ledger: money(cents(1000) + cents(2000) + cents(3000), "Expense lines 1,000 / 2,000 / 3,000: direct_cost +6,000.00 in three keyed entries (direct_cost:<id>:<lineId>).", [P(731), AREA]),
    entryCount: count(3, "One entry per line key.", [P(731)]),
    concurrentApprove: fig({ postings: 1, conflict409: 1 }, "outcome", "Two concurrent approvals post once; the loser gets 409 DIRECT_COST_NOT_PENDING.", [P(731), S("direct-cost.service.js", "480-483")]),
    voidMirror: money(-(cents(1000) + cents(2000) + cents(3000)), "Void writes -6,000.00; source net 0.00.", [P(731), S("direct-cost.service.js", "546-577")]),
    voidAgain: err(409, "DIRECT_COST_LOCKED", "Already void.", [S("direct-cost.service.js", "548")]),
  },
  D3: {
    payOver: err(400, "DIRECT_COST_PAYMENT_EXCEEDS", "6,000.01 > 6,000.00 + 0.005.", [P(732), S("direct-cost.service.js", "585")]),
    payFull: state("paid", "6,000.00 pays it.", [P(732), AREA]),
    voidPaid: err(409, "DIRECT_COST_HAS_PAYMENTS", "Void with payments.", [S("direct-cost.service.js", "549")]),
    cashOutflow: money(cents(6000), "+6,000.00 in the payment month without a manual rebuild.", [P(732), S("direct-cost.service.js", "608")]),
  },
  D4: {
    ledgerInvoiceBeforeReceipt: money(cents(10 * 100), "L35: stocked PO 10 @ 100; invoice approved BEFORE the receipt, then receipt, then issue 10: project ledger 1,000.00 (the issue).", [P(733)], { today: cents(2 * 10 * 100), note: "today the invoice is expensed (1,000) and the issue costs it again (1,000)." }),
    controlPath: money(cents(10 * 100), "Receipt -> invoice -> issue = 1,000.00.", [AREA]),
  },
  D5: {
    priceVarianceVerdict: state("review", "Invoice 50 @ 14 vs PO 50 @ 13: |14-13|/13 = 7.69% > 0.5% -> blocking price_variance -> verdict review.", [P(734), S("goods-receipt.service.js", "27, 875-885, 919-924")]),
    priceVarianceApproval: state("refused unless override", "HR-C5 recommendation: a blocking verdict refuses approval unless PM or finance overrides with a reason.", [P(734), P(1033)], { assumption: true, today: "approved (approval never reads the match)" }),
    overInvoicedLedger: money(cents(60 * 10), "Service line 100 @ 10 (no stock item), received 100 (1,000.00), invoices of 60 and 60: the second takes invoiced 120 past received 100, flag invoiced_more_than_received (severity blocking, goods-receipt.service.js:861-867). HR-C5 recommendation: a blocking verdict refuses approval unless the PM or finance overrides with a reason, so only the first posts: 60 x 10.00 = 600.00.", [P(734), P(1033), S("goods-receipt.service.js", "861-867"), ADJ("C5")], { assumption: true, today: cents(60 * 10) * 2, note: "today both invoices are approved (approval never reads the match) and the ledger holds 60 x 10 + 60 x 10 = 1,200.00 for 1,000.00 received. Expected 600.00 rests on the HR-C5 recommendation (undecided)." }),
  },
  D6: {
    invoiceSideVerdict: state("review", "One PO line at +10% plus one freight line without poLineId: blocking dominates.", [P(734)], { today: "check (goods-receipt.service.js:1036 downgrades whenever a line lacks a poLineId)" }),
  },
  D7: {
    balanced: fig(true, "boolean", "After every test /cost/reconciliation balanced true and budget and activity projections equal the ledger.", [P(735), ST("stage4-procurement-inventory.js", "266-269")]),
  },
  mutations: {
    poCloseTransitions: fig(["WP5.O2.forceWithReason", "WP5.O2.fullyReceivedClose"], "mutation", "Remove the new partial/received -> closed rows.", [P(737), P(1109)]),
    awardLock: fig(["WP5.R2.concurrentConfirms"], "mutation", "Remove the award-confirmation lock.", [P(737), P(1109)]),
    receiptOverOrder: fig(["WP5.O4.overOrder"], "mutation", "Remove RECEIPT_OVER_ORDER.", [P(737), P(1109)]),
    insufficientAvailable: fig(["WP5.N1.issue41"], "mutation", "Remove INV_INSUFFICIENT_AVAILABLE.", [P(737), P(1109)]),
    directCostOnePosting: fig(["WP5.D2.concurrentApprove", "WP5.D2.ledger"], "mutation", "Remove the one-posting idempotency of direct costs.", [P(737), P(1109)]),
  },
  existing: {
    stockOnHand: fig(90, "bag", "150 received - 60 issued.", [P(739), ST("stage4-procurement-inventory.js", "254")]),
    stockValue: money(90 * WA, "90 x 11.00 = 990.00.", [P(739), ST("stage4-procurement-inventory.js", "255-259")]),
    "stage12.invoiceA": money(cents(100 * 10), "100 @ 10 = 1,000.00, matched.", [ST("stage12-three-way-match.js", "4, 106")]),
    "stage12.invoiceB": money(cents(50 * 14), "50 @ 14 = 700.00.", [ST("stage12-three-way-match.js", "5, 106")]),
    "stage12.varianceB": money(cents(50 * 14) - cents(50 * 13), "700 - 650 = +50.00.", [ST("stage12-three-way-match.js", "5, 149")]),
    "stage12.ledgerDelta": money(0, "Stocked invoices post no second cost.", [ST("stage12-three-way-match.js", "183")]),
  },
};

// ─── WP-6 BOQ, allocations, budgets (plan 755-795) ────────────────────────────────────────────

const WP6 = {
  U1: {
    dryRunTotal: money(BOQ_TOTAL, "Stage-3 rows B-001..B-005 in a workbook: 459,000.00.", [P(763), AREA]),
    comparison: fig({ added: 5, updated: 0, removed: 0 }, "outcome", "Fresh project: 5 added.", [AREA]),
    writes: fig({ boqItems: 0, boqRevisions: 0, projectDocuments: 0, boqParseJobs: 0, aiGenerationsUsedDelta: 0 }, "outcome", "A dry run writes nothing and spends no AI quota.", [P(763), "backend/src/services/boq.service.js:1172-1174 @" + HEAD]),
  },
  U2: {
    importStatus: state("imported", "Revision status after the real upload; 5 active rows, 459,000.00, one boq.parse job queued.", [P(764), AREA]),
    "B-002.amount": money(cents(800 * 160), "Re-upload with B-002 rate 150 -> 160: 800 x 160 = 128,000.00.", [P(764)]),
    total: money(BOQ_TOTAL - boqAmount("B-002") + cents(800 * 160), "459,000 - 120,000 + 128,000 = 467,000.00.", [P(764)]),
    comparisonUpdated: count(1, "comparison updated 1, still 5 rows.", [AREA]),
    omitB005: fig({ comparisonRemoved: 1, "B-005.active": true }, "outcome", "Omitting B-005: comparison says removed 1, the row stays active (HR-C14 decides).", [P(764), P(1042)], { assumption: true }),
  },
  U3: {
    missingColumns: err(400, "BOQ_VALIDATION_FAILED", "Workbook without the rate column; details.errors[0].code MISSING_COLUMNS; nothing written.", [P(765), "backend/src/services/boq/excel-parser.js:6, 139-150 @" + HEAD]),
    detailCode: fig("MISSING_COLUMNS", "code", "details.errors[0].code.", ["backend/src/services/boq/excel-parser.js:150 @" + HEAD]),
  },
  U4: {
    uploadMode: state("comparison_only", "After submit -> approve -> lock, the next upload is comparison_only; live total unchanged.", [P(766), AREA]),
    patchAfterLock: err(409, "BOQ_BASELINE_LOCKED", "PATCH /boq/items/:id after the lock.", [P(766), S("boq.service.js", "314-316, 1065-1067")]),
  },
  U5: {
    chunk130: fig([60, 60, 10], "batch-sizes", "chunkBoqRows(130 rows, no section): one 'General' section sliced 60/60/10.", [P(67), P(767), S("schedule.service.js", "1865-1891")]),
    chunkSections505030: fig([50, 50, 30], "batch-sizes", "A50/B50/C30: 50+50 > 60 starts a new batch each time.", [P(67), P(767)]),
    chunkSections7045: fig([60, 55], "batch-sizes", "A70 slices 60 + 10; B45 joins the 10 (10 + 45 = 55 <= 60).", [P(67), P(767)]),
    chunk60: fig([60], "batch-sizes", "60 rows: one batch (rows.length <= 60).", [P(767)]),
    chunk61: fig([60, 1], "batch-sizes", "61 rows: 60 + 1.", [P(767)]),
    aiJobCalls087: count(3, "After the L131 fix the AI job on the recorder stub makes 3 calls of at most 60 rows; on 087-COM's 130 rows in sections 50/50/30 the calls are [50, 50, 30].", [P(767), P(387)], { assumption: true, note: "Uploaded rows carry no section today (excel-parser.js:6 has no section column, HR-C14); without one the batches are [60, 60, 10]." }),
  },
  U6: {
    nonAiImportAtLimit: err(402, "AI_LIMIT_REACHED", "L121: aiGenerationsUsed at the plan limit; a real upload is refused today, a dry run answers 200.", [P(768), S("boq.service.js", "1174"), AREA], { assumption: true, note: "HR-C14 recommends quota only for the AI job; today's answer recorded." }),
  },
  U7: {
    siteUpload: err(403, "FORBIDDEN", "boq create is pm, planning_eng, qs.", [P(769), "shared/permissions.json modules.boq @" + HEAD]),
    qsPlannerPm: http(200, "QS, planner and PM get 2xx.", [P(769)], { assumption: true, note: "2xx class; 200 for the dry run." }),
  },
  A1: {
    quantityZero: err(400, "VALIDATION_ERROR", "Route quantity gt 0.", [P(771), R("activity-boq-allocations.js", "50")]),
    overCapacity: err(400, "ALLOCATION_QUANTITY_EXCEEDED", "B-001 fully allocated (5,000 m3) + 1 m3: details.boqQuantity 5000, allocatedQuantity 5001.", [P(771), S("activity-boq-allocation.service.js", "292")]),
    duplicate: err(400, "DUPLICATE_ACTIVE_ALLOCATION", "Same item + activity twice.", [S("activity-boq-allocation.service.js", "276")]),
    foreignActivity: err(404, "ACTIVITY_NOT_FOUND", "Activity of another project.", [S("activity-boq-allocation.service.js", "78")]),
    notApplicable: err(409, "MAPPING_NOT_APPLICABLE", "Allocate a not_applicable row.", [S("activity-boq-allocation.service.js", "325")]),
  },
  A2: {
    patchSubmitted: err(400, "ALLOCATION_NOT_EDITABLE", "PATCH a submitted row.", [P(772), S("activity-boq-allocation.service.js", "1294")]),
    approveDraft: err(400, "INVALID_ALLOCATION_STATUS", "Approve a draft.", [S("activity-boq-allocation.service.js", "1502")]),
    rejectNoReason: err(400, "VALIDATION_ERROR", "Route reason notEmpty answers before REJECT_REASON_REQUIRED.", [R("activity-boq-allocations.js", "300-304"), S("activity-boq-allocation.service.js", "1607")], { note: "Area map expected REJECT_REASON_REQUIRED." }),
    resubmitRejected: err(400, "INVALID_ALLOCATION_STATUS", "Resubmitting a rejected row is refused today (submit accepts drafts only).", [S("activity-boq-allocation.service.js", "1448"), P(1045)], { assumption: true, note: "HR-C17 recommends rejected -> draft -> submit; undecided." }),
  },
  A3: {
    allocated: money(ALLOCATED, "All five stage-3 allocations approved: 387,000.00.", [P(773)]),
    unallocated: money(UNALLOCATED, "B-003 only: 72,000.00.", [P(773)]),
    coveragePct: fig(84.31, "percent", "387,000 / 459,000 x 100 = 84.3137...; the API returns the unrounded 84.31372549019608, compare to 2 dp.", [P(773), S("activity-boq-allocation.service.js", "1022-1027")]),
    rowsComplete: count(4, "4 of 5 rows fully covered (B-003 unmapped).", [AREA]),
  },
  A4: {
    bulk: fig({ createdCount: 1, failedCount: 2, codes: ["ALLOCATION_QUANTITY_EXCEEDED", "DUPLICATE_ACTIVE_ALLOCATION"] }, "outcome", "Bulk of 3 (valid, over capacity, duplicate).", [P(774), AREA]),
  },
  A5: {
    mappingImport: fig({ dryRunWrites: 0, applyCreatesDraftsInOneBatch: true, undoRemovesExactly: true }, "outcome", "Dry run writes nothing; apply creates drafts under one importBatchId; undo removes exactly those.", [P(775), R("activity-boq-allocations.js", "184-221")]),
  },
  A6: {
    patchNotApplicableApproved: err(409, "MAPPING_RULE_HAS_APPROVED_ALLOCATION", "not_applicable on an item with an approved allocation.", [P(776), S("activity-boq-allocation.service.js", "1717")]),
    uploadWarning: fig("MAPPING_RULE_HAS_APPROVED_ALLOCATION", "code", "An upload with mapping_rule not_applicable warns (mappingRuleWarnings) and keeps the rule.", [AREA]),
  },
  B1: {
    original: money([100000, 100000, 50000, 100000, 20000, 10000, 30000].map(cents).reduce((a, b) => a + b, 0), "labour 100,000 + material 100,000 + equipment 50,000 + subcontract 100,000 + indirect 20,000 + overhead 10,000 + contingency 30,000 = 410,000.00.", [AREA]),
    sevenLineTotal: money([1000, 2000, 3000, 4000, 5000, 6000, 7000].map(cents).reduce((a, b) => a + b, 0), "Direct cost with seven typed lines 1,000..7,000: 28,000.00 on the ledger, byCostType exactly those seven.", [P(778)]),
    balanced: fig(true, "boolean", "budget.recordedTotal 28,000.00, balanced true.", [P(778)]),
    costTypes: count(8, "labour, material, equipment, subcontract, indirect, overhead, contingency, other.", [S("budget.service.js", "22"), P(1046)], { note: "CLAUDE.md says 7 categories; HR-C18 recommends keeping 8 and showing 'other' separately." }),
  },
  B2: {
    duplicate: err(409, "BUDGET_LINE_DUPLICATE", "Same cost code + type.", [P(779), S("budget.service.js", "449, 510")]),
    actualDerived: err(400, "BUDGET_ACTUAL_IS_DERIVED", "POST with actual.", [S("budget.service.js", "443, 491")]),
    costCodeInUse: err(409, "COST_CODE_IN_USE", "Removing a cost code with an active line.", [S("budget.service.js", "120")]),
  },
  B3: {
    overTransfer: err(409, "BUDGET_TRANSFER_EXCEEDS", "The plan's probe: transferring 100,000.01 out of 01-100 (revised 100,000.00) is expected refused (plan).", [P(780), S("budget.service.js", "677-678"), ADJ("C1")], {
      today: { status: 200, from01_100: cents(100000) - cents(100000.01), to02_100: cents(100000) + cents(100000.01), projectRevised: [100000, 100000, 50000, 100000, 20000, 10000, 30000].map(cents).reduce((a, b) => a + b, 0) },
      note: "today accepted: money() rounds the amount to 100,000.01 (budget.service.js:43-48) and the check is amount > available + TOLERANCE with TOLERANCE 0.01 (:26, :678); 100,000.01 > 100,000.00 + 0.01 is false in doubles, so both transfer rows are written (:679-680) and the route answers 200 (budget.js:97, sendSuccess default). 01-100 reads -0.01 and 02-100 200,000.01; the project revised stays 410,000.00. Confirm-first suspect (adjudication C1): 'money ceilings allow one cent over (0.01 tolerance)'; the tolerance should be < 0.005. Proposed P3, classified after reproduction. At HEAD the lane's 20,000 transfer out of 01-100 (available -0.01) would then answer 409 BUDGET_TRANSFER_EXCEEDS: a HEAD reproduction runs this probe on its own pair of lines (revised 100,000.00 each). Once fixed it writes nothing and its place in the lane does not matter.",
    }),
    over: money(cents(100000.01), "The plan's probe amount (expected refused; accepted today, see overTransfer).", [P(780)]),
    overTransferPlus2: err(409, "BUDGET_TRANSFER_EXCEEDS", "Second probe (adjudication C1): 100,000.02 > available 100,000.00 + the 0.01 tolerance = 100,000.01, refused at HEAD (budget.service.js:678) and nothing written. It is the catcher for the guard-removal mutation (WP6.mutations.transferLimit).", [P(780), S("budget.service.js", "26, 677-678"), ADJ("C1")]),
    overPlus2: money(cents(100000.02), "The +0.02 probe amount, refused at HEAD.", [P(780), ADJ("C1")]),
    from01_100: money(cents(100000) - cents(20000), "20,000 moves: 01-100 80,000.00.", [P(780)]),
    to02_100: money(cents(100000) + cents(20000), "02-100 120,000.00.", [P(780)]),
    projectRevised: money([100000, 100000, 50000, 100000, 20000, 10000, 30000].map(cents).reduce((a, b) => a + b, 0), "Project revised unchanged at 410,000.00.", [AREA], { assumption: true, note: "Before any CO approval on that budget." }),
    archivedLine: err(409, "BUDGET_LINE_ARCHIVED", "Transfer to/from an archived line.", [S("budget.service.js", "676")]),
  },
  B4: {
    revisionPlus5000: money(cents(5000), "Line revision +5,000 with a note: revised +5,000.00.", [P(781), AREA]),
    amountZero: err(400, "BUDGET_REVISION_AMOUNT_INVALID", "Amount 0.", [S("budget.service.js", "691")]),
  },
  B5: {
    originalLocked: err(409, "BUDGET_ORIGINAL_LOCKED", "L109: approve a CO on line A, PATCH A originalBudget; re-point the CO to B; PATCH A again: still 409.", [P(782), S("budget.service.js", "395-421")], { assumption: true, today: "lead predicts 200 after the re-point" }),
  },
  B6: {
    "BR-B": money(cents(2000000) + cents(5000), "Contract value 2,000,000; in effective-date order BR-B (+5,000, today-20d) comes first: 2,005,000.00.", [P(783), S("budget-revision.service.js", "23-38")], { today: cents(2000000) + cents(10000) + cents(5000), note: "today BR-B = latest-effective approved (BR-A 2,010,000) + 5,000 = 2,015,000.00 (budget-revision.service.js:125-130)." }),
    "BR-A": money(cents(2000000) + cents(5000) + cents(10000), "then BR-A (+10,000, today-10d): 2,015,000.00.", [P(783)], { today: cents(2000000) + cents(10000) }),
  },
  B7: {
    archivedActual: money(cents(2000), "L110: archive a line carrying actual 2,000.00; /budget/lines totals.actual must equal /cost/reconciliation budget.recordedTotal.", [P(784), AREA], { assumption: true }),
  },
  mutations: {
    dryRunWrites: fig(["WP6.U1.writes"], "mutation", "Let the dry run write.", [P(786), P(1110)]),
    allocationCapacity: fig(["WP6.A1.overCapacity", "WP6.A4.bulk"], "mutation", "Remove the capacity check.", [P(786), P(1110)]),
    transferLimit: fig(["WP6.B3.overTransferPlus2"], "mutation", "Remove BUDGET_TRANSFER_EXCEEDS: the +0.02 probe (100,000.02, refused at HEAD) turns red. The plan's +0.01 probe cannot catch it: with the 0.01 tolerance it is already accepted at HEAD (adjudication C1).", [P(786), P(1110), ADJ("C1")]),
    originalLock: fig(["WP6.B5.originalLocked"], "mutation", "Remove the Original lock.", [P(786), P(1110)]),
  },
  existing: {
    "stage3.budgetLines": count(7, "Seven lines.", [P(788), ST("stage3-boq-budget.js", "170")]),
    "stage3.originalBudget": money([120000, 400000, 250000, 300000, 350000, 180000, 100000].map(cents).reduce((a, b) => a + b, 0), "120,000 + 400,000 + 250,000 + 300,000 + 350,000 + 180,000 + 100,000 = 1,700,000.00.", [P(788), ST("stage3-boq-budget.js", "33-43, 175")]),
  },
};

// ─── WP-7 contract time (plan 797-830) ────────────────────────────────────────────────────────

const W = {
  a20_13: weatherSummary(20, [6, 7]),
  a20_14: weatherSummary(20, [6, 7, 1]),
  a30_20: weatherSummary(30, [20]),
  a30_21: weatherSummary(30, [21]),
  a10_6: weatherSummary(10, [6]),
  a10_7: weatherSummary(10, [7]),
  half28: weatherSummary(20, Array(28).fill(0.5)),
};

const WP7 = {
  T1: {
    createApproved: err(400, "VALIDATION_ERROR", "POST with status approved: the route allows draft or submitted only.", [P(806), R("eot.js", "156")]),
    submitWithoutProof: err(400, "EOT_IMPACT_PROOF_REQUIRED", "Submit with no affected activity or no document.", [P(799), S("eot.service.js", "214-257")]),
    patchStatusSubmitted: err(400, "VALIDATION_ERROR", "PATCH {status:'submitted'}: the route allows only 'draft'.", [R("eot.js", "261-263")], { note: "Area map expected EOT_WORKFLOW_ACTION_REQUIRED; that code answers PATCH {status:'draft'} on a submitted claim." }),
    patchStatusDraftOnSubmitted: err(400, "EOT_WORKFLOW_ACTION_REQUIRED", "submitted -> draft has no workflow action.", [P(799), S("eot.service.js", "259-286")]),
    rejectWithoutReason: err(400, "VALIDATION_ERROR", "Reject route reason notEmpty.", [P(800), R("eot.js", "233-237")], { note: "The service's APPROVAL_WORKFLOW_REASON_REQUIRED is not reachable through the route." }),
    resubmitRejected: state("submitted", "rejected -> submitted is allowed.", [S("eot.service.js", "269")]),
    approveDraft: err(400, "EOT_WORKFLOW_ACTION_REQUIRED", "draft -> approved has no workflow action.", [S("eot.service.js", "267-285, 1048-1061")]),
  },
  T2: {
    cumulativeApprovedEotDays: fig(10, "days", "First approved claim, eotDaysGranted 10: 0 prior + 10.", [P(807), S("eot.service.js", "288-327")]),
    revisedCompletionRecommendation: fig("2027-07-10", "date", "completionDate 2027-06-30 + 10 calendar days (addDays uses setDate) = 2027-07-10.", [P(807), S("eot.service.js", "91-97, 320-326")]),
    plannerPatchApproved: err(409, null, "A planner PATCH eotDaysGranted 30 on the approved claim is refused (lock, as change orders: CHANGE_ORDER_APPROVED_LOCKED).", [P(807), P(1038)], { assumption: true, today: { status: 200, eotDaysGranted: 30, cumulativeApprovedEotDays: 10 }, note: "Code chosen by the HR-C10 fix." }),
  },
  T3: {
    cumulativeApprovedEotDays: fig(15, "days", "Second claim of 5 approved: 10 + 5 = 15.", [P(808), S("eot.service.js", "313-318")]),
    revisedCompletionRecommendation: fig("2027-07-15", "date", "2027-06-30 + 15 calendar days.", [P(808)]),
  },
  T4: {
    ldRatePerDay: money(cents(1000), "ldRatePerDay 1,000.00 (§3.2 says only that it is set; area map T4 uses 1,000).", [P(387), AREA], { assumption: true }),
    criticalPathImpactDays: fig(10, "days", "Delay 10, two zero-float activities on ONE chain, eot 10: impact = delay - least float on the named activities = 10.", [P(809), P(1038)], { today: 20, note: "today Σ per activity max(0, 10 - 0) = 20 (eot.service.js:404-407)." }),
    ldApplicableDays: fig(0, "days", "max(0, 10 - 10) = 0.", [P(809)], { today: 10 }),
    ldLiability: money(0, "0 x 1,000.00 = 0.00.", [P(809)], { today: cents(10000) }),
  },
  T5: {
    criticalPathImpactDays: fig(6, "days", "One activity, float 4, delay 10, eot 0: max(0, 10 - 4) = 6.", [P(810), S("eot.service.js", "381, 404-412")]),
    ldApplicableDays: fig(6, "days", "6 - 0 = 6.", [P(810)]),
    ldLiability: money(6 * cents(1000), "6 x 1,000.00 = 6,000.00.", [P(810), S("eot.service.js", "413")]),
  },
  weather: {
    "allowance20.at13.consumedPct": fig(W.a20_13.consumedPct, "percent", "Contractual 6 + 7 = 13; 13 / 20 x 100 = 65.", [P(815), P(70), S("weather.service.js", "161-200")]),
    "allowance20.at13.warning": fig(W.a20_13.warning, "boolean", "65 < 70: no warning.", [P(815)]),
    "allowance20.at13.remaining": fig(W.a20_13.remaining, "days", "20 - 13 = 7.", [P(815)]),
    "allowance20.at14.consumedPct": fig(W.a20_14.consumedPct, "percent", "+1 -> 14; 14 / 20 x 100 = 70 (exactly 70 in IEEE doubles).", [P(815), P(70)]),
    "allowance20.at14.warning": fig(W.a20_14.warning, "boolean", "70 >= 70: warning. Mutation '>= 70' -> '> 70' must turn this red.", [P(815), P(823)]),
    "allowance20.at14.remaining": fig(W.a20_14.remaining, "days", "20 - 14 = 6.", [P(815)]),
    "allowance30.at20.consumedPct": fig(66.67, "percent", "20 / 30 x 100 = 66.666...; the API returns 66.66666666666666, compare to 2 dp.", [P(816)]),
    "allowance30.at20.warning": fig(W.a30_20.warning, "boolean", "No warning.", [P(816)]),
    "allowance30.at21.consumedPct": fig(W.a30_21.consumedPct, "percent", "21 / 30 x 100 = 70.", [P(816)]),
    "allowance30.at21.warning": fig(W.a30_21.warning, "boolean", "Warning.", [P(816)]),
    "allowance10.at6.consumedPct": fig(W.a10_6.consumedPct, "percent", "6 / 10 x 100 = 60.", [P(817)]),
    "allowance10.at6.warning": fig(W.a10_6.warning, "boolean", "No warning.", [P(817)]),
    "allowance10.at7.consumedPct": fig(W.a10_7.consumedPct, "percent", "7 / 10 x 100 = 70.", [P(817)]),
    "allowance10.at7.warning": fig(W.a10_7.warning, "boolean", "Warning.", [P(817)]),
    nonContractual10: fig({ contractualUsed: 14, monthlyNonContractual: 10 }, "outcome", "A non-contractual 10 days adds nothing to contractualUsed (still 14) and shows as nonContractual 10 in its month.", [P(819), S("weather.service.js", "162-185")]),
    "fractional.28xHalf.consumedPct": fig(W.half28.consumedPct, "percent", "28 x 0.5 = 14 days; 14 / 20 x 100 = 70.", [P(820)], { today: 0, note: "today each 0.5 is stored 0 (Int column, schema WeatherDelay.delayDays)." }),
    "fractional.28xHalf.warning": fig(W.half28.warning, "boolean", "70 >= 70.", [P(820)], { today: false }),
    "fractional.storedOneAndHalf": fig(1.5, "days", "POST delayDays 1.5 reads back 1.5.", [P(820), P(1039)], { assumption: true, today: 1, note: "HR-C11 allows either decimal days or a refusal of non-integers; undecided." }),
    "allowanceZero.allowance": fig(0, "days", "weatherAllowanceDays 0 means 0.", [P(821), P(1039)], { today: 20, note: "today `Number(0) || 20` (weather.service.js:161)." }),
    "allowanceZero.warning": fig(null, "boolean", "No expected value (adjudication C6): whether one contractual day against a zero allowance should warn is owner question HR-C11, still open. The check records the answer and does not fail on it.", [P(821), P(1039), AREA, ADJ("C6")], { today: false, note: "today false either way: weatherAllowanceDays 0 is read as Number(0) || 20 = 20 (weather.service.js:161), so 1 / 20 x 100 = 5% < 70; and once 0 means 0, consumedPct = allowance > 0 ? ... : 0 gives 0 when the allowance is 0 (:167), still no warning." }),
    "087-FLD.allowance": fig(20, "days", "weatherAllowanceDays 20, set explicitly (not the || 20 default).", [P(390)]),
    "087-FLD.composition": fig(
      { promoted: [0.5, 1.0, 1.5], at13Manual: [2.5, 7.5], at14Add: [1.0], nonContractual: [10] },
      "outcome",
      "Adjudication C4: the promoted daily-log delays are contractual by default, 0.5 + 1.0 + 1.5 = 3.0 days. The manual contractual delays therefore sum to 10.0 (2.5 + 7.5, half-days included) so the total reaches 3.0 + 10.0 = 13.0 (13 / 20 x 100 = 65%, no warning, 7 remaining), then + 1.0 manual (manual 11.0) = 14.0 (70%, warning, 6 remaining). The 10-day non-contractual delay stays outside contractualUsed (weather.service.js:162-165): still 14.0.",
      [P(390), P(815), P(838), S("weather.service.js", "161-200"), "backend/src/services/daily-log.service.js:1200, 1209 @" + HEAD, ADJ("C4")],
      {
        assumption: true,
        today: { promotedStored: [0, 1, 1], manualStored: [2, 7], at13Used: 11, at13Pct: 55, at14Used: 12, at14Pct: 60, warningAt14: false },
        note: "The manual split 2.5 + 7.5, then 1.0, is a choice; it is the same record set as field-controls.js weather.recordSet (WP-8), so the two books agree. today: every row is written to the Int column WeatherDelay.delayDays (schema.prisma:2958, weather.service.js:217) and stored truncated (558 driver notes: 1.5 -> 1, 0.5 -> 0): promoted 0 + 1 + 1 = 2, manual 2 + 7 = 9, so 11 (55%; the double is 55.00000000000001, compare to 2 dp), then + 1 = 12 (60%), no warning at 14 until HR-C11.",
      }
    ),
    "087-FLD.promoted.days": fig([0.5, 1.0, 1.5], "days", "Delay entries of 2 h, 6 h and 10 h promoted to the weather register: delayDays = Math.round((hoursLost / 8) x 2) / 2 = round(0.5)/2, round(1.5)/2, round(2.5)/2 = 0.5, 1.0, 1.5 (JS Math.round rounds halves up).", [P(390), P(838), "backend/src/services/daily-log.service.js:1200 @" + HEAD, ADJ("C8")], { today: [0, 1, 1], note: "today the promotion's answer echoes 0.5 / 1.0 / 1.5 (daily-log.service.js:1216) but the stored WeatherDelay row reads 0 / 1 / 1 (Int column, weather.service.js:217; truncation from the 558 driver notes, not executed here). Same figures as field-controls.js promote2h / promote6h / promote10h and promoteResponseVsStored." }),
    "087-FLD.promoted.contractual": fig(true, "boolean", "Promotion sends contractual = payload.contractual !== undefined ? Boolean(payload.contractual) : true (daily-log.service.js:1209) and createWeatherDelay keeps it (weather.service.js:218-219), so a promoted delay is contractual by default (adjudication C4).", [P(390), "backend/src/services/daily-log.service.js:1209 @" + HEAD, S("weather.service.js", "218-219"), ADJ("C4")]),
    "087-FLD.promoted.total": fig(0.5 + 1.0 + 1.5, "days", "0.5 + 1.0 + 1.5 = 3.0 contractual days counted toward the 13 / 14.", [P(390), ADJ("C4"), ADJ("C8")], { today: 0 + 1 + 1, note: "today 0 + 1 + 1 = 2 as stored." }),
    "052-FLD": fig({ first: [65, false], then: [70, true] }, "outcome", "052-FLD: weather 65% then 70%, same allowance 20 and the same 13 -> 14 steps.", [P(405)], { assumption: true }),
  },
  mutations: {
    seventyBoundary: fig(["WP7.weather.allowance20.at14.warning", "WP7.weather.allowance30.at21.warning", "WP7.weather.allowance10.at7.warning"], "mutation", "'>= 70' -> '> 70': at exactly 70% the warning turns false (14/20 x 100 = 70 exactly).", [P(823), P(1111)]),
    approvedEotLock: fig(["WP7.T2.plannerPatchApproved"], "mutation", "Remove the approved-EOT lock once it exists.", [P(823), P(1111)]),
  },
};

// ─── §3.2 deep-company contents (plan 387-389, 404, 409) ──────────────────────────────────────

// The integration owner's adjudication of the WP-0 deep-company builders (2026-10-09) and plan
// lines as numbered at product HEAD f599e67 (used by the entries added for it).
const BADJ = (item) => `C:/Temp/octapm-cert/scratch/wp0/builders-adjudication.md ${item}`;
const PF = (lines) => `${PLAN}:${lines} @f599e67`;

// IPC-04 certified last (builders' adjudication 087-COM item 3): I6's over-earned claim on A130,
// certified on a PM override after IPC-08, so the advance recovery is in force. Derived from the
// book's own I6 and I8 figures and 087-COM's advance terms; certificateFinancials
// (prime-contract.service.js:649-692) in integer cents.
const IPC04 = (() => {
  const rate = 150; // A130's BOQ rate (WP4.I6.claimed: qty 200 x 150.00)
  const claimedQty = 200; // WP4.I6.claimed: cumulative A130 claim 200 m3
  const ipc03Qty = 150; // WP4.I8 (IPC-03): A130 150 m3 x 150 = 22,500.00 inside GROSS 97,500
  const earned = pctOf(cents(90000), 25); // WP4.I6.earnedCap 22,500.00
  if (cents(ipc03Qty * rate) !== earned) throw new Error("commercial answer book: IPC-03's A130 must equal I6's earned cap");
  const qty = claimedQty - ipc03Qty; // 50 m3 this period
  const gross = cents(qty * rate); // 7,500.00 = WP4.I6.overCertificationAmount
  const over = cents(claimedQty * rate) - earned;
  if (gross !== over) throw new Error("commercial answer book: IPC-04's gross must be I6's overage");
  const retention = pctOf(gross, 10); // deep.087-COM.contractRetentionRate 10 (items at 10%, L114 PATCH at HEAD), no cap
  const outstanding = ADVANCE - RECOVERY; // 200,000 - IPC-08's 9,750 (WP4.I7.advanceRecovery) = 190,250
  const recovery = Math.min(outstanding, pctOf(gross, ADVANCE_RECOVERY_RATE)); // min(190,250, 750)
  const deductions = 0;
  const beforeTax = gross - retention - recovery - deductions;
  const taxAmount = pctOf(beforeTax, 0); // taxRate back to 0 after IPC-05 (C7)
  return { rate, claimedQty, ipc03Qty, earned, qty, gross, over, retention, outstanding, recovery, deductions, beforeTax, taxAmount, net: beforeTax + taxAmount };
})();
const IPC04_SRC = [PF("426, 700, 701"), P(661), P(662), S("prime-contract.service.js", "649-692"), BADJ("087-COM/-B/-C, 052-COM item 3; R2-2")];
const IPC04_NOTE = "Build choice the plan leaves open, accepted by the integration owner (builders' adjudication 087-COM item 3) on two conditions met by the build: WP4-OVR-1 persisted as a finding with the observed 400 IPC_PM_OVERRIDE_REASON_REQUIRED (once A130 is over-certified every later certificate needs a PM override, ipc.service.js:556, :579-582), and the two-draft set-up (IPC-03 150 m3 and IPC-04 50 m3 on A130, drafted together) persisted with ref WP4-DRAFTS-1.";

// IPC-09 (submitted, carrying the plan's deduction) and IPC-10 (a draft), both opened after IPC-04 is
// certified (builders' adjudication round 2, R2-B B2). From the book's own keys: the B-004 / B-005
// rates and allocations (BOQ / ALLOC, stage3:109), deep.087-COM.contractRetentionRate 10 (no cap:
// the cap is IPC-02's only, deep.087-COM.ipc04.retention), the advance (deep.087-COM.advance and
// advanceRecoveryRate) less what certified certificates recovered before them (IPC-08's
// WP4.I7.advanceRecovery and IPC-04's deep.087-COM.ipc04.advanceRecovery), taxRate back to 0
// (adjudication C7). A draft's or a submitted certificate's totals are recomputeCertificateTotals'
// (ipc.service.js:108-175, run on every draft item edit and draft/submitted adjustment) through
// certificateFinancials (prime-contract.service.js:649-692), here in integer cents.
const IPC0910 = (() => {
  // Recovery is locked only at certification (prime-contract.service.js:694-732); IPC-09 (submitted)
  // locks nothing, so IPC-10 sees the same outstanding as IPC-09.
  const outstanding = IPC04.outstanding - IPC04.recovery; // 190,250.00 - 750.00 = 189,500.00
  const certificate = ({ boq, activity, qty, approvedPct, deductions }) => {
    const rate = BOQ[boq].rate;
    const gross = cents(qty * rate);
    const allocation = ALLOC[`${boq}/${activity}`];
    const earned = pctOf(allocation, approvedPct);
    // Within earned, or the item PATCH refuses (IPC_APPROVED_PROGRESS_EXCEEDED, WP4.I6.setupObstacle).
    if (!(gross <= earned)) throw new Error(`commercial answer book: the ${boq}/${activity} claim must sit within earned`);
    const retention = pctOf(gross, 10); // deep.087-COM.contractRetentionRate, no cap
    const recovery = Math.min(outstanding, pctOf(gross, ADVANCE_RECOVERY_RATE));
    if (recovery !== pctOf(gross, ADVANCE_RECOVERY_RATE)) throw new Error("commercial answer book: the advance outstanding must not bind IPC-09 / IPC-10");
    const beforeTax = gross - retention - recovery - deductions;
    const taxAmount = pctOf(beforeTax, 0); // taxRate 0 after IPC-05 (C7)
    return { boq, activity, qty, rate, gross, allocation, approvedPct, earned, retention, outstanding, recovery, deductions, beforeTax, taxAmount, net: beforeTax + taxAmount };
  };
  return {
    // A310 at 50% approved (WP4.P2.progressCap's basis): earned 67,500.00; nothing else on 087-COM claims A310.
    ipc09: certificate({ boq: "B-004", activity: "A310", qty: 500, approvedPct: 50, deductions: cents(1000) }),
    // A320 at 100% approved on 087-COM (build choice: SC-004's PA-02 claims 60% of its line): earned 72,000.00.
    ipc10: certificate({ boq: "B-005", activity: "A320", qty: 1000, approvedPct: 100, deductions: 0 }),
  };
})();
if (IPC0910.ipc09.net !== cents(17000) || IPC0910.ipc10.net !== cents(14400)) throw new Error("commercial answer book: IPC-09 / IPC-10 nets must follow from their keys");
const IPC0910_SRC = [PF("426, 701, 704"), P(662), P(665), S("ipc.service.js", "108-175, 1064-1145"), S("prime-contract.service.js", "539-540, 649-692, 694-732"), BADJ("Round 2 R2-B (B2); 087-COM/-B/-C, 052-COM items 2 and 3")];
const IPC0910_NOTE = "The quantities (500 m2 on A310, 1,000 m2 on A320) are build choices: plan §3.2 fixes only a submitted and a draft certificate and a deduction. WP4-OVR-1 (persisted on IPC-09) does not move these totals: the override review gates certification only.";

// 087-COM-C (builders' adjudication round 2, R2-B B3): the bill the BOQ fallback takes and the one
// certificate left at the certify gate. The B-006 row is the builder's (an optional, unallocated
// disposal row, so the bill total differs from the one allocation); B-001 is the book's (BOQ).
const COMC = (() => {
  const rows = [
    { code: "B-001", description: "Bulk excavation to reduced level", quantity: BOQ["B-001"].qty, unit: BOQ["B-001"].unit, rate: BOQ["B-001"].rate, mappingRule: "required" },
    { code: "B-006", description: "Disposal of surplus material off site", quantity: 2000, unit: "m3", rate: 8, mappingRule: "optional" },
  ];
  const billTotal = rows.reduce((sum, row) => sum + cents(row.quantity * row.rate), 0); // 60,000.00 + 16,000.00
  const allocation = ALLOC["B-001/A110"]; // the whole B-001 row on A110, 5,000 m3 = 60,000.00
  const qty = BOQ["B-001"].qty;
  const gross = cents(qty * BOQ["B-001"].rate);
  if (gross !== pctOf(allocation, 100)) throw new Error("commercial answer book: 087-COM-C's IPC-01 claims the whole B-001/A110 allocation at A110 100%");
  const retentionRate = 10; // the project's explicit defaultRetentionRate (HR-C1), taken by the items and the contract
  const retention = pctOf(gross, retentionRate);
  const recovery = 0; // no advance received: advancePaidAmount 0, outstanding 0
  const deductions = 0;
  const beforeTax = gross - retention - recovery - deductions;
  const taxAmount = pctOf(beforeTax, 0); // taxRate default 0
  return { rows, billTotal, allocation, qty, gross, retentionRate, retention, recovery, deductions, beforeTax, taxAmount, net: beforeTax + taxAmount };
})();
if (COMC.billTotal !== cents(76000) || COMC.net !== cents(54000)) throw new Error("commercial answer book: 087-COM-C's bill and IPC must follow from their rows");
const COMC_SRC = [PF("428, 699"), P(389), P(660), BADJ("Round 2 R2-B (B3)")];

// 087-COM's prime contract once every prime CO the build makes exists (builders' adjudication
// round 3, R3-3): what GET /prime-contract aggregates at the end of the prime-CO lane (after the
// RFI CO is approved, with E1 converted; before any WP-4 proof moves a CO). From the book's own
// CO leaves: approvedChangesValue sums the approved, unarchived COs (APPROVED_CHANGE_STATUSES =
// ['approved']), pendingChangesValue the draft and pending ones (PENDING_CHANGE_STATUSES =
// ['draft', 'pending']: a draft counts as pending, WP4.E2.pendingDelta), an archived row is in
// neither (archivedAt null is required, WP4.E3.archivePendingDelta) and so is a rejected one;
// revisedValue = originalValue + approvedChangesValue (prime-contract.service.js:35-37, 236-263,
// 286-307). Integer cents.
const CONTRACT_END = (() => {
  // CO-I3's value is not a leaf of its own: WP4.I3.A120LimitAmount 37,500.00 is the A120 allocation
  // 30,000.00 (stage3:109.allocation.B-002/A120) plus the CO, so the CO is 7,500.00.
  const coI3 = WP4.I3.A120LimitAmount.value - stages["stage3:109"]["allocation.B-002/A120"].value;
  if (coI3 !== cents(7500)) throw new Error("commercial answer book: CO-I3 must be WP4.I3.A120LimitAmount less the B-002/A120 allocation, 7,500.00");
  if (WP4.E4.split01_100.value + WP4.E4.split02_100.value !== WP4.E4.revisedDelta.value) throw new Error("commercial answer book: the E4 split must sum to its CO");
  const approved = [
    { co: "CO-125", status: "approved", amount: WP4.E5.approvedChangesValue.value, from: "WP4.E5.approvedChangesValue" },
    { co: "CO-SPLIT", status: "approved", amount: WP4.E4.revisedDelta.value, from: "WP4.E4.revisedDelta (split01_100 6,000.00 + split02_100 4,000.00)" },
    { co: "CO-I3", status: "approved", amount: coI3, from: "WP4.I3.A120LimitAmount - stage3:109.allocation.B-002/A120" },
    { co: "CO-RFI", status: "approved", amount: WP4.rfiCo.value.value, from: "WP4.rfiCo.value (approved: WP4.rfiCo.revisedDeltaOnApproval)" },
  ];
  const pending = [
    { co: "CO-40", status: "pending", amount: WP4.E5.pendingChangesValue.value, from: "WP4.E5.pendingChangesValue" },
    { co: "CO-E1", status: "draft", amount: WP4.E1.convertedValue.value, from: "WP4.E1.convertedValue (WP4.E1.coStatus draft; WP4.E2.pendingDelta)" },
  ];
  // Build choices (plan §3.2 asks for a prime CO in every state, no amounts): neither enters an aggregate.
  const notCounted = [
    { co: "CO-REJ", status: "rejected", amount: cents(15000), why: "rejected is in neither status set" },
    { co: "CO-ARC", status: "archived", amount: cents(3000), why: "archived: status 'archived' and archivedAt set (change-order.service.js:1687-1688), excluded by archivedAt null" },
  ];
  const sum = (rows) => rows.reduce((acc, row) => acc + row.amount, 0);
  return { approved, pending, notCounted, approvedValue: sum(approved), pendingValue: sum(pending), revisedValue: CONTRACT_ORIGINAL + sum(approved) };
})();
if (CONTRACT_END.approvedValue !== cents(147000) || CONTRACT_END.pendingValue !== cents(49500) || CONTRACT_END.revisedValue !== cents(2147000)) throw new Error("commercial answer book: 087-COM's contract end figures must follow from the CO leaves");
const CONTRACT_END_SRC = [P(387), P(643), P(646), P(647), P(658), S("prime-contract.service.js", "35-37, 236-263, 286-307"), S("change-order.service.js", "1651-1699"), BADJ("Round 3 R3-3")];
const CONTRACT_END_NOTE = "The moment is the builder's step contract.after-cos: after co.RFI's approval and ce.E1's convert, with CO-SPLIT and CO-I3 approved after IPC-10 (so WP4.E5.revisedValue 2,125,000.00 still held for IPC-02's cap, WP4.I7.retentionCap), and before any WP-4 proof moves a CO (E3's archive of CO-40, E1's convertAgain probes). The CO set is the builder's reading of plan §3.2 'prime COs in every state' plus the E1, E4, I3 and RFI specials; the figures follow from it.";

const deep = {
  "087-COM": {
    currency: fig("EGP", "ref", "Company 087 bills in EGP.", [P(361)]),
    defaultRetentionRate: state("unset", "Created WITHOUT defaultRetentionRate.", [P(387)]),
    retentionAtCreation: state("configuration required", "No silent 5%: certification waits for an explicit contract rate or 'no retention'.", [P(29), P(387)], { assumption: true, planDisagrees: true, planValue: "5% default (plan 69: 40,000 -> 2,000 / 38,000)", note: HR_C1_NOTE }),
    contractRetentionRate: fig(10, "percent", "After the I1 refusal (WP4.I1.certifyUnconfigured) the builder configures the prime contract's retentionRate explicitly at 10% (PATCH /prime-contract, contract.manage); every later 087-COM certificate (I7, I8, I10) holds 10% of its items: 10% x 97,500 = 9,750.00.", [P(387), P(662), P(663), S("prime-contract.service.js", "405-423"), ADJ("C8")], { note: "At HEAD items take the PROJECT default (unset on 087-COM, so Number(null) = 0: ipc.service.js:51-54, 779, 872) and never the contract rate; until the HR-C1 fix a proof that relies on the contract rate alone sees retention 0.00 today, and 10% is reached only by PATCHing retentionRate 10 onto each item as stage10:143 does." }),
    contractOriginal: money(CONTRACT_ORIGINAL, "Contract value established at 2,000,000.00: E5 revised 2,125,000 = original + approved 125,000.", [P(387), P(647)], { assumption: true, note: "§3.2 says only 'Contract value established'; the figure is implied by E5 and I7." }),
    contractRevisedAtI7: money(REVISED, "2,000,000 + 125,000.", [P(647), P(662)], { assumption: true }),
    retentionCapRate: fig(RET_CAP_RATE, "percent", "0.4% of revised -> 8,500.00 cap.", [P(387), P(662)], { assumption: true }),
    advance: money(ADVANCE, "Advance 200,000.00 received.", [P(387)], { assumption: true }),
    advanceRecoveryRate: fig(ADVANCE_RECOVERY_RATE, "percent", "Recovery 10% of gross.", [P(387)], { assumption: true }),
    taxRate: fig(5, "percent", "Plan names no rate; 5% is an assumption (adjudication C7), set on the contract only for I7's certification and put back to 0 before I8 and I10 are certified (see WP4.I7.taxAmount and meta.buildNotes).", [P(387), ADJ("C7")], { assumption: true }),
    boqRows: count(130, "At least 130 rows.", [P(387), P(767)]),
    boqSections: fig({ count: 3, sizes: [50, 50, 30] }, "outcome", "At least 3 sections; 50/50/30 chosen so the chunker answer is [50, 50, 30].", [P(387), P(767)], { assumption: true }),
    costTypes: count(8, "Cost codes and lines for all eight cost types.", [P(387), S("budget.service.js", "22")]),
    ipcPeriodsMin: count(4, "At least four IPC periods (paid with retention released; part-paid; submitted; draft; one PM override; one with materials on site and a deduction).", [P(387)]),
    ldRatePerDay: money(cents(1000), "ldRatePerDay set; 1,000.00 per day from WP-7 T4/T5.", [P(387), AREA], { assumption: true }),
    eotApprovedClaims: count(2, "EOT claims in every state, two of them approved (T2 + T3: cumulative 15).", [P(387), P(808)]),
    bidders: count(3, "Bid package with three bidders, award not lowest on override.", [P(387)]),
    warehouses: count(2, "Two warehouses with bins and a serial item.", [P(387)]),
    poStatuses: fig(["partial->closed (short)", "received->closed", "acknowledged", "cancelled", "from award"], "list", "POs in every status as listed.", [P(387)]),
    stateCoverage: {
      commitmentChangeOrders: fig(["draft", "pending", "approved", "rejected", "void"], "list", "'Commitment COs in every state': CO_STATUS (commitment.service.js:27-28). Reachable: pending <- draft, approved <- pending, rejected <- pending, void <- draft or pending; rejected and void need a reason (:902-904). One CO in each state at the end of the build.", [P(387), S("commitment.service.js", "27-28, 902-904"), ADJ("C8")], { assumption: true, note: "One record per state is this book's minimum reading of 'every state'." }),
      payApplications: fig(["draft", "submitted", "under_review", "approved", "paid", "rejected", "void"], "list", "'Pay applications in every state': STATUS (sub-pay-app.service.js:22). Reachable: submitted <- draft; under_review <- submitted; approved and rejected <- submitted or under_review; draft <- rejected or approved (revocation, a reason when certified); void <- draft, rejected or approved (:761-770); paid by a payment reaching net - 0.01 (:1036-1037). Plus the plan's specials: one revoked and re-certified (certificationRevision 1, WP4.P3), one paid, one final at the closeout gate (WP4.P6).", [P(387), S("sub-pay-app.service.js", "22, 761-771, 1036-1037"), ADJ("C8")], { assumption: true, note: "One record per state is this book's minimum reading of 'every state'." }),
      primeChangeOrders: fig(["draft", "pending", "approved", "rejected", "archived"], "list", "'Prime COs in every state': CHANGE_ORDER_STATUSES (change-order.service.js:76-82; archived is archive-policy's ARCHIVED_STATUS). Among them the plan's specials: one with a split budget allocation (WP4.E4), one with allocation links on a split BOQ row (WP4.I3), one from an RFI (WP4.rfiCo).", [P(387), S("change-order.service.js", "76-82, 1651-1699"), ADJ("C8")], { assumption: true, note: "One record per state is this book's minimum reading of 'every state'." }),
      eotClaims: fig(["draft", "submitted", "approved", "rejected"], "list", "'EOT claims in every state, two of them approved, one linked to a weather delay': EotClaim.status draft, submitted, approved, rejected (schema.prisma:2874); transitions draft -> submitted, rejected -> submitted, submitted -> approved, submitted -> rejected (eot.service.js:267-272). Two approved (WP7.T2 + T3, cumulative 15).", [P(387), P(808), S("eot.service.js", "259-286"), "backend/prisma/schema.prisma:2874 @" + HEAD, ADJ("C8")], { assumption: true, note: "Counts: at least one per state and two approved." }),
      directCostsTypeByState: fig(
        ["invoice", "expense", "payroll", "other"].flatMap((type) => ["draft", "pending", "approved", "paid", "void"].map((status) => `${type}:${status}`)),
        "list",
        "'Direct costs of every type and state': TYPES invoice, expense, payroll, other x STATUS draft, pending, approved, paid, void (direct-cost.service.js:20-21) = 4 x 5 = 20 cells. The type never gates a transition: submit (:430-438), approve (:478-483), void (:546-557) and pay (:579-603) test the status, the lines and their coding, the payments, the amounts and the void reason, never the type, so every cell is reachable. The type is read once, by approveDirectCost at :488 (costType = line.costType || DEFAULT_COST_TYPE[type] || 'other', DEFAULT_COST_TYPE at :23: invoice -> material, expense -> indirect, payroll -> labour, other -> other), to set the cost type, and with it the budget line (:489, :446-450), of each posting whose line names no cost type. Paid needs payments reaching the total (:603) and a paid cost cannot be voided (DIRECT_COST_HAS_PAYMENTS, :549), so each void cell is reached from draft, pending or approved.",
        [P(387), S("direct-cost.service.js", "20-23, 430-610"), ADJ("C8")],
        { assumption: true, note: "One record per cell is this book's minimum reading of 'every type and state'." }
      ),
    },
    supplierInvoiceVoidedAfterApproval: {
      approvePosts: money(cents(1000), "A supplier invoice (direct cost of type invoice) with one 1,000.00 line on a service PO line (no inventory item, so it is not capitalised: direct-cost.service.js:468-476) is approved: one ledger entry +1,000.00, sourceType direct_cost, key direct_cost:<invoiceId>:<lineId> (:499-514, cost-ledger.service.js:113-114).", [P(387), S("direct-cost.service.js", "468-516"), S("cost-ledger.service.js", "113-114"), ADJ("C8")], { assumption: true, note: "§3.2 gives no amount; one 1,000.00 service line is this book's choice. A line on a stocked PO line is capitalised (postedAmount 0, no entry) and its void writes no mirror." }),
      voidMirror: money(-cents(1000), "Void after approval (with a reason, no payments) reverses each posted entry with a negative mirror: -1,000.00, key reversal:<originalEntryId>, reversalOfId = the original, same activity, cost code, budget line and cost type (cost-ledger.service.js:377-429); the line's postedAmount returns to 0 (direct-cost.service.js:561-568).", [P(387), S("direct-cost.service.js", "546-577"), S("cost-ledger.service.js", "377-429"), ADJ("C8")], { assumption: true }),
      entries: count(2, "The original posting and its mirror both stay on the ledger (mirrors are written, never deleted).", [S("cost-ledger.service.js", "373-376"), ADJ("C8")], { assumption: true }),
      sourceNet: money(0, "+1,000.00 - 1,000.00 = 0.00 net for the invoice; a second void answers 409 DIRECT_COST_LOCKED (:548) and reversing twice writes nothing (:393-397).", [S("direct-cost.service.js", "548"), S("cost-ledger.service.js", "393-397"), ADJ("C8")], { assumption: true }),
    },
    // IPC-04, certified last (after IPC-08): I6's overage on a PM override with the advance recovery in force.
    ipc04: {
      order: fig({ certifies: "last, after IPC-08", override: "PM with a reason (WP4.I6.pmWithReason)", recoveredBefore: ["IPC-08"], notCertifiedBefore: ["IPC-09 (submitted)", "IPC-10 (draft)"] }, "outcome", "IPC-04 carries I6 (WP4.I6) and is certified last, after IPC-08, the first certificate with the advance recovery on: a PM override with a reason, the other I6 answers (400 without a reason, 403 for finance) asserted before it.", IPC04_SRC, { assumption: true, note: IPC04_NOTE }),
      quantity: fig(IPC04.qty, "m3", `A130 this period: the cumulative claim of WP4.I6.claimed (${IPC04.claimedQty} m3) less the ${IPC04.ipc03Qty} m3 IPC-03 certified inside WP4.I8's gross (A130 ${IPC04.ipc03Qty} m3 x 150.00 = 22,500.00 = WP4.I6.earnedCap) = ${IPC04.claimedQty} - ${IPC04.ipc03Qty} = ${IPC04.qty} m3.`, IPC04_SRC, { assumption: true }),
      gross: money(IPC04.gross, `${IPC04.qty} m3 x ${IPC04.rate}.00 = 7,500.00, the certificate's only item (no materials on site: those are IPC-07's). The whole of it is over earned: cumulative 30,000.00 (WP4.I6.claimed) - earned 22,500.00 (WP4.I6.earnedCap) = 7,500.00 = WP4.I6.overCertificationAmount.`, IPC04_SRC, { assumption: true }),
      overCertificationAmount: money(IPC04.over, "max(over approved limit 0, over earned 30,000.00 - 22,500.00) = 7,500.00, stored on IPC-04 at certification (WP4.I6.overCertificationAmount).", [...IPC04_SRC, S("ipc.service.js", "543-583, 1434-1437")], { assumption: true }),
      retention: money(IPC04.retention, "10% x 7,500.00 = 750.00: 087-COM's items hold 10% (deep.087-COM.contractRetentionRate; at HEAD through the item PATCH, finding L114), and no cap applies because retentionCapRate is configured only for IPC-02 (I7's cap): with the cap still on, the room after IPC-02 is 8,500.00 - retention already certified <= 0, retention 0.00 and the net would be 6,750.00.", [...IPC04_SRC, S("prime-contract.service.js", "659-667")], { assumption: true }),
      advanceOutstandingBefore: money(IPC04.outstanding, "Advance 200,000.00 (deep.087-COM.advance) less what certified certificates have recovered before IPC-04: IPC-08's 9,750.00 (WP4.I7.advanceRecovery, 10% x 97,500.00); IPC-09 (submitted) and IPC-10 (draft) lock nothing (recovery is written at certification, prime-contract.service.js:694-701) = 190,250.00 (as WP4.I10.preconditions has it).", [...IPC04_SRC, S("prime-contract.service.js", "669-674, 694-701")], { assumption: true }),
      advanceRecovery: money(IPC04.recovery, "min(outstanding 190,250.00, 10% (deep.087-COM.advanceRecoveryRate) x gross 7,500.00 = 750.00) = 750.00.", [...IPC04_SRC, S("prime-contract.service.js", "669-674")], { assumption: true }),
      deductions: money(IPC04.deductions, "None on IPC-04 (the 1,000.00 deduction is IPC-09's).", IPC04_SRC, { assumption: true }),
      taxAmount: money(IPC04.taxAmount, "taxRate is back to 0 after IPC-05 (I7's 5%, adjudication C7; deep.087-COM.taxRate): 0% x 6,000.00 = 0.00.", [...IPC04_SRC, ADJ("C7")], { assumption: true }),
      net: money(IPC04.net, "certificateFinancials: gross 7,500.00 - retention 750.00 - advance recovery 750.00 - deductions 0.00 = beforeTax 6,000.00; + tax 0.00 = netPayable 6,000.00, which includes the 750.00 recovery.", IPC04_SRC, { assumption: true, note: IPC04_NOTE }),
    },
    // IPC-09, submitted, with the deduction (builders' adjudication round 2, R2-B B2; 087-COM item 2).
    ipc09: {
      status: state("submitted", "Left submitted (plan §3.2 'submitted'; deep.087-COM.ipc04.order.notCertifiedBefore 'IPC-09 (submitted)'): the QS submits it after the deduction; nobody certifies it in the build (WP4-OVR-1 is observed without certifying).", IPC0910_SRC, { assumption: true }),
      quantity: fig(IPC0910.ipc09.qty, "m2", `B-004 on A310 this period: ${IPC0910.ipc09.qty} m2, the certificate's only claimed item (a build choice). Within earned: allocation B-004/A310 135,000.00 (stage3:109.allocation.B-004/A310) at A310's 50% approved (the basis of WP4.P2.progressCap) = 67,500.00 >= 22,500.00, and no earlier 087-COM certificate claims A310.`, IPC0910_SRC, { assumption: true, note: IPC0910_NOTE }),
      gross: money(IPC0910.ipc09.gross, `${IPC0910.ipc09.qty} m2 x ${IPC0910.ipc09.rate}.00 (B-004's rate) = 22,500.00 = totalCert = grossThisPeriod (no materials on site: those are IPC-07's, WP4.I10).`, IPC0910_SRC, { assumption: true }),
      retention: money(IPC0910.ipc09.retention, "10% x 22,500.00 = 2,250.00: the item at deep.087-COM.contractRetentionRate 10 (at HEAD through the item PATCH, finding L114); no cap, because retentionCapRate is set for IPC-02 only (deep.087-COM.ipc04.retention), so certificateFinancials keeps the item retention.", [...IPC0910_SRC, S("prime-contract.service.js", "659-667")], { assumption: true }),
      advanceOutstandingBefore: money(IPC0910.ipc09.outstanding, "deep.087-COM.ipc04.advanceOutstandingBefore 190,250.00 less IPC-04's deep.087-COM.ipc04.advanceRecovery 750.00 = 189,500.00 = advancePaidAmount - advanceRecoveredAmount (prime-contract.service.js:539-540): advance 200,000.00 (deep.087-COM.advance) less the recoveries locked by the two certificates certified before it (IPC-08 9,750.00, WP4.I7.advanceRecovery; IPC-04 750.00).", [...IPC0910_SRC, S("prime-contract.service.js", "539-540, 669-674")], { assumption: true }),
      advanceRecovery: money(IPC0910.ipc09.recovery, "min(outstanding 189,500.00, 10% (deep.087-COM.advanceRecoveryRate) x gross 22,500.00 = 2,250.00) = 2,250.00.", [...IPC0910_SRC, S("prime-contract.service.js", "669-674")], { assumption: true }),
      deductions: money(IPC0910.ipc09.deductions, "1,000.00 with a note (a deduction without one is refused: WP4.I7.deductionWithoutNote, the same 1,000.00): the plan's 'materials on site with a deduction' puts the deduction on IPC-09, kept off IPC-07 by WP4.I10.preconditions (builders' adjudication 087-COM item 2).", [...IPC0910_SRC, S("ipc.service.js", "1119-1135")], { assumption: true }),
      taxAmount: money(IPC0910.ipc09.taxAmount, "taxRate back to 0 after IPC-05 (adjudication C7; deep.087-COM.taxRate): 0% x 17,000.00 = 0.00.", [...IPC0910_SRC, ADJ("C7")], { assumption: true }),
      net: money(IPC0910.ipc09.net, "certificateFinancials: gross 22,500.00 - retention 2,250.00 - advance recovery 2,250.00 - deductions 1,000.00 = beforeTax 17,000.00; + tax 0.00 = netPayable 17,000.00 (the figure the submitted certificate shows; recomputed at certification, ipc.service.js:1417).", IPC0910_SRC, { assumption: true, note: IPC0910_NOTE }),
    },
    // IPC-10, a draft (builders' adjudication round 2, R2-B B2).
    ipc10: {
      status: state("draft", "Left a draft (plan §3.2 'draft'; deep.087-COM.ipc04.order.notCertifiedBefore 'IPC-10 (draft)'): its figures are the draft preview.", IPC0910_SRC, { assumption: true }),
      quantity: fig(IPC0910.ipc10.qty, "m2", `B-005 on A320 this period: ${IPC0910.ipc10.qty} m2, the only claimed item (a build choice). Within earned: allocation B-005/A320 72,000.00 (stage3:109.allocation.B-005/A320) at A320's approved progress (100% on 087-COM, a build choice that SC-004's PA-02 needs; any approval of 25% or more keeps 18,000.00 within earned), and no earlier 087-COM certificate claims A320.`, IPC0910_SRC, { assumption: true, note: IPC0910_NOTE }),
      gross: money(IPC0910.ipc10.gross, `${IPC0910.ipc10.qty} m2 x ${IPC0910.ipc10.rate}.00 (B-005's rate) = 18,000.00 = totalCert = grossThisPeriod (no materials on site).`, IPC0910_SRC, { assumption: true }),
      retention: money(IPC0910.ipc10.retention, "10% x 18,000.00 = 1,800.00 (deep.087-COM.contractRetentionRate; no cap, as for IPC-09).", [...IPC0910_SRC, S("prime-contract.service.js", "659-667")], { assumption: true }),
      advanceOutstandingBefore: money(IPC0910.ipc10.outstanding, "189,500.00, the same as IPC-09's (deep.087-COM.ipc09.advanceOutstandingBefore): IPC-09 is submitted, not certified, and recovery is locked only at certification (prime-contract.service.js:694-732), so it takes nothing off the advance.", [...IPC0910_SRC, S("prime-contract.service.js", "539-540, 694-732")], { assumption: true }),
      advanceRecovery: money(IPC0910.ipc10.recovery, "min(outstanding 189,500.00, 10% x gross 18,000.00 = 1,800.00) = 1,800.00.", [...IPC0910_SRC, S("prime-contract.service.js", "669-674")], { assumption: true }),
      deductions: money(IPC0910.ipc10.deductions, "None on IPC-10 (the deduction is IPC-09's).", IPC0910_SRC, { assumption: true }),
      taxAmount: money(IPC0910.ipc10.taxAmount, "taxRate 0 (adjudication C7): 0% x 14,400.00 = 0.00.", [...IPC0910_SRC, ADJ("C7")], { assumption: true }),
      net: money(IPC0910.ipc10.net, "certificateFinancials: gross 18,000.00 - retention 1,800.00 - advance recovery 1,800.00 - deductions 0.00 = beforeTax 14,400.00; + tax 0.00 = netPayable 14,400.00 (the draft preview).", IPC0910_SRC, { assumption: true, note: IPC0910_NOTE }),
    },
    // The prime contract at the end of the prime-CO lane (builders' adjudication round 3, R3-3).
    contractEnd: {
      approvedChanges: fig(CONTRACT_END.approved, "list", "The approved, unarchived prime COs on 087-COM once the lane is complete, each at the book's amount: CO-125 125,000.00 (WP4.E5.approvedChangesValue), CO-SPLIT 10,000.00 (WP4.E4.revisedDelta = split01_100 6,000.00 + split02_100 4,000.00), CO-I3 7,500.00 (WP4.I3.A120LimitAmount 37,500.00 less the B-002/A120 allocation 30,000.00, stage3:109.allocation.B-002/A120) and CO-RFI 4,500.00 (WP4.rfiCo.value, approved). APPROVED_CHANGE_STATUSES is ['approved'] and the aggregate takes archivedAt null rows only (prime-contract.service.js:35, 290); nothing else on 087-COM is approved.", CONTRACT_END_SRC, { assumption: true, note: CONTRACT_END_NOTE }),
      pendingChanges: fig(CONTRACT_END.pending, "list", "The draft and pending prime COs: CO-40 40,000.00, pending (WP4.E5.pendingChangesValue), and E1's convert, created as a draft of 9,500.00 (WP4.E1.convertedValue; WP4.E1.coStatus draft). PENDING_CHANGE_STATUSES is ['draft', 'pending'] (prime-contract.service.js:37, 294; WP4.E2.pendingDelta: a draft counts as pending); nothing else on 087-COM is a draft or pending.", CONTRACT_END_SRC, { assumption: true, note: CONTRACT_END_NOTE }),
      notCounted: fig(CONTRACT_END.notCounted, "list", "CO-REJ (rejected) and CO-ARC (archived: status 'archived' with archivedAt set, change-order.service.js:1687-1688) are in neither aggregate: rejected is in neither status set, and an archived row fails the archivedAt null condition (prime-contract.service.js:290, 294; WP4.E3.archivePendingDelta). Their amounts, 15,000.00 and 3,000.00, are the builder's: plan §3.2 asks only for a prime CO in every state.", CONTRACT_END_SRC, { assumption: true, note: "The two amounts are build choices, carried so the row set is named in full; they enter no aggregate." }),
      approvedChangesValue: money(CONTRACT_END.approvedValue, "Sum of approvedChanges: 125,000.00 + 10,000.00 + 7,500.00 + 4,500.00 = 147,000.00 (the SUM of value over status approved and archivedAt null, prime-contract.service.js:288-291, 299).", CONTRACT_END_SRC, { assumption: true, note: CONTRACT_END_NOTE }),
      pendingChangesValue: money(CONTRACT_END.pendingValue, "Sum of pendingChanges: 40,000.00 + 9,500.00 = 49,500.00 (the SUM of value over status draft or pending and archivedAt null, prime-contract.service.js:292-295, 300). WP4.E5.pendingChangesValue (40,000.00) holds at its own moment only, before E1 is converted (its note; the builder asserts it at contract.after-CO-125).", CONTRACT_END_SRC, { assumption: true, note: CONTRACT_END_NOTE }),
      revisedValue: money(CONTRACT_END.revisedValue, "originalValue 2,000,000.00 (deep.087-COM.contractOriginal) + approvedChangesValue 147,000.00 = 2,147,000.00 (addMoney(originalValue, approvedChangesValue), prime-contract.service.js:263, 307). It supersedes WP4.E5.revisedValue 2,125,000.00, which holds from CO-125's approval until CO-SPLIT, CO-I3 and CO-RFI are approved (after IPC-10), so IPC-02's cap (WP4.I7.retentionCap, 0.4% x 2,125,000.00) is unaffected.", CONTRACT_END_SRC, { assumption: true, note: CONTRACT_END_NOTE }),
    },
  },
  "087-COM-B": {
    projectRetention: fig(7.5, "percent", "Project defaultRetentionRate 7.5% (adjudication C3), so a commitment without a rate takes 7.5 (WP4.C3.projectDefault).", [P(388), P(652), ADJ("C3")], { note: "Corrected in the plan in WP-0: the first draft of §3.2 had the cell swapped ('Project retention 10%, prime contract 7.5%'); the working-tree plan now reads 'Project retention 7.5% and prime contract 10%', as the integration owner decided (adjudication C3), so the plan and this book agree." }),
    primeContractRetention: fig(10, "percent", "Prime contract retentionRate 10%, set explicitly (adjudication C3), so authoritative under HR-C1 (WP4.I2: 4,000.00 / 36,000.00).", [P(388), P(657), P(29), ADJ("C3")], { note: "Corrected in the plan in WP-0 (same §3.2 cell, now 'Project retention 7.5% and prime contract 10%'). ensureContract first copies the project default 7.5 onto the contract (prime-contract.service.js:264-266); the builder then PATCHes retentionRate 10." }),
    ipcItemRetention: fig(10, "percent", "HR-C1: the contract rate first (10), else the explicit project default.", [P(29), P(1029), P(657), ADJ("C3")], { today: 7.5, note: "today the items take the project default 7.5 (ipc.service.js:51-54, 779, 872): see WP4.I2." }),
    poRefCollision: fig("PO-00001", "ref", "Its first PO number collides with 087-COM's PO-00001 (counters are per project).", [P(388), P(719)]),
  },
  "087-COM-C": {
    valueSource: state("boq_fallback", "Contract value only from the BOQ fallback.", [P(389), S("prime-contract.service.js", "215-220")]),
    certifyGate: err(409, "CONTRACT_VALUE_NOT_ESTABLISHED", "Certify is refused until the value is entered or confirmed.", [P(389), P(660), S("ipc.service.js", "1288")]),
    // The bill the fallback takes and IPC-01 left at the gate (builders' adjudication round 2, R2-B B3).
    billRows: fig(COMC.rows, "list", "Two rows: B-001 as the book's bill (BOQ['B-001']: 5,000 m3 x 12.00, required, allocated whole to A110 as stage3:109.allocation.B-001/A110) and B-006, an optional disposal row the builder adds and leaves unallocated, so the bill total (the fallback value) differs from the one allocation. Plan §3.2 gives 087-COM-C no bill; the rows are build choices.", COMC_SRC, { assumption: true }),
    billTotal: money(COMC.billTotal, "Sum of the active rows' amounts: 5,000 x 12.00 + 2,000 x 8.00 = 60,000.00 + 16,000.00 = 76,000.00. It is the contract's originalValue on the BOQ fallback: the project carries no contractValue, so the prime contract's first read (after the bill is uploaded) records originalValue = the aggregate of the active BOQ items' amount = 76,000.00 with originalValueSource boq_fallback (prime-contract.service.js:201-220; deep.087-COM-C.valueSource).", [...COMC_SRC, S("prime-contract.service.js", "201-220")], { assumption: true }),
    ipc01: {
      quantity: fig(COMC.qty, "m3", "IPC-01's only item is the one approved allocation, B-001/A110 (5,000 m3, 60,000.00); A110 approved at 100% (build choice), so the whole 5,000 m3 is within earned. B-006 is unallocated and gives no item.", COMC_SRC, { assumption: true }),
      gross: money(COMC.gross, "5,000 m3 x 12.00 = 60,000.00 = totalCert (no materials on site).", COMC_SRC, { assumption: true }),
      retentionRate: fig(COMC.retentionRate, "percent", "The project is created with an explicit defaultRetentionRate 10 (HR-C1: no silent rate; 10% as on 087-COM). The items take the project default (ipc.service.js:51-54, 779, 872) and so does the contract created on the first read (prime-contract.service.js:264-266): 10 on both, so HEAD needs no item PATCH here (no L114 gap).", [...COMC_SRC, P(29), S("ipc.service.js", "51-54, 779, 872, 934-938"), S("prime-contract.service.js", "264-266")], { assumption: true }),
      retention: money(COMC.retention, "10% x 60,000.00 = 6,000.00 (no cap: retentionCapRate null by default, schema.prisma:2535).", [...COMC_SRC, S("ipc.service.js", "934-938"), S("prime-contract.service.js", "659-667"), "backend/prisma/schema.prisma:2535 @" + HEAD], { assumption: true }),
      advanceRecovery: money(COMC.recovery, "No advance: advancePaidAmount 0 by default (schema.prisma:2538), outstanding 0 (prime-contract.service.js:539-540), so recovery = min(0, ...) = 0.00.", [...COMC_SRC, S("prime-contract.service.js", "539-540, 669-674"), "backend/prisma/schema.prisma:2538, 2540 @" + HEAD], { assumption: true }),
      deductions: money(COMC.deductions, "None.", COMC_SRC, { assumption: true }),
      taxAmount: money(COMC.taxAmount, "taxRate 0 by default (schema.prisma:2544): 0.00.", [...COMC_SRC, "backend/prisma/schema.prisma:2544 @" + HEAD], { assumption: true }),
      net: money(COMC.net, "certificateFinancials: 60,000.00 - 6,000.00 - 0.00 - 0.00 = 54,000.00 + tax 0.00 = 54,000.00 on the draft and on the submitted certificate; the certify gate then refuses it (deep.087-COM-C.certifyGate) and it stays submitted for the I5 proof.", [...COMC_SRC, S("prime-contract.service.js", "649-692")], { assumption: true }),
    },
  },
  // D3 is company 006 Atlas Infrastructure (plan §3.1 'WP-0 choice of D3', §3.2 'D3, company 006';
  // adjudication E). The key is a label only: it was "D3-LITE" here, and the plan's lane was
  // first drafted as 011-LITE (011 stays for Individual-plan and entitlement cases).
  "006-LITE": {
    retentionDefaultCase: refusal(HR_C1_REFUSAL_RULE, "006-LITE's unconfigured-retention IPC, asserted first: with no configured retention no certificate settles at a silent rate (HR-C1); the refusing step and code are the fix's choice.", [P(409), P(29), ADJ("C2")], { note: `Corrected in the plan in WP-0: the first draft certified this IPC at the 5% default; §3.2 'D3, company 006' now creates the project with explicit retention per HR-C1 and makes 'Retention left unconfigured' the refusal case, asserted first, so the plan and this book agree. ${HR_C1_NOTE} ${HR_C1_REFUSAL_NOTE}` }),
    ipcAfterConfiguration: {
      retentionRate: fig(10, "percent", "Retention configured explicitly after the refusal (adjudication C8, and E: 'retention is explicit'); 10% chosen to match 087-COM and 052-COM.", [P(409), ADJ("C8")], { assumption: true, note: "The adjudication fixes that retention is explicit, not its rate." }),
      gross: money(cents(60000) + pctOf(cents(30000), 50) + pctOf(cents(90000), 25), "Items at the lane's approved progress (WP-3 T1: A110 100%, A120 50%, A130 25%) on its allocations: 60,000 + 50% x 30,000 + 25% x 90,000 = 60,000 + 15,000 + 22,500 = 97,500.00 (AED: D3 is company 006 Atlas Infrastructure, adjudication E).", [P(409), P(598), ADJ("C8")], { assumption: true, note: "Assumes the IPC certifies every allocated item up to approved progress, as schedule.js D3.WP3.T1 assumes the 087-EV approvals; the contract value must be established first (I5 gate: the PM enters or confirms it)." }),
      retention: money(pctOf(cents(97500), 10), "10% x 97,500.00 = 9,750.00 held.", [P(409), ADJ("C8")], { assumption: true, today: 0, note: "today 0.00 if the rate is configured on the contract only: HEAD reads the project default (unset -> Number(null) = 0; ipc.service.js:51-54, 779, 872)." }),
      net: money(cents(97500) - pctOf(cents(97500), 10), "97,500.00 - 9,750.00 = 87,750.00 (no cap, advance, deduction or tax).", [P(409), ADJ("C8")], { assumption: true, today: cents(97500) }),
      amountPaid: money(cents(97500) - pctOf(cents(97500), 10), "Finance records 87,750.00 against the issued invoice (payment needs an issued invoice, WP4.I4).", [P(409), ADJ("C8")], { assumption: true }),
      endState: fig({ status: "paid", paymentStatus: "paid", retentionStatus: "held", balanceDue: 0, submittedBy: "qs", certifiedBy: "pm", paidBy: "finance" }, "outcome", "Submitted by the QS, certified by the PM, invoiced, paid in full by finance: status paid, paymentStatus paid, balanceDue 0.00 (ipc.service.js:292-357), with the 9,750.00 retention still held (no release in this lane).", [P(409), S("ipc.service.js", "292-357, 1445"), ADJ("C8")], { assumption: true, note: "Actors per adjudication E (the D3 lane); the finance member is invited with the D-ID-1 helper." }),
    },
    certifierRole: err(403, "FORBIDDEN", "The QS submits and the PM certifies (plan §3.2 'D3, company 006': period.certify is PM and finance only), so a QS certify is refused.", [P(409), "shared/permissions.json modules.ipc.transitions['period.certify'] @" + HEAD], { note: "Corrected in the plan in WP-0: the first draft said 'certified by the QS or PM'; the working-tree plan now has the QS submit and the PM certify, so the plan and this book agree. Only the PM (or finance) can certify at HEAD." }),
  },
};

// 052-COM runs the same answers in USD (plan 404): mirror the named tests.
function mirrorFigures(node, note) {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "unit") && Object.prototype.hasOwnProperty.call(value, "derivation")) {
      out[key] = { ...value, derivation: `${value.derivation} ${note}`, source: `${value.source}; ${P(404)}` };
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = mirrorFigures(value, note);
    }
  }
  return out;
}
const USD = "[052-COM: same answer; money is USD cents.]";
deep["052-COM"] = {
  currency: fig("USD", "ref", "Company 052 bills in USD.", [P(361)]),
  contractRetentionRate: fig(10, "percent", "As 087-COM: after the I1 refusal the prime contract's retentionRate is configured explicitly at 10%, so 052-COM's I8 certifies 97,500.00 - 9,750.00 = 87,750.00 (USD).", [P(404), P(663), ADJ("C8")], { note: "At HEAD items read the project default, never the contract rate (ipc.service.js:51-54, 779, 872); see deep.087-COM.contractRetentionRate." }),
  I1: mirrorFigures(WP4.I1, `${USD} Assumes 052-COM is also created without defaultRetentionRate.`),
  I3: mirrorFigures(WP4.I3, USD),
  I4: mirrorFigures(WP4.I4, USD),
  I8: mirrorFigures(WP4.I8, USD),
  P3: mirrorFigures(WP4.P3, USD),
  P4: mirrorFigures(WP4.P4, USD),
  E1: mirrorFigures(WP4.E1, USD),
  E2: mirrorFigures(WP4.E2, USD),
  C1: mirrorFigures(WP4.C1, USD),
  C2: mirrorFigures(WP4.C2, USD),
  O2: mirrorFigures(WP5.O2, USD),
};

// 052-COM's IPC-03, left submitted for the I4 refusals (builders' adjudication round 3, R3-1): the
// third certificate (IPC-01 the I1 draft, IPC-02 the I8 certificate, paid). From the book's own keys:
// the B-001 row (BOQ: 5,000 m3 x 12.00) allocated whole to A110 (ALLOC, stage3:109.allocation.B-001/A110,
// 60,000.00), the explicit contract rate (deep["052-COM"].contractRetentionRate 10, at HEAD reached
// through the item PATCH, finding L114), and no cap, advance, deduction or tax on 052-COM. Totals are
// recomputeCertificateTotals' (ipc.service.js:108-175) through certificateFinancials
// (prime-contract.service.js:649-692), here in integer USD cents.
const COM052_IPC03 = (() => {
  const boq = "B-001";
  const activity = "A110";
  const qty = 1000; // 1,000 of the row's 5,000 m3: a build choice, plan §3.2 fixes only a submitted certificate
  const rate = BOQ[boq].rate; // 12.00
  const gross = cents(qty * rate); // 12,000.00
  const allocation = ALLOC[`${boq}/${activity}`]; // the whole row, 60,000.00
  const approvedPct = 100; // 052-COM approves A110 at 100% (as WP-3 T1's A110 on 087-COM)
  const earned = pctOf(allocation, approvedPct);
  // Within earned, or the item PATCH refuses (IPC_APPROVED_PROGRESS_EXCEEDED, WP4.I6.setupObstacle); no
  // earlier 052-COM certificate claims B-001/A110 (IPC-01 is on C-001/A220, IPC-02 on D-001/A200).
  if (!(gross <= earned)) throw new Error("commercial answer book: 052-COM's IPC-03 claim must sit within earned");
  const retentionRate = deep["052-COM"].contractRetentionRate.value; // 10
  const retention = pctOf(gross, retentionRate); // 1,200.00
  const recovery = 0; // no advance on 052-COM: advancePaidAmount 0 by default, outstanding 0
  const deductions = 0;
  const beforeTax = gross - retention - recovery - deductions;
  const taxAmount = pctOf(beforeTax, 0); // taxRate 0 (default, and set explicitly with the retention rate)
  return { boq, activity, qty, rate, gross, allocation, approvedPct, earned, retentionRate, retention, recovery, deductions, beforeTax, taxAmount, net: beforeTax + taxAmount };
})();
if (COM052_IPC03.net !== cents(10800)) throw new Error("commercial answer book: 052-COM's IPC-03 net must follow from its keys");
const COM052_IPC03_SRC = [P(404), P(659), S("ipc.service.js", "108-175, 934-938"), S("prime-contract.service.js", "649-692"), "backend/prisma/schema.prisma:2535, 2538, 2544 @" + HEAD, BADJ("Round 3 R3-1")];
const COM052_IPC03_NOTE = "The quantity (1,000 m3 of B-001 on A110) is a build choice: plan §3.2 fixes only that 052-COM carries the I4 refusal states (IPC-01 draft, IPC-02 paid, IPC-03 submitted). The figures follow from it and the book's rate, allocation and contract terms.";
deep["052-COM"].ipc03 = {
  status: state("submitted", "Left submitted by the QS, never certified: the state WP4.I4's submitTwice, patchAfterSubmit and invoiceBeforeCertify are probed on (with IPC-01 a draft for certifyDraft and IPC-02 paid).", COM052_IPC03_SRC, { assumption: true, note: COM052_IPC03_NOTE }),
  quantity: fig(COM052_IPC03.qty, "m3", `B-001 on A110 this period: ${COM052_IPC03.qty} m3, the certificate's only claimed item. Within earned: allocation B-001/A110 60,000.00 (stage3:109.allocation.B-001/A110, the whole row) at A110's 100% approved = 60,000.00 >= 12,000.00, and no earlier 052-COM certificate claims B-001/A110.`, COM052_IPC03_SRC, { assumption: true, note: COM052_IPC03_NOTE }),
  gross: money(COM052_IPC03.gross, `${COM052_IPC03.qty} m3 x ${COM052_IPC03.rate}.00 (B-001's rate, BOQ) = 12,000.00 = totalCert = grossThisPeriod (no materials on site). USD.`, COM052_IPC03_SRC, { assumption: true }),
  retentionRate: fig(COM052_IPC03.retentionRate, "percent", "deep[\"052-COM\"].contractRetentionRate 10, configured explicitly on the prime contract after the I1 case (step contract.retention). At HEAD the item is created at the project default (unset -> 0: ipc.service.js:51-54, 779, 872) and reaches 10 only through the item PATCH (retentionRate kept by :934-935; finding L114), as every configured 052-COM claim does.", [...COM052_IPC03_SRC, P(29), S("ipc.service.js", "51-54, 779, 872, 934-938")], { assumption: true }),
  retention: money(COM052_IPC03.retention, "10% x 12,000.00 = 1,200.00 (item retention = currentCert x rate / 100, ipc.service.js:938); no cap: retentionCapRate is null by default (schema.prisma:2535) and 052-COM never configures one, so certificateFinancials keeps the item retention (prime-contract.service.js:659-667).", [...COM052_IPC03_SRC, S("prime-contract.service.js", "659-667")], { assumption: true }),
  advanceRecovery: money(COM052_IPC03.recovery, "No advance on 052-COM: advancePaidAmount 0 by default (schema.prisma:2538), outstanding 0 (prime-contract.service.js:539-540), so recovery = min(0, 10% x 12,000.00) = 0.00.", [...COM052_IPC03_SRC, S("prime-contract.service.js", "539-540, 669-674")], { assumption: true }),
  deductions: money(COM052_IPC03.deductions, "None on IPC-03 (052-COM carries no deduction; the plan's deduction is 087-COM IPC-09's).", COM052_IPC03_SRC, { assumption: true }),
  taxAmount: money(COM052_IPC03.taxAmount, "taxRate 0: the schema default (schema.prisma:2544), and set to 0 explicitly with the retention rate (step contract.retention); 0% x 10,800.00 = 0.00.", [...COM052_IPC03_SRC, S("prime-contract.service.js", "676-690")], { assumption: true }),
  net: money(COM052_IPC03.net, "certificateFinancials: gross 12,000.00 - retention 1,200.00 - advance recovery 0.00 - deductions 0.00 = beforeTax 10,800.00; + tax 0.00 = netPayable 10,800.00, on the draft and on the submitted certificate (totals are recomputed on every draft item edit, ipc.service.js:908-914, 1024, and are not moved by the submit).", COM052_IPC03_SRC, { assumption: true, note: COM052_IPC03_NOTE }),
};

// CLAUDE.md rules in this section's scope (plan 61-72)
const claudeMd = {
  retentionDefault: fig("configuration required (no silent 5%)", "rule", "CLAUDE.md 'Retention default 5% of certified value per IPC period' is superseded for unconfigured projects by HR-C1; an explicitly configured 5% still gives 40,000 -> 2,000 / 38,000.", [P(69), P(29)], { planDisagrees: true, planValue: "40,000 -> retention 2,000, net 38,000", assumption: true, note: HR_C1_NOTE }),
  weather70: fig({ "13/20": [65, false], "14/20": [70, true] }, "rule", "Warning at >= 70% of the contractual allowance.", [P(70), P(815)]),
  boqChunk: fig({ 130: [60, 60, 10], "50/50/30": [50, 50, 30], "70/45": [60, 55] }, "rule", "BOQ > 60 rows chunked by section, max 60 per batch (chunkBoqRows).", [P(67), S("schedule.service.js", "1865-1891")]),
};

// ─── the tree and its flattening ──────────────────────────────────────────────────────────────

const answers = {
  meta: {
    section: "commercial",
    head: HEAD,
    plan: PLAN,
    planNote: "Line numbers are the working-tree plan (HEAD b0ec5b0 + the Q-KEY line 36).",
    calc: "C:/Temp/octapm-cert/scratch/wp0/commercial-calc.js",
    moneyUnit: "integer cents of the project currency",
    orderingAssumptions: [
      "E5, CF1 and B3 project totals hold only where no other live record moves them (087-COM carries many); read them as deltas or on a project where only the named records exist.",
      "I7's 8,500 cap needs revised = 2,125,000 and no earlier certified retention on the contract; its 78,000 net needs the cap off for that certificate.",
      "I3 needs A130 with no earlier certified amount; I6 (A130 at 25%) and I3 (A130 at 100%) cannot share one project unless I3 runs first, because progress may not be lowered silently (HR-P1).",
    ],
    adjudication: "C:/Temp/octapm-cert/scratch/wp0/adjudication.md section A 'commercial.js' C1-C8 (integration owner, 2026-10-09)",
    buildNotes: [
      "C7 tax (holds at HEAD 886c9f1, so I7 stays on 087-COM): PATCH /prime-contract accepts taxRate 0-100 at any time, with no lock once certificates exist (prime-contract.service.js:405-423, route prime-contract.js:52-68). A certified certificate keeps the taxRate and taxAmount stored at its certification (ipc.service.js:162-172), because totals are recomputed only on draft item edits (:908-914, :1024), draft/submitted adjustments (:1088-1094, :1145) and at certification (:1417). So: set taxRate 5 on 087-COM's contract, certify I7 (tax 4,387.50, net 92,137.50), set taxRate back to 0, then certify I8 and I10. Read I7's tax from its certificate row: the statement recomputes the selected certificate with the live contract (prime-contract.service.js:833-843, 869). The 087-COM-C fallback is not needed.",
      "C8 I10 preconditions: on I10's certificate no deduction, no advance recovery (advanceRecoveryRate 0 or the advance recovered) and no tax (taxRate back to 0, C7), and retention-cap room: if the 0.4% cap is used up after I7, put I10 on a period whose cap room exists, or raise the cap first. The 9,750.00 retention needs room >= 9,750.00 (WP4.I10.preconditions).",
      "C1 probes: the +0.02 probes (P4 45,000.02 as the first payment, B3 100,000.02 as the first transfer out of 01-100) are refused at HEAD and write nothing. The plan's +0.01 probes are accepted at HEAD (one cent over passes the 0.01 tolerance), so a HEAD reproduction runs them on their own records (an approved application with net 45,000.00 and nothing paid; a pair of lines at 100,000.00) to keep the lane's 20,000 / 25,000 payments and the 20,000 transfer intact.",
    ],
  },
  ...stages,
  WP4,
  WP5,
  WP6,
  WP7,
  deep,
  claudeMd,
};

const isFigure = (node) =>
  Boolean(node) &&
  typeof node === "object" &&
  !Array.isArray(node) &&
  Object.prototype.hasOwnProperty.call(node, "unit") &&
  Object.prototype.hasOwnProperty.call(node, "derivation");

function figures() {
  const rows = [];
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "function" || (path === "" && key === "meta")) continue;
      const name = path ? `${path}.${key}` : key;
      if (isFigure(value)) {
        const row = {
          key: name,
          value: value.value,
          unit: value.unit,
          derivation: value.derivation,
          source: value.source,
          assumption: Boolean(value.assumption),
          planDisagrees: Boolean(value.planDisagrees),
        };
        if (Object.prototype.hasOwnProperty.call(value, "planValue")) row.planValue = value.planValue;
        if (Object.prototype.hasOwnProperty.call(value, "today")) row.today = value.today;
        if (Object.prototype.hasOwnProperty.call(value, "note")) row.note = value.note;
        rows.push(row);
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        walk(value, name);
      }
    }
  };
  walk(answers, "");
  return rows;
}

module.exports = { ...answers, figures };
