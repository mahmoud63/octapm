# PMcopilots Help Center

Task: `TASK-P2-DOC-001`

Last updated: 2026-06-12

This help center is the launch documentation set for PMcopilots admins, project users, support teams, implementation teams, API consumers, and UAT reviewers. It complements the technical QA documents in `docs/qa/` and the production release controls in `docs/release-checklist.md`.

## Published Locations

| Audience       | Location                               | Purpose                                                                                            |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Product users  | Authenticated app route `/help-center` | In-app guide hub with role guidance, support paths, onboarding, limitations, and API entry points. |
| API consumers  | `/api/v1/docs` and `/api/docs`         | Swagger UI for the versioned REST API.                                                             |
| API automation | `/api/v1/openapi.json`                 | Machine-readable OpenAPI contract.                                                                 |
| Internal teams | `docs/help-center/`                    | Source-controlled launch docs.                                                                     |

## Guide Index

| Guide                                                                     | Use When                                                                                                                                                        |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Admin Guide](admin-guide.md)                                             | A PM or implementation admin configures the tenant, projects, users, roles, project parties, files, billing, and readiness controls.                            |
| [User Guide By Role](user-guide-by-role.md)                               | A role-based training session needs clear handoffs for PM, Planning Engineer, QS, Cost Controller, Procurement, Warehouse, Site Engineer, and Finance personas. |
| [Support Runbook](support-runbook.md)                                     | Support needs repeatable triage, severity, escalation, incident, and common-issue handling steps.                                                               |
| [API Documentation Guide](api-docs.md)                                    | Backend, mobile, integration, and implementation teams need the published Swagger/OpenAPI contract and validation workflow.                                     |
| [Release Notes And Known Limitations](release-notes-known-limitations.md) | Sales, implementation, QA, and customer stakeholders need the current release summary and launch constraints.                                                   |
| [Onboarding Checklist](onboarding-checklist.md)                           | A new pilot or customer rollout needs a week-by-week training and configuration checklist.                                                                      |

## Product Rules To Keep Visible

- PMcopilots is activity-linked. Transactional project records must trace to an Activity ID wherever the module owns schedule or EV impact.
- Backend permissions are authoritative. Frontend visibility is a convenience layer and does not replace API authorization.
- Non-PM users must be assigned to a project or active project party before they can access project detail and nested modules.
- Official EV and dashboard values use approved workflow data, not drafts.
- Phase 1 does not include BIM/4D, ERP integration, multi-project portfolio rollups, two-way P6 sync, or a separate mobile app UI.

## Owner And Refresh Cadence

| Area                      | Owner                           | Refresh Trigger                                                                                     |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Admin and onboarding docs | Product Manager                 | Project setup, user, role, billing, or customer rollout workflow changes.                           |
| Role user guide           | Product Manager and QA Engineer | Role permission or workflow status changes.                                                         |
| Support runbook           | Support Lead and DevOps         | Incident, deployment, smoke, backup, notification, or escalation process changes.                   |
| API docs                  | Backend Lead                    | Any public route, schema, auth, response envelope, error, rate-limit, upload, or permission change. |
| Known limitations         | Product Manager                 | Before each release candidate and before every customer-facing demo pack.                           |

## Documentation QA

Before a pilot customer uses the product without developer assistance, complete [Documentation Readiness QA](../qa/documentation-readiness.md) and attach the evidence to the go-live readiness gate.
