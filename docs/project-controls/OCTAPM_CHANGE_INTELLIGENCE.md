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

`forecast.service.dataQuality` (`:324-331`) is refactored to read these rows so web and mobile show one list.

## 8. Tests

- Live: `pc-7-exceptions.js` — seed an over-installation, assert the exception, raise the change event from it, approve the order with an allocation link, re-run the engine, assert resolution; run twice, assert idempotent (no duplicate open rows).
- Financial tenant test (§122): exceptions for org A never appear under org B; the engine job carries `orgId` and loads the project `where { id, orgId }`.
- §138 scenario end state: every open exception on the certification project is explainable and the summary strip reconciles (delta 0.00).
