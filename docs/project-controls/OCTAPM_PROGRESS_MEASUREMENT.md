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
