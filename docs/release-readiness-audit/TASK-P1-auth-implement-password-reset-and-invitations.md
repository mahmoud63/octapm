# TASK: Implement Password Reset And Real Invitations

## Task ID
TASK-P1-AUTH-001

## Priority
P1

## Severity
High

## Area
Security

## Related Feature
USR-02, USR-04, USR-08

## Related Risk
RISK-AUTH-001

## Problem Summary
Forgot password and user invitation flows are not production-backed.

## Evidence
- `frontend/src/features/auth/forgot-password/components/forgot-password-form.tsx:43` uses `sleep(2000)`.
- Backend auth routes reviewed at `backend/src/routes/auth.js:93-148`; no reset route was found.
- `frontend/src/features/users/components/users-invite-dialog.tsx:56` calls `showSubmittedData`.

## Why This Blocks or Affects Launch
Enterprise SaaS users need secure account recovery and controlled onboarding. Simulated flows cause lockout, support load, and security risk.

## Business Impact
- PMs/admins cannot onboard teams reliably.
- External consultants/subcontractors cannot be invited safely.
- Users cannot recover access without manual intervention.

## Technical Impact
Missing token lifecycle, expiry, audit, email integration, and permission enforcement.

## Required Changes
- [ ] Add password reset token model.
- [ ] Add invitation token model.
- [ ] Add forgot/reset backend endpoints.
- [ ] Add invite accept flow.
- [ ] Send emails through production notification service.
- [ ] Audit invitations and password resets.

## Suggested Implementation Approach
- Frontend changes: connect forgot/reset/invite screens to APIs.
- Backend changes: token generation, hashing, expiry, validation.
- Database changes: reset/invitation tables.
- API changes: OpenAPI documentation for auth flows.
- Permission changes: only authorized admins can invite users.
- Test changes: token expiry, reuse, invalid token, role assignment.
- Documentation changes: admin onboarding and recovery guide.

## Acceptance Criteria
- [ ] Forgot password sends reset email.
- [ ] Reset token expires and cannot be reused.
- [ ] Admin can invite user to org/project/role.
- [ ] Invite acceptance creates or links the user securely.
- [ ] All events are audited.

## Testing Requirements
- Unit tests for token logic.
- Integration tests for auth endpoints.
- E2E reset and invite flows.
- Permission tests for inviter roles.
- Manual QA email checks.
- Regression checks for login/session behavior.

## Dependencies
TASK-P1-BE-001 for email delivery.

## Risks
Incorrect token handling can create account takeover risk.

## Estimated Effort
M

## Recommended Owner
Full-stack Developer, Security Engineer

