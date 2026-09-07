# OctaPM — master integration matrix

**Date:** 2026-09-07 · **Branch:** `feat/p0-foundations-sprint1` · **Head:** `ee09f5b`
**Companion to:** [`OCTAPM_SYSTEM_NERVOUS_SYSTEM.md`](./OCTAPM_SYSTEM_NERVOUS_SYSTEM.md)

Every row is one nerve: a named trigger that moves named data from one record
to another. **Status is evidence-led** — ✅ requires a browser (Playwright), a
live QA-harness scenario, or a live API drive. Jest and smoke cannot promote a
row, for the reasons set out in the companion document.

**Status:** ✅ verified · 🟡 partial · 🔴 broken · ⚪ missing · ❓ untested

**Evidence keys:** `PW-nn` = `frontend/e2e/nn-*.spec.ts` · `QA-nn` =
`backend/scripts/qa/nn-*.js` · `LIVE` = driven against a running API ·
`JEST` = mocked-Prisma unit test only · `SMOKE` = endpoint answers only

---

## A. Bid → award → commitment

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Test evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | BOQ section | Add lines from BOQ | Bid package line | code, description, unit, qty, `boqItemId`, `estimateRate` (internal) | `bid-packages-panel` | `POST /bids/{id}/lines/from-boq` | `bid.service` | `BidPackageLine.boqItemId` | `bid.update` | JEST | ❓ |
| A2 | Vendor directory | Invite bidders | Bid invitation | company, contact, hashed token, expiry | `bid-package-dialog` | `POST /bids/{id}/invitations` | `bid.service.inviteBidders` | `BidInvitation.vendorCompanyId` | `bid.update` | **PW-17** | ✅ |
| A3 | **Prequalification** | Invite a directory vendor | Gate | refuses unless approved/conditional; override needs a reason | `bid-package-dialog` | same as A2 | `vendor-prequalification.assertInvitable` | `VendorPrequalification.status` | `bid.update` | **PW-17**, LIVE | ✅ |
| A4 | Bidder portal | Submit priced bid | Bid + bid lines | rate/amount per line, inclusions, exclusions, validity, lead time | `portal/bidder-portal` | `POST /public/bids/{token}/submit` | `bid.service.portalSubmitBid` | `Bid`, `BidLine` | token-scoped | JEST | ❓ |
| A5 | Bids | Level | Comparison | plugs excluded lines with the average of the others | `bid-leveling` | `GET /bids/{id}/leveling` | `bid.service.leveling` | read-only | `bid.read` | JEST | ❓ |
| A6 | Winning bid | Confirm award | **Commitment + SOV** | bid lines → `CommitmentSovLine` carrying qty, rate, amount, `boqItemId`, `budgetLineId`, `costCodeId`, `activityId` | `bid-package-dialog` | `POST /bids/{id}/award/confirm` | `bid.confirmAward` → `commitment.createCommitment` | `BidPackage.awardedCommitmentId` | `bid.award` | JEST | ❓ **high risk** |
| A7 | **Prequalification** | Confirm award | Gate | refuses unqualified vendor **and** an award over a conditional `singleAwardLimit` | — | same as A6 | `vendor-prequalification.assertAwardable` | `VendorPrequalification.singleAwardLimit` | `bid.award` | JEST, LIVE | 🟡 |
| A8 | Award | Confirm award | Vendor company | creates the `Company` when the bidder was invited by email only | — | same as A6 | `bid.ensureVendorCompany` | `Company.isVendor` | `bid.award` | JEST | ❓ |
| A9 | Award | Confirm award | Losing bidders | award-decision email to every non-declined invitation | — | same as A6 | `email.service` | — | — | JEST | ❓ |

**A6 is the highest-risk untested nerve in the system.** It is the only path
that turns a competitive tender into a contract, it writes a full schedule of
values across four foreign keys, and no tier-1/2/3 harness has ever driven it.

---

