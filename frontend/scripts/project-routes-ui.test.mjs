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

const layout = read('src/routes/_authenticated/projects/$projectId.tsx')
assert.match(layout, /beforeLoad/, 'project layout redirects legacy links')
assert.match(layout, /moduleFromSlug\(search\.module\)/, 'legacy ?module= is mapped to a slug')
assert.match(layout, /to: '\/projects\/\$projectId\/\$module\/\$child'/, 'legacy links redirect to module/child routes')
assert.match(layout, /component: Outlet/, 'layout renders the child route')

const index = read('src/routes/_authenticated/projects/$projectId/index.tsx')
assert.match(index, /redirect\(/, '/projects/:id opens the default module')

const routeTree = read('src/routeTree.gen.ts')
assert.match(routeTree, /'\/projects\/\$projectId\/\$module\/\$child'/, 'route tree registers module/child routes')
assert.ok(!routeTree.includes("'/projects/$projectId/boq'"), 'route tree no longer has the standalone BOQ route')

// ── Module map ──────────────────────────────────────────────────────────
const modules = read('src/features/projects/lib/project-modules.ts')
;["siteReporting: 'site-reporting'", "docControl: 'doc-control'", 'export const moduleFromSlug', 'export const MODULE_PERMISSIONS', 'export const isModuleVisible'].forEach(
  (fragment) => assert.ok(modules.includes(fragment), `module map has ${fragment}`)
)

// ── Workspace shell: URL-driven, lazy modules, no navigation state ───────
const detail = read('src/features/projects/components/project-detail.tsx')
assert.match(detail, /moduleFromSlug\(moduleSlug\) \?\? DEFAULT_MODULE/, 'active module comes from the URL')
assert.ok(!/useState<ModuleKey>/.test(detail), 'no local active-module state')
assert.ok(!/useEffect\(/.test(detail), 'no effects synchronising navigation state')
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
