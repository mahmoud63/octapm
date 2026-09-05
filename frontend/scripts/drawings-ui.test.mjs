import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/drawings/hooks/use-drawings.ts')
;[
  '/projects/${projectId}/drawings/sets',
  '/projects/${projectId}/drawings/sets/${setId}',
  '/projects/${projectId}/drawings/sets/${setId}/revisions',
  '/projects/${projectId}/drawings/sets/${setId}/publish',
  '/projects/${projectId}/drawings/sets/${setId}/reprocess',
  '/projects/${projectId}/drawings/sheets',
  '/projects/${projectId}/drawings/sheets/${sheetId}',
  '/projects/${projectId}/drawings/sheets/${sheetId}/revisions',
  '/projects/${projectId}/drawings/sheets/revisions/${revisionId}/publish',
  '/projects/${projectId}/drawings/sheets/offline-manifest',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
assert.match(hooks, /\['drawing-set', projectId, setId\]/, 'set key keeps projectId at index 1')
assert.match(hooks, /status === 'processing' \? 2500 : false/, 'set detail polls while processing')
assert.match(hooks, /onUploadProgress/, 'set upload reports progress')

// ── PDF.js loader ───────────────────────────────────────────────────────
const pdf = read('src/features/drawings/lib/pdf.ts')
assert.match(pdf, /import\('pdfjs-dist'\)/, 'pdf.js is loaded lazily as its own chunk')
assert.match(pdf, /pdf\.worker\.min\.mjs\?url/, 'worker is bundled by Vite')
assert.match(pdf, /responseType: 'arraybuffer'/, 'PDF bytes are fetched through the authenticated API client')
assert.match(pdf, /documentCache/, 'one document download is shared by thumbnails and the viewer')
assert.match(read('package.json'), /"pdfjs-dist"/, 'pdfjs-dist is a dependency')

// ── Components ──────────────────────────────────────────────────────────
const viewer = read('src/features/drawings/components/sheet-viewer.tsx')
;['uat-sheet-viewer', 'uat-sheet-banner', 'uat-sheet-revision-select', 'uat-sheet-new-revision', 'uat-sheet-canvas-frame'].forEach((id) =>
  assert.ok(viewer.includes(id), `viewer exposes ${id}`)
)
assert.match(viewer, /viewing a superseded revision/, 'superseded banner')
assert.match(
  viewer,
  /useCanPerform\(\s*'document_control',\s*'update',\s*'drawing\.publish'\s*\)/,
  'publish gated by transition'
)
assert.match(
  viewer,
  /<CommentThread\s+projectId=\{projectId\}\s+recordType='sheet'/,
  'sheet discussion thread'
)
assert.match(viewer, /ZOOM_STEPS/, 'zoom controls')

const review = read('src/features/drawings/components/drawing-set-review.tsx')
;['uat-drawing-set-review', 'uat-drawing-set-progress', 'uat-drawing-set-save', 'uat-drawing-set-publish', 'uat-drawing-set-row'].forEach((id) =>
  assert.ok(review.includes(id), `review grid exposes ${id}`)
)
assert.match(review, /ConfidenceBadge/, 'confidence shown per page')
assert.match(review, /Not a sheet/, 'pages can be rejected')

const setList = read('src/features/drawings/components/drawing-set-list.tsx')
;['uat-drawing-sets', 'uat-drawing-set-new', 'uat-drawing-set-file', 'uat-drawing-set-upload', 'uat-drawing-set-item'].forEach((id) =>
  assert.ok(setList.includes(id), `set list exposes ${id}`)
)
assert.match(setList, /accept='application\/pdf,\.pdf'/, 'upload accepts PDF only')

const grid = read('src/features/drawings/components/sheet-grid.tsx')
;['uat-sheet-grid', 'uat-sheet-search', 'uat-sheet-discipline', 'uat-sheet-status', 'uat-sheet-card', 'uat-sheet-offline-list'].forEach((id) =>
  assert.ok(grid.includes(id), `sheet grid exposes ${id}`)
)
assert.match(grid, /<LocationPicker/, 'area filter uses the location tree')
assert.match(grid, /<SheetThumbnail/, 'cards render page thumbnails')

const module = read('src/features/drawings/components/drawings-module.tsx')
assert.match(module, /source === 'sheet'/, 'deep links open the sheet viewer')
assert.match(module, /source === 'drawing_set'/, 'deep links open the set review')
assert.match(module, /uat-drawings-legacy-toggle/, 'legacy register kept under a toggle')

// ── Wiring ──────────────────────────────────────────────────────────────
const dashboard = read('src/features/doc-control/components/doc-control-dashboard.tsx')
assert.match(dashboard, /<DrawingsModule/, 'doc control drawings tab renders the drawings tool')
assert.match(dashboard, /recordType='drawing'/, 'legacy drawing records still listed')

// ── Backend contract ────────────────────────────────────────────────────
const service = read('../backend/src/services/drawing-set.service.js')
;['runDrawingSetJob', 'publishRevisions', 'supersededById', 'detectSheetMetadata', 'offlineManifest'].forEach((symbol) =>
  assert.ok(service.includes(symbol), `service implements ${symbol}`)
)
assert.match(read('../backend/src/utils/sheet-title-detect.js'), /begincodespacerange|NUMBER_KEYWORD/, 'title-block detector present')
assert.match(read('../backend/src/utils/document-text.js'), /const pdfPages = /, 'per-page PDF text export')
assert.match(read('../shared/permissions.json'), /"drawing\.publish": \["pm", "planning_eng"\]/, 'drawing.publish transition')
assert.match(read('../backend/src/routes/projects.js'), /\/:projectId\/drawings\/sets/, 'sets router mounted')
assert.match(read('../backend/src/routes/projects.js'), /\/:projectId\/drawings\/sheets/, 'sheets router mounted')
const migration = read('../backend/prisma/migrations/20260906020000_add_drawing_sets_sheets/migration.sql')
;['CREATE TABLE "DrawingSet"', 'CREATE TABLE "Sheet"', 'CREATE TABLE "SheetRevision"', 'FROM "DrawingRecord" d'].forEach((statement) =>
  assert.ok(migration.includes(statement), `migration has ${statement}`)
)
assert.match(read('../backend/src/jobs/handlers/index.js'), /runDrawingSetJob/, 'set processing job registered')

console.log('drawings-ui: ok')