## B. Procurement request → RFQ → quote → PO → delivery

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Test evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | Activity | Create package | Procurement package | title, `activityId`, required-on-site date, `requiredTiming` | procurement module | `POST /procurement/packages` | `procurement.service` | `ProcurementPackage.activityId` | `procurement.create` | SMOKE | ❓ |
| B2 | Package | Tender | **RFQ** | — | — | — | — | — | — | none | ⚪ **missing** |
| B3 | Quotes | Compare | Supplier selection | — | — | — | — | — | — | none | ⚪ **missing** |
| B4 | Package / commitment | Create order | Purchase order | supplier, lines, tax, delivery terms, required date, `commitmentId` | `purchase-order-dialog` | `POST /purchase-orders` | `purchase-order.service` | `ProcurementOrder.packageId/commitmentId` | `procurement.create` | **PW-13** | ✅ |
| B5 | PO | submit → approve → issue → acknowledge | PO lifecycle | 11 derived names from 3 stored states | `purchase-orders-panel` | `POST /purchase-orders/{id}/{transition}` | `purchase-order.lifecycleStatus` | `status`,`warehouseStatus`,`invoiceStatus` | `procurement.*` transitions | **PW-13** | ✅ |
| B6 | PO lines | Recompute | PO value | lines + tax; never a typed total | `purchase-order-dialog` | same | `purchase-order.recomputeTotals` | `ProcurementOrder.value` | — | **PW-13** | ✅ |
| B7 | PO | Deliver | Delivery receipt | ordered vs accepted vs rejected per line | `goods-receipt-panel` | `POST /purchase-orders/{id}/receipts` | `goods-receipt.service` | `DeliveryReceipt.orderId` | `procurement.update` | **PW-11** | ✅ |

**B2/B3 are a genuine hole.** `Rfq.changeEventId` is a **required** column — the
RFQ is exclusively a change-event instrument. A procurement package can sit in
status `tendering`, but nothing can be tendered from it: there is no path from
a package to a vendor quote. Buyers must run that comparison outside OctaPM, or
misuse the bid module (which awards a `Commitment`, not a `ProcurementOrder`).

---

## C. PO → goods receipt → inventory → issue → activity → cost

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Test evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Delivery receipt | Post | Stock | **accepted quantity only**; rejected is recorded, never shelved | `goods-receipt-panel` | `POST /purchase-orders/{id}/receipts` | `goods-receipt.receive` → `inventory.postMovement` | `StockTransaction` type `receipt` | `inventory.create` | **PW-11** | ✅ |
| C2 | Receipt | Post | Item master | a PO line with no stocked item creates one on first delivery | `goods-receipt-panel` | same | `goods-receipt.service` | `InventoryItem` | `inventory.create` | **PW-11** | ✅ |
| C3 | Receipt | Post | Weighted-average cost | blends new receipt into the item's average | — | same | `inventory.service` | `InventoryItem.avgCost` | — | **PW-11** | ✅ |
| C4 | Receipt | Over-receive | Refusal | `RECEIPT_OVER_ORDER` | `goods-receipt-panel` | same | `goods-receipt.service` | — | — | JEST | ❓ |
| C5 | Stock | Put away | Warehouse bin | full bin path, per-location balances | `warehouses-panel` | `POST /inventory/movements` | `inventory.postMovement` | `StockBalance.locationId` | `inventory.update` | **PW-11** | ✅ |
| C6 | QR / barcode | Scan | Item + position | what it is, how much, where | `code-scanner`, `scan-workspace` | `GET /inventory/scan/{code}` | `inventory.service` | `InventoryItem.barcode` | `inventory.read` | **PW-11** | ✅ |
| C7 | Stock | Issue to activity | Ledger + balance | signed quantity, `balanceAfter`, `activityId`, `costCodeId`, value | `movement-dialog` | `POST /inventory/movements` | `inventory.drawFromWarehouse` | `StockTransaction.activityId` | `inventory.update` | **PW-11** | ✅ |
| C8 | **Material issue** | Issue posted | **`CostRecord.actual`** | **nothing — no posting exists** | — | — | — | columns present, unread | — | none | 🔴 **BROKEN** |
| C9 | **Material issue** | Issue posted | **`BudgetLine.actual`** | **nothing — no posting exists** | — | — | — | — | — | none | 🔴 **BROKEN** |

