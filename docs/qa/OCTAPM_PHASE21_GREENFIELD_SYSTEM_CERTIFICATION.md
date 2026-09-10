# Phase 21 — greenfield system simulation

**Status: NOT CERTIFIED.** Nothing failed — 205 of 205 checks passed across
both halves and no P0 or P1 is open — but the run still did not reach the whole
of the scope the phase defines. §8 lists exactly what is missing.

**Branch:** `feat/p0-foundations-sprint1`
**21A from** `a2a3e0e` · **21B from** `55af9cc`
**Project:** `OCTA PHASE21 GREENFIELD 20260910093852` (`0ce999f2-b175-432b-8551-20182b4fc990`)

---

## 1. One greenfield project, continued — proven, not assumed

Phase 21B did not start over. Before adding a single transaction it proved the
project by **id and by state**: 29 snapshot checks reconciled the team,
schedule, BOQ, budget, commitments, ledger, cash and stock against every figure
Phase 21A reported. It also enumerated every project matching `PHASE21` and
confirmed **exactly one is live** — the rest are archived copies from earlier
runs — so the wrong one could not be continued by accident.

**Nothing in the business scenario came from the seed.** Only the eight demo
identities, the role definitions and the plan catalogue.

| created by the run | |
| --- | --- |
| 4 companies · 1 project · 7 team assignments · 7 cost codes | 21A |
| 14 activities across 3 WBS branches · 5 BOQ items · 5 allocations · 7 budget lines | 21A |
| 1 supplier · warehouse/zone/bin · 1 stocked item · 2 POs · 3 receipts · material issues | 21A |
| 1 subcontract signed and executed · 1 pay app certified and paid | 21A |
| 1 outsider tenant · 1 isolation project (archived) | 21A |
| 2 change orders (1 draft, 1 approved) with instruction attached · 1 direct cost | 21B |
| progress on 3 activities, submitted and approved | 21B |

Riverside Tower was never used.

---

## 2. Checks

| stage | checks | |
| --- | ---: | --- |
| 1 foundation | 38 | directory, project, team before/after |
| 2 schedule | 14 | CPM, critical path, float, recalculation |
| 3 BOQ & budget | 13 | whole/split/unallocated, refusals, the anchor |
| 4 procurement → cost | 28 | **stock ≠ cost, issue = cost** |
| 5 subcontract | 15 | **certified gross is the cost, payment is not** |
| 7 adversarial | 34 | tenant, project, RBAC |
| snapshot (21B) | 29 | the project is the one 21A left |
| 8 change & direct cost | 28 | **Revised Budget identity**, +8,500.00 |
| 9 progress & EV | 7 | EV derived before the report was read |
| **total** | **205** | **0 failed** |

---

## 3. The financial gates

**Materials.** 1,650.00 of stock arrived across three delivery notes including
a partial — ledger recorded **nothing**. Issuing 60 bags posted **660.00** at a
weighted average of exactly **11.00**.

**Subcontract.** 100,000.00 executed against a signed agreement; 60,000.00
certified gross; 6,000.00 retention; 54,000.00 paid. Actual cost rose by the
**gross**, and the payment moved cash only.

**Change.** Original **1,700,000.00 immutable**; approved changes 250,000.00;
**Revised 1,950,000.00** — identity exact. A 40,000.00 draft moved nothing, and
approving a variation moved the ledger by 0.00.

**Direct cost.** +8,500.00 exactly, once.

**Total actual 69,204.00**, agreeing across four independent readings: the
API reconciliation, **a raw SQL sum of `CostLedgerEntry`**, the budget-line
projection and the activity projection. Delta **0.00** on every exercised line.

**Earned value.** EV computed from approved allocations and percentages
*before* the report was read: 97,500.00, matched to the cent; advancing A130
took it to 120,000.00. CPI 138.4943 = EV / AC-to-date, exact to four places.

