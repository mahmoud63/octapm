# OctaPM — master integration matrix

**Audited:** `feat/p0-foundations-sprint1` @ `db176510ba76259c5adf71f889f21ec6b6f66c56` · 2026-09-07
**Companion to:** [`OCTAPM_SYSTEM_NERVOUS_SYSTEM.md`](./OCTAPM_SYSTEM_NERVOUS_SYSTEM.md)

Every row is one nerve: a named trigger moving named data from one record to
another.

**Status** ✅ verified · 🟡 partial · 🔴 broken · ⚪ missing · ❓ untested

**Evidence state** — the three the brief required, on every row:

| Code | Meaning |
| --- | --- |
| **OBS** | **Observed currently** — tier 1–3 evidence against this commit |
| **PREV** | **Previously verified**, code has since changed, not re-observed → **downgraded to ❓** |
| **CODE** | **Code exists, untested** — no tier 1–3 evidence has ever existed |

**Evidence keys** `PW-nn` Playwright spec (115 tests, current for this tree) ·
`QA-nn` scenario harness (**re-executed today**) · `LIVE` driven API ·
`JEST` mocked Prisma — cannot promote · `SMOKE` endpoint answers only

---

## A. Bid → award → commitment

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | BOQ section | Add lines from BOQ | Bid package line | code, description, unit, qty, `boqItemId`, `estimateRate` (never shown to bidders) | `bid-packages-panel` | `POST /bids/{id}/lines/from-boq` | `bid.service` | `BidPackageLine.boqItemId` | `bid.update` | JEST | CODE | ❓ |
| A2 | Vendor directory | Invite bidders | Bid invitation | company, contact, hashed token, expiry | `bid-package-dialog` | `POST /bids/{id}/invitations` | `bid.inviteBidders` | `BidInvitation.vendorCompanyId` | `bid.update` | PW-17 | OBS | ✅ |
| A3 | Prequalification | Invite a directory vendor | Gate | refuses unless approved/conditional; override needs a reason | `bid-package-dialog` | as A2 | `vendor-prequalification.assertInvitable` | `VendorPrequalification.status` | `bid.update` | PW-17, LIVE | OBS | ✅ |
| A4 | Bidder portal | Submit priced bid | Bid + lines | rate, amount, inclusions, exclusions, validity, lead time | `portal/bidder-portal` | `POST /public/bids/{token}/submit` | `bid.portalSubmitBid` | `Bid`, `BidLine` | token-scoped | JEST | CODE | ❓ |
| A5 | Bids | Level | Comparison | excluded lines plugged with the average of the others | `bid-leveling` | `GET /bids/{id}/leveling` | `bid.leveling` | read-only | `bid.read` | JEST | CODE | ❓ |
| A6 | Winning bid | **Confirm award** | **Commitment + SOV** | bid lines → `CommitmentSovLine`: qty, rate, amount, `boqItemId`, `budgetLineId`, `costCodeId`, `activityId` | `bid-package-dialog` | `POST /bids/{id}/award/confirm` | `bid.confirmAward` → `commitment.createCommitment` | `BidPackage.awardedCommitmentId` | `bid.award` | JEST | CODE | ❓ **highest risk** |
| A7 | Prequalification | Confirm award | Gate | refuses unqualified vendor and an award over `singleAwardLimit` | — | as A6 | `vendor-prequalification.assertAwardable` | `singleAwardLimit` | `bid.award` | JEST, LIVE | OBS | 🟡 |
| A8 | Award | Confirm award | Vendor company | creates the `Company` when the bidder was invited by email only | — | as A6 | `bid.ensureVendorCompany` | `Company.isVendor` | `bid.award` | JEST | CODE | ❓ |
| A9 | Award | Confirm award | Losing bidders | award-decision email to every non-declined invitation | — | as A6 | `email.service` | — | — | JEST | CODE | ❓ |

**A6 is the single highest-risk untested nerve.** It is the only path from
tender to contract, it writes an SOV across four foreign keys, and no tier-1/2/3
harness has ever driven it.

---

