# OctaPM progress measurement (PC-0)

Methods, quantity progress and its authority rule, daily-report contribution, installed/certified/paid, committed and forecast quantity. [C] = confirmed, [D] = decision. Certified EV and cost rules are unchanged.

## 1. As built [C]

- Methods on `ActivityProgressMethod`: `percent`, `quantity`, `weighted_milestone`, `inspection`, `manual` (alias `milestone`) (`progress.service.js:6-13, 43-54`).
- A `ProgressSubmission` is converted to a percentage at submission (`calculateProgressPercent`, `:129-185`: quantity = complete/planned; milestones by weight; inspection passed = 100 / failed = 0) and becomes official only when approval writes an `ActivityProgress` with `approvedAt` (`:602-735`; evidence gate `:631-641`; ITP hold points `:645-660`).
- Official EV reads the latest approved `ActivityProgress` on/before the reporting cutoff (`earned-value.service.js:96-116, 552-575`).
- Local DB: all 64 method rows and 69 submissions are `percent`; 0 rows carry `quantityComplete`.
- No daily log → quantity → progress path: `DailyLog` has no activity/quantity fields (`schema.prisma:6965-7003`); `daily-log.service.js:155-160` carries delivery quantities only. The older `DailyReport.pctProgress → ProgressSubmission(source 'daily_report')` path exists (`daily-report.service.js:380-420, 736-760`); 0 daily reports locally.
- Installed quantity is visible only as `ActivityProgress.quantityComplete` (activity level) and `IpcItem.qty` / `IpcItemProgressLink.certifiedQuantity` at certification (`:2020-2080`).
- Mobile `ProgressSheet` already captures quantity / milestone / inspection inputs (`mobile/src/components/ProgressSheet.tsx`).

## 2. Methods (§78-§80) [D]

The five methods stay. What changes is **where quantity comes from** for the `quantity` method and **what a percentage means** per method:

