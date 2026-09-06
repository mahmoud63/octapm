# OctaPM financial spine — end-to-end report

**Date** 2026-09-06 · **Method** driven through the browser, every figure
recalculated from source records · **Suites**
`frontend/e2e/03-financial-spine.spec.ts`, `04-change-to-budget.spec.ts`

---

## Verdict

**The financial spine works and its arithmetic is exact.** This was the highest
value unverified chain in the product. It is now verified from the interface
through to the database.

## The chain, stage by stage

Nothing below was read off a screen and believed. Each figure was recomputed
from the underlying records over the API and compared with what the UI showed.

### 1. Cost codes — company level

Created through Company › Cost codes:

| Code | Name |
| --- | --- |
| `01-CONC` | Concrete |
| `02-STEE` | Steel |
| `03-MEPP` | MEP |

Verified: visible after a full page reload, and present in the database. ✅

### 2. Project adoption

The project adopts the company codes through Cost › Budget › Cost codes. Cost
codes are organisation-level and a project selects the ones it uses — a sound
model, since it keeps the company's chart of accounts consistent across jobs. ✅

### 3. Budget lines — created through the UI

| Cost code | Original budget |
| --- | ---: |
| 01-CONC Concrete | 500,000 |
| 02-STEE Steel | 350,000 |
| 03-MEPP MEP | 700,000 |
| **Original budget** | **1,550,000** |

- Recalculated from source records: **1,550,000** ✅
- Shown on the budget screen: **1,550,000** ✅
- Survives reload ✅

### 4. Change order — raised through the UI

A variation of **125,000** raised through Commercial › Change Orders › Add
Change Order.

- Stored value equals the value typed: **125,000** ✅
- Reference generated: `VO-27` ✅
- Survives reload ✅

### 5. Governance before approval

Submission was **refused** until every control was satisfied:

| Control | Enforced |
| --- | --- |
| Schedule impact summary | ✅ |
| Cost impact summary | ✅ |
| At least one affected activity | ✅ |
| At least one cited supporting document | ✅ |

`CHANGE_ORDER_IMPACT_PROOF_REQUIRED` was returned until all four were present.
A generic file attachment did **not** satisfy it: the commercial record keeps
its own evidence references and the document must be cited on the change order
itself. That is a stronger control than most systems apply.

### 6. The arithmetic

| Figure | Before | After approval | Expected |
| --- | ---: | ---: | ---: |
| Original budget | 1,550,000 | **1,550,000** | unchanged ✅ |
| Approved change | — | 125,000 | 125,000 ✅ |
| **Revised budget** | 1,550,000 | **1,675,000** | 1,550,000 + 125,000 ✅ |

**Original budget + approved change orders = revised budget**, to the cent.

The original budget correctly does **not** move when a change is approved — the
distinction a QS depends on. The budget screen shows the revised figure, not a
stale one.

Repeatability: re-running adds another 125,000 each time and the total stays
exact — 1,675,000 → 1,800,000 → 1,925,000 → 2,050,000 across four runs.

## Dashboard reconciliation

`Active Projects` on the workspace dashboard: **shown 1, actual 1** ✅ —
recalculated by counting projects with `status = active`.

Every workspace KPI cites its own source and cutoff date on the card
("Source: Project.status", "Cutoff: Sep 6, 2026"), which is unusually good
practice and makes reconciliation straightforward. Fuller reconciliation is in
`OCTAPM_DASHBOARD_RECONCILIATION.md`.

## Not yet verified

The stages beyond the budget remain unproven end to end:

| Stage | Status |
| --- | --- |
| Commitment → schedule of values | ❓ not exercised |
| Progress → pay application | ❓ not exercised |
| Pay application → approval → payment | ❓ not exercised |
| Payment → actual cost → cash flow | ❓ not exercised |
| Forecast / projected final cost | ❓ not exercised |
| Cost variance | ❓ not exercised |
| Invoices / direct costs → budget actual | ❓ not exercised |
| Bid → award → commitment | ❓ not exercised |

So the chain is proven from **budget through approved change to revised
budget**. From commitment onwards it is not. That is the honest boundary, and
the next piece of work.

## Reproducing

```bash
npx playwright test --config=frontend/playwright.config.ts 03-financial 04-change
```

The suites are idempotent: they reuse cost codes and budget lines that already
exist rather than failing on duplicates.
