# TASK: Replace Mock Task Management With Real Workflow

## Task ID
TASK-P1-PROD-001

## Priority
P1

## Severity
High

## Area
Product

## Related Feature
TSK-01, TSK-02, TSK-03, DBD-02

## Related Risk
RISK-PROD-001

## Problem Summary
Task management is visible in the frontend but backed by faker/static data and local submission dialogs.

## Evidence
- `frontend/src/features/tasks/data/tasks.ts:1` imports faker.
- `frontend/src/features/tasks/data/tasks.ts:4` seeds faker.
- `frontend/src/features/tasks/index.tsx:6` imports static tasks.
- Task dialogs use local submission patterns such as `frontend/src/features/tasks/components/tasks-mutate-drawer.tsx:63`.
- No task API/model was found during inspection.

## Why This Blocks or Affects Launch
Tasks are central to project execution, assignments, overdue tracking, and dashboard truthfulness. Mock task data cannot be shown to real customers.

## Business Impact
- Project managers cannot assign or track real actions.
- Site engineers cannot receive field tasks.
- Consultants/subcontractors cannot be assigned accountable actions.
- Dashboards may show misleading task metrics.

## Technical Impact
Frontend route exists without backend persistence, authorization, audit, or notifications.

## Required Changes
- [ ] Add Task database model.
- [ ] Add task API routes/services.
- [ ] Add frontend API integration.
- [ ] Support comments, attachments, assignee, due date, priority, status.
- [ ] Add overdue and notification integration.
- [ ] Add permissions and tests.

## Suggested Implementation Approach
- Frontend changes: replace faker data with API query/mutations.
- Backend changes: add task service/routes/validators.
- Database changes: create task, task comment, task attachment/history tables.
- API changes: document task endpoints in OpenAPI.
- Permission changes: enforce project and assignee visibility.
- Test changes: add unit/integration/E2E task tests.
- Documentation changes: add task user guide.

## Acceptance Criteria
- [ ] User can create, edit, assign, close, and comment on real tasks.
- [ ] Tasks persist and reload.
- [ ] Unauthorized users cannot access tasks.
- [ ] Dashboard task counts use persisted data.

## Testing Requirements
- Unit tests for task service.
- Integration tests for routes.
- E2E task workflow.
- Permission tests.
- Manual QA checks.
- Regression checks for dashboards.

## Dependencies
TASK-P1-BE-001 for notifications.

## Risks
Dashboard assumptions may need refactoring once real tasks exist.

## Estimated Effort
L

## Recommended Owner
Full-stack Developer

