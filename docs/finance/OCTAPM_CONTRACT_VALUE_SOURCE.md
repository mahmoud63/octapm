# Contract value source and BOQ-restricted commercial data

**Owner decisions:** 2026-09-29 (two-decision security closure). **Applies to:** the client contract
(`PrimeContract`), the billing statement, the audit history, the workspace home, and the change-order and
sub-valuation allocation links. **Status:** implemented and verified on `feat/p0-foundations-sprint1`
(4b7dcd0, 05de681, 0558d43, 32da1aa, d6d3012).

## 1. Where a contract's original value came from

`PrimeContract.originalValueSource` (migration `20261005045000_prime_contract_original_value_source`,
additive, nullable) records the source. The server alone sets it. A client that sends the field is refused
with `VALIDATION_ERROR`.

| Value | Meaning | Set when |
|---|---|---|
| `project_value` | the project's established contract value | the contract is first built and the project has a non-zero contract value |
| `contract_entry` | entered or confirmed through the authorised contract process | a contract manager enters a different original value, or confirms the stored one |
| `boq_fallback` | the automatic BOQ total | the contract is first built and the project has no contract value |
| `unestablished` (or NULL) | a historical row whose source cannot be shown | never written by new code; NULL reads as unestablished |

## 2. Who sees the amount

- An established amount (`project_value`, `contract_entry`) stays visible to IPC and contract readers
  under the existing permissions.
- While the source is `boq_fallback` or unestablished, a member without BOQ read on the project does not
  receive the amount or the figures that restate it. That covers the original, revised and remaining-to-certify
  values and the agreed advance, wherever they appear: the contract read, the billing statement, the
  contract-management audit events and the workspace queue. The server omits them and sends
  `valueWithheld` with the reason; the screens show "—" and the reason, never zero.
- Unrelated commercial information stays visible: certificates, invoices, payments, retention, advances
  received and approved change-order totals.

## 3. Confirmation is an authorised action

- A read, a page visit or a save that does not change the original value never promotes a fallback
  (resending the stored value is a save).
- Entering a different original value needs the existing contract-management authority
  (`ipc` update `contract.manage`). It sets `contract_entry` and is audited with actor and time. A member
  without BOQ access may enter a separately known amount without receiving the BOQ total.
- Confirming the stored fallback as it stands (`confirmOriginalValue: true`) also needs BOQ read on the
  project, because confirming reveals it. It changes no figure, only the source, and is audited
  (`originalValueConfirmation: "confirmed"`). Confirming and entering together is refused.
- The contract module has no lock on the original value, before or after this change; none was added or
  bypassed.

## 4. Existing contracts (backfill of 2026-09-29)

Classified from the creation path, never from an amount matching the project value or the BOQ total.
`ensureContract` is the only code that has created a `PrimeContract` on this branch, and it takes the project
value whenever that value is non-zero.

| Contract | Project | Evidence | Source |
|---|---|---|---|
| RT-2026-014 (29d409d9) | Riverside Tower, original fixture (95c188f3) | The first contract-value audit event, 2 ms after creation, records 9,290,000, not the BOQ total of 7,727,000. None of 346 later events changed the value. | `project_value` |
| P21-20260910093852-C-001 (de2d970d) | certified Phase 21 project (0ce999f2) | The project was last written before the contract, with a non-zero value of 2,000,000. BOQ total is 459,000. None of 15 events changed the value. | `project_value` |
| RT-2026-014-2 (7cf951d6) | Riverside Tower, Phase 22B (cb4f705c) | The project was never written after creation, with a non-zero value of 9,290,000. BOQ total is 7,727,000. The contract was never edited. | `project_value` |
| MBR-2025-014 (3bcf70a9) | Marina Bay Residences (4735659e) | The project was last written before the contract, with a non-zero value of 46,001,550. The bill equals the value by construction, so the amounts prove nothing and were not used. The contract was never edited. | `project_value` |

No row was ambiguous. `backend/scripts/prime-contract-value-source-backfill.js` wrote only this column,
inside one transaction, and checked every other column of every row byte-identical before committing. The
apply's snapshot checksum was `d40dfe23…`. The original, revised and advance amounts are unchanged.

**Actual sequence (recorded as it happened):** the migration was applied FIRST, by an interrupted run,
before any backup existed. The cold copy of the whole local cluster
(`C:\Temp\octapm-pg-backup-20260929-pre-contract-source`, outside Git) was taken AFTERWARDS, while the
database was stopped, and BEFORE the backfill. It is a pre-backfill backup, not a pre-migration backup. The
migration was not replayed to manufacture a missing checkpoint; it is additive (one nullable column) and
reversible by dropping that column. Future migrations follow docs/qa/OCTAPM_MIGRATION_PREFLIGHT.md.

The migration was also proven on a throwaway database. The 133 earlier migrations were applied, contract
rows inserted, then this migration applied. Across 30 columns there were 0 differences, and the database was
dropped. No production migration has been run.

## 5. Change orders and sub-valuations

For a member without BOQ read, each allocation link keeps its own commercial figures but loses the nested BOQ
row, the nested allocation, and the `boqItemId` / `allocationId` aliases, with a withheld marker. This applies
to both lists, every write and transition answer, and the RFI convert-to-change answer. The workflow itself
does not require BOQ read, and a member with both permissions receives the full answer.

## 6. Open items

- **P2, owner decision:** the retention cap is calculated as the revised value times the cap rate. Once a cap
  is set and reached, a member without BOQ read can derive an unconfirmed fallback value from the visible
  retention figures. Closing it would change a calculation or a validation rule, or hide the cap rate, which
  is a commercial term.
- **P3:** accepted or rejected advance receipts can reveal the agreed advance by trial. Advance receipts are
  not audited; that predates this change.
- **P3:** the contract-management audit event is written after the transaction on a best-effort basis; that
  pattern predates this change.
- **P3:** no differential test yet checks that changing the BOQ total changes nothing a non-BOQ reader
  receives.
