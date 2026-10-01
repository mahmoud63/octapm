# OctaPM change intelligence (PC-0)

Overrun exceptions, the handoff to a change event, schedule impact, baseline, traceability, the exception engines, data quality. [C] = confirmed, [D] = decision. No certified money rule changes.

## 0. As built [C]

`ChangeEvent` (`schema.prisma:6153-6230`): `activityId`, `locationId`, free-text `sourceRecordType/sourceRecordId`, `origin` (manual, rfi, submittal, daily_log, observation, meeting, other), lines with `costCodeId/budgetLineId/activityId/commitmentId`, RFQs; converts to a `ChangeOrder` + `CommitmentChangeOrder`s (`change-event.service.js:459-505`). No RFI/daily-log/NCR/observation/drawing service creates one; the 4 live events are manual with 0 lines. `ChangeOrder` links: `activityId`, `budgetLineId`, `budgetAllocationsJson`, `ChangeOrderActivityLink` (schedule/float/cost impact + CPM snapshot, 278 rows), `ChangeOrderAllocationLink` (BOQ qty/amount, 0 rows), `BudgetLineChange`, `CommitmentChangeOrder.primeChangeOrderId`, `Rfi.changeOrderId` (bare string). Approval writes `BudgetRevision`, distributes to budget lines with a holding line, stamps `approvedCostImpact`/`approvedScheduleImpactDays`, recomputes `PrimeContract.revisedValue` (`change-order.service.js:646-820, 1230-1290`). `WorkflowActivityLink` carries RFI/submittal schedule impact consumed by `forecast.service.js:82, 103`. `forecast.service` produces `dataQuality` notes (`:324-331`).

## 1. Overrun exceptions (§85) [D]

Derived, rebuildable rows in a new table `ProjectException` (project-owned, `orgId` + composite FK; §35 rule 2 — listed org-wide in the workspace dashboard):

```
id, projectId, orgId, kind, severity (info|warning|critical), subjectType, subjectId,
secondarySubjectType?, secondarySubjectId?, groupKeys (wbsNodeId?, locationId?, costCodeId?),
measured Decimal, limit Decimal, unitCode?, detectedAt, lastSeenAt, resolvedAt?, resolvedReason?,
changeEventId?, snoozedUntil?, dataJson
@@unique([projectId, kind, subjectType, subjectId, secondarySubjectType, secondarySubjectId]) (partial WHERE resolvedAt IS NULL, raw SQL)
```

**As built in PC-7b (schema, migration `20261005060000_project_exceptions`, not yet applied) [C]** — where it differs from the sketch above:

