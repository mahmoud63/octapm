# OctaPM BOQ ↔ schedule integrated experience (PC-0)

What "one system" means for BOQ, schedule, progress and cost; the Project Controls navigation; the two detail views; coverage; validation. [C] = confirmed, [D] = decision.

## 1. The integrated experience in one sentence

A BOQ row, the activities that deliver it, the quantity installed, the value earned, the cost committed and actual, and the changes that touched it are one record set seen from four sides (BOQ, schedule, cost, change), grouped by the same WBS / location / cost code, and no side has a number the others cannot explain.

Today the pieces exist but are reached through separate modules: BOQ page (flat grid + allocation panel, `frontend/src/features/boq/components/boq-page.tsx:27-112`, `boq-allocation-panel.tsx:205-230`), schedule dashboard (Gantt, WBS tab only when the snapshot carried nodes, `schedule-dashboard.tsx:924-925`), cost cockpit (`cost-dashboard.tsx`), budget register, EV report, forecast panel, change orders [C]. The allocation panel edits via `window.prompt` (`boq-allocation-panel.tsx:163-185`) [C].

## 2. Project Controls navigation (§73-§74) [D]

A new sidebar group **Project Controls** under the project, replacing the scattered entries (the module ids stay so `requirePermission` modules and deep links keep working):

| Entry | Route | Backed by (exists) | New |
|---|---|---|---|
| Overview | `/o/{slug}/projects/{id}` (L3 landing) | setup readiness bar (`project-setup-wizard.tsx`), workspace-dashboard per-project health | one "controls summary" strip: BOQ total · allocated % · earned · certified · committed · actual · EAC · open exceptions, each labelled source/derived/projection |
| Structure | `…/controls/structure` | `Location` tree (`location.service.js`), `ProjectCostCode` picker (`budget.service.js:62-122`) | WBS tree editor (`WbsNode`), UoM list, package flags |
| BOQ | `…/boq` (existing module `boq`) | grid, upload, revisions, allocation panel | grouped by WBS / section / location / cost code; columns for those keys; **BOQ Detail** drawer (§3) |
| Schedule | `…/schedule/gantt` (existing) | Gantt, WBS tree, revisions, baseline | **Activity Detail** drawer (§3); WBS tree reads `WbsNode` |
| Mapping | `…/controls/mapping` | `ActivityBoqAllocation` service | matrix/coverage view, bulk mapping, suggestions (mapping doc §5-§6) |
| Progress | `…/progress` (existing) | methods, submissions, approvals | quantity entries, daily-log contributions (progress doc) |
| Cost | `…/cost` (existing) | cockpit, budget register, ledger, commitments, pay apps, direct costs | unchanged money; adds per-WBS/location roll-ups (derived) |
| Forecast | `…/forecast` (existing) | forecast panel | EAC basis selector, forecast quantity |
| Changes | `…/change-events`, `…/change-orders` (existing) | change events, RFQs, change orders | exceptions inbox and handoff (change doc) |
| Exceptions | `…/controls/exceptions` | — | the exception engines' output (change doc §5-§6) |

Permissions: existing modules (`boq`, `schedule`, `progress`, `cost`, `budget`, `change_order`, …) gate each entry; the new `controls` pages reuse `boq` read for Structure/Mapping/Exceptions (no new catalogue module — the brief forbids a parallel engine; a new module key would only be added to `shared/permissions.json` if the PO wants separate gating).

## 3. BOQ Detail and Activity Detail (§76-§77) [D]

Both are record drawers opened from any grid, written to the URL with the existing `use-record-in-url.ts` pattern so deep links and Back work.

**BOQ Detail** (`GET /projects/:id/boq/items/:itemId/detail`, one payload):

| Section | Source | Truth |
|---|---|---|
| Header: code, description, unit (typed + normalised), qty, rate, amount, section, WBS node, location, cost code, mapping rule, revision, baseline lock | `BoqItem` + new keys | source |
| Activities: each allocation (qty, amount, weight, status, actor), activity dates, pct, EV | `buildAllocationSummary` per item (`activity-boq-allocation.service.js:286-474`) | source (allocation) / derived (EV) |
| Quantities: allocated, installed (approved quantity entries), certified (`IpcItemProgressLink.certifiedQuantity`), paid (pro-rata), base commitment quantity (the quantity on each SOV line naming this item on executed/closed commitments, excluding approved variations; listed per line under the base commitment value), forecast | progress doc §4-§6 | derived / projection |
| Money: allocated, earned, certified, "Base commitment value (excluding approved variations)" (Σ SOV lines naming this item on executed/closed commitments; approved commitment change orders are not included, so it is not the committed cost — owner decision R5-3, `sections.commitments.baseCommitmentValue`), actual (ledger entries with `boqItemId` via `StockTransaction`/SOV lineage), forecast | ledger + summary | derived / projection |
| Changes: `ChangeOrderAllocationLink`, `ChangeEventLine` naming this item's activities | change doc | source |
| History: `AuditEvent` for the item and its allocations | audit service | source |
| Exceptions on this item | exception engine | derived |

