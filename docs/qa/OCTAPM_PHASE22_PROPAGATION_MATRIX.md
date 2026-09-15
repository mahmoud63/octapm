# OCTAPM PHASE 22 — CONNECTED-SYSTEM PROPAGATION MATRIX

The most important Phase 22 test: for each important mutation, the expected downstream effects vs. the
actual behaviour.

**Method & honesty note.** To protect the Phase-21-certified project (its financial reconciliation is
frozen at Actual = $71,204, snapshot 36/36), this pass did **not** re-drive destructive mutations
through the browser on that project. Instead each row is graded from:
- **OBS** — already-propagated state observed live this pass (e.g. the Cost cockpit "Actual" equals the
  cost ledger to the cent);
- **P21** — the same propagation path was independently reproduced and regression-tested during Phase
  21 (documented in `OCTAPM_PHASE21_DEFECT_REGISTER.md` / `OCTAPM_PHASE21_FINANCIAL_RECONCILIATION.md`);
- **DRIVE-NEXT** — not freshly executed this pass; a live browser drive on the residue-tolerant
  Riverside project (`95c188f3…`) is the recommended completion step.

Cross-check performed this pass (API, read-only): P21 cost ledger total = **$71,204**, matching the
Cost Overview "Actual" exactly → the cost spine is genuinely connected.

Delay legend: **sync** (same request) · **refresh** (visible after a manual/automatic refresh).

---

## Change management — Approve Change Order

| Downstream | Expected | Actual | Basis | Pass |
| --- | --- | --- | --- | --- |
| Change register / status history | new approved entry, audit line | audit feed shows Draft→Pending→approved with actor, reason, attachment | OBS | PASS |
| Budget → revised budget | revised budget rises by CO value | Approved VOs $254,500 reflected; revised-budget field present | OBS/P21 | PASS |
| Forecast | recomputed | cost forecast present | P21 | PASS |
| Cost code / BOQ allocation | value allocated to line | **value sits on a holding line — `budgetLineId` not carried (P21-012, OPEN P3)** | OBS/P21 | PARTIAL |
| Commitment (if linked) | committed recomputed under lock | recompute holds the parent row | P21 (CX21-524) | PASS |
| Dashboard / reports / audit | reflect new value | commercial KPI + audit update | OBS | PASS |
| Needs You / notifications | approver cleared; parties notified | ball-in-court + notifications wired | P21 | PASS |
| **Actor identity in audit** | show person name | **shows raw UUID** (UX defect, not a data defect) | OBS | FAIL (display) |

## Procurement — Award RFQ

| Downstream | Expected | Actual | Basis | Pass |
| --- | --- | --- | --- | --- |
| bid package → award → supplier → PO | award creates/links PO to supplier | packages/awards/POs present and linked | DRIVE-NEXT / P21 | PASS (design) |
| long-lead / schedule linkage | lead-time alerts reflect award | long-lead module present | DRIVE-NEXT | PASS (design) |
| dashboard / audit | procurement KPIs update | procurement risk KPIs present | OBS | PASS |

## Purchase order / receipt

| Action | Downstream | Actual | Basis | Pass |
| --- | --- | --- | --- | --- |
| Issue PO | PO, supplier exposure, procurement dashboard, long-lead, activity/BOQ refs | PO list shows committed/invoiced, plain-language status, needed-on-site | OBS | PASS |
| Receive Goods | PO received qty, inventory, warehouse/bin, value, outstanding PO, 3-way-match availability, audit | Inventory Goods-in + Match tabs exist; PO shows invoiced vs value | DRIVE-NEXT / P21 | PASS (design) |

## Inventory — Issue material

| Downstream | Expected | Actual | Basis | Pass |
| --- | --- | --- | --- | --- |
| stock qty / value / weighted average | decremented at weighted-average | ledger + weighted-average logic verified | P21 (CX21-101/201) | PASS |
| activity / BOQ / cost code | movement carries validated refs | refs validated by org/project | P21 (CX21-535/545) | PASS |
| CostLedgerEntry → Actual cost | consumption posts to ledger, Actual rises | **Actual = ledger = $71,204 (verified this pass)** | OBS/P21 | PASS |
| cost report / forecast / dashboard | reflect new actual | Cost cockpit Actual live | OBS | PASS |

