# Rate Limiting and Abuse Protection QA

`TASK-P1-security-add-rate-limiting-and-abuse-protection` blocks release until this evidence is accepted by Security, Backend, and QA.

## Automated Evidence

- Backend limiter contract test: `backend/src/routes/__tests__/rate-limit.middleware.test.js`.
- Backend login backoff unit test: `backend/src/services/__tests__/auth-abuse.service.test.js`.
- Backend auth integration test: `backend/src/services/__tests__/auth-login-abuse.service.test.js`.
- OpenAPI validation must include the shared `429` error response contract for authenticated and unauthenticated API endpoints.

## Covered Controls

- Global `/api/v1` request throttle emits `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`.
- Blocked requests return `{ success: false, error: { code, message, details } }` with `429 RATE_LIMITED` and `Retry-After`.
- Auth endpoints have a tighter IP bucket; login and refresh have dedicated buckets.
- Login failures are tracked by normalized email and IP. Repeated failures trigger short backoff, then temporary lockout before another bcrypt comparison or database-heavy session creation.
- Upload endpoints for BOQ, schedule imports, progress imports, site reporting photos, and workflow attachments have project/user-scoped buckets before Multer reads the body.
- AI-triggering BOQ upload and schedule generation have project/user-scoped generation buckets in addition to plan AI quotas.
- Billing and Stripe webhook endpoints have separate throttles.

## Runtime Knobs

Security/DevOps may tune these per environment without code changes:

- `TRUST_PROXY_HOPS`
- `RATE_LIMIT_API_WINDOW_MS`, `RATE_LIMIT_API_MAX`
- `RATE_LIMIT_AUTH_WINDOW_MS`, `RATE_LIMIT_AUTH_MAX`
- `RATE_LIMIT_LOGIN_WINDOW_MS`, `RATE_LIMIT_LOGIN_MAX`
- `RATE_LIMIT_REFRESH_WINDOW_MS`, `RATE_LIMIT_REFRESH_MAX`
- `RATE_LIMIT_UPLOAD_WINDOW_MS`, `RATE_LIMIT_UPLOAD_MAX`
- `RATE_LIMIT_AI_WINDOW_MS`, `RATE_LIMIT_AI_MAX`
- `RATE_LIMIT_BILLING_WINDOW_MS`, `RATE_LIMIT_BILLING_MAX`
- `RATE_LIMIT_STRIPE_WEBHOOK_WINDOW_MS`, `RATE_LIMIT_STRIPE_WEBHOOK_MAX`

## Manual QA

Use a realistic construction smoke organization with PM, Planning Engineer, Site Engineer, QS, Procurement, Warehouse, and Finance users.

1. Send repeated bad-password login attempts for one user. Confirm the first failures return `401 INVALID_CREDENTIALS`, subsequent rapid retries return `429 LOGIN_BACKOFF`, and continued failures return `429 LOGIN_TEMPORARILY_LOCKED`.
2. Confirm the lockout response includes `error.details.retryAfterSeconds` and does not reveal whether the account exists beyond the normal invalid-credentials wording.
3. Confirm a successful login after the lockout window clears the email backoff state.
4. Lower `RATE_LIMIT_UPLOAD_MAX` in a local/staging environment and repeatedly upload BOQ, P6/MSP, progress, site photo, and workflow attachment files. Confirm the exhausted bucket returns `429 RATE_LIMITED` before the file is parsed or stored.
5. Lower `RATE_LIMIT_AI_MAX` and attempt repeated BOQ upload/schedule generation jobs for the same project/user. Confirm the API returns `429 RATE_LIMITED` before a new AI job starts.
6. Lower `RATE_LIMIT_BILLING_MAX` and repeatedly call billing endpoints as PM. Confirm the billing bucket blocks with `Retry-After` while other project reads remain usable.
7. Send repeated unsigned Stripe webhook requests in staging. Confirm signature rejection still works before the limit, and exhausted requests return `429` with no secret material logged.
8. Confirm CloudFront/proxy deployment sets `TRUST_PROXY_HOPS` so rate limiting keys on the real client IP rather than the EC2 loopback address.

## Acceptance Notes

- The backend is the source of truth for throttling and lockout; frontend controls are advisory UX only.
- In-memory buckets protect the single-node MVP deployment. A distributed store should replace the backing map before multi-instance horizontal scaling, keeping the same middleware boundary and response contract. Track that blocker in `docs/ops/runtime-state-and-scale-blockers.md`.
