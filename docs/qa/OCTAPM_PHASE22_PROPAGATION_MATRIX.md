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
