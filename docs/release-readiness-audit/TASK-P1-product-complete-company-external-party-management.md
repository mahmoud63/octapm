# TASK: Complete Company And External-Party Management

## Task ID
TASK-P1-PROD-002

## Priority
P1

## Severity
High

## Area
Product

## Related Feature
ORG-03, USR-09, PRJ-03

## Related Risk
RISK-PARTY-001

## Problem Summary
The product does not adequately model client/owner/contractor/consultant/subcontractor relationships or external-party access.

## Evidence
- `backend/prisma/schema.prisma:58-60` stores party names as project text fields.
- `backend/prisma/schema.prisma:158` ProjectAssignment links users/projects, not external party companies.
- `frontend/src/features/projects/components/project-form-fields.tsx:256-284` collects party names as text.

## Why This Blocks or Affects Launch
Construction projects involve multiple companies with contractual roles and restricted access. Text fields cannot enforce permissions, audit responsibility, or workflow routing.

## Business Impact
- Owners/consultants/subcontractors cannot be safely onboarded.
- RFIs/submittals cannot route to real responsible companies.
- Project teams cannot reflect contractual relationships.
- Finance/commercial workflows lack party context.

## Technical Impact
Permissions, reporting, notifications, and audit trails cannot reliably tie actions to company roles.

## Required Changes
- [ ] Model project parties as companies.
- [ ] Add party role types.
- [ ] Link external users to party companies.
- [ ] Add scoped permissions per project-party role.
- [ ] Update project forms and team management.
- [ ] Update RFI/submittal/task routing.

## Suggested Implementation Approach
- Frontend changes: replace text party fields with managed company selector and invite flow.
- Backend changes: party membership services and validators.
- Database changes: ProjectParty/CompanyRelationship models.
- API changes: endpoints for party management.
- Permission changes: project-party RBAC.
- Test changes: cross-party access denial and workflow routing.
- Documentation changes: admin guide for external parties.

## Acceptance Criteria
- [ ] Owner, consultant, contractor, subcontractor companies can be assigned to a project.
- [ ] External users have scoped access.
- [ ] Workflows can assign/respond by party.
- [ ] Unauthorized party access is denied.

## Testing Requirements
- Unit tests for permission rules.
- Integration tests for party APIs.
- E2E external user workflow.
- Permission tests for cross-party denial.
- Manual QA with consultant/subcontractor personas.
- Regression checks for project team pages.

## Dependencies
TASK-P1-AUTH-001, TASK-P1-BE-001.

## Risks
Schema migration affects project and assignment assumptions.

## Estimated Effort
XL

## Recommended Owner
Product Manager, Full-stack Developer, Database Engineer

