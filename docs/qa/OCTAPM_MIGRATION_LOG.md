# Migration log (shared local database)

One entry per migration applied to a database other than a throwaway one, in the order of
`docs/qa/OCTAPM_MIGRATION_PREFLIGHT.md`. Evidence files live outside Git under `C:\Temp\` (named per entry).
No production migration has been run.

## 20261005060000_project_exceptions + 20261005060100_record_ref_uniques — 2026-10-01

**Why:** PC-7b (reviewed exceptions and the Change Event handoff): `ProjectException` (derived, rebuildable rows;
never a figure anywhere else), ChangeEvent's eight typed source links beside the free-text pair,
`ChangeOrder.locationId`/`wbsNodeId`, `Rfi.changeOrderId` as a relation, and `@@unique([projectId, ref])` on
ChangeOrder, Risk and NcrRecord. Design: docs/project-controls/OCTAPM_CHANGE_INTELLIGENCE.md (PC-7b migrations note).
**SQL:** 060000 = 38 migrate-diff statements + 3 hand-written (the NULL-safe partial unique index on open rows; the
composite cost-code key re-created with `SET NULL ("costCodeId")`); 060100 = 3 unique indexes. Additive: the only DROP
is that constraint on the new table. Evidence: `C:\Temp\r6-pc7b-preflight\`.

| Step | Result |
|---|---|
| 1 Identity | `octapm_verify`, 55432, `C:/Temp/octapm-pg` |
| 2 Status | exactly these two pending |
| 3 SQL review + pre-flight scripts | 41 + 3 statements, 0 destructive; `change-link-census.js` exit 0 (94 RFIs, 10 links, all same project, 0 orphaned); `record-ref-duplicates.js` exit 0 (ChangeOrder 315 / Risk 8 / NcrRecord 8 rows, 0 duplicate groups; ProcurementOrder 392 rows with 2 duplicate groups = the owner's, not constrained) |
| 4 Throwaway proof | `verify-additive-migration.js` over ChangeEvent, ChangeOrder, Rfi, Risk, NcrRecord, ProcurementOrder with `--link Rfi.changeOrderId=ChangeOrder`: 660 values, **0 differences**, added columns nullable and NULL; `prove-project-exceptions-constraints.js` **0 failures** (tenant keys, open-row index, ON DELETE, ref uniques, confinement); throwaway databases dropped, 0 remaining |
| 5 Backup | API and cluster stopped; cold copy `C:\Temp\octapm-pg-backup-20261001-pre-project-exceptions` (outside Git): 20,380 files / 699,999,212 bytes, identical; **taken before applying** |
| 6 Baseline (before) | sentinel PASS; subscriptions 24/24; fingerprint PASS; snapshot 36/36; reconciliation 16/16, delta 0.00; certified EV captured; md5 fingerprints of ChangeEvent (7), ChangeOrder (315), Rfi (94), Risk (8), NcrRecord (8), ProcurementOrder (392), ChangeEventLine (0) |
| 7 Apply | `prisma migrate deploy`, API stopped: exit 0, both applied |
| 8 Generate | API stopped: **exit 0**, 245 models, `ProjectException` present |
| 9 Baseline (after) | every step-6 result identical incl. all seven table fingerprints; `ProjectException` exists and is empty; `validate-composite-fks.js` 132 checks, 0 mismatches (ProjectException covered); `tenant-constraint-teeth` 6/6 with the PC-7b case now running; schema up to date |
| 10 Backfill | none |

## 20261005050000_quantity_progress — 2026-09-30 (applied 2026-10-01 00:2x UTC)

**Why:** PC-6 (progress and quantity integration): `QuantityProgressEntry` (the record of an installed quantity,
official only once approved through the one progress writer) and `DailyLogQuantity` (the daily log's seventh
section). Design: docs/project-controls/OCTAPM_PROGRESS_MEASUREMENT.md §3–§4 and its PC-6 migration note.
**SQL:** two CREATE TABLE, 15 CREATE INDEX (two unique, incl. `(projectId, clientRequestId)`), 16 ADD
CONSTRAINT (ENT-3 composite tenant keys `(projectId, orgId) → Project(id, orgId)`), exactly the
`prisma migrate diff` body, plus four hand-written CHECKs (`quantity >= 0` on both tables; status and source
on the entry). Additive; nothing on any existing table. Evidence: `C:\Temp\r6-pc6-preflight\`.

| Step | Result |
|---|---|
| 1 Identity | `octapm_verify`, port 55432, data directory `C:/Temp/octapm-pg` |
| 2 Status | only this migration pending (plus the pre-existing `20260907052156_add_gantt_layouts` note) |
| 3 SQL review | 37 statements, every ALTER/CREATE on the two new tables; no DROP/DELETE/UPDATE/TRUNCATE |
| 4 Throwaway proof | `verify-additive-migration.js` over DailyLog, DailyLogNote, ProgressSubmission, ActivityProgress, ActivityBoqAllocation, StockTransaction, IpcItem (3 rows each, 492 values): **0 differences**, no column added to any of them; `prove-quantity-progress-constraints.js`: **55/55 ok** (cross-tenant row refused, replay refused, CHECKs refused, ON DELETE as designed); both throwaway databases dropped, 0 remaining |
| 5 Backup | API and cluster stopped; cold copy `C:\Temp\octapm-pg-backup-20260930-pre-quantity-progress` (outside Git): 20,346 files / 680,826,846 bytes, identical; **taken before applying**; restore = stop, move the data directory aside, copy back, start |
| 6 Baseline (before) | sentinel PASS; subscriptions 24/24; fingerprint PASS; snapshot 36/36; reconciliation 16/16, delta 0.00; certified EV captured; per-table md5 over id/key columns of the seven tables above recorded (DailyLog 11, DailyLogNote 6, ProgressSubmission 69, ActivityProgress 79, ActivityBoqAllocation 285, StockTransaction 808, IpcItem 11 rows) |
| 7 Apply | `prisma migrate deploy` with the API stopped: exit 0, one migration applied |
| 8 Generate | `prisma generate` with the API stopped: **exit 0**, 244 models, both new models present |
| 9 Baseline (after) | every step-6 result identical: sentinel, 24/24, fingerprint, 36/36, delta 0.00, EV unchanged; **all seven table fingerprints identical**; the two new tables exist and are empty. `validate-composite-fks.js`: 129 checks, 0 mismatches (the two new tables now covered). `tenant-constraint-teeth.live.test.js` 5/5 — its PC-6 case now runs (one assertion matched the raw unique-violation message by constraint name; Prisma reports it by SQLSTATE 23505 and the key columns — the assertion was corrected; the row-count assertion is what bites). |
| 10 Backfill | none; the tables start empty |

## 20261005047000_cost_record_forecast_source — 2026-09-30

**Why:** owner decision R5-2 (docs/project-controls/OCTAPM_ROUND5_OWNER_DECISIONS.md). A cost record's stored
forecast must say whether it was entered or is the initial default `max(budget, actual)`, so an entered
forecast is never overwritten by an unrelated edit and each basis can be labelled honestly.
**SQL:** `ALTER TABLE "CostRecord" ADD COLUMN "forecastSource" TEXT;` generated by `prisma migrate diff` from the
previous schema. Additive and nullable, and reversible by dropping the column. Evidence: `C:\Temp\r6-preflight\`.

| Step | Result |
|---|---|
| 1 Identity | `octapm_verify`, port 55432, data directory `C:/Temp/octapm-pg`, PostgreSQL 18.3 |
| 2 Status | only this migration pending. `20260907052156_add_gantt_layouts` is listed as a database migration missing locally: a rolled-back attempt from 2026-09-07 (0 steps, `rolled_back_at` set), re-applied then as `20260914090000_add_gantt_layouts`. It predates this work and is harmless. |
| 3 SQL review | one nullable column; nothing destructive |
| 4 Throwaway proof | `node scripts/db/verify-additive-migration.js --migration 20261005047000_cost_record_forecast_source --table CostRecord --rows 4`: 134 earlier migrations applied to `octapm_migtest_…`, then this one; 4 rows, 64 values compared, **0 differences**; the added column is nullable and NULL on every row; the throwaway database was dropped. The shared database was checked afterwards: the migration was still pending and no `octapm_migtest_*` database remained. |
| 5 Backup | API stopped, cluster stopped (`pg_ctl stop -m fast`), whole data directory cold-copied to `C:\Temp\octapm-pg-backup-20260930-pre-cost-forecast-source` (outside Git): 20,329 files / 660,708,802 bytes, identical counts and bytes; cluster restarted. **This backup was taken before the migration.** To restore: stop the cluster, move `C:\Temp\octapm-pg` aside, copy the backup back, start. |
| 6 Baseline (before) | membership sentinel PASS; subscription invariants 24/24 PASS; bulk-write fingerprint PASS; financial snapshot 36/36; reconciliation 16/16 lines, actual-cost delta 0.00; certified-project EV captured; CostRecord 271 rows, sums and an md5 over every row's id/budget/actual/forecast/committed recorded |
| 7 Apply | `prisma migrate deploy` with the API stopped: exit 0, one migration applied |
| 8 Generate | `prisma generate` with the API stopped: **exit 0**, 242 models, `CostRecord.forecastSource` present |
| 9 Baseline (after) | every step 6 result identical: sentinel, subscriptions 24/24, fingerprint, snapshot 36/36, delta 0.00, EV unchanged (PV 0, EV 120,000, AC 0, EAC 641,500); CostRecord 271 rows with the same sums and the same md5 (`30daa85d…`); `forecastSource` is NULL on all 271 |
| 10 Backfill | none. NULL means the source was not recorded and is treated as entered (never overwritten). No existing row was classified by guessing. |
