# OctaPM project setup flow (PC-0)

The §89 sequence mapped onto Setup Readiness as built, the readiness check, soft vs hard blocks, and imports. [C] = confirmed, [D] = decision.

## 1. As built [C]

`project-setup-readiness.service.js:499-689` builds exactly ten steps; `:733-776` three gates (`baseline` mode block; `progress` mode warn; `reporting` mode block with PM override). The wizard renders them as a collapsible bar with step cards and a navigate-to-module action (`frontend/src/features/projects/components/project-setup-wizard.tsx:98-175, 177-371`; mounted in `project-detail.tsx:218-231, 776-786`). Steps and their codes:

| # | key | blockers | warnings | requiredFor |
|---|---|---|---|---|
| 1 | project_profile | PROJECT_START_MISSING, PROJECT_END_MISSING | CONTRACT_VALUE_MISSING, PROJECT_DURATION_MISSING, PARTIES_INCOMPLETE | baseline, progress, reporting |
| 2 | boq_upload | NO_BOQ, BOQ_HAS_NO_VALUE | — | all three |
| 3 | schedule_generation | NO_SCHEDULE, NO_ACTIVITIES, SCHEDULE_REJECTED | SCHEDULE_NOT_ACTIVE, NO_CRITICAL_PATH | all three |
| 4 | boq_allocation | ALLOCATION_WAITING_FOR_BOQ/SCHEDULE, NO_APPROVED_ALLOCATIONS, UNALLOCATED_BOQ | PENDING_ALLOCATIONS | all three |
| 5 | cost_loading_review | NO_APPROVED_COST_LOADING, NO_REPORTING_PERIODS | NO_COST_RECORDS | reporting |
| 6 | engineer_assignment | — | ENGINEER_ASSIGNMENTS_INCOMPLETE | advisory |
| 7 | progress_method_configuration | PROGRESS_METHODS_INCOMPLETE | — | reporting |
| 8 | schedule_approval | NO_SCHEDULE_REVISION, NO_APPROVED_SCHEDULE | — | all three |
| 9 | baseline_readiness | SCHEDULE_<check>_FAILED (predecessors, allocations, critical_path, date_sanity from `schedule.service.js:314-585`) | BASELINE_WAITING_FOR_APPROVAL, BASELINE_READY_TO_LOCK | all three |
| 10 | progress_readiness | BASELINE_NOT_LOCKED, NO_ACTIVE_ACTIVITIES, NO_PROGRESS_ALLOCATIONS | PROGRESS_METHODS_INCOMPLETE, ENGINEER_ASSIGNMENTS_INCOMPLETE | progress, reporting |

Gaps [C]: flat list with counts, no per-row detail; no WBS/location/cost-code/UoM/package dimension; imports (XER/P6 XML/MSPDI) stage a `ScheduleRevision` snapshot and activate by explicit mapping (`import.service.js:148-315`; `schedule.service.js:984-1063, 2481-2860`); BOQ upload accepts code/description/quantity/unit/rate only (`services/boq/excel-parser.js:6-23`); no Excel schedule import.

## 2. The §89 sequence mapped onto the ten steps [D]

The ten-step / three-gate contract the wizard renders is **kept**. New structure steps are inserted as steps, not as a second wizard:

| §89 stage | Readiness step (key) | New? | Blockers / warnings added |
|---|---|---|---|
| a. Profile & parties | project_profile | no | — |
| b. Structure: WBS, locations, cost codes, units | **structure_setup** (new, between 1 and 2) | yes | warnings: NO_WBS, NO_LOCATIONS, NO_PROJECT_COST_CODES, UOM_UNRESOLVED (count); never a blocker (soft, §91) |
| c. BOQ upload / template | boq_upload | no | + warnings BOQ_ITEMS_WITHOUT_WBS, BOQ_ITEMS_WITHOUT_COST_CODE, BOQ_UNIT_UNRESOLVED |
| d. BOQ review & approval | **boq_approval** (new, after 2) | yes | blocker for baseline: BOQ_REVISION_NOT_APPROVED (once BOQ revisions have the approval workflow, PC-2); warning PENDING_BOQ_REVISION |
| e. Schedule: generate or import | schedule_generation | no | + warning ACTIVITIES_WITHOUT_WBS, IMPORTED_CALENDAR_UNMAPPED (XER clndr ids stored raw, `xer-parser.js:135`; 108 live activities with calendarId '1') |
| f. Mapping | boq_allocation | no | N/A items excluded; + warnings SUGGESTIONS_PENDING, UNIT_MISMATCH_COUNT, LOCATION_MISMATCH_COUNT |
| g. Cost loading & periods | cost_loading_review | no | — |
| h. Team | engineer_assignment | no | — |
| i. Progress methods | progress_method_configuration | no | + warning QUANTITY_METHOD_WITHOUT_UNIT |
| j. Schedule approval | schedule_approval | no | — |
| k. Baseline | baseline_readiness | no | — |
| l. Progress live | progress_readiness | no | — |

