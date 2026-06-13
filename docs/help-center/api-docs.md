# API Documentation Guide

Task: `TASK-P2-DOC-001`

Audience: backend developers, mobile team, integration partners, QA, support, and implementation teams.

## Published API Docs

| Artifact                         | URL                                 |
| -------------------------------- | ----------------------------------- |
| Swagger UI                       | `/api/v1/docs`                      |
| Legacy Swagger UI alias          | `/api/docs`                         |
| OpenAPI JSON                     | `/api/v1/openapi.json`              |
| Mobile site reporting supplement | `docs/api/mobile-site-reporting.md` |

The API base path is `/api/v1/`. All customer integrations and mobile clients should use the versioned route.

## Validation Command

Run this before publishing a release candidate:

```bash
npm run openapi:validate --workspace=backend
```

The validator checks:

- OpenAPI schema validity.
- Required public paths.
- Operation IDs and response definitions.
- Standard 400/500 error responses.
- Explicit security metadata.
- Bearer auth or refresh-cookie auth declarations.
- Role/permission metadata through `x-permissions`.
- Multipart upload documentation.
- Live Express `/api/v1` route coverage.

## Authentication

- Most endpoints require a short-lived JWT access token in the `Authorization: Bearer <token>` header.
- Refresh uses the `HttpOnly` refresh cookie and should not accept refresh tokens in JSON bodies.
- Logout revokes the active refresh session and clears the cookie.
- Integrations must not store secrets or long-lived credentials in client code.

## Response Envelope

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "PROJECT_ACCESS_DENIED",
    "message": "Authenticated user cannot access this project"
  }
}
```

The runtime error catalog is documented in the OpenAPI `ErrorCode` schema.

## Pagination And Filtering

Large list endpoints should use cursor-based pagination where implemented. Consumers should not assume offset pagination unless the endpoint explicitly documents it. Keep search, filters, sorting, and pagination parameters exactly aligned with the OpenAPI contract.

## Uploads

Documented upload endpoints use `multipart/form-data`. Runtime files must be stored in private storage and served through authenticated download/preview routes or short-lived presigned URLs.

Key upload surfaces include:

- BOQ upload.
- Schedule generation inputs.
- P6 XER import.
- P6 XML import.
- MSP XML import.
- Progress import.
- Workflow evidence uploads.

## Public Endpoint Families

- Auth: register, login, refresh, logout, current user, password reset, invitation acceptance.
- Projects: CRUD, setup readiness, project access, project parties.
- BOQ and allocations: upload, rows, allocation workflows.
- Schedule and activities: imports, AI generation, revisions, CPM, dependencies, baseline, progress.
- Reports and dashboards: EV, project health, workspace dashboard, exports.
- Commercial: change orders, IPC, payments, retention, EOT, cash flow.
- Procurement: suppliers, packages, purchase orders, receipts, long-lead alerts.
- Document control: folders/categories, revisions, review, approval, preview/download.
- Workflow records: RFI, submittals, NCR, safety, risk, daily reports, tasks, notifications, audit/history.
- Admin: users, companies, config, billing.

## API Publishing Checklist

1. Run backend OpenAPI validation.
2. Confirm Swagger UI loads at `/api/v1/docs`.
3. Confirm `/api/v1/openapi.json` returns the expected release commit's contract.
4. Confirm every new route has input validation, response envelope, error codes, auth, and permission metadata.
5. Confirm mobile-facing docs are updated when mobile workflows change.
6. Attach validation output to the release evidence packet.
