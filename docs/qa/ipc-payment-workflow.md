# IPC Payment Workflow QA

Task: `TASK-P1-domain-improve-ipc-payment-workflow`

## Release Gate

Do not release until the migration has been dry-run on a staging clone, IPC totals reconcile to the pre-migration certificate totals, and Backend, Finance/Product, and QA owners sign off.

## Migration Runbook

1. Take a PostgreSQL backup before applying migration `20260610235900_harden_ipc_payment_workflow`.
2. Run `npx prisma migrate deploy` on a staging clone.
3. Reconcile `IpcCertificate.totalCert`, `totalRet`, `netPayable`, `amountPaid`, `retentionReleased`, and `balanceDue` before and after migration.
4. Confirm new `IpcInvoice`, `IpcPayment`, and `IpcRetentionRelease` tables have project-scoped unique references and non-negative/positive money constraints.
5. Confirm old `paid` certificates have `paymentStatus = paid`, `amountPaid = netPayable`, and `balanceDue = 0`.

## Manual QA Scenarios

- QS creates a draft IPC, edits line quantities, and submits. Confirm line edits lock after submission.
- Finance tries to certify a draft IPC by API and receives `IPC_INVALID_CERTIFICATION_STATE`.
- Finance certifies a submitted IPC where an item exceeds approved progress or approved BOQ plus approved variation value. Confirm certification fails with the IPC cap error.
- Finance issues an invoice for a certified IPC. Confirm submitted or draft IPCs cannot be invoiced.
- Finance records a partial payment, then a final payment. Confirm `paymentStatus`, `amountPaid`, `balanceDue`, invoice status, and cash-flow rebuild use receipt amounts to cents.
- Finance attempts to record a payment one cent above `balanceDue`. Confirm the API rejects it with `IPC_PAYMENT_EXCEEDS_PAYABLE_BALANCE`.
- Finance releases held retention in two parts. Confirm `retentionReleased` and `retentionStatus` update, and a release one cent above retained balance is rejected.
- QS and Cost Controller confirm invoice/payment/retention actions are hidden in the UI and direct API calls return `403 FORBIDDEN`.

## Regression Checks

- BOQ active/revised rows and approved `ActivityBoqAllocation` links still drive IPC line creation.
- Approved change-order allocation links increase IPC allowance; pending or rejected variations do not.
- Certified IPC item values still roll up to BOQ certified value summaries and dashboards.
- Export, EV, cost, commercial, and audit-history views continue to load for the affected project.
