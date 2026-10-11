# Superadmin V1 — migration preflight (pre-merge, 2026-10-04)

Migrations: `20261005070000_platform_admin` (four new tables) and
`20261005070100_audit_event_occurred_at_idx` (one index, built concurrently).
Procedure: docs/qa/OCTAPM_MIGRATION_PREFLIGHT.md. **Applied to no shared or
durable database** — not `octapm_verify`, not the certification database
(`octapm_cert`, :55433, never connected to for writes). Evidence files:
`C:\Temp\pa-preflight\`.

## 1. Disposable production-like database

No `pg_dump` exists on this machine, and `CREATE DATABASE … TEMPLATE` needs the
source to have no connections (the shared :5000 API holds some), so
`backend/scripts/db/clone-to-throwaway.js` builds the copy:

- a new `octapm_preflight_*` database on the dev cluster (:55432) is migrated
  to the source's exact migration list (138, last
  `20261005060100_record_ref_uniques` — the integration schema `fbc0f76`; the
  script refuses if the lists differ);
- every row of every table is copied from one `REPEATABLE READ, READ ONLY`
  snapshot of the integration database `octapm_verify` (the source is only
  read), with `session_replication_role = replica` on the copy;
- every table's row count is verified.

Result (two clones, `octapm_preflight_pa1` and `_pa2`): **245 tables,
234,162 rows, 0 count mismatches**, 73 s each.

## 2. Preflight steps on the clones

| Step | Result |
|---|---|
| Identity | `current_database()` = the clone, port 55432 |
| Status before | exactly the two migrations pending |
| SQL review | 070000: 4 `CREATE TABLE` (with CHECKs), 18 `CREATE INDEX` on the new tables, 1 FK `PlatformUserAccess.userId → User` (ON DELETE CASCADE). No statement touches an existing table. 070100: one `CREATE INDEX CONCURRENTLY` on `AuditEvent`. No DROP / DELETE / UPDATE / TRUNCATE / ALTER of an existing table. |
| Fingerprints before | `table-fingerprints.js`: per-table row count + md5 over every row, 245 tables |
| Apply | `prisma migrate deploy`: exit 0, both applied (`applied_steps_count` 1 each); the clone's API was **online** during the apply on `_pa2` |
| Repeat | second `migrate deploy`: exit 0, "No pending migrations"; `migrate status`: up to date |
| Index | `AuditEvent_occurredAt_idx` valid and ready; `check-invalid-indexes.js`: none |
| Fingerprints after | 249 tables; **0 existing tables changed** (all 245 md5 identical); 4 new tables, all empty |
| Atomicity / recovery of 070000 | an injected failure after every statement left **no** new table; Prisma then refused further deploys (P3009); `migrate resolve --rolled-back` + deploy succeeded |
| Recovery of 070100 | see §3 D |
| Prisma generate | `npm run prisma:generate` (guarded): branch client 249 models, written only into this worktree's private client; the shared client cert/integration load is byte-unchanged and still file-equivalent to a reference generated from the cert schema |

## 3. Integrity baseline (clone `_pa2`)

Before the migration, then after it with the integration API code, then
after it with this branch's API code (each API on :5491 against the clone,
workers and schedulers off):

| Check | Before | After (integration code) | After (branch code) |
|---|---|---|---|
| Membership sentinel | PASS (snapshot) | PASS — 0 changes, 0 created | PASS — 0 changes, 0 created |
| Subscription invariants (current expectation file) | 24/24 PASS | 24/24 PASS | 24/24 PASS |
| Bulk-write fingerprint | PASS | PASS | PASS |
| Composite tenant keys | 132 checks, 0 mismatches | 133, 0 (the extra check is `ProductEvent (projectId, orgId) → Project`, 0 rows) | 133, 0 |
| Financial snapshot (certified project 0ce999f2) | 36/36 | 36/36 | 36/36 |
| Reconciliation | 16/16 lines, delta 0.00 | 16/16, delta 0.00 — rows identical | 16/16, delta 0.00 — rows identical |
| Certified EV | PV 0, EV 120,000, AC 0, EAC 641,500 | identical | identical |

## 4. AuditEvent index at production scale

Volumes for reference: integration 32,164 AuditEvent rows (50 MB); the
100-company certification database ~31,700 live rows (467 MB with bloat).
Test: **2,000,000 rows (1.1 GB)** on a throwaway database, a writer inserting
one AuditEvent row every 20 ms during each build, `pg_locks` sampled every
100 ms. (A 5,000,000-row run was stopped part-way at 2.5 M rows: loading it
saturated the shared disk while the certification API was running on the
same machine, so the test was not allowed to compete with it.)

| | Plain `CREATE INDEX` (the original migration) | `CREATE INDEX CONCURRENTLY` (070100) |
|---|---|---|
| Build time | 2.2 s | 3.1 s |
| Lock held on AuditEvent | `ShareLock` | `ShareUpdateExclusiveLock` |
| Writes during the build | **0** — every insert waited for the whole build | **103** |
| Writer latency during the build | blocked for the build | p95 8 ms, max 13 ms |
| Samples with a blocked writer | 20 (all) | 0 |

Build time scales roughly linearly with rows, so the plain build would block
every write to AuditEvent — i.e. most writes in the product, which audit as
they go — for the whole build; the concurrent build blocks none.

Failure / retry (proved on the same database):

- **C** A cancelled concurrent build leaves `AuditEvent_occurredAt_idx`
  INVALID (`indisvalid = false`). `CREATE INDEX … IF NOT EXISTS` would then
  *silently skip* it and leave it invalid — so 070100 deliberately has **no**
  `IF NOT EXISTS`: a retry fails loudly ("already exists").
- **D** The real migration file through `prisma migrate deploy`, cancelled
  mid-build: deploy exits 1 (P3018), the migration row is failed, the index is
  INVALID, and a plain retry is refused (P3009). Recovery:
  `DROP INDEX CONCURRENTLY IF EXISTS "AuditEvent_occurredAt_idx";` →
  `npx prisma migrate resolve --rolled-back 20261005070100_audit_event_occurred_at_idx` →
  `npx prisma migrate deploy` (7 s) → index valid and ready.
- Prisma runs a single-statement migration file outside a transaction block,
  which is what lets `CONCURRENTLY` run inside `migrate deploy` (proved: both
  clones and the 2 M-row database).

## 5. Final migration strategy

1. Run the preflight (docs/qa/OCTAPM_MIGRATION_PREFLIGHT.md) against the
   target, including a backup, as for every migration.
2. `npx prisma migrate deploy` applies 070000 (one transaction, new tables
   only, sub-second) and then 070100 (concurrent index; writes continue).
   No maintenance window is needed for either.
3. Immediately after: `node scripts/db/check-invalid-indexes.js` must print
   "No invalid indexes." If 070100 failed or was interrupted, recover with the
   three commands in §4 D.
4. Do not put another statement into 070100 (a second statement would run the
   file as one transaction and `CONCURRENTLY` would be refused), and never add
   `IF NOT EXISTS` to it.
5. On a table far larger than tested, the concurrent build waits for
   transactions already open on AuditEvent before each phase; run it outside
   long-running batch jobs.
