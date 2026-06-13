# Documentation Readiness QA

Task: `TASK-P2-DOC-001`

Use this checklist before a pilot customer or UAT tester follows PMcopilots documentation without developer assistance.

## Scope

Validate:

- Admin Guide.
- User Guide By Role.
- Support Runbook.
- API Documentation Guide.
- Release Notes And Known Limitations.
- Onboarding Checklist.
- In-app Help Center.
- Published Swagger/OpenAPI docs.

## Required Reviewers

| Reviewer        | Required Review                                                  |
| --------------- | ---------------------------------------------------------------- |
| Product Manager | Scope, known limitations, onboarding flow, customer messaging.   |
| QA Engineer     | Docs match UAT and regression workflows.                         |
| Support Lead    | Runbook, severity, escalation, common issues, evidence template. |
| Backend Lead    | API docs, OpenAPI validation, error envelope, auth, permissions. |
| Frontend Lead   | Help Center route, role guide visibility, responsive layout.     |
| Business Owner  | Commercial, IPC, EV, and source-of-truth limitations.            |

## Manual QA Steps

1. Open `/help-center` as an authenticated PM user.
2. Confirm the page is not a coming-soon placeholder.
3. Confirm the page shows admin, user, support, API, release notes/limitations, and onboarding resources.
4. Open `/api/v1/docs` and confirm Swagger UI loads.
5. Open `/api/v1/openapi.json` and confirm JSON is returned.
6. Run `npm run openapi:validate --workspace=backend` and attach output.
7. Ask a PM reviewer to follow the Admin Guide through tenant/project setup.
8. Ask one tester for each role to follow the User Guide By Role for their workflow.
9. Ask support to triage at least three common issues using the Support Runbook:
   - Missing project access.
   - Workflow button missing.
   - BOQ or schedule upload/import failure.
10. Confirm known limitations are visible in onboarding and release notes.
11. Confirm `docs/release-checklist.md` points to these docs.
12. Attach screenshots, command output, and reviewer notes to the go-live readiness gate.

## Acceptance Record

| Check                                                  | Evidence                                          | Reviewer        | Status  |
| ------------------------------------------------------ | ------------------------------------------------- | --------------- | ------- |
| Help Center route renders real content.                | Screenshot or frontend test output.               | Frontend Lead   | Pending |
| Admin guide follows actual setup workflow.             | PM walkthrough notes.                             | Product Manager | Pending |
| Role guide supports all eight roles.                   | Role UAT notes.                                   | QA Engineer     | Pending |
| Support runbook supports common triage.                | Support tabletop notes.                           | Support Lead    | Pending |
| API docs are published and validated.                  | OpenAPI validation output and Swagger screenshot. | Backend Lead    | Pending |
| Known limitations are accepted.                        | Customer/internal acceptance note.                | Product Manager | Pending |
| Onboarding checklist is usable without developer help. | UAT onboarding notes.                             | QA Engineer     | Pending |

## Regression Trigger

Repeat this checklist when any of the following changes:

- Public API route, schema, auth, upload, pagination, error, or permission behavior.
- Role permission matrix.
- Project setup readiness.
- BOQ, schedule, progress, EV, IPC, procurement, document-control, QA/safety, task, notification, or dashboard workflow.
- Known limitation or launch scope.
- Support escalation owner or deployment/incident process.
