# Go-Live Readiness Gate

This gate keeps PMcopilots classified as demo/pilot until the official source-of-truth rollout has recorded evidence, owner signoff, and risk acceptance for any unresolved blocker.

## Gate Rule

Production source-of-truth rollout is blocked unless every P0 gate below is either `Passed` or `Risk accepted`.

Risk acceptance is allowed only when it is documented with an owner, business impact, compensating controls, expiry date, rollback plan, and the required approvers. A P0 risk acceptance requires Product, QA, Security, Backend, Frontend, and Business signoff.

Technical deployment to production infrastructure is not the same as go-live. CI and smoke tests are required prerequisites, but official use still requires this document to be completed for the target release.

## Status Values

| Status | Meaning |
|---|---|
| Open | Work or evidence has not started. |
| Evidence pending | Implementation exists or is in progress, but go-live evidence is not attached. |
| Blocked | A required control failed or is missing. |
| Passed | Evidence was reviewed and accepted by the owner. |
| Risk accepted | The blocker is accepted under the formal risk process for a limited period. |

## Readiness Matrix

| Gate ID | Workflow or Control | Blocker Source | Owner | Required Validation Evidence | Status | Signoff |
|---|---|---|---|---|---|---|
| GL-P0-001 | BOQ to activity allocation spine is the official value basis. | [FB-001](../technical-feedback-tasks/2026-06-08/TASK-P0-FB-001-add-activity-boq-allocation.md), [BOQ spine QA](boq-activity-spine.md) | Backend, Product, QA | Approved allocation model/API evidence, BOQ-created work stored as `Activity` + `ActivityBoqAllocation`, over-allocation rejection, unallocated value report, EV/IPC using approved allocations only, scenario `GL-QA-002`. | Evidence pending | Required |
| GL-P0-002 | Schedule generation/import preserves active operational history. | [FB-006](../technical-feedback-tasks/2026-06-08/TASK-P0-FB-006-control-schedule-regeneration-history.md), [FB-004](../technical-feedback-tasks/2026-06-08/TASK-P1-FB-004-add-schedule-review-approval-baseline.md), [FB-010](../technical-feedback-tasks/2026-06-08/TASK-P1-FB-010-add-audit-history.md) | Backend, Frontend, QA | Staged revision review, mapping, approval, activation, rollback, audit history, and no deletion of linked progress, costs, procurement, risks, assignments, or allocations; scenario `GL-QA-003`. | Evidence pending | Required |
| GL-P0-003 | Production security readiness is externally confirmed. | [FB-019](../technical-feedback-tasks/2026-06-08/TASK-P0-FB-019-harden-production-security-readiness.md), [auth refresh QA](auth-refresh-sessions.md), [billing/Stripe QA](billing-stripe-webhook.md), [security checklist](../security/production-security-readiness.md) | Security, Backend, DevOps | Secret rotation/revocation ticket, required production env validation with live Stripe key, webhook secret, price IDs, non-secret rotation ticket/date, HTTPS CORS allowlist with credentials, distinct JWT/CloudFront secrets, tracked-source secret hygiene scan, server-side refresh sessions with rotation/replay rejection, Stripe webhook signature tests, deployment smoke output. | Evidence pending | Required |
| GL-P0-004 | Automated quality gates and deployment smoke checks pass for the rollout commit. | [FB-018](../technical-feedback-tasks/2026-06-08/TASK-P1-FB-018-add-ci-quality-gates.md), [release checklist](../release-checklist.md) | QA, Backend, Frontend, DevOps | `Quality Gates` workflow URL for the commit, deploy workflow URL, parameterized deployment readiness validator output, backend smoke output with authenticated smoke user, OpenAPI validation, frontend lint/build. | Evidence pending | Required |
| GL-P0-005 | Production database backup and recovery readiness is accepted. | [TASK-P0-devops-enable-rds-backups-and-recovery](../technical-feedback-tasks/2026-06-09/TASK-P0-devops-enable-rds-backups-and-recovery.md), [RDS recovery runbook](../runbooks/rds-backup-recovery.md), [backup/restore checklist](../ops/backup-restore-evidence-checklist.md), [rollback checklist](../ops/rollback-evidence-checklist.md), [monitoring checklist](../ops/monitoring-alert-evidence-checklist.md) | DevOps, Database, QA | Terraform backup validation job, automated backup retention evidence, retained automated backups, Multi-AZ production plan, unique final snapshot setting, restore rehearsal, RPO/RTO evidence, rollback rehearsal, monitoring alert evidence, construction scenario smoke. | Evidence pending | Required |
| GL-P0-006 | Project-level object authorization blocks cross-project access. | [Project access QA](project-access-authorization.md) | Security, Backend, Frontend, QA | Assigned-project list filtering, direct project and nested-route `403 PROJECT_ACCESS_DENIED` evidence for unassigned users, PM org-wide access regression, frontend restricted state evidence. | Evidence pending | Required |
| GL-P1-005 | Earned value basis is official, approved, period-based, and lockable. | [FB-007](../technical-feedback-tasks/2026-06-08/TASK-P1-FB-007-harden-earned-value-basis.md), [Official EV QA](earned-value-official-engine.md) | Product, Backend, QA, Business | PV from approved cost loading, EV from approved progress and allocations, AC from `CostRecord.actualThroughDate`, budget revision handling, locked period snapshot, scenario `GL-QA-005`. | Evidence pending | Required |
| GL-P1-006 | Module/action permissions are enforced by backend and reflected in frontend. | [FB-009](../technical-feedback-tasks/2026-06-08/TASK-P1-FB-009-add-module-action-permissions.md), [role matrix](role-permission-matrix.md) | Security, Backend, Frontend, QA | Role matrix review, backend authorization tests for all eight roles, frontend disabled/hidden actions, scenario `GL-QA-008`. | Evidence pending | Required |
| GL-P1-007 | Critical workflow audit history is inspectable. | [FB-010](../technical-feedback-tasks/2026-06-08/TASK-P1-FB-010-add-audit-history.md) | Backend, Product, QA | Audit events for schedule revision, progress approval, IPC certification, change order approval/rejection/delete, with redacted payloads and tenant scope. | Evidence pending | Required |
| GL-P1-008 | Commercial records trace to approved activities and BOQ allocations. | [FB-012](../technical-feedback-tasks/2026-06-08/TASK-P1-FB-012-strengthen-commercial-traceability.md) | Business, Backend, Frontend, QA | Change order, IPC, sub valuation, EOT, weather delay, correspondence, and attachment traceability evidence; scenario `GL-QA-006`. | Evidence pending | Required |
| GL-P1-009 | Project setup readiness prevents premature progress and baseline use. | [FB-015](../technical-feedback-tasks/2026-06-08/TASK-P2-FB-015-guided-project-setup-wizard.md) | Product, Frontend, Backend, QA | Setup readiness endpoint, wizard evidence, blockers for missing BOQ, schedule approval, allocations, baseline, and progress readiness. | Evidence pending | Required |
| GL-P2-010 | Procurement, quality, document-control, and dashboard workflows are activity-linked and reviewable. | [FB-013](../technical-feedback-tasks/2026-06-08/TASK-P2-FB-013-procurement-need-date-risk-alerts.md), [FB-014](../technical-feedback-tasks/2026-06-08/TASK-P2-FB-014-quality-doc-workflow-maturity.md), [FB-016](../technical-feedback-tasks/2026-06-08/TASK-P2-FB-016-replace-generic-dashboard.md) | Product, Frontend, Backend, QA | Need-date risk alerts, quality/document assignment and evidence history, seven-dimension dashboard fed by official workflow state. | Evidence pending | Required |
| GL-P2-011 | Launch documentation, onboarding, support, known limitations, and API publication are ready for customer use. | [Documentation readiness QA](documentation-readiness.md), [Help Center docs](../help-center/README.md), [API docs guide](../help-center/api-docs.md) | Product, QA, Support, Backend, Frontend, Business | In-app Help Center evidence, admin guide walkthrough, role guide UAT notes, support runbook tabletop, Swagger/OpenAPI validation, onboarding checklist review, known-limitation acceptance. | Evidence pending | Required |

