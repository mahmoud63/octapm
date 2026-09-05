import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-AI-DWG-035 — drawing intelligence wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const backend = (rel) => readFileSync(path.join(root, '..', 'backend', rel), 'utf8')

const hooks = read('src/features/drawings/hooks/use-drawing-assistant.ts')
const reader = read('src/features/drawings/components/title-block-reader.tsx')
const references = read('src/features/drawings/components/sheet-references.tsx')
const summary = read('src/features/drawings/components/revision-change-summary.tsx')
const review = read('src/features/drawings/components/drawing-set-review.tsx')
const viewer = read('src/features/drawings/components/sheet-viewer.tsx')
const compare = read('src/features/drawings/components/revision-compare.tsx')
const module_ = read('src/features/drawings/components/drawings-module.tsx')
const projectsRoutes = backend('src/routes/projects.js')
const service = backend('src/services/drawing-assistant.service.js')
const schema = backend('prisma/schema.prisma')

for (const name of ['renderRevisionImage', 'useDrawingAiStatus', 'useReadTitleBlocks', 'useSheetReferences', 'useBuildSheetReferences', 'useBuildSetReferences', 'useCompareRevisionsWithAi']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /\/sets\/\$\{setId\}\/read`/, 'read endpoint')
assert.match(hooks, /\/sheets\/\$\{sheetId\}\/references`/, 'references endpoint')
assert.match(hooks, /\/sheets\/\$\{sheetId\}\/compare`/, 'compare endpoint')
assert.match(hooks, /toDataURL\('image\/jpeg'/, 'pages rendered here as JPEG')
assert.match(hooks, /url\.length <= MAX_DATA_URL/, 'payload kept under the server limit')

assert.match(reader, /export function TitleBlockReader/, 'title-block reader')
assert.match(reader, /data-testid='uat-drawing-ai-read'/, 'read button')
assert.match(reader, /status\.pageLimit/, 'batch capped by the server limit')
assert.match(reader, /onProposal\(item\.revisionId, item\.proposal\)/, 'proposals go to the grid, not the server')

assert.match(review, /<TitleBlockReader/, 'reader in the review header')
assert.match(review, /candidates=\{aiCandidates\}/, 'candidates are the unsettled pages')
assert.match(review, /row\.textStatus === 'no_text'/, 'pages without text are candidates')
assert.match(review, /draft\.number\.trim\(\) \|\| proposal\.number/, 'typed values win over proposals')
assert.match(review, /data-testid='uat-drawing-ai-references'/, 'link references button')

assert.match(references, /export function SheetReferencesPanel/, 'references panel')
assert.match(references, /data-testid='uat-sheet-references'/, 'references bar')
assert.match(references, /data-testid='uat-sheet-references-build'/, 'find references')
assert.match(references, /Referenced by/, 'incoming links shown')
assert.match(references, /onOpenSheet\(target\.id\)/, 'chips open the target sheet')
assert.match(viewer, /<SheetReferencesPanel/, 'panel in the viewer')
assert.match(viewer, /onOpenSheet=\{onOpenSheet\}/, 'viewer passes the opener')
assert.match(module_, /onOpenSheet=\{\(sheetId\) => setView\(\{ kind: 'sheet', sheetId \}\)\}\s*\/>/, 'module opens the referenced sheet')

assert.match(summary, /export function RevisionChangeSummary/, 'change summary')
assert.match(summary, /data-testid='uat-revision-ai-explain'/, 'explain button')
assert.match(summary, /data-testid='uat-revision-ai-changes'/, 'change list')
assert.match(summary, /<AiRunFeedback/, 'feedback on the run')
assert.match(compare, /<RevisionChangeSummary/, 'summary under the compare')
assert.match(compare, /before=\{a\}/, 'compare passes the selected revisions')

assert.match(projectsRoutes, /"\/:projectId\/drawings\/ai",\s*nestedProjectAccess,\s*require\("\.\/drawing-assistant"\)/, 'routes mounted under drawings/ai')
assert.match(service, /kind: "sheet_read"/, 'title-block runs stored')
assert.match(service, /kind: "sheet_diff"/, 'comparison runs stored')
assert.match(service, /const extractReferences = /, 'deterministic reference extraction')
assert.match(schema, /model SheetReference \{/, 'SheetReference model')
assert.match(schema, /@@unique\(\[sheetId, targetNumber\]\)/, 'one link per target per sheet')

console.log('drawing-assistant-ui: ok')
