# OCTAPM PHASE 22A — CLIENT DEMO READINESS IMPLEMENTATION + USER-ENVIRONMENT REVALIDATION

Scope: the Phase 22 audit's Wave A/B items only — budget terminology, forecast credibility, change-order
data reuse, presentation (UUIDs, devtools, logout wording, menus), demo residue, registry reliability,
workspace quick actions, Procurement navigation — then a browser-first revalidation as real personas.
No Phase 23 work, no deploy, no merge, no production, no Codex loop.

| Item | Value |
| --- | --- |
| Starting HEAD | `3f2340d30938ae6db60c59c811c628802e3d2d5d` (Phase 22 audit docs) |
| Final product HEAD | `853e56058888cea60e09bd7dc77c4ab4ec821011` (docs HEAD = the commit that carries this report) |
| Branch | `feat/p0-foundations-sprint1` |
| Environment | local dev server `localhost:5173` (working tree) + API `localhost:5000` + local PostgreSQL `localhost:55432` |
| Certified project (read-only hard gate) | `0ce999f2-b175-432b-8551-20182b4fc990` — OCTA PHASE21 GREENFIELD 20260910093852 |
| Disposable project (destructive tests) | `95c188f3-bd97-4d28-b466-17aa354ee24a` — Riverside Tower (the Playwright fixture project) |

---

## 1. Issues fixed, root causes, before/after

