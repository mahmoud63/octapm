# TASK: Implement Production Notifications

## Task ID
TASK-P1-BE-001

## Priority
P1

## Severity
High

## Area
Backend

## Related Feature
NOT-01, NOT-02, NOT-03, RFI-05, SUB-04

## Related Risk
RISK-NOT-001

## Problem Summary
Notification and email workflows are missing or stubbed. Construction workflows depend on due-date, assignment, approval, and overdue alerts.

## Evidence
- `backend/src/services/email.service.js:1` identifies a stub email service.
- `frontend/src/features/settings/notifications/notifications-form.tsx:53` uses local submission.
- No durable Notification model was found in the Prisma schema.

## Why This Blocks or Affects Launch
RFIs, submittals, tasks, approvals, and overdue contractual responses require notifications. Without them, users miss time-sensitive actions.

## Business Impact
- PMs miss overdue items.
- Consultants miss review requests.
- Owners miss approval events.
- Site engineers miss assigned actions.
- Finance users miss payment approvals.

## Technical Impact
No durable notification state, delivery audit, retry, or user preferences.

## Required Changes
- [ ] Add Notification model and migrations.
- [ ] Implement in-app notification APIs.
- [ ] Implement provider-backed email service.
- [ ] Add user notification preferences.
- [ ] Emit events from RFI, submittal, task, change order, IPC, QA, safety.
- [ ] Add delivery logging and retry behavior.

## Suggested Implementation Approach
- Frontend changes: notification center and preferences API integration.
- Backend changes: notification service, event emitters, email provider.
- Database changes: notifications, preferences, delivery attempts.
- API changes: list/read/update notification endpoints.
- Permission changes: users only see their notifications.
- Test changes: delivery, preference, and permission tests.
- Documentation changes: notification behavior matrix.

## Acceptance Criteria
- [ ] Assignment, due, overdue, and approval notifications work.
- [ ] Email delivery is configurable per environment.
- [ ] Notifications are persisted and auditable.
- [ ] Users can manage preferences.

## Testing Requirements
- Unit tests for notification service.
- Integration tests for workflow event creation.
- E2E notification checks.
- Permission tests.
- Manual email QA.
- Regression checks for RFI/submittal/task workflows.

## Dependencies
Email provider selection; TASK-P1-PROD-001 for task events.

## Risks
Notification noise can reduce adoption if preferences are not well designed.

## Estimated Effort
L

## Recommended Owner
Backend Developer, Frontend Developer

