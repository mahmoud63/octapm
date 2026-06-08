# TASK FB-014: Mature Quality and Document Workflows

## Priority
P2

## Related Feedback

- Feedback ID: FB-014
- Original feedback summary: Strengthen quality and document workflows with responsibilities, attachments, due-date alerts, status history, multi-activity links, and document revisions.

## Current Project Status

Quality and document-control models and frontend screens exist. Some models have optional activity links and status/revision fields.

## Evidence

- `backend/prisma/schema.prisma`, lines 654-759: NCR, ITP, defect, safety incident, and material test models exist.
- `backend/prisma/schema.prisma`, lines 766-884: RFI, submittal, drawing, transmittal, and correspondence models exist.
- `frontend/src/features/quality/components/quality-dashboard.tsx`: quality UI exists.
- `frontend/src/features/doc-control/components/doc-control-dashboard.tsx`: document-control UI exists.

## Gap Analysis

The modules do not yet provide mature assignment, due-date alerts, attachment handling, status history, multi-activity links, or controlled document revision workflows.

## Required Changes

- [ ] Add owner/reviewer/approver and due-date fields where missing.
- [ ] Add attachment metadata and storage integration.
- [ ] Add status-history/comment records for NCR, ITP, RFI, submittal, drawing, and correspondence workflows.
- [ ] Support multi-activity links through join tables.
- [ ] Improve frontend detail views for assignments, evidence, revisions, and history.

## Suggested Technical Approach

Add shared attachment and status-history support first, then apply it across quality/document models. Use join tables for multi-activity links while preserving current optional single activity fields during migration.

## Acceptance Criteria

- [ ] Quality and document records show owner, due date, status, attachments, and history.
- [ ] Due-date alerts appear in module/dashboard views.
- [ ] Records can link to multiple affected activities.
- [ ] Document revisions are visible and previous revisions remain accessible.
- [ ] Tests cover status transitions, attachments, and multi-activity links.

## Testing Requirements

Add backend workflow/attachment tests, frontend detail/history tests, and manual QA with NCR, RFI, and submittal scenarios.

## Risks

File storage and permissions must be secure. Multi-activity migration can complicate existing screens.

## Dependencies

Depends on FB-010 audit/history and shares attachment needs with FB-008/FB-011.

## Estimated Effort
L

## Notes

The current module coverage is good; this is workflow maturity work.
