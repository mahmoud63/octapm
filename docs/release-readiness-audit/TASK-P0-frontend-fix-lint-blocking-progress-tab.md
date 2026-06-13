# TASK: Fix Blocking Schedule Progress Tab Lint Failure

## Task ID
TASK-P0-FE-001

## Priority
P0

## Severity
High

## Area
Frontend

## Related Feature
SCH-02, TECH-TEST-01

## Related Risk
RISK-FE-001

## Problem Summary
Frontend ESLint fails in the schedule progress tab. A release cannot proceed with red lint gates.

## Evidence
- `frontend/src/features/schedule/components/progress-tab.tsx:198` violates `react-hooks/preserve-manual-memoization`.
- Frontend lint reported 2 errors and 17 warnings.

## Why This Blocks or Affects Launch
The schedule progress workflow is a core construction feature. A red lint gate indicates code quality/release validation is not clean.

## Business Impact
- Project managers: progress workflow quality is uncertain.
- Contractors: schedule progress updates drive dashboards and EV.
- Consultants/owners: unreliable progress review damages trust.
- Site engineers: field progress entry may be fragile.

## Technical Impact
CI quality gates fail, blocking repeatable releases.

## Required Changes
- [ ] Fix the memoization/lint violation.
- [ ] Resolve the second ESLint error.
- [ ] Review warnings for field-workflow risk.
- [ ] Re-run frontend lint and type-check.

## Suggested Implementation Approach
- Frontend changes: refactor the memoized calculation without breaking hook rules.
- Backend changes: none expected.
- Database changes: none expected.
- API changes: none expected.
- Permission changes: none expected.
- Test changes: add component/unit coverage if logic changes.
- Documentation changes: record validation result in release packet.

## Acceptance Criteria
- [ ] `npm run lint` or equivalent passes.
- [ ] `tsc -b --noEmit` still passes.
- [ ] Schedule progress UI still renders and updates correctly.

## Testing Requirements
- Unit/component tests for progress tab if available.
- Integration checks against progress API.
- E2E progress update smoke test.
- Manual QA on schedule progress workflow.
- Regression check for dashboard EV metrics.

## Dependencies
None.

## Risks
Refactor could alter progress aggregation if memoized dependencies are changed incorrectly.

## Estimated Effort
S

## Recommended Owner
Frontend Developer

