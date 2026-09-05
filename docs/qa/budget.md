# Budget by cost code (OCTA-FIN-COSTCODE-019)

A cost controller keeps a budget by cost code that agrees to the activity
budgets planning works from, so accounting and planning report the same
number. The activity budgets stay what they were (approved BOQ
allocations plus approved change-order impacts); the cost-code budget is
a second view over the same money, tied to activities by allocation
weights and checked by a reconciliation report.

## Model

| Table | Purpose |
| --- | --- |
| `CostCode` (org, from COMPANY-007) | The company's tree of codes with a category. |
| `ProjectCostCode` | The subset a project budgets against (selected explicitly, by "Use all", or implicitly when a line is created). Codes with active lines cannot be removed. |
| `BudgetLine` | One per cost code × cost type (`labour, material, equipment, subcontract, indirect, overhead, contingency, other` — the existing 7-category breakdown plus other). Holds `originalBudget`, `committed`, `actual`, optional manual `forecast`, status. |
| `BudgetLineChange` | Ledger: `change_order` (approved CO value), `revision` (signed, with reason), `transfer_out` / `transfer_in` (pairs, with the counterpart line). |
| `BudgetLineActivityAllocation` | Share of a line carried by an activity: `weight` (%), derived `amount = revised × weight / 100`, `source` manual / boq / even. Weights of a line sum to ≤ 100. |
| `BudgetSnapshot` | Frozen totals, lines (with allocations and ledger) and reconciliation; one per locked reporting period (`reportingPeriodId` unique) or ad hoc. |
| `ChangeOrder.budgetLineId` | Optional target line for an order's approved value. |

Derived per line: `revised = original + Σ change_order + Σ (revision, transfers)`;
`forecast = manual ?? max(revised, actual, committed)`; `variance = revised − forecast`;
`allocatedWeight`, `allocatedAmount`, `unallocatedAmount`.

## Rules

* **Approved change orders update both views.** When a change order is
  approved (`change-order.service.updateChangeOrder`, same transaction as
  the project-level `BudgetRevision`), its value is written to the ledger:
  on `ChangeOrder.budgetLineId` when set; otherwise split across the lines
  allocated to the order's activity in proportion to their allocation
  amounts; otherwise on the project's **Change orders** line (org cost code
  `CO`, cost type mapped from the order's category). Re-approval replaces
  the rows. Allocation amounts are recomputed, so the activity view moves
  with the line.
* **Reconciliation** (`GET …/budget/reconciliation`): per activity,
  `activityBudget = approved BOQ allocation + approved CO impacts` vs
  `budgetFromLines = Σ allocation amounts`; totals Σ activity budgets vs Σ
  revised lines. `balanced` when the totals agree within 0.01 and no activity
  differs. The report also lists under-allocated lines and activities with a
  budget but no line allocation.
* **Allocations**: `PUT …/lines/{lineId}/allocations` replaces the set
  (weights 0–100, Σ ≤ 100, activities must be active on the project).
  `GET …/allocations/suggest` proposes weights from approved BOQ allocations
  whose item code starts with the cost code (basis `boq`), else from every
  allocated activity by approved budget (basis `even`), rounded so they sum
  to 100.
* **Transfers** need `cost.approve`; a line cannot give more than its revised
  budget. **Revisions** need `cost.approve` and a reason.
* **Import** (`POST …/lines/import`): rows of `code, name?, costType,
  originalBudget, description`; unknown codes with a name are created in the
  company library, existing lines updated, unknown codes without a name
  reported in `missingCodes`.
* **Snapshots**: `POST …/snapshots` (with or without a reporting period)
  freezes totals, lines and the reconciliation. Locking a reporting period
  (`earned-value.service.lockReportingPeriod`) takes the period's snapshot in
  the same transaction, so the budget of a locked period is fixed with its EV
  figures.

## Endpoints (`/api/v1/projects/{projectId}/budget`)

| Method / path | Permission | Purpose |
| --- | --- | --- |
| `GET /cost-codes`, `PUT /cost-codes` | cost read / update | Project subset and the org library (`importAll`, `costCodeIds`, `removeCostCodeIds`). |
| `GET /lines`, `POST /lines`, `POST /lines/import` | read / create | Lines with derived fields and totals by cost type. |
| `GET/PATCH/DELETE /lines/{lineId}` | read / update / delete | One line; delete archives. |
| `PUT /lines/{lineId}/allocations`, `GET …/allocations/suggest` | update / read | Activity weights. |
| `POST /lines/{lineId}/revisions`, `POST /transfers` | approve | Ledger entries. |
| `PUT /change-orders/{changeOrderId}/line` | update | Target line for an order (re-applies when approved). |
| `GET /reconciliation` | read | The validation report. |
| `GET/POST /snapshots`, `GET /snapshots/{snapshotId}` | read / approve | Snapshots. |

OpenAPI tag "Cost Control" (383 documented paths).

## Frontend

Cost Control › **Budget** (`/projects/{id}/cost/budget`):

* eight totals (original, approved changes, revisions, revised, committed,
  actual, forecast, variance) and a reconciliation strip — *Balanced* or
  *Off by X* with Σ activity budgets, Σ budget lines, differing activities
  and under-allocated lines — with **View report** (activity table) and
  **Snapshots** (take one, optionally against a reporting period; open any
  to see its frozen lines);
* the lines table (code, type, original, changes, revised, committed,
  actual, forecast with *auto* marker, variance, allocated %) with edit,
  **Revise**, archive and an allocation dialog (**Suggest from BOQ**, split
  evenly, per-activity weights with amounts, total badge);
* **Cost codes** (project subset picker with *Use all*), **Import** (CSV
  rows), **Transfer** (between two active lines with a reason), **Add
  line**; totals by cost type; budget history.

## Tests

* `backend/src/services/__tests__/budget.service.test.js` — derivation,
  summary, allocation validation, line creation, allocation amounts, BOQ
  suggestion, transfer limits, change-order application (explicit line /
  activity split / fallback line), reconciliation (balanced and off),
  period snapshot, category mapping.
* `frontend/scripts/budget-ui.test.mjs` — hooks, panel, dialogs, tab wiring
  and the backend contract.
