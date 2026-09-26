# OctaPM project control model (PC-0)

The common structure every project-controls record hangs on, how BOQ, schedule, progress, cost, forecast and change meet through it, and the "three truths" rule. [C] = confirmed at the cited line, [I] = inferred, [D] = decision. Financial rules are certified (`docs/finance/OCTAPM_COST_POSTING_MODEL.md`) and are **not** changed by anything here.

---

## 1. The common structure (§55-§60)

Four project-owned dimensions, one per question a controls engineer asks:

| Dimension | Question | Today [C] | Target [D] |
|---|---|---|---|
| **WBS** | *what part of the scope?* | no model; `Activity.wbsCode` free string (`schema.prisma:1458`, indexed `:1558`); imported nodes only in `ScheduleRevision.snapshotJson.wbs` (`import.service.js:240-248`); UI splits codes on "." (`wbs-tree.tsx:39-80`); live values mixed ("1 Substructure", "03.10", "ST"), 238/601 activities have one | new `WbsNode` table, project-owned, additive (§1.1) |
| **Location** | *where?* | `Location` tree exists (`:4604-4647`; parentId, path, depth ≤ 8 in `location.service.js:29`) linked to photos, sheets, punch, forms, RFIs, time entries, change events, lookahead, PO delivery — **not** to `Activity`, `BoqItem`, `ActivityBoqAllocation`; 84 rows on 3/432 projects | nullable `locationId` on `Activity`, `BoqItem`, `ActivityBoqAllocation`, `ProgressSubmission` (SetNull, same pattern as `Rfi`) |
| **Cost code** | *which budget bucket?* | `CostCode` org master (`:4649`), `ProjectCostCode` subset (`:4683`), `BudgetLine` per code × type (`:4707`); `BoqItem` has no `costCodeId`; only bridge is a code-prefix heuristic (`budget.service.js:417-431`); 0 `BudgetLineActivityAllocation` rows | nullable `BoqItem.costCodeId` (must be in `ProjectCostCode`); heuristic kept as fallback |
| **Work package** | *who delivers it, under which contract?* | **does not exist**. `ProcurementPackage` is a buying package on ≤1 activity (`:2738-2782`), `ScopeMatrix` a scope statement per commitment/bid (`:4962`), `ProjectParty` a company-on-project row (`:637`) — none groups BOQ rows + activities + budget [C] | **§60 decision:** no new entity. A work package is a `WbsNode` with `isPackage = true`, `ownerPartyId?` (→ `ProjectParty`) and `commitmentId?` (→ `Commitment`). Rationale: the audit shows three existing grouping constructs already; a fourth would be a second truth for "scope of a subcontract", which `Commitment` + `CommitmentSovLine` (BOQ item, activity, cost code, budget line per line, `:4872-4910`) already is. The WBS flag gives the grouping and the package view; the commitment stays the contractual truth. (Listed for the PO as decision 3.) |

### 1.1 `WbsNode` [D]

```prisma
model WbsNode {
  id           String   @id @default(uuid())
  projectId    String
  orgId        String                 // denormalised, composite FK to Project(id, orgId)
  parentId     String?
  code         String                 // "03.10"
  name         String
  path         String                 // materialised path of ids, like Location
  depth        Int      @default(0)
  sortOrder    Int      @default(0)
  source       String   @default("manual") // manual | import | ai
  externalId   String?                // P6 wbs_id / MSP OutlineNumber
  isPackage    Boolean  @default(false)
  ownerPartyId String?
  commitmentId String?
  status       String   @default("active")
  ...
  @@unique([projectId, code])
  @@index([projectId, path])
}
```

- `Activity.wbsNodeId String?` and `BoqItem.wbsNodeId String?` (SetNull). `Activity.wbsCode` is **kept** and becomes a derived display of the node code once linked; unlinked activities keep their string (238 live rows are not rewritten — structure stop condition).
- Populated at `ScheduleRevision` activation from `snapshotJson.wbs` (nodes already carry id/parent/code/name/seq from all three parsers: `xer-parser.js:80-134`, `import.service.js:356-368`, `msp-parser.js:109` [C]); activation maps `Activity.wbsCode` → node by `externalId` then `code`.
- Editable in the Project Controls UI (add/rename/move); moving re-writes `path` like `location.service.js` does.

