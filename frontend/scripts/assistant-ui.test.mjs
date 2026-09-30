import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-AI-ASSIST-028 — project knowledge assistant wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/assistant/hooks/use-assistant.ts')
const sheet = read('src/features/assistant/components/assistant-sheet.tsx')
const navbar = read('src/components/layout/top-navbar.tsx')
const permissions = read('src/lib/permissions.ts')
const policy = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))

for (const name of ['useAssistantStatus', 'useAssistantConversations', 'useAssistantConversation', 'useAskAssistant', 'useDeleteAssistantConversation', 'useAssistantFeedback', 'useRunAssistantAction', 'splitCitations']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /projectId \? `\/projects\/\$\{projectId\}\/assistant` : '\/assistant'/, 'project and org endpoints')
assert.match(hooks, /\/ask`, payload, \{ timeout: 120_000 \}/, 'long timeout for model answers')
assert.match(hooks, /\/messages\/\$\{messageId\}\/feedback/, 'feedback endpoint')
assert.match(hooks, /\/actions`, \{ action \}/, 'actions endpoint')

assert.match(sheet, /export function AssistantButton/, 'top-bar button')
assert.match(sheet, /export const useCurrentProjectId/, 'scopes to the current project from the URL')
assert.match(sheet, /data-testid='uat-assistant-question-input'/, 'question box')
assert.match(sheet, /data-testid='uat-assistant-ask'/, 'ask button')
assert.match(sheet, /data-testid='uat-assistant-citation'/, 'inline [n] citations link to records')
assert.match(sheet, /data-testid='uat-assistant-sources'/, 'sources list')
assert.match(sheet, /uat-assistant-action-\$\{action\.type\}/, 'suggested actions run')
assert.match(sheet, /ThumbsUp/, 'feedback')
assert.match(sheet, /No AI provider is configured/, 'degraded mode explained')
assert.match(sheet, /data-testid='uat-assistant-new'/, 'new conversation')
assert.match(navbar, /<AssistantButton \/>/, 'mounted in the top bar')

assert.match(permissions, /\| 'assistant'/, 'assistant module typed')
assert.ok(policy.modules.assistant, 'assistant module in policy')
// Every role in the policy's own role list can ask, and nothing else is listed:
// a count would pass with a duplicate in place of a missing role, and broke
// when quality_engineer joined the policy (aceaef7).
assert.deepEqual(
  [...policy.modules.assistant.actions.read].sort(),
  policy.roles.map((role) => role.id).sort(),
  'every role can ask',
)
for (const party of ['owner', 'consultant', 'contractor', 'subcontractor']) {
  assert.ok(policy.partyPermissions[party].modules.assistant, `${party} party can ask`)
}

console.log('assistant-ui: ok')
