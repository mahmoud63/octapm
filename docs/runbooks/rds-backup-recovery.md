# RDS Backup and Recovery Runbook

TASK-P0-devops-enable-rds-backups-and-recovery / F-007 is a production blocker. Production source-of-truth release is blocked until automated backups are enabled, the CI infrastructure gate passes, and a restore rehearsal is accepted by DevOps and Database owners.

## Recovery Targets

| Target | Value | Evidence Required |
|---|---:|---|
| Automated backup retention | 7 days minimum | `backup_retention_period` from Terraform plan or AWS describe output |
| RPO | 24 hours maximum | Latest restorable time or restore snapshot timestamp |
| RTO | 4 hours maximum | Timed restore rehearsal from start to smoke-test pass |
| Final snapshot | Required | Final snapshot identifier includes generated suffix |

## Terraform Controls

- `aws_db_instance.main.backup_retention_period = var.rds_backup_retention_days`.
- `rds_backup_retention_days` rejects values below 7 and above 35.
- `delete_automated_backups = false` preserves automated backups after instance deletion.
- `skip_final_snapshot = false` requires a final snapshot before deletion.
- `final_snapshot_identifier` includes `random_id.db_final_snapshot_suffix.hex`.
- `copy_tags_to_snapshot = true` keeps environment, RPO, RTO, and blocker tags on snapshots.
- `Quality Gates / Infrastructure - RDS backup validation` runs the positive/negative policy self-test and validates the live Terraform.

## Pre-Release Restore Rehearsal

Run this rehearsal before source-of-truth release and at least monthly while production is active. Use a restore-test DB identifier that cannot be confused with production.

```bash
aws rds describe-db-instances \
  --db-instance-identifier pmcopilots-db \
  --query "DBInstances[0].{BackupRetentionPeriod:BackupRetentionPeriod,LatestRestorableTime:LatestRestorableTime,DeletionProtection:DeletionProtection,CopyTagsToSnapshot:CopyTagsToSnapshot}"
```

```bash
RESTORE_ID="pmcopilots-restore-test-$(date -u +%Y%m%d%H%M)"

aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier pmcopilots-db \
  --target-db-instance-identifier "$RESTORE_ID" \
  --use-latest-restorable-time \
  --db-subnet-group-name pmcopilots-db-subnet-group \
  --no-publicly-accessible

aws rds wait db-instance-available --db-instance-identifier "$RESTORE_ID"
```

After the restore is available:

1. Attach the same private RDS security group if the restored instance did not inherit the expected group.
2. Point a staging backend `DATABASE_URL` at the restored DB.
3. Run `npx prisma migrate status` from `backend`.
4. Run `npm run smoke:deploy --workspace=backend` against the staging backend with a realistic smoke project.
5. Manually verify one construction scenario: project, BOQ item, approved activity allocation, progress approval, EV report, IPC period, and one document or claim record.
6. Record start time, restore-available time, smoke-pass time, latest restorable time, RPO result, RTO result, tester, and evidence links in the go-live gate.

Clean up the restore-test instance after evidence is captured:

```bash
aws rds delete-db-instance \
  --db-instance-identifier "$RESTORE_ID" \
  --skip-final-snapshot \
  --delete-automated-backups
```

## Corruption or Operator-Error Recovery

1. Freeze writes by stopping the backend service or putting the API behind maintenance mode.
2. Capture a manual snapshot of the current production DB for forensic preservation.
3. Identify the last known-good timestamp with Business, PM, and Database owners.
4. Restore to a new DB instance from the latest safe point-in-time or snapshot.
5. Run Prisma migrate status and backend smoke tests against the restored DB.
6. Compare representative project, BOQ, progress, cost, IPC, procurement, document, and claim records with the expected recovery point.
7. Update the production database endpoint or secret owner record only after DevOps and Database owners accept the restored state.
8. Restart the backend, run authenticated deployment smoke, and record any data gap against the RPO.

## Acceptance Evidence Template

| Field | Value |
|---|---|
| Rollout commit SHA | TBD |
| Quality Gates run URL | TBD |
| Terraform plan/apply evidence | TBD |
| Backup retention from AWS | TBD |
| Latest restorable time | TBD |
| Restore-test DB identifier | TBD |
| Restore started at | TBD |
| Restore available at | TBD |
| Smoke passed at | TBD |
| RPO observed | TBD |
| RTO observed | TBD |
| Construction scenario checked | TBD |
| DevOps owner signoff | TBD |
| Database owner signoff | TBD |
