# Production Notifications QA

## Behavior Matrix

| Trigger                                     | Recipients                                                                                                     | In-app                    | Email                                   | Audit / retry                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| Assignment on workflow create               | Resolved `owner`, `reviewer`, `approver`, assignee-style user fields when they match a user id, email, or name | `assignment` notification | Controlled by `assignment.emailEnabled` | Notification row plus email delivery attempt               |
| Workflow submitted for approval             | Project Managers via org role or project assignment role                                                       | `approval` notification   | Controlled by `approval.emailEnabled`   | Workflow event id stored in notification metadata          |
| Workflow approved/rejected/certified/closed | Resolved record participants, excluding the actor                                                              | `approval` notification   | Controlled by `approval.emailEnabled`   | Delivery attempts retain failure reason and retry schedule |
| Due soon scan                               | PMs plus resolved record participants                                                                          | `due` notification        | Controlled by `due.emailEnabled`        | Dedupe key prevents duplicate notifications per record/day |
| Overdue scan                                | PMs plus resolved record participants                                                                          | `overdue` notification    | Controlled by `overdue.emailEnabled`    | Dedupe key prevents duplicate notifications per record/day |
| Task events                                 | Backend task module can call `emitTaskNotification` with assignee user ids                                     | `task` notification       | Controlled by `task.emailEnabled`       | Uses the same delivery attempt table                       |

## Manual QA

1. Configure `EMAIL_WEBHOOK_URL` and optional `EMAIL_WEBHOOK_TOKEN` in the backend environment.
2. Sign in as a PM and a site engineer in the same project.
3. Create or submit an RFI or submittal as the site engineer.
4. Confirm the PM sees a new notification from `GET /api/v1/notifications` and receives one email delivery attempt.
5. Toggle approval email off in Settings > Notifications and repeat; confirm in-app notification persists and no new email attempt is queued.
6. Create an RFI/submittal/NCR/safety/risk record with a due date within three days or in the past, then run `POST /api/v1/notifications/scan-due` as PM.
7. Confirm due and overdue notifications are persisted once per record/day and are hidden from unrelated users.
8. Force the email provider to fail, run `POST /api/v1/notifications/deliveries/retry`, and confirm failed attempts record `errorCode`, `errorMessage`, and a queued retry.

## Regression Scope

- RFI, submittal, change order, IPC, NCR, safety, risk, schedule revision, BOQ allocation, and cost-loading workflow events must still complete if notification fanout fails.
- Non-PM users must receive only their own notifications.
- PM/planning roles only may run due scans.
- Production email remains fail-closed when no provider is configured.
