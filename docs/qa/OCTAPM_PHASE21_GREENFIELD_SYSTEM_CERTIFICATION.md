# Phase 21 — greenfield system simulation

**One project, built from nothing and operated end to end across three
stages — 21A (foundation to subcontract), 21B (change, direct cost, earned
value), 21C (client money, RFQ to award, 3-way match, labour, RFI, document
control, quality, field, meetings, every persona, deep links, and a permanent
regression) — then certified against what it proved, not what it aimed at.**

Project: `OCTA PHASE21 GREENFIELD 20260910093852` (`0ce999f2-b175-432b-8551-20182b4fc990`),
created 2026-09-10 through the API by the PM, from a directory of four
companies also created that day. Every stage of 21B and 21C began by reading
the project back by id and asserting its state — the same project, not a copy,
not a demo fallback.

Branch `feat/p0-foundations-sprint1`; nothing deployed, nothing merged,
nothing migrated against any shared environment.

---

## 1. One greenfield project — proven, not assumed

| stage | what was built or driven | checks |
| --- | --- | ---: |
| 21A · 1–7 | companies, project, team, cost codes, WBS and 14-activity CPM schedule, 5-row BOQ and allocations, 1,700,000.00 budget, two POs, three deliveries into a site store, a 64-bag issue, a subcontract executed and paid, then 13 tenant attacks, 5 project attacks and 7 role attacks | 170 |
| 21B · 8–9 | change management (a draft that moves nothing; two 125,000.00 variations approved with impact, links and an instruction), a direct cost, earned value derived on paper and matched | 35 |
| 21C · 10 | prime contract → IPC-01 (three items, capped by the product) → certified 120,000.00 → invoice → 80,000.00 received → receivables → cash flow | 34 |
| 21C · 11 | vendor prequalification → RFQ package → three supplier portals → levelling → award (refused for the unqualified bidder until overridden in writing) → PO-00001 | 33 |
| 21C · 12 | two supplier invoices against PO lines; the 50.00 price variance detected; the stocked goods post no second cost | 35 |
| 21C · 13 | 5 steelfixers × 8 h @ 50.00 = 2,000.00 through the timesheet to the ledger | 17 |
| 21C · 14 | RFI-001 raised, ball in court planner → PM → nobody, converted into VO-22 (4,500.00), approved: Revised Budget +4,500.00, ledger +0.00 | 26 |
| 21C · 15 | S-101 rev A → B → C (the storeman sees only B); the mill-certificate submittal rejected, resubmitted, reviewed, approved; a transmittal; a letter; one register | 24 |
| 21C · 16 | two ITPs (one failed), a major NCR closed out with evidence, a defect, a cube test, a punch item the PM alone may close, a safety observation; the score read from the dashboard | 26 |
| 21C · 17 | the crew day's daily log (manpower report = timesheet), a weather delay raised from it, a near miss closed out, the photo gallery | 17 |
| 21C · 18 | minutes finalised and distributed; an action tracked as a task to done | 15 |
| 21C · 19 | all eight personas through the real sign-in; 25 record deep links graded as the PM | — |
| snapshot | the whole project reconciled, transaction by transaction | 36 |
| **total** | | **468** |

Every 21C stage was run at least twice back to back; the second run reuses
its own records by deterministic key and fails loudly on a duplicate it did
not expect. The one duplicate that did occur (NCR-002) is recorded as T-10,
named in the stage, and kept — approved history is not deleted to tidy a
test.

---

## 2. The financial gates

| gate | 21A/21B | 21C | held |
| --- | ---: | ---: | --- |
| Receiving stock posts no cost | 0.00 | — | yes |
| Material issue posts cost at the weighted average | 704.00 | — | yes |
| Pay app posts the **gross** | 60,000.00 | — | yes |
| Direct cost posts once | 8,500.00 | — | yes |
| Timesheet posts labour at the snapshotted rate | — | 2,000.00 | yes |
| Supplier invoice for stocked goods posts **no** second cost | — | 0.00 | yes |
| Approved variation moves budget, not ledger | +250,000.00 / 0.00 | +4,500.00 / 0.00 | yes |
| Client payment is cash in, not cost | — | 80,000.00 / 0.00 | **yes, after P21-009** |
| Ledger = SQL sum = budget projection = activity projection | 69,204.00 | **71,204.00** ×4 | yes |
| Revised Budget = Original + approved changes | 1,950,000.00 | **1,954,500.00** | yes |
| Certified revenue = EV of the same progress | — | 120,000.00 = 120,000.00 | yes |