## B. Procurement → RFQ → supplier → quote → PO → long lead → delivery

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | Activity | Create package | Procurement package | title, `activityId`, required-on-site date, `requiredTiming` | procurement module | `POST /procurement/packages` | `procurement.service` | `ProcurementPackage.activityId` | `procurement.create` | SMOKE | CODE | ❓ |
| B2 | Package | Tender | **RFQ** | — | — | — | — | `Rfq.changeEventId` is **required** | — | none | — | ⚪ **missing** |
| B3 | Quotes | Compare | Supplier selection | — | — | — | — | — | — | none | — | ⚪ **missing** |
| B4 | Package / commitment | Create order | Purchase order | supplier, lines, tax, delivery terms, required date, `commitmentId` | `purchase-order-dialog` | `POST /purchase-orders` | `purchase-order.service` | `ProcurementOrder.packageId/commitmentId` | `procurement.create` | PW-13 | OBS | ✅ |
| B5 | PO | submit → approve → issue → acknowledge | Lifecycle | 11 derived names from 3 stored states | `purchase-orders-panel` | `POST /purchase-orders/{id}/{transition}` | `purchase-order.lifecycleStatus` | `status`, `warehouseStatus`, `invoiceStatus` | `procurement.*` | PW-13 | OBS | ✅ |
| B6 | PO lines | Recompute | PO value | lines + tax; never a typed total | `purchase-order-dialog` | as B4 | `purchase-order.recomputeTotals` | `ProcurementOrder.value` | — | PW-13 | OBS | ✅ |
| B7 | PO | Reject / cancel / short-close | Guarded refusal | reason required; cancel refused after any delivery; locked once issued | `purchase-orders-panel` | as B5 | `purchase-order.service` | — | `procurement.*` | PW-13 | OBS | ✅ |
| B8 | Activity + PO | Track | **Long lead item** | `activityId`, lead time, required date, alerts | `long-lead` feature | `GET/POST /long-lead` | `long-lead.service`, `procurement-risk.service` | `LongLeadItem.activityId` | `procurement.read` | SMOKE | CODE | ❓ |
| B9 | PO | Deliver | Delivery receipt | ordered vs accepted vs rejected per line | `goods-receipt-panel` | `POST /purchase-orders/{id}/receipts` | `goods-receipt.service` | `DeliveryReceipt.orderId` | `procurement.update` | PW-11 | OBS | ✅ |

**B2/B3 are a genuine hole.** `Rfq.changeEventId` is a required column, so the
RFQ is exclusively a change-event instrument. A package can sit in status
`tendering` with nothing to tender from it. Buyers must run quote comparison
outside OctaPM, or misuse the bid module — which awards a `Commitment`, not a
`ProcurementOrder`.

---

## C. PO → goods receipt → inventory → warehouse → bin → issue → activity → cost code → actual cost

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Delivery receipt | Post | Stock | **accepted quantity only**; rejected recorded, never shelved | `goods-receipt-panel` | `POST /purchase-orders/{id}/receipts` | `goods-receipt.receive` → `inventory.postMovement` | `StockTransaction` type `receipt` | `inventory.create` | PW-11 | OBS | ✅ |
| C2 | Receipt | Post | Item master | a PO line with no stocked item creates one on first delivery | `goods-receipt-panel` | as C1 | `goods-receipt.service` | `InventoryItem` | `inventory.create` | PW-11 | OBS | ✅ |
| C3 | Receipt | Post | Valuation | weighted average blended on each receipt | — | as C1 | `inventory.service` | `InventoryItem.averageCost` | — | PW-11 | OBS | ✅ |
| C4 | Receipt | Over-receive | Refusal | `RECEIPT_OVER_ORDER` | `goods-receipt-panel` | as C1 | `goods-receipt.service` | — | — | JEST | CODE | ❓ |
| C5 | Stock | Put away | Bin | warehouse → zone → aisle → rack → shelf → bin; per-location balance | `warehouses-panel` | `POST /inventory/movements` | `inventory.postMovement` | `StockBalance.locationId` | `inventory.update` | PW-11 | OBS | ✅ |
| C6 | QR / barcode | Scan | Item + position | what it is, how much, where | `code-scanner`, `scan-workspace` | `GET /inventory/scan/{code}` | `inventory.service` | `barcode`, `qrCode` | `inventory.read` | PW-11 | OBS | ✅ |
| C7 | Stock | Issue to activity | Ledger + balance | signed quantity, `balanceAfter`, `activityId`, `costCodeId`, `value` | `movement-dialog` | `POST /inventory/movements` | `inventory.drawFromWarehouse` (fullest bin first) | `StockTransaction.activityId` | `inventory.update` | PW-11 | OBS | ✅ |
| C8 | **Material issue** | Issue posted | **`CostRecord.actual`** | **nothing — no code path exists** | — | — | — | columns present, never read | — | none | — | 🔴 **BROKEN** |
| C9 | **Material issue** | Issue posted | **`BudgetLine.actual`** | **nothing — no code path exists** | — | — | — | — | — | none | — | 🔴 **BROKEN** |
| C10 | Stock | Reserve | `StockBalance.reserved` | **nothing writes this column**; `available = onHand − reserved` is displayed but the issue guard checks `onHand` only | — | — | — | dead column | — | none | — | ⚪ |
| C11 | Stock | Transfer between warehouses | in-transit then in | `transfer_out` / `transfer_in` | `warehouses-panel` | `POST /inventory/transfers` | `inventory.service` | `StockTransfer` | `inventory.update` | JEST | CODE | ❓ |
| C12 | Stock | Damage / quarantine / release | Balance buckets | `damaged`, `quarantined` | `movement-dialog` | `POST /inventory/movements` | `inventory.postMovement` | `StockBalance` | `inventory.update` | JEST | CODE | ❓ |
| C13 | Stock | Count | Adjustment | `InventoryCount` + lines, signed `adjust` | `items-panel` | `POST /inventory/counts` | `inventory.service` | `InventoryCount` | `inventory.update` | JEST | CODE | ❓ |

