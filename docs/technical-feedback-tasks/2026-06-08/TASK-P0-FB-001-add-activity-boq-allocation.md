# TASK FB-001: Add Activity BOQ Allocation Spine

## Priority
P0

## Related Feedback

- Feedback ID: FB-001
- Original feedback summary: Add an `ActivityBoqAllocation` bridge so BOQ value is explicitly allocated to real schedule activities.

## Current Project Status

The project has BOQ-side records and real schedule activities, but no canonical allocation entity connecting them. Some downstream records link to activities while others link to BOQ items.

## Evidence

- `backend/prisma/schema.prisma`, lines 132-177: `BoqItem` and `BoqActivity` exist.
- `backend/prisma/schema.prisma`, lines 188-241: `Activity` is the real schedule entity.
- `backend/prisma/schema.prisma`, lines 353-373: `IpcItem` links to `BoqItem`, not an activity allocation.
- Search found no `ActivityBoqAllocation` model or equivalent bridge.

## Gap Analysis

The system cannot prove which BOQ quantity/value belongs to which official schedule activity. This weakens EV, IPC, commercial, and dashboard traceability.

## Required Changes

- [ ] Add an `ActivityBoqAllocation` Prisma model with project, BOQ item, activity, quantity, amount, weight, source, approval status, and audit fields.
- [ ] Add constraints to prevent duplicate active allocations and allocation totals above BOQ quantity/value.
- [ ] Add allocation services and APIs for create, edit, submit, approve, reject, and list.
- [ ] Update EV, IPC, commercial, and dashboard calculations to use approved allocations.
- [ ] Add frontend BOQ-to-activity mapping workflow and unallocated value display.

## Suggested Technical Approach

Start with Prisma schema and migration, then add a backend allocation service under `backend/src/services` and routes under `backend/src/routes`. Use the service from BOQ, EV, IPC, and commercial workflows. Build a frontend allocation grid that supports one-to-many and many-to-one mappings.

## Acceptance Criteria

- [ ] A BOQ item can be allocated to one or more schedule activities.
- [ ] Allocation totals cannot exceed BOQ quantity/value without a clear validation error.
- [ ] Activity detail shows approved allocated BOQ value and weight.
- [ ] Unallocated BOQ value is visible and excluded from official EV/IPC calculations.
- [ ] Tests cover validation, approval, tenant scoping, and EV/IPC impact.

## Testing Requirements

Add backend unit and integration tests for allocation validation, multi-tenant scoping, approval workflow, and EV/IPC rollups. Add frontend tests for allocation totals and manual QA for BOQ -> activity -> dashboard flow.

## Risks

High data-model and migration risk. Existing BOQ activity records may need conversion or a transitional mapping strategy.

## Dependencies

Supports FB-002, FB-007, FB-012, FB-015, and FB-020. Audit fields should align with FB-010.

## Estimated Effort
XL

## Notes

This is the main structural task needed to make the platform a reliable activity-linked source of truth.
