# Backup And Restore Evidence Checklist

Status: pending. Static Terraform and repository validators are not a substitute
for a live backup/restore rehearsal.

| Field | Value |
| --- | --- |
| Environment |  |
| Commit SHA |  |
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

## Signoff

| Owner | Decision | Name/date | Issues found |
| --- | --- | --- | --- |
| DevOps | Pending / Accepted / Rejected |  |  |
| Database | Pending / Accepted / Rejected |  |  |
| QA | Pending / Accepted / Rejected |  |  |
