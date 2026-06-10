# TASK FB-018: Add CI Quality Gates

## Priority
P1

## Related Feedback

- Feedback ID: FB-018
- Original feedback summary: Add CI quality gates for backend tests, frontend lint/build, API docs validation, and deployment readiness.

## Current Project Status

Deployment automation exists, and frontend build runs during deploy. Backend tests and frontend lint scripts exist, but no pre-deploy validation job was found.

## Evidence

- `.github/workflows/deploy.yml`, lines 1 and 13-31: deploy workflow and frontend build.
- `.github/workflows/deploy.yml`, lines 59-108: backend deployment to EC2.
- `backend/package.json`, line 13: backend `test` script.
- `frontend/package.json`, lines 8-9: frontend `build` and `lint` scripts.
- No CI job was found that runs backend tests or frontend lint before deployment.

## Gap Analysis

Deployment can proceed without available backend tests, frontend lint, API docs validation, or smoke checks.

## Required Changes

- [ ] Add PR/push CI workflow for backend tests.
- [ ] Add frontend lint and build checks.
- [ ] Add Prisma validation or migration dry-run where feasible.
- [ ] Add OpenAPI spec validation after FB-017.
- [ ] Make deployment depend on passing validation jobs.

## Suggested Technical Approach

Create a separate GitHub Actions validation workflow and make deploy jobs require it. Use npm workspace commands and add caching only after stable baseline execution.

## Acceptance Criteria

- [ ] Pull requests run backend tests and frontend lint/build.
- [ ] Deploy jobs do not run unless validation passes.
- [ ] CI output identifies failing package/command.
- [ ] OpenAPI validation is included after the spec exists.
- [ ] Release checklist references required checks.

## Testing Requirements

Run workflow on a branch/PR and verify failed checks block deployment.

## Risks

Existing lint/tests may fail and reveal cleanup work. CI runtime may grow if not scoped.

## Dependencies

OpenAPI validation depends on FB-017. Smoke testing connects to FB-020.

## Estimated Effort
M

## Notes

This is high leverage because package scripts already exist.