| # | Audit item | Root cause | Fix | Before → After |
| --- | --- | --- | --- | --- |
| A | UX22-01 three "budget" numbers | Three unrelated fields all labelled "Budget": `project.contractValue` (header), `revision.totalBudget` (Schedule: activity budgets on the schedule revision), Σ cost-record budgets (Cost Overview: allocated to activities). No screen showed the budget register's own totals. | Cost Overview now carries a **Budget** block fed by one backend source (`cost.service.getCostSummary` → `budget.service.listBudgetLines` totals): Original / Approved changes / Revisions & transfers / Revised. Header says **Contract value**; Schedule says **Activity budget — on this schedule revision**; the old figure is labelled **Allocated to activities**. No frontend arithmetic. | Header "USD 2,000,000" · Schedule "Total Budget $387,000" · Cost "Budget $225,000" → Contract value USD 2,000,000 · Activity budget $387,000 · Original $1,700,000 / Approved changes $254,500 / Revisions $0 / Revised $1,954,500 / Allocated to activities $225,000 — identical on the Budget tab. |
| B | UX22-02 inverted forecast | Scenarios were plain multiples of budget (`0.9×`, `1.15×`) and "Most likely" was Σ per-record forecast with most records unset, so it sat below Actual. | Per record, EAC = explicit forecast when it is a forecast at completion (≥ actual), else max(budget, actual). Scenarios vary only the **cost to complete**: optimistic = actual + 0.9×toComplete, pessimistic = actual + 1.15×toComplete. `EAC ≥ Actual` holds by construction. Regression test `backend/src/services/__tests__/cost.eac.test.js` anchored on Actual 71,204.00. | Optimistic $202,500 > Most likely $66,000 < Actual $71,204 → Optimistic $155,170 ≤ Most likely $164,500 ≤ Pessimistic $178,494, all ≥ Actual $71,204. |
| C | UX22-03 raw document UUIDs | The change-order form's "Supporting Document IDs" was a text box for `ProjectDocument` ids. | `DocumentPicker` (searchable popover over the document register: reference, title, number, revision, status; chips with remove). Persists the same `ProjectDocument` ids the backend already validates. | Typing UUIDs → search "DWG" → pick "DWG-001 · rev B · approved". |
| D | UX22-04 "Raised By" free text | Free text with no link to people or parties. | `RaisedByPicker`: Project team (name + role) and Parties (company + role) groups, plus "Other / external…" free text. Persists the display name into the existing `raisedBy` column, so history is untouched. | Free text → "Sofia Lindqvist (qs)" chosen from the team; register shows the name. |
| E | UX22-05 raw actor UUIDs | Audit/approval/status events carried `actorId` only; the panels printed it. | `audit.service.listEvents` attaches `actorName` (and a missing `actorRole`) with one batched user lookup; the shared history panel and approval list render the name, **"Former user"** when the account is gone, id on hover. Regression test in `audit.service.test.js` (mutation-checked). | "Actor 61b462f3-…" → "By Sofia Lindqvist". |
| F | UX22-07 developer artifacts | Devtools were gated on `MODE === 'development'`, which is exactly what a demo on the dev server runs in. | Gated on `VITE_DEVTOOLS === 'true'` only (`.env.example` documents it); production build verified without them. | TanStack badge + devtools buttons visible → absent on the dev server and in the build. |
| G | UX22-13 "Session expired!" on sign out | The global 401 handler fired after the deliberate sign-out cleared the session. | The 401 toast is skipped when nobody is signed in; the sign-out dialog shows **"Signed out"**. A real 401 while signed in still says "Session expired!". Regression: `frontend/e2e/35-sign-out-messaging.spec.ts` (both messages). | Red "Session expired!" → "Signed out". |
| H | UX22-06 "transparent" menus | **Not a defect.** Measured live: `bg rgb(255,255,255)`, `opacity 1`, `z-index 50`; the audit screenshot was taken mid fade-in. Today's screenshots reproduce the artefact (menu and dialog overlapping during the 150 ms animation). Downgraded with evidence; no code change. | — |
| I | UX22-12 demo residue | Playwright suites create projects, items, warehouses, companies and orders inside the demo organisation and never clean up. | `backend/scripts/demo/archive-e2e-residue.js`: dry-run by default, marker-scoped (fixture names + run tokens, `E2E`/`CX`/`DUPA`, auto-numbered receipt items traced to suite orders, suite vocabulary), refuses protected ids, reversible status changes only. See §4. | Workspace "383 projects" / Inventory 269 items, $14.58M stock → 2 active projects / 7 items, $561k stock; Riverside 70 open suite orders cancelled. |
| J | UX22-10 registry deep links | The audited `/cost-codes` URL was wrong; the registries live under `/company/*`. | Verified every registry by direct URL, refresh and new tab; added canonical redirects `/cost-codes`, `/vendors`, `/directory` → `/company/…`; a wrong URL inside the signed-in shell now shows the branded 404 page instead of the router's bare "Not Found". | 404 → redirect / branded not-found. |
| K | UX22-08 / UX22-09 quick actions + Procurement | No global create; Procurement behind "More". | Workspace **Quick actions** (New RFI / New change order / New direct cost / New task) with a remembered project, gated by `canPerform(role, module, 'create')`; they deep-link with `?new=` into the existing dialogs. Procurement is a first-class module after Commercial. | See click rebaseline (§7). |
| — | Found during 22A | Add Change Order dialog could not scroll on short screens (Create/Choose documents unreachable); RFI detail rendered an untitled dialog while loading (console error); header printed "· —" when duration is unset. | Dialog `max-h-[92vh] overflow-y-auto`; titled loading state; conditional duration. | Fixed. |

## 2. Budget terminology mapping (applied)

| Screen | Current label | Source | Meaning | Authoritative source | New label |
| --- | --- | --- | --- | --- | --- |
| Project header | "USD 2,000,000" (unlabelled) | `project.contractValue` | Contract sum with the client | Project record | **Contract value USD 2,000,000** |
| Schedule dashboard | "Total Budget $387,000" | `revision.totalBudget` | Σ activity budgets on the approved schedule revision | Schedule revision | **Activity budget — on this schedule revision** |
| Cost Overview | "Budget $225,000" | Σ `costRecord.budget` (approved activity allocations) | Budget carried on activity cost records | Activity cost records | **Allocated to activities** |
| Cost Overview | — (absent) | `budget.service.listBudgetLines().summary.totals.originalBudget` | Approved starting budget | Budget register | **Original budget** |
| Cost Overview | — (absent) | `…totals.approvedChanges` | Approved change orders | Budget register | **Approved changes** |
| Cost Overview | — (absent) | `…totals.revisions` | Approved budget revisions and transfers | Budget register | **Revisions & transfers** |
| Cost Overview | — (absent) | `…totals.revisedBudget` | Original + approved changes + revisions | Budget register | **Revised budget** |
| Cost Overview | "Committed" | Σ executed commitments | Executed subcontracts and purchase orders | Commitments | **Committed — executed subcontracts and purchase orders** |
| Cost Overview | "Actual" | Cost ledger | Posted to the cost ledger to date | Ledger | **Actual cost** |
| Cost Overview | "Forecast" (Σ record forecasts) | `eac.mostLikely` | Estimate at completion on activity cost records | Cost service | **Forecast (EAC) — on activity cost records, never below actual** |
| Budget tab | "Forecast" | Σ line forecasts (unset line → its revised budget) | Forecast of every budget line | Budget register | **Forecast (budget lines)** |
| Budget tab | Original / Approved changes / Revisions / Revised | register totals | as above | Budget register | unchanged — now identical to Cost Overview |

