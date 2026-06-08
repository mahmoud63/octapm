# TASK FB-017: Add OpenAPI Documentation

## Priority
P2

## Related Feedback

- Feedback ID: FB-017
- Original feedback summary: Add OpenAPI/Swagger documentation for the shared API consumed by web and mobile clients.

## Current Project Status

The backend exposes REST routes, but no OpenAPI spec, generator, Swagger route, or validation workflow was found.

## Evidence

- `AGENTS.md`, lines 41, 76, 80: project instructions require OpenAPI/Swagger documentation for the mobile team.
- Repository search found `swagger`/`openapi` references only in documentation.
- `backend/package.json`, lines 18-39: backend dependencies do not include Swagger/OpenAPI tooling.

## Gap Analysis

The mobile team and QA lack a formal API contract. This increases integration and regression risk.

## Required Changes

- [ ] Choose OpenAPI approach: route annotations, schema-driven generation, or maintained spec.
- [ ] Add Swagger/OpenAPI dependencies and docs endpoint.
- [ ] Document auth, response envelope, pagination, error codes, and permissions.
- [ ] Document core module endpoints and upload endpoints.
- [ ] Add CI validation for the spec.

## Suggested Technical Approach

Prefer schema-driven docs where possible to reduce drift. Start with auth, projects, BOQ, schedule, activities/progress, reports, commercial, procurement, quality, and document control.

## Acceptance Criteria

- [ ] OpenAPI spec is accessible locally and in intended deployed environments.
- [ ] Auth and response envelope formats are documented.
- [ ] Core endpoints include params, request body, responses, errors, and permissions.
- [ ] Spec validation runs in CI.
- [ ] Mobile/API consumers can review or generate client contracts from the spec.

## Testing Requirements

Add OpenAPI validator test, route smoke tests against documented endpoints, and consumer review with mobile/API team.

## Risks

Docs can drift if schemas and routes are maintained separately.

## Dependencies

Pairs with FB-018 CI gates and supports FB-011 mobile workflow.

## Estimated Effort
L

## Notes

This is required by project instructions even though the feedback file emphasized product maturity.
