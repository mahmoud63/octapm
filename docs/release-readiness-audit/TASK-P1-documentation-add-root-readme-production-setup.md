# TASK: Add root README and production setup guide

## Task ID
TASK-P1-DOC-001

## Priority
P1

## Severity
High

## Area
Documentation / Support

## Related Feature
F-123

## Related Risk
RISK-012

## Problem Summary
The repository lacks a root README, and existing setup documentation is fragmented for a production launch audience.

## Evidence
Root README.md is missing. frontend/README.md exists but is frontend-focused and uses Octa PM naming. docs/help-center/README.md provides user/support docs, while docs/release-checklist.md defines production gates.

## Why This Blocks or Affects Launch
Implementation teams, support staff, auditors, and customers need clear setup, deployment, limits, support, and known-issue documentation.

## Business Impact
Implementation teams, support staff, auditors, and customers need clear setup, deployment, limits, support, and known-issue documentation.

## Technical Impact
The gap reduces confidence in the release candidate and must be closed or formally accepted before external customer use expands.

## Required Changes
- [ ] Create root README with architecture, setup, checks, and support links.
- [ ] Document environment variables without secrets.
- [ ] Add production deployment and rollback pointers.
- [ ] Align branding and terminology.

## Suggested Implementation Approach
Close the gap on a clean release branch, update product/backend/frontend/database/API/permission/test/documentation assets where behavior changes, and record validation evidence in the release package.

## Acceptance Criteria
- [ ] New engineer can bootstrap backend/frontend from README.
- [ ] Production deployment links point to runbooks.
- [ ] Known limitations and support path are visible.

## Testing Requirements
Documentation review; onboarding dry run; support/DevOps signoff.

## Dependencies
Complete all P0 release blockers first; then verify this item against the certified release candidate.

## Risks
Delaying this item can create onboarding, support, security, or customer trust risk during pilot expansion.

## Estimated Effort
M

## Recommended Owner
Product Manager, DevOps Engineer, Technical Writer
