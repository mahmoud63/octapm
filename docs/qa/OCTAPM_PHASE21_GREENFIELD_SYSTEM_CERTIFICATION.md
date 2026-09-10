# Phase 21 — greenfield system simulation

**Status: NOT CERTIFIED.** Not because anything failed — 142 of 142 checks
passed and no P0 or P1 is open — but because the run did not reach the whole
of the scope the phase defines. §7 says exactly what is missing.

**Branch:** `feat/p0-foundations-sprint1` · **from** `a2a3e0e` · **run** 2026-09-10
**Project:** `OCTA PHASE21 GREENFIELD 20260910093852` (`0ce999f2-b175-432b-8551-20182b4fc990`)

---

## 1. Was it really greenfield?

**Yes.** Nothing in the business scenario came from the seed.

Seed infrastructure used, and only this: the eight demo **identities** and
their passwords, the role definitions, the plan catalogue. Everything the
scenario needed, it made:

| created by the run | |
| --- | --- |
| 4 companies | client, material supplier, subcontractor, consultant |
| 1 project | created through `POST /projects`, never inserted into PostgreSQL |
| 7 project team assignments | through the Phase 20.5 "add existing user" workflow |
| 7 cost codes | company master, then selected onto the project |
| 14 activities | across 3 WBS branches, with FS dependencies |
| 5 BOQ items | priced, 459,000.00 |
| 5 BOQ→activity allocations | one whole, one split across two activities, one left unallocated |
| 7 budget lines | 1,700,000.00 |
| 1 supplier, 1 warehouse, 1 zone, 1 bin, 1 stocked item | |
| 2 purchase orders | draft → submit → approve → issue |
| 3 goods receipts | including a partial delivery |
| 1 material issue | plus 2 from authorisation probes |
| 1 subcontract | raised, agreement generated, signed PDF uploaded, executed |
| 1 pay application | draft → submit → review → approve, then paid |
| 1 second project | created and archived, to attack project isolation |
| 1 outsider tenant | registered through sign-up, to attack tenant isolation |

**Riverside Tower was not used.** The project the run created starts empty:
0 activities, 0 BOQ items, 0 budget lines, 0 commitments, 0 purchase orders —
asserted, not assumed.

---

## 2. What was proven

**142 checks, 0 failed**, across seven stages.

| stage | checks | what it establishes |
| --- | ---: | --- |
| 1 foundation | 38 | directory, project, team before/after, ordinary member cannot manage the team |
| 2 schedule | 14 | 14 activities, CPM, critical path, float, recalculation, identity preservation |
| 3 BOQ & budget | 13 | whole/split/unallocated, four refusals, the 1,700,000.00 anchor |
| 4 procurement→cost | 28 | PO lifecycle, partial delivery, weighted average, **stock ≠ cost, issue = cost** |
| 5 subcontract | 15 | agreement→signature→execution, **certified gross is the cost, payment is not** |
| 7 adversarial | 34 | tenant isolation, non-disclosure, project isolation, RBAC |

### The two financial gates

**Materials.** 1,650.00 of stock arrived across three delivery notes and the
cost ledger recorded **nothing** — 0 entries, `bySource` empty. Issuing 60
bags posted **660.00**, exactly 60 × the weighted average of 11.00. Stock fell
from 150 to 90 bags and from 1,650.00 to 990.00.

**Subcontract.** A 100,000.00 subcontract certified 60,000.00 gross, held
6,000.00 retention and paid 54,000.00. Actual cost rose by the **gross
60,000.00**. Recording the payment left it unchanged.

Full arithmetic in `OCTAPM_PHASE21_FINANCIAL_RECONCILIATION.md`. Every
exercised line reconciles with **delta 0.00**, and the ledger, the budget
projection and the activity projection all agree at 60,704.00.

### CPM, checked on paper

The network was designed so the answer was known before the API gave one:
longest path 5+10+3+12+8+6+7+8+9+7+6 = **81 working days** over 12 activities.
The API returned exactly 12 activities at zero float, the two spurs carrying
float (47 and 20 days), and a finish of 2027-04-08. Adding 10 days to
excavation moved the finish to 2027-04-20 — 10 working days on a six-day
calendar — and restoring the duration restored the original finish, on the
same 14 activity ids.

### Security

13 cross-tenant attacks, all refused, **zero leaks**. Reads answer `404
PROJECT_NOT_FOUND` and writes `402` — and a **real project answers identically
to one that does not exist**, on every verb, so nothing is disclosed. Five
cross-project id substitutions all refused. Seven wrong-role approval attempts
all `403`, attacked at the API and not inferred from button visibility.

---

## 3. Connected-system matrix

