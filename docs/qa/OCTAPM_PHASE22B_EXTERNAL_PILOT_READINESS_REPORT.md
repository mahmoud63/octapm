# OCTAPM PHASE 22B — EXTERNAL PILOT READINESS REPORT

Date: 2026-09-15 · Branch: `feat/p0-foundations-sprint1` · Local PostgreSQL only (`localhost:55432/octapm_verify`);
no staging, production, AWS or `prisma migrate deploy`.

| | |
| --- | --- |
| Starting HEAD | `ef5aa56` (docs) on product `853e560` |
| Final product HEAD | `ad79504` (product `539ba43` finance, `aceaef7` quality, `a60bf81` admin, `c5ba658` e2e, `808cc01` and `ad79504` test hardening, `7320ead` landing hero film) |
| Final docs HEAD | the commit carrying this report (`git log -1 -- docs/qa/OCTAPM_PHASE22B_EXTERNAL_PILOT_READINESS_REPORT.md`), pushed after `ad79504` |
| Remaining P2s at start | P2-1 "Committed" vocabulary · P2-2 change-order budget allocation · P2-3 change-order evidence reuse |
| Fixed this phase | P2-1, P2-2, P2-3 and fourteen 22B findings (two P1) — `OCTAPM_PHASE22_UX_DEFECT_REGISTER.md`, Phase 22B section |
| Carried | 22B-15 portal confirm box (P3) · 22B-16 run-stamped party names on the certified project (P3, by design) · 22B-17 external representatives receive an internal role (P3, scope decision) |

## 1. "Committed" terminology — before / after

| Screen | Before | Value source | Meaning | After |
| --- | --- | --- | --- | --- |
| Cost Overview card, filter and table headers | "Committed" | Σ `BudgetLine.committedFromCommitments` (executed subcontracts and POs) | value of executed commitments | **Executed commitments** (hint: value of executed subcontracts and purchase orders) |
| Budget tab stat and column | "Committed" | same | same | **Executed commitments** |
| Budget line dialog | "Committed" | `BudgetLine.committed` typed by a person | a manual figure, not derived | **Committed (manual)** |
| Commitments panel | "Committed" | executed commitments | same as Cost | **Executed commitments** |
| Purchase orders KPI | "Committed" | Σ order value not cancelled/planned | PO value, not yet a commitment | **PO value** (hint: neither planned nor cancelled) |
| Forecast table | "Committed" | executed commitments | same as Cost | **Executed commitments** |
| Report columns (`report-sources.js`) | "Committed", "Actual", "Forecast" | budget register | same | **Executed commitments**, **Actual cost**, **Forecast (EAC)**, "Executed commitments (from the register)" |

One source: `frontend/src/lib/financial-terms.ts` (`FINANCIAL_TERMS`, `term()`, `termHint()`); the concepts PO Value, Executed Commitments,
Certified Cost, Actual Cost, Retention, Cash In/Out stay separate numbers. Regression: `frontend/scripts/financial-terms.test.mjs` (392 feature files
carry no bare "Committed" label).

## 2. Change-order budget allocation — before / after