## Pilot-Only Restrictions

Until all P0 gates pass or are formally risk accepted:

- PMcopilots may be used for demos, sandbox pilots, training, and parallel-run validation only.
- Live UAT must be recorded with `docs/qa/live-uat-evidence-checklist.md` before any controlled pilot expands beyond sandbox/demo use.
- Runtime scale blockers in `docs/ops/runtime-state-and-scale-blockers.md` must be accepted for a single-instance pilot or fixed before multi-instance/paid production use.
- It must not be named as the contractual system of record for schedule, cost, IPC, EOT, procurement, quality, or dashboard reporting.
- Customer-facing exports and dashboards must be treated as draft/pilot evidence and reconciled against the current official tools before decisions.
- Schedule generation/import must be tested on pilot projects or approved rollout copies before touching a live project schedule.
- IPC certification, change order approval, EOT decisions, and earned value reporting must be reconciled by Business/Commercial owners before external submission.
- Production secrets, live payment flows, and customer data imports require Security/DevOps approval and the FB-019 checklist.
- Pilot users must be named, role-scoped, and trained on what is pilot-only versus official.

## Production-Blocking Conditions

Any of these conditions blocks source-of-truth rollout:

- Any P0 gate is `Open`, `Evidence pending`, or `Blocked`.
- `Quality Gates` did not pass on the exact rollout commit.
- Deployment smoke was not run after backend restart, or authenticated smoke was skipped without QA approval.
- Security/DevOps has not recorded secret rotation and required production settings outside the repository.
- RDS automated backup retention, final snapshot, or restore rehearsal evidence is missing or failed.
- Product, QA, Security, Backend, Frontend, and Business signoff is incomplete.
- A P0 blocker is marked risk accepted without expiry, rollback plan, and named approvers.
- QA cannot complete the BOQ to Dashboard end-to-end scenario set below.

