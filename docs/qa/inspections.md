# Inspections, ITPs, forms and toolbox talks (OCTA-QA-TEMPLATE-014)

One checklist engine behind four kinds of site paperwork. A **template** is
sections of items; an **instance** is a filled-in copy tied to an activity,
a location and a drawing. ITP items flagged as **hold points** block progress
approval on their activity until they pass.

## Model

| Table | Purpose |
| --- | --- |
| `FormTemplate` | `orgId`, `projectId` (null = company library), `sourceTemplateId` (cloned from), `type` (inspection / itp / form / talk), `name`, `description`, `trade`, `version` (bumped whenever the structure is replaced), `status` (draft / active / archived), `isSystem` (migrated ITP templates), `settingsJson` (`requireSignatures`: roles that must sign before completion; `deficiencyTarget`; `instructions`). |
| `FormSection` | Ordered groups of items. |
| `FormItem` | `label`, `description`, `responseType` (pass_fail, yes_no, checkbox, text, number, choice, date, photo, signature), `required`, `photoRequired`, `isHoldPoint`, `inspectionPointType` (hold / witness / review), `optionsJson` (choice list, or `{ min, max, unit }` for numbers), `reference`. |
| `FormInstance` | `number` / `ref` per type (INS-001, ITP-001, FRM-001, TBT-001), `templateVersion` snapshot, `title`, `status` (scheduled → in_progress → complete → closed, plus void), `outcome` (pass / fail), `activityId`, `locationId`, `sheetId`, `assigneeUserId` / `assigneeCompanyId` / `inspectorUserId` / `approverUserId`, derived `ballInCourtUserId`, `scheduledFor`, `dueDate`, `recurrenceJson` (`{ every: day|week|month, interval, until }`), timestamps, `summaryJson` (answered / passed / failed / deficient / hold points open), `clientRequestId` (offline idempotency), `legacyItpId`. |
| `FormItemResponse` | One row per answered item: `value`, `numberValue`, `note`, `isDeficient`, `deficiencyRecordType` / `deficiencyRecordId` (punch item raised from it). Photos attach with `recordType = form_response`. |
| `Signature` | `role` (inspector / approver / subcontractor / witness / attendee), `signerName`, `signerCompany`, `userId`, PNG `documentId`, `signedAt`, `ipAddress`, `userAgent`; `itemId` when it answers a signature item. |

