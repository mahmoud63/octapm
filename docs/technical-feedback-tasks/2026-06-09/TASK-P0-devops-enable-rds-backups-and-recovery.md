# TASK-P0-devops-enable-rds-backups-and-recovery

## Status

Implementation added; go-live evidence remains required before production source-of-truth release.

## Changes

- Enabled Terraform-managed RDS automated backups with a validated seven-day minimum retention.
- Preserved automated backups after DB instance deletion.
- Required final snapshots and replaced the static final snapshot name with a generated unique suffix.
- Copied tags to snapshots and added RPO/RTO/production-blocker tags for traceability.
- Added `infrastructure/scripts/validate-rds-backups.mjs` with positive and negative policy self-tests.
- Added the RDS backup validation job to `Quality Gates` and deployment readiness.
- Added the RDS backup and recovery runbook with restore rehearsal, rollback, RPO, and RTO evidence.

## Verification

- `node infrastructure/scripts/validate-rds-backups.mjs --self-test`
- `node infrastructure/scripts/validate-rds-backups.mjs`
- Manual restore rehearsal remains pending and must be recorded in `docs/qa/go-live-readiness-gate.md`.
