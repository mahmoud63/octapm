# Migration preflight (local and shared databases)

**Why:** on 2026-09-29 an interrupted run applied an additive migration before anyone had confirmed a backup
(docs/finance/OCTAPM_CONTRACT_VALUE_SOURCE.md §4). The migration was harmless, but the order was wrong. This
procedure runs **before** any migration is applied to a database other than a throwaway one.

## Before applying

1. **Identity.** Confirm the target: `select current_database(), inet_server_port(),
   current_setting('data_directory')`. It must match the environment you intend (the shared local database is
   `octapm_verify` on port 55432 with data in `C:/Temp/octapm-pg`). Never infer the target from a `.env` alone.
2. **Status.** Run `npx prisma migrate status` and read what is pending. Only the migration you mean to apply may
   be pending.
3. **SQL review.** Read the migration's SQL. It must be additive (new tables, nullable columns, new indexes)
   unless the owner has approved otherwise. A destructive statement is a stop condition.
4. **Throwaway proof.** Apply the earlier migrations and then this one to a throwaway database, with fixture
   rows, and compare every pre-existing column before and after (see the contract-value proof for the pattern).
   Drop the throwaway database afterwards.
5. **Backup.** Take a recoverable backup of the target and verify it:
   - local cluster: stop it, cold-copy the whole data directory outside Git, and compare file counts and bytes
     with the source; or use the platform's backup tooling where it exists;
   - record where the backup is and how it would be restored (stop the cluster, move the data directory aside,
     copy the backup back, start).
6. **Integrity baseline.** Run the membership sentinel, the subscription invariants against the current
   expectation file, the bulk-write fingerprint, the financial snapshot and the reconciliation. Record the
   results as the "before" state.

## Applying and after

7. Apply with `npx prisma migrate deploy`, never `migrate dev`, `db push` or `migrate reset`.
8. Regenerate the Prisma client with every process holding the query-engine file stopped, and require exit 0.
9. Re-run step 6 and compare with the "before" state. Any unexpected difference stops the work.
10. A data backfill is a separate step with its own dry run, applied only to rows classified from reliable
    evidence, and never folded into the migration.

No production migration runs without the owner's explicit authorization.
