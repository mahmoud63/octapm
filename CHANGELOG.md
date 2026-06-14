# Changelog

All notable platform-wide changes should be recorded here. Agents must read this file before starting work and add a concise entry for every meaningful code, schema, API, or workflow change.

## 2026-06-14

### Changed

- Made `backend/src/config/db.js` lazy-initialize PrismaClient via a Proxy so that importing the module at require-time does not throw when `prisma generate` has not been run. This fixes the OpenAPI validation CI step which imports the full Express app tree but never makes database calls.
- Added a `prisma generate` step to both `.github/workflows/openapi.yml` and `.github/workflows/quality-gates.yml` (openapi-validate job) before the `openapi:validate` command, as a belt-and-suspenders safeguard.
- Fixed `money.test.js` to import `Decimal` from `@prisma/client/runtime/library` instead of `Prisma.Decimal` from `@prisma/client`, which is only available after `prisma generate`. The test now matches the resilient import pattern already used by the `money.js` utility itself.
- Updated `.github/workflows/deploy.yml` to gracefully fall back to `secrets.*` if GitHub Environment variables (`vars.*`) are missing, preventing deployment validation failures for configuration values like `AWS_REGION` and `S3_SPA_BUCKET` during the migration from secrets to variables.
- Fixed `validate-deployment-readiness.mjs` to tolerate the newly added `|| secrets.*` fallback syntax in `deploy.yml` when checking for `VITE_API_URL` and `APP_SECRETS_ARN`.
- Removed Facebook and GitHub sign-in/sign-up options from authentication forms and added a link to the sign-up page within the sign-in form. Also removed their unused component imports to resolve frontend lint errors.
- Added `|| vars.*` fallbacks to all Stripe and Smoke Test configuration variables in `.github/workflows/deploy.yml` to prevent validation errors if they were defined as variables instead of secrets.
- Hardcoded test Stripe keys and price IDs directly into `.github/workflows/deploy.yml` as requested by the user, bypassing GitHub Environment Secrets. Added a placeholder for the empty webhook secret.
- Fixed AWS IAM role trust policy in `infrastructure/terraform/iam.tf` to allow OIDC assumption from GitHub Actions jobs running within an `environment:*` context. This resolves the `sts:AssumeRoleWithWebIdentity` authorization failure.
- Fixed git authentication in the EC2 deployment script by embedding the GitHub token directly in the repository URL (`x-access-token`), replacing the `.extraheader` approach which failed on some git versions.
- Added automatic whitespace and quote sanitization (`tr -d`) for `APP_SECRETS_ARN` and `AWS_REGION` in the EC2 deploy script to prevent `ValidationException: Invalid name` errors if the user accidentally pasted spaces, line breaks, or quotes into their GitHub Secrets.

## 2026-06-13

### Added

- Added `.nvmrc`, root setup documentation, workspace engine metadata, and npm package-manager metadata so local and CI release gates use Node.js 24.14.0 with npm 11.
- Added live UAT, backup/restore, rollback, monitoring/alert, and runtime scale-blocker evidence checklists to keep pilot/production gaps explicit.
- Added dependency audit triage, calculation certification, performance test, and controlled-pilot decision documents for the release evidence package.
- Added a safe `frontend/.env.production.example` placeholder and expanded release hygiene ignore rules for runtime env files, logs, PID files, local DB data, upload folders, and private storage artifacts.
- Added `SECURITY_ROTATION_REQUIRED.md` with path/category-only rotation guidance for runtime env files reported in the audit archive.
- Added regression coverage for null project-party access in workflow visibility helpers and invalid risk closeout approval before submission.

### Changed

- Replaced backend `xlsx` parser usage with `@e965/xlsx` and upgraded `concurrently` to remove high/critical dependency audit findings without force-upgrading breaking packages.
- Made money utilities fall back to Prisma's runtime Decimal implementation when the generated Prisma client does not expose a constructible `Prisma.Decimal`, unblocking CI OpenAPI and backend test module loading.
- Hardened EC2 user-data template resolution diagnostics for Terraform `${path.module}` template references.
- Updated EC2 user-data bootstrap and validation to install and verify the repository-pinned Node.js 24/npm 11 runtime instead of Node.js 20.
- Updated GitHub Actions setup-node steps to read the pinned `.nvmrc` version and removed tracked PID/TanStack temp artifacts from source control.
- Linked the release checklist, go-live gate, UAT documentation, and rate-limit QA notes to the new evidence and runtime scale-blocker checklists.
- Fixed party-scoped RFI/submittal workflow helpers to treat null project access as non-party-scoped instead of throwing a runtime `scope` error.
- Fixed backend test isolation for risk closeout workflow state tests and updated contractual audit mocks for workflow party assignments.
- Hardened the secret hygiene validator to skip deleted tracked files gracefully, detect tracked runtime `.env` files without printing values, ignore local runtime folders, and preserve high-confidence secret scanning.
- Fixed frontend lint import errors in Help Center, Meetings, project form fields, and user settings hooks.
- Removed `frontend/.env.production` from source tracking while leaving local runtime env files ignored.

### Verification

- Dependency audit remediation reduced root and backend install-path audit output to 3 moderate findings; focused BOQ parser/import tests passed against `@e965/xlsx`; EC2 user-data self-test and live validator passed.
- OpenAPI validation passed for 255 documented paths after the Decimal fallback fix; backend Jest passed with 75 suites and 1069 tests; EC2 user-data self-test and live validator passed.
- Exact npm release matrix passed from the repository root: Node `v24.14.0`, npm `11.9.0`, Prisma validate, OpenAPI validate, backend Jest with 75 suites and 1068 tests, frontend ESLint with 22 warnings and 0 errors, frontend TypeScript/Vite build, secret hygiene validation, private storage validation, API origin validation, RDS backup validation, deployment readiness validation, and UAT manifest validation.
- Focused RFI/submittal party-access regression tests passed for company-party workflow access, project-object authorization, and contractual audit; focused risk closeout and approval-workflow tests passed.
- Prisma validate passed for `backend/prisma/schema.prisma`; backend OpenAPI validation passed for 255 documented paths; backend Jest passed with 75 suites and 1068 tests; frontend ESLint passed with warnings only; frontend TypeScript/Vite production build passed with existing Vite deprecation/plugin/chunk-size warnings; secret hygiene validation and self-test passed; private runtime storage validation passed.

## 2026-06-12

### Added

- Added TASK-P2-UX-002 field-device UX hardening with mobile/touch-safe Site Reporting controls, labelled camera/photo inputs with HEIC/HEIF support, workflow evidence upload for NCR and safety closeout, field-specific tablet/mobile UAT routes, a field UX accessibility assertion, and a field-device support matrix.
- Added TASK-P2-UX-001 persisted authenticated settings with user profile/account/appearance/display preference storage, `/auth/me/*` settings APIs, connected React settings mutations and load/error/success states, top-navigation display preference application, notification settings error feedback, OpenAPI coverage, focused backend/frontend assertions, and settings QA guidance.
- Added TASK-P2-PROD-001 meeting minutes workflow with activity-linked meetings, attendees, agenda items, decisions, action items, distribution history, comments, linked task creation, notification fanout, centralized audit events, project-party permissions, project Meetings UI, OpenAPI coverage, QA guide, UAT meeting-minutes flow, and focused backend/frontend assertions.
- Added TASK-P2-SEARCH-001 global cross-module search with a permission-aware `/api/v1/search` API, searchable entity definitions for project, schedule, BOQ, document-control, commercial, procurement, meeting, risk, and task records, party/task/document visibility guards, command-menu search filters and grouped results, PostgreSQL trigram search indexes, OpenAPI coverage, QA notes, and focused backend/frontend assertions.
- Added TASK-P2-DOC-001 launch documentation pack with admin guide, role user guide, support runbook, API docs guide/index, release notes/known limitations, onboarding checklist, documentation readiness QA checklist, go-live/release checklist references, and an authenticated Help Center documentation hub replacing the coming-soon shell.
- Added TASK-P1-QA-001 E2E/UAT regression suite with persona-based construction workflow manifest, deterministic UAT fixture seeder, API/browser runner covering auth, project, document/RFI/submittal, BOQ/schedule/progress/daily-report/cost/IPC/payment, QA/NCR, safety, permission-negative checks, desktop/tablet/mobile smoke screenshots, CI Quality Gates staging evidence wiring, stable frontend selectors, release evidence archive, and QA signoff documentation.
- Added TASK-P1-PROD-001 persisted task workflow with Task/TaskComment/TaskAttachment/TaskHistory schema and migration, workspace and project task APIs, task permissions, assignment and due/overdue notification integration, dashboard task counts/overdue queue, React Query-backed task UI for create/edit/close/comment/archive, OpenAPI contracts, QA guide, and mock task/faker removal.
- Added TASK-P1-PROD-002 company-backed project party management with Company/ProjectParty/ProjectPartyMember schema, legacy project party backfill, external invitation acceptance into company memberships, project-party scoped authorization, party-aware RFI/submittal routing and visibility, company selectors in project setup, external-party invite controls, OpenAPI contracts, and QA guidance for consultant/subcontractor personas.
- Added TASK-P1-BE-001 production notifications with durable notification, preference, and delivery-attempt tables; authenticated in-app notification APIs; workflow-event fanout for approval/assignment events; due/overdue scan and email retry processing; provider-backed delivery audit; settings preference integration; top-bar notification center; OpenAPI coverage; and QA behavior matrix.
- Added TASK-P1-DOC-001 document-control library workflows with persisted folder/category metadata, direct revision file upload, preview/download routes, submit-for-review transitions, current-approved-only site role access, controller-focused register UI with folder rail/upload metadata/preview panel, OpenAPI updates, QA guidance, and focused permission/audit/file-access regressions.
- Added TASK-P1-DEVOPS-001 deployment readiness hardening with GitHub Environment-parameterized deploy inputs, production authenticated-smoke gating, manual staging rehearsal dispatch, deployment readiness validation in Quality Gates, production RDS Multi-AZ and monitoring-email Terraform preconditions, CloudWatch SNS email subscription management, runtime/deploy IAM separation, restore/rollback/monitoring evidence packet documentation, and go-live signoff packet cleanup.
- Added TASK-P1-DB-001 archive/soft-delete retention for projects, RFIs, submittals, change orders, risks, and safety incidents with archive metadata, audited archive events, default active-list filtering, include-archived query support, frontend archive labels, OpenAPI contracts, and QA retention policy documentation.
- Added TASK-P1-AUTH-001 password reset and real invitation flows with hashed one-time reset/invite token tables, auth audit events, forgot/reset/invite/accept APIs, provider-backed email dispatch guardrails, PM-only invite permissions, frontend reset and invite-accept screens, OpenAPI contracts, QA documentation, and focused backend/frontend coverage.
- Added TASK-P0-SEC-001 private runtime storage hardening with tracked upload removal, ignore rules for local private storage, a Quality Gates repository guard, cross-project/cross-org file access regressions, and private runtime storage policy documentation including the history-purge decision.
- Added TASK-V3-P2 project-manager approval regression coverage with Supertest PM/non-PM approve/reject flows for schedule revisions, daily reports, RFIs, submittals, and activity BOQ allocations, project-assigned PM/QS effective-role route checks, shared BOQ allocation permission policy, frontend approval-action visibility assertions, and manual PM approval regression checklist updates.
- Added TASK-V3-P2 risk-register activity impact workflow with multi-activity risk links, mitigation owner/due-date/response-plan/residual-risk/escalation fields, PM closeout submit/approve/reject/reopen controls, audit and approval-history persistence, activity-detail risk summaries, dashboard risk closeout and overdue-mitigation queues, permissions/OpenAPI coverage, and frontend drill-through filters.

