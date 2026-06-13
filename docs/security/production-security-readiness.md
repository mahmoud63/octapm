# FB-019 Production Security Readiness

This checklist records production readiness evidence without storing secret values, partial keys, webhook secrets, or masked fingerprints in the repository.

## Secret Rotation and Ownership

Security/DevOps must complete and record these confirmations in the approved secret-management or incident ticketing system. Store only dates, owners, and ticket links in project notes.

- Suspect or exposed Stripe live secret keys are revoked in Stripe and replaced in the runtime secret owner systems.
- Replacement Stripe secret keys are stored only in GitHub Actions secrets, AWS Secrets Manager, or the approved production secret manager.
- Production `STRIPE_SECRET_KEY` uses a rotated live-mode Stripe secret key. Test-mode keys are blocked by production startup validation.
- `STRIPE_WEBHOOK_SECRET` is configured for every required environment and starts with Stripe's webhook signing-secret prefix.
- `STRIPE_SECRET_ROTATION_CONFIRMED_AT` and `STRIPE_SECRET_ROTATION_TICKET` are configured with the non-secret rotation date and approved ticket reference. Do not store the secret value, partial key, or fingerprint in the repository.
- JWT access, JWT refresh, and CloudFront origin shared secrets are generated independently and are not reused.
- Terraform is applied with `TF_VAR_cloudfront_origin_secret` set to a dedicated value that is different from JWT secrets.
- Refresh sessions are server-side records only; browser clients receive the refresh token only through the `HttpOnly` `pmc_refresh_token` cookie and never in JSON response bodies.
- Auth/login/refresh, upload, AI generation, billing, and Stripe webhook throttles are enabled in the backend. Security/DevOps owns production tuning for the `RATE_LIMIT_*` variables and must verify `TRUST_PROXY_HOPS` matches the CloudFront/origin proxy chain.

## API Origin Lockdown

Production API traffic must reach the backend through `https://<domain>/api/*` on CloudFront. Do not publish an `api.<domain>` Route53 record to the EC2 Elastic IP.

Terraform must keep these controls in place:

- EC2 port `5000` ingress allows only the AWS-managed `com.amazonaws.global.cloudfront.origin-facing` prefix list.
- CloudFront sends `X-CloudFront-Secret` using the dedicated `cloudfront_origin_secret` value.
- AWS Secrets Manager stores `CLOUDFRONT_SHARED_SECRET` from `cloudfront_origin_secret`, not from JWT material.
- The Quality Gates infrastructure job runs `npm run infra:test:api-origin` and `npm run infra:validate:api-origin`.

## Required Production Runtime Settings

Backend startup validates these settings when `NODE_ENV=production`:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `ANTHROPIC_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_INDIVIDUAL_MONTHLY`
- `STRIPE_PRICE_INDIVIDUAL_ANNUAL`
- `STRIPE_PRICE_BUSINESS_MONTHLY`
- `STRIPE_PRICE_BUSINESS_ANNUAL`
- `STRIPE_SECRET_ROTATION_CONFIRMED_AT`
- `STRIPE_SECRET_ROTATION_TICKET`
- `CLOUDFRONT_SHARED_SECRET`
- `CORS_ALLOWED_ORIGINS` or `FRONTEND_URL`
- Optional `RATE_LIMIT_*` overrides and `TRUST_PROXY_HOPS` when production traffic passes through a trusted proxy.

Production CORS origins must be explicit HTTPS origins. Wildcards, localhost, and path-bearing URLs are rejected.

Credentialed CORS must remain enabled for approved frontend origins so the `HttpOnly` refresh cookie can be set and rotated. Production refresh cookies must use `SameSite=None; Secure`; local/test cookies use `SameSite=Lax` without `Secure`.

Production startup also validates Stripe setup:

- `STRIPE_SECRET_KEY` must be live-mode (`sk_live_`) in production.
- `STRIPE_WEBHOOK_SECRET` must be a non-placeholder signing secret.
- All paid-plan Stripe price IDs must be configured.
- Rotation evidence must be present as date and ticket metadata only.

Tracked repository files are scanned in Quality Gates for live Stripe secret-key patterns. The scan reports only path, line, and finding type.

Private runtime upload storage is also checked in Quality Gates. Files under `backend/storage/private-documents/` or `storage/private-documents/` must remain untracked; see `docs/security/private-runtime-storage.md` for the source-control policy and history cleanup requirement.

## Deployment Smoke Checks

Automated safe smoke checks:

```bash
npm run smoke:deploy --workspace=backend
```

Recommended production invocation after backend restart:

```bash
SMOKE_BASE_URL=http://127.0.0.1:5000 SMOKE_CLOUDFRONT_SECRET="$CLOUDFRONT_SHARED_SECRET" npm run smoke:deploy --workspace=backend
```

To additionally verify a signed safe webhook event, provide the signing secret to the smoke process without printing it:

```bash
SMOKE_BASE_URL=http://127.0.0.1:5000 SMOKE_CLOUDFRONT_SECRET="$CLOUDFRONT_SHARED_SECRET" SMOKE_STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" npm run smoke:deploy --workspace=backend
```

For an authenticated rollout smoke, add `SMOKE_EMAIL`, `SMOKE_PASSWORD`, and optionally `SMOKE_PROJECT_ID`. Set `SMOKE_REQUIRE_AUTHENTICATED=true` when the deployment must fail without a real smoke user.

The smoke script verifies:

- API health endpoint responds.
- Auth gate behavior or real login/profile load.
- Project list behavior.
- BOQ and schedule route behavior.
- Unsigned Stripe webhook requests are rejected.
- Signed Stripe webhook test events are accepted when `SMOKE_STRIPE_WEBHOOK_SECRET` is supplied.

Manual QA before live rollout:

- Sign in with the approved smoke user.
- Confirm login sets an `HttpOnly` `pmc_refresh_token` cookie and the response body does not include a refresh token.
- Confirm repeated invalid logins trigger `429 LOGIN_BACKOFF` and then `429 LOGIN_TEMPORARILY_LOCKED`, with no account-existence leak.
- Confirm upload, AI generation, billing, and Stripe webhook throttles return structured `429` responses with `Retry-After` when lowered in staging.
- Confirm `/api/v1/auth/refresh` rotates the cookie, rejects body-only refresh tokens, and rejects replay of the previous cookie.
- Confirm sign-out calls `/api/v1/auth/logout`, revokes the server refresh session, and clears the refresh cookie.
- Load the project list and one project detail page.
- Open BOQ and schedule modules for the smoke project.
- Confirm `api.<domain>` does not resolve to the EC2 Elastic IP and there is no Route53 API record.
- Confirm direct requests to the EC2 Elastic IP on port `5000` are blocked, while CloudFront `/api/health` works.
- Run a safe Stripe webhook signature test with `SMOKE_STRIPE_WEBHOOK_SECRET` or in a non-live endpoint/local listener using Stripe CLI.
- Record Security/DevOps key-rotation confirmation and QA smoke evidence without storing secret values.
