# TASK FB-007: Harden Earned Value Basis

## Priority
P1

## Related Feedback

- Feedback ID: FB-007
- Original feedback summary: Improve EV with time-phased PV, cost loading, progress methods, cutoff periods, budget revisions, and actual-cost source rules.

## Current Project Status

EV, PV, AC, SPI, CPI, EAC, S-curves, budget revisions, and cost dashboards exist, but calculations are simplified and sometimes infer actual cost from progress.

## Evidence

- `backend/src/routes/reports.js`, lines 105-178: EV report calculates EV/PV/AC/SPI/CPI/EAC and S-curve.
- `backend/src/routes/health.js`, lines 73-89 and 121-135: health scoring derives cost/schedule metrics from rollups.
- `backend/src/services/activity.service.js`, lines 466-495 and 501-531: actual cost can be derived from percent complete and budget with a 1.03 factor.
- `frontend/src/features/schedule/components/progress-tab.tsx`, lines 46-61 and 160-161: UI reflects the same fallback behavior.
- `backend/prisma/schema.prisma`, lines 305-325 and 480-494: cost records and budget revisions exist.

## Gap Analysis

Official EV needs time-phased PV, approved cost loading, reporting cutoffs, budget revision treatment, progress-method rules, and explicit actual-cost source hierarchy.

## Required Changes

- [ ] Define official EV formulas and cutoff rules with Business/Product.
- [ ] Add reporting period/cutoff model and lockable period snapshots.
- [ ] Calculate PV from approved time-phased cost loading.
- [ ] Calculate EV from approved progress and approved allocations.
- [ ] Define AC source priority and label estimates separately from official actuals.
- [ ] Apply approved budget revisions to EV baselines/snapshots.

## Suggested Technical Approach

Move EV logic into a shared backend EV service. Add period and cost-loading models. Keep prototype dashboard estimates visible only if clearly labeled as estimates until official values are available.

## Acceptance Criteria

- [ ] EV reports are generated for a selected cutoff period.
- [ ] PV comes from approved time-phased baseline/cost loading.
- [ ] EV uses approved progress and allocations.
- [ ] AC source is explicit and not silently inferred for official reports.
- [ ] Tests cover SPI/CPI/EAC across normal, zero-cost, overrun, and budget-revision cases.

## Testing Requirements

Add EV formula unit tests, period snapshot integration tests, frontend dashboard tests, and manual reconciliation against a sample EV workbook.

## Risks

Changing EV formulas will change dashboard values and needs business signoff.

## Dependencies

Depends on FB-001 allocations and FB-008 progress methods. Project cutoff metadata relates to FB-003.

## Estimated Effort
XL

## Notes

Until this is complete, treat EV as prototype guidance rather than official contractual reporting.
