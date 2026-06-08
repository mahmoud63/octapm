# TASK FB-013: Add Procurement Need-Date and Risk Alerts

## Priority
P2

## Related Feedback

- Feedback ID: FB-013
- Original feedback summary: Drive procurement and long-lead planning by activity need date minus lead time, delivery/warehouse status, and schedule risk alerts.

## Current Project Status

Long-lead items and procurement orders exist and can optionally link to activities. Supply-chain health scoring uses overdue procurement orders.

## Evidence

- `backend/prisma/schema.prisma`, lines 420-435: `LongLeadItem` has optional activity, lead weeks, order-by date, status, supplier, criticality, and risk.
- `backend/prisma/schema.prisma`, lines 556-571: `ProcurementOrder` has optional activity, delivery date, status, supplier, cost, and notes.
- `backend/src/services/post-import.service.js`, lines 80-109: post-import creates long-lead suggestions from category/keyword rules.
- `backend/src/routes/health.js`, lines 126-133: supply-chain score uses overdue procurement orders.

## Gap Analysis

Procurement risk is not clearly driven from activity need date, lead time, delivery/warehouse status, and schedule impact. Optional activity links make procurement easy to disconnect from schedule risk.

## Required Changes

- [ ] Calculate need dates from linked activity dates and required material timing.
- [ ] Calculate order-by dates from need date minus lead time and buffer.
- [ ] Validate activity links for schedule-critical procurement items.
- [ ] Add delivery/warehouse status transitions and risk flags.
- [ ] Surface procurement risk on schedule, dashboard, and procurement screens.

## Suggested Technical Approach

Extend long-lead/procurement services with computed need date, order-by date, days-at-risk, and impacted activity. Update health scoring to account for severity, not only overdue count.

## Acceptance Criteria

- [ ] Long-lead items show need date, lead time, order-by date, delivery status, and impacted activity.
- [ ] Late or at-risk delivery triggers schedule risk alerts.
- [ ] Warehouse receipt status can clear or reduce risk.
- [ ] Dashboard reflects procurement risk by activity/project.
- [ ] Tests cover date calculations and thresholds.

## Testing Requirements

Add service unit tests for date/risk calculations, integration tests for status transitions, frontend alert tests, and manual QA with late delivery scenarios.

## Risks

Need-date logic depends on schedule date quality and calendar decisions. Poor thresholds can create alert noise.

## Dependencies

Benefits from FB-005 structured schedule dates and FB-004 approved baseline workflow.

## Estimated Effort
M

## Notes

Existing long-lead models provide a good foundation.