The two forecasts differ by basis (four activity cost records vs. eight budget lines) and are now labelled by basis; the four budget figures are the same numbers on both screens because they come from the same service call.

## 3. Forecast logic

`estimateAtCompletion(record) = forecast if forecast ≥ actual and forecast > 0, else max(budget, actual)`;
`toComplete = max(0, Σ EAC − Σ actual)`; scenarios = `actual + {0.9, 1.0, 1.15} × toComplete`. A project spent past every forecast reports EAC = Actual and a zero cost to complete. Three Jest cases cover ordering, the 71,204 anchor and the register pass-through; the summary also exposes `eac.basis`, `eac.actual`, `eac.toComplete` so the cards can explain themselves.

## 4. Demo-data strategy (residue isolation)

Classification applied to the demo organisation "OctaPM Demo Contracting":

| Class | Rule | Action |
| --- | --- | --- |
| CERTIFIED PHASE 21 DATA | project `0ce999f2…` and anything on it | never touched (the script refuses if it ever appears in a change set) |
| VALID DEMO DATA | Riverside Tower fixture, its seeded orders `PO-0001/2`, Central Warehouse, Riverside Site Store, seeded items and companies | kept |
| AUTOMATED TEST RESIDUE | fixture project names + run token (`Spine UI mtsrgot5` …), `GREENFIELD REGRESSION …`, `OCTA PHASE21 ISOLATION …`; items/warehouses/companies carrying `E2E`/`CX`/`DUPA` or a run token (a base-36 timestamp with a digit; a digit-less token only beside suite vocabulary such as "Beta Facades"); items on residue projects; receipt-numbered items (`PO-xxxxxxxx`) whose order line belongs to a suite order (run token, `21-procurement-lifecycle` signature, self-named order, or residue project); Riverside orders by a suite — never received → cancelled, received or partly received → closed (deliveries and stock movements kept; they otherwise fill the Match tab's 100-order window and push the seeded orders out) | archived / set inactive / cancelled / closed — status changes, reversible, nothing posted to the ledger |
| UNKNOWN | anything matching no marker | listed, left alone |

Applied locally: 381 projects (earlier pass) + 262 items + 72 warehouses + 287 companies archived/inactive, 70 Riverside open suite orders cancelled, then 186 received suite orders closed; a re-run reports "nothing to do". The Phase 21 gate was re-proven after each application (snapshot 36/36, Actual 71,204.00, delta 0.00). Three full Playwright runs on one database re-created a small residue each time (18 items, 3 stores, 27 companies, 12 open orders), and the accumulated received orders made the inventory spec's seeded-order case fail once — the suites are not idempotent on a shared database. Durable fix recommended: suites that create records in the demo organisation should create them in a dedicated e2e organisation, as the isolation suites already do; until then, run the script before a demo and before a full suite run.

## 5. Data reuse (change orders)

Raised By: Project team (from the project team API) + Parties (project parties API) + "Other / external" free text; the chosen display name is stored in the existing column, so old records read exactly as before. Supporting documents: register search by reference/title/number/revision/status; only register documents with an uploaded revision can be attached (the backend links `ProjectDocument` rows), and the empty state says so. Residual: workflow attachments (RFI instructions, letters) are not register documents, so a change order cannot cite them through the picker (P2, see §10).

## 6. Presentation

Names instead of UUIDs on every audit/approval/status feed (shared component); "Former user" fallback; devtools flag; "Signed out"; opaque menus confirmed by measurement; branded 404 inside the shell; scrollable change-order dialog; titled loading dialog; no "· —" in the header.

## 7. Click rebaseline (from Workspace Control, PM) — recorded in OCTAPM_PHASE22_CLICK_MATRIX.md

| Task | Before | After | Δ |
| --- | :-: | :-: | :-: |
| Create RFI (full form) | 8 | 2 | −6 |
| Create Change Order | 6 | 2 | −4 |
| Create Direct Cost | 6 | 2 | −4 |
| Create Task | 3 | 2 | −1 |
| Reach Procurement (from a project) | 3+ | 1 | −2 |
| Issue Material · Receive Goods · Approve Timesheet · Certify Pay App · Raise NCR · Find a Document | unchanged | unchanged | 0 |

## 8. Persona login pass (browser, one session each)

| Persona | Account | Landing | Certified project | Quick actions shown | Leaked actions |
| --- | --- | --- | --- | --- | --- |
| PM | Dana Okafor | Workspace Control | all modules incl. Procurement first-class | RFI · Change · Direct cost · Task | none |
| Planner | Ravi Menon | Workspace | modules incl. Schedule | RFI · Task | none |
| QS | Sofia Lindqvist | Workspace | Commercial, Cost | Change · Direct cost | none |
| Cost Controller | Tomás Herrera | Workspace | Cost Overview budget block | Direct cost | none |
| Procurement | Amina Bello | Workspace | Overview, Schedule, Commercial, Procurement, Quality, Doc Control, Meetings, BOQ, BIM | none (row hidden) | none |
| Warehouse | Jonas Weber | Workspace → Inventory | Overview, Schedule, Procurement, Quality, Doc Control… | none (row hidden) | none |
| Site Engineer | Priya Raman | Workspace | Doc Control / RFI | RFI · Task | none |
| Finance | Grace Mbeki | Workspace → Pay applications | Commercial pay apps ($54,000 paid, $6,000 retention, names not UUIDs) | none (row hidden) | none |
| Quality | — | **not supported**: the product has eight roles and no Quality account/role; quality work is done by Site Engineer/PM | | | |
| Client / Owner / Subcontractor | — | **not supported** (no persona accounts; not faked) | | | |

## 9. Two-session propagation (Riverside, independent browser contexts, product UI only)

| Chain | Step | Result |
| --- | --- | --- |
| RFI | site engineer raises → PM register (no refresh) | **REALTIME** (485–550 ms) |
| RFI | PM replies and closes → site engineer register (no refresh) | **REALTIME** (11–60 ms) |
| Change order | QS creates (Raised By from team) → PM register (no refresh) | **REALTIME** (0.5–1.1 s) |
| Change order | PM approval | **NOT REACHED**: the product's readiness gate ("Needs proof" = affected activities + evidence documents + both impact summaries) blocks submission, and Riverside has no register documents with a file to attach. Correct business behaviour, not a propagation fault; approved-change propagation is evidenced on the certified project (Approved VOs $254,500 → Cost Overview and Budget tab). |
| Direct cost | PM records, submits and approves ($750) → cost controller's Cost Overview "Actual cost" (no refresh) | **REALTIME** (3 ms): $34,712,564 → $34,713,314 |

Script: `scratchpad/p21/two-session.mjs` (Playwright, two contexts, three personas); four runs, same classifications.

## 10. Connected-system recheck

| Chain | Evidence | Status |
| --- | --- | --- |
| Change order → revised budget / cost / forecast / dashboard / audit | certified project: Approved VOs $254,500 = Approved changes on Cost Overview and Budget tab; CO history shows actor names; two-session create REALTIME | CONNECTED (allocation to a budget line still manual — UX22-17, unchanged) |
| Procurement award → PO → receipt → inventory → match | certified project: 3 POs, invoiced $1,700, committed $1,650; snapshot checks 36/36 | CONNECTED |
| Inventory issue → stock / ledger / Actual | snapshot "stock left is 150 less the 64 issued" = 86 ✓; Actual 71,204 reconciles SQL = API | CONNECTED |
| Subcontract certification → Actual / retention / payment / cash flow | pay app SC-001-PA01 paid $54,000, retention $6,000; reconciliation delta 0.00 | CONNECTED |
| Timesheet approval → labour / ledger / Actual | snapshot lines (labour $2,000 on 01-100) reconcile | CONNECTED |
| RFI answer → status / responsibility / Needs You / audit | two-session REALTIME; "My open items" empties after closure | CONNECTED |

## 11. Financial reconciliation (hard gate)

Snapshot 36/36 · source lines 16/16 · Actual-cost delta 0.00 (SQL) / 0.00 (API) / 0.00 (SQL vs API) · Actual anchor 71,204.00 — run after the residue archive and again after the full test run. No expected number was changed.

## 12. Tests and gates

| Gate | Result |
| --- | --- |
| Backend Jest (full) | 192 suites, **2,182 passed**, 0 failed |
| Targeted backend | cost.eac (3, new), audit.service (5, 1 new, mutation-checked), cost/audit route suites |
| Playwright (full, retries 0) | *(see §12a below, filled from the run log)* |
| Sign-out spec 35 | 2/2 |
| Console gate (spec 30) | 3/3, 0 errors / 0 warnings |
| Frontend typecheck | `tsc -b` exit 0 |
| Production build | *(§12a)* — devtools absent |
| Lint (touched frontend files) | 0 errors (5 pre-existing warnings in files I touched, unchanged) |
| Backend lint | no ESLint config in `backend/` (pre-existing); `node --check` on every touched file |
| Git | clean after commit; local/remote 0 0 |

### 12a. Run-log figures

| Run | Figures |
| --- | --- |
| Backend Jest, full (`--maxWorkers=4`) | 192 suites, 2,182 tests, 0 failed, 57.7 s |
| Playwright, full, first pass (retries 0) | 165 tests: 164 passed, 1 failed — spec 35 case 2 hit a strict-mode locator because several requests answered 401 together and each raised its own "Session expired!" toast. Fixed by giving the toast one id (one toast however many 401s) and asserting exactly one; the spec then passed 3× in a row. |
| Playwright, full, second pass (retries 0) | 165 tests: 164 passed, 1 failed — `12-client-billing` timed out waiting for the sign-in page to render (blank document at 20 s under the 17-minute load); the spec passed 7/7 on immediate rerun. No product or test change. |
| Playwright, full, third pass (retries 0) | 165 tests: 164 passed, 1 failed — `11-inventory` "the dashboard names the rows behind every number": the ranked variance row was found by item name, and three suite runs had numbered three more "Anodised panel, 3mm" items, so the first row by name was not the API's row. The spec now finds the row by SKU (a precision, not a weakening). The same spec's seeded-order Match case then showed that 186 received suite orders had pushed `PO-0002` out of the Match tab's 100-order window; the residue script now closes received suite orders (deliveries kept), after which the spec passed 11/11. |
| Playwright, full, fourth pass (retries 0) | 165 tests: 164 passed, 1 failed — `13-purchase-orders` "a delivered order reads as delivered": it took the newest fully received order on Riverside, which the residue script had just closed, and "closed" is that order's own state. The spec now looks at the seeded `PO-0002` (its own comment names it), else any received order still open. |
| Playwright, full, fifth pass (retries 0), after running the residue script | **165 tests: 165 passed, 0 failed, 16.2 min** — the gate. |
| Console gate (spec 30) | 3/3, 0 errors, 0 warnings |
| Frontend typecheck | `tsc -b` exit 0 |
| Production build | `vite build` exit 0, 345 assets, PWA precache 360 entries (4,776 KiB); no devtools bundle in `dist/assets` |
| Lint, every touched frontend file (33 files) | 0 errors, 4 warnings (all pre-existing: two set-state-in-effect, two useMemo dependency notes) |
| Financial gate after the full run | snapshot 36/36 · 16/16 source lines · delta 0.00 (SQL) / 0.00 (API) / 0.00 (SQL vs API) |

Five full passes were needed to reach a clean one: one real defect in the new spec (fixed in the product — one toast per burst of 401s), one transient (sign-in page not rendered within 20 s under load, passed on immediate rerun), and two spec assumptions that the accumulated suite residue on a shared database broke (fixed by precision, not by loosening: a row found by SKU, the seeded order read by name). Each is recorded above with its cause.

## 13. Remaining P2 / P3 (recorded, not fixed)

| ID | Sev | Item |
| --- | :-: | --- |
| UX22-11 | P2 | "Committed" still means PO value in Procurement and executed commitments in Cost (Cost card now qualified; Procurement wording unchanged). |
| UX22-17 | P2 | Approved change value sits on a holding budget line pending a manual transfer (backend allocation design; out of scope). |
| 22A-P2-01 | P2 | Workflow attachments (RFI instructions, letters) are not register documents, so the change-order picker cannot cite them; a change order's "Needs proof" therefore needs a register document with a file. |
| UX22-14 | P3 | Cost landing has no chart/trend (budget block and EAC cards added). |
| UX22-15 / UX22-16 | P3 | Category free text; "Not configured on this server" copy. |
| 22A-P3-01 | P3 | Direct-cost dialog labels are not linked to their inputs (screen readers, `getByLabel`). |
| 22A-P3-02 | P3 | Every full reload logs a 401 for `/auth/me` before the refresh-token path recovers (console noise, invisible to users). |
| 22A-P3-03 | P3 | 437 directory companies without residue markers remain (UNKNOWN class); the vendors page caps at 500 rows. |
| 22A-P3-04 | P3 | No quick action for the Procurement or Warehouse personas (candidate list was RFI/Change/Direct cost/Task); the row is hidden for them. |

## 14. Module scores (re-scored, see OCTAPM_PHASE22_CLIENT_SCORECARD.md)

Workspace 4.6 · Doc Control/RFI 4.8 · Procurement 4.2 · Schedule 4.0 · Inventory 4.1 · Commercial 4.1 · Quality 3.7 (untouched, provisional) · Settings/Admin 3.6 · Cost Control 4.1 — **overall 4.1 / 5** (target 4.5 not met; Quality and Settings/Admin were outside the 22A scope and are reported as they are).

## 15. Demo-readiness checklist

| Question | Answer |
| --- | --- |
| Can a PM log in, open a project, and understand the budget in under a minute? | Yes — one budget block, one vocabulary, the same figures on Cost Overview and Budget. |
| Can a client see one consistent budget picture? | Yes (Original / Approved changes / Revisions / Revised; Contract value and Activity budget named as what they are). |
| Are forecast scenarios credible? | Yes — ordered, all ≥ Actual, explained on the cards. |
| Can a user create a change order without typing IDs? | Yes — Raised By and documents are pickers. |
| Do audit trails show names? | Yes — "By Sofia Lindqvist"; "Former user" when an account is gone. |
| Are developer artifacts hidden? | Yes — flag-gated; absent on the dev server and in the build. |
| Is logout messaging correct? | Yes — "Signed out"; expired sessions still say so. |
| Are dropdowns readable? | Yes — measured opaque; the earlier finding was a screenshot artefact. |
| Is demo residue isolated? | Yes — 2 active projects, 7 items, 3 warehouses; script re-runs idle. |
| Do registries load by direct URL and refresh? | Yes — plus new-tab and short-URL redirects. |
| Can two users see each other's changes? | Yes — REALTIME on RFI, change-order creation and direct-cost approval. |
| Do financials reconcile? | Yes — delta 0.00, anchor 71,204.00. |

## 16. Verdict

**CONDITIONAL FOR CLIENT DEMO** — ready on the demo path (login → workspace → project → budget → forecast → change order → RFI → procurement → inventory) with the residue script run beforehand; the conditions are the recorded P2s (the "Committed" wording in Procurement, the change-order proof needing a register document, holding-line allocation) and the modules not touched in this phase (Quality, Settings/Admin).

**CONDITIONAL FOR EXTERNAL PILOT** — unchanged from Phase 22: the P2 list above and the durable residue fix (dedicated e2e organisation) should land before outside users work in the demo organisation.