**C8/C9.** `StockTransaction` carries `activityId`, `costCodeId`, `boqItemId`,
`commitmentId`, `unitCost` and `value`, under a schema comment that reads
*"Where it went, so a cost lands on the right thing."* No service reads any of
it into cost. Material consumed on site moves stock and the ledger, and never
becomes project cost. The chain the user asked about terminates one hop early.

---

## D. PO → receipt → supplier invoice → 3-way match → payment → cost → cash flow

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Test evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Supplier invoice | Create against PO | Direct cost | vendor, invoice number, cost date, lines with `costCodeId`/`budgetLineId`/`activityId` | `direct-cost-dialog` | `POST /direct-costs` | `direct-cost.service` | `DirectCost.purchaseOrderId` | `cost.create` | SMOKE | ❓ |
| D2 | Invoice + receipt + PO | Match | Match result | `invoiced_more_than_received`, `received_more_than_ordered`, `price_variance` (0.5% tol), `rejected_on_delivery`, `short_delivered` | `match-panel` | `GET /inventory/match` | `goods-receipt.matchLine` | joins all three | `inventory.read` | **PW-11** | ✅ |
| D3 | Invoice | Approve | **`BudgetLine.actual` + `CostRecord.actual`** | line amount → budget line by name → cost code + cost type; sets **`actualThroughDate`** | `direct-cost-dialog` | `POST /direct-costs/{id}/approve` | `direct-cost.service` | `postedAmount` | `direct_cost.approve` | JEST | ❓ **high risk** |
| D4 | Invoice | Record payment | Cash flow outflow | paid amount and date | `direct-cost-dialog` | `POST /direct-costs/{id}/payments` | → `cash-flow.rebuildCashFlow` | `DirectCostPayment` | `direct_cost.pay` | JEST | ❓ |
| D5 | Invoice | Void | Reversal | decrements `postedAmount`; refused when payments exist | `direct-cost-dialog` | `POST /direct-costs/{id}/void` | `direct-cost.service` | — | `direct_cost.void` | JEST | ❓ |
| D6 | Direct cost | Any write | PO invoice status | recomputes `not_invoiced` / `partially` / `fully` | `purchase-orders-panel` | — | `purchase-order.recomputeInvoiced` | `ProcurementOrder.invoiceStatus` | — | **PW-13** | ✅ |

Chain D is **structurally complete** — it is the one full cost chain in the
system. Its weakness is evidence: the match is browser-verified, but the
posting to actual cost and cash flow is carried by mocked tests only.

---

