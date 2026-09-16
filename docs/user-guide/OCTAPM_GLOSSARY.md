# OctaPM Glossary

Plain-language definitions of the terms you meet in OctaPM. Where a term has a precise meaning in
the product, the definition says which screen shows it and where the figure comes from.

## Money and budget

**Original Budget.** The approved starting budget of the project, as the budget register states it,
line by line. Shown on Cost Control → Overview and Budget. It changes only through a budget revision.

**Approved Change.** The value of a change order (variation) once it has been approved. Approved
changes are added to the Original Budget to give the Revised Budget. Each approved change lands on
the budget line it names (or is split across lines); a change with no line named waits on the
project's "Change orders" holding line.

**Revision (budget revision or transfer).** A change to the budget that is not a client variation:
moving money between lines, or correcting the budget. Recorded on Commercial → Budget Revisions.

**Revised Budget.** Original Budget + Approved Changes + Revisions. The figure the project is now
allowed to spend against.

**Activity budget.** The share of the budget allocated to a schedule activity through the BOQ.
Cost Control → By Activity compares it with the activity's actual cost.

**Executed Commitment.** The value of subcontracts and purchase orders that have been executed
(signed, issued). This is money the project has promised, not yet necessarily spent. Shown on Cost
Control, the Budget register, the Commitments panel and the Forecast as "Executed commitments".

**PO Value.** The value of purchase orders that are neither planned nor cancelled. Shown on the
Purchase Orders page. A PO value becomes an Executed Commitment when the order is issued.

**Committed (manual).** A figure a person types onto a budget line, kept apart from the executed
commitments the system works out. Rarely needed; used for commitments held outside OctaPM.

**Certified Cost.** The value certified on a subcontractor's pay application (the work approved for
payment, before retention). Certification posts the value to Actual Cost.

**Actual Cost.** What the project has actually consumed, worked out from the Actual Cost Ledger:
certified subcontract work, materials issued from stores, direct costs, and approved labour
timesheets. It cannot be typed; it is always the sum of posted entries.

**Actual Cost Ledger.** The system record behind Actual Cost. Every certification, material issue,
direct cost and approved timesheet writes one entry to it, against a budget line and an activity.

**Forecast / EAC (Estimate at Completion).** What the project is expected to cost in the end:
Revised Budget on lines where nothing is committed yet, and the larger of commitment and actual on
lines that are. Shown on Cost Control → Overview and Schedule → Forecast.

**Variance.** Revised Budget minus Forecast. Negative means the project is expected to overspend.

**Retention.** The percentage held back from each subcontractor certificate (and from each client
invoice) until the work is complete. Shown on pay applications, IPCs and cash flow.

**Direct Cost.** A cost the project pays directly (an invoice, a hire, an expense) rather than
through a subcontract or a stores issue. Recorded on Cost Control → Direct Costs; posts to Actual
Cost when approved.

**Cash In / Cash Out.** Money received from the client (Cash In) and paid to subcontractors and
suppliers (Cash Out). Payment does not change Actual Cost; the cost was posted at certification.

**IPC (Interim Payment Certificate).** The project's own valuation to the client for a period: work
done, materials on site, retention, advance recovery, tax. Commercial → IPC and Client Billing.

**Pay Application.** A subcontractor's claim for a period against its subcontract. Submitted by the
subcontractor's side, certified by the QS, paid by Finance. Commercial → Pay Applications.

**Commitment.** A subcontract or purchase order: a promise of money to a company for defined scope.
Commercial → Commitments.

## Procurement and stores

**RFQ / Bid package.** A request for quotation: a package of scope sent to invited bidders, who
price it through the supplier portal. Commercial → Bids.

**Award.** The buyer's decision on a bid package. A soft award is an internal recommendation; a
confirmed award raises the commitment from the winning bid's priced lines.

**Purchase Order (PO).** An order to a supplier for materials or equipment. Procurement → Purchase
Orders. Its life: draft, approval, issue, acknowledgement, delivery, invoice, closed.

