# OCTAPM PHASE 22 — CLICK MATRIX

Browser interaction cost for major tasks. Measured live as Project Manager unless noted.
Clicks count meaningful mouse interactions. Two figures are given where useful:
**WS→ (from Workspace Control landing)** and **CTX→ (from the relevant module already open)**.

Targets: high-frequency ≤ 3 from context · normal record action ≤ 5 after reaching the module ·
complex commercial workflows may exceed this when each click is a real business decision.

`M` = measured live this pass · `E` = estimated from the observed, consistent navigation pattern
(module button → sub-tab is 1–2 clicks; create is +1) — flagged for a follow-up measured pass.

---

## Navigation baseline (measured)

| Step | Clicks | Notes |
| --- | --- | --- |
| Workspace → open a project | 2 (M) | "Select project" combobox (1) + pick project (1). No project tile/quick-open on the KPI cards. |
| Project → any module sub-tab | 2 (M) | module button (1) + sub-tab in dropdown (1). Leaf modules (Site Reporting, Meetings, BOQ, BIM, Overview) = 1. |
| Reach Procurement module | 3+ (M/E) | not on the primary module bar; reached via the **"More"** overflow, or by URL. Findability cost. |

## High-frequency actions

| Feature | Persona | Start | Clicks | Typed | Screens | Dup entry | Result | UX | Note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create RFI (full form) | Site Eng/PM | WS | 8 (M) | 2 min | 3 | No | PASS | GOOD | WS→project 2 + DocControl 1 + RFI 1 + New RFI 1 + Subject/Question + Submit 1. CTX→ = 4. |
| Create RFI (inline quick-add) | Site Eng/PM | RFI tab | 1 (M) | 1 | 1 | No | PASS | EXCELLENT | Type subject + "Add". Fastest create seen. |
| Open Change Orders register | QS/PM | WS | 4 (M) | 0 | 2 | – | PASS | GOOD | WS→project 2 + Commercial 1 + Change Orders 1. |
| Add Change Order (open form) | QS/PM | Change Orders | 1 (M) | – | 1 | Partial | PASS | ACCEPTABLE | Form has free-text "Raised By" + "Document IDs" (see data-reuse). |
| Open Cost cockpit | Cost/PM | WS | 4 (M) | 0 | 2 | – | PASS | ACCEPTABLE | WS→project 2 + Cost Control 1 + Overview 1. Sparse page. |
| Open Purchase Orders | Procurement | WS | 5 (E) | 0 | 2 | – | PASS | ACCEPTABLE | Procurement is behind "More"; +1 vs. a first-class module. |
| Issue material (from Inventory Items) | Warehouse | Inventory | 2+ (M/E) | few | 1–2 | No | PASS (E) | GOOD | Inline "Issue" button per item row. |
| Open my action queue ("My open items") | Any | WS | 0 (M) | 0 | 1 | – | PASS | GOOD | On the workspace landing; user-matched. |

## Normal record actions

| Feature | Persona | Start | Clicks (CTX→) | UX | Note |
| --- | --- | --- | --- | --- | --- |
| Open an RFI detail | any | RFI tab | 1 (M) | GOOD | "Details" / "Open" per row. |
| Answer RFI / advance ball | Planner/PM | RFI detail | 3–4 (E) | – | assessed from record actions; measure next pass. |
| Approve Change Order | PM | CO detail | 2–3 (E) | – | decision click + confirm; business-justified. |
| Approve subcontract pay app | PM/Finance | Pay Apps | 3–5 (E) | – | multi-step certify; business-justified. |
| Receive goods (GRN) | Warehouse | Inventory→Goods in | 4–6 (E) | – | select PO, qty, confirm. |
| Certify client valuation | QS/Finance | Pay Apps/IPC | 4–6 (E) | – | business-justified. |
| Approve timesheet | PM/Cost | Cost/Labour | 3–5 (E) | – | measure next pass. |

## Redundant-click / friction flags

- **REDUNDANT CLICK (navigation):** every create action requires entering a project first (WS→project
  = 2 clicks) because **Workspace Control exposes no global quick-create** ("New RFI", "New Task",
  "New Change") and its KPI/queue tiles are navigate-only ("Open Queue"). A "Needs You"/quick-action
  launcher would remove 2 clicks from most high-frequency creates.
- **REDUNDANT CLICK (findability):** **Procurement** is not on the primary module bar (behind "More"),
  adding a click and a hunt versus Cost/Commercial/Quality which are first-class.
- **REDUNDANT CLICK (module dropdown):** reaching a sub-tab always costs the module button **plus** the
  dropdown item; frequently-used tabs (e.g. Change Orders, Cost Overview) are never one click from the
  project header.
- **DUPLICATE ENTRY (form):** Add Change Order "Supporting Document IDs" requires typing raw document
  UUIDs, and "Raised By" is free text rather than a user picker (see DATA_REUSE_AUDIT).

## Summary

- **Measured high-frequency creates are efficient once inside a project** (RFI inline = 1 click; RFI
  full form 3 clicks to open; CO register 2 clicks from project). The dominant, systematic cost is the
  **2-click project entry from the workspace with no quick-create**, which taxes every high-frequency
  action started from the landing page.
- **Estimated average for the measured high-frequency set:** ~3–4 meaningful clicks from context,
  ~5–8 from the workspace landing. Within target from context; above target from the landing page
  because of the missing workspace quick-create.
- **Highest-click observed paths:** Add Change Order (data entry justified) and reaching Procurement
  (findability, not justified).

---

## Phase 22A rebaseline (measured live, PM, from Workspace Control)

Quick actions on the workspace (New RFI / New change order / New direct cost / New task, project
remembered) and Procurement as a first-class module change the landing-page cost of the high-frequency
creates. Counts are meaningful clicks excluding typing; "After" was measured on the dev server on
2026-09-15 with each dialog opening from the workspace in one click (`?new=` deep link).

| Task | Before (Phase 22) | After (22A) | Δ | Note |
| --- | :-: | :-: | :-: | --- |
| Create RFI (full form) | 8 (M) | 2 (M) | −6 | Quick action (1) → "Open RFI" (1). +1 if the remembered project must change. |
| Create Change Order | 6 (M) | 2 (M) | −4 | Quick action (1) → Create (1). Raised By = 2 clicks (was typing); documents = 2 clicks (was typing UUIDs). |
| Create Direct Cost | 6 (M) | 2 (M) | −4 | Quick action (1) → Create (1); lines added on the detail as before. |
| Create Task | 3 (M) | 2 (M) | −1 | Quick action (1) → Save (1). |
| Issue Material | 4 (M/E) | 4 (M) | 0 | Inventory (1) → Items (1) → Issue (1) → confirm (1). Unchanged — out of 22A scope. |
| Receive Goods | 4–6 (E) | 4–6 (E) | 0 | Unchanged. |
| Approve Timesheet | 3–5 (E) | 3–5 (E) | 0 | Unchanged. |
| Certify Pay App | 3–5 (E) | 3–5 (E) | 0 | Unchanged. |
| Raise NCR | 6 (E) | 6 (E) | 0 | Unchanged — NCR was not on the quick-action candidate list. |
| Find a Document | 4 (M) | 4 (M) | 0 | Project (2) → Doc Control (1) → search (1). Registries now also reachable by direct URL (0 clicks). |
| Reach Procurement (from a project) | 3+ (M) | 1 (M) | −2 | First-class module button after Commercial. |

**Measured average for the four quick-action creates: 5.75 → 2.0 clicks from the landing page.** The
2-click project entry that taxed every create is gone for the four highest-frequency records; the
remaining paths are unchanged and still within target from context.
