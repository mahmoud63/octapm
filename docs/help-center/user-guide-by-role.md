# User Guide By Role

Task: `TASK-P2-DOC-001`

Audience: construction project team members using PMcopilots during pilot, UAT, implementation, or source-of-truth rollout.

## Common Workflow

1. Sign in with your organization account.
2. Open only the projects assigned to you.
3. Use the project dashboard to identify overdue actions, pending approvals, SPI/CPI alerts, procurement risk, document-control queues, and safety/quality closeout items.
4. Open the module that owns your work and use workflow buttons instead of asking an admin to edit records behind the scenes.
5. Attach evidence before submitting contractual records.
6. Check audit/history panels when you need to explain a decision or status change.

## Status Rules

- Activity status is automatic: `0% = To Do`, `1-99% = In Progress`, `100% = Complete`, and past planned end date with less than 100% progress is `Delayed`.
- Official dashboard and EV values use approved workflow data.
- Draft, rejected, cancelled, and pending-review values may be visible, but they are not official unless a module explicitly says so.
- SPI below `0.9` and CPI below `0.9` are alert conditions.
- EAC is calculated as `Total Budget / CPI`.

## Project Manager

Primary focus: project governance, approvals, baseline control, user/project access, source-of-truth readiness, risk acceptance, and final workflow decisions.

Daily workflow:

1. Review workspace/project dashboard health and pending PM approval queues.
2. Resolve setup readiness blockers before allowing official reporting.
3. Approve or reject schedule revisions, BOQ allocations, progress where applicable, daily reports, document revisions, RFIs, submittals, change orders, EOT claims, NCR/safety closeouts, and risk closeouts.
4. Review SPI/CPI, quality score, commercial exposure, procurement alerts, and overdue tasks.
5. Confirm audit history before external submission or contractual decision.

Do not bypass workflow states by asking for direct data edits. Direct database changes can break audit evidence.

## Planning Engineer

Primary focus: schedule generation/import, CPM, data-date management, dependencies, progress coordination, and schedule history.

Daily workflow:

1. Import P6 XER, P6 XML, MSP XML, or generate an AI schedule draft.
2. Review Activity IDs, WBS grouping, calendars, dependency logic, total float, critical path, and data date.
3. Submit schedule revisions for PM approval.
4. Coordinate progress methods and review submitted progress where permitted.
5. Watch long-lead procurement risks on schedule activities.

Key handoffs:

- Submit schedule revisions to PM for activation, baseline, rollback, and official approval.
- Coordinate with Procurement when package need dates threaten activity start/finish dates.

## QS

Primary focus: BOQ, activity allocations, progress measurement review, IPC draft preparation, change-order quantity basis, and commercial support.

Daily workflow:

1. Upload/review BOQ and validation warnings.
2. Allocate BOQ quantity/value to Activity IDs.
3. Submit allocations for approval and resolve rejected allocations.
4. Review progress submissions and measurement evidence.
5. Create and submit IPC periods for Finance/PM certification.
6. Support change-order and EOT evidence with quantity and cost basis.

Key controls:

- Approved allocations feed official EV and IPC.
- Pending or rejected variations should not increase certified limits.

## Cost Controller

Primary focus: cost records, actuals, burn rates, variance analysis, reporting-period inputs, and cost exports.

Daily workflow:

1. Update activity-linked cost records with actual-through dates.
2. Review budget, actual cost, forecast, variance, CPI, and EAC.
3. Check that costs are tied to the right Activity ID.
4. Export cost reports for reconciliation.
5. Escalate missing cost basis or mismatched period cutoffs.

Key handoffs:

- Finance locks/certifies official financial periods where permitted.
- QS owns IPC drafting and quantity measurement inputs.

## Procurement

Primary focus: suppliers, procurement packages, purchase orders, long-lead items, and schedule-driven need dates.

Daily workflow:

1. Review package status and long-lead alerts.
2. Create/update suppliers, packages, and purchase orders where permitted.
3. Acknowledge or resolve procurement alerts with notes.
4. Coordinate receipts with Warehouse and material usage with Site Engineer.
5. Escalate late packages that threaten activity dates.

Key controls:

- Procurement package dates should trace to the linked activity schedule.
- Delivery evidence should be posted before material usage is treated as available.

## Warehouse

Primary focus: delivery receipts, stock movement, material availability, and activity material usage evidence.

Daily workflow:

1. Record received quantities against purchase orders/packages.
2. Attach delivery slips or receiving evidence.
3. Confirm available material before activity usage is posted.
4. Resolve quantity mismatches with Procurement.
5. Acknowledge schedule/material risk alerts assigned to warehouse operations.

Key controls:

- Do not post usage against the wrong Activity ID.
- Escalate over-receipt, under-receipt, damaged material, or missing delivery evidence.

## Site Engineer

Primary focus: field progress, daily reports, site diary, RFIs, submittals, NCRs, safety observations, photos, and assigned activity evidence.

Daily workflow:

1. Open assigned project and assigned activities.
2. Submit progress only for activities assigned to you unless PM/Planning overrides apply.
3. Create daily reports/site diary entries with manpower, equipment, weather, material usage, photos, and issues.
4. Raise RFIs, NCRs, safety observations, and field document evidence.
5. Submit records for review and track approval/rejection comments.

Key controls:

- Unassigned progress submissions should be rejected with `ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED`.
- Official EV does not move until submitted progress is approved.

## Finance

Primary focus: IPC certification, invoices, payments, retention, cost approvals, official period locks, and payment status.

Daily workflow:

1. Review submitted IPC periods and supporting earned-versus-claimed evidence.
2. Certify approved amounts and capture PM override reason where required.
3. Issue invoices, record client payments, and release retention where permitted.
4. Lock ready cost/EV reporting periods.
5. Review financial audit history before external submission.

Key controls:

- Retention defaults to `5%` of certified value unless the contract says otherwise.
- Over-certification requires PM override evidence where the workflow demands it.

## External Project Party Users

External users belong to a project party such as owner/client, consultant, contractor, or subcontractor. Their access is project-scoped and workflow-scoped. A consultant may review routed submittals or answer RFIs; a subcontractor may create or update routed RFIs/submittals for their package. They should not see unrelated company records.

## Need Help

Use the Help Center in the app or ask support for:

- Access denied or missing project.
- Failed BOQ/schedule/progress import.
- Missing document preview/download access.
- Workflow action not visible.
- Dashboard value that does not match the source register.

Support should ask for project ID, record ID, timestamp, role, workflow state, and the visible API error code when available.
