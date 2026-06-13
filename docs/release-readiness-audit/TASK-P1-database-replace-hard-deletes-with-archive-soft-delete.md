# TASK: Replace Hard Deletes With Archive / Soft-Delete

## Task ID
TASK-P1-DB-001

## Priority
P1

## Severity
High

## Area
Database

## Related Feature
PRJ-02, AUD-01, AUD-02

## Related Risk
RISK-DB-001

## Problem Summary
Several services physically delete records that should be retained for audit, claims, and project history.

## Evidence
- `backend/src/services/project.service.js:355` uses `prisma.project.delete`.
- `backend/src/services/rfi.service.js:719` delete path.
- `backend/src/services/submittal.service.js:742` delete path.
- `backend/src/services/change-order.service.js:1393` delete path.
- `backend/src/services/risk.service.js:1082` delete path.
- `backend/src/services/safety.service.js:755` delete path.

## Why This Blocks or Affects Launch
Construction systems must preserve contractual history. Deleting RFIs, submittals, changes, safety records, or projects can destroy evidence.

## Business Impact
- PMs lose project history.
- Contractors and owners lose claim evidence.
- Consultants lose review records.
- Finance teams lose audit trail.
- Document controllers cannot maintain traceability.

## Technical Impact
Reports, dashboards, and audit logs may become inconsistent after deletes.

## Required Changes
- [ ] Define archive/delete policy by entity.
- [ ] Add archived/deleted metadata fields where needed.
- [ ] Replace hard delete endpoints with archive actions.
- [ ] Preserve audit events.
- [ ] Add admin-only permanent purge only if legally approved.

## Suggested Implementation Approach
- Frontend changes: rename delete actions to archive/close where appropriate.
- Backend changes: update services to set status and deleted metadata.
- Database changes: add `archivedAt`, `archivedBy`, `deletedAt`, or status fields.
- API changes: update endpoints and response semantics.
- Permission changes: restrict archive/purge roles.
- Test changes: verify archived records hidden from active lists but retained.
- Documentation changes: data retention policy.

## Acceptance Criteria
- [ ] Contractual records are not hard-deleted through normal UI/API.
- [ ] Archive actions are audited.
- [ ] Reports can include/exclude archived records consistently.
- [ ] Tests prove history remains accessible.

## Testing Requirements
- Unit tests for archive behavior.
- Integration tests for list/detail/history.
- E2E archive/restore if supported.
- Permission tests for archive/purge.
- Manual QA checks.
- Regression checks for dashboards/reports.

## Dependencies
Legal/product retention policy.

## Risks
Existing tests may assume delete behavior and require updates.

## Estimated Effort
L

## Recommended Owner
Database Engineer, Backend Developer

