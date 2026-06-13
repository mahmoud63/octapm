# TASK: Repair secret hygiene validator and tracked-file baseline

## Task ID
TASK-P0-DEVOPS-001

## Priority
P0

## Severity
Critical

## Area
DevOps / Security

## Related Feature
F-117

## Related Risk
RISK-005

## Problem Summary
The tracked-source secret hygiene validator fails before scanning because a tracked frontend file is missing on disk.

## Evidence
package.json:14-15 defines security:test:secret-hygiene and security:validate:secret-hygiene. infrastructure/scripts/validate-secret-hygiene.mjs:117-123 reads each candidate file. The validation failed with ENOENT for frontend/src/features/tasks/components/tasks-import-dialog.tsx, which git still reports as tracked while Test-Path reports it missing.

## Why This Blocks or Affects Launch
Secret scanning is a mandatory control before exposing the product to clients or auditors.

## Business Impact
Secret scanning is a mandatory control before exposing the product to clients or auditors.

## Technical Impact
A validator that crashes cannot prove source hygiene and may hide leaked secrets.

## Required Changes
- [ ] Restore or intentionally remove the missing tracked task file.
- [ ] Make the validator tolerate deleted tracked files in dirty worktrees with a clear failure message.
- [ ] Rerun secret self-test and repo scan.
- [ ] Record evidence without printing secret values.

## Suggested Implementation Approach
Coordinate frontend, backend, database, API, permission, test, and documentation changes as applicable. Keep changes scoped, update OpenAPI or help-center docs where behavior changes, and rerun the relevant release gates before signoff.

## Acceptance Criteria
- [ ] Secret hygiene commands exit 0 on a clean release branch.
- [ ] Failure output never prints secret values.
- [ ] CI quality gate includes the passing result.

## Testing Requirements
Secret hygiene self-test; full repository secret scan; CI quality gate.

## Dependencies
Related P0 release-gate tasks must be completed on the same clean release branch.

## Risks
Fixes may change workflow authorization behavior; run regression tests for PM, consultant, subcontractor, and field personas.

## Estimated Effort
S

## Recommended Owner
DevOps Engineer, Security Engineer
