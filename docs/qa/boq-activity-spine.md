# BOQ Activity Spine QA

## Purpose

TASK-P0-database-unify-boq-activity-spine blocks source-of-truth release until BOQ-created work is stored as official `Activity` rows with `ActivityBoqAllocation` value links. `BoqActivity` is retained only for AI suggestion/history records.

## Migration Controls

1. Take a database backup before applying `20260610070000_unify_boq_activity_spine`.
2. Dry-run the migration on a production copy and record counts for `BoqActivity`, `Activity`, and `ActivityBoqAllocation` before and after.
3. Confirm every accepted legacy `BoqActivity.acceptedActivityId` points to an `Activity` in the same project.
4. Confirm backfilled allocation totals do not exceed each `BoqItem.qty` or `BoqItem.amount`.
5. Rollback strategy: restore the pre-migration backup if activity or allocation counts do not reconcile, then re-run after fixing the source data.

## Manual QA

1. Create a BOQ row from the BOQ grid.
2. Confirm a real schedule activity appears in the schedule/activity list with the generated code as `wbsCode`.
3. Confirm the BOQ row shows an activity with `Allocation draft`.
4. Submit and approve the allocation in the Activity BOQ Allocation panel.
5. Add approved progress to the activity and confirm BOQ earned value and EV reports use the same `Activity.id`.
6. Attempt to edit or delete the approved BOQ activity helper row and confirm the UI disables the action or the API returns `ALLOCATION_NOT_EDITABLE`.
7. Attempt an over-allocation and confirm the API returns a structured capacity error.

## Acceptance Evidence

Record backend test output, Prisma validation, OpenAPI validation, frontend build output, and screenshots/API payloads for the manual QA scenario in the go-live readiness gate under `GL-P0-001`.
