# OctaPM BOQ ↔ activity mapping model (PC-0)

`ActivityBoqAllocation` **is** the mapping model. It is kept, extended, and no second mapping table is created. [C] = confirmed, [D] = decision.

## 1. As built [C]

`ActivityBoqAllocation` (`backend/prisma/schema.prisma:1587-1633`): `projectId`, `boqItemId`, `activityId`, `quantity Float`, `amount Decimal(18,2)`, `weight Float` (% of item amount), `source manual|import|ai|migration`, `status draft|submitted|approved|rejected`, `isActive`, `notes`, `submittedBy/At`, `approvedBy/At`, `rejectedBy/At/Reason`, `createdBy/updatedBy`. Relations: `ipcItems`, `changeOrderLinks`, `ipcProgressLinks`, `subValuationLinks`. One active row per (project, item, activity) by partial unique index `ActivityBoqAllocation_active_pair_key WHERE "isActive" = true` (migration `20260608170000` l.44, re-locked in `20260611040000` l.28). Capacity Σ qty ≤ item qty and Σ amount ≤ item amount (`activity-boq-allocation.service.js:155-189`, approved-only re-check `:823-840`). Approve/reject: pm, qs; create/update/submit: pm, planning_eng, qs (`shared/permissions.json:172-186`). Live: 279 rows (161 approved, 118 draft), all `source='manual'`; 185 projects have allocations; 8 activities minted by BOQ rows. `BoqActivity` (`:1412`) is a dead legacy table: no writer, 0 rows.

Downstream: `IpcItem.allocationId` (11/11), `IpcItemProgressLink`, `ChangeOrderAllocationLink` (0 rows), `SubValuationAllocationLink` (retired), EV (`earned-value.service.js:45-59`), activity budget (`schedule.service.js:2372-2376`), readiness (`project-setup-readiness.service.js:353-387`).

## 2. Fields it lacks against §65-§68 [D]

| Field | Type | Why | Default / backfill |
|---|---|---|---|
| `locationId String?` | → `Location` (SetNull) | quantity per zone/level; coverage by location | null |
| `unitCode String?` | derived from `BoqItem.unitCode` at write; stored for history | unit consistency check (§71) | backfill from item |
| `suggestedBy String?` | `ai \| rule:code \| rule:wbs \| rule:name \| import` | provenance of a suggestion that became a row | null (all live rows are manual) |
| `confidence Float?` | 0-1 | suggestion ranking; shown in UI | null |
| `basis String?` | `quantity \| amount \| weight` | which of the three the user typed; the other two are derived (today all three are stored with no record of which was authoritative) | `amount` for legacy rows |
| `importBatchId String?` | mapping-file import batch | undo an import as a unit; `source='import'` exists but nothing writes it [C] | null |
| `supersededByAllocationId String?` | self | audit chain when a row is replaced (today: reject + new draft) | null |

On `BoqItem` (not on the allocation): `mappingRule String @default("required")` = `required | optional | not_applicable`, `wbsNodeId?`, `locationId?`, `costCodeId?`, `unitCode?`.

Nothing is removed. The partial unique index stays the uniqueness truth. Money stays `Decimal`.

## 3. REQUIRED / OPTIONAL / NOT APPLICABLE rules (§66-§68) [D]

| `BoqItem.mappingRule` | Meaning | Effect |
|---|---|---|
| `required` (default) | the row is delivered by schedule activities and must be fully allocated before baseline | counts in "unallocated"; blocks readiness `boq_allocation` and schedule check `allocations` when uncovered; earns EV only through allocations |
| `optional` | may be allocated; if not, its amount is reported as "unscheduled value" but does not block baseline | excluded from readiness blockers; included in "unallocated" as a warning bucket; may still be certified in IPC via an allocation-less item path? **No** — IPC keeps `boqItemId` required and `allocationId` for capped items; an optional item certified without allocation is a warning exception |
| `not_applicable` | preliminaries, provisional sums, dayworks, contingency, items priced but never "progressed" | any allocation is refused (`409 MAPPING_NOT_APPLICABLE`); excluded from unallocated and from EV BAC? **No change to BAC**: EV BAC = approved allocations + revisions (certified) already excludes them because they have no allocation; the coverage view reports their amount in its own bucket so "BOQ total = allocated + unallocated + N/A" holds |