Steps carry **per-item detail**: each blocker/warning returns `items: [{ type, id, code, label, href }]` (capped at 50, with `count`) so the wizard can list the BOQ rows or activities that fail and link to them in the grid with the record-in-URL pattern.

## 3. The readiness check (§90) [D]

`GET /projects/:id/setup-readiness` (existing) returns the extended steps plus:

- `structure: { wbsNodes, locations, projectCostCodes, unitsUnresolved }`
- `coverage`: the §69 summary totals
- `gates` unchanged in shape; `reporting` keeps `overrideAllowedRoles: ['pm']` (`:733-776`) [C].
- `nextAction` unchanged.

The check is derived (three truths): it reads source tables only and is never stored, except that `ScheduleRevision.readinessJson` freezes the four schedule checks at baseline (`schedule.service.js:3228-3386`) [C] — kept.

## 4. Soft vs hard blocks (§91) [D]

| Kind | Rule | Examples |
|---|---|---|
| **Hard** (gate mode `block`) | data whose absence makes a downstream *source* figure impossible or wrong | no BOQ value, no approved allocations on required items, unapproved schedule, schedule checks failing, no reporting periods for official reporting |
| **Soft** (warning) | structure and quality that improve grouping and validation but do not change any figure | missing WBS/locations/cost codes on items, unresolved units, pending suggestions, unmapped calendars, incomplete engineer assignments |
| **Override** | PM may override the `reporting` gate with a reason (existing); overrides are audited and listed as a data-quality exception until resolved | reporting before cost loading review |

Nothing that is soft today becomes hard, and nothing hard becomes soft.

## 5. Imports (§92-§93) [D]

| Import | Today [C] | Target |
|---|---|---|
| BOQ xlsx | code, description, quantity, unit, rate (amount recomputed); header aliases; duplicate-code check; template download (`services/boq/template.js:7-14`); every upload creates a `BoqRevision` with an add/update/remove comparison; `comparison_only` when locked (`boq.service.js:715-1000`) | optional columns `section`, `wbs_code`, `location_code`, `cost_code`, `mapping_rule`; unit normalisation warnings; unknown WBS/location codes create nodes only when the "create missing structure" option is on (dry-run report first); revision workflow gains `draft → under_review → approved → baselined/superseded` and a lock endpoint (`BoqRevision.baselineLocked/lockedBy/lockedAt` exist but are never written [C]) |
| BOQ from company template | — | `POST /projects/:id/boq/from-template/:templateId` copies rows (new BOQ template library, ownership doc) |
| Schedule XER / P6 XML / MSPDI | staged `ScheduleRevision`; activation mapping by activityCode / p6ActivityId / wbsCode / name; unmapped existing activities retired with reason (`schedule.service.js:2481-2560`) | activation also upserts `WbsNode` from `snapshotJson.wbs` (externalId = P6 wbs_id / MSP OutlineNumber) and sets `Activity.wbsNodeId`; calendar mapping step (imported calendar id → five_day/six_day/seven_day, `cpm.service.js:14-59`) with a warning when left unmapped |
| Schedule xlsx | absent | new parser (`activity_code, name, wbs_code, start, finish, duration, predecessors, calendar`) producing the same staged `ScheduleRevision` snapshot so activation/mapping/readiness are shared |
| Mapping xlsx | absent (`source='import'` never written) | mapping doc §5 |
| Locations xlsx | absent | `code, name, kind, parent_code` → `location.service` (dry-run, idempotent by code) |
| Cost codes | company library selection (`budget.service.js:62-122`) | unchanged; project cost-code selection can be driven by the BOQ's `cost_code` column (auto-select with confirmation) |

