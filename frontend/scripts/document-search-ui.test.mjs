import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/doc-control/hooks/use-document-search.ts')
;[
  '/projects/${projectId}/documents/search',
  '/projects/${projectId}/documents/index-status',
  '/projects/${projectId}/documents/reindex',
  '/projects/${projectId}/documents/${documentId}/text',
  '/projects/${projectId}/documents/${documentId}/extract',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
assert.match(hooks, /\['document-search', projectId, q, semantic\]/, 'search key keeps projectId at index 1')
assert.match(hooks, /refetchInterval/, 'index status polls while extraction is pending')

// ── Panel ───────────────────────────────────────────────────────────────
const panel = read('src/features/doc-control/components/document-search-panel.tsx')
;[
  'uat-document-search',
  'uat-document-search-input',
  'uat-document-search-hit',
  'uat-document-index-status',
  'uat-document-reindex',
  'uat-document-search-semantic',
].forEach((id) => assert.ok(panel.includes(id), `panel exposes ${id}`))
assert.match(panel, /\[\[\^\\\]\]\*\]\]|\(\\\[\\\[\[\^\\\]\]\*\\\]\\\]\)/, 'snippets highlight [[match]] markers')
assert.match(panel, /useCanPerform\('document_control', 'update'\)/, 'reindex gated on document_control.update')
assert.match(panel, /embeddingsEnabled &&/, 'semantic toggle only when embeddings are enabled')
assert.match(panel, /hit\.fileUrl/, 'hits open the stored file')
assert.match(panel, /hit\.records\.map/, 'hits link to the records they belong to')
assert.ok(!/Procore/i.test(panel), 'no vendor wording')

// ── Wiring ──────────────────────────────────────────────────────────────
const dashboard = read('src/features/doc-control/components/doc-control-dashboard.tsx')
assert.match(dashboard, /<TabsContent value='search'>/, 'doc control has a Search tab')
assert.match(dashboard, /<DocumentSearchPanel projectId=\{projectId\} \/>/, 'Search tab renders the panel')
const projectDetail = read('src/features/projects/components/project-detail.tsx')
assert.match(projectDetail, /\{ key: 'search', label: 'Search' \}/, 'workspace menu lists doc-control › Search')

// ── Backend contract ────────────────────────────────────────────────────
const extractor = read('../backend/src/utils/document-text.js')
;['extractPdf', 'extractDocx', 'extractPptx', 'extractSpreadsheet', 'parseCMap', 'expandObjectStreams'].forEach(
  (symbol) => assert.ok(extractor.includes(symbol), `extractor implements ${symbol}`)
)
assert.match(read('../backend/src/utils/zip-reader.js'), /inflateRawSync/, 'zip reader uses core zlib')
const service = read('../backend/src/services/document-text.service.js')
assert.match(service, /websearch_to_tsquery/, 'search uses websearch syntax')
assert.match(service, /ts_headline/, 'search returns headline snippets')
assert.match(service, /documentVisible\(/, 'hits are filtered by linked-record permissions')
const handlers = read('../backend/src/jobs/handlers/index.js')
assert.match(handlers, /runDocumentExtractJob/, 'extract job handler registered')
assert.match(read('../backend/src/services/file-storage.service.js'), /enqueueExtraction/, 'uploads queue extraction')
assert.match(read('../backend/src/services/search.service.js'), /searchDocumentContent/, 'global search includes content hits')
const migration = read('../backend/prisma/migrations/20260906000000_add_document_text_search/migration.sql')
assert.match(migration, /GENERATED ALWAYS AS/, 'searchVector is a generated column')
assert.match(migration, /USING GIN/, 'searchVector is GIN indexed')
assert.match(migration, /'document\.extract'/, 'existing documents are queued for extraction')
const embeddings = read('../backend/src/services/embedding.service.js')
;['OPENAI_API_KEY', 'VOYAGE_API_KEY', 'GEMINI_API_KEY'].forEach((key) =>
  assert.ok(embeddings.includes(key), `embedding provider ${key} supported`)
)

console.log('document-search-ui: ok')
