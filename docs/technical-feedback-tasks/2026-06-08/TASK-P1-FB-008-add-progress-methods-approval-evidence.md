# TASK FB-008: Add Progress Methods, Approval, and Evidence

## Priority
P1

## Related Feedback

- Feedback ID: FB-008
- Original feedback summary: Add quantity-based progress, weighted milestones, approval workflow, daily reports, photo evidence, and mobile site updates.

## Current Project Status

Users can update activity percent complete, actual dates, actual cost, and notes. Bulk percent update UI exists. Daily report schema exists but is not surfaced through routes/UI.

## Evidence

- `backend/prisma/schema.prisma`, lines 244-257: `ActivityProgress` stores percent complete, actual cost, actual start/finish, notes, and updater.
- `backend/src/routes/activities.js`, lines 74-84 and 144-153: progress endpoints accept percent, actual cost, dates, and notes.
- `frontend/src/features/schedule/components/progress-tab.tsx`, lines 21-69 and 76-100: progress UI and metrics.
- `frontend/src/features/schedule/components/bulk-progress-update.tsx`, lines 16-100: bulk update UI.
- `backend/prisma/schema.prisma`, lines 888-906: `DailyReport` includes manpower/equipment/materials/photos, but no route was found.

## Gap Analysis

Progress is mostly percent-based and immediate. There is no official method configuration, submitted/approved state, evidence requirement, or daily site workflow.

## Required Changes

- [ ] Add progress method configuration per activity/work package.
- [ ] Support percent, quantity, weighted milestone, inspection, and manual methods.
- [ ] Add progress submission/approval states with reviewer, timestamp, and rejection reason.
- [ ] Expose daily report APIs for manpower, equipment, materials, notes, and photos.
- [ ] Update official EV to use approved progress only.

## Suggested Technical Approach

Introduce `ProgressSubmission` or extend `ActivityProgress` to separate draft/submitted updates from approved progress. Wire daily report models to services/routes and storage. Keep current percent update as draft/quick entry until official workflow is enabled.

## Acceptance Criteria

- [ ] Activities can use configured progress methods.
- [ ] Submitted progress does not affect official EV until approved.
- [ ] Daily reports can include photos, manpower, equipment, materials, and notes.
- [ ] Approvers can approve/reject with reason and timestamp.
- [ ] Tests cover method calculation, approval gating, and EV impact.

## Testing Requirements

Add backend tests for progress calculations and approvals, upload tests for evidence, frontend workflow tests, and manual QA using a site engineer scenario.

## Risks

Evidence uploads require secure storage and permissions. Misconfigured progress methods can distort EV.

## Dependencies

Depends on FB-007 for EV basis, FB-010 for audit/history, and FB-011 for site workflow depth.

## Estimated Effort
XL

## Notes

The daily report schema is a useful starting point but currently underused.
