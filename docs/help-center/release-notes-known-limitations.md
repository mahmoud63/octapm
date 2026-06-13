# Release Notes And Known Limitations

Task: `TASK-P2-DOC-001`

Release date: 2026-06-12 documentation refresh.

## Launch Documentation Added

- Admin Guide for tenant, user, project, role, project-party, file, setup readiness, and governance workflows.
- User Guide By Role for PM, Planning Engineer, QS, Cost Controller, Procurement, Warehouse, Site Engineer, Finance, and external project party users.
- Support Runbook with severity, triage, common issues, escalation, incident process, and evidence template.
- API Documentation Guide with Swagger/OpenAPI routes, validation command, auth model, response envelope, uploads, and publishing checklist.
- Onboarding Checklist for pilot/customer rollout.
- Documentation Readiness QA checklist for manual validation and UAT evidence.
- Authenticated Help Center route now points to real launch documentation and API docs instead of a coming-soon placeholder.

## Current Product Readiness Highlights

- Auth supports JWT access tokens, refresh cookies, server-side refresh sessions, password reset, and invitation acceptance.
- Project access is organization-scoped and project-assignment/project-party aware.
- BOQ, schedule, progress, EV, dashboard, commercial, procurement, document-control, QA/safety, risk, task, notification, audit, and export workflows have production-oriented docs and QA references.
- Swagger UI and OpenAPI JSON are published by the backend at `/api/v1/docs` and `/api/v1/openapi.json`.
- Release readiness remains gated by the formal evidence and signoff process.

## Known Limitations

| Limitation                                                                                      | Customer Impact                                                                                                                       | Current Control                                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Official source-of-truth rollout requires go-live gate completion.                              | A production deployment alone does not make PMcopilots the contractual system of record.                                              | Use `docs/qa/go-live-readiness-gate.md` and risk acceptance before lifting pilot restrictions.   |
| No separate mobile app UI in Phase 1.                                                           | Field users use responsive web flows and API-backed mobile team endpoints only.                                                       | Document mobile-facing API contracts and run responsive UAT.                                     |
| BIM/4D, ERP integration, multi-project portfolio, and two-way P6 sync are out of Phase 1 scope. | Customers needing those workflows require roadmap alignment or external process.                                                      | Sales/implementation must disclose scope boundaries before pilot.                                |
| Meeting minutes module remains a P2 product item.                                               | Formal meeting agenda/minutes/actions are not part of the current launch workflow.                                                    | Track meeting actions through Tasks and document external meeting records until module delivery. |
| Global cross-module search remains a P2 product item.                                           | Users search/filter inside modules rather than through one global search API.                                                         | Use module tables, filters, command navigation, and exports.                                     |
| Named operational signoffs are still required.                                                  | Support, security, business, QA, backend, frontend, DevOps, and database owners must approve evidence before source-of-truth rollout. | Keep signoff rows pending until owner review is complete.                                        |
| Workflow docs may drift if release scope changes after this packet.                             | Training can become stale when modules change.                                                                                        | Refresh docs whenever code, schema, API, workflow, or permission changes land.                   |

## Support Messaging

Use plain language with pilot customers:

- "The product is ready for guided pilot/UAT when the customer scope and environment are approved."
- "Official use as the contractual source of truth begins only after the go-live gate is signed."
- "Known out-of-scope items are documented up front: mobile app UI, BIM/4D, ERP integration, portfolio rollups, and two-way P6 sync."
- "API consumers should use the versioned Swagger docs and OpenAPI JSON published by the backend."

## Release Evidence To Attach

- OpenAPI validation output.
- Frontend lint/build output.
- Backend test output.
- UAT run summary and screenshots.
- Documentation Readiness QA results.
- Support runbook signoff.
- Known-limitation acceptance.
- Go-live readiness gate signoff or risk acceptance.
