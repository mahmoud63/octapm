# Certified subcontractor cost reaching actual cost — live validation

**Card:** OCTA-FIN-SUBPAY-063 · **Written:** 2026-09-07
**Companion to:** [`OCTAPM_COST_POSTING_MODEL.md`](./OCTAPM_COST_POSTING_MODEL.md) ·
[`OCTAPM_ACTUAL_COST_MIGRATION.md`](./OCTAPM_ACTUAL_COST_MIGRATION.md)

The pay-application → actual-cost chain was built with unit-level evidence only.
Mocked Prisma cannot see schema, encoding, constraint or missing-guard defects,
and it did not see three here. This is what happened when the chain was driven
through the actual screens against a real database.

Spec: [`frontend/e2e/19-payapp-actual-cost.spec.ts`](../../frontend/e2e/19-payapp-actual-cost.spec.ts)

---

## 1. The fixture

Fixed so every figure can be recomputed rather than read off a page.

| | |
| --- | --- |
| Subcontract | **500,000** — Concrete 300,000 · Formwork 200,000 |
| Pay application #1 | **100,000** gross — Concrete 80,000 · Formwork 20,000 |
| Retention 10% | 10,000 |
| Net payable | 90,000 |

Coded to activity A-1000, which the seed holds at 100% approved progress, so the
progress cap never binds — the ceiling under test is the schedule of values.

**No assertion trusts a displayed total.** The screen is checked separately,
because a wrong figure on it is its own defect, but every financial assertion is
recomputed from `CostLedgerEntry` through
`GET /projects/{id}/cost/reconciliation` and `…/explain`.

---

## 2. What the drive proved

| | Result |
| --- | --- |
| Draft claim | ledger unchanged — a claim is not a cost |
| Certification | ledger **+100,000**, as `transactionalActual`, not an opening balance |
| Per line | two entries, 80,000 and 20,000, each naming its SOV line |
| Coding | `costType: subcontract`, activity, cost code and budget line off the SOV line |
| Committed | still 500,000; remaining commitment derived as 500,000 − 100,000 |
| Retention | 10,000 held, and **not** deducted from cost |
| Payment of 90,000 | ledger **unchanged** — cash moved, cost did not |
| Reconciliation | `balanced: true`, no variances |

### Duplicate certification

Three approvals fired concurrently, then a fourth as a late retry:

```
concurrent  → 409, 200, 200
late retry  → 409  SUB_PAY_APP_TRANSITION_INVALID
ledger      → +50,000 exactly · 1 entry
```

Two concurrent callers can both be told "approved" — the state machine only
catches the ones that arrive after a commit. The unique `sourceKey` catches the
rest, which is why it exists.

---

## 3. Three defects the unit tests could not see

### 3.1 An approved change order could not raise a line's billing ceiling

`approvedChangesBySovLine` reads `sovLineId` off each change-order line, but
`normalizeCoLines` **dropped the field on the way in**, and the route never
validated it. So a change order raised the commitment's revised value to 550,000
while the schedule of values stayed at 500,000: authorised work that could never
be billed, and the subcontractor's own final-application arithmetic could never
close.

The unit test for the ceiling passed throughout, because it built the change map
by hand and never went through the writer.

Fixed: the line carries `sovLineId`, validated against the commitment's own SOV
lines (`400 COMMITMENT_CO_LINE_SOV_INVALID` otherwise), and the commitment
screen now asks which line a change moves — previously it could only be
expressed through the API.

### 3.2 A certified pay application could not be corrected at all

`costLedger.reverse` was wired to the `void` transition, but `void` was reachable
only from `draft` and `rejected` — neither of which ever posts cost. So the
reversal path was **unreachable by construction**: once approved, a wrong
certificate stood forever.

Fixed by allowing `approved → draft` (revoke and correct) and `approved → void`,
with a mandatory reason, refused once anything has been paid. See the posting
model §4 for the rule and for the revision key that stops the corrected
certificate being swallowed as a duplicate.

```
certify   100,000   ledger +100,000
revoke              ledger -100,000   (reversal, nothing deleted)
correct    95,000
certify             ledger  +95,000   under sourceKey …:r1
                    ──────────────
                    3 entries, sum 95,000, balanced
```

A part payment then makes the certificate final: `409 SUB_PAY_APP_ALREADY_PAID`,
naming the payment.

### 3.3 The ceiling on screen disagreed with the ceiling enforced

`serializeLine` read `revisedScheduledAmount` from a **stored copy**, written by
`recompute` on a save or a transition. Between a change order being approved and
the next save, the copy was behind: the page showed 300,000 while the writer
accepted 350,000.

Fixed by deriving it from the approved change orders on every read, the same way
the claim check does. Copies of derived figures drift; this one had.

---

## 4. An incidental finding: deep links opened the module, not the record

Every module dashboard decides which record to open from `?source=<recordType>`,
and `recordWorkspacePath` — the builder behind every notification `actionUrl`,
every comment link and every record `path` — emitted only `?recordId=`. So a
notification about a pay application landed on the pay-applications tab and
opened nothing. Twenty-odd record types were affected.

One line in `record-links.js`; fifteen assertions that had pinned the half-built
shape now pin the correct one.

---

## 5. Evidence

| | |
| --- | --- |
| Playwright | **120 passed**, including the 5 new pay-app tests |
| Jest | **1,804 passed** across 165 suites |
| Live API drives | 3 scripted passes against `octapm_verify` |
| Mutation check | removing the revision suffix makes the correction test fail (2 entries, not 3) — the test has teeth |

The unit suite had never exercised certification posting at all: its mocked
`subPayApp.update` returned lines with `thisPeriodAmount: 0`, so
`postCertifiedCost` skipped every line and asserted nothing. That suite now uses
the shared cost-ledger mock, which enforces the real unique `sourceKey`, and
covers posting, double-posting, reversal, the revision key and both refusals.
