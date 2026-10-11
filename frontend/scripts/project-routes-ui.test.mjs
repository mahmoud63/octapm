import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const exists = (path) => existsSync(resolve(root, path))

// ── Route files: module and sub-tab are URL segments ────────────────────
assert.ok(exists('src/routes/_authenticated/projects/$projectId/$module/index.tsx'), 'module route exists')
assert.ok(exists('src/routes/_authenticated/projects/$projectId/$module/$child.tsx'), 'module child route exists')
assert.ok(exists('src/routes/_authenticated/projects/$projectId/index.tsx'), 'project index route exists')
assert.ok(!exists('src/routes/_authenticated/projects/$projectId/boq.tsx'), 'standalone BOQ page route removed; BOQ is a workspace module')

// The project lives under its workspace (ENT-4): `/o/{workspace}/projects/:id/…`.
const workspaceRoutes = 'src/routes/_authenticated/o/$orgSlug/projects/$projectId'
assert.ok(exists(`${workspaceRoutes}/$module/index.tsx`), 'workspace module route exists')
assert.ok(exists(`${workspaceRoutes}/$module/$child.tsx`), 'workspace module child route exists')
assert.ok(exists(`${workspaceRoutes}/index.tsx`), 'workspace project index route exists')

// The legacy layout only hands the visit, search and all, to the workspace
// that owns the project; the workspace layout maps the old `?module=&child=`.
const legacyLayout = read('src/routes/_authenticated/projects/$projectId.tsx')
assert.match(legacyLayout, /beforeLoad: \(\{ params, location, context \}\) =>\s*legacyProjectRedirect\(\{\s*projectId: params\.projectId,\s*location,/, 'project layout redirects legacy links')
assert.match(legacyLayout, /module: typeof search\.module === 'string' \? search\.module : undefined,\s*child: typeof search\.child === 'string' \? search\.child : undefined,/, 'the legacy layout keeps ?module=&child= for the workspace route')
assert.doesNotMatch(legacyLayout, /component:/, 'the legacy layout renders nothing of its own')
assert.match(read('src/lib/workspace/legacy.ts'), /to: `\/o\/\$orgSlug\$\{location\.pathname === '\/' \? '' : location\.pathname\}`[\s\S]*?search: location\.search as Record<string, unknown>,/, 'the workspace redirect carries the path and the search')
const layout = read(`${workspaceRoutes}.tsx`)
assert.match(layout, /beforeLoad: \(\{ params, search, location \}\) => \{\s*const module = moduleFromSlug\(search\.module\)/, 'legacy ?module= is mapped to a slug')
assert.match(layout, /to: '\/o\/\$orgSlug\/projects\/\$projectId\/\$module\/\$child',[\s\S]*?module: slugForModule\(module\),\s*child,/, 'legacy links redirect to module/child routes')
assert.match(layout, /component: Outlet/, 'layout renders the child route')

// `/o/{workspace}/projects/:id` lands on the Overview (workspace switching
// doc §7), no longer a redirect to the default module.
const index = read(`${workspaceRoutes}/index.tsx`)
assert.match(index, /createFileRoute\('\/_authenticated\/o\/\$orgSlug\/projects\/\$projectId\/'\)\(\{\s*component: ProjectOverviewPage,/, '/projects/:id opens the Overview')
assert.doesNotMatch(read('src/routes/_authenticated/projects/$projectId/index.tsx'), /component:/, 'the legacy project index renders nothing of its own')

const routeTree = read('src/routeTree.gen.ts')
assert.match(routeTree, /'\/projects\/\$projectId\/\$module\/\$child'/, 'route tree registers module/child routes')
assert.match(routeTree, /'\/o\/\$orgSlug\/projects\/\$projectId\/\$module\/\$child'/, 'route tree registers the workspace module/child routes')
assert.ok(!routeTree.includes("'/projects/$projectId/boq'"), 'route tree no longer has the standalone BOQ route')

// ── Module map ──────────────────────────────────────────────────────────
const modules = read('src/features/projects/lib/project-modules.ts')
;["siteReporting: 'site-reporting'", "docControl: 'doc-control'", 'export const moduleFromSlug', 'export const MODULE_PERMISSIONS', 'export const isModuleVisible'].forEach(
  (fragment) => assert.ok(modules.includes(fragment), `module map has ${fragment}`)
)

// ── Workspace shell: URL-driven, lazy modules, no navigation state ───────
const detail = read('src/features/projects/components/project-detail.tsx')
assert.match(detail, /moduleFromSlug\(moduleSlug\) \?\? \(isExternalParty \? 'reviews' : DEFAULT_MODULE\)/, 'active module comes from the URL')
assert.ok(!/useState<ModuleKey>/.test(detail), 'no local active-module state')
// One effect exists since a60bf81 (Phase 22B): a URL naming a module or tab the
// policy hides is REPLACED by the one offered, so the address bar says what is
// shown. It writes the URL only — never local navigation state — so the URL
// stays the one source of the active module.
const effects = detail.split(/useEffect\(\(\) => \{/).slice(1).map((rest) => rest.slice(0, rest.indexOf('}, [')))
assert.equal((detail.match(/useEffect\(/g) || []).length, 1, 'no effects synchronising navigation state beyond the policy correction')
assert.equal(effects.length, 1, 'the one effect is a plain effect body')
assert.match(effects[0], /^\s*if \(permissionsSettling \|\| wbsSettling \|\| !menuItems\.length\) return/, 'the correction waits for the policy before it moves the URL')
assert.ok(!/\bset[A-Z]\w*\(/.test(effects[0]), 'the correction sets no local state')
assert.equal((effects[0].match(/navigate\(\{/g) || []).length, 2, 'the correction only navigates')
assert.equal((effects[0].match(/replace: true,/g) || []).length, 2, 'the correction replaces the URL rather than adding history')
assert.match(detail, /to: '\/projects\/\$projectId\/\$module\/\$child'/, 'menu navigates to module/child URLs')
assert.match(detail, /<Suspense fallback=\{<ModuleLoading \/>\}>/, 'modules render inside Suspense')
const lazyCount = (detail.match(/lazy\(\(\) =>/g) || []).length
assert.ok(lazyCount >= 15, `every module is lazily loaded (found ${lazyCount})`)
;["import('@/features/schedule/components/schedule-dashboard')", "import('@/features/doc-control/components/doc-control-dashboard')", "import('@/features/commercial/components/commercial-dashboard')", "import('@/features/boq/components/boq-page')"].forEach(
  (fragment) => assert.ok(detail.includes(fragment), `lazy import ${fragment}`)
)
// Project navigation is the top module bar, not a left sidebar: the shell
// renders it above the project header and there is exactly one of them.
assert.match(detail, /<ProjectModuleBar/, 'the shell renders the top module bar')
assert.ok(
  !/<ProjectModuleNav|uat-project-module-rail/.test(detail),
  'the superseded sidebar navigation is gone, so there is one primary module navigation'
)

const bar = read('src/features/projects/components/project-module-bar.tsx')
assert.match(bar, /data-testid='uat-project-module-bar'/, 'the module bar is addressable')
// Tabs receive their id through the `testId` prop and render it as data-testid.
assert.match(bar, /uat-module-tab-\$\{item\.key\}/, 'module tabs expose test ids')
assert.match(bar, /data-testid=\{testId\}/, 'the tab renders the id it is given')
assert.match(bar, /uat-module-child-\$\{item\.key\}-\$\{child\.key\}/, 'dropdown children expose test ids')
// Sub-pages live in dropdowns; the row itself stays readable.
assert.match(bar, /DropdownMenu/, 'sub-pages open in dropdowns rather than filling the row')
assert.match(bar, /uat-module-tab-more/, 'lower-frequency modules fold into a More menu')
// Accessibility: the active state must not depend only on colour.
assert.match(bar, /aria-current=\{isActive \? 'page' : undefined\}/, 'active module sets aria-current')
assert.match(bar, /aria-haspopup/, 'dropdown triggers announce themselves')
assert.ok(
  !/bg-(emerald|rose|amber|slate|sky|indigo)-\d{2,3}/.test(bar),
  'the module bar uses design tokens, not Tailwind palette colours'
)

const page = read('src/features/projects/components/project-detail-page.tsx')
assert.match(page, /useParams\(\{ strict: false \}\)/, 'page reads module/child params')
assert.match(page, /module=\{params\.module\}/, 'page passes the module to the shell')

// ── Template residue stays gone ─────────────────────────────────────────
;['src/features/apps/index.tsx', 'src/features/chats/index.tsx', 'src/routes/(auth)/sign-in-2.tsx'].forEach((path) =>
  assert.ok(!exists(path), `${path} stays removed`)
)

console.log('project-routes-ui: ok')
