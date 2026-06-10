import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relativePath) =>
  readFileSync(join(here, '..', relativePath), 'utf8')

const schema = read('src/features/schedule/data/schema.ts')
const gantt = read('src/features/schedule/components/gantt-chart.tsx')
const editDialog = read(
  'src/features/schedule/components/activity-inline-edit-dialog.tsx',
)
const dashboard = read(
  'src/features/schedule/components/schedule-dashboard.tsx',
)

for (const field of [
  'earlyStartDate',
  'earlyFinishDate',
  'lateStartDate',
  'lateFinishDate',
  'baselineStartDate',
  'baselineFinishDate',
]) {
  assert.ok(schema.includes(field), `schedule schema includes ${field}`)
}

assert.ok(
  gantt.includes('formatCalendarDate') &&
    gantt.includes('tooltip.activity.earlyStartDate') &&
    gantt.includes('tooltip.activity.earlyFinishDate'),
  'Gantt tooltip shows calendar-aware planned dates',
)

assert.ok(
  dashboard.includes('title={fmtDate(a.earlyStartDate)}') &&
    dashboard.includes('title={fmtDate(a.lateFinishDate)}'),
  'Schedule table exposes calendar dates on CPM cells',
)

assert.ok(
  editDialog.includes("['FS', 'SS', 'FF', 'SF']") &&
    editDialog.includes('lagDays') &&
    editDialog.includes('duplicatePredecessors'),
  'Activity editor keeps structured dependency controls and validation',
)

console.log('schedule dependency UI assertions passed')