## E. Subcontractor → bid → contract → commitment → SOV → progress → pay app → payment → cost

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Test evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | Company | Prequalify | Assessment | 9 weighted criteria → score /100, band, validity, `singleAwardLimit` | `prequalification-panel` | `POST /company/vendors/{id}/prequalification/decision` | `vendor-prequalification.service` | `VendorPrequalification` | company admin | **PW-17**, LIVE | ✅ |
| E2 | Award | Confirm | Commitment | see A6 | `commitments-panel` | `POST /bids/{id}/award/confirm` | `bid.confirmAward` | `Commitment` | `bid.award` | JEST | ❓ |
| E3 | Commitment | Define scope | Scope matrix | 6 kinds, party per row of work, starter rows seeded | `scope-matrix-panel` | `PUT /commitments/{id}/scope` | `scope-matrix.service` | `ScopeMatrixItem` | `scope.manage` | **PW-14** | ✅ |
| E4 | Records | Generate agreement | Subcontract PDF | org, vendor profile, project, SOV, approved COs, scope matrix, programme, insurances, prime-contract terms | `commitment-dialogs` | `GET /commitments/{id}/agreement.pdf` | `subcontract-agreement.service` | reads 7 tables | `commitment.read` | **PW-15** | ✅ |
| E5 | Commitment | Execute | Insurance gate | required cover present and unexpired, or override with a reason | `commitment-dialogs` | `POST /commitments/{id}/execute` | `commitment.executeCommitment` | `insuranceJson` | `commitment.execute` | JEST | ❓ |
| E6 | Commitment | Execute/close | **Committed cost** | SOV + approved COs → budget line by cost code + cost type, and per activity | `budget-panel` | — | `commitment.recomputeCommitted` | `BudgetLine.committedFromCommitments`, `CostRecord.committed` | — | JEST | ❓ |
| E7 | Approved progress | Create pay app | Claim ceiling | claim capped at approved `ActivityProgress` × scheduled amount | `pay-app-dialogs` | `POST /pay-apps` | `sub-pay-app.applyClaims` | `SubPayAppLine.capAmount` | `sub_pay_app.create` | JEST | ❓ **high risk** |
| E8 | Approved commitment CO | Create pay app | Revised SOV ceiling | approved `CommitmentChangeOrder.linesJson` entries carrying `sovLineId` raise the line's ceiling | `pay-app-dialogs` | same | `sub-pay-app.approvedChangesBySovLine` | `revisedScheduledAmount` | — | JEST | ❓ |
| E9 | Pay app | Submit | Over-claim refusal | `SUB_PAY_APP_OVER_CLAIM` unless an authorised change exists | `pay-app-dialogs` | `POST /pay-apps/{id}/submit` | `sub-pay-app.service` | — | `sub_pay_app.submit` | JEST | ❓ |
| E10 | Pay app | Approve | Compliance gate | commitment insurance + waiver, override with reason | `pay-app-dialogs` | `POST /pay-apps/{id}/approve` | `sub-pay-app.service` | — | `sub_pay_app.approve` | JEST | ❓ |
| E11 | **Closeout** | Approve final pay app | Gate | the application whose cumulative claim reaches the revised value is refused while closeout is outstanding | `closeout-panel` | same as E10 | `closeout.assertReady` + `isFinalApplication` | `SubcontractCloseout` | `sub_pay_app.approve` | **PW-16** | ✅ |
| E12 | Pay app | Record payment | Cash flow outflow | paid amount and date | `pay-app-dialogs` | `POST /pay-apps/{id}/payments` | → `cash-flow.rebuildCashFlow` | `SubPayAppPayment` | `sub_pay_app.pay` | JEST | ❓ |
| E13 | **Pay app** | Approve or pay | **`CostRecord.actual`** | **nothing — no posting exists** | — | — | — | — | — | none | 🔴 **BROKEN** |
| E14 | **Pay app** | Approve or pay | **`BudgetLine.actual`** | **nothing — no posting exists** | — | — | — | — | — | none | 🔴 **BROKEN** |
| E15 | Commitment | Close | Closeout gate | punch (scoped to vendor company), insurance, applications settled, retention released, 6 handover rows | `closeout-panel` | `POST /commitments/{id}/close` | `closeout.assertReady` | `CloseoutItem` | `commitment.close` | **PW-16** | ✅ |
| E16 | Subcontract | Evaluate | Performance score | 6 derived criteria read from NCRs, safety, punch, COs, closeout; 2 rated | `evaluation-panel` | `POST /commitments/{id}/evaluation/final` | `subcontractor-evaluation.service` | `SubcontractorEvaluation` | `evaluation.approve` | **PW-18**, LIVE | ✅ |
| E17 | Evaluation | Finalise | Prequalification history | average score + would-reuse fraction onto the vendor's next assessment | `prequalification-panel` | `GET /company/vendors/{id}/prequalification` | `evaluation.historyFor` | `companyId` rollup | authenticated | **PW-18**, LIVE | ✅ |

**E13/E14 are the single most consequential defect in the system.** The
commitment posts *committed* cost (E6) and the payment reaches *cash flow*
(E12), but nothing ever converts either into *actual*. On a project where
subcontract packages carry most of the value, `CostRecord.actual` — and
therefore CPI, EAC, the cost dashboard and portfolio health — omit the
majority of spend.