### Changed

- Fixed clean PostgreSQL migration replay for the decimal-money migration by dropping and recreating BOQ allocation validation triggers around column type conversions.
- Fixed clean PostgreSQL migration replay for the commercial impact hardening migration by replacing an invalid target-table lateral reference with correlated allocation backfill subqueries.
- Fixed TASK-P0-FE-001 schedule progress memoization by stabilizing assignment-filter dependencies in progress tab and bulk progress, deriving daily-report activity selection without an effect, and preserving assignment-scoped progress/daily-report submission controls.
- Fixed TASK-P0-FIN-001 IPC draft item cap enforcement to include approved change-order allocation allowances, exclude pending/rejected variations, and preserve partially allocated variation limits before certification.

### Verification

- Clean embedded-Postgres migration replay passed on a fresh local database; local API smoke passed at `http://127.0.0.1:5009/api/health`; local OpenAPI JSON responded; CORS from `http://127.0.0.1:5175` passed; Vite served the React entry module on `http://127.0.0.1:5175/`.
- TASK-P2-UX-002 validation passed: field UX/accessibility source assertion, existing site-reporting mobile UI assertion, workflow maturity UI assertion, UAT manifest validation with tablet/mobile coverage, frontend TypeScript build, targeted Prettier check, JSON parse checks, and frontend Vite production build with existing Vite esbuild deprecation, plugin timing, and chunk-size warnings. Full real-device iOS/Android manual signoff remains a staging release evidence activity.
- TASK-P2-UX-001 validation passed: frontend settings form API assertion and notification settings assertion passed with bundled Node; backend OpenAPI validation passed for 255 documented paths; Prisma validate passed for `backend/prisma/schema.prisma`; backend syntax checks passed for the new settings service, auth route, OpenAPI spec, and focused test files. Backend Jest and frontend TypeScript/Vite builds could not run locally because `node`/`npm` are not on PATH, backend `node_modules` is missing Jest, and frontend `node_modules` is missing TypeScript/Vite.
- TASK-P2-SEARCH-001 validation passed: focused backend Jest for global search service and search route with 2 suites and 5 tests, backend OpenAPI validation for 250 documented paths, Prisma validate for `backend/prisma/schema.prisma`, frontend global search UI assertion, frontend TypeScript build, and frontend Vite production build with existing Vite esbuild deprecation, chunk-size, and plugin-timing warnings.
- TASK-P2-PROD-001 validation passed: Prisma validate for `backend/prisma/schema.prisma` with a local validation `DATABASE_URL`, focused backend Jest for meeting service, module route permissions, and permission matrix with 3 suites and 707 tests, backend OpenAPI validation for 249 documented paths, frontend meetings UI assertion, UAT manifest validation with 5 flows and meeting/task/notification/audit coverage, frontend TypeScript build, and frontend Vite production build with existing Vite esbuild deprecation, chunk-size, and plugin-timing warnings. Prisma format could not run in this Windows/OneDrive shell because the Prisma CLI hit an `UNKNOWN` file-open error on `schema.prisma`; schema validation passed.
- TASK-P2-DOC-001 validation passed: Help Center source assertion, backend OpenAPI validation for 245 documented paths, targeted Prettier check for new help/API docs and frontend files, frontend TypeScript build, and frontend Vite production build with existing Vite esbuild deprecation/chunk-size warnings. A broader Prettier check over legacy release-readiness Markdown tables still reports existing formatting drift and was not auto-rewritten to avoid unrelated churn.
- TASK-P1-QA-001 validation passed: UAT manifest validation with 4 flows, 8 personas, 3 permission-negative checks, and desktop/tablet/mobile coverage; JS syntax checks for the UAT runner and fixture seeder; package and manifest JSON parsing; Quality Gates YAML parse; frontend TypeScript check with the repo-level compiler; and targeted frontend ESLint for touched selector files with 0 errors and 2 existing `ProjectDetail` effect warnings. Full browser UAT was not run locally because no app/staging environment was running and the bundled Playwright package is missing `playwright-core`; CI installs Playwright for configured staging evidence runs.
- TASK-P1-PROD-001 validation passed: Prisma validate for `backend/prisma/schema.prisma`, backend OpenAPI validation for 245 documented paths, backend focused task/dashboard/notification/permission Jest passed with 4 suites and 632 tests, frontend task workflow assertions passed, frontend TypeScript build passed, frontend Vite production build passed with existing Vite deprecation/chunk/plugin timing warnings, and targeted task mock/faker source scan passed.
- TASK-P1-PROD-002 validation passed: shared permission JSON parse, backend syntax checks for touched services/OpenAPI, Prisma validate for `backend/prisma/schema.prisma`, backend OpenAPI validation for 235 documented paths, focused backend Jest for permissions/project authorization/project service/company-party/project-party routes with 6 suites and 651 tests, frontend TypeScript build, and frontend effective-role/party permission source assertions.
- TASK-P1-BE-001 focused notification Jest passed: notification service and notification routes, 2 suites and 9 tests; existing approval workflow Jest passed, 1 suite and 12 tests; Prisma validate passed for `backend/prisma/schema.prisma`; backend OpenAPI validation passed for 230 documented paths; frontend notifications UI assertions passed; frontend TypeScript build passed.
- TASK-P1-DEVOPS-001 deployment readiness validator self-test and live repo check passed; RDS backup validator self-test and live repo check passed; deploy and quality-gates workflow YAML parsed locally; deployment readiness script syntax check passed; frontend TypeScript build passed with bundled Node; targeted hardcoded deployment value and TBD signoff scans passed; Terraform CLI validation could not run because `terraform` is not installed in this shell.
- Prisma validate passed for `backend/prisma/schema.prisma`; backend focused archive/list/permission Jest passed, 9 suites and 607 tests; backend OpenAPI validation passed for 217 documented paths; frontend TypeScript build passed; frontend commercial traceability, risk register, audit history, and permission visibility assertions passed.
- TASK-P0-QA-001 clean release quality gate passed and was attached to the release-readiness audit: backend Jest passed with 62 suites and 899 tests, frontend ESLint passed with 0 errors and 16 warnings, frontend TypeScript check passed, frontend Vite production build passed with existing Vite/plugin/chunk-size warnings only, Prisma validate passed for `backend/prisma/schema.prisma`, and backend OpenAPI validation passed for 212 documented paths.
- Private runtime storage guard self-test, tracked-file validation, and staged-file validation passed; `git ls-files backend/storage/private-documents storage/private-documents` returned no files; focused backend private storage, document-control, and nested project authorization Jest passed, 3 suites and 22 tests.
- Frontend focused progress assignment UI assertion passed; full frontend lint/type-check could not run in this shell because `npm` is not on PATH and frontend ESLint/TypeScript binaries are absent from `node_modules`.
- Backend focused IPC allocation Jest passed with approved, pending, rejected, and partially allocated variation cap coverage; backend Jest config suite passed, 62 suites and 893 tests; frontend commercial traceability UI assertions passed.
- Backend focused project-manager approval, activity BOQ allocation, permission matrix, and daily-report service Jest passed, 4 suites and 84 tests; frontend permission/effective-role/project-manager approval UI assertions passed; frontend TypeScript check passed.
- Prisma validate passed for `backend/prisma/schema.prisma`; backend focused risk/workflow/dashboard/permission Jest passed, 5 suites and 609 tests; backend OpenAPI validation passed for 212 documented paths; frontend risk-register, dashboard construction, and permission visibility assertions passed; frontend TypeScript build passed.

## 2026-06-11

### Added

