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
