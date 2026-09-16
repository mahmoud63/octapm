# OctaPM Role Feature Matrix

Generated from the product's permission policy (`shared/permissions.json`) on 2026-09-15, not from menu visibility. A cell lists what the role may do on the feature: **CREATE** raise records, **EDIT** change them, **APPROVE** decide (approve, reject, certify), **CLOSE** close or complete them; **VIEW** means the role opens and reads the feature and may submit or export but not create; **READ ONLY** means read alone; **NOT AVAILABLE** means the feature is not offered and its pages do not open for the role. The Admin column is the Project Manager account, which also holds company administration.

Supplier / Bidder works through the invitation link only (no login, no navigation): it prices, submits, revises and withdraws its bid, asks questions and sees the award outcome. Client / Owner and Subcontractor logins are **NOT SUPPORTED** in Pilot V1 (see the User Guide, chapter 11).

| Feature | Where | Admin / PM | Planner | QS | Cost Controller | Procurement | Storekeeper | Site Engineer | Quality | Finance | Supplier / Bidder |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Schedule (Gantt, activities, milestones, baseline, revisions) | Schedule | CREATE · EDIT · APPROVE | CREATE · EDIT | VIEW | VIEW | READ ONLY | READ ONLY | READ ONLY | READ ONLY | READ ONLY | NOT AVAILABLE |
| Lookahead | Schedule → Lookahead | CREATE · EDIT | CREATE · EDIT | VIEW | VIEW | VIEW | READ ONLY | CREATE · EDIT | CREATE · EDIT | READ ONLY | NOT AVAILABLE |
| Progress submissions and daily site reporting | Site Reporting, Schedule → Progress | CREATE · EDIT · APPROVE | CREATE · EDIT · APPROVE | APPROVE | VIEW | NOT AVAILABLE | NOT AVAILABLE | CREATE | CREATE | READ ONLY | NOT AVAILABLE |
| Timesheets and crews | Site Reporting → Timesheets | CREATE · EDIT · APPROVE | CREATE · EDIT | VIEW | APPROVE | READ ONLY | READ ONLY | CREATE · EDIT | CREATE · EDIT | VIEW | NOT AVAILABLE |
| BOQ and allocations | BOQ | CREATE · EDIT · APPROVE | CREATE · EDIT | CREATE · EDIT · APPROVE | VIEW | READ ONLY | READ ONLY | READ ONLY | READ ONLY | READ ONLY | NOT AVAILABLE |
| Cost Control (overview, budget register, direct costs) | Cost Control | CREATE · EDIT · APPROVE · CLOSE | VIEW | CREATE · EDIT | CREATE · EDIT | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | APPROVE · CLOSE | NOT AVAILABLE |
| Change orders (variations) | Commercial → Change Orders | CREATE · EDIT · APPROVE | READ ONLY | CREATE · EDIT | VIEW | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | VIEW | NOT AVAILABLE |
| Change events and RFQs to vendors | Commercial → Change Events | CREATE · EDIT · APPROVE · CLOSE | CREATE · EDIT | CREATE · EDIT · APPROVE · CLOSE | VIEW | VIEW | NOT AVAILABLE | CREATE | CREATE | VIEW | NOT AVAILABLE |
| Commitments (subcontracts, purchase orders as commitments) | Commercial → Commitments | CREATE · EDIT · APPROVE · CLOSE | VIEW | CREATE · EDIT | VIEW | CREATE · EDIT | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | APPROVE · CLOSE | NOT AVAILABLE |
| Subcontractor pay applications | Commercial → Pay Applications | CREATE · EDIT · APPROVE · CLOSE | NOT AVAILABLE | CREATE · EDIT | VIEW | READ ONLY | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | CERTIFY · CLOSE | NOT AVAILABLE |
| Client billing, IPC, contract, cash flow | Commercial → Client Billing / IPC / Contract / Cash Flow | CREATE · EDIT · APPROVE | NOT AVAILABLE | CREATE · EDIT | VIEW | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | APPROVE | NOT AVAILABLE |
| Bid packages (RFQ, leveling, award) | Commercial → Bids | CREATE · EDIT · APPROVE | VIEW | CREATE · EDIT | VIEW | CREATE · EDIT | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | VIEW | VIEW · SUBMIT (own bid, by link) |
| Extension of time (EOT) and weather delays | Commercial → EOT / Weather Delays | CREATE · EDIT · APPROVE | CREATE · EDIT | CREATE · EDIT | VIEW | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | VIEW | NOT AVAILABLE |
| Procurement packages, purchase orders, suppliers | Procurement | CREATE · EDIT · APPROVE · CLOSE | CREATE · EDIT | VIEW | VIEW | CREATE · EDIT · CLOSE | VIEW | VIEW | VIEW | VIEW | NOT AVAILABLE |
| Inventory: stores, goods receipts, issues, match, ledger | Inventory | CREATE · EDIT · APPROVE | READ ONLY | VIEW | VIEW | CREATE · EDIT | CREATE · EDIT · APPROVE | VIEW | VIEW | VIEW | NOT AVAILABLE |
| RFIs | Doc Control → RFI | CREATE · EDIT · APPROVE · CLOSE | CREATE · EDIT | VIEW | VIEW | READ ONLY | READ ONLY | CREATE · EDIT | CREATE · EDIT | READ ONLY | NOT AVAILABLE |
| Submittals | Doc Control → Submittals | CREATE · EDIT · APPROVE | CREATE · EDIT | VIEW | VIEW | READ ONLY | READ ONLY | CREATE · EDIT | CREATE · EDIT | READ ONLY | NOT AVAILABLE |
| Documents: drawings, specifications, transmittals, correspondence, search | Doc Control | CREATE · EDIT · APPROVE | CREATE · EDIT | VIEW | VIEW | READ ONLY | READ ONLY | CREATE | CREATE | READ ONLY | NOT AVAILABLE |
| Inbound emails | Doc Control → Emails | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | EDIT | READ ONLY | NOT AVAILABLE | CREATE · EDIT | CREATE · EDIT | READ ONLY | NOT AVAILABLE |
| NCRs and material tests | Quality → NCR / Material Tests | CREATE · EDIT · APPROVE · CLOSE | CREATE · EDIT · CLOSE | VIEW | VIEW | READ ONLY | READ ONLY | CREATE · EDIT · CLOSE | CREATE · EDIT · APPROVE · CLOSE | READ ONLY | NOT AVAILABLE |
| Inspections and observations | Quality → Inspections / Observations | CREATE · EDIT · APPROVE · CLOSE | CREATE · EDIT · APPROVE · CLOSE | CREATE · EDIT · CLOSE | VIEW | READ ONLY | READ ONLY | CREATE · EDIT · CLOSE | CREATE · EDIT · APPROVE · CLOSE | READ ONLY | NOT AVAILABLE |
| Punch list | Quality → Punch list | CREATE · EDIT · APPROVE · CLOSE | CREATE · EDIT | CREATE | VIEW | READ ONLY | READ ONLY | CREATE · EDIT | CREATE · EDIT · APPROVE · CLOSE | READ ONLY | NOT AVAILABLE |
| Safety incidents | Quality → Safety | CREATE · EDIT · APPROVE · CLOSE | VIEW | VIEW | VIEW | READ ONLY | READ ONLY | CREATE · EDIT · CLOSE | CREATE · EDIT · APPROVE · CLOSE | READ ONLY | NOT AVAILABLE |
| Meetings and actions | Meetings | CREATE · EDIT · APPROVE | CREATE · EDIT · APPROVE | VIEW | VIEW | VIEW | VIEW | CREATE · EDIT | CREATE · EDIT | VIEW | NOT AVAILABLE |
| Tasks | Tasks | CREATE · EDIT · APPROVE · CLOSE | CREATE · EDIT · APPROVE · CLOSE | VIEW | VIEW | VIEW | VIEW | CREATE · EDIT · CLOSE | CREATE · EDIT · CLOSE | VIEW | NOT AVAILABLE |
| Risks | Schedule → Risks | CREATE · EDIT · APPROVE | CREATE · EDIT | CREATE · EDIT | VIEW | READ ONLY | READ ONLY | READ ONLY | READ ONLY | READ ONLY | NOT AVAILABLE |
| Locations | Locations | CREATE · EDIT | CREATE · EDIT | VIEW | VIEW | READ ONLY | READ ONLY | CREATE · EDIT | CREATE · EDIT | READ ONLY | NOT AVAILABLE |
| Reports and scheduled reports | Reports | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | VIEW | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | NOT AVAILABLE |
| Portfolio | Portfolio | VIEW | VIEW | VIEW | VIEW | VIEW | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | VIEW | NOT AVAILABLE |
| Audit history | Record history | VIEW | VIEW | VIEW | VIEW | READ ONLY | READ ONLY | READ ONLY | READ ONLY | VIEW | NOT AVAILABLE |
| Messages (conversations) | Messages | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | CREATE · EDIT | NOT AVAILABLE |
| Ask OctaPM (assistant) | Top bar | READ ONLY | READ ONLY | READ ONLY | READ ONLY | READ ONLY | READ ONLY | READ ONLY | READ ONLY | READ ONLY | NOT AVAILABLE |
| BIM | BIM | CREATE · EDIT | CREATE · EDIT | EDIT | VIEW | READ ONLY | READ ONLY | EDIT | EDIT | READ ONLY | NOT AVAILABLE |
| People (users, invitations) | People | CREATE · EDIT · APPROVE | READ ONLY | READ ONLY | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE |
| Companies, vendors and project parties | Company → Directory / Vendors, Project → Team | CREATE · EDIT · APPROVE | CREATE · EDIT | VIEW | READ ONLY | READ ONLY | READ ONLY | READ ONLY | READ ONLY | READ ONLY | NOT AVAILABLE |
| Workflow definitions | Company → Workflows | CREATE · EDIT · APPROVE | VIEW | VIEW | VIEW | VIEW | VIEW | VIEW | VIEW | VIEW | NOT AVAILABLE |
| Custom fields | Company → Custom fields | CREATE · EDIT | VIEW | VIEW | VIEW | VIEW | VIEW | VIEW | VIEW | VIEW | NOT AVAILABLE |

