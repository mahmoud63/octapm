# TASK FB-002: Harden BOQ Integrity

## Priority
P1

## Related Feedback

- Feedback ID: FB-002
- Original feedback summary: Harden BOQ module with unique constraints, scheduled/unscheduled value, earned/certified value, and non-editable generated activity codes.

## Current Project Status

Backend code generation exists for BOQ activity codes, but frontend forms still expose activity code entry/editing. Prisma has indexes but no uniqueness guarantee for BOQ activity code per project.

## Evidence

- `backend/src/utils/activity-code.js`, line 27: `nextActivityCode` generates backend codes.
- `backend/src/services/boq.service.js`, lines 532-538 and 576-589: create flows assign generated `activityCode`.
- `backend/prisma/schema.prisma`, lines 175-177: BOQ activities are indexed, not uniquely constrained.
- `frontend/src/features/boq/data/schema.ts`, lines 59-60 and 73: frontend schemas expose `activityCode`.
- `frontend/src/features/boq/components/boq-editable-grid.tsx`, lines 333-338: code is editable in the grid.

## Gap Analysis

Users can still interact with generated codes as if they are editable, and the database does not enforce uniqueness. BOQ scheduled/unscheduled/earned/certified values also need the allocation spine from FB-001.

## Required Changes

- [ ] Add unique constraints for BOQ item code and BOQ activity code per project where business rules allow.
- [ ] Remove `activityCode` from frontend create/edit inputs or render it read-only.
- [ ] Ensure backend rejects or ignores client-provided activity codes consistently.
- [ ] Add scheduled and unscheduled value calculations from approved allocations.
- [ ] Add earned and certified value outputs tied to approved progress and IPC certification.

## Suggested Technical Approach

Audit existing duplicate data before adding constraints. Update frontend zod schemas and grid columns to treat activity codes as read-only. Refactor BOQ financial summaries after FB-001 so value states come from approved allocations.

## Acceptance Criteria

- [ ] Duplicate BOQ item/activity codes are rejected by the database/service.
- [ ] Users cannot edit generated activity codes in BOQ UI.
- [ ] BOQ screens show scheduled and unscheduled value.
- [ ] Earned/certified values reconcile to approved progress and IPC records.
- [ ] BOQ upload/import regression tests still pass.

## Testing Requirements

Add Prisma/service tests for duplicates, frontend tests for read-only code fields, and import/upload regression tests.

## Risks

Unique constraints can fail if existing data contains duplicates. Frontend/backend schema mismatch can break BOQ entry.

## Dependencies

Financial value-state calculations depend on FB-001. Audit support benefits from FB-010.

## Estimated Effort
L

## Notes

Backend-generated codes are already partially implemented; the remaining work is enforcement and UI consistency.
