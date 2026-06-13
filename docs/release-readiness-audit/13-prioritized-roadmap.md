# Prioritized Roadmap

## Phase 0: Must Fix Before Any External User
Tasks:
- TASK-P0-BE-001
- TASK-P0-BE-002
- TASK-P0-QA-001
- TASK-P0-FE-001
- TASK-P0-DEVOPS-001
- TASK-P0-REL-001

Dependencies:
- Clean release branch.
- No source changes outside intended fixes.
- Backend, frontend, and security owners available for rapid retest.

Expected outcome:
- The release candidate has a clean source baseline and all automated P0 quality gates pass.

Validation method:
- Backend Jest exits 0.
- Frontend lint/typecheck/build exit 0.
- Secret hygiene validation exits 0.
- git status is clean before certification.

Release gate decision:
- NO-GO remains until all Phase 0 tasks pass.

## Phase 1: Required Before Pilot Launch
Tasks:
- TASK-P1-QA-002
- TASK-P1-DEVOPS-002
- TASK-P1-NOTIF-001
- TASK-P1-SEC-001
- TASK-P1-PERF-001
- TASK-P1-DOC-001

Dependencies:
- All Phase 0 tasks complete.
- Staging environment configured with UAT URLs, personas, secrets, storage, and email provider.

Expected outcome:
- Controlled pilot can be considered with explicit limitations and support coverage.

Validation method:
- Live staging UAT passes.
- Terraform/deployment smoke evidence recorded.
- Email/notification smoke passes.
- Security signoff complete without secret exposure.
- Bundle/performance mitigation validated or formally accepted.

Release gate decision:
- Move from NO-GO to PILOT ONLY only if Phase 0 and Phase 1 are complete or risk-accepted by named owners.

## Phase 2: Required Before Paid Customer Launch
Tasks:
- Complete financial visibility tests.
- Complete document/file access negative tests.
- Complete contractual workflow audit evidence.
- Complete backup/restore and rollback rehearsal.
- Complete support/onboarding runbook.

Dependencies:
- Successful controlled pilot.
- No unresolved Critical or High defects.

Expected outcome:
- Platform can support a paying pilot customer with contractual caveats removed.

Validation method:
- Customer-like UAT signoff.
- Production-like smoke and rollback evidence.
- Finance/commercial workflow acceptance.

Release gate decision:
- CONDITIONAL GO for selected paid customer only if all High risks are closed or accepted.

## Phase 3: Required Before Public Industry Launch
Tasks:
- Broaden scalability/performance testing.
- Complete accessibility conformance review.
- Complete security review and penetration test.
- Publish full admin/user/support documentation.
- Establish monitoring, SLA, backup, incident response, and customer support process.

Dependencies:
- Paid pilot success and stable operations.

Expected outcome:
- Public launch readiness for contractors, consultants, owners, and subcontractors.

Validation method:
- Executive release gate with Product, QA, Security, Engineering, DevOps, Support, and Business signoff.

Release gate decision:
- GO only if no Critical/P0 issues, no unresolved major security/data integrity risks, core workflows work end to end, and deployment/testing are ready.

## Phase 4: Post-Launch Improvements
Tasks:
- Optimize advanced reporting/search.
- Expand mobile field UX.
- Improve dashboard performance.
- Add deeper customer analytics and implementation templates.
- Continue documentation and help-center expansion.

Dependencies:
- Stable public launch and support feedback.

Expected outcome:
- Lower support load and stronger enterprise readiness.

Validation method:
- Post-launch metrics, incident reviews, and customer feedback.

Release gate decision:
- Planned iteration, not a launch blocker.
