# OCTAPM PHASE 22 — RECOMMENDED CHANGES

Findings grouped by **root cause** so fixes solve families of issues, not one screen at a time.
Nothing here is implemented — this is the proposed programme for approval (see the FINAL_REPORT verdict).
Effort is a rough T-shirt size; impact is client-facing weight.

---

## R1 — Ship a clean client build (root cause: dev artifacts + placeholder copy)
**Fixes:** UX22-07 (TanStack devtools + badge), UX22-16 ("Not configured on this server"), UX22-05 &
audit UUIDs, UX22-13 ("Session expired!" on sign-out).
**Do:** strip devtools/badges from production build; resolve actor ids to names in all audit/status
feeds; replace "Session expired!" with "Signed out"; hide or soften unconfigured-feature controls.
**Impact:** High (removes the biggest "unfinished tool" tells). **Effort:** S.

## R2 — One budget vocabulary (root cause: inconsistent financial terminology/labels)
**Fixes:** UX22-01 (three "budget" figures), UX22-11 ("Committed" overloaded).
**Do:** define and label a single glossary — Contract Value, Original Budget, Revised Budget, Committed
(PO), Committed (Subcontract/Total), Actual, Forecast — and use the exact same label + number wherever
each appears (header, Schedule, Cost, Procurement, Commercial). Add one-line definitions on hover.
**Impact:** High (a cost-focused client will lose trust otherwise). **Effort:** M.

## R3 — Fix the cost forecast presentation (root cause: scenario logic/labelling)
**Fixes:** UX22-02 (Optimistic > Most Likely; Most Likely < Actual), UX22-14 (sparse cost landing).
**Do:** correct or relabel the optimistic/most-likely/pessimistic scenario so ordering is monotonic and
never below Actual-to-date; enrich the Cost Overview landing with a cost-code breakdown and a trend.
**Impact:** High. **Effort:** M.

## R4 — Reference, don't retype (root cause: free-text where a picker should exist)
**Fixes:** DR-1/UX22-03 (Document IDs), DR-2/UX22-04 (Raised By), DR-3/UX22-15 (Category),
DR-4 (duplicate item masters).
**Do:** replace "Supporting Document IDs" with a document picker; "Raised By" with a user picker;
"Category" with a controlled list; add duplicate-detection/"use existing" prompts to item create.
Reuse the reference-selector components already used well in the New RFI form.
**Impact:** High (typing UUIDs is a hard blocker for real users). **Effort:** M.

## R5 — Workspace quick-create + first-class Procurement (root cause: action placement / IA)
**Fixes:** UX22-08 (no quick-create), UX22-09 (Procurement behind "More").
**Do:** add a global "New…" launcher and make KPI/queue tiles actionable (not navigate-only); promote
Procurement to the primary module bar. Removes ~2 clicks from most high-frequency creates and a hunt
for procurement.
**Impact:** High (touches every day-one action). **Effort:** M.

## R6 — Deep-linkable registries (root cause: settings/registry routing)
**Fixes:** UX22-10 (`/cost-codes` direct-URL 404), findability of org registries.
**Do:** make org registries (cost codes, vendors, directory, users, permissions, custom fields) resolve
by direct URL and reachable from a clear Admin/Company entry point in the top nav.
**Impact:** Medium. **Effort:** S–M.

## R7 — Menu/overlay polish (root cause: dropdown styling)
**Fixes:** UX22-06 (semi-transparent dropdowns overlapping content).
**Do:** give module dropdowns a solid opaque surface + correct z-index/backdrop.
**Impact:** Medium (visible in every navigation). **Effort:** S.

## R8 — Demo-data hygiene (root cause: e2e/seed residue in shared data)
**Fixes:** UX22-12 (Procurement Risks 408, "Aggregate DUPA", $18.7M stock).
**Do:** provide a clean, curated demo dataset (or a demo-mode filter that hides e2e residue) before any
client session; separate test tenants from the demo tenant.
**Impact:** High for demos. **Effort:** S–M.

## R9 — Close the change-order → budget-line connectivity gap (root cause: allocation not carried)
**Fixes:** UX22-17 / P21-012 (approved change value sits on a holding line).
**Do:** carry `budgetLineId`/cost-code allocation from the change order through approval so revised
budget lands on the right line without a manual transfer. (Product/back-end change — schedule
deliberately, with reconciliation checks, as in Phase 21.)
**Impact:** Medium–High. **Effort:** M–L.

## R10 — Per-persona landing & client/owner portal (root cause: single PM-shaped workspace)
**Fixes:** PERSONA_JOURNEYS gaps; client/owner login not confirmed.
**Do:** confirm/design a purposeful landing per persona (task-first for Site Engineer, queue-first for
approvers) and decide whether an external Client/Owner read-only portal is in pilot scope.
**Impact:** Medium–High (depends on pilot audience). **Effort:** L.

---

## Sequencing proposal

- **Wave A (before any client demo) — mostly S:** R1, R7, R8, and the copy half of R2. Removes the
  "unfinished tool" tells and cleans the demo. Low risk, high perceived quality.
- **Wave B (before external pilot) — M:** R2 (numbers), R3, R4, R5, R6. Fixes the trust-damaging
  financial inconsistencies, the retype gaps, and the day-one click friction.
- **Wave C (pilot hardening) — M/L:** R9, R10. Connectivity completeness and audience-fit.

## Guardrail

None of these should reopen the Phase-21 financial guarantees. R9 in particular must be built with the
same reconcile-and-regression discipline (Actual stays ledger-derived; snapshot 36/36; delta 0.00).

---

## Phase 22A status (2026-09-15)

| Rec | Status | What landed |
| --- | --- | --- |
| R1 Clean client build | DONE | devtools flag-gated (`VITE_DEVTOOLS`), production build verified; "Signed out" wording; "Not configured on this server" copy left (UX22-16, P3). |
| R2 One budget vocabulary | DONE | Contract value · Activity budget (schedule revision) · Allocated to activities · Original / Approved changes / Revisions & transfers / Revised budget — one backend source; Budget tab and Cost Overview agree. |
| R3 Forecast presentation | DONE | EAC = actual + cost to complete; scenarios ordered and ≥ Actual; regression test. |
| R4 Reference, don't retype | DONE (change order) | Raised By picker, document picker; Category still free text (P3). |
| R5 Quick-create + Procurement | DONE | Workspace quick actions (RFI / Change / Direct cost / Task, role-gated, `?new=` deep links); Procurement first-class. |
| R6 Deep-linkable registries | DONE | Verified direct URL / refresh / new tab; short redirects; branded 404 in the shell. |
| R7 Menu polish | NOT NEEDED | Menus measured opaque; finding downgraded. |
| R8 Demo-data hygiene | DONE (script) · OPEN (durable) | `archive-e2e-residue.js` applied locally and documented; dedicated e2e organisation for the suites still recommended. |
| R9 Change order → budget line | OPEN | Out of 22A scope (backend allocation design, UX22-17). |
| R10 Per-persona landing / client portal | OPEN | Wave C, not started (as instructed). |