Every import: dry-run report (counts by outcome, first 50 issues), idempotent on natural keys (code), audited, and never touches locked/baselined rows (existing `comparison_only` behaviour is the model).

## 6. Tests

- Live: `pc-4-setup-flow.js` drives a greenfield project through all steps by API and asserts the gate states after each; then removes a required allocation and asserts the baseline gate blocks again (teeth check).
- Playwright `e2e/52-setup-wizard-detail.spec.ts`: a failing step lists the offending BOQ rows and links into the grid.
- Import fixtures: `docs/Construction_BOQ.xlsx` and `docs/bill_of_quantities.xlsx` (present in `docs/`) plus one XER and one MSPDI fixture from `backend/scripts/phase21`.

## 7. The earned-value reporting cutoff (owner decision D1, corrected 2026-09-27)

The approved business rule, and how the product keeps it (`backend/src/utils/reporting-cutoff.js`, the one function every PV, EV and AC selection uses):

- **The cutoff is a reporting date.** A reporting period's cutoff date is kept exactly as entered. It is stored as the last millisecond of that date in UTC, and every reader takes the date back as the UTC calendar date of the stored value. Periods written before D1 (a date-only value the base code parsed as UTC midnight, then moved to 23:59:59.999 in the server's own zone, so 04:59:59.999Z or 05:59:59.999Z for a server in America/Chicago) carry the same date that way. A later change to the project's or the organisation's zone never moves the date. No API answer hands out the stored value as the instant: `cutoffDate` is always the computed instant, with `cutoffLocalDate`, `timeZone`, `timeZoneSource` and `timeZoneNote` beside it.
- **The instant is the end of that date in the resolved zone.** The zone is `Project.timezone`, else `Organisation.defaultTimezone`, else UTC. The end of the date is computed for that date from the zone's own rules, with daylight saving included. It is never a fixed offset. In America/Chicago a date in CDT ends at 04:59:59.999Z the next day and a date in CST at 05:59:59.999Z. A 23-hour or 25-hour day ends at its real local midnight. The server's own zone plays no part. Planned value (approved cost loading planned on or before it), earned value (progress approved on or before it) and actual cost (cost records whose `actualThroughDate` is on or before it) are selected against that one instant. The budget revisions in force and the S-curve's month ends follow the same rule.
- **The UTC fallback says so.** When the project has no zone of its own, the server writes the note and every client shows it beside the cutoff: "Project timezone is not configured; UTC is being used". When the organisation's default applied, the note names it: "Project timezone is not configured; the organisation default America/Chicago is being used". The note appears on the EV report (`reporting.timeZoneNote` and `basisWarnings`), the reporting periods, the Overview health card (`dataFreshness.cutoffTimeZoneNote`), the forecast (`earnedValueCutoff.timeZoneNote` and `dataQuality`) and the workspace home's official cutoff. On the web it shows on the EV tab, the Overview's health card and strip, the Forecast tab and the workspace home.
- **No backfill.** Existing projects and their organisations have no time zone configured. From now on they use UTC. No migration, seed, script or data write sets `Project.timezone` or `Organisation.defaultTimezone` to keep the old server-local behaviour.
- **Locked snapshots are immutable.** A locked period answers with the instant, figures, date and zone its `EvPeriodSnapshot` stored at the lock. That snapshot is never recomputed, whatever the zone or the records do later. The instant used at a lock is the end of the period's date in the zone resolved at that moment.
- **Open periods may move.** An open (unlocked) period, or an ad hoc report, is recomputed on every read. Its figures legitimately change when records fall between the instant the old code used and the new one:
  - For a stored period under UTC, the new instant is 19 hours later than its stored instant for a CDT date and 18 hours later for a CST date, so rows enter it.
  - For an ad hoc report cut at today, the old code used the end of today in America/Chicago and the new code uses the end of the current UTC date. That is 5 hours earlier (CDT) or 6 hours earlier (CST) while the two calendar dates agree, and later once UTC has passed midnight.
  - Measured read-only on 2026-09-27: no project or organisation has a zone, so all 437 projects resolve to UTC. The 26 stored periods are all open, all in two Marina Bay projects, and none has a snapshot. No progress approval, cost loading or cost actual lies in any of those windows, so no row moves. The certified project `0ce999f2` has no stored period, and no row moves in its ad hoc report either.

