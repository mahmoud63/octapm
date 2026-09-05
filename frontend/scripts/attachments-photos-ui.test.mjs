import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/attachments/hooks/use-attachments.ts')
;[
  '/projects/${projectId}/attachments',
  '/projects/${projectId}/attachments/${attachmentId}',
  '/projects/${projectId}/photos',
  '/projects/${projectId}/photos/${photoId}',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
assert.match(hooks, /form\.append\('files', file\)/, 'uploads are multipart')
assert.match(hooks, /JSON\.stringify\(input\.documentIds\)/, 'existing documents can be linked')
assert.match(hooks, /\['attachments', projectId, recordType, recordId\]/, 'query key keeps projectId at index 1')

// ── Attachment panel ────────────────────────────────────────────────────
const panel = read('src/features/attachments/components/attachment-panel.tsx')
assert.match(panel, /capture='environment'/, 'camera capture input exists')
assert.match(panel, /uat-attachment-file-input/, 'file input test id')
assert.match(panel, /uat-attachment-link-photos/, 'gallery picker attaches existing photos')
assert.match(panel, /canUpdate \|\| canSubmit \|\| canCreate/, 'write gated on record module')
assert.match(panel, /const RECORD_MODULES/, 'record type → module map present')

// ── Gallery ─────────────────────────────────────────────────────────────
const gallery = read('src/features/attachments/components/photo-gallery.tsx')
;['uat-photo-gallery', 'uat-photo-tile', 'uat-photo-clear-filters', 'uat-photo-save'].forEach((id) =>
  assert.ok(gallery.includes(id), `gallery exposes ${id}`)
)
assert.match(gallery, /<LocationPicker/, 'gallery filters by location')
assert.match(gallery, /summary\.tags\.map/, 'gallery offers tag chips')
assert.match(gallery, /openstreetmap\.org/, 'GPS opens a map')

// ── Wiring ──────────────────────────────────────────────────────────────
const recordList = read('src/features/workflows/components/workflow-record-list.tsx')
assert.match(recordList, /<AttachmentPanel/, 'record lists render the unified panel')
assert.match(recordList, /!attachment\.attachmentId/, 'legacy rows are passed through')
const projectDetail = read('src/features/projects/components/project-detail.tsx')
assert.match(projectDetail, /\{ key: 'photos', label: 'Photos' \}/, 'Photos module in the menu')
assert.match(
  read('src/features/projects/lib/project-modules.ts'),
  /photos: \['document_control'\]/,
  'Photos visibility follows document_control'
)
assert.match(projectDetail, /<PhotoGallery projectId=\{projectId\} \/>/, 'Photos renders the gallery')

// ── Backend contract ────────────────────────────────────────────────────
const service = read('../backend/src/services/attachment.service.js')
assert.match(service, /RECORD_TYPE_MODULES/, 'backend record type map')
assert.match(service, /readImageMetadata\(file\.path\)/, 'EXIF read from the temp upload')
assert.match(service, /PHOTO_THUMBNAIL/, 'thumbnail job enqueued')
const handlers = read('../backend/src/jobs/handlers/index.js')
assert.match(handlers, /runPhotoThumbnailJob/, 'thumbnail handler registered')
const migration = read(
  '../backend/prisma/migrations/20260905190000_add_attachments_and_photos/migration.sql'
)
;['"WorkflowAttachment"', '"CommercialAttachmentRef"', '"TaskAttachment"', '"photosJson"'].forEach(
  (legacy) => assert.ok(migration.includes(legacy), `migration migrates ${legacy}`)
)
assert.match(migration, /INSERT INTO "Photo"/, 'migration seeds Photo rows')

console.log('attachments-photos-ui: ok')
