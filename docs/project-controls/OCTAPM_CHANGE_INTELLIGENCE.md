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
| `change_order_possible_duplicate` | approved, unarchived change orders on one project with the same description and the same activity impact (added in PC-7b under the R5-1 trace) |

`forecast.service.dataQuality` (`:324-331`) is refactored to read these rows so web and mobile show one list.

**As built in PC-7b (data quality) [C]** — `backend/src/services/exception-rules/data-quality.js`, rules of the one engine (contract of §6: `{ kind, severity, subjectType, module, boqDerived, evaluate }`, plus `label` / `note(count)` for the forecast's words). Every rule is a pure read (proven: every row of the organisation compared before and after), scopes every read by `orgId`, reads its figures through the owning service, writes nothing anywhere and states both figures' basis. **A rising `measured` is the worsening for every kind** — the engine reopens a dismissed row only when `measured` moves past the dismissed value upwards. Counts, days and group sizes rise as the gap grows. The six kinds that compare two owner figures (`budget_truths_disagree`, `forecast_without_provenance`, `activity_budget_mismatch`, `committed_definition_mixed`, `equipment_cost_unposted`, `ev_basis_divergence`) therefore measure the **gap** `|a − b|` against the cent tolerance (`limit` = 0.01). Either figure may be the larger and either may move, so neither stands alone in `measured`: a widening on the side held in `limit` would otherwise leave a dismissed row dismissed (review finding, fixed). Both figures, each with its basis, are in `data.figures`, and `data.higher` names the larger one. The gap is a comparison of the owners' figures, never a figure of its own: nothing reads it as a cost, budget, forecast or EAC. A rule never swallows its owner's failure: a failing EV report makes `budget_truths_disagree` and `ev_basis_divergence` throw. The engine then records the error and keeps the kind's open rows; it does not resolve them as cleared. Thresholds are constants in the file (`THRESHOLDS`), no settings column, and are strict: stale after **more than** 14 days, late after **more than** 7 (the boundaries are pinned by tests).

| kind | sev. | subject | measured / limit (owner) | module / BOQ |
|---|---|---|---|---|
| `budget_truths_disagree` | warning | project + pair (`register_vs_ev_bac`, `register_vs_contract_waterfall`, `ev_bac_vs_contract_waterfall`) | gap between the pair's two figures / 0.01 (the figures are in `data.figures`): register revised total (`budget.service listBudgetLines`), EV BAC at the cutoff (`buildOfficialEvReport totalBudget`, ad hoc at the engine's cutoff), waterfall end (`budget-revision.service listBudgetRevisions currentBudget`); a truth with nothing to state (no line, no report, no contract value) is absent, not 0; tolerance 0.01 (`budget.service TOLERANCE`) | cost / no (project totals are a cost reader's) |
| `forecast_without_provenance` | info | cost record | gap / 0.01 between: NULL source with a stored forecast > 0 — the stored forecast and the R5-2 default it would be now (`utils/cost-forecast defaultForecast` over the approved allocation and actual); `default` below actual — the actual and the stored default | cost / yes (a default is withheld from non-BOQ readers) |
| `activity_budget_mismatch` | info | activity | gap / 0.01 between the stored `CostRecord.budget` (else `Activity.budget`, both in data) and Σ approved allocations (`getApprovedActivityAllocationTotals`) — the two columns every read shows as `budget` and `generatedBudget` | cost / yes (E1) |
| `committed_definition_mixed` | info | project | gap / 0.01 between the PO register's deprecated `summary.committed` alias (= order value, `purchase-order.service listOrders`) and the register's committed cost — only when orders exist | cost / no |
| `equipment_cost_unposted` | warning | daily report | the unposted gap / 0.01 between Σ `ActivityEquipmentUsage.costAmount` and the net Σ ledger `equipment` postings for the report (a reversal lowers the net, so the gap rises). The §7 evidence "no poster" is obsolete: `equipment.service postEquipmentCostImpact` posts on report approval; the gap left is usage before the ledger, or a reversed posting | cost / no |
| `unit_unresolved` | warning | project + `BOQ_UNIT_UNRESOLVED` | the readiness's uncapped count of BOQ rows / 0; the spellings (`UOM_UNRESOLVED`) in data | boq / yes |
| `unit_mismatch` | info | project + `UNIT_MISMATCH_COUNT`; BOQ item | readiness count of allocations measured in another unit / 0; per BOQ item, the quantity columns whose `unitMatch` is false in `quantity-views.service quantityBlocks` (installed entries, commitment SOV lines — received/issued are inventory units by design and not compared) / 0 | boq / yes |
| `structure_missing` | info | project + readiness check (`NO_WBS`, `NO_LOCATIONS`, `NO_PROJECT_COST_CODES`, `BOQ_ITEMS_WITHOUT_WBS`, `ACTIVITIES_WITHOUT_WBS`, `BOQ_ITEMS_WITHOUT_COST_CODE`) | the readiness's uncapped count (1 for "none exists") / 0; its capped record list in data. Rows or activities without a *location* are not a readiness check and are not reported | boq / yes (mixed kind, withheld whole) |
| `progress_stale` | warning | activity | whole days since the latest approved progress (the EV report's own selection, `selectApprovedProgressForCutoff`) / 14 (`forecast.service STALL_DAYS`); begun (approved > 0 % or an actual start) and incomplete activities only — a passed planned start with nothing recorded is the forecast's late-start risk, not a data gap | progress / no |
| `period_not_locked` | warning | reporting period | whole days since the cutoff instant (`listReportingPeriods`) / 7-day grace; open, or locked without a snapshot | cost / no |
| `ev_basis_divergence` | info | project | gap / 0.01 between the allocation summary's latest EV (`buildAllocationSummary earnedValue`) and the official EV of the default period (`buildOfficialEvReport`, the locked snapshot when locked) | cost / yes (the summary is the mapping coverage's) |
| `readiness_override_active` | warning | reporting period | blockers on today's reporting gate / 0, when the latest locked period's snapshot carries `readinessOverride`; blocker codes only | cost / yes (the gate's blockers include the bill's coverage) |
| `orphan_change_link` | warning | budget revision / workflow activity link / RFI | 1 / 0: `BudgetRevision.linkedChangeOrder` naming no order of the project by id or ref; `WorkflowActivityLink.recordId` naming no record of its type in the project; `Rfi.changeOrderId` naming another project's order (the standing form of `change-link-census.js`) | cost / no |
| `change_order_possible_duplicate` | info | change order + the original | group size / 1: approved, unarchived orders with the same trimmed, whitespace-collapsed, case-folded description and the same set of (activity, approved schedule impact days); the earliest approved is the original, each later one a row. Money is not compared. Decision taken under the R5-1 trace (VO-10…VO-20) and reported to the owner: a person reviews it; nothing is merged, archived or changed, and the forecast's impacts stay as they are | cost / no |

**The forecast reads the rows [C].** `buildForecast({ …, access })` lists, after its own notes and in the rules' order, one note per data-quality kind with open rows (not resolved, dismissed, or snoozed at `asOf`; info/warning only): `subject` = the rule's label, `message` = `note(count)` — a count, never a figure. A note of the same kind and subject is listed once. `dataQuality` stays `string[]` and `dataQualityItems` the same list as `{ kind, severity, subject, message }`. Per reader: BOQ-derived kinds need `access.boq`, cost kinds `access.budget` (BOQ or cost read), schedule/progress kinds any forecast reader; with no `access` only the schedule/progress kinds are read. `explain` passes its access; **`GET /forecast` (`routes/forecast.js`) calls `buildForecast` without one today, so it lists only `progress_stale` until the route passes `boqFigureAccess(req)`**. Every figure is byte-identical to the base code's forecast (live suite, before and after the rows exist).

**Dry run [C].** `node scripts/project-controls/exception-dry-run.js [--org <id>] [--all-projects] [--rules-only] [--cutoff <ISO>] [--json <file>]` — the nightly tick's projects (status `active`, not archived; `--all-projects` for every project; the rest are counted as out of scope) of every durable (non-LiveTest) organisation through `evaluateProject({ dryRun: true })`. Per kind it reports the rows it **would open** (the dry run's `change` `open` or `reopen` only) and on how many projects, and apart from them the rows it would refresh, leave unchanged, resolve, or keep suppressed by a dismissal. A row that is already open, or dismissed, is never counted as an opening. One connection opened read-only (`default_transaction_read_only=on` in the URL, `SET SESSION … READ ONLY`, `SHOW transaction_read_only` checked before the run, before each project and after; exit 2 otherwise); exit 3 while the engine is not on the base. `--rules-only` evaluates the data-quality rules directly and reports the rows they **find** (before the engine compares them with stored, dismissed and snoozed rows), never as "would open".

Proof: `src/services/__live__/pc-7b-data-quality.live.test.js` (a gaps and a clean LiveTest project; every rule row by row, tenancy, read-only, the forecast's notes per reader, the dry run; the engine part runs once `exception-engine.service.js` is on the base).

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
