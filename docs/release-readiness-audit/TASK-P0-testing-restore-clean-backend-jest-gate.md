# TASK: Restore clean backend Jest release gate

## Task ID
TASK-P0-QA-001

## Priority
P0

## Severity
Critical

## Area
Testing / Backend

## Related Feature
F-116

## Related Risk
RISK-003

## Problem Summary
The backend test suite is failing and therefore cannot support a production release decision.

## Evidence
Backend Jest run reported 75 test suites total, 4 failed, 71 passed; 1066 tests total, 7 failed, 1059 passed. Failing suites: list-pagination.service.test.js, contractual-audit.service.test.js, workflow-maturity.service.test.js, and risk.service.test.js. docs/release-checklist.md:11 requires backend Jest as a quality gate.

## Why This Blocks or Affects Launch
Construction clients cannot be onboarded on a build whose core API regression suite is red.

## Business Impact
Construction clients cannot be onboarded on a build whose core API regression suite is red.

## Technical Impact
Release gate failure blocks CI, deployment readiness, and regression confidence.

## Required Changes
- [ ] Fix all failing backend tests.
- [ ] Separate product-rule changes from broken assertions.
- [ ] Run backend Jest in CI-equivalent environment.
- [ ] Archive results in release evidence without exposing secrets.

## Suggested Implementation Approach
Coordinate frontend, backend, database, API, permission, test, and documentation changes as applicable. Keep changes scoped, update OpenAPI or help-center docs where behavior changes, and rerun the relevant release gates before signoff.

## Acceptance Criteria
- [ ] Backend Jest exits 0.
- [ ] No skipped critical workflow tests unless explicitly justified.
- [ ] Release checklist evidence references passing backend test run.

## Testing Requirements
Full backend Jest; focused reruns for failing suites; API smoke tests after fixes.

## Dependencies
Related P0 release-gate tasks must be completed on the same clean release branch.

## Risks
Fixes may change workflow authorization behavior; run regression tests for PM, consultant, subcontractor, and field personas.

## Estimated Effort
M

## Recommended Owner
QA Engineer, Backend Developer
