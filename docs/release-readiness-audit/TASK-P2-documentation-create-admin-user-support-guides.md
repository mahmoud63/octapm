# TASK: Create Admin, User, And Support Guides

## Task ID
TASK-P2-DOC-001

## Priority
P2

## Severity
Medium

## Area
Documentation

## Related Feature
TECH-DOC-01

## Related Risk
RISK-DOCS-001

## Problem Summary
Launch-ready user, admin, support, onboarding, and known-limitation documentation is incomplete.

## Evidence
- `frontend/src/routes/_authenticated/help-center/index.tsx:5` renders ComingSoon.
- OpenAPI docs exist, but user/admin/support documentation could not be verified as complete.
- Go-live signoffs contain TBD items in `docs/qa/go-live-readiness-gate.md:197-202`.

## Why This Blocks or Affects Launch
Construction teams need training, support, role guides, and known limitations before adoption.

## Business Impact
- Customers struggle to onboard.
- Support burden increases.
- Sales/implementation teams cannot set expectations.

## Technical Impact
Operational teams lack runbooks for common issues.

## Required Changes
- [x] Create admin guide.
- [x] Create user guide by role.
- [x] Create support runbook.
- [x] Publish API docs.
- [x] Write release notes and known limitations.
- [x] Create onboarding checklist.

## Suggested Implementation Approach
- Frontend changes: link help center to real docs.
- Backend changes: ensure Swagger/API docs are current.
- Database changes: none.
- API changes: document all public endpoints.
- Permission changes: document role matrix.
- Test changes: QA docs against actual workflows.
- Documentation changes: complete guides and signoffs.

## Acceptance Criteria
- [x] Admin and user guides are complete.
- [ ] Support runbook is approved.
- [x] Known limitations are published.
- [x] Help center no longer shows only coming soon.

## Testing Requirements
- Manual QA against docs.
- UAT tester follows guide without developer assistance.
- Regression checklist updated.

## Dependencies
Feature scope stabilized.

## Risks
Docs written before workflow completion may become stale.

## Estimated Effort
M

## Recommended Owner
Product Manager, QA Engineer

## Implementation Notes

- Added launch documentation under `docs/help-center/`:
  - `README.md`
  - `admin-guide.md`
  - `user-guide-by-role.md`
  - `support-runbook.md`
  - `api-docs.md`
  - `release-notes-known-limitations.md`
  - `onboarding-checklist.md`
- Added API documentation index at `docs/api/README.md`.
- Added documentation readiness QA checklist at `docs/qa/documentation-readiness.md`.
- Replaced the authenticated Help Center `ComingSoon` route with a real documentation hub.
- Added frontend source assertion `npm run test:help-center-docs --workspace=frontend`.

Support runbook approval remains a named owner signoff item and should be completed in the go-live evidence packet.
