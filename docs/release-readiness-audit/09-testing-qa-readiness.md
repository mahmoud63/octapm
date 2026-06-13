# Testing And QA Readiness

## Existing Test Coverage
The repository contains substantial backend tests, frontend lint/type/build checks, OpenAPI validation, Prisma validation, infrastructure validators, and UAT manifest tooling. This is positive, but a release gate is only useful when it is green.

## Build / Lint / Type / Validation Results
| Check | Result | Evidence | Launch Meaning |
|---|---|---|---|
| Backend Jest | Failed | 75 suites total, 4 failed, 71 passed; 1066 tests total, 7 failed | P0 blocker |
| Backend Prisma validate | Passed | Prisma schema valid | Positive but not sufficient |
| Backend OpenAPI validate | Passed | 255 documented paths validated | Positive but not sufficient |
| Frontend TypeScript build | Passed | tsc -b completed | Positive |
| Frontend ESLint | Failed | 4 errors, 22 warnings | P0 blocker |
| Frontend Vite build | Passed with warning | Project chunk about 850.46 kB | P1 performance issue |
| UAT manifest validation | Passed | 5 flows, 8 personas, 3 negative permission tests in manifest | Live staging UAT still needed |
| Secret hygiene validator | Failed | ENOENT for missing tracked frontend task file | P0 blocker |
| Private storage validator | Passed | Validator completed | Positive |
| Terraform validate | Cannot Verify | Terraform not installed locally | P1 evidence gap |

## Missing Test Areas
- Full staging UAT against live frontend/API URLs.
- External consultant/subcontractor party workflow negative tests after P0 fix.
- Financial visibility tests by role.
- File upload/download/preview permission tests.
- Mobile/tablet field workflow tests.
- Accessibility checks.
- Deployment smoke and rollback rehearsal.
- Production email notification delivery checks.

## Manual QA Checklist
Use 15-qa-uat-checklist.md as the practical tester checklist. No external users should be onboarded until all P0 checklist failures are closed and P1 items are either complete or risk-accepted.

## UAT Checklist
UAT must cover PM, planning engineer, QS, cost controller, procurement, warehouse, site engineer, finance, consultant, and subcontractor personas. It must include permission-negative tests across companies/projects.

## Regression Checklist
Regression must include auth, project setup, schedule import/generation, BOQ, progress/EV, RFIs, submittals, documents, cost/change orders, IPC, procurement, risks, QA/QC, safety, meetings, reports, search, notifications, and file uploads.

## Release Testing Recommendation
Do not publish. Fix P0 issues, create a clean release branch, rerun all automated gates, run live staging UAT, then hold a release gate review with Product, QA, Security, Backend, Frontend, DevOps, Support, and Business owners.
