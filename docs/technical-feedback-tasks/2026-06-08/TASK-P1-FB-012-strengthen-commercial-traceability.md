# TASK FB-012: Strengthen Commercial Traceability

## Priority
P1

## Related Feedback

- Feedback ID: FB-012
- Original feedback summary: Link commercial records to activities, BOQ, approved variations, EOT events, correspondence, and critical path impact.

## Current Project Status

Commercial models exist for change orders, IPC, sub valuations, budget revisions, cash flow, weather delays, and EOT claims. Links are present but often optional, single-record, or not tied to approved allocations.

## Evidence

- `backend/prisma/schema.prisma`, lines 330-348: `ChangeOrder` has optional single `activityId`.
- `backend/prisma/schema.prisma`, lines 353-373: `IpcItem` links to `BoqItem`, not activity allocations.
- `backend/prisma/schema.prisma`, lines 454-474: `SubValuation` is project-level.
- `backend/prisma/schema.prisma`, lines 516-535: `EotClaim` exists with delay/EOT/LD fields.
- `backend/src/services/eot.service.js`, lines 23-88: EOT calculations use affected activity payload data.
- `frontend/src/features/commercial/components/change-order-form.tsx`, lines 169-197: change order selects one activity.

## Gap Analysis

Commercial records often need many activities, BOQ allocation links, correspondence, attachments, approval history, and critical path impact, not just a single optional activity or JSON payload.

## Required Changes

- [ ] Add join models linking commercial records to multiple activities and BOQ allocations.
- [ ] Link IPC certification to approved progress/allocation data.
- [ ] Link EOT/weather events to affected activities, delay windows, correspondence, and CPM impact.
- [ ] Add attachment/correspondence references and audit events.
- [ ] Update commercial UI to display traceability chains.

## Suggested Technical Approach

Add relationship tables for change orders, EOT claims, IPC items, and sub valuations. Keep existing single `activityId` fields as backward-compatible denormalized fields only if needed.

## Acceptance Criteria

- [ ] A change order can link to multiple activities and BOQ allocations.
- [ ] IPC lines reconcile to approved progress/allocation amounts.
- [ ] EOT claims show affected activities and critical path impact.
- [ ] Commercial records show attachments and approval history.
- [ ] Tests cover BOQ allocation -> commercial record -> dashboard impact.

## Testing Requirements

Add integration tests for CO, IPC, sub valuation, and EOT traceability. Add frontend tests for linked-record forms and manual QA with a sample claim package.

## Risks

Commercial relationship changes affect financial reports and may require data migration.

## Dependencies

Depends heavily on FB-001 and FB-010. EOT critical path impact also depends on FB-005.

## Estimated Effort
XL

## Notes

This work changes commercial modules from coverage demos into defensible workflows.
