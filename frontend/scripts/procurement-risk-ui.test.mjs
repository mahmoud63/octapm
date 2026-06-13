import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const hook = read('../src/features/long-lead/hooks/use-long-lead.ts')
const table = read('../src/features/long-lead/components/long-lead-table.tsx')
const schedule = read(
  '../src/features/schedule/components/schedule-dashboard.tsx'
)
const gantt = read('../src/features/schedule/components/gantt-chart.tsx')
const health = read('../src/features/projects/components/health-dashboard.tsx')

assert.match(hook, /procurementRisk/, 'long-lead hook exposes risk envelope')
assert.match(hook, /warehouseStatus/, 'long-lead hook exposes receipt status')
assert.match(hook, /expectedDeliveryDate/, 'long-lead hook exposes delivery date')

;[
  'Need Date',
  'Lead + Buffer',
  'Order By',
  'Delivery',
  'Warehouse',
  'Activity',
  'Risk',
].forEach((label) => {
  assert.ok(table.includes(label), `long-lead table renders ${label}`)
})

assert.match(
  table,
  /warehouseStatus: e\.target[\s\S]+LongLeadPayload\['warehouseStatus'\]/,
  'warehouse transition updates are wired'
)
assert.match(
  schedule,
  /useLongLeadItems\(projectId\)/,
  'schedule dashboard consumes procurement risk data'
)
assert.ok(schedule.includes('Proc Risk'), 'schedule activities show risk column')
assert.ok(schedule.includes('procurementAlerts'), 'schedule alert list exists')
assert.ok(
  schedule.includes("action: 'acknowledge'") &&
    schedule.includes("action: 'resolve'"),
  'schedule risk banner wires alert acknowledgement and resolution actions'
)
assert.ok(
  gantt.includes('procurementRiskSummary'),
  'Gantt consumes schedule procurement risk summaries'
)
assert.ok(
  gantt.includes('Procurement Risk'),
  'Gantt legend renders procurement risk marker'
)
assert.ok(health.includes('topRisks'), 'health dashboard renders top risks')

console.log('Procurement risk UI assertions passed')
