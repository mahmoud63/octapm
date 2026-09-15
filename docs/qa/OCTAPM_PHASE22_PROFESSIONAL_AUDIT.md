# OCTAPM PHASE 22 — PROFESSIONAL PRODUCT AUDIT

Reviewed as if demonstrating to a paying construction client. Live pass as Project Manager across
Workspace Control, Schedule, Cost Control, Commercial, Procurement, Doc Control, Inventory, Settings.

Rating per attribute: **CLIENT-QUALITY** · **ACCEPTABLE** · **NEEDS WORK** · **NOT CLIENT QUALITY**.

---

| Attribute | Rating | Notes |
| --- | --- | --- |
| Navigation consistency | ACCEPTABLE | Consistent module bar + dropdown pattern; but Procurement hidden behind "More", and dropdowns needed vs. one-click tabs. |
| Terminology consistency | NEEDS WORK | "Committed" overloaded (PO vs commitment); "Budget" means 3 different figures across screens. |
| Page titles / context | CLIENT-QUALITY | Project name, dates, status, contract value in a persistent header. |
| Breadcrumbs | ACCEPTABLE | Module bar conveys location; no explicit breadcrumb trail. |
| Project identity visibility | CLIENT-QUALITY | Always in the header + switcher. |
| Module / record identity | CLIENT-QUALITY | Active tab highlighted; records carry ref + title (RFI-001, VO-22, PO-00001, SC-001-PA01). |
| Status clarity | CLIENT-QUALITY | Badges + plain-language ("Awaiting finance", "closed", "Fully invoiced"). |
| Primary action placement | ACCEPTABLE | "New RFI", "Add Change Order", inline "Issue"/"Add" are visible; workspace lacks quick-create. |
| Confirmation / danger dialogs | CLIENT-QUALITY | Sign-out confirm; approval decisions confirmed. |
| Form layout | CLIENT-QUALITY | New RFI form is well-structured with hints; two-column commercial forms are clean. |
| Required-field indication | ACCEPTABLE | Placeholders/hints present; explicit required markers not verified everywhere. |
| Units / currency / dates | ACCEPTABLE | Currency formatted ($, USD); dates mm/dd/yyyy (US) — confirm locale for non-US clients. |
| Table alignment / sorting / filtering | CLIENT-QUALITY | Sortable, filterable lists; saved views on RFI; CSV export. |
| Search | CLIENT-QUALITY | Global Cmd+K + per-module search + document content search. |
| Pagination | ACCEPTABLE | Lists paginate; some registers are long (see demo-data). |
| Empty states | CLIENT-QUALITY | "Nothing is waiting on you right now", "No projects yet" with a CTA. |
| Loading states | ACCEPTABLE | "Loading module…" skeletons; code-split chunks load on first module open. |
| Error states | ACCEPTABLE | Clear 404 page; validation present. Sign-out mislabelled "Session expired!". |
| Success states | CLIENT-QUALITY | "Welcome back, Dana Okafor!", action toasts. |
| Responsive behaviour | NOT VERIFIED | Not tested at mobile/tablet this pass. |
| Print / export / PDF quality | NOT VERIFIED | CSV export present; PDF/print appearance not opened this pass. |
| Audit information | ACCEPTABLE | Rich status-history feeds with source, reason, attachment — **but actor shown as raw UUID**. |
| Ownership / responsibility display | CLIENT-QUALITY | Ball-in-court everywhere; "Waiting on me"; "My open items". |
| Needs You / ball-in-court semantics | CLIENT-QUALITY | User-matched, consistent, plain-language. |
| Dashboard usefulness | CLIENT-QUALITY (content) / NEEDS WORK (data hygiene) | PM cockpit is excellent; numbers inflated by e2e residue. |

## Feels like a developer / internal / unfinished tool

- **TanStack Router/Query devtools and a "TanStack Router" badge are visible in the running app** — the
  single most "not shipped yet" signal for a client demo. (UX22-07)
