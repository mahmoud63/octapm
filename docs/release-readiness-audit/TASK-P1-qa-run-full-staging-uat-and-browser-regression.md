# TASK: Run full staging UAT and browser regression

## Task ID
TASK-P1-QA-002

## Priority
P1

## Severity
High

## Area
Testing / QA / UX

## Related Feature
F-118, F-119

## Related Risk
RISK-007

## Problem Summary
The UAT suite definition validates, but full staging browser execution and persona evidence were not verified during this audit.

## Evidence
.github/workflows/quality-gates.yml:149-160 skips live UAT when UAT_BASE_URL or UAT_API_BASE_URL is not configured. The local UAT manifest validation passed, but no live staging evidence was available. docs/release-checklist.md:7 requires go-live readiness evidence and owner signoff.

## Why This Blocks or Affects Launch
Pilot users need proof that real browser workflows work across PM, field, commercial, consultant, and subcontractor personas.

## Business Impact
Pilot users need proof that real browser workflows work across PM, field, commercial, consultant, and subcontractor personas.

## Technical Impact
The gap reduces confidence in the release candidate and must be closed or formally accepted before external customer use expands.

## Required Changes
- [ ] Configure staging UAT URLs and personas.
- [ ] Run full Playwright UAT against staging.
- [ ] Capture evidence for desktop, tablet, and mobile smoke flows.
- [ ] Log defects and rerun after fixes.

## Suggested Implementation Approach
Close the gap on a clean release branch, update product/backend/frontend/database/API/permission/test/documentation assets where behavior changes, and record validation evidence in the release package.

## Acceptance Criteria
- [ ] Full staging UAT exits 0.
- [ ] Evidence includes screenshots/logs for each persona.
- [ ] Permission negative tests pass.

## Testing Requirements
E2E UAT; browser smoke; mobile/tablet responsive checks; manual UAT signoff.

## Dependencies
Complete all P0 release blockers first; then verify this item against the certified release candidate.

## Risks
Delaying this item can create onboarding, support, security, or customer trust risk during pilot expansion.

## Estimated Effort
L

## Recommended Owner
QA Engineer, Product Manager, UX/UI Designer
