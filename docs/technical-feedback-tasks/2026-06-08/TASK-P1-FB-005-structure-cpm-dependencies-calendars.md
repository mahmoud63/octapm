# TASK FB-005: Structure CPM Dependencies and Calendars

## Priority
P1

## Related Feedback

- Feedback ID: FB-005
- Original feedback summary: Improve schedule/CPM model with structured predecessor records, FS/SS/FF/SF, lag/lead, calendars, approval, and critical path explanation.

## Current Project Status

The CPM engine parses predecessor strings and supports FS, SS, FF, SF, and lag/lead calculations. The persisted/editable dependency model is still largely free text.

## Evidence

- `backend/src/services/cpm.service.js`, lines 3-24: predecessor parser.
- `backend/src/services/cpm.service.js`, lines 121-126 and 156-163: relationship type handling in forward/backward pass.
- `backend/src/services/schedule.service.js`, lines 901-906: persists float, critical flag, and predecessor strings.
- `frontend/src/features/schedule/components/activity-inline-edit-dialog.tsx`, lines 18, 39, 51, 109: predecessor edited as text.
- `backend/prisma/schema.prisma`, lines 194-205: activity calendar/baseline fields exist but no dependency table.

## Gap Analysis

Free-text dependencies are fragile for validation, imports, edits, cycle detection, API consumers, and critical path explanation.

## Required Changes

- [ ] Add an `ActivityDependency` model with predecessor, successor, relationship type, lag days, source, and import metadata.
- [ ] Migrate or parse existing predecessor strings into structured rows.
- [ ] Update CPM service to consume structured dependencies.
- [ ] Add frontend dependency editor controls for relationship type and lag/lead.
- [ ] Add critical path explanation output showing predecessor chain and float drivers.

## Suggested Technical Approach

Reuse the existing parser as migration/import normalization logic. Introduce structured dependencies behind the API first, then update frontend controls. Add cycle and invalid relationship validation before CPM recalculation.

## Acceptance Criteria

- [ ] Users can edit FS, SS, FF, and SF dependencies with lag/lead using structured controls.
- [ ] CPM uses structured dependency rows.
- [ ] Invalid cycles and malformed dependencies return clear errors.
- [ ] Critical path explanation is available in schedule UI/API.
- [ ] Importers map P6/MSP relationships into structured dependencies.

## Testing Requirements

Add CPM unit tests for relationship types, lag/lead, calendars, and cycles. Add import mapping tests and frontend dependency editor validation tests.

## Risks

Dependency migration can change CPM results. Keep before/after fixtures to compare schedule dates and float.

## Dependencies

Pairs with FB-004 approval workflow and FB-006 revision preservation.

## Estimated Effort
XL

## Notes

The current CPM parser is useful and should be retained for compatibility/migration.
