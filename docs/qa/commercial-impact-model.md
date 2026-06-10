# Commercial Impact Model QA

## Scope

TASK-P1-domain-improve-change-order-and-eot-impact-model hardens change order and EOT impact proof. Commercial approvals now require activity-linked impact rows and supporting workflow documents.

## Automated Evidence

- Prisma schema validation for `backend/prisma/schema.prisma`.
- OpenAPI validation for documented v1 paths.
- Focused backend service tests:
  - `backend/src/services/__tests__/change-order.service.test.js`
  - `backend/src/services/__tests__/eot-traceability.test.js`
- Frontend assertion:
  - `frontend/scripts/commercial-traceability.test.mjs`

## Manual Scenario

1. Upload a workflow evidence PDF under `/api/v1/projects/:projectId/workflow/uploads` and record the returned `documentId`.
2. Create a change order with two affected activities, per-activity schedule days, per-activity cost impact, impact basis text, one approved BOQ allocation, and the uploaded `documentId`.
3. Confirm the change order response includes activity links with `criticalPathImpactDays`, `costImpact`, `cpmSnapshotJson`, `attachmentRefs[].documentId`, and `approvalHistory`.
4. Try to approve a change order with no activity links or no supporting document. Confirm `CHANGE_ORDER_IMPACT_PROOF_REQUIRED`.
5. Create an EOT draft with affected critical-path and non-critical activities, delay windows, impact basis text, and the uploaded `documentId`.
6. Submit the EOT claim. Confirm the response includes recalculated `ldLiability`, activity-level `approvedEotDays`, `ldExposure`, `criticalPathImpactDays`, and approval history.
7. Update the EOT delay days and EOT days granted. Confirm linked activity impact rows are recalculated, not left stale.
8. Sign in as a role outside PM, Planning Engineer, or QS and confirm EOT calculate/create/update requests are rejected.
9. In the frontend Commercial tab, confirm change orders and EOT claims without activity plus document proof show a needs-proof state and do not present a misleading approval/submit action.

## Regression Checks

- Existing pending change orders remain listable after migration.
- Existing EOT claims with legacy `affectedActivities` JSON are backfilled into structured activity links.
- IPC, sub valuation, weather delay, audit history, and workflow upload/download paths continue to load.
- Dashboard commercial health still counts pending change orders.
