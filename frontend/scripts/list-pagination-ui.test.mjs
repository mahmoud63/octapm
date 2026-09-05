import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const docHooks = read('src/features/doc-control/hooks/use-doc-control.ts')
const docDashboard = read(
  'src/features/doc-control/components/doc-control-dashboard.tsx'
)
const costHooks = read('src/features/cost/hooks/use-cost.ts')
const costDashboard = read('src/features/cost/components/cost-dashboard.tsx')

assert.match(
  docHooks,
  /\.get\(`\/projects\/\$\{projectId\}\/rfi`, \{ params: cleanListParams\(query\) \}\)/,
  'RFI hook sends list query params to the API'
)

assert.match(
  docHooks,
  /\.get\(`\/projects\/\$\{projectId\}\/submittals`,\s*\{\s*params: cleanListParams\(query\),\s*\}/s,
  'Submittal hook sends list query params to the API'
)

assert.match(
  docDashboard,
  /setRfiCursor\(null\)[\s\S]*setRfiSearch\(e\.target\.value\)/,
  'RFI search resets cursor before applying a new server filter'
)

assert.match(
  docDashboard,
  /setSubmittalCursor\(\s*submittals\?\.pagination\?\.nextCursor \?\? null\s*\)/,
  'Submittal UI exposes cursor-based next-page navigation'
)

assert.match(
  costHooks,
  /\.get\(`\/projects\/\$\{projectId\}\/cost`, \{ params: cleanListParams\(query\) \}\)/,
  'Cost hook sends list query params to the API'
)

assert.match(
  costDashboard,
  /const rows = costPage\?\.rows \|\| \[\]/,
  'Cost activity table uses the paged cost-record response'
)

assert.match(
  costDashboard,
  /setCostCursor\(costPage\?\.pagination\?\.nextCursor \?\? null\)/,
  'Cost activity table exposes cursor-based next-page navigation'
)

console.log('List pagination UI assertions passed')