Every role also has: Workspace Control with My open items, Quick Actions for the records it may create (New RFI, New change order, New direct cost, New task), notifications, search, its own settings and profile, and sign-out. Company administration (Directory, Vendors, Cost codes, Equipment, templates, Workflows, Custom fields, Integrations, Security, Permissions) opens for company administrators; the People page opens for roles with user-management read.

## Approvals and transitions by role

What each role may decide, from the policy's transitions (the named steps a record can take).

**Admin / PM** — allocation.approve, allocation.reject, bid.award, bid.publish, change_event.close, change_order.approve, change_order.reject, closeout.approve, closeout.manage, commitment.approve, commitment.close, commitment_co.approve, daily_log.approve, daily_log.distribute, daily_report.approve, daily_report.reject, direct_cost.approve, direct_cost.pay, document.revision.approve, drawing.publish, eot.approve, eot.reject, evaluation.approve, inspection.close, lookahead.publish, meeting.distribute, ncr.approve, ncr.close, ncr.reject, period.certify, po.approve, po.close, punch.close, punch.distribute, reporting_period.lock, revision.approve, revision.baseline, revision.reject, rfi.approve, rfi.close, rfi.reject, risk.approve, risk.reject, safety.approve, safety.close, safety.reject, site_diary.approve, site_diary.reject, sub_pay_app.accounting_sync, sub_pay_app.approve, sub_pay_app.pay, sub_pay_app.reject, sub_pay_app.review, sub_pay_app.submit, sub_pay_app.void, submission.approve, submission.reject, submittal.approve, submittal.reject, task.close, timesheet.approve, timesheet.reject

**Planner** — daily_log.distribute, drawing.publish, inspection.close, lookahead.publish, meeting.distribute, ncr.close, punch.distribute, submission.approve, submission.reject, task.close

**QS** — allocation.approve, allocation.reject, change_event.close, closeout.approve, closeout.manage, evaluation.approve, sub_pay_app.reject, sub_pay_app.review, sub_pay_app.submit, submission.approve, submission.reject

**Cost Controller** — timesheet.approve, timesheet.reject

**Procurement** — bid.publish, po.close

**Storekeeper** — no approval transitions

**Site Engineer** — closeout.manage, daily_log.distribute, lookahead.publish, ncr.close, punch.distribute, safety.close, task.close

**Quality** — closeout.manage, daily_log.distribute, inspection.close, lookahead.publish, ncr.approve, ncr.close, ncr.reject, punch.close, punch.distribute, safety.approve, safety.close, safety.reject, task.close

**Finance** — commitment.close, direct_cost.approve, direct_cost.pay, payment.record, period.certify, reporting_period.lock, retention.release, sub_pay_app.accounting_sync, sub_pay_app.pay

