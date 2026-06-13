# Release Blockers

## P0 Blockers
- TASK-P0-BE-001: Party-scoped RFI/submittal workflow access can throw runtime errors.
- TASK-P0-BE-002: Risk closeout approval workflow regression.
- TASK-P0-QA-001: Backend Jest release gate failed.
- TASK-P0-FE-001: Frontend lint release gate failed.
- TASK-P0-DEVOPS-001: Secret hygiene validator crashes before scanning.
- TASK-P0-REL-001: Dirty source baseline prevents release certification.

## P1 Serious Issues
- TASK-P1-QA-002: Full staging UAT and browser regression evidence missing.
- TASK-P1-DEVOPS-002: Terraform/deployment smoke Cannot Verify locally.
- TASK-P1-NOTIF-001: Production notification/email delivery Cannot Verify.
- TASK-P1-SEC-001: Production secret/security signoff incomplete.
- TASK-P1-PERF-001: Oversized project detail bundle.
- TASK-P1-DOC-001: Root production setup documentation missing.

## Security Blockers
- Party-scoped workflow authorization regression.
- Secret hygiene validator failure.
- Dirty tracked/private-document baseline.
- Missing live permission-negative UAT.
- Missing production secret evidence.

## Data Integrity Blockers
- Risk closeout approval regression.
- RFI/submittal workflow failure.
- Backend test suite red.
- Dirty release baseline prevents certifying schema/source state.

## Workflow Blockers
- RFI creation/routing/approval cannot be certified.
- Submittal creation/review/approval cannot be certified.
- Risk closeout cannot be certified.
- Notifications for due dates and approvals cannot be certified.

## Deployment Blockers
- Secret hygiene validation failure.
- Clean release SHA unavailable.
- Terraform validation/deployment smoke evidence incomplete.
- Backup/restore and rollback evidence incomplete.

## QA Blockers
- Backend Jest failed.
- Frontend lint failed.
- Live staging UAT not executed or not evidenced.
- Mobile/tablet/accessibility QA incomplete.