Tests: `backend/src/utils/__tests__/reporting-cutoff.test.js` covers the arithmetic. `backend/src/services/__live__/pc-4-ev-cutoff.live.test.js` covers real PV, EV and AC through the API, with the server in Asia/Kolkata:
- a DST date and a CST date in Chicago;
- 23:30 counted and 00:30 in the next period;
- project over organisation, organisation fallback, and UTC fallback with its note;
- one instant for all three figures;
- locked snapshots unchanged;
- legacy rows read under UTC, Chicago and Dubai;
- dates kept across zone changes.

Each of these mutations fails the suite: a fixed -5 h or -6 h offset, the server-local end of day, swapped precedence, a removed note, a recomputed lock, legacy rows read in the project's zone, and new rows stored at the zone's end of day.

## 8. Every refusal and next step on the approval and baseline path (owner decision D5, sweep 2026-09-27)

The rule: each refusal, blocker and "Next:" label names the action that resolves it and a page that offers that action to this member, or, when the member is not offered it, who can. It never names a page that shows only the active schedule for a staged revision, and never the read-only Critical Path tab.

Why the split: a **staged** revision (imported or generated, not activated) lives only in its snapshot. Schedule › Gantt, Activities and Critical Path show the **active** activities, so they are empty in greenfield and, with an active schedule, show the old activities. No page edits a staged revision. Its own logic is corrected at its source and imported again, or regenerated (Schedule › Update Schedule; the new revision supersedes it), or, under review, the revision is rejected. An **active** revision's activities are edited on Schedule › Gantt › Edit; its CPM is recalculated from Schedule › More actions.

One source of words: `schedule.service` `readinessCheckFix` gives each failing readiness check a `fix` (`where`, `inline`, `next`, `text`, `permission`). The SCHEDULE_NOT_READY message, the setup readiness blockers and the review panel ("Next:" and "To fix:") all use it. The routes resolve whether the caller may take the fix (`FIX_PERMISSIONS`: schedule.create, schedule.update, schedule.approve, boq.create); when not, the refusal adds "Only members who can … can take this step; ask one of them." The panel says the same beside the fix.

