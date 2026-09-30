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

## 4. Daily-report contribution (§81) [D]

`DailyLog` gains a section table `DailyLogQuantity` (same columns, status semantics, `partyId` column, composite tenant key and indexes as the six `DailyLog*` sections — the ENT-3 versions of them already carry `dailyLog / org / project` relations — and **with** relations to what it names): `dailyLogId, projectId, orgId, partyId?, activityId, boqItemId, allocationId?, locationId?, quantity Decimal(18,3), unitCode, notes, status, createdBy, submittedAt, reviewedBy/At, rejectionReason, clientRequestId, sortOrder`. As built, the row carries `allocationId?` too (the approved allocation the site picked the item from, a hint that SET NULLs if the mapping row goes) and names its text column `notes` like its six siblings, so the section registry's generic handling applies. Its `status` is the section row's own review state, never progress. ON DELETE: `dailyLog / org / project` CASCADE like the siblings; `activityId / boqItemId` RESTRICT (a signed site record on the log's PDF is not emptied by a hard delete); `allocationId / locationId` SET NULL. Submitting the daily log creates matching `QuantityProgressEntry` rows with `source='daily_log'`, `status='submitted'`, linked by `dailyLogQuantityId`; editing the daily log before approval updates them; approval is done on the Progress screen (or in bulk from the daily log by an approver). The legacy `DailyReport → ProgressSubmission(pct)` path stays for `percent`-method activities.

**PC-6 migration note.** `backend/prisma/migrations/20261005050000_quantity_progress/migration.sql` is exactly the
`prisma migrate diff` from the schema at `07c64c1` to the PC-6 schema: two `CREATE TABLE` (`QuantityProgressEntry`,
`DailyLogQuantity`), fifteen `CREATE INDEX` (two of them unique, the `(projectId, clientRequestId)` replay keys) and
sixteen `ADD CONSTRAINT` foreign keys — 33 statements, all on the two new tables. It adds no column, index,
constraint, enum or default to any existing table: nothing "installed" lands on `BoqItem`, `Activity`,
`ActivityBoqAllocation`, `ActivityProgress`, `ProgressSubmission`, `IpcItem` or `StockTransaction`, so the five
quantities stay separate and EV's inputs are untouched. The orchestrator applies it through
`docs/qa/OCTAPM_MIGRATION_PREFLIGHT.md` and must prove these pre-existing tables untouched before and after:
`DailyLog`, `DailyLogNote` (the sibling shape), `ProgressSubmission`, `ActivityProgress` (EV's input),
`ActivityBoqAllocation` (planned quantity's source) — `node scripts/db/verify-additive-migration.js --migration
20261005050000_quantity_progress --table DailyLog --table DailyLogNote --table ProgressSubmission --table
ActivityProgress --table ActivityBoqAllocation --rows 3` gave exit 0 and `0 difference(s)` on a throwaway database,
and `node scripts/db/prove-quantity-progress-constraints.js` proved the tenant key, the replay key and every ON
DELETE above (45 checks). After the migration is applied and the Prisma client regenerated:
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