- Added TASK-V3-P2 QA/QC and safety closeout workflow standardization with NCR/safety submit-close-approve-reject-reopen state gates, required responsible party/due date/closure comment/evidence validation, workflow history and approval events, PM-only closeout decisions, overdue safety and QA/safety closeout dashboard queues, permissions/OpenAPI coverage, and focused backend/frontend assertions.
- Added TASK-V3-P2 equipment usage/cost traceability with normalized approved `ActivityEquipmentUsage` records, daily-report approval posting to equipment usage and activity cost actuals, cost/audit source metadata, equipment utilization APIs by project/activity/equipment, Equipment and Cost Control dashboard views, master-equipment selection in site reporting, OpenAPI coverage, and focused backend/frontend assertions.
- Added TASK-V3-P2 connected dashboard KPI traceability with backend source rules, official KPI cards using approved/official source data and cutoff freshness, separate pending-review metrics, drill-through targets for RFI, submittal, progress, cost, IPC, and change-order records, project-health source/cutoff metadata, OpenAPI descriptions, and focused backend/frontend assertions.
- Added TASK-V3-P2 universal audit/workflow history panels with a reusable `HistoryPanel`, combined project-scoped audit/approval/status-history API reads, source/action filters, CSV export, evidence attachment display, and record-level embeds for RFI, submittal, change order, IPC, EOT, daily report, site diary, NCR, safety, BOQ allocation, and schedule revision details.
- Added TASK-V3-P1 schedule Activity ID, data-date, and dependency-grid hardening with first-class `Activity.activityCode` backfill and active per-project uniqueness, `Project.dataDate` API/UI support, BOQ-generated activity codes separated from WBS grouping, Activity ID schedule/Gantt columns, real day/week/month/quarter timescale controls, a blue backend-driven data-date marker with fallback warning, and structured predecessor/successor relationship grid/tooltips.
- Added TASK-V3-P1 procurement schedule/material traceability with activity-derived required-on-site and latest-order dates for procurement packages, migration-safe package alert uniqueness, schedule Gantt and dashboard risk badges, daily-report links for receipts and activity material usage, and audited acknowledge/resolve workflow routes.
- Added TASK-V3-P1 Primavera-style schedule Gantt with frozen activity/baseline grid columns, real month/week/day timeline headers, expandable WBS summary rows, baseline/current/progress/milestone/data-date/dependency layers, synchronized scroll virtualization for large schedules, optional activityCode frontend mapping, and focused UI regression coverage.
- Added TASK-V3-P1 approved-progress/approved-allocation EV enforcement and guided setup readiness gates with official EV input metadata, approved-only EV source summaries, reporting readiness blockers, PM audited override reason for locked EV snapshots, report-level readiness warnings, pending-vs-official progress UI separation, setup wizard reporting status, OpenAPI contracts, permissions, and focused backend/frontend regressions.
- Added TASK-V3-P1 document-control hardening with document register APIs/UI, private ProjectDocument-backed revision upload/approve/supersede/download controls, latest-approved and superseded read-only revision metadata, RFI submit/answer/close/reopen routes, submittal submit/review/resubmit/approve/reject workflow routes, PM-only close/revision approval controls, dashboard overdue submittal queues, permissions/OpenAPI coverage, and focused backend/frontend assertions.
- Added TASK-V3-P1 EOT delay-claim evidence workflow with submit/approve/reject endpoints, direct status-bypass guards, PM-only official approval, affected critical-path activity evidence tabs, linked weather/RFI/correspondence/photo evidence summaries, entitlement narrative metadata, cumulative approved EOT days, revised completion recommendation persistence, OpenAPI contracts, permissions, and focused backend/frontend assertions.
- Added TASK-V3-P1 IPC payment controls with earned-vs-claimed certification review, approved BOQ/variation/progress cap warnings, PM override reason capture for over-certification, finance-only payment and retention transitions, invoice/payment/retention history panels, workspace dashboard payment-status queue coverage, OpenAPI contracts, permissions, and focused backend/frontend assertions.
- Added TASK-V3-P1 commercial change-order approval hardening with draft/submit/approve/reject/reopen workflow endpoints, PM-only approve/reject permissions, direct status-bypass guards, required schedule/cost impact summaries, ApprovalWorkflowEvent coverage, approved-only budget revision sync, approved impact locking, frontend PM approval panel/submit/reopen controls, BOQ/activity/allocation trace displays, OpenAPI updates, and manual QA coverage.
- Added TASK-V3-P0 BOQ allocation spine lock with a partial unique active BOQ/activity allocation index migration, duplicate allocation API guard/error normalization, allocation submit/approve lifecycle audit coverage, approved-only EV/IPC allocation enforcement, explicit BOQ allocation workflow UI value states, and focused backend/frontend-integrity regressions.
- Added TASK-V3-P0 BOQ active code integrity with normalized `activeCodeKey` persistence, a duplicate-reporting migration before active-code constraint enforcement, DB trigger/check coverage for direct writes, service/upload/manual duplicate error normalization, and focused BOQ code regression tests.

### Verification

- Prisma validate passed for `backend/prisma/schema.prisma`; backend focused QA/QC/safety closeout Jest passed with approval workflow, route permission, dashboard, and permission matrix coverage, 5 suites and 548 tests; backend OpenAPI validation passed for 206 documented paths; frontend permission, workflow maturity, and dashboard construction assertions passed; frontend TypeScript build passed; frontend Vite production build passed after rerunning outside the sandbox for native Vite/Tailwind dependency loading, with existing Vite deprecation, plugin timing, and chunk-size warnings only.
- Prisma validate passed for `backend/prisma/schema.prisma`; backend focused equipment/daily-report Jest passed, 2 suites and 6 tests; backend OpenAPI validation passed for 200 documented paths; frontend equipment-utilization and site-reporting UI assertions passed; frontend TypeScript check passed; frontend Vite production build passed after rerunning outside the sandbox for native Vite/Tailwind dependency loading, with existing Vite deprecation, plugin timing, and chunk-size warnings only.
- Backend focused workspace dashboard Jest passed, backend dashboard/health/OpenAPI syntax checks passed, backend OpenAPI validation passed for 199 documented paths, frontend dashboard construction/earned-value/procurement-risk assertions passed, frontend TypeScript check passed, targeted Prettier check passed, and frontend Vite production build passed after rerunning outside the sandbox for native Vite/Tailwind dependency loading with existing plugin timing/chunk-size warnings only.
- Backend focused audit/history Jest passed: audit service and audit route permissions, 2 suites and 6 tests; backend OpenAPI validation passed for 199 documented paths; frontend audit-history, workflow maturity, document-control register, commercial traceability, and site-reporting UI assertions passed; frontend TypeScript build passed; frontend Vite production build passed after rerunning outside the sandbox for native Vite/Tailwind dependency loading, with existing Vite deprecation, plugin timing, and chunk-size warnings only.
- Prisma validate passed for `backend/prisma/schema.prisma`; focused backend Activity ID/data-date/dependency Jest passed, 5 suites and 30 tests; backend OpenAPI validation passed for 199 documented paths; frontend schedule Activity ID/dependency/Gantt assertions, TypeScript build, and Vite production build passed with existing Vite warnings only.
- Prisma validate passed for `backend/prisma/schema.prisma`; backend OpenAPI validation passed for 199 documented paths.
- Backend focused procurement traceability Jest passed: procurement risk/service, workspace dashboard, permission config, and module/action permissions, 5 suites and 511 tests.
- Frontend procurement-risk UI, material-tracking UI, and permission visibility assertions passed.
- Local Vite smoke served `http://127.0.0.1:5174/` and Browser confirmed the public app rendered; authenticated project schedule/material manual delay QA remains pending without a signed-in seeded project session.
- Frontend Primavera Gantt source assertions, TypeScript build, Vite production build, and Browser smoke passed with a 1,000-activity sample schedule across desktop scroll and narrow viewport checks.
- Backend focused approved-EV/setup-readiness/reporting-lock Jest passed: earned-value service, project setup readiness service, and reports route controls, 3 suites and 18 tests.
- Frontend setup readiness, official earned-value, and permissions visibility assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Backend OpenAPI validation passed for 197 documented paths.
- Frontend Vite production build passed with existing Vite deprecation, plugin timing, and chunk-size warnings only.
- Local in-app Browser smoke could not run because the Browser surface blocked both `http://127.0.0.1:5173/` and `http://localhost:5173/` with `ERR_BLOCKED_BY_CLIENT`.
- Prisma format and validate passed for `backend/prisma/schema.prisma` with the document revision control migration.
- Backend focused document-control workflow Jest passed: document-control service, approval workflow, module/action permissions, permission config, workspace dashboard, and OpenAPI coverage, 6 suites and 506 tests.
- Backend OpenAPI validation passed for 197 documented paths.
- Frontend document-control register, workflow maturity, permission visibility, and dashboard construction assertions passed with bundled Node.
- Frontend TypeScript build and Vite production build passed with existing Vite deprecation and chunk-size warnings only.
- Prisma format and validate passed for `backend/prisma/schema.prisma` with the EOT/IPC workflow migration.
- Backend OpenAPI validation passed for 185 documented paths.
- Backend syntax checks passed for the touched EOT, IPC, dashboard, OpenAPI, route, and focused test files with bundled Node.
- Frontend commercial traceability, permission visibility, dashboard construction, workflow maturity, and financial precision assertions passed with bundled Node.
- Full backend Jest and frontend TypeScript/Vite builds could not be run in this shell because local tooling is incomplete: backend `node_modules` is missing Jest, frontend `node_modules` is missing TypeScript/Vite, and `npm` is not on PATH.
- Prisma format passed and Prisma validate passed for `backend/prisma/schema.prisma` with a local placeholder `DATABASE_URL`.
- Backend focused approval/change-order Jest passed: approval workflow, change-order service, and module/action route permissions, 3 suites and 368 tests.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 55 suites and 597 tests.
- Backend OpenAPI validation passed for 184 documented paths.
- Frontend commercial traceability and permission visibility assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend Vite production build passed with existing plugin deprecation/timing and chunk-size warnings only.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Backend syntax checks passed for touched BOQ service/parser, OpenAPI, error-code, utility, and focused test files with bundled Node; BOQ code normalization smoke passed.
- Focused BOQ Jest suites could not be run because this shell has no `npm`/`npx`/`jest` on PATH and local `backend/node_modules` is missing Jest.

