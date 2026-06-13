# Rollback Evidence Checklist

Status: pending. A rollback plan exists, but controlled pilot approval requires
evidence that it was rehearsed against the target environment.

| Field | Value |
| --- | --- |
| Environment |  |
| Rollout commit SHA |  |
| Rollback target SHA or artifact |  |
| Date/time started |  |
| Date/time completed |  |
| Operator |  |
| Reviewer |  |

## Required Actions

| Step | Command/action performed | Evidence artifact | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| Confirm rollback target exists |  | Release artifact/SHA |  |  |
| Record pre-rollback health |  | Health/readiness output |  |  |
| Execute frontend rollback |  | Deploy log |  |  |
| Execute backend rollback |  | Deploy/PM2 log |  |  |
| Validate DB migration compatibility |  | Migration/restore decision |  |  |
| Run authenticated smoke |  | Command output |  |  |
| Confirm monitoring clears |  | Alert dashboard screenshot |  |  |
| Record user-facing impact |  | Incident notes |  |  |

## Signoff

| Owner | Decision | Name/date | Issues found |
| --- | --- | --- | --- |
| DevOps | Pending / Accepted / Rejected |  |  |
| QA | Pending / Accepted / Rejected |  |  |
| Product | Pending / Accepted / Rejected |  |  |
