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
assert.match(detail, /data-testid=\{`uat-project-module-\$\{item\.key\}`\}/, 'module test ids preserved')

const page = read('src/features/projects/components/project-detail-page.tsx')
assert.match(page, /useParams\(\{ strict: false \}\)/, 'page reads module/child params')
assert.match(page, /module=\{params\.module\}/, 'page passes the module to the shell')

// ── Template residue stays gone ─────────────────────────────────────────
;['src/features/apps/index.tsx', 'src/features/chats/index.tsx', 'src/routes/(auth)/sign-in-2.tsx'].forEach((path) =>
  assert.ok(!exists(path), `${path} stays removed`)
)

console.log('project-routes-ui: ok')
