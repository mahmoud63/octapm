import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Project Controls › Structure (PC-1) is wired into the project workspace
 * the way every other module is: a slug in the module map, a lazy chunk in
 * the shell, a `boq`-gated entry, and the schedule's WBS tab reading the
 * project's WbsNode rows before falling back to the revision snapshot.
 */
const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const exists = (path) => existsSync(resolve(root, path))

// ── Feature files ────────────────────────────────────────────────────────
assert.ok(exists('src/features/controls/structure/components/structure-page.tsx'), 'structure page exists')
assert.ok(exists('src/features/controls/structure/hooks/use-structure.ts'), 'structure hooks exist')

const hooks = read('src/features/controls/structure/hooks/use-structure.ts')
;['/structure/wbs', '/structure/units', '/structure/units/normalise', 'export const useWbsNodes', 'export const useUpdateWbsNode', 'export const useArchiveWbsNode', 'export const useUnits'].forEach(
  (fragment) => assert.ok(hooks.includes(fragment), `hooks cover ${fragment}`)
)

const page = read('src/features/controls/structure/components/structure-page.tsx')
assert.match(page, /useCanPerform\('boq', 'update'\)/, 'editing is offered on boq update')
// The permission hook only decides what to show; the API decides what is allowed.
assert.ok(!page.includes('apiClient'), 'the page talks to the API through the hooks only')
;["data-testid='uat-wbs-add-root'", "data-testid='uat-wbs-editor'", "data-testid='uat-wbs-package'", "data-testid='uat-unit-probe'"].forEach(
  (fragment) => assert.ok(page.includes(fragment), `page exposes ${fragment}`)
)
assert.match(page, /never rewritten/, 'the page says the typed unit is kept')

// ── Module map and shell ─────────────────────────────────────────────────
const modules = read('src/features/projects/lib/project-modules.ts')
;["controls: 'controls'", "controls: 'structure'", "controls: ['boq']"].forEach(
  (fragment) => assert.ok(modules.includes(fragment), `module map has ${fragment}`)
)

const detail = read('src/features/projects/components/project-detail.tsx')
assert.ok(detail.includes("import('@/features/controls/structure/components/structure-page')"), 'structure page is lazily loaded')
assert.match(detail, /key: 'controls',\s*label: 'Project Controls'/, 'the module bar offers Project Controls')
assert.match(detail, /case 'controls':/, 'the shell renders the controls module')
assert.match(detail, /controls: childFor\('controls'\)/, 'the controls sub-tab comes from the URL')

// ── Schedule WBS tab reads WbsNode first ─────────────────────────────────
const tree = read('src/features/schedule/components/wbs-tree.tsx')
assert.match(tree, /useWbsNodes\(/, 'the WBS tab reads project WbsNode rows')
assert.match(tree, /buildTreeFromCodes/, 'the dotted-code fallback is kept for older revisions')
const dashboard = read('src/features/schedule/components/schedule-dashboard.tsx')
assert.match(dashboard, /<WbsTree nodes=\{revision\.wbs \|\| \[\]\} projectId=\{projectId\} \/>/, 'the dashboard hands the tab its project')

console.log('controls-structure-ui: ok')
