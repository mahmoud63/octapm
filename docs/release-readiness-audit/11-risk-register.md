# Risk Register

| Risk ID | Area | Risk | Severity | Probability | Impact | Evidence | Mitigation | Owner | Related Task |
|---|---|---|---|---|---|---|---|---|---|
| RISK-001 | Backend / Permissions | Party-scoped RFI/submittal workflows throw runtime errors | Critical | High | Severe | company-party.service.js:665-711; rfi.service.js:375; submittal.service.js:406; Jest TypeError | Fix null safety and add party permission tests | Backend Developer / Security Engineer | TASK-P0-BE-001 |
| RISK-002 | Backend / Workflow | Risk closeout approval rejects submitted closeouts | Critical | High | High | risk.service.js:861-878; failing risk.service.test.js | Correct state machine and tests | Backend Developer / QA Engineer | TASK-P0-BE-002 |
| RISK-003 | Testing | Backend Jest gate is red | Critical | High | Severe | 4 failed suites, 7 failed tests | Restore green backend suite | QA Engineer | TASK-P0-QA-001 |
| RISK-004 | Frontend | Frontend lint gate is red | Critical | High | High | 4 lint errors, 22 warnings | Fix lint errors and rerun build | Frontend Developer | TASK-P0-FE-001 |
| RISK-005 | Security / DevOps | Secret hygiene validator crashes before scanning | Critical | High | Severe | validate-secret-hygiene.mjs:117-123; ENOENT on missing tracked file | Repair tracked baseline and scanner | Security Engineer / DevOps Engineer | TASK-P0-DEVOPS-001 |
| RISK-006 | Release Management | Dirty source tree prevents release certification | Critical | High | Severe | git status showed many modified/deleted/untracked files before docs | Establish clean release branch | Product Manager / DevOps Engineer | TASK-P0-REL-001 |
| RISK-007 | QA / Product | Live staging UAT not verified | High | Medium | High | quality-gates.yml:149-160 can skip UAT when URLs absent | Run configured staging UAT | QA Engineer / Product Manager | TASK-P1-QA-002 |
| RISK-008 | DevOps | Terraform/deployment smoke evidence incomplete | High | Medium | High | Terraform unavailable locally; quality-gates.yml:183-230 | Run CI Terraform and staging deploy smoke | DevOps Engineer | TASK-P1-DEVOPS-002 |
| RISK-009 | Notifications | Production email delivery not proven | High | Medium | High | email.service.js:65-66 local fallback | Configure provider and run smoke tests | Backend Developer / DevOps Engineer | TASK-P1-NOTIF-001 |
| RISK-010 | Security | Production secret/config signoff incomplete | High | Medium | Severe | security.js:8-13 and 158-188; release-checklist.md:28,41 | Complete secret evidence without values | Security Engineer | TASK-P1-SEC-001 |
| RISK-011 | Performance / UX | Oversized project detail bundle affects field users | High | Medium | Medium | Vite warning about 850.46 kB project chunk; project-detail.tsx:6-24 | Lazy-load heavy modules | Frontend Developer | TASK-P1-PERF-001 |
| RISK-012 | Documentation | Missing root production setup documentation | High | Medium | Medium | Root README.md missing; frontend README is frontend-focused | Add root README and launch guide | Product Manager / Technical Writer | TASK-P1-DOC-001 |
| RISK-013 | UX / QA | Mobile/tablet and accessibility field readiness not verified | Medium | Medium | Medium | Responsive code exists but no live evidence | Run field device and accessibility QA | UX/UI Designer / QA Engineer | TASK-P2-UX-001 |
| RISK-014 | Product / Commercial | Pilot limits and onboarding controls not formalized | Medium | Medium | Medium | release-checklist.md requires go-live signoff; P0/P1 gaps remain | Formalize pilot limits and support process | Product Manager / Support Lead | TASK-P2-PROD-001 |
