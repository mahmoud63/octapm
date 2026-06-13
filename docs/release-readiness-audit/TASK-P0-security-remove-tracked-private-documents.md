# TASK: Remove Tracked Private Uploaded Documents And Harden Storage

## Task ID
TASK-P0-SEC-001

## Priority
P0

## Severity
Critical

## Area
Security

## Related Feature
DOC-01, DOC-05, AUD-03

## Related Risk
RISK-SEC-001

## Problem Summary
Private uploaded project documents are tracked in the repository under backend storage paths. This is a launch blocker because customer/project documents must never be committed to source control.

## Evidence
- `git ls-files backend/storage` listed tracked files under `backend/storage/private-documents/orgs/.../projects/.../boq/*.xlsx`.
- Root `.gitignore` was inspected and did not include a rule excluding `backend/storage/private-documents`.
- File/document workflows appear in `backend/src/routes/doc-control.js:29-166` and `backend/prisma/schema.prisma:350`.

## Why This Blocks or Affects Launch
Construction project documents can contain pricing, quantities, drawings, claims, identities, and contractual evidence. Publishing with private files in Git creates unacceptable data leakage and governance risk.

## Business Impact
- Project managers: loss of trust in project data handling.
- Contractors: confidential BOQ/commercial files may leak.
- Consultants: document-control credibility is damaged.
- Owners: sensitive project data may be exposed.
- Site engineers: photo/document evidence may be mishandled.
- Document controllers: cannot trust revision/file governance.
- Finance/commercial teams: commercial documents may leak.
- Subcontractors: confidential bid/procurement data may leak.

## Technical Impact
The repository can contain non-source operational data, backups, or customer uploads. CI/CD and clones may distribute private files.

## Required Changes
- [ ] Remove tracked private upload files from the current tree.
- [ ] Decide whether Git history purging is required.
- [ ] Add ignore rules for private runtime storage.
- [ ] Add CI guard to fail if files under private storage are staged.
- [ ] Verify file download/upload authorization tests.
- [ ] Document storage policy.

## Suggested Implementation Approach
- Frontend changes: show safe errors for forbidden file access.
- Backend changes: enforce project/org authorization on all file routes.
- Database changes: ensure file metadata is project/org scoped.
- API changes: standardize forbidden/not-found responses.
- Permission changes: add negative access tests for files.
- Test changes: add repository hygiene and file access tests.
- Documentation changes: add storage and data-handling runbook.

## Acceptance Criteria
- [ ] No files under private runtime upload paths are tracked.
- [ ] `.gitignore` or equivalent excludes runtime storage.
- [ ] CI blocks tracked private uploads.
- [ ] Cross-project and cross-org file access tests pass.
- [ ] Security owner signs off.

## Testing Requirements
- Unit tests for file path authorization.
- Integration tests for document upload/download denial.
- E2E tests for authorized file access.
- Permission tests for cross-project denial.
- Manual QA checks for upload/download.
- Regression checks for document-control workflows.

## Dependencies
Repository governance decision on history cleanup.

## Risks
Removing files without planning could break tests if fixtures incorrectly depend on private storage.

## Estimated Effort
M

## Recommended Owner
Security Engineer, Backend Developer, DevOps Engineer