---

## F. Prime contract → progress → client certificate → invoice → payment → cash flow

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Test evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Project | First read | Prime contract | seeded from the project; BOQ stays the client SOV | `client-billing-panel` | `GET /prime-contract` | `prime-contract.ensureContract` | `PrimeContract` | `ipc.read` | **PW-12** | ✅ |
| F2 | Approved client CO | Any CO write | Revised contract value | approved only; pending reported separately, never folded in | `client-billing-panel` | — | `prime-contract` hooks on `change-order.service` | `PrimeContract.revisedValue` | — | **PW-12** | ✅ |
| F3 | Approved progress | Build period | IPC items | BOQ line × approved progress → `IpcItemProgressLink` | `ipc-workbook` | `GET /ipc/{period}` | `ipc.service` | `IpcItemProgressLink.progressId` | `ipc.read` | SMOKE | ❓ |
| F4 | IPC period | Certify | Certificate financials | gross (work + stored materials) − retention (capped) − advance recovery (never over-recovered) − deductions, **then tax on the remainder** | `client-billing-panel` | `POST /ipc/{period}/certify` | `prime-contract.certificateFinancials` | `IpcCertificate` | `ipc.certify` | **PW-12** | ✅ |
| F5 | Certificate | Record receipt | Cash flow inflow | amount and date | `client-billing-panel` | `POST /ipc/{id}/payments` | `cash-flow` reads `IpcPayment` | `IpcPayment` | `ipc.pay` | **PW-12** | ✅ |
| F6 | Invoices | Age | Receivables | ages from due date, falling back to contract payment terms | `client-billing-panel` | `GET /prime-contract/receivables` | `prime-contract.service` | — | `ipc.read` | **PW-12** | ✅ |
| F7 | Certificate | Certify | **Revenue ledger** | none — revenue exists only as cash-flow inflow | — | — | — | — | — | none | ⚪ |

Chain F is the **best-evidenced chain in the system** and the model the others
should follow.

---

## G. RFI → change event → RFQ → quote → change order → budget → forecast

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Test evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | RFI | Convert to change | **Change order** (draft) | `costImpactAmount` → `value`, `scheduleImpact`; second conversion refused 409 | `rfi-detail-dialog` | `POST /rfi/{id}/convert-to-change` | `rfi-workflow.convertToChangeEvent` | `Rfi.changeOrderId` | `rfi.update` | **QA-03** | ✅ |
| G2 | **RFI** | — | **Change event** | **no path** — the endpoint named `convert-to-change` produces a ChangeOrder | — | — | — | — | — | **QA-03** | ⚪ **GAP-INT-001** |
| G3 | Change event | Create | Event + lines | type, origin, ROM, lines with `costCodeId`/`budgetLineId`/`activityId`/`commitmentId` | `change-event-dialog` | `POST /change-events` | `change-event.service` | `ChangeEventLine` | `change_event.create` | **QA-03** | ✅ |
| G4 | Change event | Send RFQs | Vendor RFQ | line subset, hashed token, due date | `change-event-dialog` | `POST /change-events/{id}/rfqs` | `change-event.sendRfqs` | `Rfq.changeEventId` | `change_event.rfq_send` | JEST | ❓ |
| G5 | Vendor portal | Quote | Quote lines | amount per line, notes, validity, lead time | `portal/rfq-portal` | `POST /public/rfqs/{token}/quote` | `change-event.service` | `Rfq.quoteLinesJson` | token-scoped | JEST | ❓ |
| G6 | Quote | Accept | Line prices + commitment CO | `quotedAmount` per line; optionally raises a `CommitmentChangeOrder` | `change-event-dialog` | `POST /change-events/rfqs/{id}/accept` | `change-event.acceptQuote` | `quotedRfqId` | `change_event.update` | JEST | ❓ |
| G7 | Change event | Convert | Change order | value intact, `changeEvent.changeOrderId` set, event → `converted` | `change-event-dialog` | `POST /change-events/{id}/convert` | `change-event.convertToChangeOrder` | both link columns | `change_order.create` | **QA-03** | ✅ |
| G8 | Change order | Submit | Governance refusal | `CHANGE_ORDER_IMPACT_SUMMARY_REQUIRED`, then `IMPACT_PROOF_REQUIRED` until an affected activity **and** a cited document exist | `change-order-form` | `POST /change-orders/{id}/submit` | `change-order.service` | `CommercialAttachmentRef` | `change_order.submit` | **QA-03**, **PW-03** | ✅ |
| G9 | Change order | Approve | **Revised budget** | value → `BudgetLineChange`; original unchanged | `budget-panel` | `POST /change-orders/{id}/approve` | `budget.applyChangeOrderToBudgetLines` | `BudgetLine` revised | `change_order.approve` | **PW-03**, **PW-04**, **QA-03** | ✅ |
| G10 | Budget + EV | Read | Forecast | budget lines + official EV → projected overrun | `forecast-panel` | `GET /forecast` | `forecast.buildForecast` | read-only | `schedule.read` | SMOKE | ❓ |

