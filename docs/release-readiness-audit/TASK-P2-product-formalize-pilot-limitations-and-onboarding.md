# TASK: Formalize pilot limitations and onboarding controls

## Task ID
TASK-P2-PROD-001

## Priority
P2

## Severity
Medium

## Area
Product / Commercial Launch

## Related Feature
F-124

## Related Risk
RISK-014

## Problem Summary
The product has broad modules but should not be positioned as a public source-of-truth platform until pilot constraints, onboarding, and support controls are explicit.

## Evidence
docs/release-checklist.md:7 requires go-live readiness gate and cross-functional signoff. The audit found broad module coverage but failed quality gates, unverified staging UAT, and missing deployment evidence.

## Why This Blocks or Affects Launch
Controlled pilots can generate learning, but customers must understand limitations and support boundaries.

## Business Impact
Controlled pilots can generate learning, but customers must understand limitations and support boundaries.

## Technical Impact
The gap reduces confidence in the release candidate and must be closed or formally accepted before external customer use expands.

## Required Changes
- [ ] Define pilot eligibility and data-use limits.
- [ ] Create onboarding checklist for pilot customers.
- [ ] Document known limitations and escalation process.
- [ ] Require release manager approval before external access.

## Suggested Implementation Approach
Close the gap on a clean release branch, update product/backend/frontend/database/API/permission/test/documentation assets where behavior changes, and record validation evidence in the release package.

## Acceptance Criteria
- [ ] Pilot terms and known limitations are approved.
- [ ] Support/onboarding process is documented.
- [ ] No customer is onboarded before P0 tasks are closed.

## Testing Requirements
Document review; pilot dry run; support escalation tabletop.

## Dependencies
Complete all P0 release blockers first; then verify this item against the certified release candidate.

## Risks
Delaying this item can create onboarding, support, security, or customer trust risk during pilot expansion.

## Estimated Effort
S

## Recommended Owner
Product Manager, Support Lead, Business Owner