## Module Acceptance Criteria

| Module or Workflow | Go-Live Acceptance Criteria |
|---|---|
| Auth and users | Short-lived JWT access tokens work, refresh tokens are stored only in server-side sessions and `HttpOnly` cookies with rotation/reuse rejection, logout revokes the active session, bcrypt hashing uses 12 rounds, all eight roles are enforced with module/action permissions, and tenant-scoped user management is tested. |
| Project setup | Required contract metadata, calendar/cutoff settings, readiness blockers, and project CRUD are tenant scoped and visible to PM users. |
| BOQ management | Upload validation, section chunking, code integrity, allocation totals, approved allocation workflow, and unallocated value reporting are accepted by Product and QA. |
| Schedule and CPM | P6 XER, P6 XML, MSP XML, AI generation, structured dependencies, critical path, revision lifecycle, baseline lock, activation, rollback, and audit are validated on representative data. |
| Progress and site reporting | Progress methods, evidence, daily reports, photos, approval/rejection, and approved-only EV impact are verified by Site Engineer, Planning, and PM roles. |
| Earned value | Reporting periods, approved cost loading, approved progress, approved allocations, AC source hierarchy, CPI/SPI alerts, EAC, budget revisions, and locked snapshots are validated. |
| Commercial | Change orders, IPC, sub valuations, cash flow, EOT, weather delays, correspondence, attachments, approvals, and audit all trace to activity/allocation basis. |
| Procurement and warehouse | Long-lead need dates, order-by alerts, delivery slip risk, warehouse receipt states, and activity impacts are visible on schedule, procurement, and health dashboards. |
| Quality and document control | NCR, ITP, defects, safety, material tests, RFIs, submittals, drawings, transmittals, and correspondence carry owners, due dates, attachments, status history, and activity links. |
| Dashboards and reports | Project and workspace dashboards use official workflow data, show seven-dimension health, and match backend reports/export outputs for the same cutoff. |
| API and mobile readiness | OpenAPI is current, mobile-facing endpoints are documented, auth/error/pagination envelopes match the standard, and unsupported mobile UI scope is documented. |
| Operations and security | Production env validation, CORS, CloudFront origin guard, no direct API DNS/origin bypass, Stripe webhook signatures, S3 upload settings, RDS backup/restore rehearsal, smoke checks, and incident/rollback process are accepted. |
| Documentation and support | Admin, role user, support, onboarding, API, release-note, and known-limitation docs are published in the Help Center and reviewed through the documentation readiness checklist. |

## End-to-End QA Scenarios

Use a dedicated smoke organization, named smoke users for all eight roles, and one representative construction project. Record project ID, commit SHA, environment, date, tester, and evidence links for every run.

### GL-QA-001: Project Setup Baseline

1. Sign in as PM and create a project with contract parties, contract number/type, retention, baseline date, revised completion, calendar, and reporting cutoff.
2. Confirm the project appears only inside the correct organization.
3. Open setup readiness and confirm missing BOQ, schedule, allocation, baseline, and progress gates are visible.
4. Evidence: project record, setup readiness response, screenshots, and API response envelope.