Details, with every figure's lineage: `OCTAPM_PHASE21_FINANCIAL_RECONCILIATION.md`.

---

## 3. Connected workflows

48 connections VERIFIED, 6 PARTIAL, 0 MISSING, 0 NOT EXERCISED, 0 BROKEN —
every row that 21B left MISSING or NOT EXERCISED was driven in 21C. The six
PARTIAL rows each name a defect or an observation. See
`OCTAPM_PHASE21_CONNECTED_WORKFLOW_MATRIX.md`.

---

## 4. Personas and deep links

All eight staff personas were driven through the real sign-in form in a
headless browser (and the procurement manager also by hand), each to their
landing, the project's module strip, and one page of their own, with the
refusals they met at the API written down beside the controls they were
shown. The external personas were driven through the supplier portal (three
bidders) and, for the client, from the contractor's side of the money; no
client or subcontractor **user** exists to sign in as, and Phase 21 did not
create one. Findings: P21-013, P21-014, P21-018. See
`OCTAPM_PHASE21_PERSONA_UX_REPORT.md`.

Record deep links: of 26 graded after the P21-011 fix, **12 open the record,
9 land on the register with the row visible, 5 land on the module home, 0
open the wrong record type** (P21-015 P3). The two that opened the wrong
record type — ITP and defect, P21-011 — were fixed after the first report;
both ITPs now open selected inline, and the defect fix is proven by its
regression spec on a register with two defects (this project's holds one).
A module-home URL was not counted as a record deep link.

---

## 5. Security

Tenant isolation held for every 21C record kind (RFI, drawing, NCR, meeting —
403/404 to a separately registered tenant). RBAC was **attacked and found
wanting**: ten project routers had no role guard (P21-010, P1) — fixed on
this branch with a regression test that fails 5 of 87 without the fix; after
it, 2 of 108 audit probes pass the door, both by design (comments).

**PRE-DEPLOYMENT SECURITY DEBT — OPEN**, carried unchanged from the security
checkpoint and out of Phase 21's scope: on `main`, CORS allows every origin,
the production-origin validator is emptied, the CloudFront guard is removed,
`'productio'` is misspelt, the quality-gates and OpenAPI CI jobs are deleted,
`require_secret` is commented out of `deploy.yml`, Stripe test values are
hardcoded in `deploy.yml` at both tips, and a non-placeholder
`CLOUDFRONT_SHARED_SECRET` sits at the tip of `main` (fingerprint only,
POSSIBLY LIVE — rotate before any deployment). This branch restores the code
guards and the CI jobs; the `deploy.yml` items are inherited by both.

---

## 6. Defects

| | P0 | P1 | P2 | P3 |
| --- | ---: | ---: | ---: | ---: |
| discovered (A + B + C) | 0 | 3 | 3 | 13 |
| fixed | 0 | **3** | **2** | 0 |
| open | **0** | **0** | **1** | 13 |

The three P1s — a schedule planned in the product did not display (P21-001,
21A), a client payment did not reach cash flow (P21-009, 21C), ten routers
enforced no role (P21-010, 21C) — are fixed, each with a regression test
shown to fail without the fix. Of the three P2s, P21-002 (environment) and
P21-011 (ITP and defect deep links opened the wrong record type — fixed after
the first 21C report, with a browser regression that fails 2 of 3 without the
fix) are closed; the one open P2 is P21-007 (a product-planned schedule has no
stored revision to baseline; a consequence of the P21-001 fix). Ten test
defects in my own instruments are recorded (T-01 … T-10). Full detail:
`OCTAPM_PHASE21_DEFECT_REGISTER.md`.

Fifteen product rules were **confirmed by attacking them** — listed in the
register.

---

## 7. Gates

| gate | result |
| --- | --- |
| Jest (backend) | **2,005 / 2,005**, 179 suites |
| OpenAPI | **733 paths**, valid |
| `prisma validate` | valid |
| Frontend typecheck | **green** (`tsc -p tsconfig.app.json --noEmit`) |
| Frontend production build | **green** (`vite build`, 16.5 s) |
| Frontend lint | **red on pre-existing debt**: 25 errors in 11 files untouched by Phase 21 (10 earlier e2e specs, `goods-receipt-panel.tsx`); the new spec is clean |
| Phase 21 driver, all stages | **468 / 468** |
| Permanent greenfield spec (§8), twice back to back | **3 / 3 and 3 / 3** (17 s, 14 s) |
| P21-011 regression (`33-quality-deep-links.spec.ts`) | **3 / 3**; 2 of 3 fail without the fix; targeted regression with user smoke, ball-in-court UI and needs-you: **13 / 13** |
| Full Playwright | **145 / 147** in 15.1 min. The two failures are both in `11-inventory.spec.ts` and both environmental: (69) the spec's own screenshot write into the OneDrive-synced `docs/design/screenshots` folder was refused by the file system (`UNKNOWN: unknown error, open …`) — the test passes when the spec is run alone; (72) the analytics variance list is a first-25 crowded out by purchase orders left behind by earlier lifecycle specs (`PO-xxxxxxxx` refs, which the seed's `PO-E2E-` / `PO-LC-` cleanup does not cover), so the seeded cement row is absent — reproducible alone (1 of 11 fails), and no 21C change touches that path. Recorded as P21-020 (P3). Every other spec, including the three new ones, passed. |
| API during 21C | 2,720 requests, **0 × 429, 0 × 5xx**; **1 restart** (to load the P21-010 fix, logged); no token expiry (harness re-mints inside 15 min) |
| Cleanup | every stage's records are keyed and re-found; the permanent spec retires its project and fails if it cannot; one test-data correction logged (T-10) |

