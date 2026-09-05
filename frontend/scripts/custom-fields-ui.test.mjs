import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-PLAT-FIELDS-025 — custom fields, fieldsets and record types wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/custom-fields/hooks/use-custom-fields.ts')
const inputs = read('src/features/custom-fields/components/custom-field-inputs.tsx')
const panel = read('src/features/custom-fields/components/custom-fields-panel.tsx')
const admin = read('src/features/custom-fields/components/custom-fields-admin.tsx')
const companyPage = read('src/features/company/custom-fields.tsx')
const companyNav = read('src/features/company/index.tsx')
const companyRoute = read('src/routes/_authenticated/company/custom-fields.tsx')
const recordList = read('src/features/workflows/components/workflow-record-list.tsx')
const rfiCreate = read('src/features/doc-control/components/rfi-create-dialog.tsx')
const rfiDetail = read('src/features/doc-control/components/rfi-detail-dialog.tsx')
const submittalDetail = read('src/features/doc-control/components/submittal-detail-dialog.tsx')
const punchDetail = read('src/features/punch/components/punch-item-detail.tsx')
const changeOrders = read('src/features/commercial/components/change-order-register.tsx')
const commitments = read('src/features/commercial/components/commitment-dialogs.tsx')
const payApps = read('src/features/commercial/components/pay-app-dialogs.tsx')
const docControl = read('src/features/doc-control/components/doc-control-dashboard.tsx')
const docControlHooks = read('src/features/doc-control/hooks/use-doc-control.ts')
const teamPanel = read('src/features/permissions/components/project-team-panel.tsx')
const permissions = read('src/lib/permissions.ts')
const policy = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))

