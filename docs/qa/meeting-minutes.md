# Meeting Minutes Workflow

## Scope

TASK-P2-PROD-001 adds project-scoped meeting minutes for construction coordination records. Minutes support attendees, agenda items, decisions, action items, comments, distribution history, notifications, and centralized audit history.

## Data Rules

- Meetings and minutes sub-records are scoped by `orgId` and `projectId`.
- Meeting headers, attendees, agenda items, decisions, action items, distributions, and comments can carry an `activityId` link for schedule traceability.
- Meeting action items require an owner name or owner user and a due date.
- New meeting action items create linked project Tasks by default. Existing linked task IDs are preserved when provided.
- Distribution creates immutable `MeetingDistribution` rows and an audit event.
- User recipients receive durable in-app/email notification records through the notification service.

## API Coverage

- `GET /api/v1/projects/{projectId}/meetings`
- `POST /api/v1/projects/{projectId}/meetings`
- `GET /api/v1/projects/{projectId}/meetings/{id}`
- `PATCH /api/v1/projects/{projectId}/meetings/{id}`
- `POST /api/v1/projects/{projectId}/meetings/{id}/distribute`
- `POST /api/v1/projects/{projectId}/meetings/{id}/comments`
- `DELETE /api/v1/projects/{projectId}/meetings/{id}`

## Permission Matrix

- Internal read/comment: all project roles.
- Internal create/update: PM, Planning Engineer, Site Engineer.
- Internal distribute/archive: PM, Planning Engineer.
- Owner parties: read and comment.
- Consultant parties: read, create, update, comment, and distribute.
- Contractor parties: read, create, update, and comment.
- Subcontractor parties: read and comment.

## Manual QA

1. Create a meeting from a project with at least one agenda item, attendee, decision, and action item.
2. Confirm the action item has an owner and due date and a linked task number appears after save.
3. Edit the minutes and confirm agenda, decisions, and action items are persisted.
4. Distribute the meeting to attendees and one manual recipient.
5. Confirm distribution history rows show sent recipients and sent time.
6. Confirm the project audit panel can filter or display the meeting `created`, `updated`, and `status_changed` events.
7. Confirm a user recipient sees a notification that deep-links back to the meeting module.
8. Confirm a contractor or subcontractor project-party user can comment but cannot distribute unless allowed by policy.

## Regression Checks

- Prisma schema validates.
- Backend OpenAPI validates.
- Focused meeting service tests pass.
- Module permission matrix tests pass.
- Frontend meetings source assertion passes.
- UAT manifest validation includes the meeting-minutes API flow.
- Frontend TypeScript build passes.
