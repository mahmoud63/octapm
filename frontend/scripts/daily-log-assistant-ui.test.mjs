import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-AI-DAILY-030 — daily report auto-draft wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/site-reporting/hooks/use-daily-log-assistant.ts')
const card = read('src/features/site-reporting/components/daily-log-ai-draft.tsx')
const panel = read('src/features/site-reporting/components/daily-log-panel.tsx')
const backendRoutes = readFileSync(path.join(root, '..', 'backend', 'src', 'routes', 'daily-logs.js'), 'utf8')
const provider = readFileSync(path.join(root, '..', 'backend', 'src', 'services', 'ai-provider.service.js'), 'utf8')

for (const name of ['useDailyLogAiStatus', 'useDraftDailyLog', 'useApplyDailyLogDraft', 'useTranscribeAudio', 'useSpeechDictation', 'useAudioRecorder']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /\/ai\/status`/, 'status endpoint')
assert.match(hooks, /\/\$\{date\}\/ai\/draft`/, 'draft endpoint')
assert.match(hooks, /\/\$\{date\}\/ai\/apply`/, 'apply endpoint')
assert.match(hooks, /\/ai\/transcribe`/, 'transcribe endpoint')
assert.match(hooks, /form\.append\('audio', blob/, 'voice note uploaded as `audio`')
assert.match(hooks, /webkitSpeechRecognition/, 'browser dictation where available')
assert.match(hooks, /new MediaRecorder\(stream\)/, 'recorder fallback for server transcription')

assert.match(card, /export function DailyLogDraftAssistant/, 'draft card component')
assert.match(card, /data-testid='uat-dailylog-ai-notes'/, 'notes box')
assert.match(card, /data-testid='uat-dailylog-ai-dictate'/, 'dictate button')
assert.match(card, /data-testid='uat-dailylog-ai-record'/, 'record button')
assert.match(card, /data-testid='uat-dailylog-ai-photos'/, 'look at photos switch')
assert.match(card, /data-testid='uat-dailylog-ai-draft'/, 'draft button')
assert.match(card, /data-testid='uat-dailylog-ai-summary'/, 'editable summary')
assert.match(card, /type='checkbox'[\s\S]*data-testid=\{testId\}/, 'check rows carry their test id')
assert.match(card, /testId='uat-dailylog-ai-note'/, 'notes are checkboxes')
assert.match(card, /testId='uat-dailylog-ai-delay'/, 'delays are checkboxes')
assert.match(card, /testId='uat-dailylog-ai-caption'/, 'captions are checkboxes')
assert.match(card, /data-testid='uat-dailylog-ai-apply'/, 'apply selected')
assert.match(card, /overwriteCaptions: true/, 'ticked captions replace existing ones')
assert.match(card, /Built from the records only/, 'degraded mode explained')
assert.match(card, /useSummary: !log\.summary/, 'summary pre-selected only when the day has none')

assert.match(panel, /<DailyLogDraftAssistant/, 'card mounted in the daily log')
assert.match(panel, /canUpdate && !locked && \(\s*<DailyLogDraftAssistant/, 'only for editors on an open day')

assert.match(backendRoutes, /require\("\.\/daily-log-assistant"\)/, 'backend routes mounted before the day routes')
assert.match(provider, /providerContent\("anthropic"/, 'image blocks for Anthropic')
assert.match(provider, /providerContent\("openai"/, 'image blocks for OpenAI')
assert.match(provider, /providerContent\("gemini"/, 'image blocks for Gemini')
assert.match(provider, /const transcribeAudio = async/, 'voice transcription')

console.log('daily-log-assistant-ui: ok')