**Activity Detail** (`GET /projects/:id/activities/:activityId/detail`): mirror — header (code, name, WBS node, location, dates, float, critical, baseline, method), BOQ rows it delivers (allocations), budget = approved allocations (`schedule.service.js:2372-2376` [C]) vs `generatedBudget`, progress history (approved and pending), cost (committed from SOV lines and POs naming the activity, actual from ledger `activityId`, `CostRecord` projection), forecast, changes (`ChangeOrderActivityLink`, `WorkflowActivityLink` schedule impacts), exceptions.

## 4. Coverage (§69) [D]

`buildAllocationSummary` (`:286-474`) is extended with `groupBy ∈ { none, wbs, section, location, costCode, package }` and `cutoffDate`. Output per group and total: BOQ amount, allocated (approved / pending), unallocated, **not-applicable** (items with `mappingRule = not_applicable` are excluded from "unallocated"), earned, certified, plus counts of items by mapping state (`unmapped`, `partial`, `complete`, `over`, `n/a`). Coverage is a derived figure; it feeds the readiness step `boq_allocation` (`project-setup-readiness.service.js:353-387`) unchanged in meaning, and the schedule readiness check `allocations` (`schedule.service.js:314-585`) — both now ignore `not_applicable` items.

UI: tiles (as today) + a grouped table with a coverage bar per row, drill-down to the Mapping view filtered by the group.

## 5. Validation rules (§70-§72) [D]

| Rule | Severity | Where enforced | Exists? |
|---|---|---|---|
| Σ active allocation qty ≤ item qty; Σ amount ≤ item amount; re-checked on approve against approved-only | block | `activity-boq-allocation.service.js:155-189, 823-840` | yes [C] |
| One active allocation per (project, item, activity) | block | partial unique index | yes [C] |
| Only draft rows editable; reject requires reason | block | `:560-569, 877-936` | yes [C] |
| Item `unitCode` ≠ activity progress-method `quantityUnit` (quantity method) | warning + exception | mapping service on create/approve; exception engine | new |
| Allocation `locationId` must be the item's location or a descendant, and the activity's location or a descendant, when both set | block on create, warning on approve for legacy rows | mapping service; `Location.path` prefix test | new |
| Allocation to an activity outside the item's WBS node subtree | warning | mapping service | new |
| Item `mappingRule = required` with no approved allocation at baseline | block (readiness step `boq_allocation`) | readiness | rule exists (`UNALLOCATED_BOQ`), N/A exclusion new |
| Item `mappingRule = not_applicable` with an allocation | block | mapping service | new |
| BOQ item with no `unitCode` resolvable from `unit` | warning at upload | excel-parser normalisation | new |
| Approved allocation on a superseded/inactive item | block (already: item `isActive` filter) | service | yes |
| Locked BOQ (baselined revision) — no item edits, uploads become `comparison_only` | block | `boq.service.js:221-258, 833-850` | yes [C] |
| Cost code on a BOQ item must be in `ProjectCostCode` | block | boq service | new |

Blocks return the existing 409/422 codes; warnings are returned in the write response `warnings[]` and recorded as exceptions (change doc §6) so they are visible without re-running the write.

## 6. Tests

- Live: `backend/scripts/project-controls/pc-3-mapping-rules.js` — creates item/activity/location fixtures, drives every rule above through the API and asserts the code; "mutate the fix away" check per the evidence-tier rule.
- Playwright `e2e/50-controls-navigation.spec.ts`: Project Controls group renders per role (pm, planning_eng, qs, site_engineer, quality), BOQ Detail and Activity Detail open from grid and from a deep link, Back closes nothing unexpectedly.
- §138 scenario walks Overview → Structure → BOQ → Mapping → Progress → Cost → Forecast → Changes on one project and asserts the summary strip figures reconcile (delta 0.00, wave plan CERT).
