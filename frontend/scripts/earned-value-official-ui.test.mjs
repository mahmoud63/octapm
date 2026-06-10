import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const scheduleDashboard = read(
  'src/features/schedule/components/schedule-dashboard.tsx'
)
const costDashboard = read('src/features/cost/components/cost-dashboard.tsx')
const costHook = read('src/features/cost/hooks/use-cost.ts')
const evReport = read('src/features/reports/components/ev-report.tsx')

assert.ok(
  scheduleDashboard.includes('<EvReport projectId={projectId} />'),
  'schedule EV tab renders the official EV report component'
)
assert.ok(
  !scheduleDashboard.includes('<EvDashboard'),
  'schedule EV tab no longer renders local prototype EV math'
)
assert.ok(
  costHook.includes('actualThroughDate: string | null'),
  'cost records expose actualThroughDate to the UI'
)
assert.ok(
  costHook.includes("['ev-report', projectId]"),
  'cost updates invalidate official EV reports'
)
assert.ok(
  costDashboard.includes('Actual Through'),
  'cost table shows the actual-through date column'
)
assert.ok(
  costDashboard.includes("type='date'"),
  'cost actual-through date is edited with a date input'
)
assert.ok(
  evReport.includes('officialActualThroughDate'),
  'official EV activity breakdown displays actual-through date context'
)
assert.ok(
  evReport.includes('cost_record.actual_through_date'),
  'official EV UI recognizes the AC source used by the backend engine'
)

console.log('Official earned value UI assertions passed')
