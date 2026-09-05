import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/doc-control/hooks/use-doc-control.ts')
;[
  '/projects/${projectId}/submittals/${submittalId}`',
  '/projects/${projectId}/submittals/${submittalId}/decide',
  '/projects/${projectId}/submittals/${submittalId}/people',
  '/projects/${projectId}/submittals/packages`',
  '/projects/${projectId}/submittals/packages/${packageId}/items',
  '/projects/${projectId}/submittals/packages/${packageId}/submit',
  '/projects/${projectId}/submittals/packages/${packageId}/decide',
  '/projects/${projectId}/submittals/workflow-templates',
  '/company/submittal-workflow-templates',
  '/company/submittal-workflow-templates/starters',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
;['packageId', 'workflowTemplateId', 'leadTimeWeeks', 'requiredOnSite', 'submitBy', 'responseCode', 'revisionNumber', 'scheduleImpactDays', 'managerUserId', 'distributionUserIds'].forEach((field) =>
  assert.ok(hooks.includes(field), `upgrade field ${field}`)
)
assert.match(hooks, /ballInCourtUserId\?: string \| null/, 'list can filter by ball in court')
assert.match(hooks, /overdue\?: boolean/, 'list can filter late items')
assert.match(hooks, /\[\s*'submittal-detail',\s*projectId,\s*submittalId,?\s*\]/, 'detail key keeps projectId at index 1')

// ── Lib ─────────────────────────────────────────────────────────────────
const lib = read('src/features/doc-control/lib/submittal-workflow.ts')
assert.match(lib, /approved_as_noted: 'Approved as noted'/, 'response codes labelled')
assert.match(lib, /revise_resubmit: 'Revise and resubmit'/, 'return code labelled')
assert.match(lib, /export const computeSubmitBy/, 'submit-by mirrors the backend formula')
assert.match(lib, /\(Number\(leadTimeWeeks\) \|\| 0\) \* 7/, 'lead time in weeks')

// ── Detail dialog ───────────────────────────────────────────────────────
const detail = read('src/features/doc-control/components/submittal-detail-dialog.tsx')
;[
  'uat-sub-detail',
  'uat-sub-status',
  'uat-sub-actions',
  'uat-sub-submit',
  'uat-sub-submit-form',
  'uat-sub-submit-confirm',
  'uat-sub-edit',
  'uat-sub-edit-form',
  'uat-sub-save',
  'uat-sub-route',
  'uat-sub-step',
  'uat-sub-decide',
  'uat-sub-decide-submit',
  'uat-sub-response-code',
  'uat-sub-manual',
  'uat-sub-fields',
  'uat-sub-submit-by',
  'uat-sub-people',
  'uat-sub-people-edit',
  'uat-sub-people-save',
  'uat-sub-impact',
].forEach((id) => assert.ok(detail.includes(id), `detail exposes ${id}`))
assert.match(detail, /useCanPerform\(\s*'submittal',\s*'submit',\s*'submittal\.review'\s*\)/, 'decisions gated by submittal.review')
assert.match(detail, /useCanPerform\(\s*'submittal',\s*'submit',\s*'submittal\.approve'\s*\)/, 'PM override gated by submittal.approve')
assert.match(detail, /Boolean\(myAssignment\) \|\| canApprove/, 'only assigned reviewers or the PM decide')
assert.match(detail, /Earlier cycles/, 'previous review cycles kept')
assert.match(detail, /<RecordPins[\s\S]*?recordType='submittal'/, 'pins on the submittal')
assert.match(detail, /<AttachmentPanel[\s\S]*?recordType='submittal'/, 'attachments on the submittal')
assert.match(detail, /<CommentThread[\s\S]*?recordType='submittal'/, 'internal notes on the submittal')
assert.match(detail, /<HistoryPanel[\s\S]*?entityType='submittal'/, 'history on the submittal')

// ── Create dialog, packages, workflows ──────────────────────────────────
const create = read('src/features/doc-control/components/submittal-create-dialog.tsx')
;['uat-sub-create', 'uat-sub-title', 'uat-sub-activity', 'uat-sub-required-on-site', 'uat-sub-lead-time', 'uat-sub-workflow', 'uat-sub-package', 'uat-sub-manager', 'uat-sub-distribution', 'uat-sub-submit-by', 'uat-sub-create-submit'].forEach((id) =>
  assert.ok(create.includes(id), `create dialog exposes ${id}`)
)
assert.match(create, /computeSubmitBy\(/, 'submit-by previewed while typing')
const packages = read('src/features/doc-control/components/submittal-packages-panel.tsx')
;['uat-sub-packages', 'uat-sub-package-new', 'uat-sub-package-create', 'uat-sub-package-save', 'uat-sub-package-row', 'uat-sub-package-submit', 'uat-sub-package-decide'].forEach((id) =>
  assert.ok(packages.includes(id), `packages panel exposes ${id}`)
)
const workflows = read('src/features/doc-control/components/submittal-workflow-editor.tsx')
;['uat-sub-workflows', 'uat-sub-workflow-new', 'uat-sub-workflow-editor', 'uat-sub-workflow-step', 'uat-sub-step-add', 'uat-sub-workflow-save', 'uat-sub-workflow-row'].forEach((id) =>
  assert.ok(workflows.includes(id), `workflow editor exposes ${id}`)
)
assert.match(workflows, /All must approve/, 'parallel mode explained')
assert.match(workflows, /Everyone in a party/, 'party-role reviewers')
assert.match(workflows, /Everyone with a role/, 'project-role reviewers')
assert.match(read('src/features/company/submittal-workflows.tsx'), /<SubmittalWorkflowList projectId=\{null\} canEdit \/>/, 'company library page')
assert.match(read('src/routes/_authenticated/company/submittal-workflows.tsx'), /'\/_authenticated\/company\/submittal-workflows'/, 'company route')
assert.match(read('src/features/company/index.tsx'), /href: '\/company\/submittal-workflows'/, 'company nav entry')

// ── Dashboard wiring ────────────────────────────────────────────────────
const dashboard = read('src/features/doc-control/components/doc-control-dashboard.tsx')
;['<SubmittalCreateDialog', '<SubmittalDetailDialog', '<SubmittalPackagesPanel', '<SubmittalWorkflowList', 'uat-sub-new', 'uat-sub-open', 'uat-sub-mine', 'uat-sub-late', 'uat-sub-packages-tab', 'uat-sub-workflows-tab'].forEach((token) =>
  assert.ok(dashboard.includes(token), `dashboard has ${token}`)
)
assert.match(dashboard, /initialTarget\?\.source === 'submittal' && initialTarget\.recordId/, 'deep link opens the submittal')
assert.match(dashboard, /ballInCourtUserId: submittalMine \? 'me' : null/, '"waiting on me" filter')

// ── Backend contract ────────────────────────────────────────────────────
const workflow = read('../backend/src/services/submittal-workflow.service.js')
;['normalizeSteps', 'computeSubmitBy', 'computeScheduleImpactDays', 'resolveAssignees', 'startWorkflow', 'decideStep', 'onStatusChange', 'afterStatusChange', 'applyScheduleImpact', 'createPackage', 'submitPackage', 'decidePackage', 'seedStarterTemplates'].forEach((symbol) =>
  assert.ok(workflow.includes(symbol), `workflow implements ${symbol}`)
)
assert.match(workflow, /relationType: "submittal_lead_time"/, 'late approvals link to the activity')
assert.match(workflow, /step\.mode === "parallel" && remaining\.length/, 'parallel steps wait for everyone')
const submittalService = read('../backend/src/services/submittal.service.js')
assert.match(submittalService, /submittalWorkflow\.onStatusChange\(/, 'status changes start / close the route')
assert.match(submittalService, /submittalWorkflow\.afterStatusChange\(/, 'notifications after commit')
assert.match(submittalService, /submitByFor\(/, 'submit-by recomputed on create and update')
const routes = read('../backend/src/routes/submittals.js')
;['"/packages"', '"/packages/:packageId/submit"', '"/packages/:packageId/decide"', '"/workflow-templates"', '"/:submittalId/decide"', '"/:submittalId/people"'].forEach((path) =>
  assert.ok(routes.includes(path), `route ${path}`)
)
assert.match(routes, /transition: "submittal\.review"/, 'decisions need submittal.review')
const migration = read('../backend/prisma/migrations/20260906140000_upgrade_submittals/migration.sql')
;['CREATE TABLE "SubmittalPackage"', 'CREATE TABLE "SubmittalWorkflowTemplate"', 'CREATE TABLE "SubmittalStep"', 'CREATE TABLE "SubmittalStepAssignment"', 'ADD COLUMN "submitBy"', 'ADD COLUMN "responseCode"'].forEach((statement) =>
  assert.ok(migration.includes(statement), `migration has ${statement}`)
)
assert.match(read('../backend/src/services/notification.service.js'), /"approver",\s*"managerUserId",\s*"ballInCourtUserId",\s*"createdBy"/, 'overdue reminders reach the manager and ball in court')

console.log('submittals-ui: ok')
