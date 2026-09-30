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

A method change on an activity with approved progress is refused (existing rule) — the frozen `pctComplete` history is source data.

## 3. Quantity progress and the authority rule (§79) [D]

New table `QuantityProgressEntry` (project-owned, inherits org through Project):

```
id, projectId, activityId, boqItemId, allocationId?, locationId?, unitCode,
quantity Decimal(18,3), date, source (submission | daily_log | manual | import),
submissionId?, dailyLogId?, dailyLogQuantityId?, status (draft | submitted | approved | rejected),
approvedBy/At, rejectedBy/At/Reason, clientRequestId (idempotent), createdBy, createdAt
@@unique([projectId, clientRequestId])
```

**Authority rule:** the installed quantity of a BOQ item on an activity is the Σ of **approved** entries; only approval by the progress approvers (same roles and gates as `ProgressSubmission`, `progress.service.js:602-735`) makes an entry official. A daily log, a site capture or an import never changes progress by itself; it creates `draft`/`submitted` entries. Approving a quantity-method `ProgressSubmission` approves the entries it bundles and writes the resulting `ActivityProgress.pctComplete` — so the EV pipeline is untouched: EV still reads `ActivityProgress`.

Constraints: Σ approved quantity per (item, activity) ≤ allocation quantity, else an **overrun exception** (change doc §1) — a warning, not a block, because over-installation is real information; certification remains capped separately (`ipc.service.js:183-237`). Unit is the item's `unitCode`; an entry in another unit is refused unless a UoM conversion exists in the org master.

## 4. Daily-report contribution (§81) [D]

`DailyLog` gains a section table `DailyLogQuantity` (same shape as the six `DailyLog*` sections, `schema.prisma:7003-7194`, but **with** Prisma relations from day one): `dailyLogId, projectId, orgId, activityId, boqItemId, locationId?, quantity, unitCode, note, clientRequestId`. Submitting the daily log creates matching `QuantityProgressEntry` rows with `source='daily_log'`, `status='submitted'`, linked by `dailyLogQuantityId`; editing the daily log before approval updates them; approval is done on the Progress screen (or in bulk from the daily log by an approver). The legacy `DailyReport → ProgressSubmission(pct)` path stays for `percent`-method activities.

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
- A figure already waiting in an open import submission: for a submit-only person, or when the open row is a `draft` (it waits for evidence, not approval), the row is `already_pending` (`waitingStatus` says where it waits; the reason says the same) and nothing is written. **An importer with approval authority whose figure already waits in someone else's `submitted` import submission approves that submission** through `approveProgressSubmissionWithClient` with its gates — the same figure under the approver's own authority — so the submission's own row becomes `approved`, one `ActivityProgress` row is written with its id, and the audit `approved` event names the approver (the `created` event keeps its submitter); the row answers `approvesPending: true` with that `submissionId`. A gate still applies: an open ITP hold point or missing evidence leaves it `pending` with the reason, no second submission. When the approver's figure **differs** from a pending `submitted` import row, the import creates and approves a new submission as for any row and leaves the older pending one exactly as the writer leaves a superseded manual submission — untouched, still in the queue (the activity's `progressApprovalStatus` still says `submitted`); the row carries `superseded { submissionId, pctComplete }` and the answer lists them as `supersededPendingSubmissions` (`supersededPending` count, "superseded pending" in the message) so the approver can reject them from the queue. The import never rejects or deletes a submission. The writer keeps no idempotency key, so any other figure is written again.
- `?dryRun=true` reports the per-row outcome for this person and stores nothing — no document, no submission. The outcome is read from the writer's own rules, not assumed: the assignment assertion the writer runs, the activity's evidence requirement, and (for an approver) the ITP hold points the approval gate reads. A row those would refuse is previewed `refuse`, one a gate would hold `hold` (kept as a draft for a submit-only person, left pending for an approver), each with the reason; `wouldSubmit` / `wouldApprove` count only rows that will be written that way, `wouldHold` / `wouldRefuse` the rest. The import itself still trusts the writer for every row. The web dialog previews first and repeats the server's headline; its headline counts only what is in an approver's queue as "submitted for approval" and says drafts, refusals and skipped rows separately; the grid shows the unchanged, skipped and superseded-pending counts, a note names the older pending figures left in the queue, and a row approved as it already stood in the queue says so; unchanged rows are counted, not listed. After a real import it refreshes the same queries the progress tab does after an approval (EV report, audit history, readiness). Mobile does not call this endpoint.
- OpenAPI: `ProgressImportResponse` / `ProgressImportRow` (`skipped`, `supersededPending`, `supersededPendingSubmissions`, `approvesPending`, `superseded`; `pctComplete` null on a skipped row). Live proof: `backend/src/services/__live__/pc-6-import-authority.live.test.js` — including the full-programme 0% file that writes nothing for either person and leaves the EV report byte-identical, the skipped row, the approver approving the site engineer's own pending row (and the hold point still holding it), and the differing figure that leaves the older row byte-identical and reported.

**Writers of `ActivityProgress` (census at 07c64c1):** `progress.service.js approveProgressSubmissionWithClient` (the one writer) and `import.service.js importProgress` (the defect above, removed). The only other writes are `prisma/seed.js upsertProgressAndCost` (a seed, not a request path) and the live tests' own fixtures. No raw SQL, no nested write and no delete path exists in `backend/src` or `backend/scripts`; `DELETE /activities/:id` refuses an activity that progress keeps (409 `ACTIVITY_IN_USE`).
