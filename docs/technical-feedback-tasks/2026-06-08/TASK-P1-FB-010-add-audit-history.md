# TASK FB-010: Add Audit and Status History

## Priority
P1

## Related Feedback

- Feedback ID: FB-010
- Original feedback summary: Add audit trail, created/updated/approved metadata, revisions, reasons, attachments, and history.

## Current Project Status

Some models have status fields, dates, or single actor references, but no generalized audit/history model was found.

## Evidence

- `backend/prisma/schema.prisma`, line 252: `ActivityProgress` records `updatedBy`.
- `backend/prisma/schema.prisma`, lines 340-342: `ChangeOrder` has submitted/approved dates and rejection reason.
- `backend/prisma/schema.prisma`, lines 388-389: IPC certificates have submitted-by style metadata.
- `backend/prisma/schema.prisma`, lines 801-806: submittals track revision/status dates.
- Search found no generalized audit log or status-history table.

## Gap Analysis

Official baseline, progress, IPC, EOT, and commercial workflows need defensible history showing who changed or approved what, when, and why.

## Required Changes

- [ ] Add shared `AuditEvent` or per-module status-history models.
- [ ] Capture actor, timestamp, entity type/id, old/new summary, reason, and status transition.
- [ ] Add created/updated/approved fields to critical models where direct fields are needed.
- [ ] Emit audit events from services, not route handlers.
- [ ] Add frontend history panels for critical records.

## Suggested Technical Approach

Implement a shared audit service and call it from business services during lifecycle transitions. Keep payloads compact and structured. Do not log secrets or large file contents.

## Acceptance Criteria

- [ ] Critical records show chronological history.
- [ ] Audit events are tenant-scoped and access-controlled.
- [ ] Approval events include actor, timestamp, and reason/comment where required.
- [ ] Delete/supersede operations preserve audit events.
- [ ] Tests verify audit emission for schedule baseline, progress approval, IPC certification, and change-order approval.

## Testing Requirements

Add audit service unit tests, integration tests for workflow transitions, authorization tests for audit read APIs, and manual QA for history panels.

## Risks

Audit data can grow quickly and may expose sensitive information if not scoped carefully.

## Dependencies

Supports FB-004, FB-006, FB-008, FB-009, FB-012, and FB-020.

## Estimated Effort
L

## Notes

Route handlers should remain thin; audit should live in the service layer.
