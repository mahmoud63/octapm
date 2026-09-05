import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-AI-PHOTO-034 — photo and safety intelligence wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/attachments/hooks/use-photo-assistant.ts')
const panel = read('src/features/attachments/components/photo-analysis.tsx')
const gallery = read('src/features/attachments/components/photo-gallery.tsx')
const photosRoutes = readFileSync(path.join(root, '..', 'backend', 'src', 'routes', 'photos.js'), 'utf8')
const jobs = readFileSync(path.join(root, '..', 'backend', 'src', 'jobs', 'handlers', 'index.js'), 'utf8')
const attachments = readFileSync(path.join(root, '..', 'backend', 'src', 'services', 'attachment.service.js'), 'utf8')
const service = readFileSync(path.join(root, '..', 'backend', 'src', 'services', 'photo-assistant.service.js'), 'utf8')

for (const name of ['usePhotoAiStatus', 'usePhotoAnalysis', 'useAnalyzePhoto', 'useAnalyzePhotos', 'useApplyPhotoAnalysis', 'useRaisePhotoObservation']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /\/\$\{photoId\}\/ai\/analyze`/, 'analyze endpoint')
assert.match(hooks, /\/\$\{photoId\}\/ai\/apply`/, 'apply endpoint')
assert.match(hooks, /\/\$\{photoId\}\/ai\/observation`/, 'observation endpoint')
assert.match(hooks, /\/ai\/analyze`, payload/, 'batch endpoint')

assert.match(panel, /export function PhotoAnalysisPanel/, 'analysis panel')
assert.match(panel, /data-testid='uat-photo-ai-analyze'/, 'analyse button')
assert.match(panel, /data-testid='uat-photo-ai-use-caption'/, 'use caption')
assert.match(panel, /data-testid='uat-photo-ai-use-tags'/, 'add tags')
assert.match(panel, /data-testid='uat-photo-ai-safety'/, 'safety findings')
assert.match(panel, /data-testid='uat-photo-ai-raise'/, 'raise observation')
assert.match(panel, /useCanPerform\('punch', 'create'\)/, 'raising gated by the punch permission')
assert.match(panel, /No vision-capable AI provider/, 'degraded state explained')

assert.match(gallery, /<PhotoAnalysisPanel/, 'panel inside the photo dialog')
assert.match(gallery, /data-testid='uat-photo-ai-batch'/, 'batch button in the gallery header')
assert.match(gallery, /uncaptionedOnly: true/, 'batch analyses uncaptioned photos')

assert.match(photosRoutes, /require\("\.\/photo-assistant"\)/, 'routes mounted before the photo routes')
assert.match(jobs, /JOB_TYPES\.PHOTO_ANALYZE/, 'background job registered')
assert.match(attachments, /AI_PHOTO_AUTO/, 'uploads can be analysed automatically')
assert.match(service, /Never identify or describe individual people/, 'prompt protects people')
assert.match(service, /kind: "observation",\s*observationType: "safety"/, 'observations raised through the punch engine')
assert.match(service, /recordType: "punch_item", recordId: item\.id, role: "evidence"/, 'photo attached as evidence')

console.log('photo-assistant-ui: ok')
