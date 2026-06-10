# Financial Precision QA - Decimal Money Values

Task: `TASK-P0-database-use-decimal-money-values`

## Release Gate

This is a P0 production blocker. Do not release until the migration has passed dry-run validation, backend regression tests, and owner signoff for database, backend, and QA.

## Migration Runbook

1. Take a full PostgreSQL backup before applying migration `20260610090000_decimal_money_values`.
2. Restore the backup into a staging database and run `npx prisma migrate deploy`.
3. Compare pre/post totals for representative projects:
   - BOQ subtotal, scheduled value, unallocated value.
   - IPC current certificate, retention, cumulative certificate, net payable.
   - EV PV, EV, AC, BAC, EAC, SV, CV, ETC.
   - Change orders, budget revisions, sub valuations, cash flow, invoices.
4. Confirm money columns are `numeric(18,2)` in `information_schema.columns`.
5. Confirm API rejects any user-supplied money value with more than two meaningful decimal places.

## Rollback

Preferred rollback is restoring the pre-migration `pg_dump`. If restore is not required, reverse the altered columns to `DOUBLE PRECISION USING column::double precision`, then re-run financial comparison reports before reopening writes.

## Manual QA Scenarios

- Upload a BOQ with rates `19.99`, `0.01`, and `125.999`; the first two import, the third is rejected.
- Create an IPC item with quantity `3`, rate `333.33`, and retention `5%`; current cert is `999.99`, retention is `50.00`, and net payable is `949.99`.
- Lock an EV reporting period after planned values `0.10` and `0.20`; PV stores and returns `0.30`, not a binary-float artifact.
- Create cumulative budget revisions with `1000.10`, `250.20`, and `0.30`; cumulative approved budget changes by exactly `1250.60`.
- Rebuild cash flow from IPC payment receipts and sub valuations and verify monthly net equals inflow minus outflow to cents.