## Subcontract — Approve pay app / Pay subcontractor

| Action | Downstream | Actual | Basis | Pass |
| --- | --- | --- | --- | --- |
| Approve pay app | commitment/SOV/progress, certified cost, retention, CostLedgerEntry, Actual, forecast, dashboard, Needs You, audit | certified pay app in state (SC-001-PA01, retention 10%, net $54,000); posts to ledger | OBS/P21 | PASS |
| Pay subcontractor | cash-out, payment status, retention status; **Actual must NOT post again** | IPC action shows "$28,000 balance – partially paid – retention held"; double-post guarded | P21 (loop rules) | PASS |

## Client commercial

| Action | Downstream | Actual | Basis | Pass |
| --- | --- | --- | --- | --- |
| Certify client valuation | client contract, progress, certified revenue, invoice availability, AR, forecast, audit | client valuation/IPC flow present; EV updates | DRIVE-NEXT / P21 | PASS (design) |
| Receive client payment | cash-in, AR, invoice status, cash-flow; **project Actual must NOT change** | client receipt updates cash-flow; **Actual unchanged** | P21 (loop rules) | PASS |

## Timesheet — Approve

| Downstream | Expected | Actual | Basis | Pass |
| --- | --- | --- | --- | --- |
| labour / employee / activity / cost code / CostLedgerEntry / Actual / forecast / reports | labour posts to ledger at activity+cost code | timesheet posting verified (P21 finalLedger `timesheet` = $2,000) | P21 | PASS |

## Schedule — Change progress / dates

| Downstream | Expected | Actual | Basis | Pass |
| --- | --- | --- | --- | --- |
| schedule / critical path / float / EV / forecast / dashboard / long-lead / reports | recompute critical path, float, EV | Schedule shows critical path (12), EV tab, forecast, critical-path explanation | OBS/DRIVE-NEXT | PASS (design) |

## RFI

| Action | Downstream | Actual | Basis | Pass |
| --- | --- | --- | --- | --- |
| Answer RFI | status, ball-in-court, Needs You, notifications, audit | RFI shows Responsible/Owner/Reviewer/Approver ball-in-court; "Waiting on me" filter | OBS | PASS |
| Convert RFI → Change | change created once, source link, commercial register, budget impact only after approval | CO history shows "submit from RFI-001" with the RFI instruction attached | OBS | PASS |

## Quality — Inspection failure

| Downstream | Expected | Actual | Basis | Pass |
| --- | --- | --- | --- | --- |
| inspection → NCR/defect, responsibility, Needs You, quality dashboard, audit, closeout | failed inspection raises NCR, routes responsibility | quality module (NCR/Inspections/Punch/Material Tests) present; quality score wired | DRIVE-NEXT / P21 | PASS (design) |

---

## Propagation summary

- **Financial spine is genuinely connected and correct** — Actual cost is the derived cost ledger
  (verified $71,204 = UI), issue/pay-app/timesheet post once, client payment and subcontractor payment
  do **not** double-post Actual. This is the strongest part of the product and was hardened extensively
  in Phase 21.
- **One known open connectivity gap:** change-order value does not carry its budget-line allocation
  downstream (P21-012) — it lands on a holding line and needs a manual transfer.
- **One display-only propagation defect:** the change-order audit feed shows the actor as a raw UUID.
- **Completion step:** freshly drive Award→PO→Receive, Certify client valuation, and Inspection-failure
  through the browser on the Riverside project to convert the DRIVE-NEXT rows from "design-verified" to
  "live-observed". No failure is expected based on Phase-21 evidence.

---

## Phase 22A recheck (2026-09-15)

Re-checked after the budget/forecast changes and the residue archive. "Evidence" names the proof used;
nothing in this table was taken on trust.

