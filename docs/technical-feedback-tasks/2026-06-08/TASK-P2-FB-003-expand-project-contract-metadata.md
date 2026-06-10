# TASK FB-003: Expand Project Contract Metadata

## Priority
P2

## Related Feedback

- Feedback ID: FB-003
- Original feedback summary: Expand project setup metadata for contract parties, contract type/number, baseline date, revised completion, retention, LD rate, calendar, and cutoff day.

## Current Project Status

Project setup captures core fields such as name, type, location, dates, duration, contract value, LD rate, currency, status, and weather allowance.

## Evidence

- `backend/prisma/schema.prisma`, lines 48-67: current `Project` model fields.
- `backend/src/routes/projects.js`, lines 39-54 and 103-104: create/update validators cover the current limited fields.
- `frontend/src/features/projects/data/schema.ts`, lines 15-24 and 33-48: frontend schema mirrors current fields.
- `frontend/src/features/projects/components/project-create-dialog.tsx`, lines 61-69 and 203: create dialog defaults and contract value field.

## Gap Analysis

The setup model lacks client, consultant, contractor, contract type, contract number, baseline date, revised completion, project-level retention default, project calendar, and reporting cutoff day.

## Required Changes

- [ ] Confirm required/optional fields and allowed values with Product/Business.
- [ ] Add project fields and Prisma migration.
- [ ] Update project create/update validators and services.
- [ ] Update frontend create/edit/details views.
- [ ] Use defaults in IPC, EV period, schedule calendar, and EOT workflows where applicable.

## Suggested Technical Approach

Add nullable fields first for backward compatibility. Group frontend UI into contract parties, commercial defaults, and reporting settings. Tighten required fields later through the guided setup wizard.

## Acceptance Criteria

- [ ] Project APIs accept and validate agreed metadata fields.
- [ ] Project details display the fields.
- [ ] Existing projects continue to load after migration.
- [ ] Retention and cutoff defaults are available to downstream workflows.
- [ ] Tests cover create/update validation and backward-compatible reads.

## Testing Requirements

Add backend route/service tests, migration tests with existing project fixtures, frontend validation tests, and manual QA for create/edit/details.

## Risks

Business terminology can vary by market. Making fields mandatory too early could block demos or existing data.

## Dependencies

Needs product answers in `03-open-questions.md`. Cutoff behavior connects to FB-007.

## Estimated Effort
M

## Notes

LD rate already exists at project level; avoid duplicating it.
