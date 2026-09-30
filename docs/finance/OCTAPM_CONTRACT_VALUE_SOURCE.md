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

## 6. Items raised at the closure, and how Round 5 (PC-7a) settled them

The owner decided on 2026-09-29: a BOQ fallback or unresolved provenance is not an established amount. The
actions that depend on the amount wait for it, and no formula, rate or stored amount changes.

- **Retention cap disclosure (was P2): closed.** Certifying an IPC period (by the route or by a workflow's
  final approval) is refused with `409 CONTRACT_VALUE_NOT_ESTABLISHED` while the source is `boq_fallback`
  or unestablished. The refusal is decided on the source alone, before any amount is checked, and writes
  nothing (d987588). The cap-limited totals of a draft or submitted certificate (retention, net payable,
  tax, balance due) are withheld from a non-BOQ reader wherever they appear: IPC reads and write answers,
  the billing statement, the history of the certificate's submission, the workspace queue, the report
  builder's IPC source and the workflow context (109d11e, 2e63e81, 63b7519). A census of the shared
  database found no unconfirmed contract, so no historical record needed repair.
- **Advance by trial (was P3): closed.** Recording an advance receipt meets the same prerequisite before
  its amount is compared with the agreed advance. Both readers get the same refusal, and no record is
  created (d987588). Advance receipts themselves are still not audited; that predates this work.
- **Audit written after the transaction (was P3): closed.** The contract-management event is written
  inside the update's transaction; if it cannot be written, the update rolls back and the API answers
  503 (b24b1e1). The best-effort outbound-event insert runs under its own savepoint, so its failure cannot
  silently roll back a confirmation the API reported as saved. The event is announced only after COMMIT
  (2cdafc3).
- **Differential test (was P3): closed.** `contract-value-differential.live.test.js` builds two contracts
  that differ only in the hidden amount. It proves that a non-BOQ reader receives identical answers and
  identical refusals, and that no record is created (86769ff).
- **Design note:** an `ipc_certificate` workflow rule that routes on `amount` does not match while a capped
  contract's value is unestablished. The amount is left out of the stored context because routing on it
  would disclose it, and certification is refused in that state anyway.
