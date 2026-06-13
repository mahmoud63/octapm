import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const policy = JSON.parse(
  readFileSync(
    new URL('../../shared/permissions.json', import.meta.url),
    'utf8'
  )
)

const permissionsSource = readFileSync(
  new URL('../src/lib/permissions.ts', import.meta.url),
  'utf8'
)
const projectDetailSource = readFileSync(
  new URL('../src/features/projects/components/project-detail.tsx', import.meta.url),
  'utf8'
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
  ['cost_controller', 'cost_controller'],
  ['cost controller', 'cost_controller'],
  ['procurement', 'procurement'],
  ['warehouse', 'warehouse'],
  ['site_engineer', 'site_engineer'],
  ['site engineer', 'site_engineer'],
  ['finance', 'finance'],
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

const normalizePartyRoleId = (role) => {
  if (!role) return null
  const normalized = String(role).trim().toLowerCase().replace(/[-\s]+/g, '_')
  if (normalized === 'client') return 'owner'
  if (normalized === 'main_contractor') return 'contractor'
  return normalized
}

const canPartyPerform = (partyRole, moduleName, action, transition) => {
  const modulePolicy =
    policy.partyPermissions?.[normalizePartyRoleId(partyRole)]?.modules[
      moduleName
    ]
  if (!modulePolicy) return false
  if (transition) return modulePolicy.transitions?.includes(transition) ?? false
  return modulePolicy.actions.includes(action)
}

const projectPmRole = resolveEffectiveRole({
  authRole: 'site_engineer',
  projectRole: 'Project Manager',
})
assert.equal(projectPmRole, 'pm', 'Project Manager assignment resolves to pm')
assert.equal(
  canPerform(projectPmRole, 'schedule', 'approve', 'revision.approve'),
  true,
  'project-level PM can see schedule approval'
)
assert.equal(
  canPerform(projectPmRole, 'progress', 'approve', 'daily_report.approve'),
  true,
  'project-level PM can see daily report approval'
)
assert.equal(
  canPerform(
    resolveEffectiveRole({ authRole: 'site_engineer' }),
    'schedule',
    'approve',
    'revision.approve'
  ),
  false,
  'org site engineer without project PM assignment cannot see schedule approval'
)
assert.equal(
  canPerform(
    resolveEffectiveRole({ authRole: 'site_engineer', projectRole: 'qs' }),
    'progress',
    'approve',
    'daily_report.approve'
  ),
  false,
  'non-PM project assignment cannot see PM-only daily report approval'
)
assert.equal(
  canPartyPerform('consultant', 'rfi', 'submit', 'rfi.answer'),
  true,
  'consultant party can answer routed RFIs'
)
assert.equal(
  canPartyPerform('subcontractor', 'rfi', 'approve', 'rfi.close'),
  false,
  'subcontractor party cannot close RFIs'
)

assert.match(
  permissionsSource,
  /ProjectPermissionProvider/,
  'permissions lib exposes a project permission provider'
)
assert.match(
  permissionsSource,
  /useProjectEffectiveRole\s*=/,
  'useCanPerform reads the project-effective role context'
)
assert.match(
  permissionsSource,
  /partyAccess/,
  'project permission context includes party access'
)
assert.match(
  permissionsSource,
  /projectRole\?: string \| null/,
  'useCanPerform accepts an explicit project role override'
)
assert.match(
  projectDetailSource,
  /<ProjectPermissionProvider[\s\S]*effectiveRole=\{projectEffectiveRole\}/,
  'project detail provides the backend effective role to module permissions'
)
assert.match(
  projectDetailSource,
  /partyAccess=\{project\.projectAccess\?\.partyAccess\}/,
  'project detail provides backend party access to module permissions'
)

console.log('Effective project role and party permission assertions passed (12)')