- **Raw UUIDs surfaced to users** in the change-order audit ("Actor 61b462f3-…"). (UX22-05)
- **"Not configured on this server"** language in the New RFI AI control. (UX22-16)
- **Typing raw "Document IDs"** in the change-order form. (UX22-03)
- **Semi-transparent dropdown menus** overlapping content. (UX22-06)
- **e2e residue** in item names ("Aggregate DUPA …") and inflated portfolio numbers. (UX22-12)

## Genuinely client-quality today

- The **PM Workspace Control cockpit** (KPIs with drill-through, user-matched action queues,
  7-dimension health, watchlist) is a strong, professional first impression.
- **Ball-in-court / plain-language workflow status** across RFI, PO, pay apps.
- **Well-designed create forms** with reference selectors and helpful copy.
- **Connected financials** — Actual = cost ledger to the cent.
- **Consistent visual system**, empty/loading/success states, global + content search.

## Overall presentation verdict

**ACCEPTABLE, trending CLIENT-QUALITY, held back by a short list of "unfinished-tool" tells.** The
information architecture and workflow semantics are professional; what undermines the demo is presentation
hygiene (devtools in build, raw UUIDs, transparent menus, "Document IDs", inconsistent budget/committed
figures, illogical cost scenarios) and demo-data cleanliness — all fixable without re-architecture.

---

## Phase 22A update (2026-09-15)

| Finding | Status | Now |
| --- | --- | --- |
| Developer artifacts in the running app (UX22-07) | FIXED | Devtools only when `VITE_DEVTOOLS=true`; absent on the dev server a demo runs from and in the production build. |
| Raw actor UUIDs (UX22-05) | FIXED | Names on every audit, approval and status feed through the shared panel; "Former user" fallback; id on hover. |
| "Session expired!" on sign out (UX22-13) | FIXED | "Signed out"; the warning is kept for a genuine 401 while signed in (spec 35). |
| Semi-transparent dropdown menus (UX22-06) | NOT A DEFECT | Measured opaque (`rgb(255,255,255)`, opacity 1, z-index 50); the screenshots caught the fade-in. |
| Three "budget" numbers (UX22-01) | FIXED | One vocabulary — Contract value, Activity budget (schedule revision), Allocated to activities, Original / Approved changes / Revisions / Revised budget — from one backend source. |
| Inverted forecast (UX22-02) | FIXED | Ordered scenarios, all ≥ Actual, each card says what it varies. |
| Demo residue (UX22-12) | FIXED | Workspace shows 2 active projects, Inventory 7 items and 3 stores; residue archived by explicit marker, reversible. |
| Sparse cost landing (UX22-14) | PARTIAL | Budget block and EAC cards; no chart yet. |
| Found this phase | FIXED | Change-order dialog scrolls on short screens; RFI detail titled while loading (no console error); branded 404 inside the shell; no "· —" in the header. |

## Phase 22B update (2026-09-15)

Driven as every internal persona on the E2E organisation and as the PM on the demo organisation.

- **Raw IDs and enums:** the change-order status badge now reads "Pending approval" (was `pending`);
  team and People roles read "Quality Engineer" (was `quality_engineer`); company type reads
  "Owner / client". No raw UUID is shown to a normal client on any screen driven.
- **Test data in client-facing views:** Directory 644 to 7 active companies; Workspace "7 visible
  projects / 273 procurement risks" to 2 / 7; the demo Riverside Tower is a clean reseed (2 orders,
  1 commitment, 0 pay applications, 4 budget lines). What remains: the archived original fixture
  (hidden) and the certified Phase 21 project's run-stamped party names (frozen by design).
- **Dead ends:** roles without user-management read no longer see "Users"; a URL to a hidden
  sub-tab lands on the first offered one; the persona certification in the 22B report records the
  403 and console-error count per persona.
- **Dates and currency:** registers use the UTC short date (no day shift); inventory KPIs are USD.
- **Empty states:** Procurement packages ("Nothing to buy yet: create one from a material
  requirement"), punch list, pay applications and locations all explain the next step.
- **Still cosmetic (P3):** the bidder portal's browser confirm box on withdrawal; the esbuild
  deprecation notice in the production build log (tooling, not product).
