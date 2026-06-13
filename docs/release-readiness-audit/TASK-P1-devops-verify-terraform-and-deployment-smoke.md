# TASK: Verify Terraform and deployment smoke readiness

## Task ID
TASK-P1-DEVOPS-002

## Priority
P1

## Severity
High

## Area
DevOps / Production

## Related Feature
F-121

## Related Risk
RISK-008

## Problem Summary
Terraform validation could not be verified locally because Terraform is not installed in the audit environment; deployment smoke evidence was not available.

## Evidence
.github/workflows/quality-gates.yml:183-230 configures Terraform 1.7.5 and runs terraform init/validate. docs/release-checklist.md:37-42 requires Terraform, deployment variables, RDS, and smoke evidence. Local terraform -version failed because Terraform was unavailable.

## Why This Blocks or Affects Launch
A construction SaaS cannot be released without proven deploy, rollback, storage, database, and smoke-test readiness.

## Business Impact
A construction SaaS cannot be released without proven deploy, rollback, storage, database, and smoke-test readiness.

## Technical Impact
The gap reduces confidence in the release candidate and must be closed or formally accepted before external customer use expands.

## Required Changes
- [ ] Run CI infrastructure checks on the release commit.
- [ ] Record terraform init/validate output.
- [ ] Run staging deploy rehearsal.
- [ ] Run authenticated deployment smoke.

## Suggested Implementation Approach
Close the gap on a clean release branch, update product/backend/frontend/database/API/permission/test/documentation assets where behavior changes, and record validation evidence in the release package.

## Acceptance Criteria
- [ ] Terraform init and validate pass.
- [ ] Staging deploy succeeds from certified commit.
- [ ] Smoke covers auth, project load, BOQ, and schedule.

## Testing Requirements
Terraform validate; deployment workflow; backend smoke; rollback rehearsal.

## Dependencies
Complete all P0 release blockers first; then verify this item against the certified release candidate.

## Risks
Delaying this item can create onboarding, support, security, or customer trust risk during pilot expansion.

## Estimated Effort
M

## Recommended Owner
DevOps Engineer
