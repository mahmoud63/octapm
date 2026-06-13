# TASK: Complete production secret and security configuration evidence

## Task ID
TASK-P1-SEC-001

## Priority
P1

## Severity
High

## Area
Security / DevOps

## Related Feature
F-117

## Related Risk
RISK-010

## Problem Summary
Production security validators exist, but final secret rotation/configuration evidence was not available and the secret hygiene gate currently fails.

## Evidence
backend/src/config/security.js:8-13 requires production secrets. backend/src/config/security.js:158-188 validates production JWT, CORS, Stripe, CloudFront, and storage values. docs/release-checklist.md:28 and 41 require rotation/configuration confirmation.

## Why This Blocks or Affects Launch
Enterprise construction customers expect disciplined secret handling, credential rotation, and proof that production values are not hardcoded or leaked.

## Business Impact
Enterprise construction customers expect disciplined secret handling, credential rotation, and proof that production values are not hardcoded or leaked.

## Technical Impact
The gap reduces confidence in the release candidate and must be closed or formally accepted before external customer use expands.

## Required Changes
- [ ] Fix secret hygiene scan first.
- [ ] Confirm required production secrets in approved vaults.
- [ ] Verify CORS, JWT, CloudFront, Stripe, and S3 values.
- [ ] Record signoff without printing secrets.

## Suggested Implementation Approach
Close the gap on a clean release branch, update product/backend/frontend/database/API/permission/test/documentation assets where behavior changes, and record validation evidence in the release package.

## Acceptance Criteria
- [ ] Production security validation passes in staging-like env.
- [ ] Secret rotation ticket/signoff exists.
- [ ] No secret values appear in reports or logs.

## Testing Requirements
Security validator; secret hygiene scan; signed webhook test; CORS negative tests.

## Dependencies
Complete all P0 release blockers first; then verify this item against the certified release candidate.

## Risks
Delaying this item can create onboarding, support, security, or customer trust risk during pilot expansion.

## Estimated Effort
M

## Recommended Owner
Security Engineer, DevOps Engineer
