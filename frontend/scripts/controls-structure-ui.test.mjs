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
// PC-7b: the group is offered to a holder of boq, cost or schedule (for
// Exceptions); Structure and Mapping stay gated by the BOQ as a sub-tab.
;["controls: 'controls'", "controls: 'structure'", "structure: ['boq']", "mapping: ['boq']"].forEach(
  (fragment) => assert.ok(modules.includes(fragment), `module map has ${fragment}`)
)

const detail = read('src/features/projects/components/project-detail.tsx')
assert.ok(detail.includes("import('@/features/controls/structure/components/structure-page')"), 'structure page is lazily loaded')
assert.match(detail, /key: 'controls',\s*label: 'Project Controls'/, 'the module bar offers Project Controls')
assert.match(detail, /case 'controls':/, 'the shell renders the controls module')
assert.match(detail, /controls: childFor\('controls'\)/, 'the controls sub-tab comes from the URL')

// A package names its party and commitment from the project's own lists,
// never as ids typed by hand.
assert.match(page, /useProjectParties\(projectId\)/, 'the package owner is picked from the project parties')
assert.match(page, /useCommitments\(projectId/, 'the package commitment is picked from the project commitments')
;["data-testid='uat-wbs-owner'", "data-testid='uat-wbs-commitment'"].forEach(
  (fragment) => assert.ok(page.includes(fragment), `page exposes ${fragment}`)
)
assert.ok(!/Owner party id|Commitment id/.test(page), 'no raw id inputs remain on the package')

// ── Schedule WBS tab reads WbsNode first ─────────────────────────────────
const tree = read('src/features/schedule/components/wbs-tree.tsx')
assert.match(tree, /useScheduleWbsRows\(/, 'the WBS tab reads project WbsNode rows')
// Every row, archived ones included: a tree whose nodes are all archived is
// still the project's, never replaced by the snapshot (D3).
const structureHooks = read('src/features/controls/structure/hooks/use-structure.ts')
assert.match(structureHooks, /useWbsNodes\(projectId, \{ includeArchived: true/, 'the WBS tab reads archived rows too')
assert.match(tree, /buildTreeFromSnapshot/, 'the snapshot fallback is kept for older revisions')
// The snapshot's own parent ids come first (an imported P6 or MS Project
// WBS); the dotted code only places the generator's id-less nodes.
assert.ok(tree.includes('raw.parentWbsId ?? raw.parentObjectId'), 'the snapshot outline joins by parent id')
assert.ok(!tree.includes('map.set(code, '), 'snapshot nodes are never keyed by code alone')
// The roots start open whichever source the tree came from: the expansion
// the viewer chose is kept per source, not seeded once from the snapshot's
// keys and left empty when the row ids arrive.
assert.match(tree, /chosen && chosen\.fromRows === fromRows \? chosen\.keys : initialExpanded/, 'expansion follows the tree source')
assert.ok(!tree.includes('useState<Set<string>>(initialExpanded)'), 'expansion is not seeded once from the first tree')
const dashboard = read('src/features/schedule/components/schedule-dashboard.tsx')
assert.match(dashboard, /<WbsTree nodes=\{revision\.wbs \|\| \[\]\} projectId=\{projectId\} \/>/, 'the dashboard hands the tab its project')

console.log('controls-structure-ui: ok')
