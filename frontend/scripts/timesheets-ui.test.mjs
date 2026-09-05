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
assert.match(service, /costRecord\.update\(\{ where: \{ id: record\.id \}, data: \{ actual: \{ increment: amount \}/, 'labour cost posted to the activity')
assert.match(service, /budgetLine\.update\(\{ where: \{ id: line\.id \}, data: \{ actual: \{ increment: amount \} \} \}\)/, 'labour cost posted to the budget line')
assert.match(service, /actual: \{ decrement: posted \}/, 'reopen reverses the posting')
assert.match(reportSources, /time_entry: \{/, 'report source')
assert.match(recordLinks, /timesheet: \{ module: "site-reporting" \}/, 'record link')
assert.match(attachments, /timesheet: "timesheet"/, 'attachments on timesheets')
for (const model of ['Worker', 'Crew', 'CrewMember', 'Timesheet', 'TimeEntry']) assert.match(schema, new RegExp(`^model ${model} \\{`, 'm'), `${model} model`)
assert.match(schema, /activity  Activity\?    @relation\(fields: \[activityId\], references: \[id\], onDelete: SetNull\)/, 'time entries link to activities')

console.log('timesheets-ui: ok')
