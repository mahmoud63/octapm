# Progress Assignment Authorization QA

Use this checklist before releasing assignment-scoped progress submissions. The goal is to confirm field users can only submit progress for activities they are assigned to, while PM and Planning Engineer project roles retain override access.

## Test Data

- Project with at least two non-milestone activities:
  - Activity A assigned to the field user.
  - Activity B not assigned to the field user.
- Users:
  - Site Engineer or other role with `progress.submission.submit`.
  - PM.
  - Planning Engineer.
  - QS or reviewer role with progress approval permission.

## API Checks

- As the assigned field user, `POST /api/v1/projects/{projectId}/activities/{activityAId}/progress` succeeds and returns a progress submission.
- As the same field user, `POST /api/v1/projects/{projectId}/activities/{activityBId}/progress` returns `403` with `ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED` and `details.activityIds` containing Activity B.
- As the field user, `POST /api/v1/projects/{projectId}/activities/bulk-progress` succeeds when every activity is assigned.
- As the field user, a bulk request containing Activity A and Activity B returns `403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED` and creates no partial submissions.
- As PM and Planning Engineer, single and bulk progress submissions succeed for assigned and unassigned activities.
- Daily report creation/submission that creates linked progress follows the same assignment rule.
- Approved progress remains the only source for official EV updates.

## UI Checks

- The schedule progress tab shows all non-milestone activities for context.
- For a field user, assigned activity rows show enabled progress inputs and submit action.
- For a field user, unassigned activity rows show disabled progress submission inputs and cannot be submitted.
- Bulk progress selection only lists activities the current user can submit for.
- PM and Planning Engineer users can submit from the progress tab and bulk panel for all non-milestone activities.

## Audit Checks

- Every successful draft/submitted progress submission writes an audit event for `progress_submission` with action `created`, actor ID, status, activity ID, method, source, percent complete, and attachments summary when evidence exists.
- Blocked `ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED` attempts do not create progress submission rows, activity progress rows, or audit events.