**G2 is a structural gap, not a bug.** RFIs are the most common origin of a
variation, and they bypass the only record type that can raise RFQs. An
RFI-born variation therefore cannot be competitively priced inside OctaPM.

---

## H. Drawings and specifications

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Test evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1 | Sheet | Drop pin → RFI | RFI | sheet, page, x/y, subject; or links an existing RFI | `sheet-viewer`, `pin-dialog` | `POST /sheets/{id}/pins` | `markup.service` → `rfi.service` | `Pin.recordType` | `document_control.update` | JEST | ❓ |
| H2 | Sheet | Drop pin → punch | Punch item | same, raising a `PunchItem` | `pin-dialog` | same | `markup.service` → `punch.service` | `Pin` | `punch.create` | JEST | ❓ |
| H3 | Drawing set | Publish | Sheet revisions | match by number, supersede previous, audit, notify | `drawing-set-review` | `POST /drawings/sets/{id}/publish` | `drawing-set.service` | `SheetRevision` | `drawing.publish` | JEST | ❓ |
| H4 | Sheet PDF | Parse | Sheet references | callouts (`3/A-501`) deduped; `looseKey` treats A-101/A 101/A101 as one | `sheet-references` | `GET /sheets/{id}/references` | `drawing-assistant` | `SheetReference` | `document_control.read` | JEST | ❓ |
| H5 | Spec document | Index | Spec sections | CSI parse, char offsets into `DocumentText`, page range | `specifications-panel` | `POST /specifications/index` | `specification.service` | `SpecSection` | `document_control.update` | SMOKE | ❓ |
| H6 | Spec section | Raise RFI | RFI (draft) | `specSection`, discipline | `raise-rfi-dialog` | `POST /specifications/{id}/rfi` | `specification.raiseRfi` | `Rfi.specSection` | `rfi.create` | JEST | ❓ |
| H7 | **Spec section** | — | **Submittal** | **no path** | — | — | — | — | — | none | ⚪ |
| H8 | **Spec section** | — | **Procurement** | **no path** | — | — | — | — | — | none | ⚪ |
| H9 | Submittal | Approve | Schedule impact | lead time → `WorkflowActivityLink` `submittal_lead_time` | `submittal-detail-dialog` | `POST /submittals/{id}/decide` | `submittal-workflow.applyScheduleImpact` | `WorkflowActivityLink` | `submittal.approve` | JEST | ❓ |

**H7/H8.** Specifications index and can raise RFIs, but the submittal register
they should drive is unconnected. Submittal registers are conventionally built
from the spec — here they are typed by hand.

---

