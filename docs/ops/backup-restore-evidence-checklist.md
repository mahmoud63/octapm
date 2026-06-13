# Backup And Restore Evidence Checklist

Status: pending. Static Terraform and repository validators are not a substitute
for a live backup/restore rehearsal.

Current local evidence check on 2026-06-13 found no AWS profile, AWS access key,
AWS role ARN, staging smoke variables, or RDS restore target information in the
shell. Restore rehearsal was therefore not run.

| Field | Value |
| --- | --- |
| Environment |  |
| Commit SHA | `5c512a023166ca2b1e3dab6d31d06383f5582efb` baseline; replace with final release SHA when executed |
| Database identifier |  |
| Backup/snapshot identifier |  |
| Restore target identifier |  |
| Date/time started |  |
| Date/time completed |  |
| Operator |  |
| Reviewer |  |

## Required Actions

| Step | Command/action performed | Evidence artifact | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| Confirm automated backup retention |  | Screenshot/log |  |  |
| Confirm Multi-AZ setting for production |  | Terraform plan or AWS evidence |  |  |
| Create or select restore point |  | Snapshot/backup ID |  |  |
| Restore into isolated target |  | AWS event/log |  |  |
| Run migrations or compatibility checks |  | Command output |  |  |
| Run authenticated backend smoke |  | Command output |  |  |
| Run construction scenario smoke |  | Evidence file/screenshots |  |  |
| Record RPO/RTO |  | Time measurement |  |  |
| Destroy or quarantine restored target |  | Confirmation |  |  |

## Missing Prerequisites Before This Can Run

- AWS/cloud permissions for staging RDS snapshot or point-in-time restore.
- Source database identifier and restore target naming convention.
- Staging app configuration that can point at the restored database.
- Smoke-test URL and non-secret test account identifiers.
- Operator and reviewer assigned for DevOps/Database/QA signoff.

## Signoff

| Owner | Decision | Name/date | Issues found |
| --- | --- | --- | --- |
| DevOps | Pending / Accepted / Rejected |  |  |
| Database | Pending / Accepted / Rejected |  |  |
| QA | Pending / Accepted / Rejected |  |  |
