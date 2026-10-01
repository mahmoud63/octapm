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

**As built in PC-7b (API) [C]** — `routes/exceptions.js`, `services/exception.service.js`, the PC-7b exceptions block of `utils/boq-figures.js`:

- `GET /projects/:id/controls/exceptions` (filters `status` — default unresolved, or `open|in_change|snoozed|dismissed|resolved|all` —, `kind`, `severity`, `subject=type:id` / `subjectType`+`subjectId` (an activity or BOQ item also matches the allocations that tie them), `wbsNodeId`, `locationId`, `costCodeId`; cursor `limit`/`cursor`) → `{ data, pagination, withheld? }`; `GET …/:exceptionId`. Status is derived: resolved rows are `dismissed` (`resolvedReason` `dismissed:<reason>`) or `resolved`; unresolved ones are `in_change` while a change event that is not void or closed carries them, else `snoozed` while `snoozedUntil` is ahead, else `open`.
- **Who reads what.** An exception is read through its subject's module (`EXCEPTION_KIND_POLICY`: boq for the quantity kinds, cost for the money kinds, schedule, progress); one whose subject is a BOQ item / allocation / certificate item, or whose figures are the bill's (quantity and allocation kinds, `certified_over_earned`, `schedule_slip_on_mapped_item` — its presence says the activity is mapped —, `forecast_without_provenance`, `activity_budget_mismatch`, `ev_basis_divergence`, the unit kinds), is withheld whole from a member without `boq:read`. The filter is in the query (no short page, no count); every answer to a caller who may not read every kind carries `withheld { reason, modules }`, whether or not a row was left out. An unreadable exception is 404 `EXCEPTION_NOT_FOUND` on every route. A rule's own `module`/`boqDerived` (exception-rules, when merged) only widens this; a kind nobody describes is read as a BOQ-derived money kind. The project history drops an exception's audit events the same way (`withheldExceptionEvent`); their summaries carry no figure.
- **Actions**, each audited (`entityType` `project_exception`, metadata `boqDerived` + `module`): `review` (note), `snooze` (until ≤ 365 days, reason — kept in `dataJson.review`), `dismiss` (reason; `resolvedAt`, `resolvedReason` `dismissed:<reason>`, `dataJson.dismissedFingerprint { measured, limit, unitCode, … }` for the engine) — on `change_event:update` or the subject module's `update`; `raise-change-event` and `associate-change-event` on `change_event:create`. `actions` on each row says what THIS caller may do now.
- **The handoff writes one change event and the exception's `changeEventId`, nothing else.** `GET …/:exceptionId/change-event-prefill` returns the draft; `POST …/raise-change-event` creates it through `change-event.service createChangeEvent` with `links.exceptionId` (status `open` = the draft; origin `exception`, a new value in `ORIGINS`; the activity and location; one line from the subject — budget line + cost code, commitment, activity, cost code of the BOQ item — with the quantity delta (measured − limit) as the line quantity for the quantity kinds; unit cost, ROM and event ROM 0 for the QS). The exception is claimed inside the create's transaction (unresolved and not carried by a live event, else 409 `EXCEPTION_IN_CHANGE`, nothing written). The draft's words carry no figure and, for a BOQ-derived exception, no BOQ item's code or description: the change event is the commercial module's record, read by change-event readers who may read neither the BOQ nor the cost module. **The line quantity of a quantity kind is, by the owner's rule, the BOQ-derived delta — visible to every change-event reader of the project.** `associate-change-event` takes an event of the same project and organisation (else 404 `CHANGE_EVENT_NOT_FOUND`; void/closed 409 `EXCEPTION_CHANGE_EVENT_CLOSED`) and does not set the event's `exceptionId` (that link means "raised from").
- **From a record**: `GET|POST /projects/:id/{rfi|daily-logs|ncr|punch|drawings/sheets/revisions|submittals|meetings/action-items}/:recordId/{change-event-prefill|raise-change-event}` — one shared helper, `change-event.service` `prefillFromRecord` / `raiseFromRecord` (`RECORD_SOURCES`), fills the typed FK (`rfiId`, `dailyLogId`, `ncrId`, `punchItemId`, `drawingRevisionId`, `submittalId`, `meetingActionItemId`), the origin (rfi, daily_log, observation for NCRs and punch items, other for a drawing revision, submittal, meeting) and the title, plus the record's activity / location where it has them (a drawing revision: its sheet's location); amount 0 and no lines — the QS prices it. Seven route pairs rather than one generic `POST /change-events/from-record`: each sits beside its module's routes so its guard is that module's read, as the module's own routes are guarded (the smaller honest change). Needs the record module's read and `change_event:create` (403), and the record's own read rule (404 `CHANGE_EVENT_SOURCE_NOT_FOUND`, as another project's record): an RFI draft only for its creator or manager (`rfi-workflow` `assertDraftVisible`), a punch item / observation within a company party's scope (`punch.service` `visibilityWhere`), a drawing revision that is not published only for a `document_control:update` holder (`routes/sheets.js` `canSeeSuperseded`). The typed links are set only through the handoffs (`createChangeEvent({ links })`), never from a request body; `eventOut.sourceLinks` lists them. **A single typed link also writes the free-text pair** `sourceRecordType` / `sourceRecordId` (`sourcePairOf`): the change-event dialog's "Raised from" line and the forecast's R5-1 trace (`forecast.service` `conversionMap`) read only the pair — without it an RFI's recorded days and the approved order its change event became would both count.
- **Workspace dashboard** `openExceptions { total, bySeverity, inChange, snoozed, basis, withheld? }`: org-wide over the projects the caller can open, each project's readable kinds only (decided per project as its routes decide it). `withheld { reason, modules, projects: [{ projectId, name, reason, modules }] }` names each project where some kinds are not counted for this caller, and why — their access there, never a count and never whether the project has any.
- **Notifications**: `exceptionService.notifyOpened({ orgId, projectId, exceptions })` — the engine's hook (rows or ids it just opened; an empty list notifies nothing), over `notifyOpenedCritical({ orgId, projectId, exceptionIds? })`: open, critical, unsnoozed rows not carried by a live change event; the project's PM and QS assignments, each only of what they may read; category `commercial`, type `project_exception`, priority high; dedupe key `project_exception:<id>:opened:<detectedAt>` — once per opening: a refresh is not re-notified, a snoozed row is told once its snooze has run out, a new opening (a new row, or a reopened one **with a new `detectedAt`** — the engine must set it) is told again. The engine track wires the call after it commits a project's evaluation; until it merges nothing calls it. The notice's link opens the project root (`record-links` has no `project_exception` view yet — for the web track).
- Proven by `src/services/__live__/pc-7b-exceptions-api.live.test.js` (12/12) and `pc-7b-raise-from-record.live.test.js` (7/7: the seven record handoffs with their footprint, both guards, the three record rules, tenancy, the R5-1 trace through the pair, the workspace tile per project, the notice once per opening), with mutations: withholding dropped, a change order created by the handoff, the change_event permission skipped, the readability 404 removed, the tenant scope removed; the RFI-draft, party-scope and unpublished-revision rules, either record-route guard, the pair, the tile's per-project access, its withheld projects, the per-opening dedupe, the PM/QS filter and the per-recipient read — each fails a suite.

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
