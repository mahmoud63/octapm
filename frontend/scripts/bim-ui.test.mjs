import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-BIM-IFC-043 — IFC models, elements and links wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const backend = (rel) => readFileSync(path.join(root, '..', 'backend', rel), 'utf8')

const hooks = read('src/features/bim/hooks/use-bim.ts')
const panel = read('src/features/bim/components/bim-panel.tsx')
const browser = read('src/features/bim/components/bim-model-browser.tsx')
const elementDialog = read('src/features/bim/components/bim-element-dialog.tsx')
const linkActions = read('src/features/bim/components/bim-link-actions.tsx')
const projectDetail = read('src/features/projects/components/project-detail.tsx')
const modules = read('src/features/projects/lib/project-modules.ts')
const permissionsTs = read('src/lib/permissions.ts')
const permissions = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))
const parser = backend('src/parsers/ifc-parser.js')
const bimService = backend('src/services/bim.service.js')
const bimRoutes = backend('src/routes/bim.js')
const projectsRoutes = backend('src/routes/projects.js')
const jobService = backend('src/jobs/job.service.js')
const jobHandlers = backend('src/jobs/handlers/index.js')
const fileStorage = backend('src/services/file-storage.service.js')
const reportSources = backend('src/services/report-sources.js')
const recordLinks = backend('src/utils/record-links.js')
const attachments = backend('src/services/attachment.service.js')
const schema = backend('prisma/schema.prisma')
const spec = backend('src/openapi/spec.js')

for (const name of ['useBimModels', 'useBimModel', 'useBimSpatial', 'useBimElements', 'useBimElement', 'useBimQuantities', 'useBimLinks', 'useBimElementsForRecord', 'useUploadBimModel', 'useUpdateBimModel', 'useReparseBimModel', 'useDeleteBimModel', 'useCreateBimLinks', 'useDeleteBimLink']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /useInfiniteQuery/, 'elements are cursor-paged')
assert.match(hooks, /refetchInterval/, 'the list polls while a model is being read')
assert.match(hooks, /\/models\/\$\{modelId\}\/quantities`/, 'quantities endpoint')
assert.match(hooks, /\/records\/\$\{recordType\}\/\$\{recordId\}\/elements`/, 'elements-for-record endpoint')

assert.match(panel, /export function BimPanel/, 'panel')
for (const id of ['bim', 'bim-new', 'bim-models', 'bim-upload', 'bim-upload-file', 'bim-upload-confirm', 'bim-reparse', 'bim-delete']) {
  assert.match(panel, new RegExp(`data-testid='uat-${id}'`), `panel ${id}`)
}
assert.match(browser, /export function BimModelBrowser/, 'browser')
for (const id of ['bim-browser', 'bim-spatial', 'bim-types', 'bim-search', 'bim-elements', 'bim-quantities', 'bim-export', 'bim-load-more']) {
  assert.match(browser, new RegExp(`data-testid='uat-${id}'`), `browser ${id}`)
}
assert.match(browser, /useCanPerform\(\s*'bim',\s*'export'\s*\)/, 'export gated')
assert.match(elementDialog, /export function BimElementDialog/, 'element dialog')
assert.match(elementDialog, /data-testid='uat-bim-element-dialog'/, 'element dialog test id')
assert.match(elementDialog, /data-testid='uat-bim-element-links'/, 'element links')
assert.match(linkActions, /export function BimLinkActions/, 'link actions')
for (const id of ['bim-link', 'bim-link-record', 'bim-link-location', 'bim-link-location-confirm']) {
  assert.match(linkActions, new RegExp(`data-testid='uat-${id}'`), `link ${id}`)
}
assert.match(linkActions, /useCanPerform\(\s*'bim',\s*'update',\s*'bim\.link'\s*\)/, 'linking gated by the transition')
assert.match(linkActions, /allowedTypes=\{\['activity', 'boq_item', 'rfi'\]\}/, 'record picker limited to linkable types')

assert.match(projectDetail, /\{ key: 'bim', label: 'BIM' \}/, 'sidebar entry')
assert.match(projectDetail, /case 'bim':/, 'module rendered')
assert.match(projectDetail, /import\('@\/features\/bim\/components\/bim-panel'\)/, 'module is its own chunk')
assert.match(modules, /\| 'bim'/, 'module key')
assert.match(modules, /bim: 'bim',/, 'module slug')
assert.match(modules, /bim: \['bim'\],/, 'module permission')
assert.match(permissionsTs, /\| 'bim'/, 'permission module union')

assert.equal(permissions.modules.bim.label, 'BIM')
assert.deepEqual(permissions.modules.bim.transitions['bim.link'], ['pm', 'planning_eng', 'qs', 'site_engineer'])
assert.deepEqual(permissions.modules.bim.actions.delete, ['pm'])
assert.deepEqual(permissions.partyPermissions.contractor.modules.bim, { actions: ['read', 'update', 'export'], transitions: ['bim.link'] })
assert.deepEqual(permissions.partyPermissions.subcontractor.modules.bim, { actions: ['read'], transitions: [] })

assert.match(parser, /const parseIfc = /, 'string parser')
assert.match(parser, /const parseIfcFile = /, 'streaming file parser')
assert.match(parser, /SKIP_TYPES/, 'geometry entities are skipped while scanning')
assert.match(parser, /IFCRELCONTAINEDINSPATIALSTRUCTURE/, 'spatial containment')
assert.match(parser, /IFCRELDEFINESBYPROPERTIES/, 'property sets')
assert.match(bimService, /runBimParseJob/, 'parse job')
assert.match(bimService, /BIM_LINK_RECORD_TYPE_INVALID/, 'link record types validated')
assert.match(bimService, /BULK_LINK_LIMIT/, 'bulk link cap')
assert.match(bimService, /const refreshCounts/, 'link counts kept')
assert.match(jobService, /BIM_PARSE: "bim\.parse"/, 'job type')
assert.match(jobHandlers, /JOB_TYPES\.BIM_PARSE/, 'job handler registered')
assert.match(fileStorage, /BIM_MODEL: 'bim_model'/, 'document type')
assert.match(fileStorage, /allowedExtensions: \['\.ifc'\]/, 'ifc only')
assert.match(bimRoutes, /"\/models\/:modelId\/elements\/export\.xlsx"/, 'export route')
assert.ok(
  bimRoutes.indexOf('"/models/:modelId/elements/export.xlsx"') < bimRoutes.indexOf('"/models/:modelId/elements/:elementId"'),
  'the export route is declared before the element route',
)
assert.match(bimRoutes, /transition: "bim\.link"/, 'link transition')
assert.match(projectsRoutes, /"\/:projectId\/bim",\s*nestedProjectAccess,\s*require\("\.\/bim"\)/, 'routes mounted')
assert.match(reportSources, /bim_element: \{/, 'report source')
assert.match(recordLinks, /bim_model: \{ module: "bim" \}/, 'record link')
assert.match(attachments, /bim_model: "bim"/, 'attachments')
for (const model of ['BimModel', 'BimElement', 'BimElementLink']) {
  assert.match(schema, new RegExp(`^model ${model} \\{`, 'm'), `${model} model`)
}
assert.match(spec, /\/projects\/\{projectId\}\/bim\/models\/\{modelId\}\/elements/, 'elements documented')
assert.match(spec, /\/projects\/\{projectId\}\/bim\/records\/\{recordType\}\/\{recordId\}\/elements/, 'record elements documented')

console.log('bim-ui: ok')
