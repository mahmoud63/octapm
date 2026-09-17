# OctaPM Workflow Guide

How work moves through OctaPM. Every workflow below names who starts it, what they do, who receives
it, what changes, which modules update, who approves and what the final state is. Roles named are
the roles the product's permission policy allows; the company administrator can widen or narrow
them with a permission template on a project.

Click paths start from **Workspace** (Workspace Control) and follow the module bar. "Quick path"
is the one-click start on Workspace Control where the product offers one.

Two diagrams show how the workflows join up.

```
Material requirement (Schedule)
        ↓
Procurement package            RFQ / bid package (Commercial → Bids)
        ↓                              ↓
Purchase order  ←── award ───── Supplier quotes (portal)
        ↓
Goods receipt (Inventory → Goods in)
        ↓
Stock on hand
        ↓
Material issue to an activity
        ↓
Actual Cost  →  Cost Control, Forecast, Reports
```

```
RFI  →  Official answer  →  Change order (with the RFI's letter as evidence)
                                    ↓
                              Submit → PM approval
                                    ↓
                     Revised Budget on the named line  →  Forecast  →  Reports
```

---

## 1. RFI lifecycle

```
Site Engineer            Person asked              Project Manager
   raise RFI      ──►   write the answer   ──►   close with a decision
                                │
                                ▼
        Needs You · Notifications · Doc Control register · Overview counts
```

**Who starts it.** Site Engineer, Planner, Quality Engineer or PM.

**Click path.** Workspace → Project → Doc Control → RFI → **New RFI**. Quick path: Workspace →
Quick actions → **New RFI** (opens the form on the project chosen in the block).

**What they do.** Enter the subject and the question; optionally the activity, the party asked,
the priority and the date an answer is needed; attach drawings or photos. Save. The register
gives the RFI a number and shows who holds it.

**Who receives it.** The person the RFI is assigned to (the design lead, the PM or the party's
contact): a Needs You item and an "Awaiting …" row, without a refresh.

**What they do next.** Open **Details**, write the reply in **Reply**, send it. The PM (or the
owner) then **Close**s the RFI with a decision note; a reopen is possible.

**What changes.** Status open → answered → closed; ball in court moves at each step; the audit
history records who answered and who closed.

**Modules that update.** Doc Control (register, detail), Workspace Control (Needs You for both
people), Notifications, project Overview counts; a change order raised afterwards can cite the
RFI's attachments as evidence.

**Who approves.** Closing is the PM's decision (`rfi.close`); reopening too.

**Final state.** Closed. The RFI and its answer stay on record; the site engineer sees the closure
in the register within a second.

Screens: `images/rfi_start.png`, `images/rfi_new_form.png`, `images/rfi_created.png`,
`images/rfi_detail_answer.png`, `images/rfi_closed.png`.

## 2. Change order lifecycle

```
QS or Project Manager        Project Manager         Cost Control
   raise change order   ──►    approve or reject  ──►  Revised Budget
          │                                                  │
   evidence: RFI answer, photos                    Forecast · Reports
```

**Who starts it.** QS (or PM).

**Click path.** Workspace → Project → Commercial → Change Orders → **Add Change Order**. Quick
path: Workspace → Quick actions → **New change order**.

