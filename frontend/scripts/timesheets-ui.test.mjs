import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-FLD-TIME-037 — timesheets and crews wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const backend = (rel) => readFileSync(path.join(root, '..', 'backend', rel), 'utf8')

const hooks = read('src/features/timesheets/hooks/use-timesheets.ts')
const panel = read('src/features/timesheets/components/timesheets-panel.tsx')
const editor = read('src/features/timesheets/components/timesheet-editor.tsx')
const crews = read('src/features/timesheets/components/crews-panel.tsx')
const productivity = read('src/features/timesheets/components/productivity-panel.tsx')
const dashboard = read('src/features/site-reporting/components/site-reporting-dashboard.tsx')
const projectDetail = read('src/features/projects/components/project-detail.tsx')
const permissionsTs = read('src/lib/permissions.ts')
const permissions = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))
const projectsRoutes = backend('src/routes/projects.js')
const service = backend('src/services/timesheet.service.js')
const reportSources = backend('src/services/report-sources.js')
const recordLinks = backend('src/utils/record-links.js')
const attachments = backend('src/services/attachment.service.js')
const schema = backend('prisma/schema.prisma')

for (const name of ['useWorkers', 'useCreateWorker', 'useUpdateWorker', 'useImportWorkers', 'useCrews', 'useCreateCrew', 'useUpdateCrew', 'useDeleteCrew', 'useTimesheets', 'useTimesheetWeek', 'useTimesheet', 'useProductivity', 'useCreateTimesheet', 'useUpdateTimesheet', 'useDeleteTimesheet', 'useTimesheetTransition', 'downloadTimesheetsXlsx', 'weekStartOf', 'shiftDate']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /\/timesheets`/, 'base path')
assert.match(hooks, /\/\$\{timesheetId\}\/\$\{action\}`/, 'transition endpoint')
assert.match(hooks, /\/export\.xlsx`/, 'xlsx export')

assert.match(panel, /export function TimesheetsPanel/, 'panel')
assert.match(panel, /data-testid='uat-timesheets-week-grid'/, 'week grid')
assert.match(panel, /data-testid='uat-timesheets-new'/, 'new timesheet')
assert.match(panel, /data-testid='uat-timesheet-new-crew'/, 'crew picker on create')
assert.match(panel, /data-testid='uat-timesheets-export'/, 'xlsx button')
assert.match(panel, /<CrewsPanel/, 'crews tab')
assert.match(panel, /<ProductivityPanel/, 'productivity tab')

assert.match(editor, /export function TimesheetEditorDialog/, 'editor')
assert.match(editor, /data-testid='uat-timesheet-rows'/, 'entry rows')
assert.match(editor, /data-testid='uat-timesheet-add-worker'/, 'add worker row')
assert.match(editor, /data-testid='uat-timesheet-submit'/, 'submit')
assert.match(editor, /data-testid='uat-timesheet-approve'/, 'approve')
assert.match(editor, /data-testid='uat-timesheet-reject-confirm'/, 'return with reason')
assert.match(editor, /data-testid='uat-timesheet-reopen'/, 'reopen')
assert.match(editor, /useCanPerform\(\s*'timesheet',\s*'approve',\s*'timesheet\.approve'\s*\)/, 'approval gated by the transition')
assert.match(editor, /every entry needs one before submission/, 'activity requirement explained')
assert.match(editor, /entityType='timesheet'/, 'history on the timesheet')

assert.match(crews, /export function CrewsPanel/, 'crews panel')
assert.match(crews, /data-testid='uat-crew-new'/, 'new crew')
assert.match(crews, /data-testid='uat-crew-members'/, 'member picker')
assert.match(crews, /data-testid='uat-worker-new'/, 'new worker')
assert.match(crews, /data-testid='uat-worker-import-run'/, 'import')
assert.match(crews, /useCanPerform\(\s*'timesheet',\s*'create',\s*'timesheet\.worker_admin'\s*\)/, 'worker admin gated')
assert.match(productivity, /export function ProductivityPanel/, 'productivity')

assert.match(dashboard, /<TabsTrigger[^>]*value='timesheets'/, 'tab in Site Reporting')
assert.match(dashboard, /<TimesheetsPanel/, 'panel mounted')
assert.match(dashboard, /initialTimesheetId \? 'timesheets' : 'log'/, 'deep link opens the tab')
assert.match(projectDetail, /initialTarget\?\.source === 'timesheet'/, 'project page passes the timesheet')
assert.match(permissionsTs, /\| 'timesheet'/, 'permission module typed')
assert.ok(permissions.modules.timesheet, 'timesheet module in permissions.json')
assert.deepEqual(permissions.modules.timesheet.transitions['timesheet.approve'], ['pm', 'cost_controller'], 'approval roles')
for (const party of ['owner', 'consultant', 'contractor', 'subcontractor']) assert.ok(permissions.partyPermissions[party].modules.timesheet, `${party} party template has timesheet`)
assert.deepEqual(permissions.partyPermissions.subcontractor.modules.timesheet.transitions, ['timesheet.submit', 'timesheet.worker_admin'], 'subcontractors submit their own')

assert.match(projectsRoutes, /"\/:projectId\/timesheets",\s*nestedProjectAccess,\s*require\("\.\/timesheets"\)/, 'routes mounted')
assert.match(service, /TIMESHEET_ENTRY_ACTIVITY_REQUIRED/, 'activity required at submission')
// Actual cost is written only through the cost ledger (ef5b6f9; the certified
// rule "Actual Cost only from CostLedgerEntry"): approval posts each entry as
// labour with its activity and cost code, the ledger resolves the labour
// budget line for that code and applies the entry to both projections, and a
// reopen writes negative mirrors through the same path.
const ledger = backend('src/services/cost-ledger.service.js')
const postCall = service.match(/costLedger\.post\(\{([\s\S]*?)\n\s*\}\);/)
assert.ok(postCall, 'approval posts through the cost ledger')
assert.match(postCall[1], /sourceType: "timesheet",[\s\S]*\bamount,\s*costType: "labour",/, 'each entry posts its amount as labour')
assert.match(postCall[1], /activityId: entry\.activityId \|\| null,/, 'labour cost posted to the activity')
assert.match(postCall[1], /costCodeId: entry\.costCodeId \|\| null,\s*budgetLineId: entry\.budgetLineId \|\| null,/, 'labour cost posted to the budget line')
assert.match(ledger, /where: \{ projectId, costCodeId, costType, status: "active" \}/, 'the ledger finds the active budget line for the cost code and type')
assert.match(ledger, /budgetLine\.update\(\{\s*where: \{ id: entry\.budgetLineId \},\s*data: \{ actual: \{ increment: amount \} \},/, 'the ledger applies the entry to the budget line')
assert.match(ledger, /costRecord\.update\(\{\s*where: \{ id: record\.id \},\s*data: \{\s*actual: \{ increment: amount \},/, 'the ledger applies the entry to the activity')
assert.doesNotMatch(service, /actual: \{ (increment|decrement)/, 'the service never writes actual cost itself, around the ledger')
assert.match(service, /costLedger\.reverse\(\{ tx, orgId, projectId, sourceType: "timesheet", sourceId: timesheetId,/, 'reopen reverses the posting')
assert.match(ledger, /amount: round2\(-num\(original\.amount\)\),[\s\S]*?reversalOfId: original\.id,[\s\S]*?await applyToProjections\(\{ tx, entry \}\);/, 'a reversal is a negative mirror applied to the same projections')
// The pieces above are tied together, so none of them can be cut out of the
// path on its own: post() resolves the budget line, keeps it and the caller's
// activity on the entry it creates and applies that entry to the projections
// before reporting it posted; the first posting to an activity creates its
// cost record with the amount; and reverse() mirrors each of the source's
// originals onto the same budget line and activity and applies the mirror.
const ledgerSection = (from, to) => {
  const start = ledger.indexOf(from)
  const end = ledger.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `the ledger's ${from} body is found`)
  return ledger.slice(start, end)
}
const ledgerApply = ledgerSection('const applyToProjections = async', 'const post = async')
const ledgerPost = ledgerSection('const post = async', 'const reverse = async')
const ledgerReverse = ledgerSection('const reverse = async', 'const postedTotalFor = async')
assert.match(ledgerApply, /if \(entry\.budgetLineId\) \{\s*await tx\.budgetLine\.update\(\{\s*where: \{ id: entry\.budgetLineId \},/, "an entry with a budget line moves that line's actual")
assert.match(ledgerApply, /costRecord\.findFirst\(\{\s*where: \{ projectId: entry\.projectId, activityId: entry\.activityId \},/, "an entry with an activity finds that activity's cost record")
assert.match(ledgerApply, /costRecord\.create\(\{\s*data: \{\s*projectId: entry\.projectId,\s*activityId: entry\.activityId,\s*actual: amount,/, 'the first posting to an activity creates its cost record with the amount')
assert.match(ledgerPost, /const line = await resolveBudgetLine\(\{\s*tx,\s*projectId,\s*budgetLineId,\s*costCodeId,\s*costType: resolvedType,\s*\}\);/, 'post resolves the budget line from the one named, else the cost code and type')
const entryData = ledgerPost.match(/entry = await tx\.costLedgerEntry\.create\(\{\s*data: \{([^}]*)\},\s*\}\);/)
assert.ok(entryData, 'post creates the ledger entry')
assert.match(entryData[1], /\n\s*activityId,\r?\n/, 'the posted entry keeps the activity')
assert.match(entryData[1], /\n\s*budgetLineId: line\?\.id \|\| null,\r?\n/, 'the posted entry keeps the resolved budget line')
assert.match(entryData[1], /\n\s*amount: value,\r?\n/, 'the posted entry keeps the amount')
assert.match(ledgerPost, /\n\s*await applyToProjections\(\{ tx, entry \}\);\s*return \{ entry, posted: true \};/, 'the posted entry is applied to its projections before post reports it posted')
assert.match(ledgerReverse, /costLedgerEntry\.findMany\(\{\s*where: \{ orgId, projectId, sourceType, sourceId, reversalOfId: null \},/, "reverse mirrors this source's originals")
// The mirror's sourceKey is a template literal with braces in it, so its body
// is taken up to the line that closes the object.
const mirror = ledgerReverse.match(/const mirror = \{([\s\S]*?)\r?\n\s*\};/)
assert.ok(mirror, 'reverse builds a mirror of each original')
assert.match(mirror[1], /\n\s*activityId: original\.activityId,\r?\n/, 'the mirror carries the original activity')
assert.match(mirror[1], /\n\s*budgetLineId: original\.budgetLineId,\r?\n/, 'the mirror carries the original budget line')
assert.match(mirror[1], /\n\s*amount: round2\(-num\(original\.amount\)\),\r?\n/, 'the mirror is the negative of the original')
assert.match(mirror[1], /\n\s*reversalOfId: original\.id,\r?\n/, 'the mirror names the original it reverses')
assert.match(ledgerReverse, /const entry = await tx\.costLedgerEntry\.create\(\{ data: mirror \}\);\s*await applyToProjections\(\{ tx, entry \}\);/, 'the mirror is written and applied to the same projections')
assert.match(reportSources, /time_entry: \{/, 'report source')
assert.match(recordLinks, /timesheet: \{ module: "site-reporting" \}/, 'record link')
assert.match(attachments, /timesheet: "timesheet"/, 'attachments on timesheets')
for (const model of ['Worker', 'Crew', 'CrewMember', 'Timesheet', 'TimeEntry']) assert.match(schema, new RegExp(`^model ${model} \\{`, 'm'), `${model} model`)
assert.match(schema, /activity  Activity\?    @relation\(fields: \[activityId\], references: \[id\], onDelete: SetNull\)/, 'time entries link to activities')

console.log('timesheets-ui: ok')
