import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const exists = (path) => existsSync(resolve(root, path))

// ── Sprint 1 UI/UX: template residue removed ─────────────────────────────
const sidebarData = read('src/components/layout/data/sidebar-data.ts')
const routeTree = read('src/routeTree.gen.ts')
const displayItems = read('src/features/settings/hooks/use-user-settings.ts')
const backendDisplay = read('../backend/src/services/user-settings.service.js')

;['Apps', 'Chats', 'Sign In (2 Col)', 'Maintenance Error', 'Add team'].forEach(
  (label) => {
    assert.ok(!sidebarData.includes(label), `sidebar no longer offers "${label}"`)
  }
)
;[
  'src/features/apps/index.tsx',
  'src/features/chats/index.tsx',
  'src/routes/_authenticated/apps/index.tsx',
  'src/routes/_authenticated/chats/index.tsx',
  'src/routes/(auth)/sign-in-2.tsx',
  'src/components/layout/team-switcher.tsx',
  'src/components/layout/app-sidebar.tsx',
].forEach((path) => {
  assert.ok(!exists(path), `${path} was removed`)
})
;["'/apps", "'/chats", 'sign-in-2'].forEach((fragment) => {
  assert.ok(!routeTree.includes(fragment), `route tree has no ${fragment}`)
})
assert.ok(!displayItems.includes("'apps'"), 'display settings drop apps')
assert.ok(!displayItems.includes("'chats'"), 'display settings drop chats')
assert.ok(!backendDisplay.includes('"apps"'), 'backend display items drop apps')
assert.ok(!backendDisplay.includes('"chats"'), 'backend display items drop chats')

// ── Project switcher and live status in the header ───────────────────────
const topNavbar = read('src/components/layout/top-navbar.tsx')
assert.match(topNavbar, /ProjectSwitcher/, 'header renders the project switcher')
assert.match(topNavbar, /RealtimeStatus/, 'header renders the live status pill')
assert.match(
  topNavbar,
  /navGroups\[1\]\.items/,
  'header reads the Account group at index 1 after the Pages group removal'
)
assert.ok(!topNavbar.includes('Upgrade to Pro'), 'dead "Upgrade to Pro" item removed')

const projectSwitcher = read('src/components/layout/project-switcher.tsx')
assert.match(projectSwitcher, /useProjects\(\)/, 'switcher lists real projects')
assert.match(
  projectSwitcher,
  /to: '\/o\/\$orgSlug\/projects\/\$projectId'/,
  'switcher navigates to the project inside its workspace'
)

// ── Realtime client wiring ───────────────────────────────────────────────
const realtimeLib = read('src/lib/realtime.ts')
const realtimeHook = read('src/hooks/use-realtime.ts')
const layout = read('src/components/layout/authenticated-layout.tsx')
const projectDetail = read(
  'src/features/projects/components/project-detail.tsx'
)

assert.match(realtimeLib, /auth: \{ token \}/, 'socket authenticates with the access token')
assert.match(realtimeLib, /'project:join'/, 'client joins project rooms')
// Several API tasks without sticky sessions: polling would scatter one
// session's requests across tasks (backend/src/realtime/__live__/cluster.live.test.js).
assert.match(
  realtimeLib,
  /REALTIME_SOCKET_OPTIONS[^=]*= \{\s*transports: \['websocket'\],/,
  'socket is WebSocket-only'
)
assert.match(
  realtimeLib,
  /io\(resolveSocketUrl\(\), \{\s*\.\.\.REALTIME_SOCKET_OPTIONS,/,
  'the socket is opened with those options'
)
assert.match(realtimeLib, /'domain\.event'/, 'client listens for domain events')
assert.match(
  realtimeHook,
  /query\.queryKey\[1\] === scopeId/,
  'project events invalidate every [name, projectId] query'
)
assert.match(layout, /useRealtimeConnection\(\)/, 'layout keeps the socket connected')
assert.match(projectDetail, /useProjectRealtime\(/, 'project workspace joins its room')

// ── Locations module ─────────────────────────────────────────────────────
assert.match(projectDetail, /key: 'locations', label: 'Locations'/, 'Locations module in workspace nav')
assert.match(projectDetail, /<LocationsPanel projectId=\{projectId\}[\s/]/, 'Locations panel rendered')

const locationsPanel = read('src/features/locations/components/locations-panel.tsx')
const locationsHook = read('src/features/locations/hooks/use-locations.ts')
const permissions = read('src/lib/permissions.ts')
const policy = JSON.parse(read('../shared/permissions.json'))

assert.match(locationsPanel, /useCanPerform\('location', 'create'\)/, 'create gated by policy')
assert.match(
  locationsPanel,
  /useCanPerform\('location', 'delete', 'location\.archive'\)/,
  'archive gated by transition'
)
assert.match(locationsPanel, /data-testid='uat-locations-panel'/, 'UAT hook present')
assert.match(locationsHook, /\/projects\/\$\{projectId\}\/locations/, 'hook targets the locations API')
assert.match(permissions, /\| 'location'/, 'location module typed on the frontend')
assert.ok(policy.modules.location, 'shared policy declares the location module')
assert.deepEqual(policy.modules.location.actions.delete, ['pm', 'planning_eng'])
;['owner', 'consultant', 'contractor', 'subcontractor'].forEach((party) => {
  assert.deepEqual(
    policy.partyPermissions[party].modules.location.actions,
    ['read'],
    `${party} party can read locations`
  )
})

// ── Backend realtime wiring ──────────────────────────────────────────────
const backendIndex = read('../backend/src/index.js')
const auditService = read('../backend/src/services/audit.service.js')
const projectsRoute = read('../backend/src/routes/projects.js')

assert.match(backendIndex, /attachRealtime\(io\)/, 'socket server attached to the bus')
// PC-7a: audit announces its event through publishRecorded, which publishes it
// only once its outbound row is visible after COMMIT (never for a rollback).
const eventBus = read('../backend/src/events/bus.js')
assert.match(auditService, /domainEvents\.publishRecorded\(/, 'audit publishes domain events')
assert.match(eventBus, /const publishRecorded = [\s\S]*?return publish\(event/, 'publishRecorded publishes the event')
assert.match(auditService, /recordOutboundEvent/, 'audit persists outbound events')
assert.match(projectsRoute, /"\/:projectId\/locations"/, 'locations route mounted')

console.log('navigation-realtime-locations checks passed')
