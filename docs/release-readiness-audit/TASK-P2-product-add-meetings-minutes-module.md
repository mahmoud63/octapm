# TASK: Add Meetings And Minutes Module

## Task ID
TASK-P2-PROD-001

## Priority
P2

## Severity
Medium

## Area
Product

## Related Feature
MTG-01, MTG-02

## Related Risk
RISK-MTG-001

## Problem Summary
Meeting minutes, attendees, agenda, decisions, action items, and distribution workflows are missing.

## Evidence
- No meeting/minutes route was found.
- No meeting/minutes Prisma model was found.
- No meeting UI feature was found.

## Why This Blocks or Affects Launch
Meetings are a standard construction communication and contractual record workflow. Missing this limits industry fit.

## Business Impact
- PMs lack formal decision records.
- Consultants/owners cannot distribute decisions.
- Subcontractors miss action items.
- Document controllers lack meeting record traceability.

## Technical Impact
No data model, API, notifications, or audit trail exists for meeting decisions/actions.

## Required Changes
- [ ] Add meeting model.
- [ ] Add agenda, attendees, decisions, action items.
- [ ] Add distribution and comments.
- [ ] Link action items to tasks.
- [ ] Add notifications and audit.

## Suggested Implementation Approach
- Frontend changes: meetings list/detail/minutes editor.
- Backend changes: meeting routes/services.
- Database changes: meetings, attendees, decisions, action items.
- API changes: OpenAPI docs.
- Permission changes: project-party access.
- Test changes: meeting lifecycle tests.
- Documentation changes: meeting minutes guide.

## Acceptance Criteria
- [ ] Users can create and distribute meeting minutes.
- [ ] Action items have owners/due dates.
- [ ] Distribution history is audited.

## Testing Requirements
- Unit tests.
- Integration tests.
- E2E tests.
- Permission tests.
- Manual QA checks.
- Regression checks.

## Dependencies
TASK-P1-PROD-001, TASK-P1-BE-001.

## Risks
Scope can grow quickly; keep initial module focused.

## Estimated Effort
L

## Recommended Owner
Product Manager, Full-stack Developer