| Revision state | Refusal or label | Text (abridged) | Target |
|---|---|---|---|
| Any state, the project has no BOQ item | both baseline routes 400 BOQ_REQUIRED_FOR_BASELINE, before every row below; setup gate and panel | "BOQ required before baseline lock: upload the BOQ (BOQ page), then map it to the schedule and lock the baseline."; "Next: upload the BOQ (BOQ page), then lock baseline" | BOQ page |
| No revision | `POST /schedule/baseline` 404 REVISION_NOT_FOUND | "No schedule revision exists yet: import a P6/MSP schedule or generate one from the BOQ on the Schedule page." | Schedule page (upload zone) |
| No revision | setup `schedule_approval` NO_SCHEDULE_REVISION; action | "No schedule revision is available." (kept as the base words: the gates carry this blocker exactly as cb14ff4 derived it); **Open Review** (and `baseline_readiness` keeps its base action, whose waiting warning the gates carry) | Schedule module, which shows its upload zone (import or generate) on every tab until a revision exists |
| Staged draft, logic fails | readiness `checks[].fix`; panel "Next:" | "A staged revision cannot be edited: correct the schedule at its source and import it again, or regenerate it from the BOQ (Schedule › Update Schedule) — the new revision replaces this one." / "Next: import a corrected schedule or regenerate it (Schedule › Update Schedule) — this revision fails its own checks" | Schedule › Update Schedule |
| Staged draft, logic fails | setup NO_APPROVED_SCHEDULE and ALLOCATION_WAITING_FOR_SCHEDULE | "The schedule revision fails its own checks (Predecessor logic). A staged revision cannot be edited: …" | Schedule › Revisions (the page carries Update Schedule) |
| Staged draft | approve / baseline 409 INVALID_REVISION_STATUS | "This schedule revision is now Draft; it must be Under review before it can be approved. Refresh …" | Schedule Review panel (Submit Review) |
| Staged draft, logic passes | setup NO_APPROVED_SCHEDULE; panel | "Submit the schedule revision for review, then approve it (Schedule Review, on Schedule › Revisions)." / "Next: submit for review" | Schedule Review panel |
| Staged under review, logic fails | approve 400 SCHEDULE_NOT_READY | "Schedule readiness checks must pass before approval: Predecessor logic — at least one predecessor relationship is required. A staged revision cannot be edited: … — the new revision replaces this one, or reject this revision (Schedule Review)." | Update Schedule, or Reject on the panel |
| Staged under review, logic passes | setup; panel | "Approve or reject the schedule revision under review (Schedule Review, on Schedule › Revisions)." / "Next: approve or reject" | Schedule Review panel |
| Staged rejected | approve 409 INVALID_REVISION_STATUS; setup; panel | "…now Rejected; it must be Under review…"; "The schedule revision was rejected: import a corrected schedule or regenerate it (Schedule › Update Schedule), or resubmit it for review"; with its logic failing, the staged fix | Update Schedule, or Submit Review on the panel |
| Older staged revision (superseded by a newer import) | any step 409 REVISION_NOT_CURRENT | "This schedule revision is no longer current … Refresh to see the current revision (Schedule › Revisions)." | Schedule › Revisions |
| Staged approved | baseline 409 REVISION_NOT_ACTIVATED; setup action; panel | "This approved schedule revision has not been activated yet. Activate it on Schedule › Revisions …"; **Activate Revision**; "Next: activate this revision (Schedule › Revisions)" | Schedule › Revisions (Activate) |
| Staged approved, a schedule already active | activate 400 MAPPING_CONFIRMATION_REQUIRED (API only; the dialog always sends the mapping) | "Activating this revision replaces the active schedule: confirm how its activities map … (Schedule › Revisions › Activate proposes the mapping) …" | Schedule › Revisions › Activate |
| Active approved (activated elsewhere while the dialog was open) | activate 409 REVISION_ALREADY_ACTIVE | "This schedule revision is already active. Refresh Schedule › Revisions — the next step is to map the BOQ to its activities (Project Controls › Mapping) and lock the baseline." | Schedule › Revisions; Project Controls › Mapping |
| Active approved, coverage open | baseline 400 SCHEDULE_NOT_READY; setup action; panel | "… BOQ allocations — BOQ value remains unallocated … (Project Controls › Mapping)."; **Map Allocations**; "Next: map the BOQ to the active activities (Project Controls › Mapping), then lock baseline" | Project Controls › Mapping |
| Active approved, logic broken | baseline 400 SCHEDULE_NOT_READY; setup SCHEDULE_*_FAILED; action | "… Predecessor logic — … (Schedule › Gantt › Edit)." (critical path: "(Schedule › More actions › Recalculate CPM)"; dates: "(Schedule › Gantt › Edit)"); the blocker adds the fix sentence; **Correct the Schedule** | Schedule › Gantt › Edit, or More actions |
| Active, no activity left | readiness fix; baseline 400 NO_ACTIVITIES | "No activity is active: import a P6/MSP schedule or generate one from the BOQ (Schedule › Update Schedule)." | Schedule › Update Schedule |
| Active draft / under review (recorded before staging) | approve 400 SCHEDULE_NOT_READY; setup | "… (Schedule › Gantt › Edit)."; "The schedule revision fails its own checks (Predecessor logic). Add or correct the activities' predecessor links on Schedule › Gantt › Edit …" | Schedule › Gantt › Edit |
| Active approved, ready | setup action; panel | **Lock Baseline**; "Next: lock baseline" | Schedule › Revisions (Lock Baseline on the panel) |
| Active baselined | baseline 409 INVALID_REVISION_STATUS; activate 409 REVISION_ALREADY_ACTIVE | "This schedule revision's baseline is already locked. A new baseline comes from a new revision: import or generate one (Schedule › Update Schedule), take it through review and activation, then lock its baseline."; "… already active and its baseline is locked. Refresh …" | Schedule › Update Schedule |
| Active baselined | rollback of a revision that is not active, 409 REVISION_NOT_ACTIVE | "Only the active schedule revision can be rolled back, and this one is not active. Refresh Schedule › Revisions …" | Schedule › Revisions |
| Staged revision beside an active baselined one | `GET /schedule` `candidateRevision`; the Schedule page | A second review panel, "Staged revision: <label>", with its own readiness and Submit / Approve / Reject; Activate stays on the Revisions tab | Schedule page, beside the active schedule |
| Staged revision beside an active baselined one | setup `schedule_approval` advisory STAGED_REVISION_PENDING | "A newer schedule revision, "<label>", is staged beside the active schedule and replaces it only once it is approved and activated. <its next step>" (an advisory: it moves no step or gate) | Schedule › Revisions |

