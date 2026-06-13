# Live UAT Evidence Checklist

Status: pending. Manifest validation alone is not live UAT evidence and does not
clear OCTAPM / PMcopilots for a controlled pilot.

Current local evidence check on 2026-06-13 found no `UAT_BASE_URL`,
`UAT_API_BASE_URL`, seeded UAT account variables, smoke-test variables, or cloud
credentials in the shell. Live UAT was therefore not run.

## Release Context

| Field | Value |
| --- | --- |
| Environment |  |
| Staging frontend URL |  |
| Staging API URL |  |
| Commit SHA | `5c512a023166ca2b1e3dab6d31d06383f5582efb` baseline; replace with final release SHA when executed |
| Date/time started |  |
| Date/time completed |  |
| UAT operator |  |
| QA reviewer |  |
| Product approver |  |

## Test Accounts

| Persona | Email/account ID | Role | Project access | Result |
| --- | --- | --- | --- | --- |
| PM |  | Project Manager | Assigned |  |
| Planning Engineer |  | Planning Engineer | Assigned |  |
| QS |  | Quantity Surveyor | Assigned |  |
| Cost Controller |  | Cost Controller | Assigned |  |
| Procurement |  | Procurement | Assigned |  |
| Warehouse |  | Warehouse | Assigned |  |
| Site Engineer |  | Site Engineer | Assigned |  |
| Finance |  | Finance | Assigned |  |
| External party |  | Party-scoped user | Limited |  |
| Unassigned negative user |  | Any non-assigned role | None |  |

## Browser And Device Matrix

| Device/browser | Viewport or device | Required evidence | Result |
| --- | --- | --- | --- |
| Desktop Chrome | 1440x900 | Screenshots and JSON evidence |  |
| Desktop Edge | 1440x900 | Screenshots and JSON evidence |  |
| Tablet | 768x1024 | Screenshots for field workflows |  |
| Mobile | 390x844 | Screenshots for field workflows |  |

## Command

Run against the staging URLs for the exact release commit:

```bash
UAT_BASE_URL=<staging-frontend-url> UAT_API_BASE_URL=<staging-api-url> UAT_EVIDENCE_DIR=docs/release-readiness-audit/evidence npm run test:e2e:uat
```

If seeded fixtures are used:

```bash
UAT_BASE_URL=<staging-frontend-url> UAT_API_BASE_URL=<staging-api-url> UAT_EVIDENCE_DIR=docs/release-readiness-audit/evidence npm run test:e2e:uat -- --use-seeded-fixtures
```

## Required Flows

| Flow | Required evidence | Pass/Fail | Notes |
| --- | --- | --- | --- |
| Admin creates project | API log, screenshot, project ID |  |  |
| BOQ upload and validation | Upload result, validation report |  |  |
| BOQ-to-activity allocation | Allocation approval evidence |  |  |
| P6 XER or MSP import as draft | Import report and draft revision ID |  |  |
| Schedule revision review/activation | Approval and activation audit trail |  |  |
| Progress submission and approval | Submitted and approved progress records |  |  |
| EV dashboard review | Dashboard screenshot and source metadata |  |  |
| RFI create/respond/close | Party visibility and closeout audit |  |  |
| Submittal create/review/approve | Review/approval audit and attachments |  |  |
| Document upload/revision | Revision history and latest approved view |  |  |
| Risk closeout | Submit/approve/reopen evidence |  |  |
| IPC/payment workflow | Draft/certify/payment evidence, if in pilot scope |  |  |
| Permission-negative tests | 403/404 results for cross-project/cross-party attempts |  |  |
| Tablet/site daily report flow | Field screenshots and submitted report |  |  |
| Mobile/tablet quality or safety flow | Field screenshots for NCR/safety closeout |  |  |

## Missing Prerequisites Before This Can Run

- Staging frontend URL and API URL for the release commit.
- Test tenant/org and permission to create or reset a pilot test project.
- Seeded PM, Site Engineer, external-party, and negative-permission accounts.
- Safe credentials supplied by environment variables or secret manager.
- Browser dependencies installed for the runner.
- BOQ, schedule, and document fixtures approved for UAT use.

## Evidence Package

Attach or archive:

- UAT command output.
- Redacted JSON evidence file.
- Screenshots for every browser/device row.
- List of created project/activity/document/RFI/submittal/risk/IPC IDs.
- Any failed steps, defect IDs, retest evidence, and final signoff.

## Signoff

| Owner | Decision | Name/date | Notes |
| --- | --- | --- | --- |
| QA | Pending / Accepted / Rejected |  |  |
| Product | Pending / Accepted / Rejected |  |  |
| Security | Pending / Accepted / Rejected |  |  |
| Delivery/Implementation | Pending / Accepted / Rejected |  |  |
