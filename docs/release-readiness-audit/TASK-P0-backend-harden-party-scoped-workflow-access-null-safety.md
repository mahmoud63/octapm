# TASK: Harden party-scoped workflow access null safety

## Task ID
TASK-P0-BE-001

## Priority
P0

## Severity
Critical

## Area
Backend / Security / Permissions

## Related Feature
F-039, F-052

## Related Risk
RISK-001

## Problem Summary
RFI and submittal party-scoped workflow paths can throw a runtime TypeError when projectAccess is null, blocking critical consultant/subcontractor workflows.

## Evidence
backend/src/services/company-party.service.js:665-711 assumes projectAccess has scope; backend/src/services/rfi.service.js:375 and 596 call assertPartyWorkflowAccess; backend/src/services/submittal.service.js:406, 620, 744, and 792 call the same helper. Backend Jest failed with TypeError: Cannot read properties of null (reading scope).

## Why This Blocks or Affects Launch
RFIs and submittals are high-volume contractual workflows. Failures here prevent project managers, consultants, document controllers, and subcontractors from safely routing, answering, approving, or rejecting formal records.

## Business Impact
RFIs and submittals are high-volume contractual workflows. Failures here prevent project managers, consultants, document controllers, and subcontractors from safely routing, answering, approving, or rejecting formal records.

## Technical Impact
Unhandled null access creates 500 responses, broken audit trails, and possible inconsistent workflow state.

## Required Changes
- [ ] Normalize projectAccess to an empty object before all party-scope checks.
- [ ] Add explicit tests for null, undefined, full-project, and party-scoped access.
- [ ] Verify RFI and submittal list, update, answer/review, approve, reject, and close paths.
- [ ] Return structured 403/404 errors instead of runtime exceptions.

## Suggested Implementation Approach
Coordinate frontend, backend, database, API, permission, test, and documentation changes as applicable. Keep changes scoped, update OpenAPI or help-center docs where behavior changes, and rerun the relevant release gates before signoff.

## Acceptance Criteria
- [ ] RFI and submittal tests pass for party users and PM users.
- [ ] No party-scoped workflow test throws TypeError.
- [ ] Unauthorized party users cannot see or mutate unrelated party records.

## Testing Requirements
Unit tests for helper behavior; integration tests for RFI/submittal party workflows; permission negative tests; manual QA using consultant and subcontractor personas.

## Dependencies
Related P0 release-gate tasks must be completed on the same clean release branch.

## Risks
Fixes may change workflow authorization behavior; run regression tests for PM, consultant, subcontractor, and field personas.

## Estimated Effort
M

## Recommended Owner
Backend Developer, Security Engineer, QA Engineer