// hooks — company + project scopes, schema, values, record types, helpers
for (const name of [
  'useCustomFieldRecordTypes',
  'useCustomFieldDefinitions',
  'useSaveCustomFieldDefinition',
  'useArchiveCustomFieldDefinition',
  'useCustomFieldsets',
  'useSaveCustomFieldset',
  'useArchiveCustomFieldset',
  'useRecordTypes',
  'useSaveRecordType',
  'useArchiveRecordType',
  'useProjectFieldsets',
  'useSetProjectFieldset',
  'useCustomFieldSchema',
  'useCustomFieldValues',
  'useSetCustomFieldValues',
  'evaluateCondition',
  'visibleFields',
  'missingRequired',
  'defaultValues',
  'formatCustomValue',
]) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /'\/company\/custom-fields'/, 'company definitions endpoint')
assert.match(hooks, /\/projects\/\$\{projectId\}\/custom-fields\/definitions/, 'project definitions endpoint')
assert.match(hooks, /\/custom-fields\/schema`/, 'schema endpoint')
assert.match(hooks, /\/custom-fields\/values\/\$\{recordType\}\/\$\{recordId\}`/, 'values endpoint')
assert.match(hooks, /'\/company\/custom-fieldsets'/, 'fieldsets endpoint')
assert.match(hooks, /'\/company\/record-types'/, 'record types endpoint')
assert.match(hooks, /\/custom-fields\/assignments`/, 'project fieldset assignment endpoint')
assert.match(hooks, /invalidateQueries\(\{ queryKey: \['audit-events', projectId\] \}\)/, 'history refreshes after a save')

// inputs — one control per type, conditional visibility
for (const type of ['textarea', 'number', 'date', 'boolean', 'select', 'multi_select', 'user', 'company', 'url']) {
  assert.match(inputs, new RegExp(`case '${type}'`), `${type} input`)
}
assert.match(inputs, /<UserPicker/, 'people picked from the team')
assert.match(inputs, /<CompanyPicker/, 'companies picked from the parties')
assert.match(inputs, /visibleFields\(fields, values, context\)/, 'hidden and conditional fields left out')
assert.match(inputs, /data-testid='uat-custom-fields-form'/, 'form marker')

// panel — loads schema + values per record, saves with the record's module permission
assert.match(panel, /data-testid='uat-custom-fields-panel'/, 'panel marker')
assert.match(panel, /useCanPerform\(moduleName, 'update'\)/, 'edit follows the record module')
assert.match(panel, /data-testid='uat-custom-fields-save'/, 'save button')
assert.match(panel, /if \(isLoading \|\| !data \|\| data\.fields\.length === 0\) return null/, 'nothing rendered without fields')

// admin — fields, fieldsets, record types, project assignment
assert.match(admin, /data-testid='uat-custom-fields-admin'/, 'admin marker')
assert.match(admin, /data-testid='uat-custom-field-new'/, 'new field')
assert.match(admin, /data-testid='uat-custom-field-type'/, 'field type picker')
assert.match(admin, /data-testid='uat-custom-field-required'/, 'required switch')
assert.match(admin, /data-testid='uat-custom-field-conditional'/, 'conditional switch')
assert.match(admin, /data-testid='uat-custom-field-options'/, 'options editor')
assert.match(admin, /data-testid='uat-fieldset-new'/, 'new fieldset')
assert.match(admin, /data-testid='uat-fieldset-entry'/, 'fieldset entries with required / hidden overrides')
assert.match(admin, /data-testid='uat-record-type-new'/, 'new record type')
assert.match(admin, /data-testid='uat-record-type-fieldset'/, 'record type picks a fieldset')
assert.match(admin, /data-testid='uat-project-fieldset'/, 'project fieldset assignment')
assert.match(admin, /valueCount \?\? 0\) > 0/, 'type locked once values exist')

// company page + navigation + project team page
assert.match(companyPage, /<CustomFieldsAdmin projectId=\{null\} \/>/, 'company library')
assert.match(companyNav, /href: '\/company\/custom-fields'/, 'company nav')
assert.match(companyRoute, /'\/_authenticated\/company\/custom-fields'/, 'route')
assert.match(teamPanel, /<CustomFieldsAdmin projectId=\{projectId\} \/>/, 'project-level fields on the Team page')

// shown on records: every workflow register + the detail dialogs + create forms
assert.match(recordList, /<CustomFieldsPanel[\s\S]*?recordTypeKey=\{[\s\S]*?recordTypeKey/, 'registers show the panel with the record type key')
assert.match(rfiDetail, /<CustomFieldsPanel[\s\S]*?recordType='rfi'/, 'RFI detail')
assert.match(submittalDetail, /<CustomFieldsPanel[\s\S]*?recordType='submittal'/, 'submittal detail')
assert.match(punchDetail, /<CustomFieldsPanel[\s\S]*?recordType='punch_item'/, 'punch item detail')
assert.match(changeOrders, /<CustomFieldsPanel[\s\S]*?recordType='change_order'/, 'change orders')
assert.match(commitments, /<CustomFieldsPanel[\s\S]*?recordType='commitment'/, 'commitments')
assert.match(payApps, /<CustomFieldsPanel[\s\S]*?recordType='sub_pay_app'/, 'pay applications')
assert.match(rfiCreate, /useCustomFieldSchema\(projectId, 'rfi'\)/, 'RFI form loads the schema')
assert.match(rfiCreate, /data-testid='uat-rfi-custom-fields'/, 'RFI form shows the fields')
assert.match(rfiCreate, /missingRequired\(/, 'required custom fields checked before create')
assert.match(rfiCreate, /saveCustomValues\.mutateAsync\(\{[\s\S]*?recordType: 'rfi'/, 'values saved after create')
assert.match(docControl, /useRecordTypes\('correspondence'\)/, 'correspondence record types')
assert.match(docControl, /data-testid='uat-correspondence-record-type'/, 'record type picker on create')
assert.match(docControl, /recordTypeKey: selectedType\?\.key \?\? null/, 'record type sent on create')
assert.match(docControlHooks, /recordTypeKey\?: string \| null/, 'correspondence carries its record type')

// permissions
assert.match(permissions, /\| 'custom_field'/, 'custom_field module typed')
assert.ok(policy.modules.custom_field, 'custom_field module in policy')
assert.ok(policy.modules.custom_field.transitions['custom_field.manage'], 'manage transition')
for (const party of ['owner', 'consultant', 'contractor', 'subcontractor']) {
  assert.ok(policy.partyPermissions[party].modules.custom_field, `${party} party can read custom fields`)
}

console.log('custom-fields-ui: ok')
