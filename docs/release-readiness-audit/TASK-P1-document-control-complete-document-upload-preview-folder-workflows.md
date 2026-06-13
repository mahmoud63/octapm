# TASK: Complete Document Upload / Preview / Folder Workflows

## Task ID
TASK-P1-DOC-001

## Priority
P1

## Severity
High

## Area
Construction Workflow

## Related Feature
DOC-02, DOC-04, DOC-07, DOC-08

## Related Risk
RISK-DOC-001

## Problem Summary
Document control exists but is not mature enough for real drawing/document workflows.

## Evidence
- `backend/prisma/schema.prisma:350-388` ProjectDocument model.
- `backend/prisma/schema.prisma:2310-2340` DocumentRevision model.
- `backend/src/routes/doc-control.js:29-166` doc-control routes.
- `frontend/src/features/doc-control/components/doc-control-dashboard.tsx:455-470` asks for record IDs/project document IDs rather than a normal document-controller workflow.

## Why This Blocks or Affects Launch
Construction document control requires intuitive upload, metadata, revisions, superseding, approvals, previews, and access control.

## Business Impact
- Document controllers cannot manage drawings confidently.
- Site teams may use wrong revisions.
- Consultants may not review documents properly.
- Owners/contractors risk contractual disputes.

## Technical Impact
Backend models exist, but UX and access flows are incomplete.

## Required Changes
- [x] Add folder/category workflows.
- [x] Add normal upload and metadata forms.
- [x] Add document preview.
- [x] Complete revision and superseded drawing flows.
- [x] Add approval/review workflow.
- [x] Add permission and audit tests.

## Suggested Implementation Approach
- Frontend changes: document library, folder tree, upload wizard, preview panel.
- Backend changes: complete doc-control service actions.
- Database changes: verify revision/status metadata.
- API changes: document upload/revision/approval endpoints.
- Permission changes: document-specific role checks.
- Test changes: file access and revision tests.
- Documentation changes: document-controller guide.

## Acceptance Criteria
- [x] Users can upload, preview, revise, supersede, approve, and search documents.
- [x] Site users see current revision only unless allowed.
- [x] All actions are audited.
- [x] Unauthorized file access is denied.

## Testing Requirements
- Unit tests for doc-control service.
- Integration tests for file/revision APIs.
- E2E document lifecycle.
- Permission tests.
- Manual QA with drawing revisions.
- Regression checks for project documents.

## Dependencies
TASK-P0-SEC-001.

## Risks
File preview support may depend on storage and document conversion strategy.

## Estimated Effort
L

## Recommended Owner
Full-stack Developer, UX/UI Designer
