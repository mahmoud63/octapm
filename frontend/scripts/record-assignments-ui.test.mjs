import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Pickers emit ids, never free text ───────────────────────────────────
const picker = read('src/components/user-picker.tsx')
assert.match(picker, /export function UserPicker/, 'UserPicker exists')
assert.match(picker, /export function CompanyPicker/, 'CompanyPicker exists')
assert.match(picker, /useProjectTeam\(projectId\)/, 'pickers read the project team')
assert.match(picker, /onChange\(next === NONE \? null : next\)/, 'picker emits null or an id')

// ── Forms use the picker ────────────────────────────────────────────────
const riskForm = read('src/features/risks/components/risk-form-dialog.tsx')
assert.match(riskForm, /<UserPicker/, 'risk form uses the user picker')
assert.match(riskForm, /ownerUserId: form\.ownerUserId \|\| null/, 'risk form submits ownerUserId')
assert.match(riskForm, /uat-risk-owner-picker/, 'risk picker has a test id')
const risksTable = read('src/features/risks/components/risks-table.tsx')
assert.match(risksTable, /<RiskFormDialog\s+projectId=\{projectId\}/, 'risk dialogs receive projectId')

const quality = read('src/features/quality/components/quality-dashboard.tsx')
assert.match(quality, /uat-closeout-responsible-picker/, 'closeout uses the user picker')
assert.match(quality, /assigneeUserId,\s*dueDate,/, 'closeout submits assigneeUserId')
assert.match(quality, /assigneeUserId: row\.assigneeUserId \?\? null/, 'closeout target carries the id')

// ── Record cards show referenced people and ball in court ───────────────
const recordList = read('src/features/workflows/components/workflow-record-list.tsx')
assert.match(recordList, /ownerUser\?: WorkflowUserRef \| null/, 'record meta typed with user refs')
assert.match(recordList, /row\.ownerUser\?\.name \|\| row\.owner/, 'referenced name wins over text')
assert.match(recordList, /Ball in court/, 'ball in court badge rendered')

// ── Dashboard: My open items ────────────────────────────────────────────
const dashboard = read('src/features/dashboard/index.tsx')
assert.match(dashboard, /myOpenItems\?: MyOpenItems/, 'dashboard type includes myOpenItems')
assert.match(dashboard, /uat-my-open-items/, 'dashboard renders My open items')
assert.match(dashboard, /<MyOpenItemsSection data=\{data\.myOpenItems\} \/>/, 'section wired')

// ── Backend contract ────────────────────────────────────────────────────
const support = read('../backend/src/services/workflow-support.service.js')
assert.match(support, /const deriveBallInCourt/, 'ball in court derivation exists')
assert.match(support, /ASSIGNMENT_USER_NOT_FOUND/, 'user ids are validated against the org')
const notifications = read('../backend/src/services/notification.service.js')
assert.ok(
  !notifications.includes('name: { equals: ref, mode: "insensitive" }'),
  'notifications no longer match recipients by name'
)
assert.match(notifications, /USER_REFERENCE_FIELDS/, 'notifications use reference columns')
const migration = read(
  '../backend/prisma/migrations/20260905170000_add_record_user_references/migration.sql'
)
assert.match(migration, /HAVING count\(\*\) = 1/, 'backfill requires a unique match')
assert.equal(
  (migration.match(/ADD COLUMN "ballInCourtUserId"/g) || []).length,
  1,
  'columns are added in a loop over every table'
)
const routes = read('../backend/src/routes/assignments.js')
assert.match(routes, /\/unresolved/, 'unresolved report route')
assert.match(routes, /\/resolve/, 'manual mapping route')
assert.match(routes, /\/mine/, 'my items route')

console.log('record-assignments-ui: ok')