Before: `budgetLineId` was discarded on create and update (P21-012); every approved value went to the system "Change orders" holding line and
could not be moved. After: the form offers the project's active lines ("Change orders line (decide later)" stays the default) or a split
across lines that must add up to the value; `ChangeOrder.budgetLineId` and `budgetAllocationsJson` (migration
`20261001100000_change_order_budget_allocations`) are locked once approved; on approval `applyChangeOrderToBudgetLines` posts the split (last target
takes the rounding remainder; an archived line's share falls back to the holding line); repeated approval is idempotent; historical orders are untouched.
Tests: `budget.service.test.js` ("applies an explicit split"), `change-order.service.test.js` ("stores the budget line or the split; refuses a split that
does not add up"). Live: VO approved on line 01-100 → $150,000 → $162,500; project Revised = Original + Approved changes; certified project unchanged
(Original 1,700,000.00 / Approved changes 254,500.00 / Revised 1,954,500.00, holding line as before).

## 3. Change-order evidence — before / after

Before: only register documents; a letter already attached to the RFI had to be uploaded again. After: `GET /projects/:id/attachments/search`
(`attachment.service.searchProjectEvidence`: newest 500 attachments with available/linked documents, filtered by the record type's read permission and
the Phase 21 record-visibility rules, labelled with the record's reference and title) feeds a second "Attached to records" group in the document
picker; the picker persists the canonical document id, so the change order cites the RFI's letter with its deep link. Test:
`attachment.evidence.test.js`. Live: the two-session driver cites the RFI's instruction letter without a second upload.

## 4. E2E architecture — before / after

| | Before | After |
| --- | --- | --- |
| Organisation | suites signed in to the demo organisation (`@octapm.demo`) and left residue there | dedicated "OctaPM E2E" organisation, people `@octapm-e2e.test` (`frontend/e2e/support.ts`) |
| Reset | none; a residue script archived what it recognised | `backend/scripts/e2e/reset-e2e-org.js`: deletes the E2E organisation (constraint-driven clearing, relation-named constraints handled, fails loudly), reseeds deterministically (people incl. Quality Engineer, activities, BOQ, six cost codes, four budget lines, inventory, PO-0001/0002, one subcontract), verifies, `--count` reports residue |
| Trigger | manual | `frontend/e2e/global-setup.ts` on every Playwright run (`E2E_SKIP_RESET=1` bypasses) |
| Identifiability | by run token | everything in one organisation; the demo organisation is never touched by a suite |
| Demo organisation | Riverside Tower `95c188f3…` carried 521 commitments, 163 orders, 138 packages of suite history | original fixture renamed and archived (history kept, `archivedAt` stamped); clean Riverside Tower `cb4f705c…` reseeded; residue script pinned to the certified project's organisation, protects the live demo project by name, sets 637 residue companies inactive (61 unreferenced ones deletable with `--delete`), archives greenfield cost codes |

## 5. Three consecutive Playwright runs (E2E organisation, no residue script between runs)

| Run | Started | Passed | Failed | Skipped | Retries | Duration |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| 1 | 2026-09-15 17:43:49 | 165 / 165 | 0 | 0 | 0 | 15.2m |
| 2 | 2026-09-15 17:59:04 | 165 / 165 | 0 | 0 | 0 | 15.6m |
| 3 | 2026-09-15 18:14:43 | 165 / 165 | 0 | 0 | 0 | 17.4m |

E2E organisation counts (the residue each run leaves, before the next run's reset):

| Entity | fresh (right after a reset) | before run 1 (previous attempt’s residue) | after run 1 | after run 2 | after run 3 |
| --- | :-: | :-: | :-: | :-: | :-: |
| projects | 1 | 8 | 8 | 8 | 8 |
| users | 9 | 9 | 9 | 9 | 9 |
| companies | 1 | 16 | 16 | 16 | 16 |
| commitments | 1 | 14 | 14 | 14 | 14 |
| purchaseOrders | 2 | 14 | 14 | 14 | 14 |
| inventoryItems | 6 | 12 | 12 | 12 | 12 |
| warehouses | 2 | 3 | 3 | 3 | 3 |
| bidPackages | 0 | 4 | 4 | 4 | 4 |
| payApps | 0 | 7 | 7 | 7 | 7 |
| timesheets | 0 | 0 | 0 | 0 | 0 |
| documents | 0 | 9 | 9 | 9 | 9 |
| rfis | 0 | 0 | 0 | 0 | 0 |
| changeOrders | 0 | 4 | 4 | 4 | 4 |
| assignments | 9 | 32 | 32 | 32 | 32 |
| ncrs | 0 | 0 | 0 | 0 | 0 |
| ledgerEntries | 4 | 16 | 16 | 16 | 16 |

The suite's own global setup resets the organisation before each run; nothing else runs between them (the 'before run 1' column is what the previous attempt's last run had left, removed by run 1's reset). Counts are from `reset-e2e-org.js --count`; the 'fresh' column is a reset taken after the runs, which also shows the reset still clears four attempts' worth of residue.

## 6. Demo organisation cleanliness (client-facing)

`archive-e2e-residue.js` dry run after the phase: organisation OctaPM Demo Contracting; protected certified `0ce999f2`, original fixture `95c188f3`,
live demo `cb4f705c`; projects 419 (3 protected, 416 residue archived, 0 active residue, 0 unknown); inventory items 7 active, 0 residue; warehouses 3
active, 0 residue; companies 644 of which 637 residue set inactive, 7 active shown; cost codes 13 active, 0 residue; Riverside orders 0 suite-made;
"nothing to do". Workspace: 2 active projects, 7 procurement risks (was 7 visible / 273). Users: 9 real people.

## 7. E2E organisation status

Dedicated organisation "OctaPM E2E", recreated by every run's global setup (fresh: projects 1, users 9, companies 1, commitments 1, purchaseOrders 2, inventoryItems 6, warehouses 2, bidPackages 0, payApps 0, timesheets 0, documents 0, rfis 0, changeOrders 0, assignments 9, ncrs 0, ledgerEntries 4). Every run leaves the same controlled residue (table in §5) and the next reset removes it; the demo organisation and the certified project are not touched by any run (residue script "nothing to do", snapshot 36/36 after the runs).

## 8. Quality — before / after

Score 3.7 → **4.6**. Quality Engineer role (Lena Fischer) across policy, labels, pickers, invitations and templates; one dialog raises an NCR, safety
incident or material test with severity, activity, responsible person and company and due date (3 clicks from the project); the responsible person
submits the closeout with photo/file evidence whatever their role (`requirePermissionOr`, `rbac.record-allowance.test.js`); the quality engineer
approves; KPIs count live rows only (`quality.metrics.test.js`). Connectivity: NCR → "My open items" → closeout → approval → close, every handoff
REALTIME in two sessions; Inspections, Punch, Observations, Safety and Material Tests reachable from the module bar; no Quality UX-P1 open.

## 9. Settings / Admin — before / after

Score 3.6 → **4.2**. Company add and edit from the Directory (`PATCH /companies/:id`), active-only listing with a "Show inactive companies" switch,
cost-code edit, role labels everywhere ("Quality Engineer", not `quality_engineer`), People page copy ("Everyone in the organisation, their role and
the projects they are on"), invitable roles from the policy, navigation gated (People and Company only for those who may open them), sub-tabs follow
their permission module and a hidden URL is replaced by the offered one, inventory KPIs in USD. Audited read-only: Vendors, Cost codes, Equipment,
Project templates, Team, Locations, Warehouses, Permissions. Open (P3-level): registries have no audit view or pagination controls.

## 10. External persona decision

**OPTION A — internal contractor Pilot V1.** Supplier / Bidder: **SUPPORTED** by invitation link (20/20 live checks: prequalification refused then
overridden with an audited reason; portal without login; own invitation only; lines priced; total; submit; question; withdraw, reprice, resubmit;
other bidder isolated; buyer levels, soft-awards and confirms; commitment SC-002 raised from the priced lines; "This package was awarded to you";
375 px without sideways scroll; 0 console errors). Client / Owner and Subcontractor: **NOT SUPPORTED** as external users — an invited representative
becomes an internal Site Engineer with internal navigation; not faked, excluded from the pilot.

Supported pilot personas (browser-certified): Company/Admin, PM, Planner, QS, Cost Controller, Procurement, Warehouse, Site Engineer, Quality,
Finance (+ Supplier/Bidder by link). Unsupported: Client/Owner login, Subcontractor login.

## 11. Clicks

Rebaseline in `OCTAPM_PHASE22_CLICK_MATRIX.md` (Phase 22B section). Improvements: Raise NCR 6 → 3, Find Document 4 → 2, Create Company
(new) 3, Add Project Member (new) 4, Receive Goods measured at 4. Average of the seven high-frequency actions: **2.7 clicks** from the start screen
(22A: 3.9 for the same set). Worst workflows: Create Change 6 (5 of them decisions: budget line, evidence), Create Pay App 6 (4 decisions),
Create PO 4–5 (estimated, raised from a package). No genuine approval, certification, evidence or commercial control was removed.

Workspace / Needs You: every persona lands on Workspace Control with "My open items" (user-matched) and its quick actions; the NCR reached the
responsible person's "My open items" in under a second and left it after closure; a required action is 1 click from the workspace (the item) and
1–2 more to act on it.

## 12. Two-session results

Four chains, twelve handoffs (`OCTAPM_PHASE22_HANDOFF_MATRIX.md`, Phase 22B section): RFI raised / closed **REALTIME** (77–965 ms / 7–14 ms);
change order created / submitted / approved **REALTIME** (0.8 s / 5 ms / 3 ms), value on the named line on navigation; goods receipt → PM
purchase-order list **REALTIME** (4 ms, new event), stock on navigation; NCR raised → "My open items" **REALTIME** (0.5–0.8 s), closeout submitted
**REALTIME** (5 ms), approved **REALTIME** (5 ms), leaves "My open items" on navigation. STALE: none. Refused calls: 0. Console errors: 0.

## 13. Propagation checks

`OCTAPM_PHASE22_PROPAGATION_MATRIX.md`, Phase 22B section: change → named line → revised budget → Cost Overview → forecast CONNECTED; split and
archived-line fallback CONNECTED (unit); historical orders PRESERVED; RFQ → award → commitment CONNECTED; PO → receipt → stock → list CONNECTED;
inventory issue, labour, subcontract certification/payment and client receipt CONNECTED on the certified project (payment and receipt do not post
Actual again); RFI and Quality chains CONNECTED. Failures: none. **Propagation PASS.**

## 14. Duplicate-entry cases

`OCTAPM_PHASE22_DATA_REUSE_AUDIT.md`, Phase 22B section: budget line, evidence, company, cost code, invitable roles, project parties and the quality
create dialog are entered once. Remaining: a bidder's contact typed on the invitation when the vendor record has none (acceptable).

## 15. UX counts after 22B

UX-P0 0 · UX-P1 0 (2 found, 2 fixed) · UX-P2 0 open (14 found or carried, 14 fixed) · UX-P3 3 open.

## 16. Financial hard gate (certified project `0ce999f2`, read-only)

| Figure | Expected | Actual | Delta |
| --- | --- | --- | --- |
| Original budget | 1,700,000.00 | 1,700,000.00 | 0.00 |
| Approved revisions | 0.00 | 0.00 | 0.00 |
| Approved changes | 254,500.00 | 254,500.00 | 0.00 |
| Revised budget | 1,954,500.00 | 1,954,500.00 | 0.00 |
| Executed commitments | 100,000.00 | 100,000.00 | 0.00 |
| Certified subcontract cost | 60,000.00 | 60,000.00 | 0.00 |
| Material issue cost | 704.00 | 704.00 | 0.00 |
| Direct cost | 8,500.00 | 8,500.00 | 0.00 |
| Labour (timesheets) | 2,000.00 | 2,000.00 | 0.00 |
| Expected Actual | 71,204.00 | 71,204.00 | 0.00 |
| SQL CostLedgerEntry | 71,204.00 | 71,204.00 | 0.00 |
| API Actual (budget-line projection) | 71,204.00 | 71,204.00 | 0.00 |
| Reported Actual (activity projection) | 71,204.00 | 71,204.00 | 0.00 |
| Cash in (stage 10) | 80,000.00 | 80,000.00 | 0.00 |
| Cash out (paid) | 54,000.00 | 54,000.00 | 0.00 |
| Retention held | 6,000.00 | 6,000.00 | 0.00 |
| Accounts receivable | 0.00 | 0.00 | 0.00 |

Snapshot 36/36, 16/16 source lines, **Actual delta 0.00** (SQL / API / SQL vs API). Scripts `scratchpad/p21/snapshot.js`, `final-recon.js`.

## 17. Tests and gates

| Gate | Result |
| --- | --- |
| Jest (backend) | 2,193 / 2,193 passed (196 suites, 63.0 s) on the certified HEAD `ad79504` |
| Playwright ×3 | 165 / 165 × 3 consecutive on HEAD ad79504, retries 0, unexpected skips 0 (15.2m / 15.6m / 17.4m) |
| Typecheck | `tsc -b` 0 errors |
| Production build | green (18.99 s); one tooling deprecation notice (vite:react-swc `esbuild` option) |
| Touched-file lint | 0 errors; 2 pre-existing `react-hooks/set-state-in-effect` warnings in `change-event-dialog.tsx` (code predating 22B) |
| Frontend script tests | financial terms (392 files), permission visibility (84 assertions) |
| Console errors / 403s | 0 / 0 across ten persona sessions, eight two-session contexts, the supplier portal |
| Financial | 36/36, delta 0.00 |
| Git | product HEAD `ad79504` on `feat/p0-foundations-sprint1`; docs commit follows; pushed, `git status` clean, `rev-list --left-right --count origin...HEAD` = 0 0 (recorded after the push) |

## 18. Overall score

**4.47 / 5 (≈ 4.5)** — `OCTAPM_PHASE22_CLIENT_SCORECARD.md`, Phase 22B section. Quality 4.6, Settings/Admin 4.2, daily-use modules 4.6.
Held at the boundary by Schedule (provisional 4.0, not deep-driven this phase) and Settings/Admin (no registry audit view or pagination). Client
impact: low — neither blocks a demo or an internal pilot; workaround: Schedule was certified in Phase 21 and the admin registries are small at pilot
scale. Scope to close: a Schedule persona drive and registry audit/pagination views (one short phase).

## 19. Verdicts

**READY FOR CLIENT DEMO** — on the demo organisation: the clean Riverside Tower (`cb4f705c…`) for the walk-through (login → workspace → project → budget → change order with its budget line and evidence → RFI → procurement → goods receipt → quality) and the certified Phase 21 project for the reconciled figures. The directory, workspace KPIs and registers carry no suite residue; ten personas land on pages that show nothing they cannot use; no console error on any driven screen.

**CONDITIONAL FOR EXTERNAL PILOT** — the pilot is an internal contractor pilot (Option A): the ten internal personas are browser-certified and the supplier/bidder portal is supported by invitation link; owner and subcontractor logins are excluded and must not be advertised. Conditions carried into the pilot, none of them blocking: (1) the client-experience score is 4.47, on the 4.5 boundary — Schedule is still provisional (not deep-driven since Phase 21) and the admin registries have no audit view or pagination; (2) 61 unreferenced residue companies remain inactive rather than deleted (`archive-e2e-residue.js --apply --delete` removes them when a person decides so); (3) three P3 presentation items stay open (portal confirm box, the certified project’s run-stamped party names, external representatives receiving an internal role). Not used: production ready.

Not used: "production ready".
