# TASK: Connect Settings / Profile / Notification Forms

## Task ID
TASK-P2-UX-001

## Priority
P2

## Severity
Medium

## Area
UX

## Related Feature
TECH-FE-02, TECH-FE-03

## Related Risk
RISK-UX-001

## Problem Summary
Some settings/profile/notification forms are local-only or incomplete, creating a misleading production experience.

## Evidence
- `frontend/src/features/settings/notifications/notifications-form.tsx:53` submits locally.
- User invite and forgot-password forms also use local/simulated submission patterns.

## Why This Blocks or Affects Launch
Enterprise users expect account and notification settings to persist and affect real behavior.

## Business Impact
- Users cannot trust settings.
- Admins may believe changes were saved when they were not.
- Notifications cannot be managed.

## Technical Impact
UI state can diverge from backend state and produce support tickets.

## Required Changes
- [ ] Identify all local-only settings forms.
- [ ] Add backend endpoints where missing.
- [ ] Connect frontend mutations.
- [ ] Show real loading/error/success states.
- [ ] Add tests.

## Suggested Implementation Approach
- Frontend changes: replace `showSubmittedData`/local submit with API calls.
- Backend changes: add preferences/profile endpoints.
- Database changes: preference/profile persistence.
- API changes: document endpoints.
- Permission changes: users can update own settings; admins scoped appropriately.
- Test changes: form persistence tests.
- Documentation changes: settings guide.

## Acceptance Criteria
- [ ] Settings persist after reload.
- [ ] Errors display accurately.
- [ ] Unauthorized updates are denied.

## Testing Requirements
- Unit tests.
- Integration tests.
- E2E tests.
- Permission tests.
- Manual QA checks.
- Regression checks.

## Dependencies
TASK-P1-BE-001 for notification preferences.

## Risks
Some settings may need product decisions before implementation.

## Estimated Effort
M

## Recommended Owner
Frontend Developer, Backend Developer

