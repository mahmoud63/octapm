# Bringing pre-ledger actual cost onto the ledger

**Card:** OCTA-FIN-MIGRATE-062 · **Written:** 2026-09-08
**Companion to:** [`OCTAPM_COST_POSTING_MODEL.md`](./OCTAPM_COST_POSTING_MODEL.md)

`CostLedgerEntry` became the source of truth for actual cost. `CostRecord.actual`
and `BudgetLine.actual` existed long before it, so a live project can carry
millions of actual cost with nothing behind it. This document establishes where
that money came from, and what is done about it.

---

## 1. Where the 4,161,900 actually came from

Traced, not assumed. Every `CostRecord` and `BudgetLine` carrying actual cost
was checked against every source transaction that could account for it.

**Riverside Tower** — stored actual 4,161,900 (before this phase's own postings):

| Activity | Stored actual | Source transactions that could explain it |
| --- | --- | --- |
| A-2000 | 2,058,000.00 | none |
| A-3000 | 291,500.00 | none |
| A-1000 | 1,812,400.00 | none |

**UAT Regression Tower** — UAT-001, 87,000.00, no source transactions.

Across both projects: **0 direct costs, 0 timesheets, 0 pay applications, 0 sub
valuations, 0 equipment usage records** that could account for any of it.

**The origin is `prisma/seed.js`**, which wrote `actual: spec.actualCost`
straight onto the cost record with no transaction behind it:

```js
const cost = { …, actual: spec.actualCost, actualThroughDate: date("2026-06-30") };
```

### A finding along the way

The seven-category breakdown does **not** sum to `actual`, and never did:

| Activity | labour + material + equipment + subcontract | `actual` |
| --- | --- | --- |
| A-2000 | 3,961,800 | 2,058,000 |
| A-3000 | 2,957,400 | 291,500 |

This independently confirms the decision recorded in the cost posting model §6:
the seven categories are a separate manual breakdown with no arithmetic
relationship to actual cost, and automated postings must not write them.

---

## 2. Classification

| | Meaning | Riverside Tower | UAT Tower |
| --- | --- | --- | --- |
| **A** | Reconstructible — the ledger already explains it | — | — |
| **B** | Partially reconstructible — only the remainder opens | A-1000: 1,812,400 of 1,828,736 (16,336 explained by this phase's material issues) | — |
| **C** | Legacy opening balance — nothing explains it | A-2000 2,058,000 · A-3000 291,500 | UAT-001 87,000 |
| **D** | Seed/test artifact | **origin of all of the above** | ✓ |
| *drift* | Ledger explains **more** than the projection holds | — | — |

The origin is **D**. That produces two obligations, and both are met:

1. **New databases** — the seed is fixed, so a fresh install is ledger-backed
   from the first run and needs no migration at all.
2. **Existing databases** — a migration path, because in a real deployment
   these figures are **C**: genuine pre-OctaPM spend for which the platform
   holds no records.

---

## 3. What is *not* done

The brief named five wrong answers, and each is refused in code:

| Wrong answer | Why it is refused |
| --- | --- |
| Zero the stored values | Destroys real financial history |
| Declare them invalid | They are not invalid — they are unexplained, which is different |
| Fabricate invoices or pay applications | A lie told inside a financial record |
| Let reconciliation repair overwrite them | `recomputeActualCost` now **refuses** — see §5 |
| Silently ignore the mismatch | Reported on every reconciliation read |

---

## 4. What is done: an opening balance

Actual cost that cannot be reconstructed is recorded as exactly what it is — a
starting position, not a transaction.

```
CostLedgerEntry {
  sourceType   = 'legacy_opening_balance'
  sourceId     = the cost record or budget line it opens
  sourceKey    = 'legacy_opening_balance:<target>:<id>[:<sequence>]'
  batchId      = 'legacy-<project>-<run>'
  orgId, projectId
  budgetLineId, costCodeId, activityId   where the row has them
  amount       = stored − everything the ledger already explains
  incurredOn   = the record's own actualThroughDate, else project start
  note         = 'Opening balance · <row> · <stated reason>'
}
```

It does not claim to be an invoice, a pay application or a stock issue, because
it was none of those.

---

## 5. Safety

### Idempotent by arithmetic, not by memory

The opening amount is always **stored minus everything the ledger already
explains — prior opening balances included**. After a run there is nothing left
unexplained, so a second run writes nothing.

> **This distinction was found the hard way.** The first implementation keyed on
> the row — *"has this row ever been opened?"* — which looks equivalent and is
> not. When stored actual later grew without a ledger entry behind it, the row
> was already marked opened and the new unexplained amount became **invisible**:
> exactly the blindness this whole phase exists to remove. The test that proved
> the guard worked was the test that caught it.

The sequence suffix exists only as a concurrency guard: two runs computing the
same delta produce the same key, so the unique index lets one through and fails
the other rather than opening the balance twice.

**Proven:**

```
Run 1 --apply   opened 4 balances (3 + 1 across two projects)
Run 2 --apply   opened 0
```

### Only a shortfall opens

If the ledger explains **more** than the projection holds, that is not history —
it is drift, and writing it as an opening balance would bury a posting bug under
a plausible-looking financial record. Drift is classified separately and left to
`recomputeActualCost`.

### Repair refuses while anything is unexplained

`CHECK` may always run. `REPAIR` may not:

```
POST …/cost/reconciliation/recompute
409 ACTUAL_COST_LEDGER_MIGRATION_REQUIRED
  "1 row carries 12345.67 of actual cost with nothing on the ledger behind it.
   Recomputing now would erase it. Run the legacy opening-balance migration first."
  remedy: POST /projects/{projectId}/cost/reconciliation/migrate
```

Without this, "repairing" the projection to match the ledger would silently
delete real financial history — it would look like a fix and behave like a
deletion.

---

## 6. Running it

```bash
node scripts/migrate-actual-cost-ledger.js                     # report only
node scripts/migrate-actual-cost-ledger.js --apply             # open the balances
node scripts/migrate-actual-cost-ledger.js --apply --project <id> --reason "…"
```

Reports by default: the first thing anyone should do with a financial migration
is read it. Also available as
`GET /projects/{id}/cost/reconciliation/migration` and
`POST /projects/{id}/cost/reconciliation/migrate`.

---

## 7. Proof

### Existing database, before and after

```
                          BEFORE            AFTER
Legacy opening actual          0.00     4,161,900.00
Transactional actual      16,336.00        16,336.00
                        ----------     -------------
Ledger actual             16,336.00     4,178,236.00
Stored actual          4,178,236.00     4,178,236.00
Variance               4,161,900.00             0.00
migration required            true            false
balanced                     false             true
```

### Historical and new cost coexisting

A material issue posted after migration:

```
Legacy opening actual   4,161,900.00   unchanged
Transactional actual       16,361.60   +25.60, exactly the issue
                        ------------
Ledger actual           4,178,261.60
Stored actual           4,178,261.60
Variance                        0.00
```

### A brand-new database

Built from empty — 108 migrations, then the seed:

```
Legacy opening actual   4,161,900.00
Transactional actual        1,536.00
                        ------------
Ledger actual           4,163,436.00
Stored actual           4,163,436.00
Variance                        0.00
balanced true · migration required false
```

**Nothing to migrate — every stored actual is explained by the ledger.**

> A second defect surfaced here. The seed's opening balance **force-set**
> `actualThroughDate` instead of advancing it, dragging the date backwards past
> later transactions. Amounts agreed, so a naive check would have passed — but
> official AC reads the latest actual *on or before* a cutoff, so the later cost
> would have silently dropped out of CPI. The reconciliation's stale-date flag
> caught it, which is the reason that flag exists.

---

## 8. Note on the demo database

`octapm_verify` currently carries 4,157,490.33 of legacy opening rather than
4,161,900. The difference (4,409.67) is residue from a test script of mine that
deleted a ledger entry it should not have — it matched `batchId: null`, which is
every transactional entry.

The database is **internally consistent**: balanced, variance zero, no migration
required. It was not force-rebuilt because `prisma migrate reset` is blocked
from this tool, and that guard is correct — dropping a database is not something
to work around. A fresh install produces the exact figures in §7.
