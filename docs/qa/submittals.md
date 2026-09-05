# Submittal upgrade: packages, review workflows, response codes, lead time (OCTA-PM-SUB-017)

The submittal keeps its base workflow (pending → under review → approved /
returned, party assignments, revision evidence, archive) and gains what a
contractor needs to run a submittal log at scale: packages, multi-step
review routes from templates, formal response codes, submit-by dates
computed from the programme, and a distribution list that is told the
outcome.

## Model

| Table / column | Purpose |
| --- | --- |
| `Submittal.packageId` | The package the submittal belongs to (one at most). |
| `Submittal.workflowTemplateId`, `currentStepId` | Review route in use and the step whose reviewers hold the ball. |
| `Submittal.responseCode`, `responseCodeLabel` | Final response: `approved`, `approved_as_noted`, `revise_resubmit`, `rejected`, or `custom` with its own label. |
| `Submittal.leadTimeWeeks`, `reviewDays`, `requiredOnSite`, `submitBy` | Lead time after approval, review-days override, need date, and the derived submit-by date. |
| `Submittal.revisionNumber` | Review cycle counter (0 = first cycle); bumps when a returned submittal goes back under review. |
| `Submittal.scheduleImpactDays` | Days the material lands after the activity needs it, given the approval date and lead time. |
| `Submittal.managerUserId`, `createdBy`, `distributionJson`, `distributedAt` | The manager, the originator, the distribution list (user ids) and when the outcome was sent. |
| `SubmittalPackage` | `PKG-001` numbering, name, activity, need date, manager; `status` derived from its items (`open`, `submitted` while any is under review, `closed` when every item is approved). |
| `SubmittalWorkflowTemplate` | Company library (`projectId` null) or project-scoped; `stepsJson` = ordered steps `{ name, mode, days, assignees }`, `isDefault`. |
| `SubmittalStep` | One row per step per review cycle (`revisionNumber`), with `mode`, `days`, `status` (pending → active → approved / rejected / skipped), `startedAt`, `dueAt`, `completedAt`. |
| `SubmittalStepAssignment` | One row per reviewer per step: `status`, `responseCode`, `comment`, `decidedAt`. |

The migration adds the columns, creates the tables and backfills a response
code from legacy statuses.

## Review workflows

A step's reviewers are resolved when the route starts:

* `user` → that person (must belong to the organisation);
* `party_role` → every active member of every active project party with that
  role (`owner`, `consultant`, `contractor`, `subcontractor`);
* `role` → every project assignment whose normalised role matches (`pm`,
  `planning_eng`, `qs`, …).

A step that resolves to nobody stops submission with 409
`SUBMITTAL_STEP_UNASSIGNED` so the route is never silently empty.

Two starter workflows can be seeded into the company library
(`POST /company/submittal-workflow-templates/starters`): *Contractor check,
then consultant review* (default) and *Parallel consultant and planning
review*.

## Rules