| Chain | Evidence | Status |
| --- | --- | --- |
| Change order → revised budget → cost → forecast → dashboard → audit | Certified project: Approved VOs $254,500 = "Approved changes" on Cost Overview and on the Budget tab; Revised $1,954,500 on both; CO history names actors. Two-session: creation reaches the PM REALTIME. Allocation to a budget line remains a manual transfer (UX22-17). | CONNECTED (allocation manual) |
| Procurement award → PO → receipt → inventory → three-way match | Certified project: 3 POs, committed $1,650, invoiced $1,700; snapshot checks on receipt and stock pass (36/36). | CONNECTED |
| Inventory issue → stock → ledger → Actual | Snapshot "stock left is 150 less the 64 issued" = 86; Actual 71,204.00 reconciles SQL = API (delta 0.00). | CONNECTED |
| Subcontract certification → Actual → retention → payment → cash flow | Pay app SC-001-PA01 approved net $54,000, paid $54,000, retention $6,000; ledger reconciliation delta 0.00. | CONNECTED |
| Timesheet approval → labour → ledger → Actual | Labour actual $2,000 on 01-100 in the budget register and the ledger lines; reconciliation 16/16 source lines. | CONNECTED |
| RFI answer → status → responsibility → Needs You → audit | Two-session REALTIME both ways; site engineer's "My open items" reads 0 after closure; audit feed names the actor. | CONNECTED |
| Direct cost approval → Actual (added this phase) | Two-session: cost controller's "Actual cost" moves by the approved $750 within 3 ms, no refresh. | CONNECTED |

## Phase 22B final pass (2026-09-15, disposable E2E project unless noted)

| Chain | Evidence | Status |
| --- | --- | --- |
| Change order → named budget line → revised budget → Cost Overview → forecast | E2E Riverside: VO approved $12,500 on line 01-100 (Site labour $150,000 → $162,500 revised); project Approved changes 12,500, Revised 1,712,500, Forecast 1,712,500; the QS sees the approval in 3 ms | CONNECTED |
| Change order with a split across lines / with an archived line | `budget.service.test.js` "applies an explicit split", archived share to the holding line; repeated approval idempotent (`change-order.service.test.js`) | CONNECTED (unit) |
| Historical change orders (certified project) | still on the holding line, Original 1,700,000 / Approved changes 254,500 / Revised 1,954,500; 36/36 snapshot checks, Actual delta 0.00 | PRESERVED |
| Procurement: RFQ (bid package) → award → commitment | supplier portal drive: package published, bid submitted and revised, soft award, confirmed award raises subcontract commitment SC-002 from the priced lines | CONNECTED |
| Procurement: PO → receipt → stock → PM list | goods receipt against PO-0001: PM list "Delivered" in 4 ms; stock 1,560 bags at 6.40 on navigation | CONNECTED |
| Inventory issue → stock / value / ledger / Actual | certified project snapshot: 86 bags left at 11.00, material issue 704.00 in the ledger, Actual 71,204.00 (SQL = API) | CONNECTED (certified, read-only) |
| Labour: timesheet approval → ledger / Actual | certified snapshot: labour 2,000.00 on 01-100 reconciles | CONNECTED (certified) |
| Subcontract: certification → Actual / retention / payment; payment does not post Actual again | certified snapshot: certified 60,000.00, retention 6,000.00, paid 54,000.00 = cash out; Actual unchanged by payment (delta 0.00) | CONNECTED (certified) |
| Client: valuation → invoice → receipt; Actual unchanged | certified snapshot: cash in 80,000.00 (stage 10), Actual unchanged | CONNECTED (certified) |
| RFI → status → responsibility → Needs You → audit | two-session REALTIME both ways | CONNECTED |
| Quality: NCR → responsible person → Needs You → corrective action with evidence → approval → close | two-session: every handoff REALTIME; the closed NCR leaves "My open items" | CONNECTED |
| Quality dashboard KPIs | live rows only (void/archived excluded), `quality.metrics.test.js` | CONNECTED |

Propagation verdict: **PASS** — no incorrect financial propagation found; the certified project's
reconciliation is unchanged at 36/36 with Actual delta 0.00.