**Long Lead.** A material or package whose delivery time is long enough that ordering late delays
the schedule. Schedule → Long Lead shows what must be ordered by when.

**Goods Receipt (GRN).** The record of a delivery accepted at a store against a purchase order.
Inventory → Goods in. It moves the order's delivery status and puts stock on the shelf.

**Three-way match.** The check that what was ordered, what was received and what was invoiced
agree. Inventory → Match.

**Material Issue.** Taking stock out of a store for an activity. Inventory → Items → Issue. It posts
the material's cost to Actual Cost against the activity.

**Stock on hand / available.** Quantity in the store, and quantity not reserved for something else.

**Weighted average cost.** The unit cost OctaPM uses for an issue: the average of what the stock on
the shelf cost to receive.

## Schedule and progress

**Activity.** A schedule item with dates, duration and a budget share. Every cost, material and
quality record links to an activity.

**Critical path.** The chain of activities with no float; a delay on any of them delays the finish.

**Float.** How long an activity can slip without delaying the project.

**Baseline.** A locked copy of the schedule to measure progress against. Schedule → Revisions.

**Earned Value (EV), SPI, CPI.** Progress and cost efficiency measures: EV is the budget value of
work done; SPI = EV ÷ planned value; CPI = EV ÷ actual cost. Below 0.9 raises an alert.

**Lookahead.** The next weeks of work, drawn from the schedule. Schedule → Lookahead.

**Progress submission.** A site update of percent complete, submitted for the planner's or PM's
approval. Approved progress drives earned value and the dashboards.

## Documents and records

**RFI (Request for Information).** A question to the design team or the client that needs an
official answer. Doc Control → RFI. An answered and closed RFI often leads to a change order.

**Submittal.** A document (shop drawing, sample, method statement) sent for review and approval.
Doc Control → Submittals.

**Document Revision.** A numbered version of a controlled document. The register shows the current
revision; earlier ones stay on record.

**Transmittal.** A cover record for documents sent to a party. Doc Control → Transmittals.

**Correspondence.** Letters and formal messages logged against the project.

**Attachment / evidence.** A file attached to a record (photo, letter, test report). A file attached
once, on an RFI for example, can be cited as evidence on a change order without uploading it again.

**Audit history.** The record of who did what and when, on every record and on approvals.

## Quality and safety

**NCR (Non-Conformance Report).** A record that work or material does not meet the specification,
assigned to the person responsible for putting it right. Quality → NCR.

**Inspection / ITP.** An inspection against an inspection and test plan; a failed inspection can
raise an NCR. Quality → Inspections.

**Punch item.** A defect or outstanding item found on a walk-through, assigned to a company to fix.
Quality → Punch list.

**Observation.** A note of something seen on site that is not yet an NCR.

**Corrective action / closeout.** What the responsible person did to fix an NCR, with evidence,
submitted for the quality engineer's approval.

## Responsibility

**Needs You / My open items.** The list on Workspace Control of records where you are the owner,
reviewer, approver or assignee, or hold the ball. It is matched to you as a person, not by name.

**Ball in Court.** The person whose move it is on a record. Registers show who is holding each
record and what they are expected to do ("Awaiting the QS — to be sent for approval").

**Owner.** The person accountable for a record from start to finish, usually the one who raised it.

**Assignee.** The person asked to do the next piece of work on a record.

**Reviewer / Approver.** The people who check and decide on a record when it is submitted.

**Responsible company.** The company answerable for a record (an NCR, a punch item), shown beside
the responsible person.

## Screens

**Workspace Control.** Your landing page: official KPIs, My open items, Pending review, queues,
quick actions.

**Quick Actions.** One-click starts on Workspace Control for the records your role creates most:
New RFI, New change order, New direct cost, New task.

**Module bar.** The row of project modules under the header: Overview, Schedule, Site Reporting,
Cost Control, Commercial, Procurement, Quality, Doc Control, Meetings, BOQ, BIM, and More.

**Register.** A list of records of one kind (the RFI register, the change-order register), with the
record's status and who holds it.
