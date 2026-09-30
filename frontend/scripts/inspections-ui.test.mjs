import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/inspections/hooks/use-forms.ts')
;[
  '/projects/${projectId}/forms',
  '/projects/${projectId}/forms/${instanceId}',
  '/projects/${projectId}/forms/${instanceId}/responses',
  '/projects/${projectId}/forms/${instanceId}/${action}',
  '/projects/${projectId}/forms/${instanceId}/signatures',
  '/projects/${projectId}/forms/${instanceId}/items/${itemId}/deficiency',
  '/projects/${projectId}/forms/${instanceId}/export.pdf',
  '/projects/${projectId}/forms/hold-points',
  '/projects/${projectId}/forms/templates',
  '/company/form-templates',
  '/company/form-templates/starters',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
assert.match(hooks, /\['forms', projectId, filters\]/, 'instance list key keeps projectId at index 1')
assert.match(hooks, /FORM_INCOMPLETE/, 'completion problems parsed from the API error')
assert.match(hooks, /responseType: 'blob'/, 'PDF export goes through the authenticated client')

// ── Template editor / list ──────────────────────────────────────────────
const editor = read('src/features/inspections/components/template-editor.tsx')
;['uat-template-editor', 'uat-template-name', 'uat-template-type', 'uat-template-add-section', 'uat-template-add-item', 'uat-template-item', 'uat-template-item-label', 'uat-template-item-type', 'uat-template-item-hold', 'uat-template-save'].forEach((id) =>
  assert.ok(editor.includes(id), `editor exposes ${id}`)
)
;["'pass_fail'", "'photo'", "'signature'", "'choice'", "'number'"].forEach((type) => assert.ok(editor.includes(type) || hooks.includes(type), `response type ${type}`))
assert.match(editor, /Hold point \(blocks[\s\S]*?progress approval\)/, 'hold point explained')
assert.match(editor, /isSystem/, 'migrated templates keep their structure')
const list = read('src/features/inspections/components/template-list.tsx')
;['uat-template-list', 'uat-template-new', 'uat-template-card', 'uat-template-copy', 'uat-template-schedule', 'uat-template-starters'].forEach((id) =>
  assert.ok(list.includes(id), `template list exposes ${id}`)
)
assert.match(list, /Copy to project/, 'company templates can be copied into a project')

// ── Instances ───────────────────────────────────────────────────────────
const create = read('src/features/inspections/components/instance-create-dialog.tsx')
;['uat-inspection-create', 'uat-inspection-template', 'uat-inspection-activity', 'uat-inspection-recurrence', 'uat-inspection-create-submit'].forEach((id) =>
  assert.ok(create.includes(id), `create dialog exposes ${id}`)
)
assert.match(create, /useActivities\(projectId\)/, 'instances link to an activity')
const instanceList = read('src/features/inspections/components/instance-list.tsx')
;['uat-inspection-list', 'uat-inspection-search', 'uat-inspection-type', 'uat-inspection-status', 'uat-inspection-mine', 'uat-inspection-overdue', 'uat-inspection-row', 'uat-inspection-new', 'uat-inspection-summary-holdpoints'].forEach((id) =>
  assert.ok(instanceList.includes(id), `instance list exposes ${id}`)
)
const runner = read('src/features/inspections/components/instance-runner.tsx')
;[
  'uat-inspection-runner',
  'uat-inspection-item',
  'uat-inspection-actions',
  'uat-inspection-start',
  'uat-inspection-complete',
  'uat-inspection-close',
  'uat-inspection-reopen',
  'uat-inspection-add-signature',
  'uat-inspection-export',
  'uat-inspection-problems',
  'uat-inspection-holdpoints',
  'uat-inspection-raise-punch',
  'uat-inspection-item-photos',
  'uat-inspection-sign',
  'uat-inspection-sign-submit',
  'uat-inspection-reason',
].forEach((id) => assert.ok(runner.includes(id), `runner exposes ${id}`))
assert.ok(runner.includes('uat-inspection-answer-${option.value}'), 'answer buttons carry test ids')
assert.match(runner, /useCanPerform\(\s*'inspection',\s*'submit',\s*'inspection\.complete'\s*\)/, 'complete gated by transition')
assert.match(runner, /useCanPerform\(\s*'inspection',\s*'approve',\s*'inspection\.close'\s*\)/, 'close gated by transition')
assert.match(runner, /useCanPerform\('punch', 'create'\)/, 'raising a punch item needs punch create')
assert.match(runner, /recordType='form_response'/, 'photos attach to the answer')
assert.match(runner, /<AttachmentPanel[\s\S]*?recordType='form_instance'/, 'evidence on the instance')
assert.match(runner, /<CommentThread[\s\S]*?recordType='form_instance'/, 'discussion on the instance')
assert.match(runner, /<HistoryPanel[\s\S]*?entityType='form_instance'/, 'history on the instance')
assert.match(runner, /completionProblemsFrom\(error\)/, 'incomplete completion lists the problems')
assert.match(read('src/features/inspections/components/signature-pad.tsx'), /toDataURL\('image\/png'\)/, 'signature exported as PNG')

// ── Module and wiring ───────────────────────────────────────────────────
const module_ = read('src/features/inspections/components/inspections-module.tsx')
// P21-011: an ITP deep link names a legacy ITP, not a form instance.
const inspectionsModule = read('src/features/inspections/components/inspections-module.tsx')
assert.match(inspectionsModule, /initialTarget\?\.source === 'itp'/, 'source=itp is recognised')
assert.match(inspectionsModule, /legacyRecordId \? null : \(initialTarget\?\.recordId \?\? null\)/, 'an itp id never opens the instance runner')
assert.match(inspectionsModule, /useState\(Boolean\(legacyRecordId\)\)/, 'the legacy register opens for an itp deep link')
assert.match(read('src/features/quality/components/quality-dashboard.tsx'), /recordType='itp'[\s\S]*?initialSelectedId=\{[\s\S]*?source === 'itp'/, 'the ITP register selects the deep-linked record')
;['uat-inspections-module', 'uat-inspections-tab-templates', 'uat-inspections-legacy-toggle'].forEach((id) =>
  assert.ok(module_.includes(id), `module exposes ${id}`)
)
assert.match(module_, /useCanPerform\(\s*'inspection',\s*'update',\s*'inspection\.template_admin'\s*\)/, 'template editing gated')
const quality = read('src/features/quality/components/quality-dashboard.tsx')
assert.match(quality, /<InspectionsModule/, 'quality dashboard hosts the inspections module')
assert.match(read('src/features/projects/components/project-detail.tsx'), /label: 'Inspections'/, 'workspace child label')
assert.match(read('src/lib/permissions.ts'), /\| 'inspection'/, 'inspection permission module typed')
assert.match(read('src/features/projects/lib/project-modules.ts'), /'punch', 'inspection'\]/, 'quality workspace backed by inspection')
assert.match(read('src/features/attachments/components/attachment-panel.tsx'), /form_response: 'inspection'/, 'answer photos guarded by inspection')
assert.match(read('src/features/drawings/hooks/use-markups.ts'), /'form_instance'/, 'pins can target inspections')
assert.match(read('src/features/company/index.tsx'), /\/company\/form-templates/, 'company nav has the template library')
// The page lives under the workspace (ENT-4); the old path is kept only as a
// component-less child of the redirecting legacy /company layout.
const workspaceFormTemplates = read('src/routes/_authenticated/o/$orgSlug/company/form-templates.tsx')
assert.match(workspaceFormTemplates, /import \{ CompanyFormTemplates \} from '@\/features\/company\/form-templates'/, 'company route imports the library page')
assert.match(workspaceFormTemplates, /createFileRoute\('\/_authenticated\/o\/\$orgSlug\/company\/form-templates'\)\(\{\s*component: CompanyFormTemplates,/, 'company route')
assert.doesNotMatch(read('src/routes/_authenticated/company/form-templates.tsx'), /component:/, 'the legacy company path renders nothing of its own')
assert.match(read('src/routes/_authenticated/company/route.tsx'), /beforeLoad: legacyWorkspaceRedirect/, 'the legacy company path redirects into the workspace')

// ── Backend contract ────────────────────────────────────────────────────
const service = read('../backend/src/services/form.service.js')
;['createTemplate', 'updateTemplate', 'duplicateTemplate', 'seedStarterTemplates', 'createInstance', 'respond', 'completeInstance', 'sign', 'raiseDeficiency', 'openHoldPoints', 'exportInstancePdf'].forEach((symbol) =>
  assert.ok(service.includes(symbol), `service implements ${symbol}`)
)
assert.match(service, /FORM_ITEM_IN_USE/, 'answered items cannot be removed from a template')
assert.match(service, /FORM_INCOMPLETE/, 'completion validated server-side')
assert.match(read('../backend/src/services/progress.service.js'), /ITP_HOLD_POINT_OPEN/, 'progress approval blocked by open hold points')
const policy = JSON.parse(read('../shared/permissions.json'))
assert.ok(policy.modules.inspection, 'inspection module in the policy')
// The quality engineer joined the closers in aceaef7.
assert.deepEqual(policy.modules.inspection.transitions['inspection.close'], ['pm', 'planning_eng', 'quality_engineer'], 'PM / planning / quality close by base policy')
assert.ok(policy.partyPermissions.subcontractor.modules.inspection.transitions.includes('inspection.complete'), 'subcontractors can complete')
assert.ok(!policy.partyPermissions.subcontractor.modules.inspection.transitions.includes('inspection.close'), 'subcontractors cannot close')
const migration = read('../backend/prisma/migrations/20260906080000_add_form_templates/migration.sql')
;['CREATE TABLE "FormTemplate"', 'CREATE TABLE "FormInstance"', 'CREATE TABLE "FormItemResponse"', 'CREATE TABLE "Signature"', 'FROM "ItpRecord"', '"legacyItpId"'].forEach((statement) =>
  assert.ok(migration.includes(statement), `migration has ${statement}`)
)
assert.match(read('../backend/src/routes/projects.js'), /\/:projectId\/forms\/templates/, 'template router mounted before instances')
assert.match(read('../backend/src/routes/company-workspace.js'), /\/form-templates\/starters/, 'starter templates route')

console.log('inspections-ui: ok')
