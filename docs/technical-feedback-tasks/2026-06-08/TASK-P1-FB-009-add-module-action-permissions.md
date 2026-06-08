# TASK FB-009: Add Module and Action Permissions

## Priority
P1

## Related Feedback

- Feedback ID: FB-009
- Original feedback summary: Mature permissions from route-level role checks into module/action permission policies.

## Current Project Status

Backend routes use a simple role whitelist middleware. This enforces broad access but not action-specific workflow authority.

## Evidence

- `backend/src/middleware/rbac.js`, lines 3-25: `requireRoles` checks only allowed roles.
- `backend/src/routes/activities.js`, lines 39, 75, 109, 145, 169: repeated route-level role checks.
- `backend/src/routes/cost.js`, lines 48, 68, 97: route-level role checks.
- `backend/src/routes/ipc.js`, lines 26, 53, 78, 93: route-level role checks.
- No central module/action policy matrix was found.

## Gap Analysis

The code cannot distinguish read, create, edit, submit, approve, certify, baseline, export, or close permissions within a module except through hardcoded route role lists.

## Required Changes

- [ ] Define a permission matrix by role, module, action, and workflow transition.
- [ ] Add reusable middleware such as `requirePermission(module, action)`.
- [ ] Replace sensitive hardcoded role lists with policy checks.
- [ ] Use the same policy metadata to hide/disable frontend actions.
- [ ] Add role/action tests for high-risk workflows.

## Suggested Technical Approach

Start with a code-based permission matrix. Keep backend checks authoritative and use frontend filtering only for UX. Gradually replace `requireRoles` route by route.

## Acceptance Criteria

- [ ] Permissions support read, create, update, delete, submit, approve, certify, baseline, and export.
- [ ] Unauthorized users receive consistent 403 errors.
- [ ] Frontend hides/disables actions the user cannot perform.
- [ ] Tests cover all eight roles for schedule, progress, IPC, cost, and user management.
- [ ] QA has a documented role matrix.

## Testing Requirements

Add backend authorization tests, frontend action visibility tests, and manual QA role-matrix walkthrough.

## Risks

Misconfigured permissions can either block legitimate users or expose sensitive actions.

## Dependencies

Needed by FB-004, FB-008, FB-010, FB-012, and FB-020.

## Estimated Effort
L

## Notes

Do not rely on frontend hiding alone for security.
