# TASK: Fix IPC Approved Variation Certification Regression

## Task ID
TASK-P0-FIN-001

## Priority
P0

## Severity
Critical

## Area
Backend

## Related Feature
PAY-01, CO-03, CST-02

## Related Risk
RISK-FIN-001

## Problem Summary
The backend test suite fails on an IPC allocation case involving approved variation allowance. This is a financial certification blocker.

## Evidence
- `backend/src/services/__tests__/ipc-allocation-impact.test.js:665` failed.
- Failing test: includes approved variation allowance when enforcing IPC item limits.
- Related IPC service logic inspected around `backend/src/services/ipc.service.js:136` and `backend/src/services/ipc.service.js:1010`.

## Why This Blocks or Affects Launch
Incorrect IPC/progress claim calculations can cause overpayment, underpayment, disputes, or invalid commercial records.

## Business Impact
- Project managers: cannot rely on earned/payment status.
- Contractors: payment certification may be wrong.
- Consultants: review/approval may be contractually unsafe.
- Owners: overpayment exposure.
- Site engineers: progress evidence may not reconcile.
- Document controllers: supporting records may conflict.
- Finance/commercial teams: direct payment and audit risk.
- Subcontractors: payment disputes.

## Technical Impact
Commercial calculations are not regression-clean. Related dashboards, exports, and financial APIs may show incorrect values.

## Required Changes
- [ ] Reproduce the failing test.
- [ ] Confirm expected variation allocation behavior with product/commercial owner.
- [ ] Fix IPC service logic.
- [ ] Add regression cases for approved, pending, rejected, and partially allocated variations.
- [ ] Re-run backend tests.

## Suggested Implementation Approach
- Frontend changes: verify IPC UI displays corrected limits.
- Backend changes: update IPC allocation and cap enforcement logic.
- Database changes: verify change order allocation links support the calculation.
- API changes: document response fields if calculation output changes.
- Permission changes: verify Finance/PM-only certification actions.
- Test changes: expand IPC/change-order regression matrix.
- Documentation changes: document IPC/retention/variation calculation rules.

## Acceptance Criteria
- [ ] Failing test passes.
- [ ] IPC approved variation allowance behavior is validated by commercial SME.
- [ ] Full backend test suite passes.
- [ ] Finance UAT signs off.

## Testing Requirements
- Unit tests for calculation helpers.
- Integration tests for IPC certification.
- E2E tests for change order to IPC flow.
- Permission tests for finance approvals.
- Manual QA checks against sample contract.
- Regression checks for EV/cost dashboards.

## Dependencies
Commercial/product decision on intended calculation.

## Risks
Fixing this may change historical IPC values in seeded/test data.

## Estimated Effort
M

## Recommended Owner
Backend Developer, Product Manager, QA Engineer

