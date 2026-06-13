import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readSource = (path) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')

const policy = JSON.parse(readSource('../../shared/permissions.json'))
const permissionsSource = readSource('../src/lib/permissions.ts')
const projectDetailSource = readSource(
  '../src/features/projects/components/project-detail.tsx'
)
const scheduleReviewSource = readSource(
  '../src/features/schedule/components/schedule-review-panel.tsx'
)
const siteReportingSource = readSource(
  '../src/features/site-reporting/components/site-reporting-dashboard.tsx'
)
const docControlSource = readSource(
  '../src/features/doc-control/components/doc-control-dashboard.tsx'
)
const boqAllocationSource = readSource(
  '../src/features/boq/components/boq-allocation-panel.tsx'
)

const roleAliases = new Map([
  ['pm', 'pm'],
  ['project_manager', 'pm'],
  ['project manager', 'pm'],
  ['planning_eng', 'planning_eng'],
  ['planning_engineer', 'planning_eng'],
  ['planning engineer', 'planning_eng'],
  ['qs', 'qs'],
  ['quantity_surveyor', 'qs'],
  ['quantity surveyor', 'qs'],
  ['site_engineer', 'site_engineer'],
  ['site engineer', 'site_engineer'],
])

const normalizeRoleId = (role) => {
  if (!role) return null
  const trimmed = String(role).trim()
  const normalized = trimmed.toLowerCase().replace(/[-\s]+/g, '_')
  return roleAliases.get(normalized) || roleAliases.get(trimmed.toLowerCase()) || role
}

const resolveEffectiveRole = ({ authRole, projectRole, effectiveRole }) =>
  normalizeRoleId(effectiveRole ?? projectRole ?? authRole)

const canPerform = (role, moduleName, action, transition) => {
  const modulePolicy = policy.modules[moduleName]
  const allowedRoles =
    transition && modulePolicy.transitions?.[transition]
      ? modulePolicy.transitions[transition]
      : modulePolicy.actions[action]

  return allowedRoles.includes(normalizeRoleId(role))
}

const projectPmRole = resolveEffectiveRole({
  authRole: 'site_engineer',
  projectRole: 'Project Manager',
})

const approvalPolicyCases = [
  [projectPmRole, 'schedule', 'approve', 'revision.approve', true],
  [projectPmRole, 'schedule', 'approve', 'revision.reject', true],
  [projectPmRole, 'progress', 'approve', 'daily_report.approve', true],
  [projectPmRole, 'progress', 'approve', 'daily_report.reject', true],
  [projectPmRole, 'rfi', 'approve', 'rfi.approve', true],
  [projectPmRole, 'rfi', 'approve', 'rfi.reject', true],
  [projectPmRole, 'submittal', 'approve', 'submittal.approve', true],
  [projectPmRole, 'submittal', 'approve', 'submittal.reject', true],
  [projectPmRole, 'boq', 'approve', 'allocation.approve', true],
  [projectPmRole, 'boq', 'approve', 'allocation.reject', true],
  ['planning_eng', 'schedule', 'approve', 'revision.approve', false],
  ['planning_eng', 'progress', 'approve', 'daily_report.reject', false],
  ['qs', 'rfi', 'approve', 'rfi.reject', false],
  ['qs', 'submittal', 'approve', 'submittal.approve', false],
  ['qs', 'boq', 'approve', 'allocation.approve', true],
  ['site_engineer', 'boq', 'approve', 'allocation.reject', false],
]

approvalPolicyCases.forEach(([role, moduleName, action, transition, expected]) => {
  assert.equal(
    canPerform(role, moduleName, action, transition),
    expected,
    `${role} ${moduleName}.${action} (${transition}) approval visibility`
  )
})

assert.match(
  permissionsSource,
  /\|\s*'boq'/,
  'frontend permission module union includes BOQ'
)
assert.match(
  projectDetailSource,
  /<ProjectPermissionProvider[\s\S]*effectiveRole=\{projectEffectiveRole\}/,
  'project detail passes backend effective role to child module permission context'
)

