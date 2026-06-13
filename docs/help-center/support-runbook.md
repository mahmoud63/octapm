# Support Runbook

Task: `TASK-P2-DOC-001`

Audience: customer support, implementation, QA, DevOps, backend, frontend, security, and product owners.

## Support Principles

- Preserve audit history. Do not repair production data by direct database update unless a named incident owner approves the change and a rollback plan is recorded.
- Capture evidence before escalation: environment, user, role, org ID, project ID, record ID, endpoint, timestamp, request correlation if available, screenshot, and response envelope.
- Treat project files, financial records, IPC, EOT, change orders, RFIs, submittals, safety records, and quality records as customer-confidential.
- Use least privilege when reproducing a support issue.
- Keep demo/pilot restrictions visible until go-live signoff is complete.

## Severity Model

| Severity | Definition                                                                                                 | Examples                                                                                                               | Initial Response Target | Escalation                                         |
| -------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| Sev 1    | Platform unavailable, data exposure, security incident, or source-of-truth workflow blocked for all users. | Auth down, cross-org data leak, API unavailable, file access leak, payment webhook/security failure.                   | 15 minutes              | Support Lead, DevOps, Security, Backend, Product.  |
| Sev 2    | Critical project workflow blocked for one customer or project.                                             | PM cannot certify IPC, schedule import corrupts dates, approved EV cannot be generated, project files cannot download. | 1 hour                  | Support Lead, Backend/Frontend owner, Product.     |
| Sev 3    | Role or record-specific issue with workaround.                                                             | User missing project assignment, one RFI stuck, document preview unavailable but download works.                       | 1 business day          | Support, implementation, module owner if repeated. |
| Sev 4    | How-to, training, documentation, or low-impact defect.                                                     | Role guidance, onboarding question, report interpretation, non-blocking UI issue.                                      | 2 business days         | Support or Product.                                |

## Triage Flow

1. Confirm the environment: local, staging, pilot, production.
2. Confirm the user role and project assignment or project party membership.
3. Capture the exact action, endpoint if visible, and response envelope.
4. Check whether the issue matches a documented limitation in `release-notes-known-limitations.md`.
5. Reproduce with a test user in the same role where privacy permits.
6. Review the relevant module QA guide under `docs/qa/`.
7. Escalate with evidence and avoid speculative root cause labels.

## Common Issues

### User Cannot Sign In

Checks:

- Confirm email spelling and organization.
- Confirm invite or reset link has not expired.
- Confirm auth endpoints return the standard envelope.
- If repeated failures occur, check rate-limit/backoff behavior.

Escalate to Backend/Security if refresh rotation, replay rejection, cookie flags, or logout revocation behaves incorrectly.

### User Cannot See A Project

Checks:

- PM users should see org projects.
- Non-PM users need a project assignment or active project party membership.
- Direct access denial should return `403 PROJECT_ACCESS_DENIED`.
- External project party users should see only party-scoped records.

Escalate to Backend if project access differs between list and direct route. Escalate to Frontend if the API allows access but the route renders a misleading not-found state.

### Workflow Button Missing

Checks:

- Confirm the user's effective project role.
- Confirm workflow state: draft, submitted, approved, rejected, closed, archived, superseded, or cancelled.
- Confirm the action is allowed in `docs/qa/role-permission-matrix.md`.
- Confirm frontend visibility and backend authorization agree.

Escalate to Frontend for hidden enabled actions that should appear. Escalate to Backend for an API action allowed to a role that should be blocked.

### BOQ Upload Fails

Checks:

- Confirm file type, workbook format, required columns, and project.
- For more than 60 BOQ rows, confirm chunking by section.
- Confirm duplicate active BOQ codes are rejected with a structured error.
- Confirm upload storage is private and no runtime files are tracked by git.

Escalate to Backend for parser errors, allocation integrity errors, or orphaned upload jobs. Escalate to Product if the customer workbook uses an unsupported template.

### Schedule Import Or AI Generation Fails

Checks:

- Confirm XER/XML/MSP file type and size.
- Confirm P6 XER durations were interpreted as hours divided by 8 working hours per day.
- Confirm Activity IDs, calendars, dependency logic, and data date after import.
- Confirm AI generation did not exceed provider/rate limits.

Escalate to Backend for parser/CPM errors. Escalate to Product/Planning if imported logic is valid but business interpretation is disputed.

### Progress Or EV Looks Wrong

