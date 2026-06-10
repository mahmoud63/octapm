# Procurement And Material Tracking QA

## Scope
- Suppliers, procurement packages, PO lines, delivery receipts, activity material usage, and lead-time alerts.
- Activity material panel in the activity detail drawer.
- Project assignment and procurement module permissions.

## Manual Scenarios
1. Create an approved supplier as PM or Procurement.
2. Create a procurement package linked to a critical activity and the supplier.
3. Create a purchase order with at least one PO line linked to an active schedule activity.
4. Confirm a PO line without `activityId` is rejected with `PROCUREMENT_ACTIVITY_REQUIRED`.
5. Post a partial delivery receipt as Warehouse and issue part of the accepted quantity to the activity.
6. Confirm receipt quantity cannot exceed the ordered balance.
7. Record activity material usage as Site Engineer and confirm consumed/available quantities update.
8. Confirm usage above issued quantity is rejected with `MATERIAL_USAGE_EXCEEDS_ISSUED_QTY`.
9. Set a promised delivery date after the activity need date and confirm a lead-time alert opens.
10. Acknowledge and resolve the alert as PM/Planning/Procurement/Warehouse.
11. Confirm Finance can read procurement data but cannot issue POs, post receipts, or record usage.
12. Confirm unassigned non-PM users cannot access another project’s procurement routes.

## Regression Checks
- Schedule activity detail still opens and displays materials.
- Long-lead register still displays need-date risk alerts.
- Project health supply-chain score reflects at-risk PO lines.
- BOQ, progress, cost, IPC, and daily reporting smoke flows continue to pass.
