import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relativePath) =>
  readFileSync(join(here, '..', relativePath), 'utf8')

const schema = read('src/features/schedule/data/schema.ts')
const gantt = read('src/features/schedule/components/gantt-chart.tsx')
const dashboard = read('src/features/schedule/components/schedule-dashboard.tsx')

assert.match(
  schema,
  /activityCode:\s*z\.string\(\)\.nullable\(\)/,
  'official schedule activity schema requires nullable activityCode',
)
assert.match(
  schema,
  /dataDate:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/,
  'schedule schema accepts backend dataDate',
)
assert.doesNotMatch(
  gantt,
  /activity\.activityCode\s*\|\|\s*activity\.p6ActivityId\s*\|\|\s*activity\.wbsCode/,
  'Gantt Activity ID fallback does not use WBS before generated fallback',
)
assert.match(
  dashboard,
  /Activity ID/,
  'schedule activity table has a first-class Activity ID column',
)

console.log('schedule activity code schema assertions passed')
