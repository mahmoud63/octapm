# TASK FB-006: Control Schedule Regeneration and Preserve History

## Priority
P0

## Related Feedback

- Feedback ID: FB-006
- Original feedback summary: Control schedule regeneration/import revisions with mapping, approval, audit history, and preservation of progress/history.

## Current Project Status

Schedule revisions and revision comparison exist, but generated schedule save logic deletes live linked records before recreating schedule data.

## Evidence

- `backend/src/services/schedule.service.js`, lines 852-868: deletes BOQ items, activity materials/equipment/assignments/progress, cost records, long-lead items, risks, and activities.
- `backend/src/services/schedule.service.js`, lines 1008-1012: creates a schedule revision snapshot after generation.
- `frontend/src/features/schedule/components/revision-history-panel.tsx`, lines 228-262: revision comparison UI exists.
- `backend/src/routes/schedule.js`, lines 51-70: revision list/detail APIs exist.

## Gap Analysis

Current regeneration can remove operational records tied to existing activities. There is no staging, old-to-new activity mapping, approval, rollback, or preservation workflow.

## Required Changes

- [ ] Replace destructive delete-and-recreate logic with staged draft revisions.
- [ ] Add old/new activity mapping using IDs, codes, names, and user confirmation.
- [ ] Preserve or migrate progress, cost records, allocations, procurement, risks, and assignments for mapped activities.
- [ ] Require approval before a staged revision becomes active.
- [ ] Add rollback and audit history for revision activation.

## Suggested Technical Approach

Create revision-scoped staging records or draft schedule tables. Activate an approved revision transactionally after mapping is confirmed. Existing delete logic should apply only to disposable draft artifacts, not official project records.

## Acceptance Criteria

- [ ] Generating/importing a schedule does not delete active progress, cost, procurement, risk, or assignment records.
- [ ] Users can compare and map changed activities before activation.
- [ ] Mapped activity history remains visible after activation.
- [ ] Unmapped removals require explicit approval and reason.
- [ ] Integration tests prove linked records survive regeneration.

## Testing Requirements

Add P0 integration tests for regenerate/import with existing progress, cost records, allocations, risks, procurement, and assignments. Add manual QA for before/after activation and rollback.

## Risks

This is a production blocker because current code can delete live operational records.

## Dependencies

Depends on FB-004 approval lifecycle, FB-010 audit history, and eventually FB-001 allocation preservation.

## Estimated Effort
XL

## Notes

Fix before any live project uses schedule regeneration/import as official workflow.
