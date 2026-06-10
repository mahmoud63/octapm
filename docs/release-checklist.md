# Release Checklist

Use this checklist before promoting `main` to production. Automated checks must pass before any deployment job runs.

## Go-Live Gate

Production infrastructure deployment does not automatically make PMcopilots the official source of truth. Before lifting demo/pilot restrictions, complete the [go-live readiness gate](qa/go-live-readiness-gate.md) with P0 blocker evidence, QA scenario results, risk acceptance where needed, and Product, QA, Security, Backend, Frontend, and Business signoff.

## Required Automated Checks

- `Quality Gates / Backend package - test`: installs workspace dependencies and runs `npm test --workspace=backend -- --forceExit`.
- `Quality Gates / Backend package - Prisma validate`: runs `npm run prisma:validate --workspace=backend`.
- `Quality Gates / Backend package - OpenAPI validate`: runs `npm run openapi:validate --workspace=backend` and the focused OpenAPI smoke test with `--forceExit`.
- `Quality Gates / Frontend package - lint and build`: runs `npm run lint --workspace=frontend` and `npm run build --workspace=frontend`.
- `Quality Gates / Infrastructure - security and resilience validation`: runs API origin lockdown checks with `npm run infra:test:api-origin` and `npm run infra:validate:api-origin`, EC2 bootstrap checks with `npm run infra:test:ec2-user-data` and `npm run infra:validate:ec2-user-data`, tracked-source secret hygiene checks with `npm run security:test:secret-hygiene` and `npm run security:validate:secret-hygiene`, RDS backup checks with `npm run infra:test:rds-backups` and `npm run infra:validate:rds-backups`, then `terraform init -backend=false` and `terraform validate -no-color`.
- `Quality Gates / Deployment readiness - required checks`: confirms all required checks completed successfully.

## Deployment Rule

Production deployment is allowed only from a successful `Quality Gates` workflow run triggered by a push to `main`. The deploy workflow checks out and deploys the validated commit SHA from that workflow run.

## Manual Readiness

- Complete `docs/qa/go-live-readiness-gate.md` for the target release. Any P0 row that is not `Passed` must have formal risk acceptance before source-of-truth rollout.
- Confirm FB-019 production security readiness in `docs/security/production-security-readiness.md`, including Security/DevOps confirmation that suspect Stripe live keys were revoked or rotated without recording secret values.
- Confirm `docs/qa/auth-refresh-sessions.md`: login/register set an `HttpOnly` refresh cookie, response bodies never expose refresh tokens, refresh rotates/revokes server sessions, replayed refresh tokens are rejected, and logout revokes the active session.
- Confirm production API origin lockdown: no direct Route53 API record, EC2 API port `5000` restricted to the CloudFront origin-facing prefix list, direct EIP requests blocked, and CloudFront `/api/health` responding.
- Confirm EC2 bootstrap readiness: `terraform plan` renders `user_data_base64` from `infrastructure/terraform/templates/user-data.sh`, the plan does not expose secret values in user data, and a replacement instance records successful cloud-init/bootstrap completion before backend deployment.
- Complete the RDS restore rehearsal in `docs/runbooks/rds-backup-recovery.md` and record RPO/RTO evidence plus DevOps/Database signoff.
- Confirm rotated live-mode `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, all paid-plan Stripe price IDs, `STRIPE_SECRET_ROTATION_CONFIRMED_AT`, `STRIPE_SECRET_ROTATION_TICKET`, approved HTTPS credentialed CORS origins, and distinct JWT/CloudFront shared secrets are configured in the production secret owners before deployment.
- Run `npm run smoke:deploy --workspace=backend` after backend restart. For rollout rehearsal, include `SMOKE_EMAIL`, `SMOKE_PASSWORD`, and `SMOKE_PROJECT_ID` so auth, project load, BOQ, and schedule checks execute against real data.
- Confirm unsigned Stripe webhook requests are rejected and valid signed test events pass in backend tests, deployment smoke with `SMOKE_STRIPE_WEBHOOK_SECRET`, or a Stripe CLI non-live listener before live rollout.
- Record Product, QA, Security, Backend, Frontend, and Business signoff before moving from pilot/demo use to official source-of-truth use.
