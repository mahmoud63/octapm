# Record accountability references (OCTA-DATA-REFS-004)

Free-text owner / reviewer / approver / assignee fields are replaced by user
and company references on every workflow record. Text columns stay readable for
one release and are mirrored from the referenced user's name.

## Columns

Added to `Rfi`, `Submittal`, `NcrRecord`, `ItpRecord`, `DefectRecord`,
`SafetyIncident`, `MaterialTest`, `DrawingRecord`, `Transmittal`,
`Correspondence`, `Risk` (FK → `User` / `Company`, `ON DELETE SET NULL`, indexed):

| Column | Meaning |
| --- | --- |
| `ownerUserId` | Person accountable for the record. |
| `reviewerUserId` | Person who reviews / answers. |
| `approverUserId` | Person who approves / closes. |
| `assigneeUserId` | Person doing the work (`assignee`, `responsible`, `inspector` text). |
| `assigneeCompanyId` | Company doing the work (routed party company or matched name). |
| `ballInCourtUserId` | Whoever must act next; derived on every create/update unless set explicitly. |

Ball in court (`deriveBallInCourt` in `workflow-support.service.js`):
closed-type statuses → nobody; `answered` / `resubmit` / `rejected` /
`in_progress` / `fail` → assignee, else owner; everything else → reviewer,
else approver, else assignee, else owner.

## Backfill

`20260905170000_add_record_user_references/migration.sql`:

1. Adds columns, indexes and foreign keys in a loop over the eleven tables.
2. User references: a text value resolves when **exactly one** active user in
   the record's organisation matches by email or name (case-insensitive).
3. Company references: RFI/submittal routed parties, then exact company-name
   matches on the assignee/responsible/owner text.
4. Ball in court is set for records that are still open.

Anything the migration could not match is listed by
`GET /projects/:projectId/assignments/unresolved` (company admin or PM) and can
be mapped with `POST /projects/:projectId/assignments/resolve`
`{ recordType, recordId, field, userId | companyId }`. Every mapping writes an
`AuthAuditEvent` (`record_assignment` / `resolved`).

## API changes

- Create/update endpoints for the eleven record types accept `ownerUserId`,
  `reviewerUserId`, `approverUserId`, `assigneeUserId`, `assigneeCompanyId`,
  `ballInCourtUserId` (UUIDs, validated against the organisation → 400
  `ASSIGNMENT_USER_NOT_FOUND` / `ASSIGNMENT_COMPANY_NOT_FOUND`). Sending an id
  without the matching text fills the text with the user's name.
- Responses carry the ids plus `ownerUser`, `reviewerUser`, `approverUser`,
  `assigneeUser`, `ballInCourtUser` (`{ id, name, email }`) and
  `assigneeCompany` (`{ id, name }`).
- NCR / safety closeout submissions accept `assigneeUserId` and
  `assigneeCompanyId` alongside `responsible`.
- `GET /projects/:projectId/assignments/mine` and the workspace dashboard's
  `myOpenItems` list open records where the caller holds any reference,
  sorted ball-in-court → overdue → due date.
- Notification recipients come from id columns only
  (`resolveNotificationRecipients` no longer matches names or emails).

## Frontend

- `UserPicker` / `CompanyPicker` (`src/components/user-picker.tsx`) list the
  project team and parties (`GET /projects/:id/team`), so site engineers can
  pick people without user-management rights.
- Risk owner and NCR/safety closeout "responsible" use the picker; free text
  remains available as a fallback for parties that are not users.
- Workflow record cards show referenced names and highlight who holds the ball.
- The workspace dashboard opens with **My open items**.

## Manual QA

1. Run the migration on a copy of production; `GET …/assignments/unresolved`
   for each project lists rows the matcher skipped (duplicate names, typos).
2. Map one row via `POST …/assignments/resolve`; the record's text field now
   shows the user's name and `ballInCourtUserId` is set when the record is open.
3. Create an RFI with `reviewerUserId`; the reviewer receives an assignment
   notification, and a user with the same display name but a different id does
   not.
4. Log in as the reviewer: the dashboard shows the RFI under My open items
   with "Your move"; answer it and it moves to the owner.
5. Change a risk owner through the picker; the risk list shows the new name.

## Known limits

- Search indexes still use the text columns.
- Tasks and meetings already had user references and were left unchanged.
- Text columns are still writable for one release; the next release makes
  them read-only and derived.
