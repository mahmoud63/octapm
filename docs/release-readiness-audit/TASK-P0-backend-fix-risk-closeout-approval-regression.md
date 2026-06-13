# TASK: Fix risk closeout approval regression

## Task ID
TASK-P0-BE-002

## Priority
P0

## Severity
Critical

## Area
Backend / Construction Workflow

## Related Feature
F-091

## Related Risk
RISK-002

## Problem Summary
Risk closeout approval rejects submitted closeouts in the current backend test suite, so schedule risk closure cannot be trusted.

## Evidence
backend/src/services/risk.service.js:861-878 approves only submitted closeouts and throws RISK_NOT_READY_FOR_APPROVAL; backend Jest failed in risk.service.test.js closeout approval cases with Only submitted risk closeouts can be approved.

## Why This Blocks or Affects Launch
Project managers and planners need reliable risk mitigation, closeout approval, and audit evidence before construction teams use the system as a source of truth.

## Business Impact
Project managers and planners need reliable risk mitigation, closeout approval, and audit evidence before construction teams use the system as a source of truth.

## Technical Impact
Workflow state transitions are out of sync with tests or service state, causing failing release gates and unreliable risk reporting.

## Required Changes
- [ ] Reconcile submitted/closed/approved closeout state machine with product rules.
- [ ] Fix service or tests so submit then approve works deterministically.
- [ ] Record approval audit events and notification side effects.
- [ ] Document allowed transitions.

## Suggested Implementation Approach
Coordinate frontend, backend, database, API, permission, test, and documentation changes as applicable. Keep changes scoped, update OpenAPI or help-center docs where behavior changes, and rerun the relevant release gates before signoff.

## Acceptance Criteria
- [ ] Risk submit, approve, reject, and reopen tests pass.
- [ ] Invalid state transitions return structured 409 errors.
- [ ] Approved risk closeouts appear correctly in dashboards and audit history.

## Testing Requirements
Unit tests for state transitions; integration tests for role restrictions; E2E UAT for PM/planning engineer risk closeout.

## Dependencies
Related P0 release-gate tasks must be completed on the same clean release branch.

## Risks
Fixes may change workflow authorization behavior; run regression tests for PM, consultant, subcontractor, and field personas.

## Estimated Effort
M

## Recommended Owner
Backend Developer, QA Engineer, Product Manager
