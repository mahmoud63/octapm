# TASK: Complete field device and accessibility signoff

## Task ID
TASK-P2-UX-001

## Priority
P2

## Severity
Medium

## Area
UX / Frontend / QA

## Related Feature
F-119

## Related Risk
RISK-013

## Problem Summary
The UI has responsive components and UAT hooks, but field-device usability and accessibility were not fully verified in this audit.

## Evidence
frontend/src/features/projects/components/project-detail.tsx:632-664 includes loading/access-denied states and project permission context. UAT manifest includes mobile/tablet smoke definitions, but live device evidence was not available.

## Why This Blocks or Affects Launch
Site engineers and supervisors often use tablets/phones in poor network and outdoor conditions, so field UX must be tested explicitly.

## Business Impact
Site engineers and supervisors often use tablets/phones in poor network and outdoor conditions, so field UX must be tested explicitly.

## Technical Impact
The gap reduces confidence in the release candidate and must be closed or formally accepted before external customer use expands.

## Required Changes
- [ ] Run mobile/tablet manual QA across core workflows.
- [ ] Run accessibility checks on main dashboards and forms.
- [ ] Fix touch target, overflow, contrast, and focus issues.
- [ ] Capture signoff evidence.

## Suggested Implementation Approach
Close the gap on a clean release branch, update product/backend/frontend/database/API/permission/test/documentation assets where behavior changes, and record validation evidence in the release package.

## Acceptance Criteria
- [ ] Core workflows pass tablet smoke.
- [ ] Critical forms are keyboard navigable.
- [ ] No launch-blocking WCAG issues remain.

## Testing Requirements
Manual device QA; axe/accessibility checks; browser responsive smoke; regression suite.

## Dependencies
Complete all P0 release blockers first; then verify this item against the certified release candidate.

## Risks
Delaying this item can create onboarding, support, security, or customer trust risk during pilot expansion.

## Estimated Effort
M

## Recommended Owner
UX/UI Designer, QA Engineer, Frontend Developer
