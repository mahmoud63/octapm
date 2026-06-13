# Security And Permissions Readiness

## Security Summary
The project has meaningful security architecture: JWT auth, refresh sessions, RBAC, project access middleware, helmet, CORS controls, rate limiting, production environment validation, file storage validation, and secret hygiene tooling. The current release still fails security readiness because the secret hygiene validator crashes, the source baseline is dirty, party-scoped workflow access is broken in tests, and production secret evidence was not available.

| Security ID | Finding | Severity | Evidence | Impact | Required Fix | Related Task |
|---|---|---|---|---|---|---|
| SEC-001 | Party-scoped workflow access can throw runtime TypeError | Critical | company-party.service.js:665-711; rfi.service.js:375; submittal.service.js:406 | External consultant/subcontractor workflows can fail and possibly bypass structured authorization behavior | Normalize projectAccess and add negative tests | TASK-P0-BE-001 |
| SEC-002 | Backend release suite failed | Critical | Backend Jest: 4 failed suites, 7 failed tests | Security and permission regressions cannot be ruled out | Restore green backend suite | TASK-P0-QA-001 |
| SEC-003 | Secret hygiene validator crashes before scan | Critical | package.json:14-15; validate-secret-hygiene.mjs:117-123; ENOENT on missing tracked task file | Cannot prove no secrets are present | Repair tracked baseline and scanner behavior | TASK-P0-DEVOPS-001 |
| SEC-004 | Dirty release baseline includes tracked deletions and private document paths | Critical | git status before docs showed many source changes and deleted private-document files | Release provenance and private-file controls cannot be certified | Clean branch and resolve tracked artifacts | TASK-P0-REL-001 |
| SEC-005 | Full permission negative UAT not executed live | High | quality-gates.yml:149-160 can skip live UAT when URLs absent | Cross-project/company access leaks may remain undetected | Run configured staging UAT | TASK-P1-QA-002 |
| SEC-006 | Production secret/config evidence unavailable | High | security.js:8-13 and 158-188 define required production checks | Production deployment cannot be security-signed | Complete secret evidence without exposing values | TASK-P1-SEC-001 |
| SEC-007 | Production email/notification delivery Cannot Verify | High | email.service.js:65-66 local fallback | Password reset, assignment, approval, and overdue notices may fail | Configure provider and smoke tests | TASK-P1-NOTIF-001 |
| SEC-008 | File access controls need live staging verification | High | doc-control routes mounted at projects.js:367; ProjectDocument model at schema.prisma:1004 | Document leakage would be severe in construction projects | Run file upload/download negative tests | TASK-P1-QA-002 |

## Authentication Findings
Authentication code exists and appears mature. Refresh-token and password-reset evidence still depends on passing tests and configured email provider.

## Authorization Findings
RBAC and project access middleware exist. The critical issue is party-scoped workflow null safety and the lack of live negative UAT evidence.

## Role/Permission Findings
shared/permissions.json and ProjectPermissionProvider support role-based UX and API checks. Permission coverage must be verified for all eight target roles and external parties.

## Project/Company Isolation Findings
Project access is applied broadly in backend/src/routes/projects.js. Company/org isolation appears modeled, but tenant isolation must be proven with negative tests on a clean release branch.

## File Security Findings
Private storage validation passed in prior checks, but secret hygiene failed and live file access UAT was not available. Do not certify document control until file access negative tests pass.

## API Security Findings
helmet, CORS, and rate limiting are mounted in backend/src/app.js:55-68. Production CORS and secret configuration require final evidence.

## Secrets/Config Findings
No secret values are printed in this report. The risk is the inability to complete the validator and evidence trail, not a specific exposed value in the audit output.

## Security Launch Blockers
SEC-001 through SEC-004 are P0 blockers. SEC-005 through SEC-008 are P1 blockers before serious external onboarding.
