# RFI upgrade: manager, assignees, ball in court, responses, references (OCTA-PM-RFI-016)

The RFI keeps its base workflow (open → answered → closed with approve /
reject / reopen, party assignments, archive) and gains the people, the
thread and the references a design question needs to be formally resolved.

## Model

| Table / column | Purpose |
| --- | --- |
| `Rfi.managerUserId` | Reviews the answer and closes; holds the ball once answered. |
| `Rfi.createdBy` | Who raised it (drafts are private to creator + manager). |
| `Rfi.specSection`, `Rfi.locationId` | References next to the existing activity, discipline and drawing pins. |
| `Rfi.costImpact` / `costImpactAmount`, `Rfi.scheduleImpactFlag` / `scheduleImpact` (days) | Impact flags and values. |
| `Rfi.officialResponseId`, `Rfi.revision` | The current official answer and the revision counter (bumped on every reopen). |
| `Rfi.changeOrderId` | Set when converted to a change event. |
| `RfiAssignee` | `role = assignee` (answer the question, ordered) or `distribution` (kept informed). |
| `RfiResponse` | The thread: `body`, `isOfficial`, `revision`, author. Exactly one official response per revision; it mirrors into `Rfi.response`. |

The migration adds the columns, creates the tables, turns the legacy
`assigneeUserId` into the first assignee row and an existing `response` into
the official response of revision 0.

## Rules

* **Status**: `draft` (new) → `open` → `answered` → `closed`; `archived`
  via delete. Drafts are listed and readable only by their creator and
  manager (`withDraftVisibility`). Submitting a draft opens it and notifies
  assignees, manager and distribution.
* **Ball in court** (`rfi-workflow.ballInCourtFor`): draft → creator; open →
  first assignee (else legacy assignee, else manager); answered → manager
  (else approver, else creator); closed → nobody. Recomputed after every
  create / update / transition.
* **People** (`PUT …/people` or the same fields on create / PATCH): manager,
  `assigneeUserIds[]`, `distributionUserIds[]` (≤ 20 each, must be org
  users). New assignees and a new manager get an assignment notification;
  new distribution members a workflow notification.
* **Responses**: `POST …/responses { body, isOfficial }`. Non-official
  responses grow the thread and notify the manager, creator and assignees.
  `isOfficial: true` (needs `rfi.answer`) answers the RFI through the base
  workflow and records the row as official; `POST …/responses/{id}/official`
  promotes an existing thread reply. The legacy `POST …/answer` also lands
  in the thread as the official response. Authors (or PMs) can edit /
  remove their non-official responses; the official one cannot be removed.
* **Reopen** bumps `revision`, clears `officialResponseId` (the old answer
  stays in the thread tagged with its revision) and re-notifies assignees.
* **Schedule impact**: when an RFI closes with `scheduleImpactFlag` and
  `scheduleImpact > 0` on an activity, a `WorkflowActivityLink`
  (`relationType = schedule_impact`, `scheduleImpactDays`) is upserted for
  the activity.
* **Convert to change event** (`POST …/convert-to-change`, needs
  `change_order.create`): creates a draft change order from the subject,
  question, official response, activity, cost and schedule impact and links
  it back (409 `RFI_ALREADY_CONVERTED` on repeat).
* **Overdue**: due-date reminders (`notification.service` DUE_RECORDS.rfi)
  now reach the manager, ball in court, assignee and creator; list filter
  `overdue=true` uses `responseRequiredBy` (else `dueDate`).
* **PDF** (`GET …/export.pdf`, needs `rfi.export`): people, references,
  impacts, question, official response (author + revision), discussion
  thread and attachments.

## API additions (tag "Document Control")

`GET /projects/{id}/rfi/{rfiId}` (detail with `assignees`, `distribution`,
`responses`, `officialResponse`, `manager`, `location`, `isOverdue`),
`PUT …/people`, `GET/POST …/responses`, `PATCH/DELETE …/responses/{responseId}`,
`POST …/responses/{responseId}/official`, `POST …/convert-to-change`,
`GET …/export.pdf`. The list accepts `status=draft`, `managerUserId`,
`assigneeUserId`, `ballInCourtUserId` (`me`), `locationId`, `overdue`; create
and PATCH accept the new fields and `status: draft`.

## UI (Doc control › RFI)

* **New RFI** dialog: subject, question, discipline, spec section, priority,
  activity, location, owner party, manager, assignees, distribution, response
  required by, due, cost / schedule impact, *open now* or *save draft*.
* **Saved views** (per browser, per project): built-ins *Waiting on me*,
  *Overdue*, *Awaiting answer*, *Answered, to close* plus *Save current*;
  *Waiting on me* and *Overdue* switches; Draft status filter.
* **Open** on any row → the RFI workspace: status, revision, overdue and
  ball-in-court header; actions (Open RFI / Submit, Accept answer & close,
  Not answered, Close, Reopen (new revision), Convert to change event, Open
  change event, PDF, Edit); inline edit of every field; people editor;
  question; official response; the thread with *Reply*, *Answer officially*
  and *Make official*; pins, attachments, internal notes, history.
* Notification and comment links (`?source=rfi&recordId=`) open the
  workspace directly.

## UAT

1. Create an RFI as a draft with a manager and two assignees; another user
   cannot see it in the list; the creator and manager can. *Open RFI* →
   assignees are notified; ball in court = first assignee.
2. As an assignee, *Reply* (thread grows, manager notified) then *Answer
   officially* → status answered, ball in court = manager, the answer shows
   under *Official response*.
3. As the manager, *Not answered* with a reason → open again; then *Make
   official* on a thread reply → answered.
4. Set a schedule impact of 3 days on the RFI's activity; *Accept answer &
   close* → the activity gains a `schedule_impact` link with 3 days.
5. *Reopen (new revision)* → rev 1, official response cleared, previous
   answer remains in the thread tagged rev 0.
6. *Convert to change event* → a draft change order VO-xx appears in
   Commercial with the RFI text; the button becomes *Open change event*.
7. Export the PDF: question, official response, thread and people.
8. Overdue: set response required by in the past → the *Overdue* view lists
   it and the manager / ball in court receive the reminder.
