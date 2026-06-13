# Monitoring And Alert Evidence Checklist

Status: pending. Terraform-managed monitoring configuration must be proven by
alert delivery evidence before controlled pilot or production use.

| Field | Value |
| --- | --- |
| Environment |  |
| Commit SHA |  |
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

## Signoff

| Owner | Decision | Name/date | Issues found |
| --- | --- | --- | --- |
| DevOps | Pending / Accepted / Rejected |  |  |
| Security | Pending / Accepted / Rejected |  |  |
| QA | Pending / Accepted / Rejected |  |  |