The migration turns every `ItpRecord` into an instance of a system template
per point type ("ITP hold point (migrated)" etc., one pass/fail item; the
hold-point template's item is a hold point). Pending → scheduled; passed /
waived / failed → complete with the matching answer. Attachments, pins,
comments, follows and activity links move to `form_instance`.

## Rules

* **Answers** are validated per type (`FORM_RESPONSE_INVALID`); `fail`, `no`
  and out-of-range numbers are deficient. Answering a scheduled instance
  moves it to in_progress. Clearing an answer removes the row (unless a
  deficiency record is linked).
* **Completion** (`POST …/complete`) refuses with 400 `FORM_INCOMPLETE` and
  `details.problems` until every required item is answered, every
  photo-required item (and photo item) has an attachment, signature items are
  signed, and each role in `requireSignatures` has signed. Outcome is `fail`
  when anything is deficient. Recurring instances schedule the next copy.
* **Close** (approver) → closed; **reopen** (reason) clears the outcome and
  returns to in_progress; **void** (reason) is allowed on anything not closed
  and releases its hold points. Closed / void instances are read-only
  (`FORM_INSTANCE_LOCKED`).
* **Hold points**: `form.service.openHoldPoints({ projectId, activityId })`
  lists hold items on non-void ITP instances of that activity whose answer is
  not pass / N/A. `progress.service.approveProgressSubmission` calls it and
  throws 409 `ITP_HOLD_POINT_OPEN` (with `details.holdPoints`) — so an
  unfinished or failed ITP stops the activity's progress from being approved.
  `GET …/forms/hold-points?activityId=` exposes the same list.
* **Deficiencies** → `POST …/items/{itemId}/deficiency` raises a punch item
  (activity, location, drawing, company, approver carried over; the note
  becomes the description) and links it to the answer. Needs `punch.create`
  as well as `inspection.complete`.
* **Templates**: project templates are edited on the project; company
  templates in Company › Inspection templates (company admins / PMs) and
  copied into a project to tailor. Replacing `sections` bumps the version;
  items that already have answers cannot be removed (`FORM_ITEM_IN_USE`).
  Starter templates: concrete pour ITP (hold points), weekly safety walk,
  toolbox talk.
* **Visibility**: party users (subcontractors) only see instances assigned to
  their company or to them.

## Permissions (`shared/permissions.json` › `inspection`)

| Action / transition | Base roles | Party roles |
| --- | --- | --- |
| read | all | owner, consultant, contractor, subcontractor (scoped) |
| create | pm, planning_eng, site_engineer, qs | consultant, contractor |
| update | pm, planning_eng, site_engineer, qs | contractor |
| delete (scheduled, unanswered) | pm, planning_eng | — |
| submit (`inspection.start` = answer, `inspection.complete`, `inspection.sign`) | pm, planning_eng, site_engineer, qs | consultant, contractor, subcontractor |
| approve (`inspection.close`, `inspection.reopen`) | pm, planning_eng | consultant |
| approve (`inspection.void`) | pm | — |
| `inspection.template_admin` (project templates) | pm, planning_eng, qs | contractor |
| export | pm, planning_eng, qs, site_engineer, cost_controller | all party roles |

## API (OpenAPI tag "Inspections & Forms")

| Method | Path | Notes |
| --- | --- | --- |
| GET / POST | `/projects/{id}/forms/templates` | Project templates + company library (`scope=all`). |
| GET / PATCH / DELETE | `/projects/{id}/forms/templates/{templateId}` | Archive on delete. |
| POST | `/projects/{id}/forms/templates/{templateId}/duplicate` | Copy into the project. |
| GET / POST | `/company/form-templates`, `…/starters`, `…/{id}`, `…/{id}/duplicate` | Company library. |
| GET / POST | `/projects/{id}/forms` | Filters: status, type, templateId, activityId, locationId (subtree), sheetId, assigneeUserId, assigneeCompanyId, ballInCourtUserId (`me`), outcome, overdue, from / to, search. Summary: open, overdue, failed, awaitingClose, holdPointsOpen. |
| GET | `/projects/{id}/forms/hold-points?activityId` | Open hold points. |
| GET / PATCH / DELETE | `/projects/{id}/forms/{instanceId}` | Detail carries sections, answers, photo counts, signatures, open hold points. |
| POST | `…/start`, `…/complete`, `…/close`, `…/reopen`, `…/void` | State machine. |
| PUT | `…/responses` | `{ responses: [{ itemId, value, note }] }` bulk upsert. |
| POST | `…/signatures` | `{ role, image (PNG data URL), signerName, signerCompany, itemId }`. |
| POST | `…/items/{itemId}/deficiency` | Raise a punch item. |
| GET | `…/export.pdf?includePhotos` | Filled-in form PDF (`utils/pdf-writer.js`). |

Instances also take part in comments / mentions / subscriptions
(`form_instance`), attachments (`form_instance`, `form_response`), pins,
due-date reminders and audit history.

## UI

* **Quality › Inspections** (`/projects/{id}/quality/itp`): summary cards
  (open, overdue, awaiting close, failed, hold points open); filters; table
  with progress bars; **Schedule** (template, title, activity, location,
  drawing, company, assignee, inspector, approver, dates, repeat, start now).
  **Templates** tab: project + company templates with New / Edit / Copy to
  project / Archive and a full section-and-item editor (types, required,
  photo required, hold / witness / review points, choice options, number
  ranges, references, signature rules).
* **Runner** (instance dialog): instructions, progress, hold-point banner,
  Start / Complete / Close / Reopen / Void / Sign / PDF; per item Pass-Fail-N/A
  or Yes-No-N/A buttons, checkbox, text, number with range, choice, date,
  photo, signature; notes; photos per answer; *Raise punch item* on deficient
  answers; signatures list; evidence, pins, discussion, history. A refused
  completion highlights the items that still need attention.
* **Company › Inspection templates**: the library with *Add starters*.
* The legacy ITP register stays under a toggle. Progress approval shows the
  server message when a hold point blocks it.

## UAT

1. Company admin: Company › Inspection templates › *Add starters*; edit the
   concrete pour ITP, save → version bumps.
2. Project: Quality › Inspections › Templates › *Copy to project* on the
   ITP; Schedule it against an activity with an assignee (subcontractor
   member) and an approver (PM), start now.
3. As the subcontractor: only that instance is visible; answer the hold
   items Pass (add a photo where required), record the slump; *Complete*
   without the inspector signature → refused with the missing signature
   listed; sign as inspector; Complete → outcome pass.
4. Before step 3 finishes, try to approve progress on the activity → 409
   `ITP_HOLD_POINT_OPEN` naming the ITP and item. After completion it
   approves.
5. Answer a hold item Fail with a note; *Raise punch item* → punch item
   PL-xxx opens with the activity and company; the answer links to it.
6. PM: Close the completed instance; Reopen with a reason → in_progress,
   outcome cleared.
7. Schedule a weekly safety walk that repeats; complete it → the next week's
   copy appears as scheduled.
8. Export PDF: items, results, notes, signatures and photos.
9. Legacy ITP rows appear as ITP-xxx instances of the migrated template with
   the original result.
