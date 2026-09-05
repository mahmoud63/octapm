import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const exists = (path) => existsSync(resolve(root, path))

// ── Matrix-aware permission helpers ─────────────────────────────────────
const permissionsLib = read('src/lib/permissions.ts')
assert.match(permissionsLib, /export type PermissionMatrix/, 'matrix type exported')
assert.match(
  permissionsLib,
  /matrix\?: PermissionMatrix \| null/,
  'provider accepts the resolved matrix'
)
assert.match(
  permissionsLib,
  /const decided = canPerformWithMatrix\(/,
  'useCanPerform consults the matrix before the static policy'
)
assert.match(permissionsLib, /export const useModuleAccess/, 'module access hook exists')
assert.match(permissionsLib, /export const useIsCompanyAdmin/, 'company admin hook exists')

// ── Hooks and endpoints ──────────────────────────────────────────────────
const hooks = read('src/features/permissions/hooks/use-permissions.ts')
;[
  "'/auth/me/permissions'",
  "'/permissions/catalog'",
  "'/permissions/templates'",
  '/permissions/templates/${templateId}/duplicate',
  '/projects/${projectId}/team',
  '/projects/${projectId}/team/${userId}/permissions',
  '/projects/${projectId}/team/parties/${partyId}/permissions',
].forEach((fragment) => {
  assert.ok(hooks.includes(fragment), `hooks call ${fragment}`)
})
assert.match(
  hooks,
  /\['permissions', projectId, 'me'\]/,
  'project matrix query key keeps projectId at index 1 so realtime invalidation reaches it'
)

// ── Settings › Permissions page and route ────────────────────────────────
assert.ok(exists('src/routes/_authenticated/settings/permissions.tsx'), 'route file exists')
const routeTree = read('src/routeTree.gen.ts')
assert.match(routeTree, /'\/settings\/permissions'/, 'route tree registers /settings/permissions')
assert.match(
  routeTree,
  /AuthenticatedSettingsPermissionsRoute:\s*AuthenticatedSettingsPermissionsRoute,/,
  'route tree mounts the permissions route under settings'
)
const settingsIndex = read('src/features/settings/index.tsx')
assert.match(settingsIndex, /useIsCompanyAdmin\(\)/, 'settings nav gates Permissions on company admin')
assert.match(settingsIndex, /href: '\/settings\/permissions'/, 'settings nav links to Permissions')
const settingsPage = read('src/features/settings/permissions/index.tsx')
assert.match(settingsPage, /<Navigate to='\/settings' replace \/>/, 'non-admins are redirected')

const templatesPage = read('src/features/permissions/components/permission-templates-page.tsx')
;[
  'uat-permission-templates',
  'uat-permission-template-new',
  'uat-permission-template-save',
  'uat-permission-level-${module.id}',
].forEach((id) => {
  assert.ok(templatesPage.includes(id), `templates page exposes ${id}`)
})
assert.match(
  templatesPage,
  /\[\s*'none',\s*'read_only',\s*'standard',\s*'admin',?\s*\]/,
  'four levels offered'
)
assert.match(templatesPage, /transition:/, 'grants cover transitions')
assert.ok(!/Procore/i.test(templatesPage), 'no vendor wording')

// ── Project Team module ──────────────────────────────────────────────────
const projectDetail = read('src/features/projects/components/project-detail.tsx')
assert.match(projectDetail, /\| 'team'/, 'ModuleKey includes team')
assert.match(projectDetail, /\{ key: 'team', label: 'Team' \}/, 'Team appears in the module menu')
assert.match(projectDetail, /<ProjectTeamPanel projectId=\{projectId\} \/>/, 'Team renders the panel')
assert.match(projectDetail, /useMyProjectPermissions\(projectId/, 'workspace loads the permission matrix')
assert.match(projectDetail, /matrix=\{permissionMatrix\}/, 'matrix is passed to the provider')
assert.match(projectDetail, /isModuleVisible\(permissionMatrix, item\.key/, 'menu hides modules at level none')

const teamPanel = read('src/features/permissions/components/project-team-panel.tsx')
;['uat-project-team', 'uat-team-template-${member.userId}', 'uat-party-template-${party.id}'].forEach(
  (id) => assert.ok(teamPanel.includes(id), `team panel exposes ${id}`)
)
assert.match(teamPanel, /canManage/, 'team panel gates editing on PM/company admin')

// ── Users admin toggle ───────────────────────────────────────────────────
const usersDialog = read('src/features/users/components/users-action-dialog.tsx')
assert.match(usersDialog, /uat-user-company-admin/, 'user dialog exposes the company admin switch')
assert.match(usersDialog, /isCompanyAdmin: values\.isCompanyAdmin/, 'user dialog saves isCompanyAdmin')
const authTypes = read('src/services/auth/types.ts')
assert.match(authTypes, /isCompanyAdmin\?: boolean/, 'AuthUser carries isCompanyAdmin')

// ── Backend contract the UI relies on ────────────────────────────────────
const backendRoutes = read('../backend/src/routes/permissions.js')
assert.match(backendRoutes, /requireCompanyAdmin/, 'template routes gated by requireCompanyAdmin')
const backendTeam = read('../backend/src/routes/project-team.js')
assert.match(backendTeam, /parties\/:partyId\/permissions/, 'party template route exists')
const backendAuth = read('../backend/src/routes/auth.js')
assert.match(backendAuth, /"\/me\/permissions"/, 'matrix endpoint exists')
const migration = read(
  '../backend/prisma/migrations/20260905150000_add_permission_templates/migration.sql'
)
assert.match(migration, /ON CONFLICT \("orgId", "name"\) DO NOTHING/, 'seed is idempotent')
assert.equal(
  (migration.match(/- (Internal|External)'/g) || []).length,
  12,
  'twelve default templates are seeded'
)

console.log('permission-templates-ui: ok')
