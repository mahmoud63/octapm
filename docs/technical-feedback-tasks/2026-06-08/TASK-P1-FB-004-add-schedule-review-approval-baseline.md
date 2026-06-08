# TASK FB-004: Add Schedule Review, Approval, and Baseline Workflow

## Priority
P1

## Related Feedback

- Feedback ID: FB-004
- Original feedback summary: Convert AI schedule generation/import into review, edit, approve, and baseline workflow.

## Current Project Status

The system can generate schedules, store schedule revisions, compare revisions, edit activities, and lock a baseline. Approval is not modeled as a formal lifecycle.

## Evidence

- `backend/src/services/schedule.service.js`, lines 1008-1012: schedule revision snapshot creation.
- `backend/src/services/schedule.service.js`, lines 1230-1253: baseline lock service.
- `backend/src/routes/schedule.js`, lines 51-70 and 79-84: revision and baseline endpoints.
- `frontend/src/features/schedule/components/revision-history-panel.tsx`, lines 44-53 and 228-262: revision compare UI.
- `frontend/src/features/schedule/components/schedule-dashboard.tsx`, lines 225-229: baseline lock uses simple browser confirm.

## Gap Analysis

Generated or imported schedules can become official without explicit review status, approver, rejection reason, readiness checklist, or audit trail.

## Required Changes

- [ ] Add schedule revision statuses: draft, under review, approved, rejected, baselined, superseded.
- [ ] Require authorized approval before baseline lock.
- [ ] Store approver, timestamp, reason/comment, and status transition.
- [ ] Add readiness checks for predecessors, allocations, critical path, and date sanity.
- [ ] Replace browser confirm with controlled review/approval/baseline UI.

## Suggested Technical Approach

Extend `ScheduleRevision` and schedule service lifecycle transitions. Add policy checks once FB-009 exists. Add a frontend review panel and gate the baseline button behind approved status and readiness checks.

## Acceptance Criteria

- [ ] Draft schedules cannot be baselined.
- [ ] Approved schedules record approver and timestamp.
- [ ] Rejected schedules preserve reason and remain visible in history.
- [ ] Frontend shows current status and allowed next action.
- [ ] Tests cover valid and invalid lifecycle transitions.

## Testing Requirements

Add backend lifecycle tests, permission tests, frontend workflow tests, and manual QA for generate/import -> review -> approve -> baseline.

## Risks

Existing generated schedules need a migration/default status. Workflow changes can affect demos.

## Dependencies

Depends on FB-009 for permissions and FB-010 for audit history. Should be coordinated with FB-006.

## Estimated Effort
L

## Notes

This makes AI output a recommendation until it has been reviewed and approved.