Environment: one PostgreSQL cluster (postmaster 20848), one API (pid 16344
after the one restart), one Vite on `:5173`, no nodemon.

---

## 8. The permanent regression

`frontend/e2e/32-greenfield-regression.spec.ts` builds a brand-new project on
every run — team, cost codes, two activities, a priced bill allocated and
approved, a budget, a purchase order received and issued at 10.00 a bag, a
25,000.00 change approved — and asserts the money the way the stages did
(nil on receipt, 640.00 on issue, ledger = both projections, Revised Budget
175,000.00 with the ledger untouched), then has the PM see the same figures
in the browser, retires the project, and walks the plan allowance page by
page to prove nothing leaked. It does not depend on the Phase 21 project.

---

## 9. What this run did not reach

- **Retention release**, and a weighted average that does not divide cleanly.
- A **client or subcontractor user** signing in to the application (no such
  identity exists; the portal and the contractor's side were driven).
- **Long-lead alert lifecycle** beyond the alert that appeared.
- **Automated BOQ → budget derivation** (both exist and reconcile; no
  derivation was exercised).
- **Codex independent review** — checked again on 2026-09-12 and not
  available. The adversarial review is a self-review and is labelled
  "ADVERSARIAL SELF-REVIEW — NOT INDEPENDENT" (`OCTAPM_PHASE21_ADVERSARIAL_REVIEW.md`).

---

## 10. Verdict

**PHASE 21 CERTIFIED** — as a greenfield system simulation on one project across 21A, 21B and 21C. The certification conditions hold: no P0; no P1 open (three found, three fixed, each with a regression test shown to fail without the fix); every financial identity exact to the cent and reconciled four ways; the permanent greenfield regression green twice from nothing with its project retired; all eight staff personas driven in the browser; the adversarial self-review complete and labelled. Carried, not hidden: one open P2 (P21-007), thirteen P3s, the frontend lint debt in files Phase 21 did not touch, the two environmental Playwright failures above, and the **PRE-DEPLOYMENT SECURITY DEBT — OPEN**. Codex independent review was genuinely unavailable and, per the brief, is not a condition. Phase 22 has not been started.

Not blockers, and stated so the reader does not have to infer them: every
financial identity is exact to the cent and reconciles four ways; tenant and
project isolation are proven; RBAC is proven after a fix that is tested;
no P0 or P1 is open; the permanent regression passes twice from nothing;
the pre-deployment security debt is out of scope and is carried OPEN.