### GL-QA-002: BOQ to Activity Allocation

1. Upload a representative BOQ, including a file with more than 60 items to confirm section chunking.
2. Create or import schedule activities.
3. Allocate BOQ quantity/value to one or more activities.
4. Submit and approve allocations.
5. Attempt an over-allocation and confirm the API returns a structured validation error.
6. Confirm unallocated value remains visible and excluded from official EV/IPC.
7. Evidence: BOQ upload result, allocation records, validation error, and allocation summary.

### GL-QA-003: Schedule Revision Preservation

1. Generate or import a schedule as a draft revision.
2. Add linked progress, cost records, assignments, procurement, long-lead items, risks, and approved allocations to active activities.
3. Submit, approve, map, and activate a changed revision.
4. Confirm mapped activities preserve linked records and unmapped removals require a reason.
5. Roll back to a prior active revision and confirm audit history.
6. Evidence: before/after linked record counts, revision mapping, activation audit, rollback audit, and no destructive delete evidence.

### GL-QA-004: Progress Approval to Official Status

1. Configure progress methods for representative activities.
2. Submit quantity-based, weighted milestone, inspection, and manual progress entries with evidence.
3. Approve and reject entries with PM/Planning roles.
4. Confirm only approved progress updates official activity status.
5. Evidence: submitted progress, approval/rejection records, evidence links, activity status changes.

### GL-QA-005: Official EV Period

1. Create a reporting period and approved time-phased cost loading.
2. Approve progress tied to approved allocations.
3. Record explicit AC with `actualThroughDate` for the period.
4. Generate the official EV report and verify PV, EV, AC, SPI, CPI, EAC, and alert thresholds.
5. Lock the period snapshot and confirm later changes do not mutate the locked evidence.
6. Verify post-cutoff progress approvals and cost records with later `actualThroughDate` values do not leak into the selected period.
7. Evidence: report payload, formula checks, locked snapshot, and dashboard comparison.

### GL-QA-006: Commercial Traceability

1. Create a change order linked to multiple activities and approved allocations.
2. Create IPC items from approved allocation/progress basis and certify within approved cumulative progress.
3. Create a sub valuation and EOT/weather claim linked to affected activities.
4. Confirm over-certification is blocked.
5. Confirm commercial dashboard and audit history show links and decisions.
6. Evidence: CO, IPC, sub valuation, EOT/weather records, validation error, audit events.

### GL-QA-007: Dashboard Propagation

1. After scenarios `GL-QA-002` through `GL-QA-006`, open project health and workspace dashboard.
2. Confirm schedule, cost, procurement, quality, commercial, safety, and documentation dimensions reflect the latest official states.
3. Force SPI or CPI below 0.9 in controlled test data and confirm alerts.
4. Evidence: dashboard screenshots, API payloads, and report comparisons.

### GL-QA-008: Permissions and Audit

1. Execute the same critical actions as PM, Planning Engineer, QS, Cost Controller, Procurement, Warehouse, Site Engineer, and Finance.
2. Confirm allowed actions succeed and disallowed actions return structured authorization errors.
3. Confirm frontend hides or disables disallowed actions.
4. Confirm audit events are written for approved/rejected/baselined/certified workflows.
5. Evidence: role matrix results, API responses, frontend screenshots, audit timeline.

### GL-QA-009: Deployment Smoke and Security

1. Deploy the exact commit that passed `Quality Gates`.
2. Restart backend and run:

```bash
SMOKE_REQUIRE_AUTHENTICATED=true SMOKE_EMAIL=<approved-smoke-user> SMOKE_PASSWORD=<approved-smoke-password> SMOKE_PROJECT_ID=<project-id> SMOKE_STRIPE_WEBHOOK_SECRET=<runtime-webhook-secret> npm run smoke:deploy --workspace=backend
```

3. Confirm unsigned Stripe webhooks are rejected and signed test events pass in a safe Stripe CLI or non-live listener.
4. Confirm production CORS allows only approved HTTPS origins and credentials.
5. Confirm auth refresh session QA from `docs/qa/auth-refresh-sessions.md`, including no JSON refresh token, cookie rotation, replay rejection, and logout revocation.
6. Evidence: workflow URLs, smoke output, security ticket links, auth session evidence, and CORS/webhook test evidence.