Checks:

- Confirm progress was submitted by an assigned activity user or PM/Planning override.
- Confirm progress was approved.
- Confirm BOQ/activity allocation is approved.
- Confirm reporting cutoff and actual-through dates.
- Confirm dashboard pending-review values are not being mistaken for official values.

Escalate to Backend for formula/source errors. Escalate to Product/QA if the expected calculation needs acceptance criteria clarification.

### IPC, Payment, Or Retention Blocked

Checks:

- Confirm the IPC period is in the expected workflow state.
- Confirm certified value does not exceed approved BOQ/variation/progress caps unless PM override is required and supplied.
- Confirm Finance has permission for certification, invoice, payment, and retention release actions.
- Confirm retention default and contract-specific override.

Escalate to Backend for cap or precision defects. Escalate to Product/Finance for business-rule disputes.

### File Preview Or Download Blocked

Checks:

- Confirm user has project access.
- Confirm document revision status and latest-approved rules.
- Confirm file scan status and private storage key exist.
- Confirm local/private storage is not expected to be publicly browsable.

Escalate to Security for any suspected cross-project or unauthenticated file access. Escalate to Backend for presigned URL or stream errors.

### Notifications Missing

Checks:

- Confirm in-app notification preference.
- Confirm event source: assignment, due, overdue, approval, rejection, or workflow status change.
- Confirm provider-backed email delivery attempts and retry state if email is expected.
- Confirm spam/quarantine only after the app has recorded a delivery attempt.

Escalate to Backend for missing event fanout or delivery attempts. Escalate to DevOps for provider or DNS issues.

### API Consumer Reports Contract Mismatch

Checks:

- Confirm the consumer is using `/api/v1/`.
- Confirm Swagger UI at `/api/v1/docs` and JSON at `/api/v1/openapi.json`.
- Run `npm run openapi:validate --workspace=backend`.
- Confirm auth uses bearer access tokens except refresh routes that use the refresh cookie.

Escalate to Backend if a live route is undocumented or documented response shape differs from implementation.

## Incident Process

1. Assign incident owner and severity.
2. Preserve evidence and stop risky manual retries.
3. Identify customer impact, data exposure possibility, and workaround.
4. Open escalation channel with Product, Support, QA, and module owners.
5. For Sev 1 security/data issues, include Security and DevOps immediately.
6. Record timeline: detected, acknowledged, mitigated, resolved, customer update sent.
7. After resolution, add a post-incident note with root cause, fix, tests, and documentation updates.

## Escalation Matrix

| Area                                      | Primary Owner | Secondary Owner  |
| ----------------------------------------- | ------------- | ---------------- |
| Auth, sessions, invitations, rate limits  | Backend       | Security         |
| Project access, RBAC, external parties    | Backend       | Product          |
| Schedule, CPM, imports, AI generation     | Backend       | Planning/Product |
| BOQ, allocations, EV, reports             | Backend       | QS/Product       |
| IPC, payments, retention, cost            | Backend       | Finance/Product  |
| Frontend navigation, forms, responsive UI | Frontend      | QA               |
| File access, private storage, secrets     | Security      | DevOps           |
| Deployment, smoke, monitoring, backups    | DevOps        | Database         |
| Customer expectation or limitation        | Product       | Support          |

## Support Evidence Template

```text
Environment:
Customer/org:
Project ID:
User email and role:
Project assignment or party role:
Workflow/module:
Record ID:
Action attempted:
Timestamp and timezone:
Expected behavior:
Actual behavior:
Response envelope or error code:
Screenshot/log link:
Workaround:
Severity:
Escalation owner:
```

## Approval Record

| Role            | Decision                                                                    | Signer                         | Date                 | Status           |
| --------------- | --------------------------------------------------------------------------- | ------------------------------ | -------------------- | ---------------- |
| Support Lead    | Runbook ready for pilot support.                                            | Named Support Lead required    | Pending owner review | Awaiting signoff |
| Product Manager | Known limitations and customer messaging accepted.                          | Named Product Manager required | Pending owner review | Awaiting signoff |
| QA Lead         | Runbook aligns with regression and UAT evidence workflow.                   | Named QA Lead required         | Pending owner review | Awaiting signoff |
| DevOps Lead     | Escalation and incident process aligns with deployment/monitoring runbooks. | Named DevOps Lead required     | Pending owner review | Awaiting signoff |