assert.match(
  scheduleReviewSource,
  /const canApproveRevision = useCanPerform\(\s*'schedule',\s*'approve',\s*'revision\.approve'\s*\)/,
  'schedule approve action is permission-gated'
)
assert.match(
  scheduleReviewSource,
  /const canRejectRevision = useCanPerform\(\s*'schedule',\s*'approve',\s*'revision\.reject'\s*\)/,
  'schedule reject action is permission-gated'
)
assert.match(
  scheduleReviewSource,
  /\{canApproveRevision && \(/,
  'schedule approve button is hidden when permission is absent'
)
assert.match(
  scheduleReviewSource,
  /\{canRejectRevision && \(/,
  'schedule reject button is hidden when permission is absent'
)

assert.match(
  siteReportingSource,
  /const canApproveDailyReport = useCanPerform\(\s*'progress',\s*'approve',\s*'daily_report\.approve'\s*\)/,
  'daily report approve action is permission-gated'
)
assert.match(
  siteReportingSource,
  /const canRejectDailyReport = useCanPerform\(\s*'progress',\s*'approve',\s*'daily_report\.reject'\s*\)/,
  'daily report reject action is permission-gated'
)
assert.match(
  siteReportingSource,
  /kind === 'report' && canApproveDailyReport && \(/,
  'daily report approve button is hidden when permission is absent'
)
assert.match(
  siteReportingSource,
  /kind === 'report' && canRejectDailyReport && \(/,
  'daily report reject button is hidden when permission is absent'
)

assert.match(
  docControlSource,
  /const canApproveRfi = useCanPerform\('rfi', 'approve', 'rfi\.approve'\)/,
  'RFI approve action is permission-gated'
)
assert.match(
  docControlSource,
  /const canRejectRfi = useCanPerform\('rfi', 'approve', 'rfi\.reject'\)/,
  'RFI disapprove action is permission-gated'
)
assert.match(
  docControlSource,
  /row\.status ===\s*'answered' && canApproveRfi && \(/,
  'RFI approve button is hidden when permission is absent'
)
assert.match(
  docControlSource,
  /row\.status ===\s*'answered' && canRejectRfi && \(/,
  'RFI disapprove button is hidden when permission is absent'
)
assert.match(
  docControlSource,
  /const canApproveSubmittal = useCanPerform\(\s*'submittal',\s*'approve',\s*'submittal\.approve'\s*\)/,
  'submittal approve action is permission-gated'
)
assert.match(
  docControlSource,
  /const canRejectSubmittal = useCanPerform\(\s*'submittal',\s*'approve',\s*'submittal\.reject'\s*\)/,
  'submittal disapprove action is permission-gated'
)
assert.match(
  docControlSource,
  /row\.status ===\s*'under_review' && canApproveSubmittal && \(/,
  'submittal approve button is hidden when permission is absent'
)
assert.match(
  docControlSource,
  /row\.status ===\s*'under_review' && canRejectSubmittal && \(/,
  'submittal disapprove button is hidden when permission is absent'
)

assert.match(
  boqAllocationSource,
  /const canApproveAllocation = useCanPerform\(\s*'boq',\s*'approve',\s*'allocation\.approve'\s*\)/,
  'BOQ allocation approve action is permission-gated'
)
assert.match(
  boqAllocationSource,
  /const canRejectAllocation = useCanPerform\(\s*'boq',\s*'approve',\s*'allocation\.reject'\s*\)/,
  'BOQ allocation reject action is permission-gated'
)
assert.match(
  boqAllocationSource,
  /\{canApproveAllocation && \(/,
  'BOQ allocation approve icon is hidden when permission is absent'
)
assert.match(
  boqAllocationSource,
  /\{canRejectAllocation && \(/,
  'BOQ allocation reject icon is hidden when permission is absent'
)

console.log('Project manager approval UI assertions passed (38)')
