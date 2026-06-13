# TASK: Fix frontend lint release-gate errors

## Task ID
TASK-P0-FE-001

## Priority
P0

## Severity
Critical

## Area
Frontend / Testing

## Related Feature
F-116

## Related Risk
RISK-004

## Problem Summary
Frontend lint fails with blocking errors, so the release candidate does not meet the documented quality gate.

## Evidence
Frontend lint failed with 4 errors and 22 warnings. Errors included duplicate lucide-react import in frontend/src/features/help-center/index.tsx, type-only imports in frontend/src/features/meetings/components/meetings-dashboard.tsx, frontend/src/features/projects/components/project-form-fields.tsx, and frontend/src/features/settings/hooks/use-user-settings.ts. docs/release-checklist.md:14 requires frontend lint and build.

## Why This Blocks or Affects Launch
A red frontend quality gate weakens confidence in UI stability for field and office users.

## Business Impact
A red frontend quality gate weakens confidence in UI stability for field and office users.

## Technical Impact
Lint failures block CI and may mask real type/import issues.

## Required Changes
- [ ] Fix duplicate imports.
- [ ] Convert type-only imports to import type.
- [ ] Review remaining hook and compatibility warnings.
- [ ] Rerun lint, typecheck, and build.

## Suggested Implementation Approach
Coordinate frontend, backend, database, API, permission, test, and documentation changes as applicable. Keep changes scoped, update OpenAPI or help-center docs where behavior changes, and rerun the relevant release gates before signoff.

## Acceptance Criteria
- [ ] npm run lint --workspace=frontend exits 0.
- [ ] Typecheck and build remain passing.
- [ ] No new lint suppressions without justification.

## Testing Requirements
Frontend lint; TypeScript build; production Vite build; browser smoke for touched areas.

## Dependencies
Related P0 release-gate tasks must be completed on the same clean release branch.

## Risks
Fixes may change workflow authorization behavior; run regression tests for PM, consultant, subcontractor, and field personas.

## Estimated Effort
S

## Recommended Owner
Frontend Developer, QA Engineer
