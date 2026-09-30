# OctaPM cost posting model

**Status:** authoritative. Every posting service must conform to this document.
**Branch:** `feat/p0-foundations-sprint1` · **Written:** 2026-09-07

This document was written **after** reading the existing formulas, not before.
Where OctaPM already has a rule, the rule is recorded as it is and the reason it
survives. Nothing here changes a formula that was already correct.

---

## 1. The quantities

### 1.1 Original Budget

```
originalBudget = BudgetLine.originalBudget          (stored)
```

Set when the budget is created or imported. **Never moved by a change order.**

#### 1.1.1 Clarification — when Original Budget stops moving (PC-7a, owner decision 2026-09-29)

This states the certified rule precisely; no formula changes. A budget line's
`originalBudget` is immutable from the **first** of these, **for that line**
(one locked line does not lock its siblings):

1. the line is included in an approved financial/budget baseline — **no such
   record exists in the codebase today** (`BudgetRevision` is a project-level
   ledger from `Project.contractValue` with no budget-line link), so this
   condition is inert until one is built;
2. an approved change stands on the line — any `BudgetLineChange` row: an
   approved change order posted at approval, a revision or a transfer (both
   need `cost.approve` and take effect when written);
3. an **executed** commitment references it — as `commitment.service
   recomputeCommitted` posts committed cost: a commitment in `executed` or
   `closed` whose SOV lines or approved CCO lines name the line (by id, or by
   cost code for an active line of the commitment's cost type), or
   `committedFromCommitments ≠ 0`;
4. the cost ledger posts to it — any `CostLedgerEntry` on the line (openings
   and reversals included), or a non-zero `actual` projection;
5. the line is in the budget snapshot of a **locked** reporting period.

Never a lock: a schedule baseline approval (the schedule baseline and the
financial budget are separate controls), an ad-hoc budget snapshot, or the
snapshot of a period that is still open.

After the lock a changed required amount is a budget revision
(`POST /budget/lines/{lineId}/revisions`) and flows into Revised Budget:
original 100,000 + an approved revision of +50,000 reads **revised 150,000,
original 100,000** — never original 150,000. The one guard is
`budget.service assertOriginalBudgetWritable`, used by every write path:

| Path | After the lock |
|---|---|
| `PATCH /budget/lines/{lineId}` | 409 `BUDGET_ORIGINAL_LOCKED`, naming the condition(s) and pointing to revisions; nothing written. Sending the stored figure back (|Δ| ≤ 0.005) is an echo and passes. |
| `POST /budget/lines/import` | the existing line's description/status are written, its original is kept, and it is listed in `lockedLines [{ code, costType, existing, proposed, conditions }]`; new lines are created as before |
| `POST /budget/lines` re-activating an archived line | the line **always** keeps its original, locked or not (a re-activation is never an Original Budget edit); `originalBudgetKept` reports a differing payload |

### 1.2 Budget Changes

```
approvedChanges = Σ BudgetLineChange.amount where kind = 'change_order'
revisions       = Σ BudgetLineChange.amount where kind ∈ {revision, transfer_in, transfer_out}
```

An append-only ledger of budget movements. Approved change orders and internal
transfers are kept **separate** so a client-driven increase is never confused
with an internal reallocation.

### 1.3 Revised Budget

```
revised = originalBudget + approvedChanges + revisions
```

Derived on every read (`budget.service.deriveLine`). Cannot drift.

### 1.4 Committed Cost

```
committedFromCommitments = Σ over executed/closed Commitments of
                             ( Σ CommitmentSovLine.amount
                             + Σ approved CommitmentChangeOrder value )
                           grouped to budget line by costCodeId + costType,
                           and to activity by activityId

committed = committedFromCommitments > 0 ? committedFromCommitments : BudgetLine.committed
```

A **full recalculation** (`commitment.recomputeCommitted`), not an increment.
The manual `committed` figure survives only while nothing has been committed
against the line — a deliberate migration affordance.

### 1.5 Actual Cost — **redefined by this phase**

**Before:** a stored number incremented at four call sites, reconstructible from
nothing.

**Now:**

```
actual(scope) = Σ CostLedgerEntry.amount where scope matches
```

`BudgetLine.actual` and `CostRecord.actual` remain as **materialised
projections** of the ledger, kept for query speed. The ledger is the truth; the
projections are a cache that can be rebuilt at any time (Phase 7).

Official earned-value AC keeps its existing rule, unchanged:

```
AC = Σ latest CostRecord.actual by activity where actualThroughDate ≤ cutoffDate
```

#### 1.5.1 Clarification — the date a timed cost is incurred on (PC-7a 3c, owner decision 2026-09-28)

`CostLedgerEntry.incurredOn` — and from it `CostRecord.actualThroughDate` — is a
**calendar date**: the UTC calendar date of the stored value, stored at 00:00
UTC, and compared with a reporting period by that date (PC-4's date-only rule).
The formula above is unchanged; what changed is how a writer arrives at the
date.

- **Date-only records** keep the date typed: a direct cost's `costDate`, a
  timesheet's or equipment report's day, a pay application's `periodEnd`, a
  cost record's `actualThroughDate`, a cost loading's `plannedDate`.
- **Timed records** happen at an instant: a material issue
  (`StockTransaction.occurredAt`) and a subcontractor pay application
  certified without a `periodEnd` (its approval). The writer passes the
  instant as `incurredAt` to `cost-ledger.post`, which dates it on the
  calendar date the instant falls on in the project's reporting zone —
  `Project.timezone`, else `Organisation.defaultTimezone`, else UTC, the same
  resolution the EV cutoff uses (`backend/src/utils/reporting-cutoff.js`) —
  and stores that date. The instant stays on the source record.

The distinction is carried by the writer, never guessed from a stored time of
day. So a material issue at 23:30 local on the cutoff date counts in that
period's AC, exactly as a progress approval at 23:30 counts in its EV, and an
issue at 00:30 local the next day counts in neither. Ledger entries written
before this rule keep their stored value (no history is rewritten); a locked
period's `EvPeriodSnapshot` is never recomputed.

### 1.6 Forecast to Complete / Projected Final Cost

Existing rule, unchanged:

```
forecast = BudgetLine.forecast ?? max(revised, actual, committed)
variance = revised − forecast
```

Newly defined, and the reason Option B below matters:

```
remainingCommitment = committed − certifiedAgainstCommitments
projectedFinalCost  = actual + remainingCommitment + uncommittedForecast
```

### 1.7 Cash Flow

Unchanged. A **full rebuild** from payment rows:

```
inflow  = Σ IpcPayment.amount                     (+ legacy paid IpcCertificate)
outflow = Σ SubPayAppPayment.amount
        + Σ DirectCostPayment.amount
        + Σ legacy SubValuation.netPayable
```

**Cash flow is not cost.** A payment moves cash; it does not create or change
actual cost.

---

## 2. The architectural question: A or B

> When a committed amount becomes actual, should OctaPM (A) reduce remaining
> committed cost while increasing actual cost, or (B) retain the original
> committed value and calculate remaining commitment separately?

### Decision: **B — committed stands at full executed value; remaining commitment is derived.**

```
remainingCommitment = committed − certifiedAgainstCommitments
```

### Why B, on this codebase specifically

1. **`recomputeCommitted` is already a pure recalculation.** It rebuilds
   `committedFromCommitments` from SOV lines and approved change orders alone.
   Option A would require it to also subtract certified-to-date, coupling two
   independent recalculations. The commitment figure would no longer be
   reconstructible from the commitment.

2. **Option A destroys information.** After A you cannot answer *"what is this
   subcontract worth?"* from the committed figure — only *"what is left on
   it"*. The contract value is a fact worth keeping.

3. **Option A breaks the existing forecast rule.** `forecast` defaults to
   `max(revised, actual, committed)`. Under A, `committed` shrinks as work
   proceeds while `actual` grows — the max would flip mid-project and the
   forecast could *fall* as cost is incurred. That is backwards, and it would be
   a silent behaviour change to a formula the brief told me not to touch blindly.

4. **B is the construction-industry convention.** Committed Cost is the executed
   commitment value; Open/Remaining Commitment is a derived column. Every
   mainstream cost-control package does it this way, and QSs read the two
   columns as contract value and unbilled balance.

5. **B prevents the double count that A is often adopted to avoid.** The naive
   `actual + committed` double-counts the certified portion. B's
   `actual + (committed − certified)` is exactly right, and it is explicit.

### Consequence

`BudgetLine.committedFromCommitments` and `CostRecord.committed` are **never
decremented by a pay application.** Certification writes only to the cost
ledger. Relief is expressed by subtraction at read time.

---

## 3. Recognition points

The brief warns not to assume the payment date is the cost date. It is not.

| Event | Recognises cost? | Precedent |
| --- | --- | --- |
| Commitment executed | **No** — committed only | existing |
| Pay app submitted / under review | No | — |
| **Pay app approved (certified)** | **Yes** | matches `direct-cost` and `timesheet`, which both post at approve |
| Pay app paid | No — cash flow only | existing |
| Supplier invoice approved | **Yes** *(unless capitalised — §5)* | existing |
| Supplier invoice paid | No — cash flow only | existing |
| Timesheet approved | Yes | existing |
| Goods receipt posted | **No** — inventory asset (§5) | new rule |
| **Material issued to an activity** | **Yes** | new |

**Recognition is at approval, and on accrual.** OctaPM already posts direct
costs and timesheets at approval; a pay application is the same shape of event —
a certifier accepts a value. Doing it at payment would make actual cost a
function of the client's cash position rather than of work performed.

### Which amount for a pay application

**Gross certified for the period**, not the net payment:

```
posted = SubPayAppLine.thisPeriodAmount + SubPayAppLine.materialsOnSite
```

- **Retention is not a cost reduction.** It is money withheld against a cost
  already incurred; the subcontractor has earned it. Posting net would
  understate actual cost by the retention until release, then create a
  phantom cost spike on release.
- **Back charges, other deductions and tax are header-level settlements**, not
  line costs. They do not change what the work cost. Tax in particular is a
  recoverable/payable item, not project cost.

Posting is **per line**, because `SubPayAppLine.sovLineId → CommitmentSovLine`
carries `costCodeId`, `budgetLineId`, `activityId` and `boqItemId`. The lineage
is already there; it only had to be followed.

---

## 4. Chain: Commitment → certified pay application → payment → actual cost

```
Commitment executed
   └─ recomputeCommitted  →  BudgetLine.committedFromCommitments   [committed]

Pay application approved
   └─ per SubPayAppLine, via sovLineId → CommitmentSovLine:
        CostLedgerEntry {
          sourceType   = 'sub_pay_app'
          sourceId     = payApp.id
          sourceLineId = line.id
          amount       = thisPeriodAmount + materialsOnSite
          costType     = 'subcontract'
          activityId, costCodeId, budgetLineId, commitmentId  ← from the SOV line
          incurredOn   = periodEnd ?? approvedAt
        }
   └─ projections: BudgetLine.actual += , CostRecord.actual += ,
                   CostRecord.actualThroughDate = max(existing, incurredOn)

Pay application paid
   └─ SubPayAppPayment → rebuildCashFlow                          [cash only]

Certification revoked  (approved → draft, or approved → void)
   └─ reversing CostLedgerEntry (negative amount, reversalOfId set)
   └─ SubPayApp.certificationRevision += 1
```

`committed` is untouched throughout. Remaining commitment falls because
`certifiedAgainstCommitments` rises.

### Correcting a certificate

A certificate that was wrong has to be correctable, or the only options left are
leaving false cost on the ledger or deleting financial history. So an approval
can be taken back — to draft to be corrected, or to void to end it — and the
ledger is reversed with negative mirrors.

Two rules make that safe.

**Not once money has moved.** A payment against a certificate cannot be un-made
by changing the certificate. Revocation is refused with
`409 SUB_PAY_APP_ALREADY_PAID`, which names the payments; the correction belongs
on the next application or on a credit, where it stays visible.

**The revision is part of the idempotency key.** Reversal writes mirrors rather
than deleting, so the original `sourceKey`s survive — and a corrected
re-certification under the same keys would be taken for a duplicate and post
*nothing*, leaving the ledger holding the reversal and none of the corrected
cost. `certificationRevision` is appended as `keySuffix`, so each certification
of the same application is its own economic event while staying idempotent
within itself:

```
sub_pay_app:<payAppId>:<lineId>        first certification
reversal:<entryId>                     its reversal
sub_pay_app:<payAppId>:<lineId>:r1     the corrected certification
```

Proven end to end: +100,000, −100,000, +95,000 leaves three entries summing to
95,000, with nothing deleted.

---

## 5. Chain: PO → goods receipt → inventory → material issue → actual cost

### The double-count rule

This is the trap the brief names, and it is real today: `direct-cost.service`
posts **every** approved invoice to actual. If a material issue also posted, any
stocked material would be counted twice.

**Treatment — inventory is an asset, not a project cost:**

| Event | Accounting | Project cost |
| --- | --- | --- |
| Goods receipt into stock | debit Inventory, credit AP accrual | **none** |
| Supplier invoice for **stocked** material | settles the AP accrual | **none — capitalised** |
| Supplier invoice for **direct-to-site** material | debit Project Cost | **yes** |
| Material issued from stock to an activity | credit Inventory, debit Project Cost | **yes** |

A direct-cost line is **capitalised to inventory** (and therefore does *not*
post to project actual cost) when it is traceable to a PO line that received
into stock. Everything else posts as it does today.

This keeps the economic event counted exactly once, at the moment the material
is actually consumed on an activity — which is also the moment it can be
attributed to the right activity, which a purchase invoice cannot do.

### Valuation at issue

**Weighted average**, read from the inventory model at issue time — never the
latest PO price. `InventoryItem.averageCost` is already blended on every
receipt, and `StockTransaction.unitCost` / `.value` already record what each
movement was worth. The financial posting uses the same figures, so the cost
ledger and the stock ledger reconcile line for line.

```
Material issued
   └─ CostLedgerEntry {
        sourceType   = 'material_issue'
        sourceId     = stockTransaction.id
        amount       = |StockTransaction.value|      (weighted average × qty)
        costType     = 'material'
        activityId, costCodeId  ← from the transaction
        budgetLineId            ← resolved from costCode + costType
        incurredOn   = occurredAt
      }
```

Every issue carries: inventory item · warehouse · storage location · quantity ·
unit cost · extended cost · project · activity · cost code · budget line ·
issued by · timestamp.

---

## 6. What automated postings must **not** write

`CostRecord` carries a seven-category breakdown — `labour`, `material`,
`equipment`, `subcontract`, `indirect`, `overhead`, `contingency`.

**Verified by code scan:** nothing derives `actual` from these columns, nothing
asserts they sum to `actual`, and only `cost.service` and `equipment.service`
serialise them for display. They are an independent manual breakdown that
predates the posting services.

**Rule: automated postings write `actual` and never the seven categories.**
Writing both would create two disagreeing answers with no authority between
them. The category dimension for automated cost is carried by
`BudgetLine.costType`, which uses the same eight values and is already how
`direct-cost` and `timesheet` resolve their target line.

This is recorded as a deliberate decision, not an oversight.

---

## 7. Invariants

Every posting service must satisfy all seven:

1. **Idempotent.** One economic event produces at most one ledger entry, enforced
   by a unique `sourceKey`. A retry, double click or repeated callback is a no-op.
2. **Reversible, not deletable.** Undoing a posting writes a negative entry with
   `reversalOfId`. History is never destroyed.
3. **Reconcilable.** `Σ ledger = projection`, checkable at any time (Phase 7).
4. **Scoped.** Every entry carries `orgId` and `projectId`; postings never cross
   a tenant.
5. **Decimal.** All arithmetic through `utils/money` on Prisma `Decimal`.
   `Decimal(18,2)` in the database. No float accumulation.
6. **Transactional.** Ledger entry and projection update commit together, or
   neither does.
7. **Audited.** Every posting and reversal writes an audit event naming the
   source, the amount and the target.

---

## 8. Worked example

| Input | |
| --- | --- |
| Original budget | 1,000,000 |
| Commitment (subcontract) executed | 400,000 |
| Pay app #1 certified | 100,000 gross, 10% retention |
| Supplier invoice, direct-to-site | 20,000 |
| Timesheets approved | 15,000 |
| Material issued from stock | 25,000 @ weighted average |

| Quantity | Calculation | Value |
| --- | --- | --- |
| Revised budget | 1,000,000 + 0 | **1,000,000** |
| Committed | 400,000 (unchanged by certification) | **400,000** |
| **Actual** | 100,000 + 20,000 + 15,000 + 25,000 | **160,000** |
| Certified against commitments | 100,000 | 100,000 |
| Remaining commitment | 400,000 − 100,000 | **300,000** |
| Projected final cost | 160,000 + 300,000 + uncommitted ETC | **460,000** + ETC |
| Cash out this period | 100,000 − 10,000 retention = 90,000 net, when paid | 90,000 |

Note the retention: **actual cost is 100,000** while **cash out is 90,000**. The
10,000 is a withholding against a cost already incurred. This is the single most
common place a construction cost model goes wrong, and it is why §3 posts gross.
