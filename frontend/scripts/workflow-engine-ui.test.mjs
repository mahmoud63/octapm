import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-PLAT-WF-024 — configurable workflow engine wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/workflows/hooks/use-workflow-engine.ts')
const editor = read('src/features/workflows/components/workflow-template-editor.tsx')
const panel = read('src/features/workflows/components/workflow-instance-panel.tsx')
const mySteps = read('src/features/workflows/components/my-workflow-steps.tsx')
const companyPage = read('src/features/company/workflows.tsx')
const companyNav = read('src/features/company/index.tsx')
const companyRoute = read('src/routes/_authenticated/company/workflows.tsx')
const dashboard = read('src/features/dashboard/index.tsx')
const changeOrders = read('src/features/commercial/components/change-order-register.tsx')
const commitments = read('src/features/commercial/components/commitment-dialogs.tsx')
const payApps = read('src/features/commercial/components/pay-app-dialogs.tsx')
const permissions = read('src/lib/permissions.ts')
const policy = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))

// hooks — company and project scopes, instances, inbox
for (const name of [
  'useWorkflowTools',
  'useWorkflowTemplates',
  'useCreateWorkflowTemplate',
  'useUpdateWorkflowTemplate',
  'useArchiveWorkflowTemplate',
  'useSeedWorkflowDefaults',
  'useWorkflowInstances',
  'useWorkflowInstance',
  'useStartWorkflow',
  'useRespondWorkflow',
  'useCancelWorkflow',
  'useMyWorkflowSteps',
  'workspaceLink',
]) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /'\/company\/workflow-templates'/, 'company templates endpoint')
assert.match(hooks, /\/projects\/\$\{projectId\}\/workflows\/templates/, 'project templates endpoint')
assert.match(hooks, /\/projects\/\$\{projectId\}\/workflows\/instances/, 'instances endpoint')
assert.match(hooks, /'\/company\/workflow-templates\/defaults'/, 'seed defaults endpoint')
assert.match(hooks, /'\/workflows\/my-steps'/, 'cross-project inbox endpoint')
assert.match(hooks, /\/respond`/, 'respond endpoint')
assert.match(hooks, /\/cancel`/, 'cancel endpoint')
assert.match(hooks, /'change-orders',\s*'commitments',\s*'pay-apps'/, 'record caches invalidated after a decision')
assert.match(hooks, /export const CONDITION_OPS/, 'condition operators')
assert.match(hooks, /END_SUCCESS = 'end_success'/, 'end targets')

// editor — rules, three step types, assignees, responses with targets
assert.match(editor, /data-testid='uat-workflow-templates'/, 'template list')
assert.match(editor, /data-testid='uat-workflow-new'/, 'new template')
assert.match(editor, /data-testid='uat-workflow-seed'/, 'seed starters (company only)')
assert.match(editor, /data-testid='uat-workflow-tool'/, 'tool picker')
assert.match(editor, /data-testid='uat-workflow-rule'/, 'template rules')
assert.match(editor, /data-testid='uat-workflow-step'/, 'step cards')
assert.match(editor, /data-testid='uat-workflow-save'/, 'save')
assert.match(editor, /SelectItem value='permission_template'/, 'permission-template assignees')
assert.match(editor, /SelectItem value='party_role'/, 'party-role assignees')
assert.match(editor, /<UserPicker/, 'person assignees at project scope')
assert.match(editor, /Everyone must agree/, 'requireAll switch')
assert.match(editor, /Escalate to when overdue/, 'escalation roles')
assert.match(editor, /Finish – approved/, 'end targets in selects')
assert.match(editor, /step\.type === 'condition'/, 'branch steps')
assert.match(editor, /step\.type === 'action'/, 'notify steps')
assert.match(editor, /startStep: draft\.steps\[0\]\?\.key/, 'first step starts the run')
assert.match(editor, /const conditionValue/, 'typed condition values')

// instance panel — steps, my response, override, cancel, manual start
assert.match(panel, /data-testid='uat-workflow-panel'/, 'panel')
assert.match(panel, /useCanPerform\(\s*'workflow',\s*'update',\s*'workflow\.manage'\s*\)/, 'manage permission')
assert.match(panel, /useCanPerform\(\s*'workflow',\s*'read'\s*\)/, 'read permission')
assert.match(panel, /data-testid='uat-workflow-start'/, 'manual start')
assert.match(panel, /uat-workflow-respond-/, 'response buttons')
assert.match(panel, /Decide on behalf of the assignees/, 'manager override')
assert.match(panel, /Cancel workflow/, 'cancel')
assert.match(panel, /applyStatus === 'failed'/, 'apply failure surfaced')
assert.match(panel, /needs a comment/, 'comment required for negative responses')
assert.match(panel, /export function WorkflowResponseForm/, 'response form shared with the dashboard')

// embedded on the records the engine decides
assert.match(changeOrders, /<WorkflowInstancePanel[\s\S]*?tool='change_order'/, 'change orders show the workflow')
assert.match(commitments, /<WorkflowInstancePanel[\s\S]*?tool='commitment'/, 'commitments show the workflow')
assert.match(payApps, /<WorkflowInstancePanel[\s\S]*?tool='sub_pay_app'/, 'pay apps show the workflow')

// dashboard inbox
assert.match(mySteps, /data-testid='uat-my-workflow-steps'/, 'dashboard section')
assert.match(mySteps, /useMyWorkflowSteps\(projectId\)/, 'inbox query')
assert.match(mySteps, /to='\/projects\/\$projectId'/, 'opens the record')
assert.match(dashboard, /<MyWorkflowStepsSection \/>/, 'dashboard renders the section')

// company page + navigation
assert.match(companyPage, /<WorkflowTemplateList projectId=\{null\} canEdit \/>/, 'company library')
assert.match(companyNav, /href: '\/company\/workflows'/, 'company nav')
assert.match(companyRoute, /'\/_authenticated\/company\/workflows'/, 'route')

// permissions
assert.match(permissions, /\| 'workflow'/, 'workflow permission module typed')
assert.ok(policy.modules.workflow, 'workflow module in policy')
assert.ok(policy.modules.workflow.transitions['workflow.respond'], 'respond transition')
assert.ok(policy.modules.workflow.transitions['workflow.manage'], 'manage transition')
for (const party of ['owner', 'consultant', 'contractor', 'subcontractor']) {
  assert.ok(policy.partyPermissions[party].modules.workflow, `${party} party can respond to workflows`)
}

console.log('workflow-engine-ui: ok')