## I. Schedule → progress → earned value → forecast

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Test evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I1 | Import / manual | Create | Activities + WBS | XER / P6 XML / MSP XML; hours ÷ 8 = days | `schedule-dashboard` | `POST /import` | `import.service`, `parsers/*` | `Activity`, `WbsNode` | `schedule.create` | JEST | ❓ |
| I2 | Activities | Recalculate | CPM | early/late dates, total float; TF = 0 → critical | gantt | `POST /schedule/cpm` | `cpm.service` | `Activity.totalFloat` | `schedule.update` | **PW-10** | ✅ |
| I3 | BOQ | Allocate | Activity value | `ActivityBoqAllocation.amount` = the EV basis | `boq` module | `POST /activity-boq-allocations` | `activity-boq-allocation.service` | allocation | `boq.update` | SMOKE | ❓ |
| I4 | Site | Submit progress | `ActivityProgress` | pct, quantity, milestone, inspection or manual method | `site-reporting` | `POST /progress` | `progress.service` | `ActivityProgress` | `progress.create` | **QA-03** | 🟡 |
| I5 | Progress | Approve | Approved pct | draft/submitted/rejected excluded from EV | `site-reporting` | `POST /progress/{id}/approve` | `progress.service` | `status` | `progress.approve` | **QA-03** | 🟡 |
| I6 | Approved progress | Read | **EV** | `EV = Σ(allocation.amount × approved pct / 100)` | `cost-dashboard` | `GET /reports/ev` | `earned-value.buildOfficialEvReport` | read-only | `cost.read` | **QA-03** | 🟡 |
| I7 | `CostRecord.actual` | Read | **AC** | `AC = Σ(latest actual where actualThroughDate ≤ cutoff)` | `cost-dashboard` | same | `earned-value.service` | `actualThroughDate` | `cost.read` | JEST | 🔴 *(understated — see E13, C8)* |
| I8 | EV + AC | Compute | SPI · CPI · EAC | SPI = EV/PV, CPI = EV/AC, EAC = budget/CPI | `cost-dashboard` | same | `earned-value.computeEvMetrics` | — | `cost.read` | JEST | 🔴 *(inherits I7)* |
| I9 | EV + budget | Read | Forecast | projected finish and overrun, narrated | `forecast-panel` | `GET /forecast` | `forecast.service` | read-only | `schedule.read` | SMOKE | 🔴 *(inherits I8)* |
| I10 | Activities | Seed | Lookahead | window from actuals > CPM early dates > planned dates; PPC per week | `lookahead-board` | `POST /lookaheads` | `lookahead.service` | `LookaheadItem` | `lookahead.create` | SMOKE | ❓ |

**I7–I9 are marked 🔴 rather than ❓ deliberately.** The code runs and returns a
number. The number is wrong, because its inputs are missing two cost
categories. A metric that is confidently wrong is more dangerous than one that
fails.

The QA harness recorded I4–I6 as 🟡 for a different reason: approved progress
rows exist and the dashboard renders, but the dashboard exposes `overallScore`
and `dimensions` rather than a percent complete, so a like-for-like check
against source rows was not possible.

---

## J. Inspection → NCR / punch → subcontractor → correction → closure