- `measured` / `limit` are `Decimal(18,3)` and each carries a required basis string, `measuredBasis` / `limitBasis` — the basis the owning service states for that figure (allocation summary, quantity views, commitment totals, ledger, EV report, IPC). An exception always says where its two figures came from; it never computes one.
- The review fields are columns: `reviewedAt?`, `reviewedBy?`, `reviewNote?`, `snoozedUntil?`, `snoozedBy?`. `dataJson` defaults to `{}`; `detectedAt` / `lastSeenAt` default to now.
- Group keys are typed foreign keys, all SET NULL: `wbsNodeId → WbsNode`, `locationId → Location`, `costCodeId` through the ENT-3 master key `(costCodeId, orgId) → CostCode(id, orgId)` whose SET NULL nulls `costCodeId` only (column-list form, as ENT-3 did for `ChangeEventLine`). `changeEventId → ChangeEvent` SET NULL. Org / project CASCADE.
- Indexes: `(projectId, kind, resolvedAt)`, `(orgId, resolvedAt)`, `(projectId, subjectType, subjectId)`, `changeEventId`, plus one per group key.
- **Open-row uniqueness** is the hand-written partial unique index `ProjectException_open_subject_key` on `("projectId", "kind", "subjectType", "subjectId", COALESCE("secondarySubjectType", ''), COALESCE("secondarySubjectId", '')) WHERE "resolvedAt" IS NULL` (precedent: `ActivityBoqAllocation_active_pair_key`, 20260608170000). The COALESCE makes NULL secondary subjects collide — a plain unique index treats NULLs as distinct and would let two open rows for the same gap through. Prisma cannot declare it: anyone who ever generates a migration by diffing a *database* against the schema must strip the `DROP INDEX "ProjectException_open_subject_key"` Prisma would propose (this repo diffs schema to schema, which does not see it).
- Nothing on `ChangeOrder`, `BudgetLine`, `Activity`, `CostRecord` or any money table is added for the engine to write to: an exception is a reviewed signal, never a change order, a budget or schedule change, or a figure (owner rule; R5-1 — the forecast's change-order impacts stay a forecast).

Overrun kinds (all evaluated from source/derived figures only):

| kind | condition | subject |
|---|---|---|
| `quantity_over_allocation` | installed > allocation qty | allocation |
| `quantity_over_boq` | Σ installed on item > BOQ qty | BOQ item |
| `certified_over_installed` | certified qty > installed qty (quantity-method activities) | BOQ item |
| `certified_over_earned` | IPC certified value > earned value (already stored as `overCertificationAmount` [C]) | certificate item |
| `committed_over_budget` | committed > revised budget on a line | budget line |
| `actual_over_committed` | ledger actual > committed on a commitment (certified gross beyond contract value) | commitment |
| `forecast_over_revised` | official EAC > revised BAC; or line forecast > revised | project / line |
| `allocation_over_capacity` | approved allocation totals exceed item after a rate/qty edit | BOQ item |
| `schedule_slip_on_mapped_item` | activity finish variance > threshold on an item with certification pending | activity |

Thresholds live in `Project.dailyLogSettingsJson`-style JSON on the project (`controlsSettingsJson`) with org defaults.

**Superseded by the owner rule (PC-7b):** thresholds are documented constants per kind until the owner asks for settings — no column, no project JSON (`backend/src/services/exception-rules/_thresholds.js`, listed below).

**As built in PC-7b (engine, `backend/src/services/exception-rules/{quantity,money,schedule}.js`) [C].** Each rule is a pure read of two figures from the service that owns them, compared against its documented threshold; both figures are stored with the basis the owner states (`measuredBasis` / `limitBasis`). No rule computes money, writes a forecast, an EAC, a budget or a schedule figure, or reads the forecast's change-order impacts (R5-1).

| kind | measured (owner) | limit (owner) | fires when | severity | module · BOQ-derived |
|---|---|---|---|---|---|
| `quantity_over_allocation` (subject `allocation`) | Σ approved entries on (activity, item) — `quantity-progress.service installedByActivity`; quantity-method, active activities only (the views' rule) | authorised = allocation quantity + Σ approved change-order allocation-link quantity — `ipc.service getApprovedVariationAllowances` (the IPC cap's rule; the allocation row is never changed) | measured > limit + 0.0005, same unit only | warning; critical > 10 % over | boq · yes |
| `quantity_over_boq` (`boq_item`) | installed per item — `quantity-views quantityBlocks` (`installedByBoqItem`) | `BoqItem.qty` + approved variation naming the item | as above; an installed figure not available or not in the row's unit is never compared | warning; critical > 10 % | boq · yes |
| `certified_over_installed` (`boq_item`) | certified — the views' `comparisons.certifiedOverInstalled` (certified basis `certifiedIpcItemWhere`) | installed — the same comparison | the views' flag, only when every approved allocation of the item is on a quantity-method activity | critical | boq · yes |
| `certified_over_earned` (`ipc_certificate`) | `IpcCertificate.overCertificationAmount` as stored at certification (certified/paid certificates) | 0 (earned value at certification in `dataJson`) | stored amount > 0.01 | critical | cost · yes |
| `committed_over_budget` (`budget_line`) | register committed — `budget.service listBudgetLines` | register revised budget | > 0.01, active lines | warning; critical > 10 % | cost · no |
| `actual_over_committed` (`commitment`) | ledger total — `cost-ledger.service certifiedAgainstCommitment` | revised commitment — `commitment.service listCommitments` (`totalsFor`), executed/closed only | > 0.01 | warning; critical > 10 % | cost · no |
| `forecast_over_revised` (`project`) | official EAC — `earned-value.service buildOfficialEvReport` (the forecast's call: default period, locked snapshot when locked; recomputed at an asked cutoff) | revised BAC (EV basis) | > 0.01 | warning; critical when CPI < 0.9 | cost · no |
| `forecast_over_revised` (`budget_line`) | register forecast (typed, or the register's default `max(revised, actual, committed)`, said in the basis) | register revised budget | > 0.01, active lines | warning; critical > 10 % | cost · no |
| `allocation_over_capacity` (`boq_item`) | Σ approved allocation quantity, else amount — `buildAllocationSummary` | item quantity / amount | > 0.0005 / > 0.01 | warning | boq · yes |
| `schedule_slip_on_mapped_item` (`activity`) | the activity's finish − `Activity.baselineFinish`, in the CPM working-day index. The finish (`dataJson.finishBasis`, also said in the basis): **actual_finish** — finished (latest approved `ActivityProgress` at the as-of instant, EV's selection rule: 100 % or an actual finish) with an `actualFinish`; **data_date** — not finished and the data date (the evaluation's cutoff, else its own time, as a date in the project's reporting zone) is past its planned finish: it cannot finish earlier; **early_finish** — otherwise `Activity.earlyFinish` (`endDate` when the CPM has not placed it). A date is placed as the CPM places its own (`cpm.service dateToWorkingDay` from `Project.startDate`, the activity's calendar); without a start date only the early finish is read. The CPM's forward pass alone ignores actual dates and the data date, so a late actual finish or an overdue activity would never show. Never the forecast's change-order impacts (R5-1) | 5 working days | slip > 5 on an activity with an approved allocation of an item whose certified value (allocation summary) is below its amount | warning; critical on a critical activity or ≥ 20 days | schedule · no (the pending items sit under `dataJson.boq`, which a reader without boq:read is not given) |

`allocation_over_capacity` cannot arise today: the triggers `ActivityBoqAllocation_validate` and `BoqItem_allocation_capacity_validate` (migration `20260608170000`) refuse active allocations above their item. The rule stands for rows that predate them; the live suite asserts it finds nothing.

A `data_date` slip grows by one each working day the activity stays unfinished, so its row refreshes daily, and a dismissal of it holds only until the next working day (the dismissal rule: it reopens when the measured figure moves past the dismissed one). Snooze is the action for "known, leave it until …".

## 2. The handoff (§86) [D]

From any exception: **Raise change event** → `POST /projects/:id/change-events` prefilled with `origin` from the exception kind, `activityId`, `locationId`, a typed source link (§4), and lines derived from the exception (cost code / budget line / activity / commitment of the subject; quantity delta as the line quantity; amount blank for the QS). The exception stores `changeEventId` and shows as "in change". When the event converts to an order and the order is approved, the exception is re-evaluated on the next engine pass and resolves itself if the approved change closed the gap (e.g. `ChangeOrderAllocationLink` raising the allocation quantity — the 0-row table starts being written by this path).

The handoff also exists from RFI, daily log, NCR/observation, punch item and drawing revision records ("Raise change event" action) — the same endpoint with the typed source (§4).

## 3. Schedule impact (§87) [D]

- `ChangeEvent.scheduleImpactDays?` and `ChangeEventLine.activityId` (exists) give the pre-order estimate; converting copies it to `ChangeOrderActivityLink.scheduleImpactDays` (exists) and approval stamps `approvedScheduleImpactDays` (exists, `change-order.service.js:646-700`) [C].
- The forecast consumes `WorkflowActivityLink.scheduleImpactDays` for RFIs/submittals (`forecast.service.js:82, 103`) [C]; PC-7 makes it also consume approved change-order links, so one "recorded impact" list drives the forecast finish.
- Impact is a projection until approved; approved impact is source. A CPM re-run after approval is a derived recompute (existing `cpm.service`).

## 4. Baseline (§88) [D]

- Schedule baseline: `lockBaseline` copies early dates to `baselineStart/Finish` on every active activity after readiness passes (`schedule.service.js:3228-3386`) [C] — unchanged.
- BOQ baseline: today derived from the baselined `ScheduleRevision` (`boq.service.js:221-258`) [C]; PC-2 writes `BoqRevision.baselineLocked/lockedBy/lockedAt` explicitly at the same moment (both truths agree; the derived rule stays as the fallback for the 10 seed items already flagged).
- Budget baseline: `BudgetSnapshot` per locked reporting period (`:4788`, 0 rows locally) and `EvPeriodSnapshot` (`:1887`, 0 rows) [C] — PC-6 makes "lock period" a first-class action in the reporting flow so the S-curve has a real history and the time-phased comparison "baseline vs current vs forecast" is available for schedule, quantity and money.
- Re-baselining is a new baselined `ScheduleRevision` (existing supersede path); prior baseline values are kept on the revision snapshot.

## 5. Change-event traceability (§126) [D]

`ChangeEvent` gains typed, nullable FKs beside the free-text pair (kept for anything not listed): `rfiId`, `dailyLogId`, `ncrId` (→ `NcrRecord`), `punchItemId`, `drawingRevisionId` (→ `SheetRevision`), `submittalId`, `meetingActionItemId`, `exceptionId`. `ChangeOrder` gains `locationId?` and `wbsNodeId?` (SetNull). `Rfi.changeOrderId` becomes a real relation (0 mismatch risk: bare string today, validated on backfill). The §126 checklist after PC-7:

**As built in PC-7b (migration `20261005060000_project_exceptions`, not yet applied) [C]:** exactly the columns above, every one nullable, single-column, ON DELETE SET NULL and indexed (`punchItemId → PunchItem` covers punch items and observations; `meetingActionItemId → MeetingActionItem`; `exceptionId → ProjectException`); `sourceRecordType/sourceRecordId` and their index are unchanged. The migration backfills nothing: on the shared database all 7 change events have no source pair, so there is nothing to backfill (`change-link-census.js`). `ChangeOrder.locationId → Location` and `ChangeOrder.wbsNodeId → WbsNode`, SET NULL, indexed — structure links only. `Rfi.changeOrderId` keeps its column and becomes a foreign key → `ChangeOrder` SET NULL, indexed (relation `Rfi.changeOrder` / `ChangeOrder.rfis` — the reverse link R5-5 asks for): `scripts/project-controls/change-link-census.js` (read-only, 2026-10-01) found 94 RFIs, 10 non-null values, all 10 naming a change order of the RFI's own project, 0 cross-project, 0 orphaned. A foreign key cannot refuse a link to another project's order, so the census (exit 2 on any cross-project or orphaned value) stays the guard for that, and the one service that writes the column (`rfi-workflow.service.js` `convertToChangeEvent`) writes only the id of a change order it has just created in the RFI's own project: `changeOrderService.createChangeOrder` runs first, in its own transaction and scoped to the RFI's `projectId`, and `Rfi.changeOrderId` is set afterwards in a separate `$transaction` together with its audit event. The two steps are not one transaction, so a failure between them leaves a draft change order with no RFI pointing at it, never an RFI pointing at another project's order.

| Link target | ChangeEvent | ChangeOrder |
|---|---|---|
| BOQ item / allocation | via lines' activity + `ChangeOrderAllocationLink` prefill | `ChangeOrderAllocationLink` (written by the handoff) |
| Activity | `activityId`, lines | `activityId`, `ChangeOrderActivityLink` |
| WBS | via activity/BOQ node (derived) | `wbsNodeId` |
| Location | `locationId` (exists) | `locationId` |
| Cost code / budget line | lines (exist) | `budgetLineId`, `BudgetLineChange` (exist) |
| Commitment | lines, RFQ → CCO (exist) | `CommitmentChangeOrder` (exists) |
| RFI / daily log / NCR / punch / drawing revision / submittal / meeting action | typed FKs (new) | through the event (`ChangeEvent.changeOrderId`, exists) |
| Exception | `exceptionId` (new) | through the event |

## 6. The exception engines (§127-§128) [D]

One evaluator, two triggers, no second engine:

- `exception-engine.service.js` with a registry of rules (`kind → evaluate(projectId, cutoff) → rows`). Each rule reads source/derived figures through the existing services (`buildAllocationSummary`, `commitment.service` totals, `cost-ledger.service` projections, `earned-value.service` report, quantity entries) — it never computes money itself.
- Trigger 1, **event-driven**: `bus.subscribe` on the relevant domain events (allocation approved, progress approved, quantity entry approved, pay app certified, ledger posted, commitment executed, change order approved, BOQ item edited) enqueues a `BackgroundJob` `exceptions.evaluate` for the project (debounced per project, 30 s).
- Trigger 2, **scheduled**: nightly per-org tick (same pattern as `report-scheduler.js:27-35`) re-evaluates every active project and resolves stale rows.
- Output is upserted by the partial unique key; resolved rows keep `resolvedAt`; snoozes are per row.
- Surfaces: `…/controls/exceptions` (project), the Overview strip, BOQ/Activity Detail, the workspace dashboard "open exceptions" tile (org-wide read of `ProjectException` where `orgId` — §35 rule 2), notifications through `notification.service.createNotifications` with `category='exception'`.

Engine two in the brief's sense — **data quality** — is the same evaluator with `severity='info'` kinds (§7), not a separate service.

**As built in PC-7b (engine track) [C].**

- **Registry** — `exception-rules/index.js` loads every `*.js` of the folder except itself and `_`-prefixed helpers; each exports an array of `{ kind, severity, subjectType, module, boqDerived, requires?, evaluate }`; a kind defined twice is refused at load. `kindMeta()` gives the readers each kind's `module` and `boqDerived` (the api track's withholding). The dq track's `data-quality.js` is picked up without editing the index. A row may carry its own `severity` (overrides the rule's default); `data.dismissal` / `data.reopenedFrom` are reserved for the engine.
- **`evaluateProject({ orgId, projectId, cutoff?, trigger, dryRun? })`** — loads the project where `{ id, orgId }` (404 otherwise; no rule runs), runs the rules one after another (shared reads memoised per run), then in ONE transaction under `pg_advisory_xact_lock('project-exceptions:<projectId>')`: a finding with an open row moves `lastSeenAt` only, or rewrites figures / bases / severity / group keys / data when one of them changed (`refreshed`); a new finding opens a row; an open row whose kind ran to the end and whose subject was not found again is resolved `resolvedReason 'cleared'`. A rule whose source is absent (`requires` → reason) is `skipped`, a rule that throws is in `errors`; neither resolves its kind's rows. The open-row key is the database's (`ProjectException_open_subject_key`). It answers `{ opened, refreshed, resolved, unchanged, suppressed, skipped, errors, notes, rows }`. `dryRun` plans the same answer and opens no transaction and writes nothing. The engine writes `ProjectException` rows only — no audit or domain event.
- **Dismissal** — `setDismissed({ orgId, projectId, exceptionId, actorId, reason, note? })` (for the api track's action): resolves the open row `dismissed:<reason>`, stamps `reviewedAt/By/Note` and keeps `dataJson.dismissal { measured, limit, unitCode, dismissedAt, dismissedBy, reason }`; 404 `EXCEPTION_NOT_FOUND` (another project/organisation), 409 `EXCEPTION_NOT_OPEN`. The engine does not reopen the subject while its measured figure is at or below the dismissed one — a changed limit alone does not reopen it; when the measured figure moves past it, a NEW open row is opened with `dataJson.reopenedFrom { id, resolvedReason, dismissedMeasured }` and the dismissed row stays as the person left it. A cleared subject that comes back opens a new row.
- **Status** (`statusOf`) — resolved + `dismissed:` → `dismissed`; resolved → `resolved`; `changeEventId` → `in_change`; `snoozedUntil` in the future → `snoozed`; else `open`. A snoozed row keeps refreshing.
- **Listeners** — `registerEvaluationListener(fn)` is told after each committed evaluation `{ orgId, projectId, trigger, opened: [row], escalated: [row] }` (escalated = refreshed to `critical`), each row with `snoozed`; notifications (category commercial) are the api track's listener.
- **Trigger 1** — `backend/src/events/exception-triggers.js`, registered in `src/index.js`: `record.changed` for `progress_submission` / `quantity_progress_entry` / `change_order` / `commitment_change_order` approved, `commitment` → executed/closed/void, `ipc_certificate` certified (→ certified/paid), `sub_pay_app` / `direct_cost` approved or status-changed (the ledger's posters — the ledger itself publishes nothing), `boq_item` created/updated/deleted/archived/imported, any `boq_revision` / `schedule_revision` / `budget_line` / `budget_snapshot` event; `approval.decided` for `activity_boq_allocation` (any decision) and `progress_submission` / `change_order` → approved. Each asks `enqueueEvaluation` for the event's own organisation and project: one `exceptions.evaluate` BackgroundJob (`JOB_TYPES.EXCEPTIONS_EVALUATE`, handler `runEvaluationJob`), due 30 s later; a QUEUED job for the project absorbs the request (and two requests at once in one process make one). A RUNNING job does not: it may have read its figures before the change, so one more is queued behind it (at most one ever waits per project).
- **Trigger 2** — `backend/src/jobs/exception-scheduler.js` (in `jobs/schedulers.js`, so leadership-gated): in the hour `EXCEPTIONS_NIGHTLY_HOUR_UTC` (default 7, 02:00 Chicago), once per UTC day, one job per active project (`status active`, not archived; payload `trigger: 'scheduled'`, the event jobs carry `'event'`; its own 15-minute check interval), skipping a project with a queued or running evaluation. It never runs at start-up.
- **Switch** — `EXCEPTIONS_ENGINE_ENABLED` (default true): `false` subscribes nothing, starts no tick, and makes the handler stand down. Test APIs set it false unless the test is about the triggers.
- **Proof** — unit: `services/__tests__/exception-rules.test.js`, `exception-engine.service.test.js`, `events/__tests__/exception-triggers.test.js`, `jobs/__tests__/exception-scheduler.test.js`; live: `services/__live__/pc-7b-exception-engine.live.test.js` (every implemented kind fires on a LiveTest project built through the API — the schedule slip three ways: a replanned early finish, a late actual finish approved through the API, an overdue unfinished activity at the data date; every other table's rows of the organisation — a row matching any scope column it carries, organisation-level notifications, jobs, outbound and audit events included — byte-identical around an evaluation; EV report, register and ledger sums unchanged — delta 0.00; second run moves `lastSeenAt` only; an approved change order with an allocation link clears both quantity rows; a dismissal holds until the slip worsens; a second organisation untouched) and `pc-7b-exception-triggers.live.test.js` (debounced job per project from a real API — an allocation burst, a progress approval and a change-order approval each make exactly ONE job for their project; the progress job opens the two quantity rows and the change-order job clears them; the disabled API queues nothing; the handler's tenancy; the tick limited to LiveTest organisations). Mutation-proved: debounce dropped → 2–4 jobs per project, the flag ignored (or logged but ignored) → the disabled API queues, progress / change-order approval removed from the map → no job, the tick's trigger misspelt → fails.

## 7. Data quality (§129) [D]

Kinds evaluated by the same engine, all `info`/`warning`, never blocking:

| kind | condition (evidence of the gap) |
|---|---|
| `budget_truths_disagree` | register revised total, EV BAC and contract-value waterfall differ beyond tolerance (`budget.service.js:132-148`; `earned-value.service.js:599-609`; `budget-revision.service.js:43-80`) [C] |
| `forecast_without_provenance` | `CostRecord.forecast` set by the 1.1× default or seeded (`cost.service.js:301-307`; `seed.js:1355`) [C] |
| `activity_budget_mismatch` | `Activity.budget`/`CostRecord.budget` ≠ approved allocations (262/272 records have budget 0) [C] |
| `unit_unresolved`, `unit_mismatch` | BOQ unit not in the org master; allocation ↔ method ↔ SOV unit differ |
| `structure_missing` | item/activity without WBS, location or cost code |
| `progress_stale` | no approved progress in N days on an active activity |
| `period_not_locked` | reporting cutoff passed with no `EvPeriodSnapshot` |
| `ev_basis_divergence` | official EV (cutoff) vs summary EV (latest) differ (`earned-value.service.js:96-116` vs `activity-boq-allocation.service.js:311-320`) [C] |
| `committed_definition_mixed` | PO "committed" summary shown next to register committed (`purchase-order.service.js:337-340`) [C] |
| `equipment_cost_unposted` | equipment usage exists but ledger source `equipment` has no poster (`cost-ledger.service.js:32-42`) [C] |
| `orphan_change_link` | `Rfi.changeOrderId`, `BudgetRevision.linkedChangeOrder`, `WorkflowActivityLink.recordId` naming a missing record |
| `readiness_override_active` | PM override on the reporting gate |

`forecast.service.dataQuality` (`:324-331`) is refactored to read these rows so web and mobile show one list.

## 8. Tests

- Live: `pc-7-exceptions.js` — seed an over-installation, assert the exception, raise the change event from it, approve the order with an allocation link, re-run the engine, assert resolution; run twice, assert idempotent (no duplicate open rows).
- Financial tenant test (§122): exceptions for org A never appear under org B; the engine job carries `orgId` and loads the project `where { id, orgId }`.
- §138 scenario end state: every open exception on the certification project is explainable and the summary strip reconciles (delta 0.00).

## 9. PC-7b migrations (for the orchestrator) [C]

Built on branch `pc/ws7b-exceptions-schema` (base 694f248). **Neither migration is applied to the shared database and no Prisma client was regenerated** — the orchestrator applies them through `docs/qa/OCTAPM_MIGRATION_PREFLIGHT.md`. Both SQL bodies are the `prisma migrate diff --from-schema-datamodel <previous> --to-schema-datamodel <next> --script` output kept verbatim under a header comment; the first adds three hand-written statements under a marked line.

**What will be applied, in order:**

| Migration | Contents |
|---|---|
| `20261005060000_project_exceptions` | `CREATE TABLE "ProjectException"` + 7 indexes + 6 keys (§1); `ChangeEvent` + 8 nullable TEXT columns (`rfiId`, `dailyLogId`, `ncrId`, `punchItemId`, `drawingRevisionId`, `submittalId`, `meetingActionItemId`, `exceptionId`), 8 indexes, 8 SET NULL keys; `ChangeOrder` + `locationId`, `wbsNodeId` (nullable TEXT), 2 indexes, 2 SET NULL keys; `Rfi` index on `changeOrderId` + key `Rfi_changeOrderId_fkey` → ChangeOrder SET NULL. 38 diff statements. Hand-written: the partial unique index `ProjectException_open_subject_key`, and the cost-code key re-created as `ON DELETE SET NULL ("costCodeId")`. |
| `20261005060100_record_ref_uniques` | `CREATE UNIQUE INDEX` `ChangeOrder_projectId_ref_key`, `Risk_projectId_ref_key`, `NcrRecord_projectId_ref_key`. 3 diff statements. |

**Pre-existing tables it must prove untouched** (every pre-existing value of every row unchanged, no column removed, every added column nullable): `ChangeEvent`, `ChangeOrder`, `Rfi`, `Risk`, `NcrRecord`, `ProcurementOrder`. No existing column, index, constraint, enum or default is altered; no row is written. Nothing is added to `BudgetLine`, `Activity`, `CostRecord`, `ActivityProgress` or any money table.

**Pre-flight, read-only, right before applying (each must exit 0):**

```
node scripts/project-controls/change-link-census.js          # Rfi.changeOrderId: every value in its own project (else 2 = STOP)
node scripts/project-controls/record-ref-duplicates.js       # 0 duplicate (projectId, ref) on ChangeOrder / Risk / NcrRecord (else 2 = STOP 060100)
```

**Proofs (2026-10-01, each under the cross-wave lock, each on its own throwaway `octapm_migtest_*`, dropped afterwards):**

| Command | Result |
|---|---|
| `node scripts/project-controls/change-link-census.js` (shared, read-only session verified) | 94 RFIs, 10 non-null `changeOrderId`, 10 same-project, 0 cross-project, 0 orphaned → exit 0; 7 change events, none with a source pair |
| `node scripts/project-controls/record-ref-duplicates.js` (shared, read-only) | ChangeOrder 315 rows / 0 groups, Risk 8 / 0, NcrRecord 8 / 0 → exit 0; ProcurementOrder 392 rows / 2 groups (below) |
| `node scripts/db/verify-additive-migration.js --migration 20261005060000_project_exceptions --table ChangeEvent --table ChangeOrder --table Rfi --table Risk --table NcrRecord --table ProcurementOrder --rows 3 --link Rfi.changeOrderId=ChangeOrder` | 136 migrations, then both new ones (the tool applies every folder sorting after the named one); 6 tables × 3 rows, 660 values compared, **0 differences**, exit 0; added columns all nullable and NULL. Without `--link` the run fails on `Rfi_changeOrderId_fkey` (random fixture ids are not change orders) — the reason `--link` exists. |
| `node scripts/db/prove-project-exceptions-constraints.js` | **60/60 ok**, exit 0 (tenant keys, open-row index, every new key's ON DELETE declared and exercised, ref uniques, ProcurementOrder still unconstrained, both migrations additive and confined). Mutation: the partial-index statement removed from the SQL → 5 FAIL, exit 2; restored sha256-identical. |
| `npm run test:live -- src/services/__live__/tenant-constraint-teeth.live.test.js` | shared: 6/6, the PC-7b case reports "not yet applicable"; on a throwaway with every migration applied the PC-7b case passes, and fails with the open-row index dropped |
| `node scripts/enterprise/validate-composite-fks.js --tables ProjectException,ChangeEventLine` | ProjectException `pending` (org key and cost-code key) until applied; afterwards it is checked like every P+O table |
| `prisma migrate status` (shared, afterwards) | both migrations listed as not yet applied; 0 `octapm_migtest_*` databases remain; no `ProjectException` table, no new column |

After applying, re-run `validate-composite-fks.js` (ProjectException no longer pending) and `tenant-constraint-teeth.live.test.js` (the PC-7b case then runs for real).

**Writers of the three refs once 060100 is applied.** `ChangeOrder` and `Risk` only ever store a generated ref. `POST /ncr` also takes a typed `ref`, and the generator (`ReferenceCounter`) reads the register only to seed itself — so a typed `NCR-003` followed by the auto-numbered create that reaches 3 used to save a second `NCR-003` silently, and with the unique would have answered a generic 409 `CONFLICT` to a caller who typed nothing. `ncr.service.js createNcr` now: refuses a typed ref already used in the project with 409 `NCR_REF_TAKEN` (trimmed; also when the unique fires in a race); takes no counter number for a typed create; skips any generated ref already taken (a concurrent P2002 retries with the next one; 500 `NCR_NUMBERING_FAILED` after 50). Proven by `src/services/__live__/pc-7b-ncr-ref-taken.live.test.js` on the shared database (no unique yet: the pre-checks hold it) and with `node scripts/db/live-on-migtest.js src/services/__live__/pc-7b-ncr-ref-taken.live.test.js` (a throwaway with every migration deployed: the unique present). Before the fix: shared 3/3 fail (duplicates saved), throwaway 3/3 fail (409 `CONFLICT`). After: 3/3 on both. Mutations: both pre-checks removed → shared fails, throwaway still passes (the P2002 retry and the `NCR_REF_TAKEN` mapping carry it against the real index); P2002 handling also removed → throwaway fails.

**For the owner — ProcurementOrder duplicate references (read-only, 2026-10-01).** `@@unique([projectId, ref])` is deliberately NOT added to `ProcurementOrder`: two live (projectId, ref) groups exist, both in project `810d2dac-7810-43c7-9b53-6aacc12a1d79`, created ~15 s apart (a double submission):

| ref | id | createdAt |
|---|---|---|
| `PO-20260910090806-A` | `cf46a031-8240-4daa-89da-ef2d961fc4c6` | 2026-09-10T14:29:13.815Z |
| `PO-20260910090806-A` | `6d61ba36-f366-424b-863d-8101d8137092` | 2026-09-10T14:29:28.256Z |
| `PO-20260910090806-B` | `834dbe7b-aede-4765-83ab-6b6e180b84e1` | 2026-09-10T14:29:14.501Z |
| `PO-20260910090806-B` | `15987879-19f9-46d8-8d0b-025cf4c7e6e0` | 2026-09-10T14:29:28.760Z |

Which record keeps each reference (or whether both are voided) is a product decision; once `record-ref-duplicates.js` reports 0 groups for ProcurementOrder its unique can follow in its own migration.