| connection | |
| --- | --- |
| Company → Project Team | **VERIFIED** |
| Project Team → RBAC | **VERIFIED** |
| WBS → Schedule | **VERIFIED** |
| Schedule → BOQ | **VERIFIED** (whole, split, unallocated; no shadow activities) |
| BOQ → Budget | **PARTIAL** — both exist and reconcile; no automated BOQ→budget derivation was exercised |
| BOQ/Activity → Procurement | **VERIFIED** (PO lines carry activity and cost code) |
| Award → PO | **PARTIAL** — POs raised directly; the RFQ→quote→award path was not driven |
| PO → Goods Receipt | **VERIFIED** (partial then final, outstanding correct) |
| Goods Receipt → Inventory | **VERIFIED** |
| Inventory → Material Issue | **VERIFIED** |
| **Material Issue → Actual Cost** | **VERIFIED** — exact |
| Subcontractor → Commitment | **VERIFIED** (directory company reused, not retyped) |
| Commitment → SOV → Pay App | **VERIFIED** (SOV line inherited) |
| **Pay App → Actual Cost** | **VERIFIED** — gross, exact |
| Pay App → Payment → Cash Flow | **VERIFIED** (54,000.00 out, cost unchanged) |
| Records → Audit | **PARTIAL** — audit entries written by the team workflow; not systematically inspected |
| Schedule → Cost dashboard | **VERIFIED** after P21-001 |
| Procurement → RFQ/Bid | **NOT EXERCISED** |
| PO → Long Lead | **NOT EXERCISED** |
| Change → Revised Budget | **NOT EXERCISED** |
| Progress → EV; Actual Cost → CPI | **NOT EXERCISED** |
| RFI → Change | **NOT EXERCISED** |
| Quality → responsibility | **NOT EXERCISED** |
| Records → Deep links; Workflow → Ball in Court | **NOT EXERCISED** |

---

## 4. Defects

| | P0 | P1 | P2 | P3 |
| --- | ---: | ---: | ---: | ---: |
| discovered | 0 | 1 | 1 | 4 |
| fixed | 0 | **1** | **1** | 0 |
| open | **0** | **0** | 0 | 4 |

The P1 (P21-001) is the finding this phase existed to produce: a project
planned in the product was invisible to the schedule, cost and site-reporting
modules, because the schedule payload was gated on an import artefact. Fixed,
with a regression test that fails 5 of 7 against the old code.

Four test defects in my own instruments are recorded in the register — one of
which briefly reported a cross-tenant leak that did not exist. It was verified
before being reported.

---

## 5. Gates

| gate | result |
| --- | --- |
| Jest | **1,915 / 1,915**, 177 suites |
| OpenAPI | **733 paths**, valid |
| `prisma validate` | valid |
| Phase 21 driver | **142 / 142 checks** |
| Full Playwright | **NOT RUN** (§7) |
| Console gate | **NOT RUN** as a full sweep (§7) |
| 14-path smoke | **NOT RUN** (§7) |

Environment during the run: one PostgreSQL cluster (postmaster 20848, 42
workers — not 43 clusters), one API (pid 20168), one Vite (pid 30496, `:5173`),
no nodemon. A duplicate Vite on `:5174` was found and removed first (P21-002).

---

## 6. Enter-once, observed

| information | verdict |
| --- | --- |
| Subcontractor identity | **VALID REUSE** — created once, selected on the commitment, carried to the pay app |
| Supplier identity | **VALID REUSE** — created once, selected on both POs |
| SOV line | **VALID REUSE** — the pay app inherited the subcontract's line; no scope retyped |
| Activity and cost code | **VALID REUSE** — carried from PO line to receipt to issue to ledger |
| Subcontract agreement | **VALID REUSE** — assembled from the record with 0 gaps, rendered to PDF for signature |
| PO reference, GRN number | **VALID** — generated (`PO-…-A`, `GRN-00001/2/3`), hand entry still allowed |
| Activity engineer | **VALID CONFIRMATION** — an activity may not exist with nobody responsible |

No unnecessary duplicate entry was found in the paths driven.

---

## 7. What this run did not reach

Stated plainly. Each is scope the phase defines and this run did not cover:

- **Change management** (§22) — no change order; Revised Budget untested as
  anything but equal to Original Budget.
- **Client commercial chain** (§11) — no prime contract, SOV, valuation,
  certificate or client invoice.
- **RFQ → quote → award** (§14) and **long-lead** (§15) — POs were raised
  directly.
- **3-way match** (§19), **direct costs** (§20), **timesheets** (§21).
- **Progress and earned value** (§28) — no PV/EV/AC/SPI/CPI.
- **RFI** (§23), **document control** (§24), **quality** (§25), **safety /
  field** (§26), **meetings and tasks** (§27).
- **Deep links** (§36) and **ball-in-court** (§37).
- **Persona UX drive** (§39) — the browser was used to diagnose and verify
  P21-001, but the eight-persona walkthrough was not performed.
- **Full Playwright, console gate and 14-path smoke** (§45).
- **Permanent Playwright spec** (§44) — the driver is committed as a Node
  suite under `backend/scripts/phase21/`, not yet as a Playwright spec.
- **Codex independent review** (§43) — **CODEX INDEPENDENT REVIEW NOT
  AVAILABLE.** No independent adversarial review was performed; the review in
  this document is my own and is therefore weaker evidence.

Nothing in this list failed. It was not attempted, and the phase's
certification rule requires the whole scope, so the honest verdict is
**PHASE 21 NOT CERTIFIED**.
