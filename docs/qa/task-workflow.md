# Task Workflow QA Guide

## Scope

Task records are persisted project workflow items linked to a project and optionally an activity. They support assignee, due date, priority, status, comments, attachment references, audit history, and due/overdue notifications.

## Primary User Flow

1. Open **Tasks** from the authenticated workspace navigation.
2. Create a task with project, title, label, priority, status, due date, and optional assignee.
3. Reload the page and confirm the task remains visible.
4. Edit the task to change status, priority, assignee, due date, or description.
5. Add a comment during edit or through the task comment API.
6. Close the task from row actions or the close API and confirm status becomes `done`.
7. Archive a task and confirm it leaves the active list while audit history is retained.

## Permission Checks

- PM and Planning Engineer can view and manage tasks across their visible projects.
- Other internal roles can read task lists, but service visibility limits non-PM users to tasks assigned to them or created by them.
- Site Engineer can create, update, comment, and close execution tasks.
- External project parties can read/comment through project-scoped access when their party permission includes task read/comment.
- Users without project assignment or active project-party access must not access project task routes.

## Notification Checks

- Creating or reassigning a task with an assignee creates a durable task notification.
- Daily due scans include `Task.dueDate`.
- Open tasks with past due dates are included in overdue dashboard queues and due notification scans.

## Regression Checks

- Verify `/api/v1/tasks` lists persisted tasks across visible projects.
- Verify `/api/v1/projects/:projectId/tasks` enforces project membership.
- Verify comments, attachments, and task history reload with the task.
- Verify workspace dashboard `summary.openTasks`, `summary.overdueTasks`, and the overdue task queue are based on database `Task` rows.
- Verify the frontend task feature has no faker/static task source imports.