## 2026-06-10

### Added

- Added TASK-V3-P0 approval effective Project Manager role handling with project API `projectAccess.effectiveRole` responses, frontend project permission context, canonical role normalization for `Project Manager`/`pm`, and regression coverage for project-level PM approval visibility plus unassigned-project approval denial.
- Added TASK-V3-P0 canonical PM approval workflows with explicit approve/reject/disapprove endpoints for RFI, submittal, NCR, safety, change order, and EOT records; PM-only shared permission transitions; OpenAPI contracts; frontend approval/disapproval buttons with reason dialogs; and focused route/state/UI assertions.
- Added TASK-P2 service modularization coverage with BOQ job-store, Excel parser, and workbook template modules plus focused module tests and manual QA coverage for upload/template/job polling behavior.
- Added TASK-P2 Prisma unique-query pattern coverage for BOQ item update/delete workflows, with scoped lookup regression tests and manual QA coverage for duplicate-code and cross-project ID behavior.
- Added TASK-P2 API response/error normalization with a runtime error-code catalog, reusable app not-found/error middleware, OpenAPI `ErrorCode` enum coverage for new catalog codes, route-source regression tests that block hand-rolled success envelopes/manual error forwarding, and manual QA coverage.
- Added TASK-P1 progress assignment authorization with assignment-scoped single, bulk, and daily-report progress submission guards, PM/Planning Engineer overrides, progress-submission create audit events, OpenAPI assignment-rule documentation, assignment-aware schedule progress UI controls, focused regression tests, and manual QA coverage.
- Added TASK-P1 rate limiting and abuse protection with reusable Express rate-limit middleware, global API/auth/login/refresh/upload/AI/billing/Stripe webhook buckets, login backoff and temporary lockout tracking, OpenAPI `429` documentation, and release/manual QA coverage.
- Added TASK-P1 procurement/material tracking hardening with migration `20260611010000_expand_procurement_material_tracking`, supplier/package/PO-line/delivery-receipt/activity-usage/lead-time-alert models, project-scoped procurement routes, explicit module permissions, receipt and usage balance guards, activity material traceability UI, OpenAPI contracts, focused backend regression tests, frontend UI assertions, and manual QA coverage.
- Added TASK-P1 IPC/payment workflow hardening with migration `20260610235900_harden_ipc_payment_workflow`, IPC invoice/payment/retention-release models, submitted-only certification gates, approved BOQ plus approved variation certification caps, payment/retention balance checks, finance-only invoice/payment routes, OpenAPI contracts, frontend payment controls, focused precision/workflow tests, and manual QA documentation.
- Added TASK-P1 commercial impact-model hardening with migration `20260610235500_harden_commercial_impact_model`, richer change-order and EOT activity impact fields, project-document-backed commercial evidence links, approval/submission proof guards, EOT recalculation on impact edits, OpenAPI contract updates, frontend proof/readiness UX, focused backend regression tests, and manual QA coverage.
- Added TASK-P1 approval workflow/audit state machine coverage with migration `20260610234000_add_approval_workflow_events`, the `ApprovalWorkflowEvent` ledger, backfilled legacy workflow/audit decisions, shared transition validation for BOQ, schedule, RFI, submittals, change orders, IPC, EOT, NCR, safety, and cost-loading approvals, plus QA documentation for contractual approval scenarios.
- Added TASK-P1 production-grade daily reporting/mobile workflow hardening with migration `20260610230000_harden_daily_reporting_workflow`, offline `clientRequestId`/device metadata, shift/weather/issues capture, project-owned site-photo validation/linking, line summaries, local frontend draft restore, PM rejection dialog, API docs, QA checklist, and frontend UI assertions.
- Added TASK-P1 EC2 user-data Terraform hardening with a checked-in Amazon Linux 2023 bootstrap template, focused missing-template/wrong-field validation self-tests, Quality Gates EC2 bootstrap validation, CI `terraform validate`, release checklist updates, and manual QA documentation.
- Added TASK-P1 centralized audit record history snapshots with migration `20260610210000_add_record_history_snapshots`, `RecordHistorySnapshot` backfill from existing `AuditEvent` rows, compact redacted snapshot/change-set persistence, and QA coverage for migration backup, dry-run, rollback, and contractual workflow checks.
- Added central audit emissions for BOQ revision imports/comparisons, manual BOQ row create/update/delete, cost-record create/update, burn-rate creation, RFI create/update/delete, and submittal create/update/delete workflows, with actor ID/role and old/new record summaries.
- Added BOQ, cost, RFI, and submittal audit history panels plus frontend audit entity typings, query invalidation, and UI assertions for the newly visible contractual histories.
- Added TASK-P1 official earned-value engine hardening with migration `20260610190000_add_cost_record_actual_through_date`, `CostRecord.actualThroughDate` cutoff support, approved-progress cutoff regression coverage, official AC source tests, cost actual-through route validation, OpenAPI EV/cost contracts, frontend official EV UI assertions, and QA documentation for period reconciliation/signoff.
- Added TASK-P1 structured schedule dependency hardening with route validation coverage for FS/SS/FF/SF lag/lead inputs, calendar-aware CPM unit tests, calendar-aware schedule UI assertions, OpenAPI activity dependency response contracts, and manual QA coverage for dependency, baseline, and revision comparison workflows.
- Added TASK-P1 secure project file storage with `ProjectDocument` metadata, private object keys, SHA-256 hashes, clean scan status, magic-byte/type checks, EICAR rejection, presigned S3 download redirects, BOQ revision source-document links, temp-file upload routing, production S3 bucket validation, Terraform upload retention/TLS policy, OpenAPI updates, frontend BOQ upload feedback, and secure file-storage QA documentation.
- Added TASK-P1 list API pagination/filtering/sorting hardening for RFI, submittal, and cost activity records, with route validation, service-level cursor tests, OpenAPI contract updates, frontend query controls, manual QA coverage, and supporting list-query indexes.
- Added TASK-P1 OpenAPI/Swagger contract hardening with versioned Swagger UI at `/api/v1/docs`, reusable live Express route coverage checks in OpenAPI validation, and supplemental contracts for previously undocumented project/user API modules.
- Added TASK-P0 Stripe secret/webhook hardening with tracked-source live Stripe secret hygiene scanning in Quality Gates, production rotation evidence gates, signed webhook smoke support, billing/OpenAPI contract coverage, billing Stripe configuration UI assertions, and QA documentation.
- Added TASK-P0 project-level object authorization hardening with shared project access policy tests, route-level negative 403 coverage for unassigned project users, frontend restricted-state assertions, QA documentation, and migration `20260610130000_add_project_assignment_user_index`.
- Added TASK-P0 refresh-session hardening with server-side `RefreshSession` persistence, hashed refresh-token storage, migration `20260610110000_add_refresh_sessions`, refresh rotation/replay rejection, logout revocation, and focused backend route/service regression tests.
- Added frontend auth token-storage assertions covering memory-only access tokens, credentialed cookie refresh, and server-side logout revocation.
- Added auth refresh-session QA documentation and release/security checklist links covering httpOnly cookie flags, no JSON refresh-token leakage, rotation, replay rejection, logout, and construction workflow regression checks.
- Added TASK-P0 subscription gate route-order regression coverage for expired and active organizations across project and user creation.
- Added subscription-gate frontend UI assertions and manual QA documentation covering lapsed subscription write blocking, billing banner visibility, and active-org regression checks.

### Changed

