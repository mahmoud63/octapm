# Admin Guide

Task: `TASK-P2-DOC-001`

Audience: PMcopilots tenant admins, Project Managers, implementation consultants, and QA reviewers.

## Admin Responsibilities

Admins are accountable for tenant setup, project setup, user invitations, project access, workflow readiness, and go-live evidence. A PM user has the broadest authority in the application, but production rollout still requires the signoffs in `docs/qa/go-live-readiness-gate.md`.

Use this guide when preparing a new organization, starting a pilot project, reviewing project readiness, or troubleshooting user access.

## Tenant Setup Checklist

1. Confirm the organization name, contract owner, pilot scope, and support contacts.
2. Confirm production environment readiness before customer data import:
   - API origin lockdown and CORS are configured.
   - Refresh tokens are cookie-backed and server-side sessions are active.
   - File storage is private and access-controlled.
   - RDS backup, restore, rollback, monitoring, and smoke evidence are recorded.
3. Confirm the release is still pilot/demo unless all required go-live gates are passed or risk accepted.
4. Create the first PM user through registration, invitation, or seed data approved for the environment.
5. Add tenant users through the Users page. Do not share PM credentials.
6. Assign each user the least-privilege organization role and then add project-specific access where needed.

## Roles

| Role                                | Use For                                                                                            | Typical Admin Action                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Project Manager (`pm`)              | Full project administration, approvals, baselines, user management, final workflow decisions.      | Limit to named PM/admin users.                                      |
| Planning Engineer (`planning_eng`)  | Schedule import/generation, revisions, CPM, progress coordination, procurement need-date analysis. | Assign to planning team members and project controls leads.         |
| QS (`qs`)                           | BOQ, allocations, IPC drafts, progress review, commercial measurement.                             | Assign to quantity surveying and contract measurement users.        |
| Cost Controller (`cost_controller`) | Cost records, burn rates, reports, financial analysis.                                             | Assign read/write cost users who do not certify IPC.                |
| Procurement (`procurement`)         | Suppliers, packages, POs, long-lead risks, procurement alerts.                                     | Assign procurement staff responsible for package updates.           |
| Warehouse (`warehouse`)             | Receipts, stock movement, activity material usage, delivery evidence.                              | Assign site store and logistics users.                              |
| Site Engineer (`site_engineer`)     | Progress submissions, daily reports, site diary, RFIs, NCRs, safety observations, field evidence.  | Assign only to active project team members and relevant activities. |
| Finance (`finance`)                 | IPC certification, invoices, payments, retention, official cost period locks.                      | Assign to finance users with approval authority.                    |

The source of truth for permissions is `shared/permissions.json`; the readable QA matrix is `docs/qa/role-permission-matrix.md`.

## Project Access Model

- PM users can see organization projects without explicit assignment.
- All other internal roles need an active `ProjectAssignment` for the project.
- External company users need an active project party membership.
- Direct links to unassigned projects should return `403 PROJECT_ACCESS_DENIED`.
- Project party users receive scoped access only to routed party workflows; they do not inherit internal organization privileges.

Admin action: after adding a user, open the project team/party setup and confirm the user can see only the intended project and intended actions.

## Project Setup Workflow

### 1. Create Project

Record the project name, contract number/type, owner/client, consultant, contractor, subcontractor, baseline dates, revised completion, calendar assumptions, retention, and reporting cutoff. Confirm the project appears only in the correct organization.

### 2. Confirm Setup Readiness

Use setup readiness before the project becomes official. The project should block reporting until required inputs are complete:

- Approved BOQ and cost basis.
- Active schedule revision.
- Approved activity/BOQ allocations.
- Baseline approval where required.
- Progress method readiness.
- Required project team assignments.

### 3. Import Or Generate The Schedule

Admins or Planning Engineers can import P6 XER, P6 XML, MSP XML, or generate an AI-assisted schedule. Review Activity IDs, calendars, dependencies, data date, critical path, and baseline before activation.

Important rules:

- P6 XER durations are normalized from hours to working days using `hours / 8`.
- Total float is `Late Finish - Early Finish`; `TF = 0` is critical path.
- Schedule changes should use revision, review, approval, activation, mapping, and rollback workflows instead of destructive replacement.

### 4. Upload And Allocate BOQ

Upload the BOQ, confirm validation results, review chunking when a BOQ has more than 60 items, and allocate BOQ quantity/value to activities. Official EV and IPC should use approved allocations only.

### 5. Configure Project Parties

Create or select company records for owner/client, consultant, contractor, and subcontractor parties. Add members only to the companies and project parties they represent.

### 6. Configure Document Control

Set expected folder/category conventions before the team uploads controlled documents. Require review submission and PM approval for official revisions. Confirm site roles see latest-approved documents where applicable.

### 7. Enable Commercial And Cost Controls

Confirm cost categories, reporting periods, change order workflow, IPC periods, payment/retention rules, and evidence requirements. Finance should certify IPC and record payment events; QS should draft and submit IPC periods.

### 8. Configure Procurement And Site Reporting

Confirm procurement packages, suppliers, purchase orders, need dates, receipt evidence, material usage rules, and long-lead alert owners. Site Engineers should be assigned to activities before progress submission.

## Data Governance

- Do not store secrets in the frontend, docs, or repository.
- Do not attach customer files to git. Runtime uploads must stay in private storage.
- Use archive workflows for retained project records where the module supports soft delete.
- Treat audit history as contractual evidence. Do not edit database rows directly to bypass workflow history.
- Use the standard API response envelope for support evidence: `{ success: true, data }` or `{ success: false, error: { code, message } }`.

## Admin QA Before Handoff

1. PM can create a project, add team members, and see readiness blockers.
2. Planning Engineer can import/generate a schedule and submit a revision, but cannot approve/baseline unless assigned as PM.
3. QS can manage BOQ allocations and draft IPC.
4. Finance can certify IPC, issue invoices, record payments, release retention, and lock ready cost periods.
5. Site Engineer can submit assigned activity progress and daily reports.
6. Procurement and Warehouse can update package/receipt/material workflows without financial approval privileges.
7. External party users see only assigned/routed project records.
8. API docs are reachable at `/api/v1/docs`.
9. Known limitations are shared with pilot stakeholders.

## Escalation

Use `docs/help-center/support-runbook.md` for incidents, support triage, and escalation. For go-live decisions, use `docs/qa/go-live-readiness-gate.md`.
