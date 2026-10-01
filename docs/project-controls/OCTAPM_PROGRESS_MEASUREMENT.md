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
- **Quantities are Decimal(18,3)**: parsed, summed and compared as `Prisma.Decimal` at three places; a negative
  quantity is refused in code (400 `QUANTITY_NEGATIVE`) before the CHECK constraint sees it. **A zero quantity is
  refused too** (integration decision, 2026-10-01, reported to the owner): 400 `QUANTITY_INVALID` — "A quantity must
  be greater than zero; record nothing for no work" — on create and on edit (`assertPositiveQuantity`, after the
  three-place scale, so 0.0004 is zero), and in the daily log's quantities section. The CHECK still admits 0 (no
  migration in this wave): the rule is the service's, and the daily log's own minting carries a row recorded before
  it. A zero entry would otherwise be approved, counted among the entries behind an official figure and printed as a
  quantity installed. Proven live in both suites and mutation-proven.
- **Over-allocation is a warning, never a block**: the write answers `warnings[]` with `QUANTITY_OVER_ALLOCATION`
  (approved installed + this entry > Σ approved, active allocation quantity of the item on the activity — the raw
  comparison, with the figures). No `ProjectException` row (PC-7b). **An unmapped pairing is refused** (integration
  fix, 2026-10-01): the route records against an item the activity has an approved, active allocation of — the
  daily log's section rule — else 400 `QUANTITY_ITEM_NOT_ALLOCATED` (the finding: a pending manual entry on an item
  with no approved allocation to the activity was accepted and reached the approver with no planned figure behind
  it). `QUANTITY_NO_APPROVED_ALLOCATION` remains a warning only for an entry whose mapping was retired after it was
  recorded (an edit, the daily log's own minting). Proven live (`pc-6-quantity-entries`), mutation-proven.
- **A row the entries name is kept** (integration fix, 2026-10-01): `DELETE /boq/items/{id}` counts its keepers —
  `BOQ_ITEM_KEEPERS` in `boq.service`: IPC lines, quantity progress entries, daily-log quantity rows (the three
  RESTRICT relations) — and answers 409 `BOQ_ITEM_IN_USE` naming them, before the delete and under the row's lock;
  a RESTRICT the list does not know (Prisma P2003) is answered the same with the constraint's name, never a 500 with
  the invocation text. `activity.service ACTIVITY_KEEPERS` counts `QuantityProgressEntry` and `DailyLogQuantity`
  too (409 `ACTIVITY_IN_USE`). Proven live and by unit (`boq.service.test`, `activity-delete.service.test`).
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
  (proven byte-identical). A quantity submission typed the old way (no entries) is approved as it stands.
  **Approvals are serialised per activity** (review fix, 2026-10-01): the writer holds the activity's row
  (`SELECT … FOR UPDATE`, the pattern `boq.service` uses for an item) and reads the submission again under the
  hold before deriving, so two bundles approved at once commit one after the other and the later official row
  carries Σ approved entries — never less than its own source data (proven live: 10 and 20 approved with
  `Promise.all` on 100 of 160 → the later row 130, EV 81.25; without the hold the later row read 120). The
  same submission approved twice at once answers idempotently. **When still nothing is typed and nothing is
  mapped at approval**, the planned figure the submission was put forward with (its frozen `quantityPlanned`,
  basis `submission`) stands, so a bundle a client planned is approvable (review fix: before it the approval
  re-derived with an empty payload, answered 400 `PLANNED_QUANTITY_REQUIRED` and left the entries stuck in a
  submission that was neither approvable nor editable); a typed or mapped figure found at approval still wins.
  Audit:
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
- **The legacy typed-quantity floor** (integration fix, 2026-10-01; owner rule: an official figure never regresses by the
  act of deriving). Finding: on an activity approved the legacy way — a typed `quantityComplete`, no entries behind it
  — the first bundle approved after PC-6 derived installed = Σ approved entries + the bundle and discarded the official
  figure (60% → 10%). Now a bundle derives installed = **max(Σ approved entries, the latest official installed
  figure)** + the bundle (`legacyInstalledFloor`: the latest approved `ActivityProgress.quantityComplete`; one in
  another unit is not a floor — reported `legacyFloorSkipped`, nothing converted). When the floor applied the basis is
  `legacy_typed_floor` with `legacyFloor { quantity, unitCode, progressId, approvedAt, note }`, the new official row
  carries the sentence "Legacy typed quantity carried as the floor of the installed figure (PC-6)" as its note (a
  sentence, no figure — a note is progress data every reader sees), and `progressSource.installedBasis` /
  `legacyFloor: true` read it from the row. In the ordinary case Σ approved entries ≥ the latest official figure and
  the rule is the one shipped. Decision for the owner: the frozen basis lives in the row's `notes` (no column records
  a derivation basis; the audit `approved` event carries the full `legacyFloor` block).
