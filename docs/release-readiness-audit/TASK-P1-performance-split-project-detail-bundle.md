# TASK: Split oversized project detail frontend bundle

## Task ID
TASK-P1-PERF-001

## Priority
P1

## Severity
High

## Area
Frontend / Performance / UX

## Related Feature
F-120

## Related Risk
RISK-011

## Problem Summary
The production frontend build passes but emits a very large project detail chunk, risking slow first interaction for site teams.

## Evidence
Frontend build passed with Vite warning for _projectId chunk at approximately 850.46 kB minified. frontend/src/features/projects/components/project-detail.tsx:6-24 imports activities, BOQ, commercial, cost, doc control, equipment, meetings, quality, reports, schedule, and site reporting eagerly.

## Why This Blocks or Affects Launch
Field users on tablets and jobsite networks may experience slow project-load times in the primary workspace.

## Business Impact
Field users on tablets and jobsite networks may experience slow project-load times in the primary workspace.

## Technical Impact
The gap reduces confidence in the release candidate and must be closed or formally accepted before external customer use expands.

## Required Changes
- [ ] Lazy-load heavy project modules by active tab.
- [ ] Add route/module suspense loading states.
- [ ] Measure bundle size after split.
- [ ] Run browser smoke for all lazy modules.

## Suggested Implementation Approach
Close the gap on a clean release branch, update product/backend/frontend/database/API/permission/test/documentation assets where behavior changes, and record validation evidence in the release package.

## Acceptance Criteria
- [ ] Project detail initial chunk is below agreed threshold or justified.
- [ ] All modules load on demand without broken state.
- [ ] No regression in project permissions or deep links.

## Testing Requirements
Frontend build analysis; Playwright smoke; Lighthouse/performance smoke; mobile network throttle check.

## Dependencies
Complete all P0 release blockers first; then verify this item against the certified release candidate.

## Risks
Delaying this item can create onboarding, support, security, or customer trust risk during pilot expansion.

## Estimated Effort
M

## Recommended Owner
Frontend Developer, UX/UI Designer
