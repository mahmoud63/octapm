# Audit Log and Record History QA

## Scope

TASK-P1-database-add-audit-log-and-record-history adds durable record snapshots for centralized audit events and expands audit coverage for contractual BOQ, cost, RFI, and submittal workflows.

## Migration Checklist

1. Take a PostgreSQL backup or managed snapshot before applying migration `20260610210000_add_record_history_snapshots`.
2. Dry-run the migration on a staging clone.
3. Verify every existing `AuditEvent` has one `RecordHistorySnapshot`:
   ```sql
   SELECT COUNT(*) FROM "AuditEvent";
   SELECT COUNT(*) FROM "RecordHistorySnapshot";
   SELECT ae."id"
   FROM "AuditEvent" ae
   LEFT JOIN "RecordHistorySnapshot" rhs ON rhs."auditEventId" = ae."id"
   WHERE rhs."id" IS NULL;
   ```
4. Confirm representative rows have redacted compact snapshots in `snapshotJson` and no secrets in `metadataJson`.
5. Roll back by restoring the pre-migration backup/snapshot if the migration, counts, or smoke checks fail.

## Manual QA Scenarios

Use PM, QS, cost controller, planning engineer, and site engineer role accounts assigned to the same project.

1. Upload a revised BOQ. Confirm `/api/v1/projects/:projectId/audit?entityType=boq_revision` returns an `imported` event and the BOQ page shows BOQ revision history.
2. Add, edit, and delete a manual BOQ row. Confirm `boq_item` audit events include actor, action, amount, old summary, and new summary where applicable.
3. Update a cost record actual, committed, forecast, and Actual Through date. Confirm a `cost_record` `updated` event appears and EV/reporting workflows still refresh.
4. Add a burn-rate entry. Confirm a `burn_rate_entry` `created` event appears in the cost burn-rate tab.
5. Create an RFI, then answer it. Confirm `rfi` `created` and `status_changed` events appear with old/new status and response snapshot.
6. Create a submittal under review. Confirm a `submittal` `created` event appears with actor role and revision/spec metadata.
7. Attempt to read audit history as every project role. Confirm allowed roles can read project-scoped audit events and unassigned users remain blocked by project access controls.

## Regression Checks

- BOQ upload, current-grid edits, baseline-locked comparison uploads, and activity allocation summaries continue to pass.
- Cost control updates continue to enforce two-decimal money precision and actual-through date validation.
- RFI/submittal workflow status history remains intact in addition to central audit events.
- `/api/v1/projects/:projectId/audit` response shape remains `{ success: true, data: { events, nextCursor } }`.
