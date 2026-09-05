import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-AI-RFI-029 — RFI drafting and response assistant wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/doc-control/hooks/use-rfi-assistant.ts')
const draft = read('src/features/doc-control/components/rfi-ai-draft.tsx')
const response = read('src/features/doc-control/components/rfi-ai-response.tsx')
const createDialog = read('src/features/doc-control/components/rfi-create-dialog.tsx')
const detailDialog = read('src/features/doc-control/components/rfi-detail-dialog.tsx')
const sheet = read('src/features/assistant/components/assistant-sheet.tsx')
const feedback = read('src/features/assistant/components/ai-run-feedback.tsx')
const backendRoutes = readFileSync(path.join(root, '..', 'backend', 'src', 'routes', 'rfi.js'), 'utf8')

for (const name of ['useDraftRfiWithAi', 'useSimilarRfis', 'useSuggestRfiResponse', 'useSummarizeRfi', 'useDebouncedValue']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /\/rfi\/ai\/draft`/, 'draft endpoint')
assert.match(hooks, /\/rfi\/ai\/similar`/, 'similar endpoint')
assert.match(hooks, /\/rfi\/\$\{rfiId\}\/ai\/response`/, 'response endpoint')
assert.match(hooks, /\/rfi\/\$\{rfiId\}\/ai\/summary`/, 'summary endpoint')
assert.match(hooks, /q\.trim\(\)\.length >= 6/, 'similar check waits for a real subject')

assert.match(sheet, /export function CitedText/, 'cited text shared from the assistant')
assert.match(sheet, /export function SourcesList/, 'sources list shared')
assert.match(feedback, /export function AiRunFeedback/, 'run feedback control')
assert.match(feedback, /data-testid='uat-ai-run-feedback'/, 'feedback test id')

assert.match(draft, /export function RfiDraftAssistant/, 'draft assistant component')
assert.match(draft, /export function SimilarRfis/, 'similar RFIs component')
assert.match(draft, /data-testid='uat-rfi-ai-prompt'/, 'rough-note box')
assert.match(draft, /data-testid='uat-rfi-ai-draft'/, 'draft button')
assert.match(draft, /data-testid='uat-rfi-ai-apply'/, 'apply fills the form')
assert.match(draft, /data-testid='uat-rfi-ai-answered'/, 'already-answered warning')
assert.match(draft, /data-testid='uat-rfi-similar'/, 'duplicate check while typing')
assert.match(draft, /target='_blank'/, 'prior RFIs open in a new tab so the form is kept')
assert.match(draft, /Not configured on this server/, 'degraded state explained')

assert.match(response, /export function RfiResponseAssistant/, 'response assistant component')
assert.match(response, /data-testid='uat-rfi-ai-suggest'/, 'draft a response')
assert.match(response, /data-testid='uat-rfi-ai-summary'/, 'summarise thread')
assert.match(response, /data-testid='uat-rfi-ai-use'/, 'use this draft')
assert.match(response, /data-testid='uat-rfi-ai-conflicts'/, 'conflicts shown')
assert.match(response, /suggestion\.responsePlain/, 'plain text goes into the reply box')
assert.match(response, /CONFIDENCE_LABEL/, 'confidence badge')

assert.match(createDialog, /<RfiDraftAssistant/, 'draft assistant on the New RFI form')
assert.match(createDialog, /<SimilarRfis projectId=\{projectId\} query=\{subject\} \/>/, 'similar check under the subject')
assert.match(createDialog, /setQuestion\(draft\.questionPlain \|\| draft\.question\)/, 'applied question is plain text')
assert.match(detailDialog, /<RfiResponseAssistant/, 'response assistant in the RFI workspace')
assert.match(detailDialog, /onUseDraft=\{\(text\) => setReply\(text\)\}/, 'draft lands in the reply box, never posted')

assert.match(backendRoutes, /require\("\.\/rfi-assistant"\)/, 'backend routes mounted inside the RFI router')

console.log('rfi-assistant-ui: ok')
