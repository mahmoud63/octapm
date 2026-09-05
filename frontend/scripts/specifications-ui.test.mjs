import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-AI-SPEC-036 — specifications and scope intelligence wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const backend = (rel) => readFileSync(path.join(root, '..', 'backend', rel), 'utf8')

const hooks = read('src/features/specifications/hooks/use-specifications.ts')
const panel = read('src/features/specifications/components/specifications-panel.tsx')
const detail = read('src/features/specifications/components/spec-section-detail.tsx')
const gaps = read('src/features/specifications/components/scope-gaps-card.tsx')
const rfiDialog = read('src/features/specifications/components/raise-rfi-dialog.tsx')
const dashboard = read('src/features/doc-control/components/doc-control-dashboard.tsx')
const projectDetail = read('src/features/projects/components/project-detail.tsx')
const projectsRoutes = backend('src/routes/projects.js')
const service = backend('src/services/specification.service.js')
const recordLinks = backend('src/utils/record-links.js')
const schema = backend('prisma/schema.prisma')

for (const name of ['useSpecStatus', 'useSpecDocuments', 'useIndexSpecifications', 'useSpecSections', 'useSpecSection', 'useScopeGaps', 'useExplainScopeGaps', 'useCheckSpecConflicts', 'useRaiseSpecRfi']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /\/specifications`/, 'base path')
assert.match(hooks, /\/scope-gaps\/explain`/, 'explain endpoint')
assert.match(hooks, /\/\$\{sectionId\}\/conflicts`/, 'conflicts endpoint')
assert.match(hooks, /\/\$\{sectionId\}\/rfi`/, 'rfi endpoint')

assert.match(panel, /export function SpecificationsPanel/, 'panel')
assert.match(panel, /data-testid='uat-spec-scan'/, 'find and index')
assert.match(panel, /data-testid='uat-spec-index-selected'/, 'index selected')
assert.match(panel, /data-testid='uat-spec-search'/, 'section search')
assert.match(panel, /data-testid='uat-spec-view-gaps'/, 'scope coverage view')
assert.match(panel, /initialTarget\?\.source === 'spec_section'/, 'deep link opens the section')
assert.match(panel, /useCanPerform\('document_control', 'update'\)/, 'indexing gated')

assert.match(detail, /export function SpecSectionDetail/, 'section detail')
assert.match(detail, /data-testid='uat-spec-related'/, 'related records')
assert.match(detail, /data-testid='uat-spec-conflicts-run'/, 'conflict check button')
assert.match(detail, /data-testid='uat-spec-conflict-rfi'/, 'raise RFI from a conflict')
assert.match(detail, /useCanPerform\('rfi', 'create'\)/, 'raising gated by the RFI permission')
assert.match(detail, /useCanPerform\('assistant', 'read'\)/, 'check gated by the assistant permission')
assert.match(detail, /<AiRunFeedback/, 'feedback on the run')
assert.match(rfiDialog, /export function RaiseSpecRfiDialog/, 'RFI dialog')
assert.match(rfiDialog, /data-testid='uat-spec-rfi-submit'/, 'RFI submit')

assert.match(gaps, /export function ScopeGapsCard/, 'scope gaps card')
assert.match(gaps, /data-testid='uat-scope-gaps-rows'/, 'gap rows')
assert.match(gaps, /data-testid='uat-scope-gaps-explain'/, 'review with AI')
assert.match(gaps, /BOQ items no section covers/, 'uncovered BOQ listed')

assert.match(dashboard, /<TabsTrigger value='specifications'>Specifications<\/TabsTrigger>/, 'tab in Doc control')
assert.match(dashboard, /<SpecificationsPanel/, 'panel mounted')
assert.match(projectDetail, /\{ key: 'specifications', label: 'Specifications' \}/, 'sidebar child')

assert.match(projectsRoutes, /"\/:projectId\/specifications",\s*nestedProjectAccess,\s*require\("\.\/specifications"\)/, 'routes mounted')
assert.match(service, /kind: "scope_gap"/, 'scope review stored')
assert.match(service, /kind: "spec_conflict"/, 'conflict runs stored')
assert.match(service, /const parseSections = /, 'deterministic section parsing')
assert.match(service, /const relateSection = /, 'deterministic relating')
assert.match(recordLinks, /spec_section: \{ module: "doc-control", child: "specifications" \}/, 'record link')
assert.match(schema, /model SpecSection \{/, 'SpecSection model')

console.log('specifications-ui: ok')
