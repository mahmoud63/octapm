import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/cost/hooks/use-budget.ts')
;[
  '/cost-codes`',
  '/lines`',
  '/lines/import`',
  '/transfers`',
  '/reconciliation`',
  '/snapshots`',
  '/lines/${lineId}/allocations`',
  '/lines/${lineId}/allocations/suggest`',
  '/lines/${lineId}/revisions`',
  '/reports/periods`',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
assert.match(hooks, /revisedBudget: number/, 'lines expose the revised budget')
assert.match(hooks, /balanced: boolean/, 'reconciliation exposes balanced')
;['labour', 'material', 'equipment', 'subcontract', 'indirect', 'overhead', 'contingency', 'other'].forEach((type) =>
  assert.ok(hooks.includes(`'${type}'`), `cost type ${type}`)
)

// ── Panel and dialogs ───────────────────────────────────────────────────
const panel = read('src/features/cost/components/budget-panel.tsx')
;[
  'uat-budget-panel',
  'uat-budget-reconciliation',
  'uat-budget-balanced',
  'uat-budget-reconciliation-open',
  'uat-budget-snapshots-open',
  'uat-budget-codes',
  'uat-budget-import',
  'uat-budget-transfer',
  'uat-budget-line-new',
  'uat-budget-lines',
  'uat-budget-line-row',
  'uat-budget-allocate',
  'uat-budget-revise',
  'uat-budget-by-type',
].forEach((id) => assert.ok(panel.includes(id), `panel exposes ${id}`))
assert.match(panel, /useCanPerform\('cost', 'approve'\)/, 'transfers, revisions and snapshots need cost approve')
assert.match(panel, /entityType='budget_line'/, 'history on budget lines')
assert.match(panel, /style: 'currency'/, 'money formatted in the project currency')
const dialogs = read('src/features/cost/components/budget-dialogs.tsx')
;[
  'uat-budget-line-dialog',
  'uat-budget-line-code',
  'uat-budget-line-type',
  'uat-budget-line-original',
  'uat-budget-line-save',
  'uat-budget-allocation-dialog',
  'uat-budget-allocation-suggest',
  'uat-budget-allocation-save',
  'uat-budget-transfer-dialog',
  'uat-budget-transfer-save',
  'uat-budget-revision-dialog',
  'uat-budget-import-dialog',
  'uat-budget-import-csv',
  'uat-budget-cost-codes-dialog',
  'uat-budget-reconciliation-dialog',
  'uat-budget-snapshots-dialog',
  'uat-budget-snapshot-take',
].forEach((id) => assert.ok(dialogs.includes(id), `dialogs expose ${id}`))
assert.match(dialogs, /Suggest from BOQ/, 'BOQ-based allocation suggestion')
assert.match(dialogs, /% allocated/, 'allocation total shown')
assert.match(read('src/features/cost/components/cost-dashboard.tsx'), /<TabsTrigger value='budget'>Budget<\/TabsTrigger>/, 'Budget tab')
assert.match(read('src/features/cost/components/cost-dashboard.tsx'), /<BudgetPanel projectId=\{projectId\} \/>/, 'Budget panel rendered')
assert.match(read('src/features/projects/components/project-detail.tsx'), /\{ key: 'budget', label: 'Budget' \}/, 'Budget sub-tab in the workspace menu')

// ── Backend contract ────────────────────────────────────────────────────
const service = read('../backend/src/services/budget.service.js')
;['deriveLine', 'listBudgetLines', 'createBudgetLine', 'importBudgetLines', 'setLineAllocations', 'suggestAllocations', 'transferBudget', 'addRevision', 'applyChangeOrderToBudgetLines', 'reconcile', 'takeSnapshot', 'snapshotForPeriod'].forEach((symbol) =>
  assert.ok(service.includes(symbol), `service implements ${symbol}`)
)
assert.match(service, /const revised = addMoney\(original, addMoney\(approvedChanges, revisions\)\)/, 'revised = original + changes + revisions')
assert.match(service, /BUDGET_ALLOCATION_OVER/, 'weights capped at 100%')
assert.match(service, /balanced: Math\.abs\(totals\.difference\) <= TOLERANCE && mismatches\.length === 0/, 'balanced when totals and every activity agree')
assert.match(read('../backend/src/services/change-order.service.js'), /applyChangeOrderToBudgetLines\(\{/, 'approved change orders update the budget lines')
assert.match(read('../backend/src/services/earned-value.service.js'), /snapshotForPeriod\(\{/, 'locking a period snapshots the budget')
assert.match(read('../backend/src/routes/projects.js'), /"\/:projectId\/budget"/, 'budget router mounted')
const routes = read('../backend/src/routes/budget.js')
;['"/cost-codes"', '"/lines"', '"/lines/import"', '"/transfers"', '"/reconciliation"', '"/snapshots"', '"/lines/:lineId/allocations"', '"/lines/:lineId/allocations/suggest"', '"/lines/:lineId/revisions"', '"/change-orders/:changeOrderId/line"'].forEach((path) =>
  assert.ok(routes.includes(path), `route ${path}`)
)
assert.match(routes, /requirePermission\("cost", "approve"\)/, 'transfers and snapshots gated by cost approve')
const migration = read('../backend/prisma/migrations/20260906180000_add_budget_lines/migration.sql')
;['CREATE TABLE "ProjectCostCode"', 'CREATE TABLE "BudgetLine"', 'CREATE TABLE "BudgetLineChange"', 'CREATE TABLE "BudgetLineActivityAllocation"', 'CREATE TABLE "BudgetSnapshot"', 'ADD COLUMN "budgetLineId"'].forEach((statement) =>
  assert.ok(migration.includes(statement), `migration has ${statement}`)
)

console.log('budget-ui: ok')