- **A typed quantityComplete is still accepted — once** (the legacy shape; what the mobile ProgressSheet sends):
  while the activity has **no quantity entry at all**. Its approval mints ONE approved `QuantityProgressEntry`
  (`source 'submission'`, `clientRequestId 'submission:<id>'`, recorded by the submitter, approved by the approver at
  the row's instant, the typed figure as a **delta over the official floor** — `mintTypedQuantityEntry`) when the
  activity has a single allocated BOQ item in that unit, so the activity has one truth of installed quantity from
  then on and the next bundle adds to it (`quantity.mintedEntry`). Nothing is minted when the delta is zero or
  negative (the approved row stands as approved; the floor rule keeps the figure from regressing by derivation),
  when the activity has several allocated items or none (an entry names one item; an activity-level figure cannot
  be attributed — `quantity.mintSkipped` says so and the floor carries it) or when the typed unit is not the
  item's. Once entries exist a typed figure is 409 `QUANTITY_ENTRIES_REQUIRED` `{ activityId, entries }` — the
  unsafe case shown: a typed activity-level figure beside per-item entries would be a second truth. Proven live
  (`pc-6-method-authority`: the seeded 60-of-100 legacy row + a 10 bundle → 70, the next → 75, the legacy row
  byte-identical, the note and PROGRESS SOURCE; the kerb's typed 20 minted as one approved entry in the ledger with
  its provenance and the activity's installed figure reading it, then 409; a typed 50 below an official 60 minting
  nothing and standing as the next floor) and mutation-proven (the floor removed → the regression reproduces; the
  minting removed → fails).
- **The submission's method is the activity's** (integration fix, 2026-10-01; owner rule: respect the activity's progress
  method). `progress.service resolveSubmissionMethod`, in `buildSubmissionData`, so every path — `POST
  /activities/{id}/progress`, `bulk-progress`, the daily report's legacy linked progress and the import — is under it:
  with a configured `ActivityProgressMethod` row the submission takes that method; a client naming another (an alias
  normalised first) is 409 `PROGRESS_METHOD_MISMATCH` with `{ activityId, effectiveMethod, effectiveMethodBasis:
  'method_config', requestedMethod }` — never silently coerced, so a `{ method: 'percent', pctComplete: 90 }` typed
  against a quantity-measured activity cannot bypass the derivation and reach the approver as a 90% row with zero
  entries behind it (the review finding). Without a configured row the client's method is accepted as before
  (default `percent`), which is also why the daily report's percent path still serves an unconfigured activity.
  Proven live (`pc-6-method-authority.live.test.js`: every path refused, footprint and EV byte-identical; no method
  named → the activity's, derived; the unconfigured wall takes the client's) and mutation-proven (coercing silently
  and accepting the client's method each fail the suite).
- **The rule holds in the one writer too** (verification fix, 2026-10-01). Asked only when a submission is made, the
  rule could be passed by ordering: a percent submission put forward while the activity was unconfigured stayed
  approvable after the planner configured it as quantity (the method lock below reads approved progress only), the
  approver made a 90% row with zero entries official, and the first bundle afterwards derived from its entries — the
  official figure regressed 90% → 10% by the act of deriving. `approveProgressSubmissionWithClient` now asks again
  (`assertSubmissionMethodStands`): a submission whose method is not the activity's **configured** method is 409
  `PROGRESS_METHOD_MISMATCH` with `{ activityId, effectiveMethod, effectiveMethodBasis, requestedMethod,
  submissionId }`, nothing written; the approver rejects it and the site records it the activity's way. This also
  covers any submission already pending on a configured activity when the rule shipped. Without a configured row
  nothing is asked. Configuring a method while a submission of another method waits is still allowed (decision for
  the owner: the refusal is at the approval, where the figure would become official, not at the configuration).
  Proven live (`pc-6-method-authority`: the late pour — footprint and EV byte-identical on the refusal, then
  rejected, entries bundled, the only official row the derived 10%) and mutation-proven (the check removed → the
  90% row is approved).
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
  bundle by date leaving the first row byte-identical; reject; two bundles approved at once serialised with the
  later row at Σ approved entries and the same submission twice at once idempotent; the evidence gate holding a
  bundle; the typed method-configuration basis; a client-planned bundle on an activity with nothing typed and
  nothing mapped approved with its frozen figure; the method lock both ways with readiness; the tenant 404) and
  `__tests__/progress.service.quantity-bundle.test.js`.

### 3.3 The activity register and the Progress screen, as integrated (2026-10-01) [C]

The web Progress tab and its spec were written against contracts the merged server did not send: installed and
planned quantity on the activity register, the entries a pending submission bundles, a withheld views answer, and a
submission appearing in the approval queue the moment a day is submitted. The merged contract (§4.1) is different —
submitting the day mints **pending entries**, and nothing reaches the queue until someone bundles them — and the web
had no way to do that, so daily-log quantities could not be approved from the web at all. Closed at the source:

- **The register carries the figures** (`GET /activities`, `GET /activities/{id}`; `activity.service
  quantityFiguresFor` → `quantity-progress.service activityQuantityFigures`, a fixed number of queries for any number
  of activities, only for activities configured to be measured by quantity): `installedQuantity { installed: [{
  boqItemId, code, description, unitCode, quantity, entries }], asOf, lastApprovedAt, basis }` (Σ approved entries per
  BOQ item — never one figure across items or units; an empty list when nothing is approved), `plannedQuantity {
  planned, unitCode, basis, reason? }` (`plannedFrom`, the rule of `plannedQuantityFor` on rows already read) and
  `pendingQuantityEntries` (the submitted entries no open submission holds). Read-only: nothing is written, nothing
  is official, EV is untouched.
- **A submission carries the entries it bundles, whole** (`quantityEntries`, beside `quantityEntryIds`) wherever it is
  serialised — the queue, the activity's `pendingProgress`, the submit / approve / reject answers — and
  `progressSource` adds `dailyLogDate` / `dailyLogDates` (the day(s) of the daily log(s) its entries came through)
  and `entryCount`.
- **BOQ withholding** (`utils/boq-figures withheldActivity`, `withheldProgressSubmission`): for a member who may not
  read the BOQ, `installedQuantity` and `plannedQuantity` are answered as `{ withheld: { reason } }` — no figure,
  never a zero — and every pending or bundled entry goes through the ledger's rule (`withheldQuantityEntry`).
- **The web** (`progress-tab.tsx`): the pending entries are listed under their activity as "awaiting approval — not
  official" with their source and day, and **Put forward for approval** sends `{ bundleSubmittedThrough: <the latest
  day shown> }` — the day, never a figure — to `POST /activities/{id}/progress`; the bundle then stands in the queue
  with its entries and is approved there. A figure that came through a daily log is headed "Daily log <date>"
  whoever put it forward. The drawer (`use-record-quantities`, `quantities-section`) reads the views' real answer: a
  record-level `withheld: true` is the withheld state with the server's reason, `items` may be the withheld marker,
  and an item's figures are under `figures`.
- **Proof**: live — `pc-6-quantity-approval` (the register case: both readers' figures, the fixing's typed planned
  figure, an unconfigured activity carrying none of the three, a bundle's entries on the activity and in the queue)
  and `pc-6-daily-log-quantities` (the member without BOQ read: the withheld markers and entries, single and list);
  browser — `frontend/e2e/55-quantity-progress.spec.ts`, no skip gate, green twice against its own API and Vite
  (the walk: daily log → pending entry on the tab → put forward → the queue's bundle → approve → official 75 % with
  the daily log as its source; the surveyor without BOQ read sees "—" with the reason). Mutation-proven: the
  register's figures not withheld (live), the drawer ignoring the withheld marker and the register carrying no
  figures (browser) each fail.

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

Mobile: the daily log form gets a "Quantities installed" section using the existing activity + location pickers; offline via the outbox with `clientRequestId` (already the pattern for the six sections). **As integrated (2026-10-01):** the item picker reads the server's own list — `GET /activities/{id}/allocated-items` (§4.1), admitted on reading progress — not the allocation register (`/activity-boq-allocations`, gated on reading the BOQ), which had left a site engineer without BOQ read unable to record at all, against the owner's decision. Such a member picks by the item's description and unit (no code, no allocation, no allocated quantity — none is invented; the server resolves the single approved allocation), records, and reads their own row back with a dash and the server's reason for the quantity. The form no longer offers zero (the server refuses it, §3.1). `mobile/e2e/pc6-daily-log-quantities.spec.ts` runs without a skip gate: the withheld picker and the recorded row; offline capture → outbox → a lost reply → the retry and one more replay → one row; the day submitted from the phone → one pending entry per row in the register (`source daily_log`, `submitted`), nothing official; the activity screen's count and its six figure lines against the server's `/quantities` answer for both members.

### 4.1 The quantities section, as shipped (PC-6 core, 2026-10-01) [C]

`daily-log.service.js` carries a seventh section, `quantities` (model `DailyLogQuantity`), registered in the
same `SECTIONS` table as its six siblings, so every generic path applies to it: add / edit / remove / review by
row, the party-user scoping and visibility, the row's own `status` (approved at once for staff, submitted for a
collaborator, reviewed by the site team), `clientRequestId` replay, the PDF, the digest, the manpower-style
totals. What is specific to it:

- **A row names** `activityId`, `boqItemId`, `quantity` (Decimal(18,3), ≥ 0 — `QUANTITY_NEGATIVE` in code before
  the CHECK), `unitCode` (`unit` is accepted as a spelling of it), `allocationId?`, `locationId?`, `notes?`,
  `clientRequestId?`. The item must be one the activity has an **approved, active allocation** of, else 400
  `DAILY_LOG_QUANTITY_NOT_ALLOCATED`; an `allocationId` named must be one of those (400
  `QUANTITY_ALLOCATION_MISMATCH`), and when none is named the single approved one is resolved onto the row (null
  when there are several). The unit is the item's code or an alias the organisation's unit master maps to it
  (§3.1's rule, `resolveEntryUnit`), else 400 `QUANTITY_UNIT_MISMATCH`; the row is stored under the item's code.
  No copy-forward (`copyFields` is absent): a quantity installed yesterday is not installed again today.
- **The recorder's rule.** The person adding or editing a row is under the progress submission's assignment rule
  (`progress.service.assertProgressSubmitAllowed`: a site engineer on the activities assigned to them, a PM or
  planning engineer on any) **when the row is recorded**, not when the log is submitted — the log is one record
  per day submitted as a whole by one person for every author's rows, and the rule must not stop a site engineer
  submitting a log that carries a colleague's row. The minting therefore passes `assignmentRule: false` and names
  the row's author as `createdBy` (PROGRESS SOURCE `recordedBy`).
- **The picker — `GET /projects/{id}/activities/{activityId}/allocated-items`** (progress:read,
  `quantity-progress.service.allocatedItemsFor`): one line per BOQ item the activity has an approved, active
  allocation of — `id, code, description, unit, unitCode, allocationId` (the single approved one, else null and
  `allocationIds`), `allocatedQuantity` (Σ approved allocation quantity). **What a member without boq:read sees
  (owner decision, this item): `id`, `description`, `unit` and `unitCode` only** — the least that lets a person
  on site pick the item and name the unit — with `boqWithheld: { keys: [code, allocationId, allocationIds,
  allocatedQuantity], reason }`. The list's existence tells such a member which items the activity is mapped to;
  the owner asked for exactly that so a site engineer can record without reading the bill. Nothing of the bill's
  quantities, values or counts beyond the lines themselves is given.
- **What a member without boq:read sees of the section** (`utils/boq-figures.withheldDailyLog`, applied by every
  daily-log route and, for the list of days, `withheldDailyLogList`): **the quantity ledger's rule** (integration
  fix, 2026-10-01 — decision taken and reported to the owner; before it the same installed-quantity-per-BOQ-item
  figure the ledger withheld on `GET /quantity-progress` was handed to the same member on `GET /daily-logs/{date}`,
  on every write answer, on the PDF and in the per-unit totals). The row keeps the item's **description and unit
  name** (so the member can see what they recorded), the activity, the location, the notes, the row's review state
  and the state and provenance of the entry it minted (`progressEntry`, which carries no quantity); it loses
  `quantity`, `unitCode`, `boqItemId`, `allocationId`, `boqItem.id` and `boqItem.code`, named in `boqWithheld
  { keys, reason }`. The section's per-unit `totals.quantities` are per-item quantities summed and are withheld the
  same way (`totals.boqWithheld`; `quantityRows` stays). Omitted, never zeroed: the web table and the mobile line
  show "—" with the server's reason. The PDF (`GET /:date/export.pdf`, `progress:export`) renders for its viewer:
  a BOQ reader's carries the code and the figures, anyone else's a dash per row, no per-unit total and the note
  "Quantities per BOQ item are shown to members who may read the BOQ."; **the distributed document and the digest
  are rendered as the most restricted reader would see them** — one stored file for the project, a digest that
  reaches external addresses — so neither carries a code or a per-item quantity. Proven live
  (`pc-6-daily-log-quantities`: the write answer, the read, the edit, the list, both PDFs and the stored document)
  and mutation-proven (the withholding dropped on the read, on the write answer and on the PDF each fail it).
- **Minting (`POST /daily-logs/{date}/submit`).** Every row that counts (not draft, not rejected by the site team)
  becomes one `QuantityProgressEntry`: `source 'daily_log'`, `status 'submitted'`, the log's date, `dailyLogId`
  + `dailyLogQuantityId`, the row's allocation, location, unit, quantity and notes, `createdBy` the row's author,
  `clientRequestId 'daily_log:<rowId>'` (the replay key, so a resubmission never doubles). A row that already has
  an entry keeps it: a free pending one is synced to the row (audit `quantity_entry.daily_log_sync`), a bundled,
  approved or rejected one is left alone. The log's audit event says `{ minted, synced, kept }`. **Nothing here is
  official**: no `ActivityProgress` row, EV unchanged, the entries wait for §3.2's writer.
- **The row's status is never progress.** `POST /daily-logs/{date}/approve` moves every section row from
  submitted to approved — the quantities rows too, as their site-record review state — and **does not approve an
  entry**: after approving the log every entry is still `submitted`, `approvedBy` null, nothing official (proven
  live, and mutation-proven: approving entries in `approveLog` fails the suite). `reopen` leaves the entries as
  they are.
- **A submitted day's rows are never left unminted** (review fix, 2026-10-01). Staff may add a row to a day
  already submitted; before the fix it was minted by nothing — `approveLog` minted nothing and an approved day
  refuses a resubmit (409 `DAILY_LOG_APPROVED`) — so the figure sat in an approved log and never reached the
  approvers. Now a counted row on a **submitted** day is pending at once (`mintOnSubmittedDay`: on add, on an
  edit that resubmits a rejected row, on a review `approve`), and `approveLog` mints for every counted row still
  without an entry before it closes the day (the same `mintDailyLogEntries` call as submit; minting only — it
  approves nothing; proven live with a row left unminted, mutation-proven: `approveLog` minting nothing fails
  the suite). An open day's row stays a site record. The same call **retires** the free pending entry of a row
  that no longer counts (`retiredRows`: draft, or rejected by the site team) — audit
  `quantity_entry.daily_log_row_retired` — so the log's events say `{ minted, synced, kept, retired }`.
- **The site team's reject takes the entry with it** (review fix, 2026-10-01; §4.1's rule that a row rejected by
  the site team does not count). Before it, `/entries/quantities/{id}/review` with `reject` moved the row only
  and left its minted entry `submitted` and free, so a planner's `bundleSubmittedThrough` picked it up and the
  writer made a figure the site withdrew official. `reviewEntry` now calls `rejectDailyLogRowEntry` first: the
  free pending entry is **deleted** with the decision (audit `quantity_entry.daily_log_row_rejected`, the
  reviewer's reason — deleted, not marked, so a row approved back is minted afresh under its
  `daily_log:<rowId>` replay key); an entry already **approved progress locks the row** (409
  `DAILY_LOG_QUANTITY_LOCKED` — the site team cannot reject what the approver made official; the correction is
  a new row); one **bundled** into a pending submission holds it (409 `QUANTITY_ENTRY_BUNDLED`); one the
  approver rejected stays as the trail. A review `approve` never touches an entry (and on a submitted day mints
  one when the row has none). Proven live (reject after submit → the entry is gone, a date bundle finds
  nothing, EV unchanged; the two refusals) and mutation-proven (the reject leaving the entry, the official lock
  off, each fail the suite).
- **Edits and removals before approval** (`dailyLogRowEntryGate`): a row whose entry is **approved or rejected**
  is locked — 409 `DAILY_LOG_QUANTITY_LOCKED`; the correction is a new row (and a rejected row's resubmission
  never re-mints: the row is settled). A row whose entry is **bundled into a draft/submitted submission** is held
  — 409 `QUANTITY_ENTRY_BUNDLED` on edit and on removal. A row with a **free pending** entry: an edit syncs the
  entry (quantity, unit, allocation, location, notes; the activity and the item are not moved — 400
  `QUANTITY_ENTRY_IMMUTABLE_FIELD`; remove the row and record another); a removal deletes the entry with it
  (audit `quantity_entry.daily_log_row_deleted`) — **never a pending ghost** (the reviewer's finding; mutation-proven:
  leaving the entry behind fails the suite). Removing a row whose entry is approved or rejected is allowed: the
  site record goes, the official figure stays with `dailyLogQuantityId` nulled by the database (SET NULL),
  `dailyLogId` and `source` still naming where it came from.
- **Provenance a client cannot claim.** `createEntries` honours an entry's `submissionId`, `dailyLogId`,
  `dailyLogQuantityId` and `createdBy` only from this service's own callers (`internal: true`, the minting); a
  client body carrying them on `POST /quantity-progress` is stored with those links null (closed in this item —
  before it a client could attach an entry to a pending submission and have it approved with that bundle).
- **The row payload** adds, beside the six siblings' fields: `boqItemId`, `boqItem { id, code, description, unit,
  unitCode }`, `allocationId`, `quantity` (number, three places), `unitCode`, `progressEntry { id, status,
  official, source, submissionId, submissionStatus, recordedBy, recordedAt, approvedBy, approvedAt, rejectedBy,
  rejectedAt, rejectionReason } | null`. `totals` adds `quantityRows` and `quantities: [{ unitCode, quantity,
  rows }]` — quantity per unit, never one figure across units.
- **Live proof** — `src/services/__live__/pc-6-daily-log-quantities.live.test.js` (a real API process, the real
  local Postgres, a throwaway LiveTest organisation): the picker for both members; the refusals; replay; rows are
  site records (no entry); submit mints two submitted entries with the row's author as recordedBy and nothing
  official (EV 0); an edit syncs; approving the log leaves the entries submitted; reopen / add / remove / resubmit
  with no ghost; the one writer bundles a daily-log entry, writes ONE `ActivityProgress` row at 50 ÷ 100, the log
  shows the row official, the row is locked, removing it leaves the entry (SET NULL) and the EV row; a rejected
  bundle locks its row; a second day: the site team's reject after submit takes the entry with it and a date
  bundle finds nothing, a row approved back or added to the submitted day is pending at once, the day's approval
  mints a row left unminted and approves nothing, a bundled or official row cannot be rejected by the site team,
  a stale rejected row's entry is retired on the next submit; the non-BOQ member records against the picker
  (on a submitted day: pending at once) and reads the log withheld; a client-sent `submissionId` / `dailyLogId`
  is ignored; the tenant 404; every other activity's EV row byte-identical.

## 5. Installed / certified / paid (§82) [D]

Per BOQ item (and per activity, location, WBS group), three quantity columns with three different truths:

| Column | Truth | Source of the figure | Money twin |
|---|---|---|---|
| **Installed** | derived | Σ approved `QuantityProgressEntry` | earned value (approved allocation × pct) — note: for `percent` activities installed quantity is *not* available and the column shows "—", never pct × qty |
| **Certified** | derived | Σ `IpcItem.qty` on certified/paid certificates on the allocation summary's certified basis — client side (a Σ over rows is **derived**, not source: corrected at integration, 2026-10-01 — the figure is unchanged, the label was wrong, and one payload carried both); the subcontractor side carries no quantity as built (§5.1) | certified value (IPC) / subcontract cost (ledger, `sub-pay-app.service.js:650-705`) |
| **Paid** | projection | certified quantity × the **share of the certificate's net payable that has been paid** (`IpcCertificate.amountPaid ÷ netPayable`, capped at 1), pro-rata per certificate; a fully paid certificate projects paid = certified | paid amount (cash flow, `cash-flow.service.js:93-195`) |

Rule: installed ≥ certified is expected; certified > installed is an exception (over-certification — already tracked as `overCertificationAmount` on the certificate [C], now also visible in quantity).

### 5.1 As shipped (PC-6 views, 2026-09-30) [C]

`backend/src/services/quantity-views.service.js` is the one read-only composition of the five quantities, and
`GET /projects/:id/boq/items/:itemId/quantities` (boq:read) and `GET /projects/:id/activities/:activityId/quantities`
(schedule:read) its two routes; the PC-5 BOQ item detail's `quantities` section (`installed`, `certifiedQuantity`,
`paid`, `received`, `issued`, `committedQuantity`, `comparisons`) and the activity detail's
`progress.installedQuantity` are the same block (`controls-detail.service` calls `quantityBlocks` /
`installedForActivity`; the "Not available yet (PC-6)" placeholders are gone, `forecast` still names PC-7). Every
figure is

```
{ value, truth, basis, unitCode, unitMatch, derivedFrom, notAvailable?: { reason } }
```

— `unitCode` the unit the value is in, `unitMatch` whether that is the BOQ row's unit (`BoqItem.unitCode`, or the
typed unit resolved against the organisation's unit list; `null` when nothing was counted). Five figures, five
truths, from five owners, and no sixth that nets two of them:

| Figure | Truth | Read from | Not available when |
|---|---|---|---|
| installed | derived | the core track's `quantity-progress.service installedByBoqItem` / `installedByActivity` (Σ **approved** `QuantityProgressEntry`; only approval counts), behind an adapter | the module is absent (`"PC-6 core pending"`); the activity is not measured by quantity (never % × quantity — approved entries on a percent activity notwithstanding) |
| certified | derived | Σ `IpcItem.qty` on the allocation summary's certified basis (`activity-boq-allocation certifiedIpcItemWhere`: status ∈ {certified, paid} on an approved, active allocation — the rows `certifiedValue` sums); `certified.subcontract` is "—" (`SubPayAppLine` has no quantity) | the viewer may not read `ipc` |
| paid | projection | certified quantity × the share of the certificate's net payable that has been paid — `IpcCertificate.amountPaid ÷ netPayable`, capped at 1, the payment state `ipc.service syncPaymentState` keeps; a fully paid certificate projects paid = certified — pro-rata per certificate (`paid.certificates` lists each); money is paid per certificate, never per line | the viewer may not read `ipc` |
| received | derived | Σ `StockTransaction` receipts naming the item, in the **inventory item's** unit | the viewer may not read `inventory`; the rows are in more than one unit |
| issued | derived | Σ issues net of returns (the sign the inventory ledger gives each, `CONSUMPTION_SIGN`), `components { issued, returned }` | as received |
| committed | derived | Σ `CommitmentSovLine.qty` on `commitment.service POSTING_STATUSES` (executed, closed), **"Committed quantity (excludes variations)"** — approved commitment change orders carry no quantity and no BOQ item (critic's correction of the rule in §6) | the viewer may not read `commitment`; a party-scoped member; mixed units |

Rows in more than one unit are never summed: the figure is not available with `byUnit` (each unit's own sum).
The activity view scopes each figure to the activity (installed per item from `installedByActivity`, certified and
paid on the lines of its allocations, stock movements and SOV lines naming it) for every BOQ item of its approved
allocations (`items[]`) and folds them into one activity-level figure only where every item's figure is in one
unit (`byItem` always lists each). `comparisons.certifiedOverInstalled` is the rule above as a **raw flag** in one
unit (`flag`, `certified`, `installed`, `unitCode`; `null` with the reason when either side is not available or the
units differ) — the reviewed exception and the Change Event are PC-7b; the view writes no `ProjectException`,
no change order, no budget or schedule change. `cutoffDate` bounds installed (`approvedAt`), certified
(`certDate`, else the certificate's `certifiedAt`), the stock movements (`occurredAt`) and the activity's approved
% complete; paid and committed are as of now and say so. **It is THE reporting cutoff** (integration fix,
2026-10-01): `resolveViewCutoff` reads a calendar date through `utils/reporting-cutoff` — the END of that date in
`Project.timezone` → `Organisation.defaultTimezone` → UTC, the one instant EV and the core's `installedBy*` select
against (the views used to read it as the start of the day in UTC, so the same date gave the view and the core two
different installed figures); the answer carries the instant as `cutoffDate` and how it was read as
`reportingCutoff { localDate, timeZone, timeZoneSource, timeZoneNote, endOfLocalDay }`. Proven live with the
project in America/Chicago (an entry approved at 03:00Z on the 5th counts at the cutoff date of the 4th, in the
view and in the core alike) and mutation-proven. The certified quantity is one figure with one truth label and one
basis wherever the payload states it (`quantities.certifiedQuantity` and `certification.certifiedQuantity`: both
`derived`, the same basis text). A planned quantity the core cannot state says the core's own reason (allocations in
more than one unit are never summed: "type the planned quantity on the method configuration"), not "no approved
allocation". One query per source for any number of items.

BOQ access: `utils/boq-figures` (`QUANTITY_FIGURES_WITHHELD`, `withheldBoqItemQuantities`,
`withheldActivityQuantities`, and the activity detail's `progress.installedQuantity`) withholds every per-item
quantity — installed, certified, paid, received, issued, committed, the planned quantity and the comparison — from
a member who may not read the BOQ; cost, IPC, inventory or commitment read does not unlock them. The answer is a
dash with the reason, never zero; the activity's approved % complete and method are progress data and follow
progress:read. Proof: `backend/src/services/__live__/pc-6-quantity-views.live.test.js` (LiveTest org; the
seeded entries, the two certificates — one a quarter paid —, the receipt/issue/return, rebar in kg against tonnes,
the draft commitment, the percent-method activity, the member without BOQ read, tenant 404s) and
`pc-6-quantity-views-showcase.differential.live.test.js` (Marina Bay, read-only: every item's and activity's
figures equal `listCommitments`, the certified basis, `listIpcCertificates` and `listTransactions`; rows identical
before and after).

## 6. Committed and forecast quantity (§83-§84) [D]

- **Committed quantity** (derived): Σ `CommitmentSovLine.quantity` for lines naming the BOQ item on executed/closed commitments — the same recognition rule as committed cost (`commitment.service.js:29, 424-483`) [C]. Approved `CommitmentChangeOrder` lines are **not** included: their `linesJson` entries carry an amount, a cost code, a budget line and an activity, but no quantity and no BOQ item (critic's correction), so the figure is labelled "Committed quantity (excludes variations)" and is not the committed cost (which includes them). `ProcurementOrder` quantities are shown as "ordered (not committed)" (three-truths §3.3). As shipped: §5.1.
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
- Nothing in the import writes `ActivityProgress`; an approved row is never rewritten — a later approval is a new row, exactly as the writer does. The file's figure is a percentage, so the submission names `percent`; on an activity **configured** to be measured another way the writer refuses it (§3.2, 409 `PROGRESS_METHOD_MISMATCH` — the submission's method is the activity's, never the file's), and the row is `refused` with that reason, previewed as `refuse` by the dry run (integration fix, 2026-10-01; before it the row was written as a percent submission flagged `methodMismatch: true`, and an approver's import approved a percentage with no entries behind it). A 0% row on such an activity with no approved progress is still `unchanged`, never refused. Proven live: `pc-6-import-authority` P600 for the site engineer and the PM alike.
- **Only a figure that moves the official figure is written** (review finding, 2026-09-30). The current official figure is the latest approved `ActivityProgress` percentage, and **0 for an activity with no approved progress**; a row at that figure is `unchanged` and creates nothing — so a full-programme P6 export, which names every activity, does not put one 0% submission per unstarted activity in the approval queue (nor, for a PM, one approved 0% row plus two audit events per activity). A row the file names **without a percentage** (empty `phys_complete_pct`; no `PhysicalPercentComplete`/`PercentComplete` in P6 XML — a P6 status is not a percentage) is `skipped` with `PROGRESS_PERCENT_MISSING`, never a submission; the parsers say whether one was stated (`physCompleteStated`) and the schedule import still reads such a row as 0. The dry run classifies the same way, and the answer counts `unchanged` and `skipped`.
- A figure already waiting in an open import submission: for a submit-only person, or when the open row is a `draft` (it waits for evidence, not approval), the row is `already_pending` (`waitingStatus` says where it waits; the reason says the same) and nothing is written. **An importer with approval authority whose figure already waits in someone else's `submitted` import submission approves that submission** through `approveProgressSubmissionWithClient` with its gates — the same figure under the approver's own authority — so the submission's own row becomes `approved`, one `ActivityProgress` row is written with its id, and the audit `approved` event names the approver (the `created` event keeps its submitter); the row answers `approvesPending: true` with that `submissionId`. A gate still applies: an open ITP hold point or missing evidence leaves it `pending` with the reason, no second submission. When the approver's figure **differs** from a pending `submitted` import row, the import creates and approves a new submission as for any row. Either way, **every** other older `submitted` import row on the activity at another figure — there may be several (a site engineer's 30 then 32) — is left exactly as the writer leaves a superseded manual submission — untouched, still in the queue (the activity's `progressApprovalStatus` still says `submitted`); the written row carries `superseded [{ submissionId, pctComplete }, …]` (newest first; also on a row that approved an already-pending submission, since the approver is the one person the report exists for) and the answer lists each as a `supersededPendingSubmissions` entry (`supersededPending` counts submissions, not rows; "superseded pending" in the message) so the approver can reject them from the queue (follow-up review findings, 2026-09-30: the approving row said nothing and only the newest older row was named). The import never rejects or deletes a submission. The writer keeps no idempotency key, so any other figure is written again.
- **A manual pending submission is treated exactly like an import one** (integration fix, 2026-10-01). The
  pending-row logic used to read only `source 'import'` open submissions, so a MANUAL pending submission at the same
  figure was neither approved by an approver's import nor reported — the import created and approved a second,
  identical submission and the manual one kept waiting. It now reads every open submission of the activity (the web
  form's, the site app's, a daily report's): at the **same** figure a submit-only import is `already_pending` (the
  reason names what waits: "A manual submission at 72% is already awaiting approval; no second submission") and an
  approver's import approves THAT submission through `approveProgressSubmissionWithClient` with its gates
  (`approvesPending: true`; the submission keeps its submitter and its `source`, the official row its `source
  'manual'`); at a **different** figure it is reported as superseded pending like an import one (`superseded`,
  `supersededPendingSubmissions`; the message says "older pending submission(s)" when any of them is not an
  import's, "older pending import submission(s)" when all are). The import still never rejects or deletes.
  Proven live (`pc-6-import-authority`, the manual 72 / 74 on P100 beside the older import 65) and
  mutation-proven (the import-only filter restored fails the case).
- `?dryRun=true` reports the per-row outcome for this person and stores nothing — no document, no submission. The outcome is read from the writer's own rules, not assumed: the assignment assertion the writer runs, the activity's evidence requirement, and (for an approver) the ITP hold points the approval gate reads. A row those would refuse is previewed `refuse`, one a gate would hold `hold` (kept as a draft for a submit-only person, left pending for an approver), each with the reason; `wouldSubmit` / `wouldApprove` count only rows that will be written that way, `wouldHold` / `wouldRefuse` the rest. The import itself still trusts the writer for every row. The web dialog previews first and repeats the server's headline; its headline counts only what is in an approver's queue as "submitted for approval" and says drafts, refusals and skipped rows separately; the grid shows the unchanged, skipped and superseded-pending counts, a note names the older pending figures left in the queue, and a row approved as it already stood in the queue says so; unchanged rows are counted, not listed. After a real import it refreshes the same queries the progress tab does after an approval (EV report, audit history, readiness). Mobile does not call this endpoint.
- OpenAPI: `ProgressImportResponse` / `ProgressImportRow` (`skipped`, `supersededPending`, `supersededPendingSubmissions`, `approvesPending`, `superseded`; `pctComplete` null on a skipped row). Live proof: `backend/src/services/__live__/pc-6-import-authority.live.test.js` — including the full-programme 0% file that writes nothing for either person and leaves the EV report byte-identical, the skipped row, the approver approving the site engineer's own pending row (and the hold point still holding it), the differing figure that leaves the older row byte-identical and reported, the approver's identical figure that approves the pending row and still names the other older figure in the queue, and an activity with three older figures waiting (40, 85, 90) all reported one entry each by the site engineer's and the PM's imports.

**Writers of `ActivityProgress` (census at 07c64c1):** `progress.service.js approveProgressSubmissionWithClient` (the one writer) and `import.service.js importProgress` (the defect above, removed). The only other writes are `prisma/seed.js upsertProgressAndCost` (a seed, not a request path) and the live tests' own fixtures. No raw SQL, no nested write and no delete path exists in `backend/src` or `backend/scripts`; `DELETE /activities/:id` refuses an activity that progress keeps (409 `ACTIVITY_IN_USE`).
