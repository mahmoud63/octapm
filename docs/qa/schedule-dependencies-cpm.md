# Schedule Dependencies and CPM QA

## Scope

Validates structured schedule dependencies, CPM relationship semantics, calendar-aware planned dates, baseline locking, and revision comparison/activation workflows.

## Automated Checks

- Backend CPM unit tests cover FS, SS, FF, SF, positive lag, negative lead, cycle rejection, and five/six/seven-day calendar date conversion.
- Backend route validation tests reject unsupported relationship types before service persistence.
- Frontend schedule dependency UI assertions verify structured dependency controls and calendar-aware date display hooks.
- OpenAPI validation must pass so activity dependency request/response contracts stay documented.

## Manual Construction Scenarios

1. As PM, create a project starting on Friday, January 2, 2026 with `five_day` calendar.
2. Create Activity A with duration 1 day and Activity B with duration 2 days.
3. Edit Activity B and add Activity A as predecessor with `FS` and lag `0`.
4. Confirm CPM offsets show Activity A `ES=0 EF=1` and Activity B `ES=1 EF=3`.
5. Hover the Gantt bars or activity-table CPM cells and confirm dates skip the weekend: Activity A finishes Monday, January 5, 2026; Activity B finishes Wednesday, January 7, 2026.
6. Change the project calendar to `six_day`, recalculate by editing duration/dependencies, and confirm Saturday is counted as a working day.
7. Add a negative lag/lead relationship such as `SS -1`; confirm API accepts it and the Gantt/table predecessor text shows the lead.
8. Attempt a circular dependency A -> B -> A; confirm the API returns `CPM_DEPENDENCY_CYCLE` and no dependency rows are persisted.
9. Submit, approve, and baseline the schedule revision. Confirm baseline offsets and baseline hover dates remain visible after refresh.
10. Upload or generate a new schedule revision. Confirm the revision mapping/compare view shows staged vs active activities before activation, and activation replaces dependency rows without deleting linked progress/cost records.

## Role Checks

- PM can create/update dependencies, approve revisions, activate revisions, and lock baselines.
- Planning Engineer can create/update schedule logic and submit revisions for review.
- Planning Engineer cannot approve, activate, rollback, or baseline a revision.
- Non-schedule roles can read permitted project schedules but do not see misleading edit/approval actions.

## Regression Checks

- BOQ allocations remain linked to active activities after revision activation.
- Approved progress remains the source of official EV after CPM recalculation.
- Procurement long-lead risk still resolves activity need dates from the active schedule.
- XLSX export Master Schedule dates match the project calendar used by CPM.