**C8/C9.** `StockTransaction` carries `activityId`, `costCodeId`, `boqItemId`,
`commitmentId`, `unitCost` and `value`, beneath a schema comment reading
*"Where it went, so a cost lands on the right thing."* No service reads any of
it into cost. The chain terminates one hop before the thing it exists for.

---

## D. PO → goods receipt → supplier invoice → 3-way match → payment → cash flow

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Supplier invoice | Create against PO | Direct cost | vendor, invoice number, cost date, lines with `costCodeId`/`budgetLineId`/`activityId` | `direct-cost-dialog` | `POST /direct-costs` | `direct-cost.service` | `DirectCost.purchaseOrderId` | `cost.create` | SMOKE | CODE | ❓ |
| D2 | Invoice + receipt + PO | Match | Match result | `invoiced_more_than_received`, `received_more_than_ordered`, `price_variance` (0.5% tol), `rejected_on_delivery`, `short_delivered`; voided invoices ignored | `match-panel` | `GET /inventory/match` | `goods-receipt.matchLine` | joins all three | `inventory.read` | PW-11 | OBS | ✅ |
| D3 | Invoice | **Approve** | **actual cost** | line amount → budget line (named, else cost code + cost type); **increments** `BudgetLine.actual` and `CostRecord.actual`; advances `actualThroughDate` to `costDate` | `direct-cost-dialog` | `POST /direct-costs/{id}/approve` | `direct-cost.service:361-366` | `DirectCostLine.postedAmount` | `direct_cost.approve` | JEST | CODE | ❓ **high risk** |
| D4 | Invoice | Record payment | Cash-flow outflow | paid amount and date | `direct-cost-dialog` | `POST /direct-costs/{id}/payments` | → `cash-flow.rebuildCashFlow` | `DirectCostPayment` | `direct_cost.pay` | JEST | CODE | ❓ |
| D5 | Invoice | Void | Reversal | **decrements** `postedAmount`; refused when payments exist | `direct-cost-dialog` | `POST /direct-costs/{id}/void` | `direct-cost.service:401-404` | — | `direct_cost.void` | JEST | CODE | ❓ |
| D6 | Direct cost | Any write | PO invoice status | recomputes not/partially/fully invoiced | `purchase-orders-panel` | — | `purchase-order.recomputeInvoiced` | `ProcurementOrder.invoiceStatus` | — | PW-13 | OBS | ✅ |

Chain D is **structurally complete** — the one cost chain that reaches actual.
Its weakness is evidence: the match is browser-verified, the posting is not.

---

