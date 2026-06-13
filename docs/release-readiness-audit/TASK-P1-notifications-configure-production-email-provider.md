# TASK: Configure production notification and email delivery

## Task ID
TASK-P1-NOTIF-001

## Priority
P1

## Severity
High

## Area
Backend / Notifications / DevOps

## Related Feature
F-103

## Related Risk
RISK-009

## Problem Summary
Notification APIs exist, but production email delivery could not be verified and local fallback logs email bodies.

## Evidence
backend/src/services/email.service.js:65-66 logs local/test email output. backend/src/services/notification.service.js contains notification orchestration. docs/release-checklist.md requires production secret/configuration and smoke evidence.

## Why This Blocks or Affects Launch
RFIs, submittals, approvals, overdue tasks, and payment workflows depend on reliable notifications for real project adoption.

## Business Impact
RFIs, submittals, approvals, overdue tasks, and payment workflows depend on reliable notifications for real project adoption.

## Technical Impact
The gap reduces confidence in the release candidate and must be closed or formally accepted before external customer use expands.

## Required Changes
- [ ] Select and configure production email provider.
- [ ] Store provider credentials in secret manager only.
- [ ] Add delivery status/error handling.
- [ ] Run assignment, overdue, approval, and password reset notification tests.

## Suggested Implementation Approach
Close the gap on a clean release branch, update product/backend/frontend/database/API/permission/test/documentation assets where behavior changes, and record validation evidence in the release package.

## Acceptance Criteria
- [ ] Production/staging notification smoke passes.
- [ ] Local fallback is disabled in production.
- [ ] Failures are logged without exposing sensitive content.

## Testing Requirements
Unit tests; provider integration test; E2E notification smoke; manual inbox verification.

## Dependencies
Complete all P0 release blockers first; then verify this item against the certified release candidate.

## Risks
Delaying this item can create onboarding, support, security, or customer trust risk during pilot expansion.

## Estimated Effort
M

## Recommended Owner
Backend Developer, DevOps Engineer, QA Engineer
