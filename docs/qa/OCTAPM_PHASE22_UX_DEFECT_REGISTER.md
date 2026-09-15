# OCTAPM PHASE 22 — UX DEFECT REGISTER

Findings from the live browser audit (PM persona), classified per the Phase 22 scheme:
UX-P0 (cannot safely use) · UX-P1 (core client workflow severely confusing/broken) ·
UX-P2 (material usability inefficiency) · UX-P3 (polish). Tags: CONNECTIVITY, DUPLICATE ENTRY,
CLICK FRICTION, STALE DATA, MISSING HANDOFF, PROFESSIONAL-PRESENTATION.

All items below were **observed live this pass** unless marked otherwise. None is UX-P0.

---

| ID | Sev | Tag | Where | Finding | Evidence |
| --- | :--: | --- | --- | --- | --- |
| UX22-01 | P1 | PROFESSIONAL / CONSISTENCY | Project header vs Schedule vs Cost | The same project shows **three different "budget/value" numbers**: header "USD 2,000,000", Schedule "Total Budget $387,000", Cost Overview "Budget $225,000". A client cannot tell which is *the* budget. | Live: header, Schedule cards, Cost Overview cards. |
| UX22-02 | P1 | PROFESSIONAL / CORRECTNESS | Cost Overview scenario cards | Scenario forecast looks **inverted/illogical**: Optimistic $202,500 **>** Most Likely $66,000, and Most Likely ($66,000) is **below Actual-to-date ($71,204)**. A most-likely forecast under money already spent reads as broken. | Live: Cost Control → Overview. |
| UX22-03 | P1 | DUPLICATE ENTRY | Add Change Order | "Supporting Document IDs" requires typing **raw document UUIDs**; no document picker. Unusable by a normal user. | Live: Commercial → Add Change Order. |
| UX22-04 | P2 | DUPLICATE ENTRY | Add Change Order | "Raised By" is **free text**; should reference an existing user/contact. | Live. |
| UX22-05 | P2 | PROFESSIONAL / CONNECTIVITY | Change Order status history | Actor shown as **raw UUID** ("Actor 61b462f3-…") instead of the person's name. | Live: CO audit feed. |
| UX22-06 | P2 | PROFESSIONAL | Module dropdown menus | Dropdowns (Cost Control, Commercial, Doc Control) render with a **semi-transparent background** that overlaps the page content behind them, making items hard to read. | Live: three module menus. |
| UX22-07 | P2 | PROFESSIONAL | Whole app (running build) | **Developer artifacts ship in the running app**: a "TanStack Router" badge (bottom-right) and "Open TanStack Query/Router Devtools" buttons are present. Must not appear in a client build. | Live: every screen. |
| UX22-08 | P2 | CLICK FRICTION | Workspace Control | **No global quick-create** and KPI/queue tiles are navigate-only ("Open Queue"); every create requires entering a project first (+2 clicks). | Live: workspace. |
| UX22-09 | P2 | CLICK FRICTION / FINDABILITY | Module bar | **Procurement is not a first-class module** (behind the "More" overflow) despite being a daily module for the procurement persona. | Live: module bar + navigation. |
| UX22-10 | P2 | RELIABILITY / DEEP LINK | Registry routes | Direct URL to `/cost-codes` (a real route) returns **404**; org registries aren't reachable by direct link and their entry point isn't on the top nav. | Live: navigated `/cost-codes`. |
| UX22-11 | P2 | TERMINOLOGY | Cost vs Procurement | **"Committed" is overloaded**: Procurement shows Committed $1,650 (PO), Cost shows Committed $100,000 (commitments). Same word, different scope, no qualifier. | Live: PO tab vs Cost Overview. |
| UX22-12 | P2 | PROFESSIONAL / DEMO DATA | Workspace + Inventory | Portfolio numbers are inflated by **e2e/seed residue**: "Procurement Risks 408" is dominated by a repeated "Scaffold tube 48.3mm – Riverside – delivery overdue"; Inventory shows "Aggregate DUPA …" items and $18.7M stock value. Not a product defect, but blocks a clean client demo. | Live: workspace queues, Inventory items. |
| UX22-13 | P3 | PROFESSIONAL | Sign out | Signing out shows a **red "Session expired!"** toast rather than a neutral "Signed out" confirmation — reads as an error. | Live: sign-out. |
| UX22-14 | P3 | PROFESSIONAL | Cost Overview | The Cost "Overview" tab is **sparse** — eight numbers and a large empty area, no cost-code breakdown, trend, or chart on the default cost landing. | Live. |
| UX22-15 | P3 | DUPLICATE ENTRY | Add Change Order | "Category" is free text ("Variation, Claims, etc.") rather than a controlled list → inconsistent categorisation. | Live. |
| UX22-16 | P3 | PROFESSIONAL | New RFI form | "Draft with AI — Not configured on this server" exposes server-configuration language to end users; hide or soften when the feature is off. | Live: New RFI. |
| UX22-17 | P2 | CONNECTIVITY | Change Order → Budget | Approved change value does not carry its budget-line allocation; it sits on a holding line pending a manual transfer (P21-012, previously logged, confirmed relevant here). | Phase 21 + design. |

## What worked well (recorded for balance)

- **User confusion test — mostly PASS.** Project identity (header), module identity (active tab),
  record identity (ref + title), status (badges), ball-in-court (Responsible/Owner/Reviewer/Approver;
  "Awaiting finance/procurement"), and "what happened after I clicked" (toasts) are generally clear.
