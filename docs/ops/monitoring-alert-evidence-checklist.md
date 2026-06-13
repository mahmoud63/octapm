# Monitoring And Alert Evidence Checklist

Status: pending. Terraform-managed monitoring configuration must be proven by
alert delivery evidence before controlled pilot or production use.

Current local evidence check on 2026-06-13 found no AWS/cloud credentials,
alert-channel access, staging smoke variables, or safe alert target in the
shell. Monitoring/alert rehearsal was therefore not run.

| Field | Value |
| --- | --- |
| Environment |  |
| Commit SHA | `5c512a023166ca2b1e3dab6d31d06383f5582efb` baseline; replace with final release SHA when executed |
| Alert topic/channel |  |
| Date/time started |  |
| Date/time completed |  |
| Operator |  |
| Reviewer |  |

## Required Alerts

| Alert | Trigger/action performed | Evidence artifact | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| API health/readiness failure |  | Screenshot/log/notification |  |  |
| Backend 5xx/error-rate alarm |  | Screenshot/log/notification |  |  |
| RDS CPU/storage/connections alarm |  | Screenshot/log/notification |  |  |
| RDS backup/restore failure path |  | Screenshot/log/notification |  |  |
| Deployment smoke failure |  | Workflow/notification output |  |  |
| Security validator failure |  | Workflow/notification output |  |  |

## Missing Prerequisites Before This Can Run

- Confirmed SNS/email/Slack or incident channel recipient.
- Staging backend/API target where safe failures can be triggered.
- CloudWatch alarm names or synthetic monitor configuration.
- Operator permission to trigger and reset safe alert conditions.
- Evidence storage path for screenshots/logs.

## Signoff

| Owner | Decision | Name/date | Issues found |
| --- | --- | --- | --- |
| DevOps | Pending / Accepted / Rejected |  |  |
| Security | Pending / Accepted / Rejected |  |  |
| QA | Pending / Accepted / Rejected |  |  |
