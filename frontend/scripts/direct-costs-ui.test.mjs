import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-FIN-DIRECT-039 — direct costs wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const backend = (rel) => readFileSync(path.join(root, '..', 'backend', rel), 'utf8')

const hooks = read('src/features/direct-costs/hooks/use-direct-costs.ts')
const panel = read('src/features/direct-costs/components/direct-costs-panel.tsx')
const dialog = read('src/features/direct-costs/components/direct-cost-dialog.tsx')
const dashboard = read('src/features/cost/components/cost-dashboard.tsx')
const projectDetail = read('src/features/projects/components/project-detail.tsx')
const permissions = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))
const projectsRoutes = backend('src/routes/projects.js')
const service = backend('src/services/direct-cost.service.js')
const cashFlow = backend('src/services/cash-flow.service.js')
const reportSources = backend('src/services/report-sources.js')
const recordLinks = backend('src/utils/record-links.js')
const attachments = backend('src/services/attachment.service.js')
const schema = backend('prisma/schema.prisma')

for (const name of ['useDirectCosts', 'useDirectCost', 'useCreateDirectCost', 'useUpdateDirectCost', 'useDeleteDirectCost', 'useDirectCostAction', 'useRecordDirectCostPayment']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /\/direct-costs`/, 'base path')
assert.match(hooks, /\/\$\{id\}\/payments`/, 'payments endpoint')

assert.match(panel, /export function DirectCostsPanel/, 'register')
assert.match(panel, /data-testid='uat-direct-costs-new'/, 'new button')
assert.match(panel, /data-testid='uat-direct-costs-rows'/, 'rows')
assert.match(dialog, /export function DirectCostDialog/, 'workspace')
assert.match(dialog, /data-testid='uat-direct-cost-lines'/, 'lines editor')
assert.match(dialog, /data-testid='uat-direct-cost-submit'/, 'submit')
assert.match(dialog, /data-testid='uat-direct-cost-approve'/, 'approve')
assert.match(dialog, /data-testid='uat-direct-cost-pay'/, 'record payment')
assert.match(dialog, /data-testid='uat-direct-cost-void'/, 'void')
assert.match(dialog, /recordType='direct_cost'/, 'attachments on the cost')
assert.match(dialog, /useCanPerform\(\s*'cost',\s*'approve',\s*'direct_cost\.approve'\s*\)/, 'approval gated by the transition')
assert.match(dialog, /entityType='direct_cost'/, 'history')

assert.match(dashboard, /<TabsTrigger value='direct-costs'>Direct Costs<\/TabsTrigger>/, 'tab in Cost Control')
assert.match(dashboard, /<DirectCostsPanel/, 'panel mounted')
assert.match(projectDetail, /\{ key: 'direct-costs', label: 'Direct Costs' \}/, 'sidebar child')
assert.deepEqual(permissions.modules.cost.transitions['direct_cost.approve'], ['pm', 'finance'], 'approval roles')
assert.deepEqual(permissions.modules.cost.transitions['direct_cost.submit'], ['pm', 'qs', 'cost_controller'], 'submit roles')

assert.match(projectsRoutes, /"\/:projectId\/direct-costs",\s*nestedProjectAccess,\s*require\("\.\/direct-costs"\)/, 'routes mounted')
assert.match(service, /DIRECT_COST_LINE_COST_CODE_REQUIRED/, 'coded lines required at submission')
assert.match(service, /budgetLine\.update\(\{ where: \{ id: budgetLine\.id \}, data: \{ actual: \{ increment: amount \} \} \}\)/, 'posts to the budget line')
assert.match(service, /costRecord\.update\(\{ where: \{ id: record\.id \}, data: \{ actual: \{ increment: amount \}/, 'posts to the activity')
assert.match(service, /actual: \{ decrement: posted \}/, 'void reverses the posting')
assert.match(service, /DIRECT_COST_DUPLICATE_INVOICE/, 'duplicate invoices refused')
assert.match(cashFlow, /directCostPayment\.findMany/, 'payments are cash-flow outflows')
assert.match(reportSources, /direct_cost: \{/, 'report source')
assert.match(recordLinks, /direct_cost: \{ module: "cost", child: "direct-costs" \}/, 'record link')
assert.match(attachments, /direct_cost: "cost"/, 'attachments')
for (const model of ['DirectCost', 'DirectCostLine', 'DirectCostPayment']) assert.match(schema, new RegExp(`^model ${model} \\{`, 'm'), `${model} model`)

console.log('direct-costs-ui: ok')
