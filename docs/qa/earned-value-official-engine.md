# Official Earned Value Engine QA

TASK-P1-backend-rebuild-earned-value-engine hardens the official EV basis used by reports, project health, and workspace health.

## Automated Checks

- `backend/src/services/__tests__/earned-value.service.test.js`
  - PV from approved time-phased cost loading through the reporting cutoff.
  - EV from approved progress approved on or before the cutoff.
  - AC from `CostRecord.actual` only when `actualThroughDate` is on or before the cutoff.
  - Progress `actualCost` is reported only as an estimate and is excluded from official AC/CPI/EAC.
  - Locked reporting-period snapshots preserve the period values.
- `backend/src/routes/__tests__/module-action-permissions.test.js`
  - Cost actual updates remain role-protected.
  - Invalid `actualThroughDate` payloads are rejected before service persistence.
- `frontend/scripts/earned-value-official-ui.test.mjs`
  - Schedule EV tab renders the official EV report, not local prototype SPI/CPI math.
  - Cost Control exposes `Actual Through` for period-based AC.
  - Official EV breakdown displays the AC actual-through date and source.

## Manual QA Scenario

1. Create a project with approved BOQ allocations totaling `100,000`.
2. Create an EV reporting period with cutoff `2026-01-31`.
3. Add and approve cost-loading rows:
   - `40,000` planned by `2026-01-15`.
   - `30,000` planned by `2026-02-15`.
4. Submit and approve progress before cutoff for `50%`; submit another progress update after cutoff for `90%`.
5. Add a cost record with `actual = 30,000` and `actualThroughDate = 2026-01-31`; then update the same activity after cutoff with `actual = 55,000` and `actualThroughDate = 2026-02-15`.
6. Generate the January EV report and verify:
   - `PV = 40,000`.
   - `EV = 50,000`.
   - `AC = 30,000`.
   - `SPI = 1.25`.
   - `CPI = 1.67`.
   - The post-cutoff progress and actual do not change the January open calculation.
7. Lock the January reporting period.
8. Change progress, cost loading, and cost actuals again, then confirm the locked January snapshot does not change.
9. Confirm the schedule EV tab and project health score match the official EV report basis and surface warnings when PV or AC source data is missing.

## Owner Review

- Backend owner: verify Prisma migration/backfill in staging before production.
- Product/Business owner: reconcile the scenario above against the project control workbook and sign off that SPI/CPI/EAC are official enough for pilot reporting.
- QA owner: attach screenshots of Cost Control `Actual Through`, official EV warnings, and locked snapshot behavior to the release evidence.
