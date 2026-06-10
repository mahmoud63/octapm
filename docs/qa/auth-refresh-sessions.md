# Auth Refresh Session QA

`TASK-P0-security-harden-token-storage-and-refresh-sessions` blocks release until this evidence is accepted by Security, Backend, Frontend, and QA.

## Automated Evidence

- Backend focused route test: `backend/src/routes/__tests__/auth-refresh-cookie.test.js`.
- Backend focused service test: `backend/src/services/__tests__/auth-refresh-session.service.test.js`.
- Frontend token-storage assertion: `npm run test:auth-token-storage --workspace=frontend`.
- OpenAPI validation must show `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, and `/auth/me` matching the cookie-backed contract.

## Manual QA

Use a realistic construction smoke organization with PM, Planning Engineer, Site Engineer, QS, Cost Controller, Procurement, Warehouse, and Finance users.

1. Sign in as PM and confirm the response body contains only `tokens.accessToken`, `tokens.tokenType`, and `tokens.expiresIn`; no refresh token appears in JSON.
2. Inspect browser cookies and confirm `pmc_refresh_token` is `HttpOnly`, `SameSite=Lax` in local/dev or `SameSite=None; Secure` in production, and scoped to `/api/v1/auth`.
3. Confirm no `pmc_access_token` or `pmc_refresh_token` value is present in `document.cookie`, local storage, or session storage.
4. Force access-token expiry or delete the in-memory access token, then load Projects, BOQ, Schedule, Progress, Cost, Commercial, Procurement, Quality, and Dashboard pages; each should refresh once through the cookie and continue without misleading sign-out/sign-in loops.
5. Capture the original refresh cookie, perform `/auth/refresh`, then replay the original cookie; the replay must return `401 REFRESH_TOKEN_REUSED` and the replacement session must be revoked.
6. Sign out and confirm `/auth/logout` returns `{ revoked: true }` when a live session exists, clears the cookie, and subsequent `/auth/refresh` returns `401 REFRESH_SESSION_REQUIRED`.
7. Attempt `/auth/refresh` with only a JSON `refreshToken` body and no cookie; the API must reject it with `401 REFRESH_SESSION_REQUIRED`.
8. Deactivate a user and confirm their next refresh attempt is rejected and the session is revoked.

## Acceptance Notes

- The backend is the source of truth for refresh-session validity.
- Frontend controls are UX only; hiding a token in state is not considered revocation.
- Any refresh-token replay evidence is a security incident candidate and must be reviewed before release.
