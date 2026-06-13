# Subscription Gate QA

## Release Gate

TASK-P0-security-fix-subscription-gate-order is a production blocker. Do not promote a release until backend regression tests pass and Security/Backend owner signoff is recorded.

## Manual Scenarios

1. Authenticate as a PM in an organization whose trial/subscription has ended.
2. Confirm `GET /api/v1/projects` and billing reads still return the standard success envelope.
3. Attempt to create, update, and archive a project. Each request must return `402 SUBSCRIPTION_REQUIRED` and must not persist changes.
4. Attempt to create, update, activate/deactivate, and reset a user. Each request must return `402 SUBSCRIPTION_REQUIRED` and must not persist changes.
5. Confirm the frontend top billing banner is visible whenever `subscription.hasAccess === false` and points users to Billing.
6. Confirm project create/edit/archive and user create/edit/delete/activate/deactivate/reset controls are disabled or hidden while `subscription.hasAccess === false`.
7. Confirm project/user mutation failures show the backend subscription-required message instead of a generic failed-action message.
8. Repeat project and user writes with an active paid organization and confirm normal RBAC, validation, org scoping, and persistence behavior still pass.

## Regression Evidence

- Backend focused Jest: `src/routes/__tests__/subscription-gate-order.test.js`
- Frontend assertion script: `frontend/scripts/subscription-gate-ui.test.mjs`
- OpenAPI contract includes `402` in the common error envelope responses.