- Changed approval-sensitive project routes to pass the normalized effective project role into service/audit calls when a project assignment role is present.
- Changed change order and EOT approval decisions to write generic workflow status history alongside approval workflow events, and made workflow status-history recording tolerate focused unit-test Prisma mocks without that delegate.
- Changed `boq.service.js` to act more narrowly as the BOQ facade by extracting in-memory upload job state, workbook template generation, and Excel parsing/row validation into `backend/src/services/boq/*` modules while preserving existing route-facing exports.
- Changed BOQ item service access to use a shared project-scoped `findBoqItemInProject` lookup before primary-ID update/delete/activity-allocation writes, preserving revision-friendly BOQ code behavior without adding an unsafe uniqueness constraint.
- Changed legacy RFI, submittal, NCR, safety, defect, drawing, ITP, material-test, weather-delay, transmittal, correspondence, document-control, quality, budget-revision, cash-flow, EOT, and sub-valuation route handlers to use shared `sendSuccess` and `asyncHandler`; app health and 404/error handling now flow through the shared response helpers.
- Changed schedule progress and daily-report routes to pass the effective project assignment role into progress services, changed bulk progress to preflight authorization for the whole batch before writing submissions, and changed the frontend progress tab/bulk panel to enable field-user submission only for assigned activities while preserving PM/Planning Engineer override workflows.
- Changed auth login to record failed credential attempts before repeated password comparisons, clear email backoff after successful credential validation, and apply structured throttles to upload, AI generation, billing, and Stripe webhook routes before expensive work starts.
- Changed IPC line updates to remain draft-only and workflow-owned, cash-flow rebuilds to use actual IPC payment receipts with a paid-certificate fallback, and commercial traceability enrichment to tolerate mocked audit serializers in regression tests.
- Changed change-order approvals and EOT submissions to require affected activity impact rows plus supporting documents, persist per-activity schedule/cost/critical-path/LD snapshots, link clean `ProjectDocument` evidence through commercial attachment refs, and restrict EOT calculate/create/update to PM, Planning Engineer, and QS roles.
- Changed approval-sensitive service routes to reject invalid direct approvals, require submitted-state approval gates and rejection reasons, persist actor ID/role/comment/reason for each decision, expose `approvalHistory` in workflow/commercial responses, document the new OpenAPI approval-event contracts, and show approval timelines in the frontend workflow detail view.
- Changed daily report and site diary final approval/rejection transitions to PM-only while preserving broader progress-submission approval permissions.
- Changed the EC2 app instance Terraform to send encoded bootstrap content through `user_data_base64` instead of base64-encoding the plain `user_data` field.
- Changed the project audit OpenAPI contract to document the concrete `{ events, nextCursor }` response shape, supported audited entity/action values, and compact old/new summary snapshot fields.
- Changed official EV formulas to `ev.v2`, using progress approved on or before the selected cutoff and cost-record actuals with `actualThroughDate` on or before the cutoff; schedule EV now renders the official report, Cost Control exposes an Actual Through date, and cost updates invalidate EV/health dashboards.
- Changed CPM recalculation, schedule/import/export date conversion, and activity/schedule API responses to use project/activity working calendars for planned and baseline dates while preserving structured dependency rows as the source of relationship logic.
- Changed BOQ, schedule generation, P6/MSP/progress import, workflow evidence, and site-reporting upload routes to stream through temporary disk files and private document storage instead of Multer memory buffers; authenticated downloads now use API-controlled local streams or short-lived S3 presigned redirects.
- Changed RFI, submittal, and cost activity list responses to return bounded `{ rows, pagination }` payloads with server-side search, filters, and stable sorting while preserving full filtered summaries/aggregate cost totals.
- Changed production Stripe startup validation to require a live-mode secret key, non-placeholder webhook signing secret, paid-plan price IDs, non-secret rotation ticket/date metadata, and no Stripe secret configuration logging; billing screens now show a clear unavailable state when the Stripe publishable key is missing or malformed.
- Changed project list, project detail, workspace dashboard, setup-readiness, and all nested project module routes to require `ProjectAssignment` membership for non-PM roles while retaining PM org-wide access; nested module permissions now honor the project assignment role when present, project creation assigns the creator, OpenAPI documents `PROJECT_ACCESS_DENIED`, and direct frontend project links show a restricted-access state instead of a misleading not-found view.
- Changed browser auth to return short-lived access tokens in the response body while setting refresh tokens only through the `HttpOnly` `pmc_refresh_token` cookie; `/auth/refresh` now requires the cookie, rotates the session, rejects body refresh tokens, and `/auth/logout` revokes/clears the session.
- Changed frontend auth storage to keep only the access token in memory, send credentialed API requests, restore sessions via cookie-backed refresh after reload, and surface sign-out failure if logout cannot revoke the server session.
- Updated OpenAPI auth schemas, cookie security metadata, deployment smoke auth checks, and OpenAPI validation for refresh-cookie secured endpoints.
- Moved project/user subscription enforcement inside authenticated routers, made write gates fail closed when `req.user` is absent, and documented `402` billing/subscription errors in the OpenAPI common response contract.
- Aligned frontend subscription feedback and project/user write-control visibility with the backend `hasAccess` decision, plus shared mutation error handling for `SUBSCRIPTION_REQUIRED` responses.

### Verification

- Backend focused approval effective role Jest passed: permission matrix, project API role exposure, and project object authorization, 4 suites and 373 tests.
- Frontend effective role permission assertions and existing permission visibility assertions passed; frontend TypeScript build passed with bundled Node.
- Backend focused canonical approval Jest passed: route module/action permissions plus approval workflow state machine, 2 suites and 343 tests.
- Backend focused commercial approval traceability Jest passed: change-order and EOT traceability, 2 suites and 8 tests.
- Backend OpenAPI validation passed for 182 documented paths.
- Frontend permission visibility, workflow maturity, and commercial traceability UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Backend focused BOQ modularization Jest passed: 4 suites, 15 tests.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 54 suites, 461 tests.
- Backend focused BOQ service Jest passed: 1 suite, 10 tests.
- Backend focused API response normalization, OpenAPI, list-query, and module/action permission Jest passed: 5 suites, 253 tests.
- Backend OpenAPI validation passed for 164 documented paths.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 51 suites, 454 tests.
- Backend focused progress assignment, daily-report linkage, progress service, and module/action permission Jest passed: 4 suites, 250 tests.
- Frontend progress assignment UI assertions passed.
- Backend OpenAPI validation passed for 164 documented paths.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 49 suites, 448 tests.
- Frontend Vite production build passed with existing plugin deprecation/timing and chunk-size warnings only.
- Backend focused rate-limit, auth-abuse, auth refresh-cookie, and Stripe webhook Jest passed: 5 suites, 12 tests.
- Backend OpenAPI validation passed for 164 documented paths.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 48 suites, 443 tests.
- Backend focused procurement/material tracking Jest passed: 4 suites, 264 tests.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 164 documented paths.
- Frontend material tracking and permission visibility UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend targeted Prettier check passed for touched material tracking files.
- Frontend Vite production build passed with existing plugin deprecation/timing and chunk-size warnings only.
- Local Vite HTTP smoke passed on the auto-selected dev server port before shutdown; in-app Browser tooling was unavailable in this thread.
- Backend focused IPC/payment workflow Jest passed: 1 suite, 10 tests.
- Backend module/action permission Jest passed: 1 suite, 204 tests.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 44 suites, 399 tests.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 156 documented paths.
- Frontend commercial traceability, financial precision, and permission visibility UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend Vite production build passed with existing plugin deprecation/timing and chunk-size warnings only.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Backend modified service/route/OpenAPI syntax checks passed with bundled Node.
- Backend OpenAPI validation passed for 153 documented paths.
- Frontend commercial traceability UI assertions passed.
- Backend focused Jest could not be run in this checkout because the local backend `node_modules` is missing Jest and the shell has no `npm` executable on PATH.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 44 suites, 365 tests.
- Backend focused approval workflow regression Jest passed: 8 suites, 34 tests.
- Prisma validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 153 documented paths.
- Backend OpenAPI and module-action permission Jest passed: 2 suites, 186 tests.
- Frontend approval workflow UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 43 suites, 362 tests.
- Backend focused daily reporting/mobile workflow Jest passed: 3 suites, 188 tests.
- Prisma validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 151 documented paths.
- Frontend site-reporting mobile UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend targeted Prettier check passed for touched site-reporting files.
- Frontend Vite production build passed with existing plugin deprecation/timing and chunk-size warnings only.
- EC2 user-data validation self-test and live Terraform source validation passed.
- Terraform `init -backend=false` and `validate -no-color` passed locally with Terraform 1.7.5.
- Existing infrastructure API-origin, RDS-backup, and secret-hygiene validators passed.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 43 suites, 357 tests.
- Backend focused audit/history Jest passed: 8 suites, 207 tests.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 151 documented paths.
- Frontend audit-history UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend ESLint passed with 12 existing warnings outside the modified audit-history files.
- Frontend Vite production build passed with existing plugin deprecation and chunk-size warnings only.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 42 suites, 352 tests.
- Backend focused EV/cost permission Jest passed: 2 suites, 188 tests.
- Backend cost list pagination regression Jest passed: 1 suite, 3 tests.
- Prisma validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 151 documented paths.
- Frontend official EV UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend ESLint passed with 12 existing warnings outside the modified EV report/cost files.
- Frontend Vite production build passed with existing plugin deprecation and chunk-size warnings only.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 42 suites, 348 tests.
- Backend focused CPM Jest passed: 1 suite, 6 tests.
- Prisma validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 151 documented paths.
- Frontend schedule dependency UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend ESLint passed with existing warnings only.
- Frontend Vite production build passed with existing plugin timing/deprecation and chunk-size warnings only.
- Focused secure file-storage, BOQ service, BOQ upload route, production security config, and OpenAPI Jest passed: 5 suites, 30 tests.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 41 suites, 343 tests.
- Prisma validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 151 documented paths.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend Vite production build passed with existing plugin timing and chunk-size warnings only.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 40 suites, 339 tests.
- Backend focused list pagination/filtering/sorting Jest passed: 2 suites, 8 tests.
- Prisma validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 148 documented paths.
- Frontend list pagination UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend ESLint passed with existing warnings only.
- Frontend Vite production build passed with existing plugin deprecation and chunk-size warnings only.
- Backend OpenAPI validation passed for 148 documented paths with live `/api/v1` route coverage.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 38 suites, 331 tests.
- Backend focused Stripe security/webhook Jest passed: 2 suites, 15 tests.
- Backend OpenAPI validation passed for 104 documented paths.
- Backend OpenAPI Jest passed: 1 suite, 5 tests.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 38 suites, 330 tests.
- Secret hygiene self-test and tracked-source validation passed.
- Backend deployment smoke passed against a temporary local test server, including unsigned Stripe webhook rejection and signed safe-event acceptance.
- Frontend billing Stripe configuration UI assertions passed.
- Prisma validate passed for `backend/prisma/schema.prisma`.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend ESLint passed with existing warnings only.
- Frontend Vite production build passed with existing plugin deprecation and chunk-size warnings only.
- Backend focused project/object authorization and module permission Jest passed: 3 suites, 190 tests.
- Prisma validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 95 documented paths.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 38 suites, 325 tests.
- Frontend project-access UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend ESLint passed with existing warnings only.
- Frontend Vite production build passed with existing plugin timing and chunk-size warnings only.
- Backend focused auth refresh-session Jest passed: 2 suites, 5 tests.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 95 documented paths.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 37 suites, 315 tests.
- Frontend auth token-storage assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend ESLint passed with existing warnings only.
- Frontend Vite production build passed with existing plugin timing and chunk-size warnings only.
- Frontend permission, subscription, dashboard, commercial traceability, procurement risk, workflow maturity, project setup, and financial precision assertions passed.
- Backend focused subscription gate Jest passed: 1 suite, 4 tests.
- Backend module/action permission Jest passed: 1 suite, 177 tests.
- Backend OpenAPI Jest passed: 1 suite, 5 tests.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 35 suites, 310 tests.
- Frontend subscription-gate UI assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation.
- Frontend ESLint passed with existing warnings only.
- Frontend Vite production build passed with existing plugin timing and chunk-size warnings only.

