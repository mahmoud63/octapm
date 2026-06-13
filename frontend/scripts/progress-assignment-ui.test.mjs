import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const schema = read('src/features/schedule/data/schema.ts')
const progressTab = read('src/features/schedule/components/progress-tab.tsx')
const bulkProgress = read(
  'src/features/schedule/components/bulk-progress-update.tsx'
)

assert.match(
  schema,
  /assignedEngineers:\s*z\s*\.\s*array/,
  'schedule activities expose assignedEngineers'
)
assert.match(
  schema,
  /email:\s*z\.string\(\)/,
  'assigned engineer email is typed'
)

assert.match(
  progressTab,
  /useAuthStore/,
  'progress tab reads the current auth user'
)
assert.match(
  progressTab,
  /PROGRESS_ASSIGNMENT_OVERRIDE_ROLES.*pm.*planning_eng/s,
  'progress tab preserves PM and planning assignment overrides'
)
assert.match(
  progressTab,
  /activity\.assignedEngineers\?\.some/,
  'progress tab checks activity assignment before enabling progress submit'
)
assert.match(
  progressTab,
  /Only assigned users can submit progress for this activity/,
  'progress tab communicates unassigned progress submit lock'
)
assert.match(
  progressTab,
  /dailyReportActivities/,
  'daily report activity selection uses assignment-aware options'
)

assert.match(
  bulkProgress,
  /useAuthStore/,
  'bulk progress reads the current auth user'
)
assert.match(
  bulkProgress,
  /activity\.assignedEngineers\?\.some/,
  'bulk progress filters activities by assignment'
)
assert.match(
  bulkProgress,
  /ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED/,
  'bulk progress maps assignment failures to a clear toast'
)

console.log('Progress assignment UI assertions passed')
