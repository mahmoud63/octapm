# Approval Workflow Ledger QA

## Scope

TASK-P1-domain-implement-approval-workflows adds a normalized approval workflow event ledger for contractual records that previously relied on simple status fields.

Covered records:

- BOQ revisions and activity BOQ allocations
- Schedule revisions
- RFI and submittals
- Change orders, IPC certificates, EOT claims, and activity cost loading
- NCR and safety incident closure workflows

## Automated Checks

- Backend service tests cover approval workflow state-machine persistence, invalid direct approval, and rejection reason requirements.
- Existing schedule, BOQ allocation, IPC, commercial, RFI, submittal, NCR, safety, EV, and OpenAPI tests should continue to pass.
- Prisma validation must pass for `ApprovalWorkflowEvent` and migration `20260610234000_add_approval_workflow_events`.

## Manual Scenarios

1. BOQ allocation: create draft, submit, approve, verify approved allocation contributes to schedule/EV/IPC and approval history shows submitter and approver.
2. Negative BOQ allocation: try approving a draft allocation directly; expect `APPROVAL_WORKFLOW_INVALID_TRANSITION`.
3. Schedule revision: submit for review, approve, baseline, then create a newer revision and verify supersede events are recorded.
4. RFI: answer then close; verify the detail panel shows status history and approval decisions.
5. Submittal: submit under review, reject/resubmit with a reason, approve after resubmission; verify empty rejection reason is blocked.
6. Change order: approve and reject pending VOs; verify actor, role, reason/comment, activity links, and allocation links are preserved.
7. IPC: submit draft IPC, certify submitted IPC, verify approval history and EV/payment reports still reconcile.
8. EOT: create draft, submit, approve/reject from submitted; verify direct draft-to-approved is rejected.
9. NCR and safety: close open records and verify closure decision history appears with actor role.
10. Cost loading: create draft, submit, approve/reject submitted rows; verify approved-only PV behavior remains unchanged.

## Migration QA

- Back up production before applying the migration.
- Dry-run on a staging clone and compare:
  - `AuditEvent` affected record counts.
  - `WorkflowStatusHistory` affected record counts.
  - `ApprovalWorkflowEvent` backfill counts.
- Spot-check older RFI, submittal, change order, IPC, EOT, schedule, NCR, and safety records for timeline continuity.

## Regression Areas

- Project membership scoping for all nested project routes.
- Role/action permissions for submit, approve, certify, baseline, and update actions.
- BOQ allocation capacity checks.
- Official EV PV/EV/AC calculations and locked period snapshots.
- IPC approved-progress cap and retention calculations.
