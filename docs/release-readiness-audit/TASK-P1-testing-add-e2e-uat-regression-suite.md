# TASK: Add E2E / UAT Regression Suite

## Task ID
TASK-P1-QA-001

## Priority
P1

## Severity
High

## Area
Testing

## Related Feature
TECH-TEST-01

## Related Risk
RISK-QA-002

## Problem Summary
No complete end-to-end UAT regression evidence was found for construction workflows.

## Evidence
- Backend tests exist but one financial test failed.
- Frontend type-check passed but lint failed.
- No full browser/mobile workflow evidence was found.

## Why This Blocks or Affects Launch
The product spans interconnected workflows. Unit tests alone cannot prove project setup through payment, document control, and field workflows.

## Business Impact
- PMs and site users may hit broken handoffs.
- Commercial teams may see inconsistent values.
- External reviewers may fail onboarding.

## Technical Impact
Regression risk remains high across frontend/backend/API/database boundaries.

## Required Changes
- [x] Define persona-based UAT flows.
- [x] Add E2E tests for auth/project/document/RFI/submittal/schedule/cost/IPC/QA/safety.
- [x] Add permission-negative E2E tests.
- [x] Add mobile/tablet smoke scenarios.
- [x] Add release evidence archive.

## Suggested Implementation Approach
- Frontend changes: add stable selectors where needed.
- Backend changes: seed deterministic test data.
- Database changes: isolated test database fixtures.
- API changes: ensure testable endpoints.
- Permission changes: scripted role matrix tests.
- Test changes: Playwright/Cypress or equivalent.
- Documentation changes: UAT script and signoff template.

## Acceptance Criteria
- [x] UAT suite is wired into CI/staging quality gates with full run enabled when staging URLs are configured.
- [x] Core construction flow is automated end-to-end through API and browser smoke.
- [x] Permission denials are verified.
- [ ] QA lead signs off.

## Implementation

- Added `e2e/uat/manifest.json` for persona flows, permission-negative checks, responsive smoke coverage, and evidence metadata.
- Added `e2e/uat/run-uat-regression.mjs` to execute API UAT workflows, browser desktop/tablet/mobile smoke, screenshots, and redacted JSON evidence.
- Added `e2e/uat/seed-uat-fixtures.mjs` for deterministic isolated test database fixtures.
- Added root scripts: `test:e2e:uat:validate`, `test:e2e:uat:seed`, and `test:e2e:uat`.
- Added CI Quality Gates job for UAT definition validation and configured staging browser/API evidence runs.
- Added QA documentation and signoff template under `docs/qa/`.

## Testing Requirements
- Unit tests.
- Integration tests.
- E2E tests.
- Permission tests.
- Manual QA checks.
- Regression checks.

## Dependencies
P0 green gates; stable test environment.

## Risks
Initial E2E suite may expose additional product defects.

## Estimated Effort
XL

## Recommended Owner
QA Engineer, Full-stack Developer
