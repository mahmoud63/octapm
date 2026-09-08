# Financial integrity checkpoint

**Written:** 2026-09-07 · **Branch:** `feat/p0-foundations-sprint1`
**Commits:** `4a9b581` (A–E) · `826c513` (F–L) · `a96a240` (M–N)

The checkpoint asked twelve questions before Phase 10. Here are the answers,
with what backs each one.

---

## 1. Is Actual Cost now trustworthy?

**For anything posted through the ledger, yes. For the projections, yes as long
as reconciliation is run — and it will refuse to lie to you if it is not.**

`CostLedgerEntry` is the source of truth. `BudgetLine.actual` and
`CostRecord.actual` are projections of it, maintained incrementally because that
keeps every existing read fast. Incremental maintenance can drift, so nothing
trusts them blindly: `GET …/cost/reconciliation` recomputes from the ledger and
reports the difference, in either direction.

Five sources post: direct costs, timesheets, equipment, certified pay
applications, material issues. A sixth, `legacy_opening_balance`, records
pre-ledger actual cost honestly rather than pretending it was a transaction, and
is reported separately from transacted cost everywhere.

What that does **not** cover: a figure hand-edited in the database, or a posting
path added later that forgets the ledger. Reconciliation catches both after the
fact; nothing prevents them.

## 2. What was the 4,161,900?

A seed artifact. Traced, not assumed: across both projects there were **0 direct
costs, 0 timesheets, 0 pay applications, 0 sub valuations and 0 equipment usage
records** that could account for any of it. `prisma/seed.js` wrote
`actual: spec.actualCost` straight onto the cost record.

The seed no longer does that — it posts an opening balance — so a database built
from empty is balanced from the first run with nothing to migrate. Existing
databases get `scripts/migrate-actual-cost-ledger.js`, which opens only what no
source transaction explains, as a `legacy_opening_balance` entry that says what
it is. Full account: [`OCTAPM_ACTUAL_COST_MIGRATION.md`](./OCTAPM_ACTUAL_COST_MIGRATION.md).

## 3. Does a certified pay application reach Actual Cost?

**Yes, proven through the screens.** 100,000 gross certified against a 500,000
subcontract posted 80,000 and 20,000 on their own schedule-of-values lines,
coded to the activity, cost code and budget line those lines carry. Committed
stayed at 500,000; remaining commitment is derived as committed − certified.

Gross, not net: retention is money withheld against work already earned, and
posting net would understate actual cost until release and then spike it.

## 4. Does paying it post cost again?

**No.** The 90,000 payment moved cash flow and left the ledger untouched. Cash
and cost are separate recognition points, and the payment path never calls the
ledger.

## 5. Can the same certificate post twice?

**No.** Three concurrent approvals plus a late retry produced exactly one ledger
entry of 50,000. The state machine refuses whatever arrives after a commit; the
unique `sourceKey` catches the ones racing inside the window. Two callers can
both be told "approved" — only one posting exists, which is the outcome that
matters.

## 6. Can a wrong certificate be corrected?

**Yes — this did not work before and now does.** The reversal was wired to the
`void` transition, but `void` was reachable only from `draft` and `rejected`,
neither of which ever posts. The path was unreachable by construction.

Now: revoke to draft (correct and re-certify) or to void (end it), with a stated
reason, refused once anything has been paid. +100,000, −100,000, +95,000 leaves
three ledger entries summing to 95,000 with nothing deleted.

## 7. Can a subcontractor be over-billed?

**No, and the ceiling on screen is now the ceiling enforced.** A claim past a
line's schedule-of-values amount is refused; an approved change order naming
that line raises it, and one more currency unit past the revised figure is
refused again.

Two defects were in the way: the change order's `sovLineId` was dropped by the
writer, so an approved change raised the contract value while the billable
ceiling stayed put; and the ceiling shown on a read came from a stored copy that
went stale between approval and the next save. Both fixed and driven.

## 8. Can the certified figure be traced back to a subcontractor?

**Yes, with no free text in the chain.** Ledger entry → pay-app line →
schedule-of-values line → commitment → company. Every step is a foreign key.

The one place free text remained is legacy sub-valuations, addressed in 11.

## 9. Do inventory issues reach Actual Cost without double-counting?

**Yes.** A material issue posts at weighted-average cost when it is consumed. A
supplier invoice for stock that was capitalised into inventory does **not** post
again — the capitalisation rule keys on whether the PO line carries an inventory
item. This was proven when adding material issues created a live double-count
that the rule then closed.

## 10. What is left that cannot be trusted?

Stated plainly:

- **Legacy opening balances are not evidence.** They are honest about being an
  opening position, but nothing stands behind them. Reports must keep showing
  them separately from transacted cost — they do today.
- **The seven-category cost breakdown does not sum to actual cost** and never
  did (A-2000: 3,961,800 against 2,058,000). It is a separate manual breakdown;
  automated postings deliberately do not write it.
- **Reconciliation is manual.** Deliberately: a silent nightly rewrite of
  financial figures hides drift instead of surfacing it. But it means drift can
  sit unnoticed until someone looks.
- **Forecast and EAC** have not been driven end to end at this level of rigour.
- **The demo database** `octapm_verify` carries 4,157,490.33 of legacy opening
  rather than 4,161,900 — residue from a buggy script of mine. It is internally
  consistent; a fresh install produces the correct figures.

## 11. What happened to legacy sub-valuations?

**Retained read-only.** They name their subcontractor in free text, hold no
schedule of values, and post nothing to the ledger. Payment applications
replaced all three.

Not migrated wholesale, because that means resolving free-text names to
companies automatically, and near-identical names are usually different
companies. Not retired, because that destroys records of money that moved. So:
creation refused with the destination, existing rows still finishable, the name
immutable, certified and paid rows undeletable, and attribution proposed by a
report and applied one row at a time.

Two further defects surfaced while driving it: attributing a company silently
recomputed the row's money (figures on certified and paid rows are now frozen),
and cash flow counted every valuation as an outflow including drafts (now only
certified and paid).

## 12. What evidence is this based on?

| Tier | | |
| --- | --- | --- |
| 1 | Playwright, through the real screens | **120 tests**, including 5 new pay-app tests |
| 2 | Live API drives against `octapm_verify` | 5 scripted passes across pay apps and sub-valuations |
| 3 | Jest | **1,810 across 165 suites** |
| 4 | Mutation check | removing the revision suffix makes the correction test fail |
| — | OpenAPI | 728 paths, validating |

The known flake is `report-builder-sources.test.js`, which times out under
parallel load roughly one run in three and passes alone in about two seconds. It
is reported every time rather than masked.

**Mocked-Prisma tests did not find a single one of the six defects in this
checkpoint.** The pay-app suite had never exercised certification posting at
all: its mocked update returned lines claiming zero, so the posting loop skipped
every line and asserted nothing. That is now fixed, and the suite uses the
shared cost-ledger mock that enforces the real unique key.

---

## Summary of defects found and fixed

| | Found by |
| --- | --- |
| Approved change orders could not raise a line's billing ceiling | driving the UI |
| A certified pay application could not be corrected at all | driving the API |
| The ceiling shown disagreed with the ceiling enforced | driving the API |
| Attributing a company restated a paid valuation's money | driving the API |
| Cash flow counted draft sub-valuations as money leaving | reading the code, confirmed live |
| Notification and comment deep links opened the module, not the record | driving the UI |
