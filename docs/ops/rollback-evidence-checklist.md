# Rollback Evidence Checklist

Status: pending. A rollback plan exists, but controlled pilot approval requires
evidence that it was rehearsed against the target environment.

Current local evidence check on 2026-06-13 found no staging deployment target,
smoke-test variables, or cloud credentials in the shell. Rollback rehearsal was
therefore not run.

| Field | Value |
| --- | --- |
| Environment |  |
| Rollout commit SHA | `5c512a023166ca2b1e3dab6d31d06383f5582efb` baseline; replace with final release SHA when executed |
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

## Missing Prerequisites Before This Can Run

- Two deployable staging release SHAs or artifacts.
- Staging GitHub Environment variables and secrets.
- Backend PM2 target and frontend CloudFront/S3 target.
- Authenticated smoke user/project identifiers.
- Migration compatibility decision for the rollback pair.

## Signoff

| Owner | Decision | Name/date | Issues found |
| --- | --- | --- | --- |
| DevOps | Pending / Accepted / Rejected |  |  |
| QA | Pending / Accepted / Rejected |  |  |
| Product | Pending / Accepted / Rejected |  |  |
