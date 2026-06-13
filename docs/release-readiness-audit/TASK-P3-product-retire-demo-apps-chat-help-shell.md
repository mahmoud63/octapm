# TASK: Retire Or Relabel Demo Apps / Chat / Help Shell

## Task ID
TASK-P3-PROD-001

## Priority
P3

## Severity
Low

## Area
Product

## Related Feature
TECH-FE-01

## Related Risk
RISK-DEMO-001

## Problem Summary
Demo/static app, chat, and help areas may confuse production users if exposed without clear labeling or real functionality.

## Evidence
- `frontend/src/features/apps/data/apps.tsx:19` contains static app data.
- `frontend/src/routes/_authenticated/help-center/index.tsx:5` renders ComingSoon.
- `frontend/src/features/chats/components/new-chat.tsx:118` uses local submission behavior.

## Why This Blocks or Affects Launch
This is not a P0 blocker, but demo surfaces reduce trust and create support questions.

## Business Impact
- Users may expect integrations or chat support that are not available.
- Implementation teams may need to explain unfinished areas.

## Technical Impact
Unused/demo routes increase maintenance and QA scope.

## Required Changes
- [ ] Decide whether each demo route stays in production.
- [ ] Hide incomplete routes behind feature flags.
- [ ] Relabel beta/demo functionality clearly.
- [ ] Connect any retained workflows to real APIs.

## Suggested Implementation Approach
- Frontend changes: feature flags/nav cleanup.
- Backend changes: none unless connecting real chat/apps.
- Database changes: none.
- API changes: none.
- Permission changes: hide disabled routes from nav.
- Test changes: nav/feature flag smoke tests.
- Documentation changes: known limitations if retained.

## Acceptance Criteria
- [ ] Production nav does not imply unavailable functionality.
- [ ] Incomplete areas are hidden or clearly marked.
- [ ] Help routes point to real support docs.

## Testing Requirements
- Manual nav QA.
- E2E route access checks.
- Regression checks for sidebar/command menu.

## Dependencies
Product launch scope decision.

## Risks
Removing routes can affect navigation tests.

## Estimated Effort
S

## Recommended Owner
Product Manager, Frontend Developer