Full arithmetic in `OCTAPM_PHASE21_FINANCIAL_RECONCILIATION.md`.

---

## 4. CPM, checked on paper and then in the browser

Longest path 5+10+3+12+8+6+7+8+9+7+6 = **81 working days** over 12 activities.
The API returned exactly that. The planner's screen then showed it
independently: **14 activities · critical path 12 · 1 milestone**, the driving
chain listed in order, and float drivers *MEP 20d* and *Backfill 47d* — the
same float the API measured.

---

## 5. Security

13 cross-tenant attacks from a separately registered tenant, **zero leaks**,
and a real project answers **identically** to one that does not exist on every
verb. Five cross-project id substitutions refused. Seven wrong-role approval
attempts all 403, attacked at the API rather than inferred from buttons.

---

## 6. Defects

| | P0 | P1 | P2 | P3 |
| --- | ---: | ---: | ---: | ---: |
| discovered | 0 | 1 | 2 | 4 |
| fixed | 0 | **1** | 1 | 0 |
| open | **0** | **0** | **1** | 4 |

The P1 (P21-001) is what this phase existed to produce. The open P2 (P21-007)
is a consequence of fixing it: a schedule planned in the product now displays,
but has no stored revision to baseline. Seven test defects in my own
instruments are recorded — one briefly reported a cross-tenant leak that did
not exist, and was verified before being written down.

Six product rules were **confirmed by attacking them**: approved variations are
immutable, duplicate supplier invoices are refused, a variation needs written
impact plus linked activities plus an attachment, a subcontract needs its
signed agreement, an activity needs a responsible engineer, and a draft BOQ
allocation earns nothing.

---

## 7. Gates

| gate | result |
| --- | --- |
| Jest | **1,915 / 1,915**, 177 suites |
| OpenAPI | **733 paths**, valid |
| `prisma validate` | valid |
| Frontend typecheck (`tsc -b`) | **green** |
| Frontend production build | **green** |
| Phase 21 driver | **205 / 205** |
| Full Playwright | see §9 |

Environment: one PostgreSQL cluster (postmaster 20848), one API, one Vite on
`:5173`, no nodemon. A duplicate Vite on `:5174` was removed first (P21-002).

---

## 8. What this run did not reach

- **Client commercial chain** — no prime contract, SOV, valuation, invoice or
  client payment. Revenue and AR untested.
- **RFQ → quotes → comparison → award**, and **long-lead**.
- **Supplier invoice / 3-way match**, and direct-to-site recognition.
- **Timesheets / labour cost**.
- **RFI**, and RFI → change.
- **Document control** beyond the single instruction attached to the change
  order; **quality**; **safety / field**; **meetings and tasks**.
- **Ball-in-court transitions** driven through a full cycle — the semantics
  were observed and are correct, but no responsibility hand-off was driven.
- **Per-record deep links** — module and child deep links work; per-record was
  not systematically tested.
- **Persona UX drive** — 2 of 11 personas driven in the browser.
- **Permanent Playwright spec** for the greenfield lifecycle (§32).
- **Retention release**, and a weighted average that does not divide cleanly.

**CODEX INDEPENDENT REVIEW NOT AVAILABLE** — checked, not assumed. The
adversarial review in `OCTAPM_PHASE21_ADVERSARIAL_REVIEW.md` is a self-review
and is labelled as weaker evidence.

---

## 9. Verdict

**PHASE 21 NOT CERTIFIED.**

Blockers, precisely:

1. Scope in §8 not exercised — most materially the client commercial chain,
   3-way match, timesheets, RFQ→award, quality and document control.
2. Persona UX drive incomplete (2 of 11 in the browser).
3. No permanent browser regression for the greenfield lifecycle.
4. No independent review available.
5. One open P2 (P21-007) introduced by the P1 fix.

Not blockers: every financial delta is 0.00, the ledger reconciles four ways,
tenant and project isolation and RBAC are proven, and no P0 or P1 is open.
