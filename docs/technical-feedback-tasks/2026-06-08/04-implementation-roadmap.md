# Implementation Roadmap

## Phase 1: Critical / Blocking Issues

### Tasks included

- `TASK-P0-FB-006-control-schedule-regeneration-history.md`
- `TASK-P0-FB-001-add-activity-boq-allocation.md`
- `TASK-P0-FB-019-harden-production-security-readiness.md`

### Dependencies

- Product/Business agreement that BOQ allocations are the official value spine.
- Security/DevOps confirmation for secret rotation and production environment ownership.
- Agreement on schedule revision approval authority.

### Expected outcome

The platform no longer risks deleting live linked project data during schedule regeneration, has a defined BOQ-to-activity value spine, and has production security blockers under control.

### Suggested validation approach

Run integration tests proving progress/cost/procurement records survive schedule regeneration. Validate allocation totals against BOQ values. Execute security configuration checks, webhook signature tests, CORS tests, and deployment smoke tests.

## Phase 2: High-Priority Engineering Fixes

### Tasks included

- `TASK-P1-FB-002-harden-boq-integrity.md`
- `TASK-P1-FB-004-add-schedule-review-approval-baseline.md`
- `TASK-P1-FB-005-structure-cpm-dependencies-calendars.md`
- `TASK-P1-FB-007-harden-earned-value-basis.md`
- `TASK-P1-FB-008-add-progress-methods-approval-evidence.md`
- `TASK-P1-FB-009-add-module-action-permissions.md`
- `TASK-P1-FB-010-add-audit-history.md`
- `TASK-P1-FB-012-strengthen-commercial-traceability.md`
- `TASK-P1-FB-018-add-ci-quality-gates.md`
- `TASK-P1-FB-020-create-go-live-readiness-gate.md`

### Dependencies

- FB-001 allocation spine for official EV, IPC, and commercial traceability.
- FB-009 permissions and FB-010 audit history for approval workflows.
- FB-018 CI gates for safe release iteration.

### Expected outcome

Core official workflows become reviewable, permissioned, auditable, testable, and better aligned with real construction controls.

### Suggested validation approach

Use a full QA scenario: create project, upload BOQ, allocate BOQ to activities, generate/import schedule, review/approve/baseline, submit/approve progress, calculate EV, create IPC/change order/EOT, and verify dashboard impact.

## Phase 3: Medium-Priority Improvements

### Tasks included

- `TASK-P2-FB-003-expand-project-contract-metadata.md`
- `TASK-P2-FB-011-build-mobile-site-reporting-flow.md`
- `TASK-P2-FB-013-procurement-need-date-risk-alerts.md`
- `TASK-P2-FB-014-quality-doc-workflow-maturity.md`
- `TASK-P2-FB-015-guided-project-setup-wizard.md`
- `TASK-P2-FB-016-replace-generic-dashboard.md`
- `TASK-P2-FB-017-add-openapi-docs.md`

### Dependencies

- Project metadata decisions for retention, cutoff, calendars, and contract fields.
- Progress approval and attachment/storage strategy for daily reporting.
- API docs should align with implemented permission and workflow models.

### Expected outcome

Operational workflows become clearer for PMs, site engineers, procurement, QA, and mobile/API consumers.

### Suggested validation approach

Run module-specific QA walkthroughs, API documentation review with mobile consumers, responsive UI checks, and procurement/quality overdue-alert scenarios.

## Phase 4: Low-Priority Cleanup and Documentation

### Tasks included

- Cleanup discovered during implementation of earlier phases.
- Update user-facing workflow docs after final approval states and permissions are known.
- Remove obsolete template components after dashboard replacement.

### Dependencies

- Completion of Phase 1-3 schema and workflow decisions.

### Expected outcome

The codebase and docs are easier to maintain, explain, test, and onboard.

### Suggested validation approach

Run docs review, dead-code checks, frontend lint/build, backend tests, OpenAPI validation, and final release-readiness checklist.