Setting the rule: on upload (new optional column `mapping_rule`), in the grid, or by a bulk rule ("all items in section *Preliminaries* → N/A"). Changing `required → not_applicable` on an item with an approved allocation is refused until the allocation is rejected.

## 4. Rules for quantity vs amount vs weight

`basis` records what was typed; the service derives the other two from the item (`amount = qty × rate` when basis is quantity; `qty = amount / rate` when basis is amount; both from `weight × item` when basis is weight). Rounding: money 2 dp (Decimal), quantity 3 dp. Capacity checks are on the derived amount and quantity as today. A rate change on the item (only possible while unlocked) re-derives draft rows and flags approved rows with an exception (they are source rows and are not rewritten).

## 5. Mapping UI (§75) [D]

Route `…/controls/mapping`, permission `boq` read (edit: `boq` update / allocation actions as today).

- **Matrix view**: rows = BOQ items (grouped by WBS / section / location / cost code), columns = activities (grouped by WBS), cells = allocation qty/amount/status; keyboard entry; paste from spreadsheet; bulk select → "allocate evenly", "allocate by activity duration", "allocate by remaining capacity".
- **List view**: the current panel, without `window.prompt`; inline edit; filters by status/source/rule.
- **Coverage side panel**: the §69 figures for the current group.
- **Import**: a mapping xlsx (`boq_code, activity_code, quantity|amount|weight`) → dry-run report (rows matched, unmatched codes, capacity breaches) → apply as `source='import'` drafts with `importBatchId`; "undo batch" rejects them.
- **Approvals**: submit selected → approve/reject selected (pm/qs) with the existing transitions; every action records `approvalWorkflowService.recordTransition` and `AuditEvent` as today.

## 6. Suggestions (§94-§95) [D]

One suggestion service, `mapping-suggestion.service.js`, returning ranked candidates with `suggestedBy` and `confidence`, never writing rows without a user action (or the AI job, which writes drafts):

| Rule | Matches | Confidence |
|---|---|---|
| `rule:code` | `BoqItem.code` prefix equals `Activity.activityCode` or `WbsNode.code` prefix | 0.9 |
| `rule:wbs` | item `wbsNodeId` == activity `wbsNodeId` (or ancestor) | 0.8 |
| `rule:location` | same `locationId` subtree | +0.05 |
| `rule:name` | normalised description ≈ activity name (same normaliser as revision activation, `schedule.service.js:984-1063`) | 0.6 |
| `rule:costcode` | item cost code == commitment SOV line cost code whose `activityId` is set | 0.7 |
| `ai` | existing BOQ→activity AI structuring (`boq.service.js:1063-1244`, writes drafts with `source='ai'`) | model-reported |

Suggestions are shown in the matrix as ghost cells; accepting one creates a draft with the rule's `suggestedBy`/`confidence`. The readiness step gains a warning `SUGGESTIONS_PENDING` count.

## 7. Tests

- Unit (real DB, not mocked): capacity, N/A refusal, basis derivation, location subtree rule, import dry-run/apply/undo idempotency (same file twice → 0 new rows).
- Live: `pc-3-mapping-rules.js` (integration doc §6).
- Playwright `e2e/51-mapping-matrix.spec.ts`: paste a block, submit, approve as qs, coverage bar reaches 100 %, readiness step turns green.
- Certification: after PC-3, `Σ approved allocation amount per item ≤ item amount` and `BOQ total = allocated + unallocated + N/A` hold on every project in the E2E org (delta 0.00).