- **Ball-in-court / Needs You** is consistent and user-matched.
- **Create forms** (RFI) use reference selectors and helpful hints.
- **Plain-language workflow status** on POs and pay apps is genuinely client-grade.
- **No dead ends, blank pages, 404s, or silent failures** were hit in the driven flows (the one 404 was
  a direct-URL registry route, UX22-10).

## Classification totals (observed this pass)

| Severity | Count |
| --- | --- |
| UX-P0 | 0 |
| UX-P1 | 3 (UX22-01, -02, -03) |
| UX-P2 | 9 |
| UX-P3 | 4 |

Tag rollup: CONNECTIVITY 2 · DUPLICATE ENTRY 4 · CLICK FRICTION 2 · PROFESSIONAL-PRESENTATION 8 ·
RELIABILITY/DEEP-LINK 1 · TERMINOLOGY 1 · STALE DATA 0 observed · MISSING HANDOFF 0 observed.

---

## Phase 22A status (2026-09-15)

Every item re-checked live in the browser after implementation (PM plus the other seven personas).
Evidence and root causes are in `OCTAPM_PHASE22A_IMPLEMENTATION_REPORT.md`.

| ID | Sev | Status after 22A | Evidence |
| --- | :-: | --- | --- |
| UX22-01 | P1 | **FIXED** | Header "Contract value USD 2,000,000"; Schedule "Activity budget — on this schedule revision $387,000"; Cost Overview Budget block Original $1,700,000 / Approved changes $254,500 / Revisions $0 / Revised $1,954,500 = Budget tab; "Allocated to activities $225,000". One backend source. |
| UX22-02 | P1 | **FIXED** | Optimistic $155,170 ≤ Most likely $164,500 ≤ Pessimistic $178,494, all ≥ Actual $71,204; Jest regression anchored on 71,204. |
| UX22-03 | P1 | **FIXED** | Searchable document picker over the register (reference/title/number/revision/status), chips, no IDs typed. Residual 22A-P2-01: only register documents with a file can be attached. |
| UX22-04 | P2 | **FIXED** | Raised By picker: Project team / Parties / Other-external; history untouched. |
| UX22-05 | P2 | **FIXED** | "By Sofia Lindqvist" on CO history, pay-app history, budget history; "Former user" fallback; mutation-checked test. |
| UX22-06 | P2 | **DOWNGRADED — not a defect** | Measured: background `rgb(255,255,255)`, opacity 1, z-index 50, no transparency; the audit screenshot and two of today's caught the 150 ms fade-in mid-way. No code change. |
| UX22-07 | P2 | **FIXED** | Devtools behind `VITE_DEVTOOLS=true`; absent on the dev server and in the production build. |
| UX22-08 | P2 | **FIXED** | Workspace Quick actions, role-gated; every action opens its existing dialog in one click. |
| UX22-09 | P2 | **FIXED** | Procurement first-class after Commercial for every persona that has it. |
| UX22-10 | P2 | **DOWNGRADED + hardened** | The audited URL was wrong (`/company/cost-codes` is the route). All registries verified by direct URL, refresh, new tab; `/cost-codes`, `/vendors`, `/directory` now redirect; wrong URLs inside the shell show the branded 404. |
| UX22-11 | P2 | **OPEN** | Cost card now reads "Committed — executed subcontracts and purchase orders"; Procurement's "Committed" (PO value) unchanged. |
| UX22-12 | P2 | **FIXED** | `backend/scripts/demo/archive-e2e-residue.js` (dry-run, marker-scoped, fail-loud, reversible); Workspace 2 active projects, Inventory 7 items / 3 stores; Phase 21 gate re-proven. |
| UX22-13 | P3 | **FIXED** | "Signed out" toast; "Session expired!" reserved for a real 401; spec 35. |
| UX22-14 | P3 | **PARTIAL** | Budget block and EAC cards fill the landing; no chart/trend yet. |
| UX22-15 | P3 | **OPEN** | Category still free text. |
| UX22-16 | P3 | **OPEN** | "Not configured on this server" copy unchanged. |
| UX22-17 | P2 | **OPEN** | Holding-line allocation of approved change value (backend design; out of 22A scope). |

### Found and fixed during 22A

| ID | Sev | Finding | Status |
| --- | :-: | --- | --- |
| 22A-01 | P2 | Add Change Order dialog could not scroll on short screens — Create / Choose documents unreachable. | FIXED (`max-h-[92vh] overflow-y-auto`) |
| 22A-02 | P3 | RFI detail rendered an untitled dialog while loading (console error, screen readers). | FIXED (titled loading state) |
| 22A-03 | P3 | Wrong URL inside the signed-in shell showed the router's bare "Not Found". | FIXED (branded 404) |
| 22A-04 | P3 | Project header printed "· —" when duration is unset. | FIXED |

### Found during 22A, recorded as residual

| ID | Sev | Finding |
| --- | :-: | --- |
| 22A-P2-01 | P2 | Workflow attachments (RFI instructions, letters) are not register documents; a change order cannot cite them through the picker, and its "Needs proof" gate needs a register document with a file. |
| 22A-P3-01 | P3 | Direct-cost dialog labels are not linked to their inputs. |
| 22A-P3-02 | P3 | Every full reload logs a 401 for `/auth/me` before the refresh path recovers (console noise only). |
| 22A-P3-03 | P3 | 437 directory companies carry no residue marker (UNKNOWN class, left alone); vendors page caps at 500 rows. |
| 22A-P3-04 | P3 | No quick action exists for the Procurement or Warehouse personas; the row is hidden for them. |
