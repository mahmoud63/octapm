# OctaPM Mobile — Role Quick Guides

One page per role: what you will use the app for on site, where it lives, and what stays on the web. What you see is decided by the rights your role holds on the project ([permission matrix](../../mobile/OCTAPM_MOBILE_PERMISSION_MATRIX.md)); the [user guide](OCTAPM_MOBILE_USER_GUIDE.md) explains each screen.

## Project Manager

**On Home you see** approvals and decisions in Needs You first, the project's health, and notifications.

**You will mostly**
- Answer approvals: Home → **Approvals** → the step → Approve, or Reject with a comment. The server moves the change order, commitment or pay application.
- Decide RFIs: **RFIs** → the record → Answer, Approve and close, Reject, Reopen, Convert to change.
- Approve progress on a tablet: **Activities** → the activity → Approve or Reject the submitted update (a hold point warns you first).
- Close, reopen or void inspections and close punch items.
- Raise anything from the quick actions.

**Stays on the web:** pay-application decisions, cost control, IPC certificates, project setup and the team, user management.

## Planning Engineer

**On Home you see** progress and lookahead items, RFI and submittal reviews.

**You will mostly**
- Walk the schedule: **Activities** → today's work, critical, milestones, delayed; the **Timeline** on a tablet.
- Approve submitted progress updates (**Activities** → the activity, tablet).
- Move lookahead items on the **Lookahead board**.
- Raise RFIs and change events from the field.

**Stays on the web:** schedule revisions, baselines, imports, the schedule history.

## QS

**On Home you see** RFI and submittal reviews and change events.

**You will mostly**
- Raise and read **Change events** and read **Change orders**, **Commitments** and **Pay applications** with their money and schedule of values.
- Approve progress updates that drive certified quantities (**Activities**, tablet).
- Add punch items you find on your walks.

**Stays on the web:** pricing, quotes, conversion of change events, IPC certificates, cost control.

## Cost Controller

**On Home you see** the health tiles and timesheet items to review.

**You will mostly**
- Read the project health and its seven dimensions on **Home**.
- Approve **Timesheets** (the list → the sheet).
- Read **Commitments** and **Pay applications**.

**Stays on the web:** cost control, EAC, the cost breakdown, IPC certificates.

## Procurement

**On Home you see** purchase orders and deliveries in Needs You and lead-time alerts.

**You will mostly**
- Watch the **Procurement** overview and **Acknowledge** lead-time alerts.
- Open **Packages** and **Purchase orders**; hand a delivery to Inventory with **Receive delivery**.
- Read the **Long lead** register.

**Stays on the web:** raising and issuing purchase orders, bids, commitments' money decisions.

## Warehouse

**On Home you see** goods in and transfers in Needs You, and Inventory home.

**You will mostly**
- **Scan** a code or type it, open the item and **Move stock** (issue to an activity, return, reserve, receive, adjust, damage, quarantine). Each movement needs a signal and is sent once.
- **Goods in**: receive a delivery against its order line by line, choose the bin, post it; the receipt number is made on your device, so a retry counts once. A receipt captured offline waits in the outbox.
- **Transfers**: draft, dispatch, receive with received and damaged quantities.
- Read the **Movements** ledger.

**Stays on the web:** warehouse setup, items and bins, stock counts and valuation.

## Site Engineer

**On Home you see** the daily log, punch items, RFIs and inspections assigned to you.

**You will mostly**
- Close the day: **Daily log** → today → add manpower (with the trade), equipment, work done, deliveries, visitors, notes → **Submit the day**. Entries work offline.
- Update progress on your activities: **Activities** → the activity → **Update progress** by its method; a hold point warns you.
- Take site photos, mark them up, and put them on the daily log.
- Raise punch items with a photo first, start inspections from a template and answer the checklist, raise RFIs and change events from the field.
- Fill in your timesheet.

**You do not** approve anything: no Approve or Reject appears for you on updates, RFIs, inspections or punch items. **Stays on the web:** everything commercial beyond raising a change event.

## Quality Engineer

**On Home you see** inspections, NCRs, punch closeouts and safety.

**You will mostly**
- **Inspections**: start from a template, answer the checklist in one save, photograph the failed items, raise punch items from them, sign the signature items, complete, close, reopen or void.
- **Punch list**: review items ready for review, close them, dispute or resolve.
- **NCRs** and **Safety incidents**: raise, submit closeout with evidence, approve or reject closeouts.
- **Material tests**: schedule and record results.

**Stays on the web:** quality reports and dashboards, template design.

## Finance

**On Home you see** view-only tiles.

**You will mostly**
- Read the project health and the commercial registers: **Commitments**, **Pay applications**, **Change orders**.
- Read notifications for certified and paid items.

**You do not** raise or approve anything in the app. **Stays on the web:** IPC certificates, payments, cash flow, cost control.

## Parties (owner, consultant, contractor, subcontractor)

**You see** exactly what the party policy grants on the project: your RFIs, tasks, documents and drawings, your punch items, your change orders, commitments and pay applications. NCRs and safety incidents never appear.

**You will mostly**
- Respond to RFIs in your court and read their official answers.
- Submit your pay application for review (**Pay applications** → the application → **Submit for review**); review, approval and payment stay with the project.
- Answer approval steps addressed to you in **Approvals**.
- Close out punch items assigned to you.

**Stays on the web:** anything the party policy does not grant; the app never shows a button for it.