* **Submit-by** (`computeSubmitBy`): need date (`requiredOnSite`, else the
  linked activity's start) − `leadTimeWeeks × 7` − review days (the
  `reviewDays` override, else the template's sum of step days). Recomputed
  whenever any of those change; the due date follows it until the submittal
  is submitted. Not-yet-submitted items past submit-by are `isLate`.
* **Route start** (`onStatusChange`): when the status becomes `under_review`
  and a workflow is set, steps are created for the current cycle, step 1 is
  activated (`dueAt = now + days`, ball in court = its first pending
  reviewer, `dueDate` follows the step) and its reviewers are notified. If the
  previous cycle's steps were decided, `revisionNumber` is bumped first and
  the old response code cleared.
* **Decisions** (`POST …/decide`): only a pending reviewer on the active step
  may decide; the PM may decide on any step (an assignment is added for
  them). Approve accepts `approved` / `approved_as_noted` / `custom`, reject
  accepts `revise_resubmit` / `rejected` / `custom`; a comment is required to
  reject and a label to use `custom`. A **sequential** step closes on the
  first approval; a **parallel** step waits until every reviewer approves
  (the ball moves to the next pending reviewer). The **first rejection**
  closes the step, skips the remaining reviewers and returns the submittal
  (`resubmit` for revise-and-resubmit, `rejected` for rejected) through the
  base service. Approval of the last step approves the submittal with that
  response code.
* **Close-out**: on approve / return, leftover pending or active steps are
  skipped, `currentStepId` is cleared, the response code is stored, and the
  manager, originator, owner, assignee and distribution list are notified.
  On approval the schedule impact is computed (`approvedAt + lead time` vs
  the need date); a positive value is stored on the submittal and upserted as
  a `submittal_lead_time` `WorkflowActivityLink` on the activity.
* **Legacy actions** (`approve`, `reject`, `resubmit` by the PM) still work
  and go through the same close-out.
* **Overdue reminders** now reach the manager, the ball-in-court holder and
  the originator (`notification.DUE_RECORDS.submittal`).
* **Packages**: a submittal can be in one package; `submit` sends every
  pending / returned item (items without revision evidence are reported, not
  submitted); `decide` applies one decision to every item whose active step
  waits on the caller and reports the rest.

## Endpoints (`/api/v1/projects/{projectId}/submittals`)

| Method / path | Purpose |
| --- | --- |
| `GET /` | Filters added: `packageId`, `managerUserId`, `workflowTemplateId`, `ballInCourtUserId` (`me`), `responseCode`, `overdue`. |
| `POST /`, `PATCH /{submittalId}` | Accept `packageId`, `workflowTemplateId`, `leadTimeWeeks`, `reviewDays`, `requiredOnSite`, `managerUserId`, `distributionUserIds`, `discipline`, `specRef`, `revision`. |
| `GET /{submittalId}` | Detail: steps per cycle, active step, package, workflow, manager, distribution, submit-by, late flags, schedule impact. |
| `POST /{submittalId}/decide` | Decide on the active step (`submittal.review`). |
| `PUT /{submittalId}/people` | Manager and distribution list. |
| `GET/POST /packages`, `GET/PATCH /packages/{packageId}` | Packages. |
| `POST /packages/{packageId}/items`, `DELETE …/items/{submittalId}` | Membership. |
| `POST /packages/{packageId}/submit`, `POST …/decide` | One action for the whole package. |
| `GET/POST /workflow-templates`, `PATCH/DELETE …/{templateId}` | Project workflows (company ones are read-only here). |
| `GET/POST /company/submittal-workflow-templates`, `POST …/starters`, `PATCH/DELETE …/{id}` | Company library (admins write). |

OpenAPI tag "Document Control" / "Company Workspace" (368 documented paths).

## Frontend

* Doc control › **Submittals** has three views: **Register** (search, status,
  sort, *Waiting on me*, *Late*, an **Open** button per row, response-code and
  submit-by badges), **Packages** (create with items, add / remove items,
  *Submit all*, *Decide all*, status and counts) and **Workflows** (project
  workflows plus the company library; editor with ordered steps, mode, days
  and reviewers by person / party / role).
* **New submittal** dialog: discipline, spec reference, revision code,
  activity, required-on-site, lead time, workflow, package, reviewing party,
  manager, distribution, notes — and a live *Submit by* preview using the
  same formula as the backend.
* **Submittal workspace** dialog (`?source=submittal&recordId=` deep link):
  status, response code, cycle, late badges, schedule impact; the review
  route with each step, its reviewers and their decisions; the decision form
  when the caller holds the ball (or is the PM); submit-for-review form;
  manual approve / return when no workflow is set; inline edit; people
  editor; pins, attachments, internal notes and history; earlier cycles kept
  under a disclosure.
* Company › **Submittal workflows** page manages the library and seeds the
  starters.

## Tests

* `backend/src/services/__tests__/submittal-workflow.service.test.js` —
  template validation, submit-by and impact maths, assignee resolution, route
  start, revision bump, parallel / sequential decisions, rejection, PM
  override, close-out, packages.
* `frontend/scripts/submittals-ui.test.mjs` — hooks, dialogs, panels, dashboard
  wiring and the backend contract.