## 2026-06-09

### Added

- Added TASK-P0 construction module RBAC policies for RFI, submittal, NCR, and safety create/update/delete routes, with shared permission metadata, route-level 403 regression coverage, OpenAPI permission annotations, frontend create-control visibility checks, and manual QA role-matrix updates.
- Added TASK-P0 API origin lockdown validation with unsafe/compliant self-tests for Terraform, covering world-open EC2 API ingress, direct Route53 API records, CloudFront origin header configuration, and JWT/CloudFront secret separation.
- Added API origin security checks to the Quality Gates infrastructure job and release/security documentation with manual QA requirements for direct-origin blocking and CloudFront health verification.
- Added TASK-P0 production RDS backup and recovery hardening with validated Terraform backup retention variables, retained automated backups, required final snapshots with generated unique suffixes, snapshot tag copying, RPO/RTO tags, and release-blocking recovery documentation.
- Added an infrastructure RDS backup validation script with positive/negative self-tests and wired it into the Quality Gates deployment-readiness workflow.
- Added an RDS backup and recovery runbook covering restore rehearsal, rollback, RPO/RTO evidence capture, and construction workflow manual QA checks.
- Added TASK-P0 financial precision hardening with migration `20260610090000_decimal_money_values`, converting monetary Prisma fields to `Decimal(18,2)` and adding non-negative DB constraints for applicable money columns.
- Added shared backend/frontend money precision helpers, backend Decimal arithmetic/unit coverage, API validation regression coverage, and frontend financial precision UI assertions.
- Added financial precision QA documentation covering migration backup/dry-run/rollback checks plus BOQ, IPC, retention, EV, budget revision, and cash-flow manual scenarios.
- Added TASK-P0 BOQ activity spine unification with migration `20260610070000_unify_boq_activity_spine`, backfilling legacy `BoqActivity` rows into official `Activity` + submitted `ActivityBoqAllocation` records while retaining `BoqActivity` only as suggestion/history storage.
- Added BOQ spine QA documentation with migration backup, dry-run, rollback, manual construction workflow checks, and go-live evidence requirements.
- Added TASK-P0 BOQ revision and baseline-locking hardening with `BoqRevision` history, active/current BOQ row tracking, baseline-aware comparison-only uploads, non-destructive revised BOQ import, and QA documentation for revision preservation checks.
- Added FB-020 go-live readiness gate documentation with P0 blocker linkage, pilot-only restrictions, module acceptance criteria, executable BOQ-to-dashboard QA scenarios, required evidence commands, signoff records, and risk acceptance controls.
- Connected the release checklist to the go-live readiness gate so source-of-truth rollout requires recorded Product, QA, Security, Backend, Frontend, and Business signoff in addition to CI and smoke checks.
- Added FB-019 production security readiness hardening with shared Express/Socket.IO CORS origin allowlisting, production startup secret validation, Stripe webhook configuration fail-fast handling, a CloudFront origin shared-secret guard, and focused backend tests for security config and Stripe webhook signatures.
- Added a backend deployment smoke script covering health, auth/project/BOQ/schedule paths, and safe unsigned Stripe webhook rejection, plus FB-019 release/security checklist documentation that records secret-rotation evidence without storing secret values.
- Added FB-018 Quality Gates GitHub Actions workflow covering backend Jest, Prisma schema validation, OpenAPI contract validation and smoke tests, frontend lint, frontend production build, and an aggregate deployment-readiness check.
- Added a backend `prisma:validate` script for CI and local schema validation.
- Added a release checklist documenting required automated checks, the deployment gating rule, and manual readiness signoffs for production promotion.
- Added FB-017 OpenAPI documentation with a generated backend contract at `/api/v1/openapi.json`, Swagger UI at `/api/docs`, shared auth/envelope/error/pagination schemas, per-operation permission metadata, upload endpoint docs, validator script, focused Jest smoke tests, and GitHub Actions validation.
- Added FB-016 workspace dashboard aggregate API at `/api/v1/projects/workspace-dashboard` with portfolio health, construction workflow queues, procurement risk, overdue NCR/RFI, and project watchlist summaries.
- Added a construction PM root dashboard with portfolio health cards, workflow queue links into project modules, seven-dimension health scoring, project health watchlist, authenticated empty state, and dashboard assertion coverage.
- Added FB-015 project setup readiness with a read-only backend endpoint at `/api/v1/projects/:id/setup-readiness`, v1 PM setup steps, baseline/progress gate summaries, and backend regression coverage.
- Added a guided project setup wizard on project detail with step status, next action navigation, critical blocker visibility for BOQ, schedule approval, allocations, baseline, and progress readiness.
- Added project setup readiness warnings to schedule baseline and progress entry surfaces, plus frontend readiness assertion coverage at `frontend/scripts/project-setup-readiness.test.mjs`.
- Added FB-014 quality/document workflow maturity with shared `WorkflowAttachment`, `WorkflowStatusHistory`, `WorkflowActivityLink`, and `DocumentRevision` Prisma models plus migration `20260610030000_mature_quality_document_workflows`.
- Added owner/reviewer/approver and due-date workflow metadata across quality and document-control records while preserving legacy single `activityId` fields.
- Added project-scoped workflow evidence upload/download APIs under `/api/v1/projects/:projectId/workflow/uploads` for images, PDFs, Word, Excel, CSV, and text evidence.
- Added workflow service enrichment for NCR, ITP, defects, safety incidents, material tests, RFIs, submittals, drawings, transmittals, and correspondence with attachments, multi-activity links, due alerts, status history, and document revisions.
- Added shared frontend workflow detail lists showing assignments, due alerts, activity links, evidence, revision snapshots, and status history in quality and document-control dashboards.
- Added backend workflow maturity regression tests and frontend workflow maturity UI assertions.
- Added FB-013 procurement need-date/risk alerts with long-lead and procurement-order timing/receipt fields, migration `20260610010000_procurement_need_dates_risk_alerts`, computed activity-driven need dates, computed order-by dates from lead time plus buffer, and warehouse receipt states.
- Added a shared procurement risk service for delivery slip, missed order-by, missing schedule-date, missing activity-link, pending receipt, and warehouse-clear severity calculations.
- Added long-lead API enrichment with need date, order-by date, days-at-risk, impacted activity, and procurement risk payloads, plus schedule-critical activity-link validation for high/critical or 12+ week items.
- Added procurement risk displays on the schedule activity table, schedule alert summary, long-lead register, project health dashboard, and long-lead XLSX export sheet.
- Added backend procurement risk and long-lead transition tests, plus frontend procurement-risk UI assertion coverage at `frontend/scripts/procurement-risk-ui.test.mjs`.
- Added FB-012 commercial traceability with new Prisma join/reference models for change-order activities/BOQ allocations, IPC item approved-progress basis, sub-valuation activity/allocation breakdowns, EOT affected activities/weather links, weather-delay activity links, commercial correspondence links, and commercial attachment references, plus migration `20260609230000_strengthen_commercial_traceability`.
- Added commercial service traceability syncing and response enrichment for linked activities, approved BOQ allocations, correspondence, attachments, and approval history across change orders, sub valuations, EOT claims, and weather delays.
- Added IPC certification reconciliation snapshots linking IPC items to the latest approved activity progress for their approved BOQ allocation.
- Added commercial UI traceability controls and displays for multi-activity change orders, IPC approved progress basis, sub valuation trace counts, EOT critical path impact, and weather affected activities.
- Added backend traceability regression tests for change orders, IPC, sub valuations, and EOT, plus frontend commercial traceability assertions at `frontend/scripts/commercial-traceability.test.mjs`.
- Added FB-011 mobile-ready site reporting workflow with expanded `DailyReport` approval/rejection states, rejection reasons, linked progress approval, and migration `20260609210000_mobile_site_reporting_flow`.
- Added project-scoped `SiteDiary` workflow fields for manpower, equipment, materials, photos, notes, status, submit/review metadata, and engineer tracking.
- Added daily report and site diary list/detail/create/update/submit/approve/reject APIs, plus authenticated project-scoped site reporting photo upload/download APIs.
- Added responsive frontend Site Reporting project module with activity report entry, site diary entry, photo upload controls, and PM/planning/QS review queue actions.
- Added mobile API consumer documentation for site reporting endpoints and request/response schemas at `docs/api/mobile-site-reporting.md`.
- Added backend tests for daily report approval-linked progress, site diary workflow, site reporting photo storage, and route permission coverage.
- Added FB-010 shared `AuditEvent` history model, migration `20260609190000_add_audit_events_status_history`, compact/redacted audit payload handling, and tenant/project/entity timeline indexes.
- Added project audit read API under `/api/v1/projects/:projectId/audit` with module/action permission coverage and tenant-scoped entity filters.
- Added service-layer audit emissions for schedule revision submit/approve/reject/baseline/supersede, progress approval/rejection, IPC submit/certify, and change-order create/update/approve/reject/delete workflows.
- Added direct IPC certification metadata and change-order created/updated/approved/rejected actor metadata for critical record workflows.
- Added frontend audit history panels for schedule status, progress approvals, IPC certificate status, and change-order status history.
- Added backend audit service, audit route authorization, schedule baseline, progress approval, IPC certification, and change-order approval/delete audit tests.
- Added FB-009 shared module/action permission policy metadata covering read, create, update, delete, submit, approve, certify, baseline, export, and workflow transitions for schedule, progress, IPC, cost, and user management.
- Added backend `requirePermission(module, action)` authorization middleware with route coverage for schedule, activity progress, daily reports, imports, exports, reports, IPC, cost, and user-management workflows.
- Added frontend permission helpers that consume the shared policy metadata to hide or disable schedule, progress, IPC, cost, activity, export, and user-management actions by role.
- Added backend module/action authorization tests covering all eight roles across schedule approval, progress submission, IPC certification, cost update, and user creation, plus frontend permission visibility assertions.
- Added QA role matrix documentation at `docs/qa/role-permission-matrix.md`.
- Added FB-008 activity progress method configuration, method-aware progress submissions, approval/rejection workflow, evidence metadata, and migration `20260609170000_add_progress_methods_approval_evidence`.
- Added daily report APIs for site manpower, equipment, materials, notes, photos, review status, and optional linked progress submission evidence.
- Added backend progress tests for quantity and weighted milestone calculation, evidence requirements, approval gating, approved progress creation, EV impact, and daily report evidence linkage.
- Added FB-007 earned value reporting periods, approved time-phased activity cost loading, lockable EV period snapshots, progress approval/source metadata, budget revision approval metadata, and migration `20260609150000_harden_earned_value_basis`.
- Added a shared earned value service with official cutoff-period formulas, PV from approved cost loading, EV from approved progress and approved BOQ allocations, explicit official AC source hierarchy, budget revision BAC adjustments, and snapshot locking.
- Added EV reporting period and cost-loading APIs under project reports, including period creation, period locking, cost-loading create/update/list, and cost-loading approval.
- Added backend earned value tests for normal, zero-cost, overrun, approved budget-revision, and period-snapshot locking cases.
- Added FB-006 staged schedule revision activation with active/inactive revision tracking, revision source/activation/rollback/mapping audit fields, active activity retirement metadata, and migration `20260609130000_stage_schedule_revision_activation`.
- Added schedule revision mapping, activation, and rollback APIs with old/new activity mapping suggestions, explicit unmapped-removal reasons, transactional activation, and preservation-focused audit summaries.
- Added frontend revision history activation and rollback controls with mapping previews and required removal/rollback reasons.
- Added FB-005 structured CPM dependencies with an `ActivityDependency` model for predecessor/successor rows, FS/SS/FF/SF relationship type, lag/lead days, source, external import refs, and import metadata.
- Added migration `20260609113000_add_activity_dependencies` with relationship/source/self-link constraints, indexes, and best-effort backfill from legacy `Activity.predecessors` strings.
- Added shared activity dependency normalization for legacy predecessor parsing, structured API payloads, dependency serialization, self-link validation, unresolved-reference validation, and cycle detection.
- Added critical path explanation output on the schedule API and review panel, including the driving predecessor chain, float drivers, dependency count, and calendar ids.
- Added backend CPM and parser mapping tests for structured relationship types, lag/lead, calendars, cycles, and XER/P6 XML/MSP relationship import conversion.
- Added FB-004 schedule revision lifecycle fields for draft, under-review, approved, rejected, baselined, and superseded statuses with reviewer/baseline audit metadata, readiness snapshots, and transition logs.
- Added migration `20260609100000_add_schedule_revision_lifecycle` with status constraints and project/status indexing.
- Added schedule lifecycle API endpoints for readiness, submit review, approve, reject, and revision-specific baseline lock.
- Added backend lifecycle and route permission tests covering valid/invalid transitions, approval audit fields, rejection reasons, readiness blocking, draft baseline blocking, and PM-only approval/baseline gates.
- Added frontend schedule review panel with controlled submit/approve/reject/baseline dialogs and readiness checklist display.

