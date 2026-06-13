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
- `aws_db_instance.main.multi_az = var.rds_multi_az`.
- Production Terraform plans fail when `environment` is `prod` or `production` and `rds_multi_az` is disabled.
- `delete_automated_backups = false` preserves automated backups after instance deletion.
- `skip_final_snapshot = false` requires a final snapshot before deletion.
- `final_snapshot_identifier` includes `random_id.db_final_snapshot_suffix.hex`.
- `copy_tags_to_snapshot = true` keeps environment, RPO, RTO, and blocker tags on snapshots.
- `alarm_notification_email` subscribes the DevOps alert mailbox to the CloudWatch alarm SNS topic.
- Production Terraform plans fail when `environment` is `prod` or `production` and `alarm_notification_email` is empty.
- `Quality Gates / Infrastructure - security and resilience validation` runs RDS backup validation and deployment readiness validation.

## Deployment Rehearsal Inputs

Configure these GitHub Environment values before staging or production deploys. Use Terraform outputs for the AWS resource identifiers and host values.

| Name | Source | Notes |
|---|---|---|
| `AWS_REGION` | Terraform variable/output | Primary runtime region. |
| `AWS_ROLE_ARN` | Terraform `github_actions_role_arn` output | Store as an environment secret. |
| `VITE_API_URL` | Release environment | Public API URL injected into the SPA build. |
| `FRONTEND_URL` | Release environment | Public app origin used by backend CORS/security validation. |
| `CORS_ALLOWED_ORIGINS` | Release environment | Comma-separated approved HTTPS origins. |
| `S3_SPA_BUCKET` | Terraform `s3_spa_bucket` output | Static SPA deployment target. |
| `S3_UPLOADS_BUCKET` | Terraform `s3_uploads_bucket` output | Runtime private upload bucket. |
| `CF_DISTRIBUTION_ID` | Terraform `cloudfront_distribution_id` output | Cache invalidation target. |
| `APP_SECRETS_ARN` | Terraform `secrets_manager_arn` output | Runtime app secret; ARN is configured as an environment variable, secret values stay in AWS Secrets Manager. |
| `DB_HOST` | Terraform `rds_endpoint` output | Host only, no password. |
| `DB_NAME`, `DB_USERNAME`, `DB_PORT` | Terraform variables/outputs | Used to assemble `DATABASE_URL` during deploy. |
| `EC2_HOST`, `EC2_SSH_KEY` | EC2 output and deploy key | Store both as environment secrets when host disclosure is restricted. |
| `EC2_USER`, `EC2_APP_DIR`, `PM2_APP_NAME`, `BACKEND_PORT`, `SMOKE_BASE_URL` | Release environment | Environment-specific backend deploy settings. |
| `SMOKE_REQUIRE_AUTHENTICATED`, `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `SMOKE_PROJECT_ID` | Smoke-test project | Production must set authenticated smoke to `true`; password is an environment secret. |

Run staging rehearsal through the manual `Deploy` workflow with `deploy_environment = staging` and record the workflow URL, commit SHA, smoke output, and rollback result below before promoting the same commit to production.

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

## Deployment and Migration Rollback Plan

Use this plan for a failed deployment, failed post-deploy smoke, or failed migration rehearsal.

1. Stop external traffic by disabling the CloudFront distribution behavior or placing the backend in maintenance mode.
2. Preserve evidence: record deploy workflow URL, commit SHA, failed command output, CloudWatch alarm state, and application logs.
3. For staging application-only failure, rerun the manual `Deploy` workflow against the last known-good commit and the same staging GitHub Environment. For production, redeploy only through the approved `Quality Gates` to `Deploy` workflow path, or rerun an already validated production deployment for the last known-good commit.
4. For migration failure before writes resume, stop the PM2 backend, restore the pre-deploy RDS snapshot or point-in-time restore to a replacement instance, and update `DB_HOST` only after DevOps and Database owners accept the restored state.
5. Run `npx prisma migrate status`, backend production env validation, and authenticated `npm run smoke:deploy --workspace=backend` against the restored or rolled-back backend.
6. Re-enable traffic only after smoke checks pass and Product/QA confirm no source-of-truth records were lost.
7. Record the rollback start time, recovery time, commit restored, DB restore identifier if used, smoke result, and owner signoff in the evidence packet.

## Monitoring and Alerting Validation

CloudWatch alarms managed in Terraform:

- EC2 CPU high.
- EC2 status check failure.
- RDS CPU high.
- RDS free storage low.
- CloudFront 5xx error rate high.

Release readiness requires:

1. `alarm_notification_email` is set in production Terraform variables.
2. The SNS email subscription is confirmed by the DevOps mailbox owner after `terraform apply`.
3. A test alarm or temporary threshold exercise reaches the alert mailbox.
4. CloudWatch log group `/pmcopilots/api` is receiving backend logs after deployment.
5. Evidence is attached in the go-live gate with alarm name, timestamp, recipient, and screenshot or AWS CLI output.

## Corruption or Operator-Error Recovery

1. Freeze writes by stopping the backend service or putting the API behind maintenance mode.
2. Capture a manual snapshot of the current production DB for forensic preservation.
3. Identify the last known-good timestamp with Business, PM, and Database owners.
4. Restore to a new DB instance from the latest safe point-in-time or snapshot.
5. Run Prisma migrate status and backend smoke tests against the restored DB.
6. Compare representative project, BOQ, progress, cost, IPC, procurement, document, and claim records with the expected recovery point.
7. Update the production database endpoint or secret owner record only after DevOps and Database owners accept the restored state.
8. Restart the backend, run authenticated deployment smoke, and record any data gap against the RPO.

## Acceptance Evidence Packet

Repository-controlled controls completed by `TASK-P1-DEVOPS-001`:

| Control | Evidence |
|---|---|
| Deployment workflow parameterization | `.github/workflows/deploy.yml` reads deploy URLs, AWS identifiers, DB host/name/user/port, bucket names, PM2 name, app directory, smoke settings, and app secret ARN from the selected GitHub Environment. |
| Hardcoded Secrets Manager ARN removed | Deploy workflow uses `APP_SECRETS_ARN` and `AWS_REGION` instead of an inline ARN/region. |
| Environment-specific `.env` generation parameterized | Runtime `DATABASE_URL`, CORS, frontend URL, AWS region, and upload bucket are built from deploy variables plus AWS Secrets Manager values. |
| Deployment smoke guard | Production deploys fail unless `SMOKE_REQUIRE_AUTHENTICATED=true`; smoke user/project values are required when enabled. |
| RDS availability guard | `rds_multi_az` defaults to `true`; production Terraform plans fail if it is disabled. |
| Monitoring guard | `alarm_notification_email` is a Terraform-managed SNS email subscription; production Terraform plans fail if it is omitted. |
| Quality Gate guard | `npm run infra:validate:deployment-readiness` validates the deployment workflow, RDS Multi-AZ guard, and monitoring subscription policy. |

Cloud evidence required before production source-of-truth approval:

| Field | Required Recorded Value |
|---|---|
| Rollout commit SHA | Exact commit deployed from `Quality Gates`. |
| Quality Gates run URL | Successful run URL for the rollout commit. |
| Deploy workflow URL | Staging rehearsal and production deploy workflow URLs. |
| Terraform plan/apply evidence | Plan/apply showing backup retention, Multi-AZ, final snapshot, alarm email subscription, and no public RDS access. |
| Backup retention from AWS | AWS CLI output showing retention is at least seven days. |
| Latest restorable time | AWS CLI output from `describe-db-instances`. |
| Restore-test DB identifier | Unique restore-test identifier. |
| Restore started at | UTC timestamp. |
| Restore available at | UTC timestamp. |
| Smoke passed at | UTC timestamp and smoke command output. |
| RPO observed | Difference between selected recovery point and latest accepted write. |
| RTO observed | Restore start to smoke-test pass duration. |
| Construction scenario checked | Project, BOQ, allocation, progress approval, EV report, IPC, and document/claim verification evidence. |
| Rollback rehearsal result | Last known-good commit or DB restore rehearsal result with timing. |
| Monitoring alert evidence | SNS subscription confirmation and alert receipt evidence. |
| DevOps owner signoff | Named owner, date, decision, and evidence link. |
| Database owner signoff | Named owner, date, decision, and evidence link. |