## E. Subcontractor profile → prequal → bid → award → subcontract → SOV → progress → pay app → payment → actual cost

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | Company | Prequalify | Assessment | 9 weighted criteria → score/100, band, validity, `singleAwardLimit` | `prequalification-panel` | `POST /company/vendors/{id}/prequalification/decision` | `vendor-prequalification.service` | `VendorPrequalification` | company admin | PW-17, LIVE | OBS | ✅ |
| E2 | Award | Confirm | Commitment | see A6 | `commitments-panel` | `POST /bids/{id}/award/confirm` | `bid.confirmAward` | `Commitment` | `bid.award` | JEST | CODE | ❓ |
| E3 | Commitment | Define scope | Scope matrix | 6 kinds, party per row of work, starter rows seeded | `scope-matrix-panel` | `PUT /commitments/{id}/scope` | `scope-matrix.service` | `ScopeMatrixItem` | `scope.manage` | PW-14 | OBS | ✅ |
| E4 | Records | Generate agreement | Subcontract PDF | org, vendor profile, project, SOV, approved COs, scope matrix, programme, insurances, prime terms | `commitment-dialogs` | `GET /commitments/{id}/agreement.pdf` | `subcontract-agreement.service` | reads 7 tables | `commitment.read` | PW-15 | OBS | ✅ |
| E5 | Commitment | Execute | Insurance gate | required cover present and unexpired, else override with reason | `commitment-dialogs` | `POST /commitments/{id}/execute` | `commitment.executeCommitment` | `insuranceJson` | `commitment.execute` | JEST | CODE | ❓ |
| E6 | Commitment | Execute / close | **Committed cost** | SOV + approved COs → budget line by cost code + cost type, and per activity. **Full recalculation**, not increment | `budget-panel` | — | `commitment.recomputeCommitted` | `committedFromCommitments`, `CostRecord.committed` | — | JEST | CODE | ❓ |
| E7 | Approved progress | Create pay app | Claim ceiling | claim capped at approved `ActivityProgress` × scheduled amount | `pay-app-dialogs` | `POST /pay-apps` | `sub-pay-app.applyClaims` | `SubPayAppLine.capAmount` | `sub_pay_app.create` | JEST | CODE | ❓ **high risk** |
| E8 | Approved commitment CO | Create pay app | Revised SOV ceiling | approved `CommitmentChangeOrder.linesJson` entries with `sovLineId` raise the ceiling | `pay-app-dialogs` | as E7 | `sub-pay-app.approvedChangesBySovLine` | `revisedScheduledAmount` | — | JEST | CODE | ❓ |
| E9 | Pay app | Submit | Over-claim refusal | `SUB_PAY_APP_OVER_CLAIM` unless an authorised change exists | `pay-app-dialogs` | `POST /pay-apps/{id}/submit` | `sub-pay-app.service` | — | `sub_pay_app.submit` | JEST | CODE | ❓ |
| E10 | Pay app | Approve | Compliance gate | commitment insurance + waiver, override with reason | `pay-app-dialogs` | `POST /pay-apps/{id}/approve` | `sub-pay-app.service` | — | `sub_pay_app.approve` | JEST | CODE | ❓ |
| E11 | Closeout | Approve **final** pay app | Gate | the application whose cumulative claim reaches the revised value is refused while closeout is outstanding | `closeout-panel` | as E10 | `closeout.assertReady` + `isFinalApplication` | `SubcontractCloseout` | `sub_pay_app.approve` | PW-16 | OBS | ✅ |
| E12 | Pay app | Record payment | Cash-flow outflow | paid amount and date | `pay-app-dialogs` | `POST /pay-apps/{id}/payments` | → `cash-flow.rebuildCashFlow` | `SubPayAppPayment` | `sub_pay_app.pay` | JEST | CODE | ❓ |
| E13 | **Pay app** | Approve or pay | **`CostRecord.actual`** | **nothing — no code path exists** | — | — | — | — | — | none | — | 🔴 **BROKEN** |
| E14 | **Pay app** | Approve or pay | **`BudgetLine.actual`** | **nothing — no code path exists** | — | — | — | — | — | none | — | 🔴 **BROKEN** |
| E15 | Commitment | Close | Closeout gate | punch (scoped to the vendor's company), insurance, applications settled, retention released, 6 handover rows | `closeout-panel` | `POST /commitments/{id}/close` | `closeout.assertReady` | `CloseoutItem` | `commitment.close` | PW-16 | OBS | ✅ |
| E16 | Subcontract | Evaluate | Performance score | 6 criteria derived from NCRs, safety, punch, COs, closeout; 2 rated | `evaluation-panel` | `POST /commitments/{id}/evaluation/final` | `subcontractor-evaluation.service` | `SubcontractorEvaluation` | `evaluation.approve` | PW-18, LIVE | OBS | ✅ |
| E17 | Evaluation | Finalise | Prequal history | average score + would-reuse fraction onto the next assessment | `prequalification-panel` | `GET /company/vendors/{id}/prequalification` | `evaluation.historyFor` | `companyId` rollup | authenticated | PW-18, LIVE | OBS | ✅ |
| E18 | **Legacy** `SubValuation` | Certify | Cash-flow outflow | free-text `subcontractor` name, **no company link** | `sub-valuations` tab | `POST /sub-valuations` | `sub-valuation.service` | `SubValuation.subcontractor String` | `sub_pay_app.*` | SMOKE | CODE | 🟡 |

**E13/E14 are the most consequential defect in the system.** The commitment
posts *committed* (E6) and the payment reaches *cash flow* (E12); nothing
converts either into *actual*.

---

## F. Prime contract → SOV → progress → client pay app → invoice → payment → cash flow

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Project | First read | Prime contract | seeded from the project; the BOQ **is** the client SOV | `client-billing-panel` | `GET /prime-contract` | `prime-contract.ensureContract` | `PrimeContract` | `ipc.read` | PW-12 | OBS | ✅ |
| F2 | Approved client CO | Any CO write | Revised contract value | approved only; pending reported separately, never folded in | `client-billing-panel` | — | hooks on `change-order.service` | `PrimeContract.revisedValue` | — | PW-12 | OBS | ✅ |
| F3 | Approved progress | Build period | IPC items | BOQ line × approved progress → `IpcItemProgressLink` | `ipc-workbook` | `GET /ipc/{period}` | `ipc.service` | `IpcItemProgressLink.progressId` | `ipc.read` | SMOKE | CODE | ❓ |
| F4 | IPC period | Certify | Certificate financials | gross (work + stored materials) − retention (capped) − advance recovery (never over-recovered) − deductions, **then tax on the remainder** | `client-billing-panel` | `POST /ipc/{period}/certify` | `prime-contract.certificateFinancials` | `IpcCertificate` | `ipc.certify` | PW-12 | OBS | ✅ |
| F5 | Certificate | Record receipt | Cash-flow inflow | amount, date | `client-billing-panel` | `POST /ipc/{id}/payments` | `cash-flow` reads `IpcPayment` | `IpcPayment` | `ipc.pay` | PW-12 | OBS | ✅ |
| F6 | Invoices | Age | Receivables | ages from due date, falling back to contract payment terms | `client-billing-panel` | `GET /prime-contract/receivables` | `prime-contract.service` | — | `ipc.read` | PW-12 | OBS | ✅ |
| F7 | Certificate | Certify | **Revenue ledger** | none — revenue exists only as a cash-flow inflow | — | — | — | — | — | none | — | ⚪ |

Chain F is the **best-evidenced chain in the system** and the model the others
should follow.

---

## G. RFI → change event → RFQ → quote → change order → budget → forecast

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | RFI | Convert to change | **Change order** (draft) | `costImpactAmount` → `value`, `scheduleImpact`; second conversion refused 409 | `rfi-detail-dialog` | `POST /rfi/{id}/convert-to-change` | `rfi-workflow` | `Rfi.changeOrderId` | `rfi.update` | **QA-03 today** | OBS | ✅ |
| G2 | **RFI** | — | **Change event** | **no path** — `convert-to-change` produces a ChangeOrder | — | — | — | — | — | **QA-03 today** | OBS | ⚪ **GAP-INT-001** |
| G3 | Change event | Create | Event + lines | type, origin, ROM, lines with `costCodeId`/`budgetLineId`/`activityId`/`commitmentId` | `change-event-dialog` | `POST /change-events` | `change-event.service` | `ChangeEventLine` | `change_event.create` | **QA-03 today** | OBS | ✅ |
| G4 | Change event | Send RFQs | Vendor RFQ | line subset, hashed token, due date | `change-event-dialog` | `POST /change-events/{id}/rfqs` | `change-event.sendRfqs` | `Rfq.changeEventId` | `change_event.rfq_send` | JEST | CODE | ❓ |
| G5 | Vendor portal | Quote | Quote lines | amount per line, notes, validity, lead time | `portal/rfq-portal` | `POST /public/rfqs/{token}/quote` | `change-event.service` | `Rfq.quoteLinesJson` | token-scoped | JEST | CODE | ❓ |
| G6 | Quote | Accept | Line prices + commitment CO | `quotedAmount` per line; optionally raises a `CommitmentChangeOrder` | `change-event-dialog` | `POST /change-events/rfqs/{id}/accept` | `change-event.acceptQuote` | `quotedRfqId` | `change_event.update` | JEST | CODE | ❓ |
| G7 | Change event | Convert | Change order | value intact, both link columns set, event → `converted` | `change-event-dialog` | `POST /change-events/{id}/convert` | `change-event.convertToChangeOrder` | `changeEvent.changeOrderId` | `change_order.create` | **QA-03 today** | OBS | ✅ |
| G8 | Change order | Submit | Governance refusal | `IMPACT_SUMMARY_REQUIRED`, then `IMPACT_PROOF_REQUIRED` until an affected activity **and** a cited document exist | `change-order-form` | `POST /change-orders/{id}/submit` | `change-order.service` | `CommercialAttachmentRef` | `change_order.submit` | **QA-03 today** | OBS | ✅ |
| G9 | Change order | Approve | **Revised budget** | value → `BudgetLineChange`; original unchanged. **Derived**, not incremented | `budget-panel` | `POST /change-orders/{id}/approve` | `budget.applyChangeOrderToBudgetLines` | `BudgetLine` revised | `change_order.approve` | PW-03, PW-04 | OBS | ✅ |
| G10 | Budget + EV | Read | Forecast | budget lines + official EV → projected finish and overrun | `forecast-panel` | `GET /forecast` | `forecast.buildForecast` | read-only | `schedule.read` | SMOKE | CODE | 🔴 *(inherits I8)* |

> **Downgrade recorded.** In this pass the harness could not complete G9 —
> `S-INT-003` returned PARTIAL because submit is refused until a document is
> cited. The control (G8) was therefore *observed working*; the budget move is
> carried by Playwright 03/04 instead, which does drive it through the UI.

---

## H. Schedule → activity progress → earned value → actual / forecast

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1 | Import / manual | Create | Activities + WBS | XER / P6 XML / MSP XML; hours ÷ 8 = working days | `schedule-dashboard` | `POST /import` | `import.service`, `parsers/*` | `Activity`, `WbsNode` | `schedule.create` | JEST | CODE | ❓ |
| H2 | Activities | Recalculate | CPM | early/late dates, total float; TF = 0 → critical | gantt | `POST /schedule/cpm` | `cpm.service` | `Activity.totalFloat` | `schedule.update` | PW-10 | OBS | ✅ |
| H3 | BOQ | Allocate | Activity value | `ActivityBoqAllocation.amount` — the EV basis | `boq` module | `POST /activity-boq-allocations` | `activity-boq-allocation.service` | allocation | `boq.update` | SMOKE | CODE | ❓ |
| H4 | Site | Submit progress | `ActivityProgress` | pct, quantity, milestone, inspection or manual method | `site-reporting` | `POST /progress` | `progress.service` | `ActivityProgress` | `progress.create` | **QA-03 today** | OBS | 🟡 |
| H5 | Progress | Approve | Approved pct | draft/submitted/rejected excluded from EV | `site-reporting` | `POST /progress/{id}/approve` | `progress.service` | `status` | `progress.approve` | **QA-03 today** | OBS | 🟡 |
| H6 | Approved progress | Read | **EV** | `EV = Σ(allocation.amount × approved pct ÷ 100)` | `cost-dashboard` | `GET /reports/ev` | `earned-value.buildOfficialEvReport` | read-only | `cost.read` | **QA-03 today** | OBS | 🟡 |
| H7 | `CostRecord.actual` | Read | **AC** | `AC = Σ(latest actual where actualThroughDate ≤ cutoff)` | `cost-dashboard` | as H6 | `earned-value.service` | `actualThroughDate` | `cost.read` | JEST | CODE | 🔴 *(understated — C8, E13)* |
| H8 | EV + AC | Compute | SPI · CPI · EAC | SPI = EV/PV · CPI = EV/AC · EAC = budget ÷ CPI | `cost-dashboard` | as H6 | `earned-value.computeEvMetrics` | — | `cost.read` | JEST | CODE | 🔴 *(inherits H7)* |
| H9 | Activities | Seed | Lookahead | window from actuals > CPM early dates > planned dates; PPC per week | `lookahead-board` | `POST /lookaheads` | `lookahead.service` | `LookaheadItem` | `lookahead.create` | SMOKE | CODE | ❓ |

> **H4–H6 are 🟡 on today's evidence.** `S-INT-005` found approved progress rows
> exist and the health payload renders, but the payload exposes `overallScore`
> and `dimensions` and **no overall percent complete**, so progress could not be
> reconciled like-for-like against EV. It also confirmed **BUG-API-001** live:
> `GET /projects/{id}/activities` returns a bare array while every comparable
> list endpoint returns `{ items, pagination }`.

**H7–H9 are 🔴 rather than ❓ deliberately.** The code runs and returns a number.
The number is wrong, because two cost categories never arrive. A metric that is
confidently wrong is more dangerous than one that fails.

---

## I. Drawing → RFI · drawing → punch · specification → submittal

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I1 | Sheet | Drop pin → RFI | RFI | sheet, page, x/y, subject; or links an existing RFI | `sheet-viewer`, `pin-dialog` | `POST /sheets/{id}/pins` | `markup.service:398-401` → `rfi.service` | `Pin.recordType` | `document_control.update` | JEST | CODE | ❓ |
| I2 | Sheet | Drop pin → punch | Punch item | as I1, raising a `PunchItem` | `pin-dialog` | as I1 | `markup.service:418-422` → `punch.service` | `Pin` | `punch.create` | JEST | CODE | ❓ |
| I3 | Sheet | Drop pin → defect | Defect record | legacy target | `pin-dialog` | as I1 | `markup.service:454` | `DefectRecord` | `ncr.create` | JEST | CODE | ❓ |
| I4 | Drawing set | Publish | Sheet revisions | match by number, supersede, audit, notify | `drawing-set-review` | `POST /drawings/sets/{id}/publish` | `drawing-set.service` | `SheetRevision` | `drawing.publish` | JEST | CODE | ❓ |
| I5 | Sheet PDF | Parse | Sheet references | callouts (`3/A-501`) deduped; `looseKey` folds A-101 / A 101 / A101 | `sheet-references` | `GET /sheets/{id}/references` | `drawing-assistant` | `SheetReference` | `document_control.read` | JEST | CODE | ❓ |
| I6 | Spec document | Index | Spec sections | CSI parse, char offsets into `DocumentText`, page range | `specifications-panel` | `POST /specifications/index` | `specification.service` | `SpecSection` | `document_control.update` | SMOKE | CODE | ❓ |
| I7 | Spec section | Raise RFI | RFI (draft) | `specSection`, discipline | `raise-rfi-dialog` | `POST /specifications/{id}/rfi` | `specification.raiseRfi:619` | `Rfi.specSection` | `rfi.create` | JEST | CODE | ❓ |
| I8 | **Spec section** | — | **Submittal** | **no path** | — | — | — | — | — | none | — | ⚪ |
| I9 | **Spec section** | — | **Procurement** | **no path** | — | — | — | — | — | none | — | ⚪ |
| I10 | Submittal | Approve | Schedule impact | lead time → `WorkflowActivityLink` `submittal_lead_time` | `submittal-detail-dialog` | `POST /submittals/{id}/decide` | `submittal-workflow.applyScheduleImpact` | `WorkflowActivityLink` | `submittal.approve` | JEST | CODE | ❓ |

**I8.** Submittal registers are conventionally built from the specification.
Here specs index and can raise RFIs, but the submittal register is typed by hand.

---

## J. Inspection → deficiency → NCR/punch → responsible subcontractor → corrective action → reinspection → closure

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| J1 | Company template | Seed | Project inspection | starter ITP templates | `inspections` | `POST /forms/templates/starters` | `form.service` | `FormTemplate.isSystem` | `inspection.create` | **QA-03 today** | OBS | ✅ |
| J2 | Inspection | Fail an item | **Deficiency** | answered fail/no → deficient | `inspections` | `POST /forms/{id}/items/{itemId}/deficiency` | `form.raiseDeficiency:1358` | `FormItemResponse` | `punch.create` | **QA-03 today — "the inspection has no items to fail"** | CODE | 🟡 |
| J3 | Deficiency | Raise | Punch item / observation | description, location, `assigneeCompanyId`, `sourceRecordType`/`Id` | `inspections` | as J2 | `form.raiseDeficiency` → `punch.service` | `PunchItem.sourceRecordId` | `punch.create` | **QA-03 today (partial)** | CODE | 🟡 |
| J4 | **Inspection** | Fail an item | **NCR** | **no path** — deficiencies raise punch items or observations only | — | — | — | — | — | none | — | ⚪ |
| J5 | Inspection | Open hold point | Progress refusal | `ITP_HOLD_POINT_OPEN` blocks client progress approval | `site-reporting` | `POST /progress/{id}/approve-with-client` | `form.openHoldPoints` | — | `progress.approve` | JEST | CODE | ❓ |
| J6 | Punch / NCR | Assign | Responsible subcontractor | `assigneeCompanyId` | `punch` module | `PATCH /punch/{id}` | `punch.service` | `assigneeCompanyId` | `punch.update` | JEST | CODE | ❓ |
| J7 | Punch | — | **Corrective action record** | **no distinct record** — a punch item transitions straight toward closed | — | — | — | — | — | none | — | ⚪ |
| J8 | Punch | — | **Reinspection** | **no path** — no re-run of the source inspection is linked | — | — | — | — | — | none | — | ⚪ |
| J9 | Punch | ready_for_review → closed | Closure | transition rules, party visibility, `PunchItemEvent` | `punch` module | `POST /punch/{id}/transition` | `punch.service` | `PunchItemEvent` | `punch.update` | JEST | CODE | ❓ |
| J10 | Open punch | Read | **Closeout gate** | open items for that company block the subcontract closing | `closeout-panel` | `GET /commitments/{id}/closeout` | `closeout.punchState` | scoped by company | `commitment.read` | PW-16 | OBS | ✅ |
| J11 | NCR + punch + safety | Read | **Performance evaluation** | counts by severity, closure timeliness | `evaluation-panel` | `GET /commitments/{id}/evaluation` | `evaluation.evidenceFor` | `assigneeCompanyId` | `commitment.read` | PW-18, LIVE | OBS | ✅ |

The far end is the strongest part: quality records are read automatically into
the two gates that matter to a subcontractor. The near end (inspection → NCR)
and the middle (corrective action → reinspection) are missing outright.

---

## K. Cross-cutting nerves

| ID | Nerve | Coverage | Evidence | State | Status |
| --- | --- | --- | --- | --- | --- |
| K1 | Multi-tenant isolation | every query scoped by `orgId` | **QA-01 today** — cross-tenant read and search refused | OBS | ✅ |
| K2 | Permission policy | 37 modules, role + party + template | **QA-02 today** — every documented list endpoint refuses excluded roles | OBS | ✅ |
| K3 | Audit | 60+ entity types; company-level events allowed since the `projectId` nullability fix | **QA-04 today** | OBS | ✅ |
| K4 | Notifications | 22 services publish; categories, preferences, push, email | JEST, PW-01 | CODE | 🟡 |
| K5 | Workflow engine | 8 tools; `assertNotLocked` guards record services | PREV | PREV | ❓ |
| K6 | Report builder | 20+ sources, permission-filtered per caller | JEST *(a prior pass found `listSources` returned un-awaited)* | CODE | ❓ |
| K7 | Search | permission-gated; outsider gets `items: []` | **QA-01 today** | OBS | ✅ |
| K8 | Attachments | canonical record-type → module map | JEST | CODE | ❓ |
| K9 | Offline outbox | `sendOrQueue`, `clientRequestId` idempotency | JEST | CODE | ❓ |
| K10 | Realtime | socket.io rooms per project and user | PW-01 | OBS | 🟡 |
| K11 | Module visibility | `MODULE_PERMISSIONS` gates the workspace nav | PW-06 | OBS | ✅ |
| K12 | Module visibility gaps | `reports` gated by `schedule`; `commercial` omits `bid`/`change_event`; `inventory`, `conversation`, `timesheet`, `risk`, `task`, `lookahead` ungated | code | CODE | 🟡 |
| K13 | List envelope consistency | `GET /activities` returns a bare array; peers return `{items, pagination}` | **QA-03 today** | OBS | 🔴 BUG-API-001 |

---

## L. Money trace — what each transaction actually does

Code-path evidence for the brief's section 9. **R** = recalculated from source
rows (cannot drift) · **I** = incremented in place with a compensating reversal.

| Transaction | Service : line | Budget | Committed | **Actual** | Cash flow | Mechanism | Consumed by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Approved change order** | `budget.applyChangeOrderToBudgetLines`, called inside `change-order.updateChangeOrder`'s transaction | `BudgetLineChange` row; revised = original + ledger | — | — | — | **R** | budget panel, forecast, `PrimeContract.revisedValue` |
| **Commitment executed / closed** | `commitment.recomputeCommitted` | — | `BudgetLine.committedFromCommitments`, `CostRecord.committed` | — | — | **R** — reads every commitment, rewrites every line | budget panel; `budget.service:142` prefers it over the manual `committed` |
| **Sub pay app approved** | `sub-pay-app.service` | — | — | **🔴 nothing** | — | — | — |
| **Sub pay app paid** | `sub-pay-app.service:745` | — | — | **🔴 nothing** | `SubPayAppPayment` → `rebuildCashFlow` | **R** | cash-flow panel |
| **Supplier invoice approved** | `direct-cost.service:361-366` | `BudgetLine.actual` **+=** | — | `CostRecord.actual` **+=**, `actualThroughDate` advanced to `costDate` | — | **I** | EV/AC, cost dashboard |
| **Supplier invoice voided** | `direct-cost.service:401-404` | `actual` **−=** | — | `actual` **−=** | — | **I** | — |
| **Supplier invoice paid** | `direct-cost.service:435` | — | — | — | `DirectCostPayment` → `rebuildCashFlow` | **R** | cash-flow panel |
| **Timesheet approved** | `timesheet.service:563-569` | `BudgetLine.actual` **+=** | — | `CostRecord.actual` **+=**, `actualThroughDate` = timesheet date | — | **I** | EV/AC |
| **Timesheet reopened** | `timesheet.service:606-609` | `actual` **−=** | — | `actual` **−=** | — | **I** | — |
| **Equipment usage** | `equipment.service:300` | — | — | `CostRecord` upsert with `actualThroughDate` | — | **I** | EV/AC |
| **Inventory issue** | — | **🔴 nothing** | — | **🔴 nothing** | — | — | — |
| **Client certificate certified** | `prime-contract.certificateFinancials` | — | — | n/a (revenue) | — | pure function | client billing panel |
| **Client payment received** | `cash-flow.service:93+` reads `IpcPayment` | — | — | — | **inflow** | **R** | cash-flow panel |

**The architectural tell.** Everything *recalculated* is correct by
construction. Everything *incremented* depends on somebody remembering to add a
call site — and the two that were forgotten, subcontract and material, are the
two largest categories of construction cost. Nothing recomputes `actual` from
first principles, so nothing notices an absent contributor.

---

## Summary counts

Counted programmatically from the rows above by parsing the status column —
not estimated. **115 nerves.**

| Status | Rows | Share |
| --- | --- | --- |
| ✅ Verified | 41 | 36% |
| ❓ Untested | 46 | 40% |
| 🟡 Partial | 10 | 9% |
| ⚪ Missing | 10 | 9% |
| 🔴 Broken | 8 | 7% |

By evidence state:

| State | Rows | Meaning |
| --- | --- | --- |
| **CODE** — code exists, untested | 53 | never driven outside a mock |
| **OBS** — observed currently | 48 | tier 1–3 evidence against `db17651` |
| **PREV** — previously verified, downgraded | 1 | workflow engine (K5) |
| n/a — missing nerves | 13 | nothing to observe |

**Connectivity score: 36%** (41 verified ÷ 115 nerves).

The ❓ column is not "probably fine". It is 46 nerves carrying money, contracts
or schedule impact that have never been driven outside a mock, in a codebase
where every live pass so far — including today's — has found something.

The 🔴 rows are not eight independent bugs. They are **two** missing cost
postings (C8/C9 inventory, E13/E14 pay app), the two metrics that inherit them
(H7/H8), one forecast that inherits those (G10), and one API envelope
inconsistency (K13).
