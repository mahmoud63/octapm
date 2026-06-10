# Billing Stripe Webhook QA

TASK-P0-security-rotate-stripe-and-configure-webhook is a production blocker. Do not promote a release until Security/DevOps has confirmed live Stripe key revocation or rotation in the approved external system and the evidence below is attached without secret values.

## Automated Checks

- Backend focused Jest: `src/config/__tests__/security.test.js` and `src/routes/__tests__/stripe-webhook.test.js`.
- OpenAPI validation: `npm run openapi:validate --workspace=backend`.
- Secret hygiene: `npm run security:test:secret-hygiene` and `npm run security:validate:secret-hygiene`.
- Frontend billing configuration assertion: `npm run test:billing-stripe-config --workspace=frontend`.

## Manual QA

1. Confirm exposed or suspect live Stripe secret keys are revoked or rotated in Stripe and in the approved runtime secret manager.
2. Confirm production runtime has rotated live-mode `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, all paid-plan `STRIPE_PRICE_*` IDs, `STRIPE_SECRET_ROTATION_CONFIRMED_AT`, and `STRIPE_SECRET_ROTATION_TICKET`.
3. Restart the backend with `NODE_ENV=production` and confirm startup fails if any Stripe secret, price ID, or rotation evidence variable is missing or placeholder.
4. Run deployment smoke with `SMOKE_STRIPE_WEBHOOK_SECRET` supplied and confirm unsigned webhook rejection plus signed safe-event acceptance.
5. Sign in as a PM, open Billing, start a trial or subscribe using the approved Stripe test workflow for the target environment, and confirm the UI surfaces card/setup errors clearly.
6. Trigger `invoice.paid`, `invoice.payment_failed`, and `customer.subscription.deleted` test events in a safe Stripe listener and confirm subscription/invoice state changes are reflected in Billing.

## Evidence Rules

- Record dates, owner names, external ticket links, workflow URLs, and command output.
- Never record secret values, partial keys, fingerprints, webhook signing secrets, or screenshots that reveal them.
