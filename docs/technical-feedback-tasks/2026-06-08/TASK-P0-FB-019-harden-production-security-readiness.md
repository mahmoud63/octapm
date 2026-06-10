# TASK FB-019: Harden Production Security Readiness

## Priority
P0

## Related Feedback

- Feedback ID: FB-019
- Original feedback summary: Harden security and production readiness around secrets, CORS/headers, Stripe webhook configuration, and smoke testing.

## Current Project Status

The backend uses JWT auth, bcrypt hashing, Helmet, and Stripe webhook signature verification. Configuration and operational notes still show production-readiness gaps.

## Evidence

- `backend/src/index.js`, line 19: Socket.IO CORS uses `FRONTEND_URL`.
- `backend/src/index.js`, lines 23-25: Express uses Helmet, unrestricted default `cors()`, and Morgan.
- `backend/src/routes/stripe-webhook.js`, lines 12-13: webhook signature verification depends on `STRIPE_WEBHOOK_SECRET`.
- `backend/src/services/auth.service.js`, lines 48 and 99: bcrypt hashing/comparison.
- `infrastructure/terraform/cdn.tf`, line 84: CloudFront shared secret reuses the JWT secret variable.
- `notes.txt`, lines 1-3: operational notes flag unconfirmed live key revocation, empty webhook secret, and untested UI smoke checks.

## Gap Analysis

Express CORS is permissive, secret rotation status cannot be verified from code, webhook secret configuration is flagged as empty, production smoke testing is incomplete, and a JWT secret is reused for a different infrastructure purpose.

## Required Changes

- [ ] Confirm and document revocation/rotation of any exposed or suspect live Stripe keys without storing secret values.
- [ ] Set and validate `STRIPE_WEBHOOK_SECRET` in required environments.
- [ ] Restrict Express CORS to approved frontend origins.
- [ ] Use a dedicated CloudFront shared-secret variable instead of reusing JWT secret material.
- [ ] Add startup/deploy validation for required production secrets.
- [ ] Add smoke tests for auth, project load, BOQ/schedule, and webhook path where safe.

## Suggested Technical Approach

Handle secret rotation outside the repo, then update configuration code and infrastructure variables. Add environment validation in backend startup and connect smoke checks to release readiness.

## Acceptance Criteria

- [ ] No production secret is reused for unrelated purposes.
- [ ] Express and Socket.IO CORS allow only approved origins in production.
- [ ] Stripe webhook rejects unsigned/incorrectly signed events and accepts valid signed test events.
- [ ] Required production secrets are validated at startup/deploy time.
- [ ] Smoke test checklist is documented and executed before live rollout.

## Testing Requirements

Add security configuration tests, webhook signature tests, deployment smoke tests, and manual secret-rotation verification by Security/DevOps.

## Risks

Secret handling is high risk. Do not paste live secrets into docs, logs, or tickets. CORS tightening can break clients if origins are incomplete.

## Dependencies

Depends on Security/DevOps confirmation for key revocation and environment ownership. Pairs with FB-018 and FB-020.

## Estimated Effort
M

## Notes

This task intentionally avoids storing or repeating any secret values.

## Implementation Status - 2026-06-09

- Completed in code: production CORS allowlisting for Express and Socket.IO, production startup/deploy secret validation, Stripe webhook configuration fail-fast handling, dedicated CloudFront shared-secret variable, CloudFront origin guard, safe deployment smoke script, and focused backend tests.
- Documented in `docs/security/production-security-readiness.md`: secret-rotation confirmation process, required production settings, and smoke-check execution steps.
- Requires external confirmation: Security/DevOps must verify suspect Stripe live key revocation or rotation in the approved secret-management or incident-tracking system without storing secret values in this repository.