### 1.2 Unit of measure [D]

`BoqItem.unit`, `CommitmentSovLine.unit`, `InventoryItem.unit`, `ActivityProgressMethod.quantityUnit` are free strings; live BOQ holds `m3` 149, `m2` 96, `item` 16, `sum` 5, `nr` 4, `ton` 4, `m` 2; materials UI uses an uppercase enum (`frontend/src/features/materials/data/schema.ts:3-15`); no normalisation exists (grep) [C].

- New org master `UnitOfMeasure { orgId, code, name, aliasesJson, dimension }` seeded per org (`m, m2, m3, nr, kg, t, hr, day, ls, sum, item, l, bag, sheet, roll, load, pcs`).
- `BoqItem.unitCode String?` is the normalised code; `unit` (as typed) is kept. Normalisation at upload and at edit is a **warning**, never a rewrite of `unit`. `ActivityBoqAllocation` inherits the item's `unitCode` (no unit of its own, `boq.service.js:1456-1483` echoes `boqItem.unit` [C]).
- Cross-record check (§71): allocation ↔ progress-method `quantityUnit` ↔ SOV line unit mismatch is a validation exception, not a block.

---

## 2. How the modules meet through the structure (§61-§64)

```
                 WbsNode ─────────────────┐
                 Location ────────────────┤
                 CostCode/ProjectCostCode ┤
                                          ▼
 BoqItem (qty, rate, amount) ──ActivityBoqAllocation (qty, amount, weight, approved)── Activity (CPM dates, baseline)
        │                                  │                                                │
        │ IpcItem (certified)               │ IpcItemProgressLink                            │ ActivityProgress (approved pct)
        │ CommitmentSovLine (committed)     │ ChangeOrderAllocationLink                      │ ActivityCostLoading (PV)
        │ StockTransaction.boqItemId        │                                                │ CostRecord (projection)
        ▼                                  ▼                                                ▼
   BudgetLine (register) ◄── BudgetLineActivityAllocation ◄── EV (BAC, EV, PV, AC) ◄── CostLedgerEntry (actual)
```

- **BOQ → schedule**: `ActivityBoqAllocation` is the join (`:1587-1633`; qty/amount/weight, draft→submitted→approved, active-pair partial unique, capacity ≤ item, pm/qs approve) [C]. A BOQ row can name or mint an activity (`boq.service.js:598-712`, `mintedByBoqItemId :1479`) [C]. Detail in `OCTAPM_BOQ_ACTIVITY_MAPPING.md`.
- **Schedule → progress**: `ActivityProgressMethod` → `ProgressSubmission` → approved `ActivityProgress` (`progress.service.js:602-735`) [C]. Detail in `OCTAPM_PROGRESS_MEASUREMENT.md`.
- **Progress → EV**: EV = approved allocation amount × latest approved pct on/before cutoff (`earned-value.service.js:45-59, 96-116`); PV from approved `ActivityCostLoading`; AC from `CostRecord.actual` ≤ cutoff (`:317-345`) [C].
- **BOQ → cost**: `CommitmentSovLine.boqItemId/activityId/costCodeId/budgetLineId` (87/926 live lines name a BOQ item) [C]; `StockTransaction.boqItemId` (1 row); `IpcItem.boqItemId` required (11/11 name an allocation) [C].
- **Structure → budget**: `BoqItem.costCodeId` (new) feeds `suggestAllocations` so `BudgetLineActivityAllocation` weights derive from approved allocations by cost code instead of a prefix match (`budget.service.js:417-431`) [C]; `budget.reconcile` (`:592-636`) is then exercisable (0 rows today).
- **Change**: `ChangeEvent` (activity, location, lines with cost code/budget line/activity/commitment, `:6153-6230`) → `ChangeOrder` → `BudgetRevision` + `BudgetLineChange` + activity links + prime contract revised value (`change-order.service.js:646-820, 1230-1290`) [C]. Detail in `OCTAPM_CHANGE_INTELLIGENCE.md`.

Every one of these joins exists today; the programme adds the structure keys (WBS, location, cost code, unit) so that each join can be **grouped**, and it adds no new money path.

---

## 3. The three truths (§123-§124) [D]

Every figure the product shows is exactly one of:

| Truth | Definition | Examples (as built) | Rule |
|---|---|---|---|
| **Source** | a fact somebody approved, executed, certified or posted; has an actor, a timestamp and an idempotent identity | approved `ActivityBoqAllocation`; approved `ActivityProgress`; executed `Commitment` + approved `CommitmentChangeOrder`; certified `SubPayApp` lines; `CostLedgerEntry` (`sourceKey`, signed reversals, `cost-ledger.service.js:158-262`); approved `BudgetRevision`; `BudgetLine.originalBudget`; `IpcCertificate` certified; payments | never recomputed; changed only by a new source row (reversal, revision, new approval) |
| **Derived** | a value computed only from source rows; rebuildable at any time with no loss | `BudgetLine.actual`, `CostRecord.actual/committed` (projections of the ledger, `cost-ledger.service.js:109-156`); revised budget (`budget.service.js:132-148`); EV/PV/AC/SPI/CPI (`earned-value.service.js`); coverage (`buildAllocationSummary`); certified value per item; installed quantity totals; exceptions | must never be typed (already refused: `cost.service.js:345-350`, `budget.service.js:267-272`) and must carry `derivedFrom` provenance in the API |
| **Projection** | an estimate about the future or an allocation of a fact to a finer grain than it was recorded at | EAC (`revised BAC / CPI`, `earned-value.service.js:146-172`); `CostRecord.forecast` (typed or `budget + 1.1×(actual−budget)`, `cost.service.js:301-307`); `forecast.service` projected (`:312-316`); forecast quantity; paid quantity (pro-rata); S-curve future months | labelled `projection` with `basis` in every payload (the `estimate / excluded from official` labelling at `earned-value.service.js:700-720` is the pattern); never feeds a source or a certified derived figure |

Consequences the audit forces:

1. **Three budget figures coexist** — register revised total, EV BAC (approved allocations + `BudgetRevision` delta, `earned-value.service.js:257-268, 599-609`), and the `BudgetRevision` waterfall from `Project.contractValue` (`budget-revision.service.js:43-80`) [C]. Each is a *derived* figure with a different source set and a certified meaning; none is rewritten. The product states which one a screen shows (register = "Budget", EV BAC = "Budget at completion (EV basis)", waterfall = "Contract value + approved changes") and a data-quality exception fires when they disagree beyond tolerance (`OCTAPM_CHANGE_INTELLIGENCE.md` §7).
2. **`BudgetLine.originalBudget` is PATCH-able and import-updatable** (`budget.service.js:303, 321, 359`) although the certified rule says Original Budget is immutable [C]. PC-6 adds the guard: `originalBudget` may be set only while the line has no `BudgetLineChange`, no ledger projection and the project has no locked `BudgetSnapshot`; afterwards changes go through `BudgetLineChange(kind='revision')`. This enforces the certified rule; it does not change it.
3. **Two "committed" definitions** — `commitment.service.js:424-483` (executed/closed + approved CCOs, the certified one) and the PO list summary (`purchase-order.service.js:337-340`) [C]. The PO figure is renamed "Order value (not committed)" in the API and UI and is never summed into the register.
4. **Three EACs** (`earned-value.service.js:146-172`; `cost.service.js:222-282`; `forecast.service.js:312-316`) [C] are all projections; each is labelled with its basis and the cost cockpit shows the official one first.
5. **EV basis disagreement**: official EV picks approved progress by `approvedAt ≤ cutoff` (`earned-value.service.js:96-116`); the allocation summary and IPC use latest-by-`updatedAt` (`activity-boq-allocation.service.js:311-320`; `ipc.service.js:374-389`) [C]. Both are derived; PC-6 gives the summary a `cutoffDate` parameter defaulting to "now" so the two agree whenever the cutoff is today.

---

## 4. Tenancy of the structure

`WbsNode`, `UnitOfMeasure` (org), the new `locationId`/`costCodeId`/`wbsNodeId` columns and everything in §2 follow the matrix: project-owned rows inherit through `Project.orgId` (BoqItem, Activity, allocation, progress) or carry `orgId` with a composite FK (`WbsNode`, `Location`, `BudgetLine`, `CostLedgerEntry`). No structure row crosses organisations; a company BOQ template or WBS template is a copy into the project, never a reference.