### Changed

- Locked Terraform API origin ingress to the AWS-managed CloudFront origin-facing prefix list, removed the direct `api.<domain>` Route53 record, and removed direct API endpoint guidance from Terraform examples/outputs.
- Financial APIs now reject monetary inputs with more than two meaningful decimal places, serialize Prisma Decimal money values through the response envelope, and use Decimal-based service arithmetic for BOQ, IPC, EV, cost, commercial, schedule, and reporting totals.
- Project, BOQ, allocation, cost, commercial, and equipment money entry UI now uses cent-based inputs with immediate precision feedback before submitting to the API.
- BOQ manual row creation, BOQ add-activity helpers, and BOQ AI upload completion now create real schedule `Activity` rows with draft `ActivityBoqAllocation` links instead of live `BoqActivity` rows.
- BOQ reads now render activity rows from official activity allocations, BOQ activity helper edits are limited to draft allocations, and submitted/approved allocations must be changed through the allocation workflow.
- BOQ frontend activity rows now show allocation status, lock misleading inline edits/removal after draft, surface backend allocation validation errors, and invalidate schedule/activity/allocation consumers when BOQ helpers create or retire schedule work.
- BOQ upload now compares incoming rows against active current BOQ rows instead of deleting/recreating uploaded scope, preserving historical BOQ rows, generated activities, allocations, progress basis, IPC links, and reporting traceability.
- BOQ grids and upload feedback now show baseline-locked state, disable misleading direct edits, and allow uploads to be saved as revision comparisons when the schedule/BOQ baseline is locked.
- Terraform now uses a dedicated `cloudfront_origin_secret` for the CloudFront-to-origin shared header instead of reusing JWT secret material, and the deploy workflow writes validated CORS, Stripe webhook, and CloudFront runtime settings before running backend smoke checks.
- Deployments now run only after a successful `Quality Gates` workflow run from a push to `main`, and deploy the validated commit SHA.
- Frontend lint now treats React Compiler `set-state-in-effect` findings as warnings while keeping type/import/expression lint errors blocking, and existing lint-blocking type issues were cleaned up in activity, billing, BOQ, health, EV, and resource-plan components.
- Replaced the root dashboard's generic admin-template sales, subscription, traffic, and recent-sales content with construction-specific health and approval workflow content.
- Quality and document dashboard metrics now include due-alert and overdue workflow counts.
- Supply-chain health scoring now uses severity-weighted procurement risk across procurement orders and long-lead items, with overdue PO counts retained as detail rather than the sole score driver.
- Warehouse receipt or issue transitions now mark long-lead delivery complete and clear schedule delivery risk, while partial receipt and pending warehouse receipt can still surface reduced risk near the activity need date.
- IPC item updates and certification now prevent cumulative certification from exceeding the latest approved progress value on the linked approved BOQ allocation.
- Change orders now preserve the legacy single `activityId` while syncing first-class multi-activity trace links.
- Daily reports now use `draft`, `submitted`, `approved`, and `rejected` workflow states; the legacy `/review` endpoint remains as an approval alias.
- Progress permissions now include explicit daily report, site diary, and site reporting upload transitions for field submission and reviewer approval/rejection.
- Schedule progress quick entry and bulk updates now create submitted progress for approval instead of immediately writing official approved progress, while approvals create the approved `ActivityProgress` rows consumed by official EV.
- Schedule progress UI now supports progress method setup, method-specific submissions, approval/rejection actions, and daily site report capture.
- Official EV basis text now states that method-specific progress submissions affect EV only after approval.
- EV reports and health scoring now consume the shared official EV service instead of route-local simplified calculations.
- Official EV AC no longer silently uses progress-derived actual cost; progress imports and progress slider updates now leave actual cost null unless an actual is explicitly provided.
- Schedule progress and EV dashboard values are labeled as live estimates, while the official EV report displays cutoff period, locked/open basis, source counts, warnings, and separated PV/AC estimates.
- Approved progress is now the default basis for schedule/report/export reads, with existing progress records backfilled to approved by the FB-007 migration default.
- Budget revision summaries now apply approved revisions to EV baseline/BAC calculations and preserve approval metadata.
- Schedule AI generation and P6/MSP imports now create draft revision snapshots without deleting active activities, progress, cost records, assignments, resource allocations, procurement, long-lead items, risks, materials, equipment, or BOQ records.
- Approved staged revisions now become official only after activation; mapped activities are updated in place to preserve linked records, new staged activities are inserted, and unmapped active activities are retired with an explicit reason instead of being deleted.
- Current schedule, CPM, resource, cost, and allocation rollups now use active activities so retired schedule rows remain historical records without counting as the official active schedule.
- CPM recalculation now consumes structured dependency rows first and only falls back to legacy predecessor strings for compatibility.
- Activity create/update APIs now accept structured dependency arrays, update the legacy predecessor display string from rows, validate cycles before CPM recalculation, and rerun the shared CPM engine.
- AI schedule generation and P6/MSP imports now create structured dependency rows instead of persisting relationship logic only as free text.
- XER, P6 XML, and MSP import parsing now preserves negative relationship lag values as leads.
- Schedule readiness now validates structured dependency rows, unsupported relationship types, self-links, missing predecessor refs, and dependency cycles.
- Schedule Gantt arrows, activity tables, and the inline edit dialog now use structured dependency data, with controls for predecessor, relationship type, and lag/lead.
- Schedule generation and P6/MSP imports now create draft revisions and supersede still-open prior review candidates.
- Baseline locking now requires an approved current revision and passing readiness checks for predecessors, BOQ allocations, critical path, and date sanity.
- Revision history now displays lifecycle status, rejection reasons, and key lifecycle timestamps.
- Schedule job cleanup timer now uses `unref()` when available so backend tests can exit cleanly.

### Verification