API-only validation refusals say what is wrong in words (`validateWithReasons`): an over-long comment ("The approval comment can be at most 2,000 characters."), a malformed activation body, a malformed revision id (schedule or BOQ), and a body that is not JSON ("The request body is not valid JSON.", from `middleware/error-handler`).

Tests: `backend/src/services/__live__/pc-4-merge-gate-r7.live.test.js` walks the states above against a real API. It asserts each text and target, and that no answer on the path names Schedule › Critical Path, Schedule › Activities or a bare Schedule › Gantt. Each of these mutations fails it:
- the staged fix reverted to the active pages;
- the already-active guard removed;
- no candidate revision on the Schedule page;
- the baseline step pointing at the lock while the logic is broken;
- the approval step back to its bare sentence;
- the comment validator without its reason;
- the JSON mapping removed.

### 8.1 No baseline without a BOQ (owner decision, 2026-09-28)

In integrated Project Controls the steps run project structure → BOQ → schedule → mapping → validation → baseline lock. The UI already refused a lock on a project with no BOQ (the setup baseline gate; the review panel's "Next: upload the BOQ (BOQ page), then lock baseline"); the server now refuses it too. `schedule.service` `lockBaseline` — behind both `POST /schedule/baseline` and `POST /schedule/revisions/:id/baseline`, the only paths that mark a revision baselined or copy activity baseline dates — counts the project's active BOQ items after confirming the project is the caller's organisation's, and with none refuses 400 BOQ_REQUIRED_FOR_BASELINE (error catalogue, `utils/error-codes`). It is the first step, so it is named before REVISION_NOT_FOUND, INVALID_REVISION_STATUS (a draft, or a revision already baselined), REVISION_NOT_ACTIVATED, SCHEDULE_NOT_READY (D5 coverage passes vacuously on an empty bill) and NO_ACTIVITIES. The count is asked again inside the lock's transaction before its first write. Nothing is written on refusal, and baselines locked before the rule are untouched (rollback re-activates a revision with its existing status and copies no baseline dates). There is no bypass flag: a schedule-only mode would be an explicit product mode.

The schedule readiness says the same (closure review, 2026-09-28): its first check, `boq_present` ("BOQ", required for the baseline only), fails on a project with no active BOQ item, so `baselineReady` is false and `baselineBlockingCount` counts it while the lock is refused — never `baselineReady: true` beside a 400. Its fix is the upload on the BOQ page (`boq.create`), named before any schedule or mapping step; the approval's verdict (`ready`) does not include it, and the check says only whether a bill exists, never a count or a value. Setup readiness does not repeat it as a schedule blocker: its BOQ step already names the upload. The review panel shows it as the one blocking check ("1 blocking", e2e/60).

Tests: `pc-4-baseline-needs-boq.live.test.js` (both routes, the PM and a planning engineer granted the lock, every schedule stage, nothing written, then the bill → the mapping → the lock; a pre-rule baseline left exactly as it was); spec 60 asserts the server's refusal beside the refused button. Fixtures that lock a baseline (r5, r7, spec 59) enter a one-row bill through `POST /boq/items` and map it after activation.
