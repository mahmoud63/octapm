# TASK FB-016: Replace Generic Dashboard Content

## Priority
P2

## Related Feedback

- Feedback ID: FB-016
- Original feedback summary: Replace generic admin dashboard content with construction PM health and workflow dashboard content.

## Current Project Status

The app has construction-specific modules and a project health API, but the main dashboard still contains generic admin-template metrics.

## Evidence

- `frontend/src/features/dashboard/index.tsx`, lines 43, 68, 94, 153: dashboard shows `Total Revenue`, `Subscriptions`, `Sales`, and `Recent Sales`.
- `backend/src/routes/health.js`, lines 172-229: backend provides construction health dimensions.
- Project-level health content exists elsewhere, but not as the main dashboard experience.

## Gap Analysis

The first dashboard screen can confuse users/evaluators because it does not show construction PM status, risks, approvals, or project health.

## Required Changes

- [ ] Replace generic metric cards with construction PM metrics.
- [ ] Surface workflow queues: schedule approvals, progress approvals, IPC actions, procurement risks, NCR/RFI overdue items.
- [ ] Link dashboard sections to relevant modules.
- [ ] Add a portfolio/workspace summary API if current project health APIs are insufficient.
- [ ] Remove unused template components.

## Suggested Technical Approach

Refactor `frontend/src/features/dashboard/index.tsx` around current projects and health summaries. Add a backend aggregate endpoint only if needed.

## Acceptance Criteria

- [ ] No generic sales/subscription placeholders remain.
- [ ] Dashboard shows construction PM metrics and workflow actions.
- [ ] Empty states are useful for new workspaces.
- [ ] Dashboard links navigate to correct modules.
- [ ] UI is validated in light/dark modes.

## Testing Requirements

Add frontend component tests where practical, manual visual QA, and navigation smoke tests.

## Risks

Portfolio metrics may require backend aggregation and permissions. Avoid alert noise.

## Dependencies

Benefits from FB-007, FB-009, FB-013, and FB-014.

## Estimated Effort
M

## Notes

This is highly visible for demos but lower risk than data-model tasks.