- API origin security validation self-test passed with bundled Node.
- Live Terraform API origin security validation passed with bundled Node.
- RDS backup validation self-test and live policy validation passed after the infrastructure Quality Gates update.
- RDS backup validation script syntax check passed with bundled Node.
- RDS backup validation self-test passed, covering unsafe and compliant Terraform policy fixtures.
- Live Terraform RDS backup policy validation passed.
- Backend financial precision focused Jest passed: 6 suites, 108 tests.
- Frontend financial precision UI assertions passed via `frontend/scripts/financial-precision-ui.test.mjs`.
- Frontend TypeScript build and Vite production build passed with existing Vite chunk-size/plugin timing warnings only.
- Prisma format and validate passed for `backend/prisma/schema.prisma`; backend OpenAPI validation passed for 90 documented paths.
- Backend BOQ spine regression Jest passed: 1 suite, 7 tests.
- Backend focused BOQ/OpenAPI/allocation Jest passed: 3 suites, 18 tests.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 33 suites, 197 tests.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 90 documented paths.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with existing chunk-size warnings only.
- Backend targeted BOQ revision Jest passed: 1 suite, 5 tests.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Backend OpenAPI validation passed for 89 documented paths.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 33 suites, 195 tests.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with existing chunk-size warnings only.
- Browser smoke reached `http://127.0.0.1:5178/projects/demo/boq` with no console errors; the local route rendered the app shell and expected project-not-found state because no demo project was seeded.
- Backend targeted FB-019 Jest passed for security config and Stripe webhook signatures: 2 suites, 10 tests.
- Backend deployment smoke script passed against a temporary local test server.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 33 suites, 193 tests.
- GitHub Actions workflow YAML parsed locally for `quality-gates.yml`, `deploy.yml`, and `openapi.yml`.
- Prisma validate passed for `backend/prisma/schema.prisma` with a local CI-style `DATABASE_URL`.
- Backend OpenAPI validation passed for 89 documented paths; focused OpenAPI Jest passed: 1 suite, 5 tests.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 31 suites, 183 tests.
- Frontend ESLint passed with warnings only using direct bundled Node invocation and the root ESLint binary.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with direct bundled Node invocation and root Vite binary.
- Backend OpenAPI validation passed for 89 documented paths.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 31 suites, 183 tests.
- Backend targeted workspace dashboard Jest passed: 1 suite, 2 tests.
- Frontend dashboard construction assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with direct bundled Node invocation and root Vite binary.
- Browser dashboard QA passed on mock-backed `http://127.0.0.1:5177/` in light, dark, and 390px mobile viewports; queue navigation carried `module` and `child` search params.
- Backend targeted FB-015 Jest passed: 1 suite, 3 tests.
- Frontend project setup readiness assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with direct bundled Node invocation and root Vite binary.
- Browser smoke QA passed on `http://127.0.0.1:5175/` with no console errors on landing/auth redirect render.
- Prisma format passed for `backend/prisma/schema.prisma`.
- Prisma validate passed for `backend/prisma/schema.prisma` with a local validation `DATABASE_URL`.
- Backend targeted FB-014 Jest passed: 2 suites, 4 tests.
- Frontend workflow maturity assertions passed.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with direct bundled Node invocation and root Vite binary.
- Browser smoke QA passed on `http://127.0.0.1:5175/` with no console errors on landing/auth redirect render.
- Prisma format passed for `backend/prisma/schema.prisma`.
- Prisma validate passed for `backend/prisma/schema.prisma` with a local validation `DATABASE_URL`.
- Backend targeted FB-013 Jest passed: 2 suites, 8 tests.
- Frontend procurement risk assertions passed with direct bundled Node invocation.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with direct bundled Node invocation and root Vite binary.
- Prisma format passed for `backend/prisma/schema.prisma`.
- Prisma validate passed for `backend/prisma/schema.prisma` with a local validation `DATABASE_URL`.
- Backend targeted FB-012 Jest passed: 4 suites, 9 tests.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 25 suites, 163 tests.
- Frontend commercial traceability assertions passed with direct bundled Node invocation.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with direct bundled Node invocation and root Vite binary.
- Prisma format passed for `backend/prisma/schema.prisma`.
- Prisma validate passed for `backend/prisma/schema.prisma` with a local validation `DATABASE_URL`.
- Backend targeted FB-011 Jest passed: 4 suites, 86 tests.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with direct bundled Node invocation and root Vite binary.
- Browser responsive QA passed against a mock-backed project on desktop 1280px and mobile 390px viewports, with no console errors and no body-level horizontal overflow.
- Prisma format passed for `backend/prisma/schema.prisma`.
- Prisma validate passed for `backend/prisma/schema.prisma` with a local validation `DATABASE_URL`.
- Backend targeted audit/workflow Jest passed: 7 suites, 61 tests.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 21 suites, 114 tests.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with direct bundled Node invocation and root Vite binary.
- Frontend permission visibility assertions passed: 11 checks.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 18 suites, 107 tests.
- Backend targeted module/action permission Jest passed: 2 suites, 47 tests.
- Frontend permission visibility assertions passed: 11 checks.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with direct bundled Node invocation and root Vite binary.
- Backend Jest passed with direct bundled Node invocation and root Jest binary: 16 suites, 60 tests.
- Backend targeted Jest passed for FB-008 progress, daily report, and EV approval gating: 3 suites, 12 tests.
- Frontend TypeScript build passed with direct bundled Node invocation and root TypeScript binary.
- Frontend Vite production build passed with direct bundled Node invocation and root Vite binary.
- Frontend Vite dev server started on `http://127.0.0.1:5175/` and returned HTTP 200.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Backend Jest passed with direct bundled Node invocation and `--runInBand --forceExit`: 14 suites, 53 tests.
- Backend targeted Jest passed for earned value service: 1 suite, 5 tests.
- Frontend TypeScript build passed with `tsc -b`.
- Frontend Vite production build passed.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Prisma generate was attempted but remains blocked by a Windows `EPERM` rename on Prisma's generated query-engine DLL.
- Backend Jest passed with `--runInBand --forceExit`: 13 suites, 48 tests.
- Backend targeted Jest passed for schedule lifecycle and activation preservation: 1 suite, 7 tests.
- Frontend TypeScript build passed with `tsc -b`.
- Frontend Vite production build passed.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Prisma generate was attempted but remains blocked by a Windows `EPERM` rename on Prisma's generated query-engine DLL.
- Backend Jest passed with `--forceExit`: 13 suites, 46 tests.
- Prisma format and validate passed for `backend/prisma/schema.prisma` with a local validation `DATABASE_URL`.
- Frontend TypeScript build and Vite production build passed.
- Prisma generate was attempted but remains blocked by a Windows `EPERM` rename on Prisma's generated query-engine DLL.
- Backend targeted Jest passed for schedule lifecycle and route permissions: 2 suites, 9 tests.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Frontend TypeScript build and Vite production build passed.
- Prisma generate was attempted but remains blocked by a Windows `EPERM` rename on Prisma's generated query-engine DLL.

## 2026-06-08

### Added

- Added FB-003 project contract metadata expansion with nullable project fields for contract parties, contract type/number, baseline date, revised completion, default retention rate, project calendar, and reporting cutoff day.
- Added migration `20260608190000_expand_project_contract_metadata` with retention and cutoff range checks.
- Added backend project service regression tests for metadata create/update, backward-compatible reads, date validation, and IPC retention default inheritance.
- Added FB-002 BOQ integrity hardening with per-project uniqueness for BOQ item codes and generated BOQ activity codes.
- Added BOQ scheduled, unscheduled, earned, and certified value-state rollups from approved activity BOQ allocations, latest progress, and certified IPC rows.
- Added backend regression tests for BOQ duplicate handling, generated activity-code immutability, upload conflicts, allocation value-state rollups, and frontend read-only activity-code guards.
- Added an agent workflow rule requiring the latest `origin/main` to be pulled before committing and the branch to be pushed again after committing.
- Added FB-001 Activity BOQ Allocation Spine with a new `ActivityBoqAllocation` Prisma model linking BOQ items to official schedule `Activity` records.
- Added migration `20260608170000_add_activity_boq_allocation` with:
  - `ActivityBoqAllocation` table.
  - Optional `IpcItem.allocationId` relation.
  - Partial unique index preventing duplicate active BOQ item/activity allocation pairs.
  - Trigger-based validation preventing active allocation quantity/value totals from exceeding the BOQ item quantity/value.
- Added backend allocation service and project-scoped API routes for list, create, edit, submit, approve, and reject workflows.
- Added frontend BOQ allocation panel for mapping BOQ value to schedule activities.
- Added unallocated BOQ value display at project and BOQ-row levels.
- Added activity detail/list display fields for approved allocated BOQ quantity, value, weight, and allocation count.
- Added IPC activity traceability so IPC rows can reference the approved allocation and linked schedule activity.
- Added backend tests covering allocation validation, tenant scoping, approval workflow, approved rollups, and IPC allocation seeding.

### Changed

- Project create/edit APIs now validate contract metadata, existing `ldRatePerDay`, weather allowance, calendar, and reporting cutoff settings.
- Project create/edit/details UI now groups metadata into project basics, contract parties, contract terms, commercial defaults, and reporting settings.
- IPC and sub-valuation creation now inherit the project default retention rate, and schedule generation/import/manual activity creation inherit the project calendar when no activity calendar is supplied.
- EV reports now include project reporting cutoff and calendar metadata for downstream period-aware workflows.
- EOT calculations now include contract/revised completion context in the generated claim data and letter.
- BOQ create/edit frontend schemas and forms now treat generated activity codes as output-only, and BOQ grids render activity codes read-only.
- BOQ financial summaries and row grids now show scheduled and unscheduled value, plus earned and certified values in the summary.
- EV report, health dashboard, schedule API, progress import, progress update fallback actual cost, cost summaries, and IPC period creation now use approved activity BOQ allocations as the official budget/value basis.
- Schedule API now returns generated budget separately from approved allocated BOQ budget.
- IPC period creation now seeds from approved allocations instead of raw BOQ items, excluding unallocated BOQ value from official certification.
- BOQ API now returns allocation summary totals and row-level allocation totals.

### Verification

- Backend Jest passed with `--forceExit`: 9 suites, 31 tests. A plain all-suite run still hangs on an existing BOQ test open handle.
- Targeted backend Jest passed for project metadata and IPC default inheritance: 2 suites, 6 tests.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Frontend TypeScript build and Vite production build passed.
- Prisma generate was attempted but remains blocked by a Windows `EPERM` rename on Prisma's generated query-engine DLL.
- Backend Jest passed: 8 suites, 26 tests.
- Prisma format and validate passed for `backend/prisma/schema.prisma`.
- Frontend TypeScript build and Vite production build passed.
- Prisma generate was attempted but blocked by a Windows `EPERM` rename on Prisma's generated query-engine DLL while local Node dev processes were active.