## Required Evidence Commands

Record the command, commit SHA, environment, date, and result for each run.

```bash
npm test --workspace=backend -- --forceExit
npm run prisma:validate --workspace=backend
npm run openapi:validate --workspace=backend
npm run lint --workspace=frontend
npm run build --workspace=frontend
npm run smoke:deploy --workspace=backend
```

Recommended focused frontend assertions:

```bash
npm run test:permissions --workspace=frontend
npm run test:commercial-traceability --workspace=frontend
npm run test:procurement-risk --workspace=frontend
npm run test:workflow-maturity --workspace=frontend
npm run test:project-setup --workspace=frontend
npm run test:dashboard --workspace=frontend
npm run test:auth-token-storage --workspace=frontend
```

## Signoff Record

Current operational signoff packet status: `Repo controls ready; external cloud evidence and named owner signatures required before source-of-truth approval`.

| Role | Required Decision | Minimum Evidence | Signer | Date | Status |
|---|---|---|---|---|---|
| Product owner | The release meets MVP scope and pilot restrictions are lifted or accepted. | Readiness matrix review, scenario evidence, release notes. | Named Product owner required | Pending owner review | Awaiting evidence |
| QA owner | End-to-end scenarios passed or risks are accepted. | Scenario run log, screenshots/API evidence, defect list. | Named QA owner required | Pending owner review | Awaiting evidence |
| Security owner | Production security checklist passed. | Secret-rotation confirmation ticket, env validation, CORS/webhook evidence. | Named Security owner required | Pending owner review | Awaiting evidence |
| Backend owner | APIs, data model, calculations, audit, and tenant scoping are production-ready. | Backend tests, OpenAPI validation, smoke output, blocker review. | Named Backend owner required | Pending owner review | Awaiting evidence |
| Frontend owner | User workflows, permissions, dashboard, and responsive smoke paths are production-ready. | Lint/build, frontend assertions, browser smoke evidence. | Named Frontend owner required | Pending owner review | Awaiting evidence |
| Business owner | PM/commercial process can rely on the system as the official source of truth. | EV/commercial reconciliation, pilot closeout, risk acceptance if any. | Named Business owner required | Pending owner review | Awaiting evidence |
| DevOps owner | Deployment, rollback, monitoring, and operational runbooks are production-ready. | Parameterized deploy workflow, staging deploy rehearsal, rollback rehearsal, CloudWatch/SNS alert evidence. | Named DevOps owner required | Pending owner review | Awaiting cloud evidence |
| Database owner | Backup, restore, migration, and RPO/RTO controls are production-ready. | RDS retention/Multi-AZ evidence, restore drill timings, migration rollback rehearsal, restored construction scenario smoke. | Named Database owner required | Pending owner review | Awaiting restore evidence |
| Support owner | Support runbook, severity model, escalation, customer communication, and onboarding handoff are production-ready. | Support runbook tabletop, escalation owner list, documentation readiness QA, known-limitation acceptance. | Named Support owner required | Pending owner review | Awaiting evidence |
| Documentation owner | Admin, role user, API, onboarding, release-note, and limitation docs match the release workflow. | Documentation readiness QA, Help Center screenshot, OpenAPI validation, UAT reviewer notes. | Named Documentation owner required | Pending owner review | Awaiting evidence |

## Risk Acceptance Record

Use this table only when a gate cannot pass before rollout.

| Risk ID | Gate ID | Issue | Impact | Compensating Control | Expiry Date | Rollback Plan | Required Approvers | Status |
|---|---|---|---|---|---|---|---|---|
| No active risk acceptance | Not applicable | No P0/P1 go-live risk has been accepted in this gate. | Not applicable | Not applicable | Not applicable | Not applicable | Product, QA, Security, Backend, Frontend, Business | Not accepted |

## Release Decision

| Release | Commit SHA | Environment | Decision | Decision Date | Notes |
|---|---|---|---|---|---|
| TASK-P1-DEVOPS-001 repository controls | Current branch commit pending final SHA | Staging and production evidence pending | Pilot/demo only | Pending owner review | Deployment parameterization, RDS Multi-AZ guard, and monitoring subscription controls are implemented in repo; source-of-truth go-live still requires cloud rehearsal evidence and named signoffs. |
