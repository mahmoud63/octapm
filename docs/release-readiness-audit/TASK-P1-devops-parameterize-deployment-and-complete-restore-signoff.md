# TASK: Parameterize Deployment And Complete Restore Signoff

## Task ID
TASK-P1-DEVOPS-001

## Priority
P1

## Severity
High

## Area
DevOps

## Related Feature
TECH-DEVOPS-01, TECH-SUP-01

## Related Risk
RISK-DEVOPS-001

## Problem Summary
Deployment configuration and production operations are not fully release-ready.

## Implementation Status
Repository-controlled controls are implemented. Production source-of-truth signoff remains blocked until the staging deploy rehearsal, RDS restore drill, rollback rehearsal, monitoring alert receipt, and named owner approvals are executed in the cloud environment and attached to the go-live gate.

## Evidence
- Resolved: `.github/workflows/deploy.yml` now reads the app secret ARN, runtime URLs, DB host/name/user/port, bucket names, AWS region, app directory, PM2 name, and smoke settings from the selected GitHub Environment.
- Resolved: `.github/workflows/deploy.yml` builds backend `.env` from deploy variables plus AWS Secrets Manager values instead of hardcoded production endpoints.
- Resolved: `infrastructure/terraform/database.tf` uses `var.rds_multi_az`, and production plans fail when it is disabled.
- Resolved: `infrastructure/terraform/monitoring.tf` manages the SNS alarm email subscription, and production plans fail when no alert email is configured.
- Resolved: `docs/runbooks/rds-backup-recovery.md` now contains the restore evidence packet, rollback plan, monitoring validation requirements, and explicit signoff fields.
- Resolved: `docs/qa/go-live-readiness-gate.md` now names the required owner decisions and marks signoff status as awaiting evidence instead of open placeholders.

## Why This Blocks or Affects Launch
Production releases need repeatable deploys, backups, rollback, monitoring, and signed operational readiness.

## Business Impact
- Customer onboarding can fail.
- Data recovery may be unproven.
- Incidents may take too long to resolve.
- Enterprise buyers may reject operational controls.

## Technical Impact
Environment-specific hardcoding increases deployment mistakes and weakens disaster recovery confidence.

## Required Changes
- [x] Parameterize deployment environment values.
- [ ] Complete staging deployment rehearsal in GitHub Actions and attach workflow evidence.
- [ ] Complete backup/restore drill in AWS and attach RPO/RTO evidence.
- [x] Define rollback plan.
- [x] Configure monitoring/error tracking path through Terraform-managed CloudWatch/SNS alerts.
- [ ] Complete go-live signoffs with named Product, QA, Security, Backend, Frontend, Business, DevOps, and Database owners.

## Suggested Implementation Approach
- Frontend changes: verify production config injection.
- Backend changes: ensure health checks and config validation.
- Database changes: test backup/restore and migration rollback.
- API changes: expose health endpoints if needed.
- Permission changes: restrict deploy secrets.
- Test changes: deployment smoke tests.
- Documentation changes: update runbooks and signoff packet.

## Acceptance Criteria
- [x] Deployment workflow is environment-parameterized.
- [ ] Restore drill completed and documented with cloud evidence.
- [ ] Rollback plan tested in staging/cloud rehearsal.
- [ ] Monitoring alerts active and receipt confirmed by DevOps mailbox owner.
- [ ] Go-live signoffs complete.

## Testing Requirements
- Deployment readiness validator self-test and live repo check.
- Deployment smoke test during staging rehearsal.
- Backup restore test in AWS.
- Migration rollback rehearsal in AWS/staging.
- Permission test for Secrets Manager access through the EC2 instance role and GitHub OIDC deploy role.
- Manual production readiness review.
- Regression check after staging deploy.

## Dependencies
Cloud environment and DevOps owner availability.

## Risks
Infrastructure changes may require downtime or environment recreation.

## Estimated Effort
M

## Recommended Owner
DevOps Engineer
