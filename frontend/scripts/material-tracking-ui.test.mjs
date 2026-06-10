import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const component = read('../src/features/materials/components/materials-section.tsx')
const hook = read('../src/features/materials/hooks/use-materials.ts')
const schema = read('../src/features/materials/data/schema.ts')
const permissions = read('../../shared/permissions.json')

;[
  'Supplier',
  'Need Date',
  'Lead Weeks',
  'Buffer Days',
  'PO',
  'Receipt',
  'Usage',
  'Risk',
  'Available',
].forEach((label) => {
  assert.ok(component.includes(label), `material panel renders ${label}`)
})

assert.match(
  component,
  /useCanPerform\(\s*'procurement',\s*'submit',\s*'material\.use'\s*\)/,
  'usage button visibility follows procurement material.use permission'
)
assert.match(
  hook,
  /\/materials\/\$\{materialId\}\/usage/,
  'material usage mutation calls activity material usage endpoint'
)
assert.match(
  schema,
  /procurementRisk/,
  'material schema exposes procurement risk state'
)
assert.match(
  schema,
  /poLines/,
  'material schema exposes PO line traceability'
)
assert.match(
  permissions,
  /"material\.use"/,
  'shared permissions include material usage transition'
)

console.log('Material tracking UI assertions passed')
