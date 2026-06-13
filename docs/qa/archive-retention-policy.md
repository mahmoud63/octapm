# Archive / Retention Policy

## Scope

Normal UI and API delete actions must not physically remove contractual project history. The following records are archived instead:

- Projects
- RFIs
- Submittals
- Change orders that are not approved and budget-synced
- Risks
- Safety incidents

## Policy

- Archive writes `status = archived`, `archivedAt`, and `archivedBy`.
- Archive emits central audit history. Workflow-owned records also emit workflow status history and approval workflow events.
- Active list and dashboard queries exclude archived records by default with `archivedAt = null`.
- List APIs can include retained records with `includeArchived=true`; RFI, submittal, change order, risk, and safety lists can also filter `status=archived`.
- Activity links, evidence links, attachments, approval history, and audit snapshots remain intact.
- Approved change orders remain locked because approved budget revision sync is contractual accounting state.

## Purge

Permanent purge is not available in Phase 1a. It requires an approved legal/product retention policy, separate admin-only permissions, and dedicated purge audit evidence before implementation.

## Manual QA

1. Archive each in-scope record from the UI/API and confirm the response returns `archived: true` and `deleted: false`.
2. Confirm active lists and workspace dashboards no longer show the archived record.
3. Request the list with `includeArchived=true` or `status=archived` and confirm the record is still available.
4. Open the audit/history panel and confirm an `archived` event with actor and prior status.
5. Confirm linked evidence, activity links, workflow history, and approval history remain visible.
