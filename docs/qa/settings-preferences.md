# Settings and Preferences QA Guide

## Scope

TASK-P2-UX-001 connects the authenticated settings forms to persisted API state:

- Profile: `GET /api/v1/auth/me/settings`, `PATCH /api/v1/auth/me/profile`
- Account: `PATCH /api/v1/auth/me/account`
- Appearance: `PATCH /api/v1/auth/me/appearance`
- Display: `PATCH /api/v1/auth/me/display`
- Notifications: `GET|PUT /api/v1/notifications/preferences`

User invitation and forgot-password flows are already connected to production auth endpoints through `POST /api/v1/users/invitations` and `POST /api/v1/auth/forgot-password`.

## Manual QA

1. Sign in as a non-admin user and open Settings.
2. Update profile username, bio, and links. Reload and confirm the values remain.
3. Update account name, date of birth, and language. Confirm the user menu name changes immediately and remains after reload.
4. Update appearance theme/font. Confirm the local UI changes on save and the saved values reload into the form.
5. Update display navigation items. Confirm the top navigation hides/shows selected entries while Settings remains reachable.
6. Update notification channel toggles and due-soon window. Reload and confirm values remain.
7. Force an expired or missing token and confirm settings reads/writes return `401`.
8. Send invalid payloads, such as an empty display item list or invalid notification category, and confirm validation errors are shown.

## Regression Checks

- Backend: user settings service and auth route tests.
- Frontend: settings source assertion and notification source assertion.
- Contract: OpenAPI validation should include all `/auth/me/*` settings endpoints and `/notifications/preferences`.
