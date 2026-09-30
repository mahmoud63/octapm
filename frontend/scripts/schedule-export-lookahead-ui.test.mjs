import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-SCH-LOOKAHEAD-041 — schedule export (XER / P6 XML / MSP XML) and lookaheads wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const backend = (rel) => readFileSync(path.join(root, '..', 'backend', rel), 'utf8')

const hooks = read('src/features/lookahead/hooks/use-lookaheads.ts')
const panel = read('src/features/lookahead/components/lookahead-panel.tsx')
const board = read('src/features/lookahead/components/lookahead-board.tsx')
const dialog = read('src/features/lookahead/components/lookahead-item-dialog.tsx')
const exportButton = read('src/features/schedule/components/export-button.tsx')
const dashboard = read('src/features/schedule/components/schedule-dashboard.tsx')
const projectDetail = read('src/features/projects/components/project-detail.tsx')
const permissionsTs = read('src/lib/permissions.ts')
const permissions = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))
const projectsRoutes = backend('src/routes/projects.js')
const exportRoutes = backend('src/routes/export.js')
const lookaheadRoutes = backend('src/routes/lookaheads.js')
const exportService = backend('src/services/schedule-export.service.js')
const lookaheadService = backend('src/services/lookahead.service.js')
const mspParser = backend('src/parsers/msp-parser.js')
const importService = backend('src/services/import.service.js')
const reportSources = backend('src/services/report-sources.js')
const recordLinks = backend('src/utils/record-links.js')
const attachments = backend('src/services/attachment.service.js')
const schema = backend('prisma/schema.prisma')
const spec = backend('src/openapi/spec.js')

for (const name of ['useLookaheads', 'useLookahead', 'useLookaheadConstraints', 'useCreateLookahead', 'useUpdateLookahead', 'useDeleteLookahead', 'useLookaheadAction', 'useAddLookaheadItem', 'useUpdateLookaheadItem', 'useSetLookaheadItemStatus', 'useRemoveLookaheadItem', 'downloadFile']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /\/lookaheads`/, 'base path')
assert.match(hooks, /\/items\/\$\{itemId\}\/status`/, 'status endpoint')

assert.match(panel, /export function LookaheadPanel/, 'panel')
assert.match(panel, /data-testid='uat-lookaheads-new'/, 'new button')
assert.match(panel, /data-testid='uat-lookaheads-rows'/, 'register rows')
assert.match(panel, /data-testid='uat-lookahead-make-ready'/, 'make-ready log')
assert.match(panel, /data-testid='uat-lookahead-create'/, 'create in dialog')
assert.match(board, /export function LookaheadBoard/, 'board')
for (const id of ['refresh', 'add-task', 'publish', 'roll-forward', 'export', 'archive', 'delete', 'grid', 'ppc', 'roll-confirm']) {
  assert.match(board, new RegExp(`data-testid='uat-lookahead-${id}'`), `board ${id}`)
}
assert.match(board, /useCanPerform\(\s*'lookahead',\s*'submit',\s*'lookahead\.publish'\s*\)/, 'publish gated by the transition')
assert.match(board, /useCanPerform\(\s*'lookahead',\s*'update',\s*'lookahead\.archive'\s*\)/, 'archive gated by the transition')
assert.match(board, /entityType='lookahead'/, 'history')
assert.match(dialog, /export function LookaheadItemDialog/, 'task dialog')
for (const id of ['item', 'item-quick-status', 'item-reason', 'item-constraint', 'item-remove', 'item-save']) {
  assert.match(dialog, new RegExp(`data-testid='uat-lookahead-${id}'`), `dialog ${id}`)
}
assert.match(dialog, /useCanPerform\(\s*'lookahead',\s*'update',\s*'lookahead\.item_status'\s*\)/, 'status gated by the transition')

