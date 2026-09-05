import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/drawings/hooks/use-markups.ts')
;[
  '/projects/${projectId}/drawings/sheets/${sheetId}/markups',
  '/projects/${projectId}/drawings/sheets/${sheetId}/markups/mine',
  '/projects/${projectId}/drawings/sheets/${sheetId}/markups/${markupId}/publish',
  '/projects/${projectId}/drawings/sheets/${sheetId}/pins',
  '/projects/${projectId}/drawings/pins/${pinId}',
  '/projects/${projectId}/drawings/pins',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
assert.match(hooks, /\['sheet-markups', projectId, sheetId\]/, 'markup key keeps projectId at index 1')

// ── Geometry ────────────────────────────────────────────────────────────
const geometry = read('src/features/drawings/lib/geometry.ts')
;['toNormalized', 'hitTest', 'measureLabel', 'cloudPath', 'arrowHead'].forEach((symbol) =>
  assert.ok(geometry.includes(`export const ${symbol}`), `geometry exports ${symbol}`)
)
assert.match(geometry, /25\.4 \/ 72/, 'measure converts PDF points to millimetres')

// ── Markup layer ────────────────────────────────────────────────────────
const layer = read('src/features/drawings/components/markup-layer.tsx')
assert.match(layer, /uat-markup-layer/, 'layer test id')
assert.match(layer, /uat-sheet-pin/, 'pin markers')
;["'rect'", "'ellipse'", "'arrow'", "'polyline'", "'cloud'", "'text'", "'measure'", "'highlight'"].forEach((tool) =>
  assert.ok(layer.includes(tool), `layer supports ${tool}`)
)
assert.match(layer, /setPointerCapture/, 'drawing uses pointer capture')
assert.match(layer, /pointerEvents: drawing \? 'auto' : 'none'/, 'view mode passes pointer events through')

// ── Pin dialogs ─────────────────────────────────────────────────────────
const pinDialog = read('src/features/drawings/components/pin-dialog.tsx')
;['uat-pin-dialog', 'uat-pin-mode', 'uat-pin-rfi-subject', 'uat-pin-photo-file', 'uat-pin-submit', 'uat-pin-detail'].forEach((id) =>
  assert.ok(pinDialog.includes(id), `pin dialog exposes ${id}`)
)
assert.match(pinDialog, /recordType: 'rfi',\s*sheetRevisionId,\s*create:/, 'pin can raise an RFI')
assert.match(pinDialog, /useUploadAttachments\(projectId\)/, 'photo pins upload through attachments')
assert.match(pinDialog, /useCanPerform\('rfi', 'create'\)/, 'RFI creation gated')

// ── Compare ─────────────────────────────────────────────────────────────
const compare = read('src/features/drawings/components/revision-compare.tsx')
assert.ok(compare.includes('uat-revision-compare'), 'compare exposes uat-revision-compare')
assert.ok(compare.includes('uat-compare-${value}'), 'compare mode buttons carry test ids')
;["'side'", "'overlay'", "'diff'"].forEach((mode) =>
  assert.ok(compare.includes(mode), `compare offers ${mode}`)
)
assert.match(compare, /getImageData/, 'diff compares pixels client-side')
assert.match(compare, /of the page changed/, 'diff reports the changed share')

// ── Viewer integration ──────────────────────────────────────────────────
const viewer = read('src/features/drawings/components/sheet-viewer.tsx')
;['uat-sheet-mode-${value}', 'uat-markup-tool-${value}', 'uat-markup-tools', 'uat-markup-publish', 'uat-markup-layers', 'uat-sheet-set-scale', 'uat-sheet-toggle-pins'].forEach((id) =>
  assert.ok(viewer.includes(id), `viewer exposes ${id}`)
)
;["'markup'", "'pins'", "'compare'"].forEach((mode) =>
  assert.ok(viewer.includes(mode), `viewer offers mode ${mode}`)
)
assert.match(viewer, /AUTOSAVE_MS/, 'personal layer auto-saves')
assert.match(viewer, /<MarkupLayer/, 'viewer mounts the markup layer over the canvas')
assert.match(viewer, /<RevisionCompare/, 'viewer offers revision compare')
assert.match(viewer, /entityType='sheet'/, 'sheet activity feed')
assert.match(viewer, /only you can see/, 'personal markups explained')

// ── Record chips and deep link ──────────────────────────────────────────
assert.match(read('src/features/workflows/components/workflow-record-list.tsx'), /<RecordPins/, 'records show where they are pinned')
assert.match(read('src/features/projects/data/schema.ts'), /pin\?: string/, 'target carries the pin id')
assert.match(read('src/routes/_authenticated/projects/$projectId.tsx'), /pin: typeof search\.pin === 'string'/, 'pin survives the legacy redirect')

// ── Backend contract ────────────────────────────────────────────────────
const service = read('../backend/src/services/markup.service.js')
;['normalizeShapes', 'publishMarkup', 'createPin', 'listPinsForRecord', 'createLinkedRecord'].forEach((symbol) =>
  assert.ok(service.includes(symbol), `service implements ${symbol}`)
)
assert.match(service, /visibility: VISIBILITY\.PERSONAL/, 'layers start personal')
assert.match(service, /OR: \[\{ visibility: VISIBILITY\.PUBLISHED \}/, 'others only see published layers')
const migration = read('../backend/prisma/migrations/20260906040000_add_sheet_markups_pins/migration.sql')
;['CREATE TABLE "Markup"', 'CREATE TABLE "Pin"', '"scaleRatio"'].forEach((statement) =>
  assert.ok(migration.includes(statement), `migration has ${statement}`)
)
assert.match(read('../backend/src/routes/projects.js'), /\/:projectId\/drawings\/sheets\/:sheetId\/markups/, 'markups router mounted')
assert.match(read('../backend/src/routes/projects.js'), /\/:projectId\/drawings\/pins/, 'record pins router mounted')

console.log('markups-ui: ok')