| Method | Percentage = | Quantity truth | Notes |
|---|---|---|---|
| percent | typed pct (approved) | none | unchanged |
| quantity | installed ÷ planned | planned = Σ approved allocation quantities for the activity (per BOQ item, in the item's unit); installed = Σ approved `QuantityProgressEntry` (§3) | replaces the free `quantityPlanned/quantityComplete` typed on the submission; those columns stay as the frozen values at approval |
| weighted_milestone | Σ weight of achieved milestones | none | unchanged |
| inspection | passed 100 / failed 0 | none | unchanged; ITP hold points as today |
| manual | typed pct with reason | none | unchanged |

A method change on an activity with approved progress is refused — the frozen `pctComplete` history is source data. As built (§3.2): 409 `PROGRESS_METHOD_LOCKED`, except a row naming the method the activity is already measured by, which readiness needs.

## 3. Quantity progress and the authority rule (§79) [D]

New table `QuantityProgressEntry` (**project + organisation**, not "inherit": the ENT-3 composite key
`(projectId, orgId) → Project(id, orgId)` plus `orgId → Organisation`, exactly as the DailyLog sections and
BudgetLine carry it — a row of another organisation's project is refused by PostgreSQL, not by code; see the
PC-6 migration note at the end of this section):

```
id, orgId, projectId, activityId, boqItemId, allocationId?, locationId?, unitCode,
quantity Decimal(18,3), date (calendar date), source (submission | daily_log | manual | import),
submissionId?, dailyLogId?, dailyLogQuantityId?, status (draft | submitted | approved | rejected),
approvedBy/At, rejectedBy/At/Reason, clientRequestId (idempotent), note?, createdBy, createdAt, updatedAt
@@unique([projectId, clientRequestId])
indexes (projectId, activityId, status), (projectId, boqItemId, status), submissionId, dailyLogId,
        dailyLogQuantityId, allocationId, locationId, orgId
```

Foreign-key behaviour as built (each proven on a throwaway database by
`backend/scripts/db/prove-quantity-progress-constraints.js`):

| Relation | ON DELETE | Why |
|---|---|---|
| org, (projectId, orgId) → Project | CASCADE | the tenant owns its rows, as on every project + organisation table |
| activityId → Activity, boqItemId → BoqItem | RESTRICT | an entry is source data for an official figure (installed = Σ approved entries); it must not vanish with a hard delete. Same as `ActivityProgress → Activity`; the activity delete already answers P2003 with 409 `ACTIVITY_IN_USE`, and the service wave must count entries among the keepers of an activity and of a BOQ item |
| allocationId → ActivityBoqAllocation | SET NULL | the mapping row is replaceable (rejected, superseded); activity + item is the truth, the allocation a hint |
| locationId → Location | SET NULL | as `ProgressSubmission.location` |
| submissionId → ProgressSubmission | SET NULL | as `ActivityProgress.submission`: the entry outlives the bundle that approved it |
| dailyLogId → DailyLog, dailyLogQuantityId → DailyLogQuantity | SET NULL | an approved entry is progress, not a daily-log line; removing the log must not remove approved progress (`source` + `date` keep the provenance) |

**Authority rule:** the installed quantity of a BOQ item on an activity is the Σ of **approved** entries; only approval by the progress approvers (same roles and gates as `ProgressSubmission`, `progress.service.js:602-735`) makes an entry official. A daily log, a site capture or an import never changes progress by itself; it creates `draft`/`submitted` entries. Approving a quantity-method `ProgressSubmission` approves the entries it bundles and writes the resulting `ActivityProgress.pctComplete` — so the EV pipeline is untouched: EV still reads `ActivityProgress`.

Constraints: Σ approved quantity per (item, activity) ≤ allocation quantity, else an **overrun exception** (change doc §1) — a warning, not a block, because over-installation is real information; certification remains capped separately (`ipc.service.js:183-237`). Unit is the item's `unitCode`; an entry in another unit is refused unless a UoM conversion exists in the org master.

**Corrections are never negative entries.** `quantity >= 0` is a CHECK constraint on both tables
(`QuantityProgressEntry_quantity_nonnegative`, `DailyLogQuantity_quantity_nonnegative`): a correction is a
rejection plus a new entry. Installed is Σ approved entries, so a negative row would let an "approval" lower an
official figure with no rejection trail; the rejection path (`rejectedBy/At/Reason`) is the only way an entered
quantity stops counting. The `status` and `source` vocabularies above are CHECKs too
(`QuantityProgressEntry_status_check`, `QuantityProgressEntry_source_check`), as `ProgressSubmission` and
`ActivityBoqAllocation` carry theirs; `DailyLogQuantity.status` is deliberately unconstrained, like its six
siblings (`daily-log.service` drives it).

### 3.1 The entries service, as shipped (PC-6 core, 2026-09-30) [C]

`backend/src/services/quantity-progress.service.js` and `routes/quantity-progress.js` (mounted at
`/projects/:projectId/quantity-progress`; OpenAPI tag Progress, operationIds `listQuantityProgressEntries`,
`createQuantityProgressEntries`, `getQuantityProgressEntry`, `updateQuantityProgressEntry`,
`deleteQuantityProgressEntry`, `submitQuantityProgressEntry`) are the pending layer of installed quantity:

- **Create** (`POST`, progress `submission.submit`): one entry or `{ entries: [...] }` (≤ 200), each `activityId,
  boqItemId, quantity, date` plus `unit`/`unitCode`, `allocationId`, `locationId`, `note`, `clientRequestId`,
  `status` (`draft`, the default, or `submitted`) and `source` (`manual` or `import`; `daily_log` and
  `submission` are the daily-log service's and the submission bundler's own). The site-engineer assignment rule is
  `progress.service assertProgressSubmitAllowed` — the same call the submission makes. 201 when anything was
  recorded, 200 when every entry was a replay.
- **The unit rule**: an entry is stored under the item's `unitCode` (or, for an item nobody's master recognises,
  its typed `unit`). A typed unit must resolve, through `uom.service loadUnitIndex / normaliseWith` (the
  organisation's `UnitOfMeasure` codes and `aliasesJson`), to that code; anything else is 400
  `QUANTITY_UNIT_MISMATCH` with `{ unit, unitCode, itemUnit, itemUnitCode }`. No conversion table exists, so none is
  applied — "refused unless a UoM conversion exists" above reads, as built, "refused unless it is an alias".
- **Replay**: `clientRequestId` is unique per project (`@@unique([projectId, clientRequestId])`). The service answers
  a seen key with the entry it made (`replayed: true`); a race that reaches the index is a P2002 answered by running
  once more, which finds the winner's row. A batch's top-level key is suffixed `:<index>` per entry.
- **Quantities are Decimal(18,3)**: parsed, summed and compared as `Prisma.Decimal` at three places; `quantity >= 0`
  is refused in code (400 `QUANTITY_NEGATIVE`) before the CHECK constraint sees it.
- **Over-allocation is a warning, never a block**: the write answers `warnings[]` with `QUANTITY_OVER_ALLOCATION`
  (approved installed + this entry > Σ approved, active allocation quantity of the item on the activity — the raw
  comparison, with the figures) or `QUANTITY_NO_APPROVED_ALLOCATION`. No `ProjectException` row (PC-7b).
- **Patch / delete** (progress `submission.submit`): a draft or submitted entry's quantity, unit, date, location,
  allocation or note, by its creator or by anyone holding `submission.approve` (403 `QUANTITY_ENTRY_FORBIDDEN`).
  An approved or rejected entry is history (409 `QUANTITY_ENTRY_LOCKED`); an entry bundled into a submission that is
  not rejected is the submission's figure (409 `QUANTITY_ENTRY_BUNDLED`); activity, item and status are never edited
  (400 `QUANTITY_ENTRY_IMMUTABLE_FIELD`). **Submit** moves draft → submitted, idempotently (409
  `QUANTITY_ENTRY_NOT_SUBMITTABLE` for approved/rejected). Nothing here approves: no code path in this service
  writes `status = 'approved'` or an `ActivityProgress` row.
- **PROGRESS SOURCE provenance** on every entry: `provenance { source, recordedBy, recordedAt, submissionId,
  dailyLogId, dailyLogQuantityId, official, approvedBy, approvedAt, rejectedBy, rejectedAt }`. Audit events carry
  `entityType 'quantity_progress_entry'` (created / updated / status_changed / deleted) through
  `audit.service.recordEvent` inside the write's transaction.
- **BOQ withholding** (binding rule): every route answer goes through `utils/boq-figures`
  `withheldQuantityEntry / withheldQuantityEntries / withheldQuantityEntryResult`. A member without `boq:read` is
  given the entry's id, activity, status, date, provenance and `boqWithheld: { keys, reason }`, never `quantity`,
  `unitCode`, `boqItemId`, `boqItem` or `allocationId`; a warning keeps its code and activity only.
- **Read helpers for the other waves** (service-level, each taking `cutoffDate` as a Date instant or a calendar date
  read as the end of that day in the project's reporting zone, exactly as EV does): `installedByActivity` → Map
  activityId → `{ installed: [{ boqItemId, unitCode, quantity, entries }], asOf, lastApprovedAt }` (Σ approved
  entries with `approvedAt ≤ cutoff`, one line per item, never summed across items or units);
  `installedByBoqItem` → Map boqItemId → `{ quantity, unitCode, entries, lastApprovedAt, asOf }` (an item whose
  approved entries carry two units answers `quantity: null` with `units[]` and a `notAvailable` reason);
  `plannedQuantityFor` → `{ planned, unitCode, basis: 'method_config' | 'approved_allocations' | 'none' }` — the
  typed `ActivityProgressMethod.plannedQuantity` when > 0, else Σ approved, active allocation quantity when every
  allocation is in one unit, else none with the reason. A client's `quantityPlanned` never comes into it.
- **Proof**: `backend/src/services/__live__/pc-6-quantity-entries.live.test.js` (15 cases in a LiveTest
  organisation: create in an alias unit, replay by the service and refusal by the index, batch replay, the refusals,
  the assignment rule, both warnings, the list filters, patch/delete/submit authority, a cost controller's read-only
  403s, the other organisation's 404 on every route and in the service, the template-withheld site engineer, the read
  helpers at a Chicago cutoff, and zero `ActivityProgress` rows with the EV report byte-identical throughout) and
  `__tests__/quantity-progress.service.test.js`, `utils/__tests__/boq-figures.quantity-entries.test.js`.
  Mutation-proven: the replay handling, the unit rule, the withholding, the tenant scope and the assignment rule
  each dropped in turn fail the suite.

### 3.2 Approval bundling in the one writer, as shipped (PC-6 core, 2026-09-30) [C]

`progress.service.js` is still the one writer of `ActivityProgress`; a quantity-method `ProgressSubmission` now
bundles entries, and approving it is what approves them:

- **Bundling** (`POST /activities/{id}/progress`, also `bulk-progress`): `entryIds[]` names entries, each on this
  activity (400 `QUANTITY_ENTRY_ACTIVITY_MISMATCH`), draft or submitted (409 `QUANTITY_ENTRY_LOCKED`), held by no
  open submission (409 `QUANTITY_ENTRY_BUNDLED` — an entry belongs to at most one draft/submitted submission);
  `bundleSubmittedThrough` (a day) adds every submitted entry of the activity dated on or before it that no open
  submission holds. Either with nothing free is 400 `QUANTITY_NO_ENTRIES_TO_BUNDLE`; either on a percent,
  milestone, inspection or manual submission is 400 `QUANTITY_BUNDLE_METHOD_MISMATCH` (those methods are
  untouched). The entries take the submission's id and, unless the submission is a draft, `status 'submitted'`.
- **Derived figures, never typed over the mapping.** For every quantity submission: planned = the typed
  `ActivityProgressMethod.plannedQuantity` (basis `method_config`), else Σ approved, active allocation quantity of
  the activity (basis `approved_allocations`; `plannedQuantityFor`), else — only then — the client's
  `quantityPlanned` (basis `client`, the pre-PC-6 shape; without one 400 `PLANNED_QUANTITY_REQUIRED` as before).
  A client-sent `quantityPlanned` never overrides a typed or allocation-derived figure; the answer's transient
  `quantity` block says which basis applied and `clientQuantityPlannedIgnored`. With a bundle, installed = Σ the
  bundled entries + Σ entries already approved on the activity (basis `approved_entries`), in one unit — the
  planned figure's (400 `QUANTITY_UNIT_MISMATCH` otherwise; nothing is converted or summed across units); without
  one, the client's typed `quantityComplete` (basis `client`). `pctComplete = installed ÷ planned`, clamped 0..100.
  The columns `quantityComplete / quantityPlanned / quantityUnit` hold the frozen values.
- **Approve** (`approveProgressSubmissionWithClient`; gates unchanged — evidence, open ITP hold points, the
  review authority, D1 `approvedAt`): the figures are read again at this instant (another bundle may have been
  approved, a planned quantity typed, since the submission was made), the bundled entries are set `approved`
  (`approvedBy/approvedAt` = the row's) in the same transaction, the submission's frozen columns are updated to
  what was approved, and exactly ONE new `ActivityProgress` row is written; no earlier approved row is touched
  (proven byte-identical). A quantity submission typed the old way (no entries) is approved as it stands. Audit:
  the submission's `approved` event carries `quantityInstalled, quantityPlanned, plannedBasis, installedBasis,
  quantityEntries, approvedProgressId`; each entry gets its own `approved` event (`entityType
  quantity_progress_entry`), all through `audit.service.recordEvent` — the existing record.changed path, no new
  event constant.
- **Reject**: the bundled entries are set `rejected` (`rejectedBy/rejectedAt/rejectionReason` = the submission's
  reason) with their own `rejected` events; nothing official is written; a rejected entry is history (a
  correction is a new entry).
- **PROGRESS SOURCE provenance**, additive beside the string fields: every serialised submission carries
  `quantityEntryIds[]` and `progressSource { source, submissionId, dailyLogId, dailyReportId, importDocumentId,
  submittedBy, submittedAt, approvedBy, approvedAt, entries }`; the activity payload carries `progressSource` for
  its official figure beside `approvedProgressSource` (the `ActivityProgress` row plus the submission it came
  from). `importDocumentId` is carried for the shape and is null: no column links a submission to the import
  document (the import names itself in `source` and `notes`).
- **The method lock** (`PUT /activities/{id}/progress-method`): an activity with approved progress keeps the
  method it is measured by — its configured method, else the method its latest official figure was approved under
  (aliases normalised), else `percent` — and naming another is 409 `PROGRESS_METHOD_LOCKED` with
  `{ effectiveMethod, effectiveMethodBasis, requestedMethod, approvedProgressCount }`. A row naming that same
  method is still written (its planned quantity, unit and flags with it), which is how an activity measured under
  the default clears `PROGRESS_METHODS_INCOMPLETE` in setup readiness (proven live both ways).
- **BOQ withholding** (binding rule): a submission's `quantityComplete / quantityPlanned / quantityUnit` and the
  transient `quantity` block are allocation- and item-derived, so `utils/boq-figures withheldProgressSubmission(s)`
  omits them for a caller who may not read the BOQ (`boqWithheld`) on every submission answer (submit, approve,
  reject, the two lists, the activity's `pendingProgress`); the percentage, status, method and provenance stay.
- **Proof**: `backend/src/services/__live__/pc-6-quantity-approval.live.test.js` (derived figures with the client's
  ignored; the bundle's refusals; a submit-only person's 403; approve → one row at installed ÷ planned, entries
  approved in the same transaction, provenance on the submission, the activity and the EV report's row; a second
  bundle by date leaving the first row byte-identical; reject; the evidence gate holding a bundle; the typed
  method-configuration basis; the method lock both ways with readiness; the tenant 404) and
  `__tests__/progress.service.quantity-bundle.test.js`.

## 4. Daily-report contribution (§81) [D]

`DailyLog` gains a section table `DailyLogQuantity` (same columns, status semantics, `partyId` column, composite tenant key and indexes as the six `DailyLog*` sections — the ENT-3 versions of them already carry `dailyLog / org / project` relations — and **with** relations to what it names): `dailyLogId, projectId, orgId, partyId?, activityId, boqItemId, allocationId?, locationId?, quantity Decimal(18,3), unitCode, notes, status, createdBy, submittedAt, reviewedBy/At, rejectionReason, clientRequestId, sortOrder`. As built, the row carries `allocationId?` too (the approved allocation the site picked the item from, a hint that SET NULLs if the mapping row goes) and names its text column `notes` like its six siblings, so the section registry's generic handling applies. Its `status` is the section row's own review state, never progress. ON DELETE: `dailyLog / org / project` CASCADE like the siblings; `activityId / boqItemId` RESTRICT (a signed site record on the log's PDF is not emptied by a hard delete); `allocationId / locationId` SET NULL. Submitting the daily log creates matching `QuantityProgressEntry` rows with `source='daily_log'`, `status='submitted'`, linked by `dailyLogQuantityId`; editing the daily log before approval updates them; approval is done on the Progress screen (or in bulk from the daily log by an approver). The legacy `DailyReport → ProgressSubmission(pct)` path stays for `percent`-method activities.

**PC-6 migration note.** `backend/prisma/migrations/20261005050000_quantity_progress/migration.sql` is the
`prisma migrate diff` from the schema at `07c64c1` to the PC-6 schema, kept byte-identical: two `CREATE TABLE`
(`QuantityProgressEntry`, `DailyLogQuantity`), fifteen `CREATE INDEX` (two of them unique, the
`(projectId, clientRequestId)` replay keys) and sixteen `ADD CONSTRAINT` foreign keys — 33 statements — followed,
under a marked comment, by four hand-written `ADD CONSTRAINT … CHECK` statements (§3: the two `quantity >= 0`, the
`status` and `source` vocabularies; Prisma's datamodel cannot express them, exactly as migrations `20260608170000`
and `20260609170000` wrote their kin) — 37 statements, all on the two new tables. It adds no column, index,
constraint, enum or default to any existing table: nothing "installed" lands on `BoqItem`, `Activity`,
`ActivityBoqAllocation`, `ActivityProgress`, `ProgressSubmission`, `IpcItem` or `StockTransaction`, so the five
quantities stay separate and EV's inputs are untouched. The orchestrator applies it through
`docs/qa/OCTAPM_MIGRATION_PREFLIGHT.md` and must prove these pre-existing tables untouched before and after:
`DailyLog`, `DailyLogNote` (the sibling shape), `ProgressSubmission`, `ActivityProgress` (EV's input),
`ActivityBoqAllocation` (planned quantity's source) — `node scripts/db/verify-additive-migration.js --migration
20261005050000_quantity_progress --table DailyLog --table DailyLogNote --table ProgressSubmission --table
ActivityProgress --table ActivityBoqAllocation --rows 3` gave exit 0 and `0 difference(s)` on a throwaway database,
and `node scripts/db/prove-quantity-progress-constraints.js` proved the tenant key, the replay key, the four CHECKs
(a negative quantity, a bad status and a bad source refused with 23514; every listed value admitted; exactly these
four declared) and every ON DELETE above (55 checks; dropping one CHECK from the SQL fails it). After the migration is applied and the Prisma client regenerated:
`scripts/enterprise/validate-composite-fks.js` covers both tables (it reads project + org tables from the database
and lists the two in its org-side set; until then it reports them as pending) and the
`tenant-constraint-teeth.live.test.js` PC-6 case runs its raw-SQL assertions (until then it reports itself as not yet
applicable). The financial snapshot and reconciliation delta must read 0.00 — the migration writes no row.

Mobile: the daily log form gets a "Quantities installed" section using the existing activity + location pickers; offline via the outbox with `clientRequestId` (already the pattern for the six sections).

## 5. Installed / certified / paid (§82) [D]

Per BOQ item (and per activity, location, WBS group), three quantity columns with three different truths:

| Column | Truth | Source of the figure | Money twin |
|---|---|---|---|
| **Installed** | derived | Σ approved `QuantityProgressEntry` | earned value (approved allocation × pct) — note: for `percent` activities installed quantity is *not* available and the column shows "—", never pct × qty |
| **Certified** | source | Σ `IpcItemProgressLink.certifiedQuantity` on certified/paid certificates (`ipc.service.js:1226-1400`) — client side; Σ `SubPayAppLine.thisPeriodQty` cumulative on certified pay apps — subcontractor side | certified value (IPC) / subcontract cost (ledger, `sub-pay-app.service.js:650-705`) |
| **Paid** | projection | certified quantity × (Σ `IpcPayment` ÷ certificate total) pro-rata per certificate; subcontractor side likewise from `SubPayAppPayment` | paid amount (cash flow, `cash-flow.service.js:93-195`) |

Rule: installed ≥ certified is expected; certified > installed is an exception (over-certification — already tracked as `overCertificationAmount` on the certificate [C], now also visible in quantity).

## 6. Committed and forecast quantity (§83-§84) [D]

- **Committed quantity** (derived): Σ `CommitmentSovLine.quantity` for lines naming the BOQ item on executed/closed commitments, plus approved `CommitmentChangeOrder` line changes — the same recognition rule as committed cost (`commitment.service.js:29, 424-483`) [C]. `ProcurementOrder` quantities are shown as "ordered (not committed)" (three-truths §3.3).
- **Forecast quantity** (projection): `max(BOQ qty, installed + remaining)` where `remaining = planned − installed` for quantity-method activities, and BOQ qty otherwise; basis label `remaining_from_installed | boq_quantity`. A typed forecast quantity (QS override, with reason) is allowed and labelled `typed`. Never feeds any money figure; EAC stays `revised BAC / CPI` and the other two labelled projections (`earned-value.service.js:146-172`; `cost.service.js:222-282`; `forecast.service.js:312-316`) [C].

## 7. What is not changed

Certified EV selection (`approvedAt ≤ cutoff`), AC from `CostRecord.actual ≤ cutoff`, PV from approved cost loadings, the S-curve builder (its flat-EV behaviour, `earned-value.service.js:368-395` [C], is a reporting gap fixed by locking `EvPeriodSnapshot` per period — PC-6 makes period locking part of the reporting flow; the formula is untouched).

## 8. Tests

- Live: `pc-5-quantity-progress.js` — quantity-method activity, daily log with quantities → entries submitted → approval → `ActivityProgress.pctComplete` equals installed ÷ planned → EV report matches; reject an entry → pct recomputed; same `clientRequestId` twice → one entry.
- Financial tenant test (§122) reuses the same script under two orgs and asserts org B's EV and ledger totals are byte-identical before and after org A's postings.
- Playwright: mobile web (`:8081`) daily-log quantities section offline → outbox → replay → entry visible on web Progress screen.

## 9. Import authority (PC-6, as shipped 2026-09-30) [C]

`POST /projects/:id/import/progress` used to write approved `ActivityProgress` rows directly (`createMany`, `approvedBy 'import'`), gated only by progress `submission.submit` — a site or quality engineer could publish official progress and move EV by upload. Now (`import.service.js importProgress`, `routes/import.js`):

- Every matched percentage is a `ProgressSubmission` (`source 'import'`, `method 'percent'`) made through `progress.service createProgressSubmission`, in the importer's name. The writer's assignment rule applies (an unassigned site engineer's row is `refused` with `ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED`); a row on an activity that requires evidence is kept as a `draft` (the writer's own allowance), never submitted without it.
- **Authority is the importer's own**, decided by `hasPermission(req, 'progress', 'approve', { transition: 'submission.approve' })` — the same engine and the same answer as the approve route (template, project role, party profile, API-key scope). Without it every row is `submitted` and nothing is official (`authority.outcome = 'submitted'`). With it each row is submitted and then approved through `approveProgressSubmissionWithClient`, so the evidence gate, the open ITP hold points, the audit trail (`created` + `approved`, actor = importer) and the domain event are the ordinary ones; a row a gate refuses stays pending with the gate's reason (`status 'pending'`, `reason { code, message }`) and never fails the file.
- Nothing in the import writes `ActivityProgress`; an approved row is never rewritten — a later approval is a new row, exactly as the writer does. The file's figure is a percentage, so the submission names `percent`; on an activity measured another way the writer records the method the submission names (it does not refuse), and the row carries `methodMismatch: true` for the reviewer.
- **Only a figure that moves the official figure is written** (review finding, 2026-09-30). The current official figure is the latest approved `ActivityProgress` percentage, and **0 for an activity with no approved progress**; a row at that figure is `unchanged` and creates nothing — so a full-programme P6 export, which names every activity, does not put one 0% submission per unstarted activity in the approval queue (nor, for a PM, one approved 0% row plus two audit events per activity). A row the file names **without a percentage** (empty `phys_complete_pct`; no `PhysicalPercentComplete`/`PercentComplete` in P6 XML — a P6 status is not a percentage) is `skipped` with `PROGRESS_PERCENT_MISSING`, never a submission; the parsers say whether one was stated (`physCompleteStated`) and the schedule import still reads such a row as 0. The dry run classifies the same way, and the answer counts `unchanged` and `skipped`.
- A figure already waiting in an open import submission: for a submit-only person, or when the open row is a `draft` (it waits for evidence, not approval), the row is `already_pending` (`waitingStatus` says where it waits; the reason says the same) and nothing is written. **An importer with approval authority whose figure already waits in someone else's `submitted` import submission approves that submission** through `approveProgressSubmissionWithClient` with its gates — the same figure under the approver's own authority — so the submission's own row becomes `approved`, one `ActivityProgress` row is written with its id, and the audit `approved` event names the approver (the `created` event keeps its submitter); the row answers `approvesPending: true` with that `submissionId`. A gate still applies: an open ITP hold point or missing evidence leaves it `pending` with the reason, no second submission. When the approver's figure **differs** from a pending `submitted` import row, the import creates and approves a new submission as for any row. Either way, **every** other older `submitted` import row on the activity at another figure — there may be several (a site engineer's 30 then 32) — is left exactly as the writer leaves a superseded manual submission — untouched, still in the queue (the activity's `progressApprovalStatus` still says `submitted`); the written row carries `superseded [{ submissionId, pctComplete }, …]` (newest first; also on a row that approved an already-pending submission, since the approver is the one person the report exists for) and the answer lists each as a `supersededPendingSubmissions` entry (`supersededPending` counts submissions, not rows; "superseded pending" in the message) so the approver can reject them from the queue (follow-up review findings, 2026-09-30: the approving row said nothing and only the newest older row was named). The import never rejects or deletes a submission. The writer keeps no idempotency key, so any other figure is written again.
- `?dryRun=true` reports the per-row outcome for this person and stores nothing — no document, no submission. The outcome is read from the writer's own rules, not assumed: the assignment assertion the writer runs, the activity's evidence requirement, and (for an approver) the ITP hold points the approval gate reads. A row those would refuse is previewed `refuse`, one a gate would hold `hold` (kept as a draft for a submit-only person, left pending for an approver), each with the reason; `wouldSubmit` / `wouldApprove` count only rows that will be written that way, `wouldHold` / `wouldRefuse` the rest. The import itself still trusts the writer for every row. The web dialog previews first and repeats the server's headline; its headline counts only what is in an approver's queue as "submitted for approval" and says drafts, refusals and skipped rows separately; the grid shows the unchanged, skipped and superseded-pending counts, a note names the older pending figures left in the queue, and a row approved as it already stood in the queue says so; unchanged rows are counted, not listed. After a real import it refreshes the same queries the progress tab does after an approval (EV report, audit history, readiness). Mobile does not call this endpoint.
- OpenAPI: `ProgressImportResponse` / `ProgressImportRow` (`skipped`, `supersededPending`, `supersededPendingSubmissions`, `approvesPending`, `superseded`; `pctComplete` null on a skipped row). Live proof: `backend/src/services/__live__/pc-6-import-authority.live.test.js` — including the full-programme 0% file that writes nothing for either person and leaves the EV report byte-identical, the skipped row, the approver approving the site engineer's own pending row (and the hold point still holding it), the differing figure that leaves the older row byte-identical and reported, the approver's identical figure that approves the pending row and still names the other older figure in the queue, and an activity with three older figures waiting (40, 85, 90) all reported one entry each by the site engineer's and the PM's imports.

**Writers of `ActivityProgress` (census at 07c64c1):** `progress.service.js approveProgressSubmissionWithClient` (the one writer) and `import.service.js importProgress` (the defect above, removed). The only other writes are `prisma/seed.js upsertProgressAndCost` (a seed, not a request path) and the live tests' own fixtures. No raw SQL, no nested write and no delete path exists in `backend/src` or `backend/scripts`; `DELETE /activities/:id` refuses an activity that progress keeps (409 `ACTIVITY_IN_USE`).
