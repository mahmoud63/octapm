# TASK FB-015: Add Guided Project Setup Wizard

## Priority
P2

## Related Feedback

- Feedback ID: FB-015
- Original feedback summary: Add a guided PM setup workflow from project creation through BOQ, schedule, mapping, baseline, and progress readiness.

## Current Project Status

Users can access the necessary modules separately, but no guided setup checklist/wizard was found.

## Evidence

- `frontend/src/features/projects/components/project-create-dialog.tsx`, lines 61-69: project creation is a standard dialog with basic defaults.
- `frontend/src/features/projects/components/project-detail-page.tsx`: project detail exposes module navigation.
- No setup wizard/readiness checklist was found in source search.

## Gap Analysis

PMs can miss required setup steps such as BOQ allocation, cost loading review, engineer assignment, schedule approval, and baseline readiness.

## Required Changes

- [ ] Define setup steps and readiness checks with Product/PM stakeholders.
- [ ] Add backend readiness endpoint for each setup step.
- [ ] Add frontend guided checklist/wizard on project detail.
- [ ] Link each step to the relevant module or action.
- [ ] Gate official baseline/progress workflows where critical checks fail.

## Suggested Technical Approach

Create a read-only readiness service using existing data first. Add UI next. Expand checks as FB-001, FB-004, and FB-007 mature.

## Acceptance Criteria

- [ ] Project detail shows setup readiness and next action.
- [ ] Each setup step links to the correct module.
- [ ] Critical blockers such as no BOQ, no approved schedule, or no allocations are visible.
- [ ] Baseline/progress actions warn or block when required checks fail.
- [ ] QA can verify empty project -> ready-for-progress workflow.

## Testing Requirements

Add backend readiness tests, frontend checklist tests, and manual PM onboarding walkthrough.

## Risks

Readiness rules will evolve. Avoid hard-blocking demos until Product signs off.

## Dependencies

Depends on FB-001, FB-004, FB-007, and FB-009 for final gate behavior.

## Estimated Effort
M

## Notes

This is UX-heavy but reduces setup mistakes.