assert.match(exportButton, /data-testid='uat-schedule-export'/, 'export menu')
assert.match(exportButton, /uat-schedule-export-xlsx/, 'export xlsx')
assert.match(exportButton, /data-testid=\{`uat-schedule-export-\$\{format\.key\}`\}/, 'export per planner format')
for (const format of ['xer', 'p6xml', 'mspxml']) assert.match(exportButton, new RegExp(`key: '${format}'`), `export ${format}`)
assert.match(exportButton, /\/export\/schedule\/\$\{format\.key\}/, 'planner formats endpoint')
assert.match(exportButton, /useCanPerform\(\s*'schedule',\s*'export'\s*\)/, 'schedule export permission')

assert.match(dashboard, /<TabsTrigger value='lookahead'>Lookahead<\/TabsTrigger>/, 'tab')
assert.match(dashboard, /<LookaheadPanel/, 'panel mounted')
assert.match(dashboard, /initialTarget\?\.source === 'lookahead'/, 'deep link')
assert.match(projectDetail, /\{ key: 'lookahead', label: 'Lookahead' \}/, 'sidebar child')
assert.match(permissionsTs, /\| 'lookahead'/, 'permission module union')

assert.equal(permissions.modules.lookahead.label, 'Lookahead')
assert.deepEqual(permissions.modules.lookahead.transitions['lookahead.publish'], ['pm', 'planning_eng', 'site_engineer', 'quality_engineer'])
assert.deepEqual(permissions.modules.lookahead.transitions['lookahead.archive'], ['pm', 'planning_eng'])
assert.deepEqual(permissions.partyPermissions.subcontractor.modules.lookahead, { actions: ['read', 'update', 'export'], transitions: ['lookahead.item_status'] })
assert.deepEqual(permissions.partyPermissions.owner.modules.lookahead, { actions: ['read', 'export'], transitions: [] })

assert.match(projectsRoutes, /"\/:projectId\/lookaheads",\s*nestedProjectAccess,\s*require\("\.\/lookaheads"\)/, 'routes mounted')
assert.match(exportRoutes, /'\/schedule\/:format'/, 'export route')
assert.match(exportRoutes, /requirePermission\('schedule', 'export'\)/, 'export permission')
assert.match(lookaheadRoutes, /router\.get\("\/constraints"/, 'constraints route before :lookaheadId')
assert.ok(lookaheadRoutes.indexOf('router.get("/constraints"') < lookaheadRoutes.indexOf('router.get("/:lookaheadId"'), 'static route first')
assert.match(lookaheadRoutes, /transition: "lookahead\.item_status"/, 'status transition')

assert.match(exportService, /function writeXer/, 'XER writer')
assert.match(exportService, /function writeP6Xml/, 'P6 XML writer')
assert.match(exportService, /function writeMspXml/, 'MSP XML writer')
assert.match(exportService, /const TENTHS_OF_MINUTES_PER_DAY = 4800/, 'MSPDI tenths of minutes')
assert.match(exportService, /%E/, 'XER end marker')
assert.match(mspParser, /Math\.round\(n \/ TENTHS_OF_MINUTES_PER_DAY\)/, 'MSP parser reads tenths of minutes')
assert.match(importService, /tenthsOfMinutesToDays\(task\.totalSlackMinutes\)/, 'importer slack in tenths of minutes')
assert.match(lookaheadService, /LOOKAHEAD_VARIANCE_REASON_REQUIRED/, 'not done needs a reason')
assert.match(lookaheadService, /LOOKAHEAD_ITEM_FORBIDDEN/, 'subcontractor scoping')
assert.match(lookaheadService, /const computePpc/, 'PPC')
assert.match(lookaheadService, /const rollForward/, 'roll forward')
assert.match(reportSources, /lookahead_item: \{/, 'report source')
assert.match(recordLinks, /lookahead: \{ module: "schedule", child: "lookahead" \}/, 'record link')
assert.match(attachments, /lookahead: "lookahead"/, 'attachments')
for (const model of ['Lookahead', 'LookaheadItem']) assert.match(schema, new RegExp(`^model ${model} \\{`, 'm'), `${model} model`)
assert.match(spec, /\/projects\/\{projectId\}\/export\/schedule\/\{format\}/, 'export documented')
assert.match(spec, /\/projects\/\{projectId\}\/lookaheads\/\{lookaheadId\}\/roll-forward/, 'roll forward documented')

console.log('schedule-export-lookahead-ui: ok')