**What they do.** Describe the change, give it a category and value, the schedule impact in days,
a schedule impact summary and a cost impact summary, tick the activities it affects, choose the
**budget line** the value should land on (or split it across lines; leaving "Change orders line
(decide later)" parks it on the project's holding line), and pick the **supporting documents** —
from the register or from files already attached to another record, such as the RFI's instruction
letter. **Create**, then **Submit**. The register refuses to submit until activities, evidence and
both impact summaries are in ("Needs proof").

**Who receives it.** The PM: the change appears in the register's approval queue ("1 pending") and
in the PM's Needs You.

**What they do next.** **Approve** (with a note) or **Disapprove** (with a reason, which sends it
back to the QS).

**What changes when you approve.** Approved changes and Revised Budget rise by the value; the named
budget line's "Changes" column carries it (or the split does); Forecast follows the revised budget;
the register shows Approved with the approver and the date; the audit history records the
approval; the QS sees it within a second.

**Modules that update.** Commercial (register, queue), Cost Control (Overview budget block, Budget
tab, By Activity), Forecast, Reports, Workspace KPIs, Notifications.

**Who approves.** PM (`change_order.approve`). Reopen: PM or QS.

**Final state.** Approved (or Rejected, back with the QS). An approved change cannot be edited; its
line and split are locked.

Screens: `images/change_order_form.png`, `images/change_order_created.png`,
`images/change_order_pm_register.png`.

## 3. Schedule progress

**Who starts it.** Site Engineer (also Planner, Quality Engineer, PM).

**Click path.** Workspace → Project → Schedule → Progress; or Capture (the fast-entry screen) from
More. Daily logs: Site Reporting → Daily log.

**What they do.** Record percent complete per activity (or quantities, depending on the method the
planner configured) and **Submit** the progress submission.

**Who receives it.** Planner or PM (the QS may also approve): Needs You and the submission queue.

**What changes when approved.** Approved progress becomes the official progress: Earned Value, SPI
and CPI, activity status (To Do, In Progress, Complete, Delayed), the critical path and the
Workspace KPIs ("Critical activities", "delayed by latest approved progress") update. Pending
submissions stay in "Pending review", apart from the official figures.

**Who approves.** PM, Planner or QS (`submission.approve`); daily logs, site diaries and daily
reports are approved by the PM.

**Final state.** Approved submission; the schedule reflects it.

## 4. BOQ → Budget

**Who starts it.** QS or Planner (PM).

**Click path.** Workspace → Project → BOQ (bill of quantities); allocations to activities on the
same page; then Cost Control → Budget.

**What they do.** Load or enter the bill; allocate each item's value to schedule activities
(**allocation.submit**); the PM or QS approves the allocation. In Cost Control → Budget, adopt the
company's cost codes (**Cost codes** → tick → **Apply**) and **Add line** for each cost code and cost
type with its original budget.

**What changes.** Approved allocations give each activity its budget share (Cost Control → By
Activity); budget lines set the Original Budget; the Budget tab notes if the budget and the bill do
not agree ("Off by …").

**Who approves.** PM or QS (`allocation.approve`).

**Final state.** An original budget by line, allocated to activities, ready for commitments and
actuals.

## 5. RFQ → Bid → Award

```
Procurement            Suppliers (portal)         Procurement
  bid package    ──►    price and submit   ──►   compare and award
       │                                               │
  invitations sent                            winning bid becomes a commitment
```

**Who starts it.** Procurement or QS (PM).

**Click path.** Workspace → Project → Commercial → Bids → **New package**.

**What they do.** Give the package a title, description, instructions, due date and currency; add
the bid form lines (description, unit, quantity, estimate); invite bidders from the company
directory (an unprequalified vendor is refused unless the PM records an override reason);
**Publish**. Each bidder receives an invitation link.

**Who receives it.** The bidders, through the supplier portal (no login): they price the lines,
save a draft, sign and submit, ask questions, and may withdraw and resubmit until the due date.
Questions come back to the buyer (`bid.answer`).

**What they do next.** Leveling compares the bids; the PM records a **soft award** (internal
recommendation) and then **confirms the award**.

**What changes when the award is confirmed.** A commitment (subcontract or purchase order, as the
package was set) is raised from the winning bid's priced lines; the winning bidder's portal reads
"This package was awarded to you"; other bidders are told the package closed.

**Modules that update.** Commercial (Bids, Commitments), Cost Control (Executed commitments once the
commitment is executed), the portal.

**Who approves.** Publish: PM or Procurement (`bid.publish`); award: PM (`bid.award`).

**Final state.** Awarded, with a commitment on the register.

Screens: `images/commercial_bids.png`, `images/supplier_portal_start.png`,
`images/supplier_portal_priced.png`, `images/supplier_portal_submitted.png`,
`images/bids_register_after_submission.png`.

## 6. Award → Purchase Order

```
Award                Procurement package            Purchase order
  decision   ──►   quantities and prices   ──►   issued to the supplier
                                                        │
                                                 Commitment on the budget line
```

**Who starts it.** Procurement (Planner may submit).

**Click path.** Workspace → Project → Procurement → Packages → the package → the order; or
Procurement → Purchase Orders for orders already raised. A package is created from a material
requirement on the schedule (Schedule → Long Lead / material plan), which gives it the date it is
needed on site and its order-by date.

**What they do.** Draft the order (supplier, lines, prices, needed-on-site date), **submit** it for
approval, **issue** it once approved, and record the supplier's **acknowledgement**.

**Who receives it.** The PM approves (`po.approve`); the supplier acknowledges; the storekeeper
receives; Finance matches the invoice.

**What changes.** PO value on the Purchase Orders KPI; Executed commitments once issued; the
register's "Waiting on you" counts; the row says who holds the order ("Awaiting the supplier — to
acknowledge").

**Final state.** Issued and acknowledged, waiting for delivery.

Screens: `images/procurement_packages.png`, `images/procurement_purchase_orders.png`.

## 7. Purchase Order → Goods Receipt

```
Delivery arrives        Storekeeper              Three-way match
   at the gate    ──►   receive against PO  ──►  PO · receipt · invoice
                              │
                              ▼
                     Stock on hand rises
```

**Who starts it.** Storekeeper (Procurement and PM may also post).

**Click path.** Workspace → Inventory → **Goods in**; or from the order's **Receive delivery** link
on Procurement → Purchase Orders, which opens Goods in with the order already looked up.

**What they do.** Scan or type the order number, check the lines the delivery covers, enter
accepted and rejected quantities, choose the store, and **Post**.

**What changes.** The order's delivery status becomes Partially delivered or Delivered; the buyer's
Purchase Orders list follows within a second; stock on hand rises in the chosen store at the
order's unit cost (weighted average); the receipt is numbered (GRN) and kept.

**Modules that update.** Inventory (Items, Warehouses, Ledger, Dashboard), Procurement (Purchase
Orders), Match (three-way match).

**Who approves.** Nobody; posting is the storekeeper's act (`receipt.post`).

**Final state.** Delivered; stock on the shelf.

Screens: `images/goods_receipt_start.png`, `images/goods_receipt_order_found.png`,
`images/goods_receipt_posted.png`, `images/inventory_items_after_receipt.png`.

## 8. Goods Receipt → Inventory

```
Goods receipt   ──►   Warehouse stock   ──►   Material issue to an activity
                                                        │
                                                        ▼
                                                  Actual Cost on that activity
```

What the receipt leaves behind: the item's on-hand and available quantities, its average cost and
stock value on Inventory → Items and Dashboard; the store and bin on Warehouses; the movement on
the Ledger. Reorder levels flag items that fall below.

## 9. Inventory → Material Issue

**Who starts it.** Storekeeper (Site Engineer and Quality Engineer may issue; PM).

**Click path.** Workspace → Inventory → Items → **Issue** on the item's row.

**What they do.** Choose the store, the quantity and the activity the material is for; confirm.

**What changes.** Stock on hand falls; the issue is posted to the Actual Cost Ledger at the
weighted average cost, against the activity's budget line; Actual Cost rises on Cost Control.

**Final state.** Issued; the movement is on the Ledger.

## 10. Material Issue → Actual Cost

Every issue writes one entry to the Actual Cost Ledger. Cost Control → Overview "Actual cost", the
Budget tab's Actual column, By Activity and the Forecast read from the ledger, so the figure is the
same on every screen and cannot be typed. Returns to store reverse the entry.

## 11. Direct Cost

**Who starts it.** Cost Controller or QS (PM).

**Click path.** Workspace → Project → Cost Control → Direct Costs → **New direct cost**. Quick path:
Workspace → Quick actions → **New direct cost**.

**What they do.** Record the vendor, reference, date and lines (cost code, activity, amount), attach
the invoice, and **submit**.

**Who receives it.** PM or Finance approve (`direct_cost.approve`) and mark it paid
(`direct_cost.pay`); void is theirs too.

**What changes when approved.** The cost posts to the Actual Cost Ledger; Actual Cost and Forecast
update; the cost controller's Cost Overview follows within seconds.

**Final state.** Approved, then Paid (Cash Out).

Screen: `images/cost_direct_costs.png`.

## 12. Timesheet → Labour Cost

```
Site Engineer          Project Manager           Cost Control
  hours worked   ──►   approve the sheet  ──►   Actual Cost (labour)
                                                      │
                                              Forecast · Earned value
```

**Who starts it.** Site Engineer (Planner, Quality Engineer, PM).

**Click path.** Workspace → Project → Site Reporting → Timesheets → **New timesheet**.

**What they do.** Pick the crew (crews and workers are kept under the same tab), add the workers'
hours against activities and cost codes, save, and **Submit**.

**Who receives it.** Cost Controller or PM (`timesheet.approve`, `timesheet.reject`).

**What changes when approved.** Labour cost posts to the Actual Cost Ledger against the activity and
cost code; Actual Cost rises; productivity figures update.

**Final state.** Approved; reopen is the approver's.

Screen: `images/site_reporting_timesheets.png`.

## 13. Subcontract → Pay Application

```
Subcontract        Subcontractor's work        QS certifies
  commitment  ──►   pay application     ──►   the value done
                                                    │
                                                    ▼
                                      Actual Cost  ──►  payment  ──►  Cash flow
```

**Who starts it.** QS (PM). A subcontract is a commitment: Commercial → Commitments, drafted by QS or
Procurement, approved by the PM (`commitment.approve`), executed by the PM or Finance.

**Click path.** Workspace → Project → Commercial → Pay Applications → **New application**.

**What they do.** Choose the commitment and the period, enter the claim against the schedule of
values (this period, previous, remaining), deductions and materials on site, and **submit** the
claim on the subcontractor's behalf (`sub_pay_app.submit`).

**Who receives it.** QS reviews (`sub_pay_app.review`) and may reject; the PM approves
(`sub_pay_app.approve`), which is the certification.

**What changes.** The application's status moves Draft → Submitted → Approved; retention is held
at the contract rate; the row says who holds it ("Awaiting finance — payment").

## 14. Certification → Actual Cost

When a pay application is approved (certified), the certified gross posts to the Actual Cost
Ledger against the commitment's budget lines. Actual Cost and Forecast rise; retention held is
shown on the application and on Cash Flow.

Screen: `images/commercial_pay_apps.png`.

## 15. Payment → Cash Flow

**Who starts it.** Finance (PM).

**Click path.** Commercial → Pay Applications → the application → **Pay**.

**What they do.** Record the payment (amount, date, reference); the accounting export is available
for the ledger.

**What changes.** Cash Out rises; the application reads Paid; Actual Cost does **not** post again —
the cost was posted at certification. Retention release (`retention.release`) is Finance's.

**Final state.** Paid.

Screen: `images/commercial_cash_flow.png`.

## 16. Client Valuation (IPC)

```
Work done      QS prepares       Client certifies      Finance
  on site  ──►  the valuation  ──►  the amount    ──►  invoice and receipt
                                                             │
                                                        Cash In · Cash flow
```

**Who starts it.** QS (PM).

**Click path.** Workspace → Project → Commercial → IPC (and Client Billing for the statement;
Contract for the terms).

**What they do.** Set the contract terms once (retention, retention cap, advance, recovery,
materials on site, tax, payment terms: `contract.manage`); create the period (`period.create`),
value the items, add adjustments, and **submit** the period.

**Who receives it.** PM or Finance certifies (`period.certify`).

**What changes.** The certificate bills gross less retention, advance recovery and deductions, then
tax; Client Billing shows contract, previous, this period and remaining; approved change orders
move the revised contract value, pending ones do not.

## 17. Client Invoice

Finance or the PM **issues the invoice** for the certified period (`invoice.issue`). Receivables
age from the due date and are reported on Client Billing and Cash Flow.

## 18. Client Receipt

Finance **records the payment** received (`payment.record`) and any advance (`advance.record`);
Cash In rises; the advance is recovered at the contract rate and never over-recovered. Actual
Cost is unchanged by any client money.

Screens: `images/commercial_client_billing.png`, `images/commercial_ipc.png`.

## 19. Inspection → NCR

```
Quality Engineer        Work inspected          Non-conformance
   raise inspection  ──►   pass or fail   ──►   NCR raised on failure
                                                       │
                                                       ▼
                                          Assignee · corrective action
```

**Who starts it.** Site Engineer or Quality Engineer (Planner, QS, PM may start and sign).

**Click path.** Workspace → Project → Quality → Inspections; templates under Company → Inspection
templates.

**What they do.** Start the inspection from a template, complete the checks, sign; a failed
inspection is closed by the Planner, Quality Engineer or PM and, where work does not conform, an
NCR is raised from Quality → NCR → **New NCR…** naming the inspection in its description.

**What changes.** Quality Score falls with major NCRs and failed inspections; the dashboard's
"Failed ITP" and "Major NCR" counts move.

## 20. NCR → Corrective Action → Closeout

```
NCR raised        Assignee fixes          Quality Engineer
   on a party  ──►  and submits closeout ──►  approves the closeout
                                                     │
                                                     ▼
                                   Closed · quality score · Overview counts
```

**Who starts it.** Quality Engineer (Site Engineer, Planner, PM).

**Click path.** Workspace → Project → Quality → NCR → **New NCR…**.

**What they do.** Describe the non-conformance, set severity (minor or major), the activity, the
**responsible person** and **responsible company**, and the due date. Raise.

**Who receives it.** The responsible person: a Needs You item and, on the Quality dashboard, the
NCR row with **Submit closeout** — whatever their role.

**What they do next.** Submit the corrective action with photo or file evidence and a closure
comment (**Upload & submit**).

**Who approves.** Quality Engineer or PM: **Approve** (closes) or **Reject** (back to the
responsible person); reopen later if needed.

**What changes.** open → submitted → closed; the item leaves the responsible person's Needs You when
approved; Quality Score recovers; the audit history keeps the evidence and the decision.

Screens: `images/ncr_new_dialog.png`, `images/ncr_raised.png`, `images/needs_you_assignee.png`,
`images/ncr_closeout_dialog.png`, `images/ncr_closeout_submitted.png`,
`images/ncr_approve_start.png`, `images/ncr_closed.png`.

## 21. Punch lifecycle

**Who starts it.** Site Engineer, Quality Engineer, Planner, PM.

**Click path.** Workspace → Project → Quality → Punch list → **New item** (or from a walk-through,
or by dropping a pin on a drawing).

**What they do.** Describe the item, assign the responsible company and person, set priority and
due date; **Distribute** the list to the companies.

**Who receives it.** The responsible company's person: fixes it and marks it **ready for review**;
a dispute is possible.

**Who approves.** Quality Engineer or PM **close** it (`punch.close`); reopen and void as needed.

**What changes.** "Open punch items" on the dashboard; "In dispute", "Ready for review" and
"Overdue" counts.

Screen: `images/quality_punch_list.png`.

## 22. Document review

**Who starts it.** Site Engineer, Planner, Quality Engineer, PM.

**Click path.** Workspace → Project → Doc Control → Drawings (or Specifications).

**What they do.** Upload a revision (`document.revision.upload`) and submit it for review; the PM
approves or supersedes it; drawings are published by the Planner or PM (`drawing.publish`). Doc
Control → Transmittals records what was sent to whom; Correspondence logs letters.

**What changes.** The register shows the current revision and its status; earlier revisions stay
on record; content search (Doc Control → Search) finds text inside the documents.

## 23. Submittal review

**Who starts it.** Site Engineer, Planner, Quality Engineer, PM.

**Click path.** Workspace → Project → Doc Control → Submittals.

**What they do.** Create the submittal (type, spec section, the party it goes to), attach the
document, **submit**. Reviewers (Planner, QS, PM) review; the PM approves or rejects; a rejected
submittal is resubmitted. Review steps can follow a workflow template set under Company →
Submittal workflows.

**Final state.** Approved (or rejected, with the reason).

Screen: `images/doc_control_submittals.png`.

## 24. Meetings → Actions → Tasks

```
Meeting held      Actions agreed         Owner's task list
  and minuted  ──►  with an owner   ──►   appears in Needs You
                                                │
                                                ▼
                                     Closed when the action is done
```

**Who starts it.** PM or Planner.

**Click path.** Workspace → Project → Meetings → new meeting; Tasks from Workspace → Tasks or the
quick action **New task**.

**What they do.** Record the meeting, attendees and agenda; capture actions with an owner and due
date; **distribute** the minutes (`meeting.distribute`). Actions become tasks the owners see in
Tasks and in Needs You; anyone on the team can comment; the assignee or the PM closes the task.

**Final state.** Distributed minutes; closed tasks.

Screens: `images/meetings.png`, `images/tasks.png`.

---

## What updates where

| When this is approved or posted | Cost Control | Commercial | Procurement / Inventory | Schedule | Quality / Docs | Workspace |
| --- | --- | --- | --- | --- | --- | --- |
| Change order | Revised Budget, line "Changes", Forecast | register, queue | | | | KPIs, Needs You |
| Goods receipt | | | order Delivered, stock, ledger, match | | | procurement risks |
| Material issue | Actual Cost | | stock, ledger | | | cost actuals |
| Direct cost | Actual Cost, Forecast | | | | | cost actuals |
| Timesheet | Actual Cost (labour) | | | | | |
| Pay application certified | Actual Cost, retention | application status | | | | Needs You (finance) |
| Payment | Cash Out | Cash Flow | | | | |
| Progress submission | | | | EV, SPI, CPI, status, critical path | | critical activities |
| NCR closed | | | | | Quality Score, counts | Needs You cleared |
