# Release Checklist

Use this checklist before promoting `main` to production. Automated checks must pass before any deployment job runs.

## Go-Live Gate

Production infrastructure deployment does not automatically make PMcopilots the official source of truth. Before lifting demo/pilot restrictions, complete the [go-live readiness gate](qa/go-live-readiness-gate.md) with P0 blocker evidence, QA scenario results, risk acceptance where needed, and Product, QA, Security, Backend, Frontend, and Business signoff.

## Required Automated Checks

- `Quality Gates / Backend package - test`: installs workspace dependencies and runs `npm test --workspace=backend -- --forceExit`.
- `Quality Gates / Backend package - Prisma validate`: runs `npm run prisma:validate --workspace=backend`.
- `Quality Gates / Backend package - OpenAPI validate`: runs `npm run openapi:validate --workspace=backend` and the focused OpenAPI smoke test with `--forceExit`.
- `Quality Gates / Frontend package - lint and build`: runs `npm run lint --workspace=frontend` and `npm run build --workspace=frontend`.
- `Quality Gates / Infrastructure - security and resilience validation`: runs API origin lockdown checks with `npm run infra:test:api-origin` and `npm run infra:validate:api-origin`, EC2 bootstrap checks with `npm run infra:test:ec2-user-data` and `npm run infra:validate:ec2-user-data`, tracked-source secret hygiene checks with `npm run security:test:secret-hygiene` and `npm run security:validate:secret-hygiene`, RDS backup checks with `npm run infra:test:rds-backups` and `npm run infra:validate:rds-backups`, deployment readiness checks with `npm run infra:test:deployment-readiness` and `npm run infra:validate:deployment-readiness`, then `terraform init -backend=false` and `terraform validate -no-color`.
- Dependency audit triage must be current in `docs/security/dependency-audit-triage.md`; no high or critical production vulnerability may remain without Security signoff.
- `Quality Gates / Deployment readiness - required checks`: confirms all required checks completed successfully.

## Deployment Rule

Production deployment is allowed only from a successful `Quality Gates` workflow run triggered by a push to `main`. The deploy workflow checks out and deploys the validated commit SHA from that workflow run.

Staging deployment rehearsal may use the manual `Deploy` workflow with `deploy_environment = staging`. Production deploys must use the selected GitHub Environment values documented in `docs/runbooks/rds-backup-recovery.md`, including authenticated smoke settings.

## Manual Readiness

- Complete `docs/qa/live-uat-evidence-checklist.md` with staging URL, commit SHA, named personas, browser/device evidence, screenshots, and pass/fail results before any controlled pilot.
- Complete `docs/ops/backup-restore-evidence-checklist.md`, `docs/ops/rollback-evidence-checklist.md`, and `docs/ops/monitoring-alert-evidence-checklist.md` before treating the release as operationally ready.
- Review `docs/ops/runtime-state-and-scale-blockers.md`; in-memory job state and in-memory rate limiting remain incompatible with multi-instance or paid production use until replaced or formally risk accepted.
- Complete `docs/qa/go-live-readiness-gate.md` for the target release. Any P0 row that is not `Passed` must have formal risk acceptance before source-of-truth rollout.
- Complete `docs/qa/documentation-readiness.md`: Help Center, admin guide, role user guide, support runbook, API docs, onboarding checklist, release notes, and known limitations must be reviewed by Product, QA, Support, Backend, Frontend, and Business owners.
- Confirm FB-019 production security readiness in `docs/security/production-security-readiness.md`, including Security/DevOps confirmation that suspect Stripe live keys were revoked or rotated without recording secret values.
- Confirm `docs/qa/auth-refresh-sessions.md`: login/register set an `HttpOnly` refresh cookie, response bodies never expose refresh tokens, refresh rotates/revokes server sessions, replayed refresh tokens are rejected, and logout revokes the active session.
- Confirm `docs/qa/rate-limiting-abuse-protection.md`: auth/login/refresh, uploads, AI generation, billing, and Stripe webhook throttles return structured `429` errors with retry metadata, and repeated bad-password attempts trigger backoff/temporary lockout.
- Confirm `docs/qa/api-response-error-normalization.md`: health, unknown route, validation, auth/authz, rate-limit, and unexpected-error responses use the standard `{ success, data|error }` envelope and cataloged OpenAPI error codes.
- Confirm `docs/qa/progress-assignment-authorization.md`: assigned field users can submit single, bulk, and daily-report progress; unassigned field users receive `ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED` with no partial writes; PM and Planning Engineer overrides still work; progress submission audit events are recorded.
- Confirm `docs/qa/prisma-unique-query-patterns.md`: BOQ item update/delete paths use project-scoped lookup before primary-id writes, duplicate active codes are rejected, and cross-project IDs return `BOQ_ITEM_NOT_FOUND`.
- Confirm `docs/qa/archive-retention-policy.md`: normal project/RFI/submittal/change-order/risk/safety delete actions archive records, active dashboards exclude archived records, retained history is queryable, and permanent purge remains out of scope without legal approval.
- Confirm `docs/qa/service-modularization.md`: BOQ job polling, template download, workbook parsing/validation, upload import, and AI BOQ-to-schedule generation still behave the same after the service split.
- Confirm production API origin lockdown: no direct Route53 API record, EC2 API port `5000` restricted to the CloudFront origin-facing prefix list, direct EIP requests blocked, and CloudFront `/api/health` responding.
- Confirm EC2 bootstrap readiness: `terraform plan` renders `user_data_base64` from `infrastructure/terraform/templates/user-data.sh`, the plan does not expose secret values in user data, Node.js 24 and npm 11 are installed and verified, and a replacement instance records successful cloud-init/bootstrap completion before backend deployment.
- Confirm GitHub Environment deployment variables are populated from Terraform outputs: app secret ARN, SPA/uploads buckets, CloudFront distribution ID, RDS host/name/user/port, AWS region, frontend/API origins, EC2 target, PM2 app name, backend port, and authenticated smoke user/project values.
- Confirm production Terraform uses `rds_multi_az = true` and a populated `alarm_notification_email`, then verify SNS subscription confirmation and one CloudWatch alarm receipt.
- Complete the RDS restore rehearsal in `docs/runbooks/rds-backup-recovery.md` and record RPO/RTO evidence plus DevOps/Database signoff.
- Confirm rotated live-mode `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, all paid-plan Stripe price IDs, `STRIPE_SECRET_ROTATION_CONFIRMED_AT`, `STRIPE_SECRET_ROTATION_TICKET`, approved HTTPS credentialed CORS origins, and distinct JWT/CloudFront shared secrets are configured in the production secret owners before deployment.
- Run `npm run smoke:deploy --workspace=backend` after backend restart. For rollout rehearsal, include `SMOKE_EMAIL`, `SMOKE_PASSWORD`, and `SMOKE_PROJECT_ID` so auth, project load, BOQ, and schedule checks execute against real data.
- Confirm unsigned Stripe webhook requests are rejected and valid signed test events pass in backend tests, deployment smoke with `SMOKE_STRIPE_WEBHOOK_SECRET`, or a Stripe CLI non-live listener before live rollout.
- Record Product, QA, Security, Backend, Frontend, and Business signoff before moving from pilot/demo use to official source-of-truth use.
- Record Support owner signoff on `docs/help-center/support-runbook.md` before customer support handoff.