| ID | Source | Trigger | Target | Data transferred | Frontend | API | Service | Database | Permission | Test evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| J1 | Company template | Seed | Project inspection | starter ITP templates | `inspections` | `POST /forms/templates/starters` | `form.service` | `FormTemplate.isSystem` | `inspection.create` | **QA-03** | ✅ |
| J2 | Inspection | Fail an item | Punch item / observation | description, location, `assigneeCompanyId`, `sourceRecordType` | `inspections` | `POST /forms/{id}/items/{itemId}/deficiency` | `form.raiseDeficiency` → `punch.service` | `PunchItem.sourceRecordId` | `punch.create` | **QA-03** *(endpoint reached; the seeded template produced no failable items)* | 🟡 |
| J3 | **Inspection** | Fail an item | **NCR** | **no path** — deficiencies raise punch items or observations only | — | — | — | — | — | none | ⚪ |
| J4 | Inspection | Open hold point | Progress refusal | `ITP_HOLD_POINT_OPEN` blocks client progress approval | `site-reporting` | `POST /progress/{id}/approve-with-client` | `form.openHoldPoints` | — | `progress.approve` | JEST | ❓ |
| J5 | Punch / NCR | Assign | Subcontractor | `assigneeCompanyId` | `punch` module | `PATCH /punch/{id}` | `punch.service` | `PunchItem.assigneeCompanyId` | `punch.update` | JEST | ❓ |
| J6 | Punch | Ready for review → closed | Closure | transition rules, party visibility | `punch` module | `POST /punch/{id}/transition` | `punch.service` | `PunchItemEvent` | `punch.update` | JEST | ❓ |
| J7 | Open punch | Read | **Closeout gate** | open items for that company block the subcontract closing | `closeout-panel` | `GET /commitments/{id}/closeout` | `closeout.punchState` | scoped by company | `commitment.read` | **PW-16** | ✅ |
| J8 | NCR + punch + safety | Read | **Performance evaluation** | counts by severity, closure timeliness | `evaluation-panel` | `GET /commitments/{id}/evaluation` | `subcontractor-evaluation.evidenceFor` | `assigneeCompanyId` | `commitment.read` | **PW-18**, LIVE | ✅ |

The far end of this loop is the strongest part: quality records are read
automatically into the two gates that matter to a subcontractor — whether they
can close out, and what their record says next time they bid. The near end
(inspection → NCR) has a missing path, and the middle (assign → correct →
reinspect → close) has no tier-1/2/3 evidence at all.

---

## K. Cross-cutting nerves

| ID | Nerve | Coverage | Evidence | Status |
| --- | --- | --- | --- | --- |
| K1 | Multi-tenant isolation | every query scoped by `orgId` | **QA-01** — 8 cross-tenant reads + 1 write refused, no stray row | ✅ |
| K2 | Permission policy | 37 modules, role + party + template | **QA-02** — 224 probes, 0 mismatches | ✅ |
| K3 | Audit | 60+ entity types; company-level events allowed since the `projectId` nullability fix | **QA-04** | ✅ |
| K4 | Notifications | 22 services publish; categories, preferences, push, email | JEST + **PW-01** | 🟡 |
| K5 | Workflow engine | 8 tools; `assertNotLocked` guards record services | **QA-03** | ✅ |
| K6 | Report builder | 20+ sources, permission-filtered per caller | JEST *(a prior pass found `listSources` returned un-awaited)* | ❓ |
| K7 | Search | permission-gated; outsider gets `items: []` | **QA-01** | ✅ |
| K8 | Attachments | canonical record-type → module map | JEST | ❓ |
| K9 | Offline outbox | `sendOrQueue`, `clientRequestId` idempotency | JEST | ❓ |
| K10 | Realtime | socket.io rooms per project and user | **PW-01** | 🟡 |
| K11 | Module visibility | `MODULE_PERMISSIONS` gates the workspace nav | **PW-06** — a role without commercial is not offered it | ✅ |
| K12 | Module visibility gaps | `reports` gated by `schedule`; `commercial` omits `bid`/`change_event`; `inventory`, `conversation`, `timesheet`, `risk`, `task`, `lookahead` ungated | code inspection | 🟡 |

---

## Summary counts

Counted from the rows above, not estimated: **104 nerves**.

| Status | Rows | Share |
| --- | --- | --- |
| ✅ Verified | 41 | 39% |
| ❓ Untested | 41 | 39% |
| 🟡 Partial | 8 | 8% |
| ⚪ Missing | 7 | 7% |
| 🔴 Broken | 7 | 7% |

Read that ❓ figure carefully: it is not "probably fine". It is **41 nerves** —
the same number as the verified ones — that carry money, contracts or schedule
impact and have never been driven end to end outside a mock, in a codebase
where every live pass so far has found defects that mocks could not see.

The 7 🔴 rows are not seven independent bugs. They are **two** missing cost
postings (E13/E14 and C8/C9) plus the three metrics that inherit them
(I7/I8/I9).
