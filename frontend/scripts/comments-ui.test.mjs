import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/comments/hooks/use-comments.ts')
;[
  '/projects/${projectId}/comments',
  '/projects/${projectId}/comments/${commentId}',
  '/projects/${projectId}/subscriptions',
  '/projects/${projectId}/subscriptions/mine',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
assert.match(hooks, /\['comments', projectId, recordType, recordId\]/, 'comment key keeps projectId at index 1')
assert.match(hooks, /\['audit-events', projectId\]/, 'comment writes refresh the history feed')

// ── Thread component ────────────────────────────────────────────────────
const thread = read('src/features/comments/components/comment-thread.tsx')
;[
  'uat-comment-thread',
  'uat-comment-input',
  'uat-comment-post',
  'uat-comment-follow',
  'uat-comment-item',
  'uat-comment-mention-option',
].forEach((id) => assert.ok(thread.includes(id), `thread exposes ${id}`))
assert.match(thread, /useProjectTeam\(projectId\)/, '@ autocomplete uses the project team')
assert.match(thread, /mentionUserIds/, 'mentions are sent as explicit user ids')
assert.match(thread, /body\.includes\(`@\$\{name\}`\)/, 'a removed @Name drops its mention')
assert.match(thread, /useCanPerform\(moduleForRecordType\(recordType\), 'read'\)/, 'thread follows the record module read permission')
assert.match(thread, /comment\.canEdit/, 'edit gated by server flag')
assert.match(thread, /comment\.canDelete/, 'delete gated by server flag')
assert.ok(!/Procore/i.test(thread), 'no vendor wording')

// ── Wiring ──────────────────────────────────────────────────────────────
const recordList = read('src/features/workflows/components/workflow-record-list.tsx')
assert.match(recordList, /<CommentThread/, 'every workflow record renders the discussion thread')

const historyPanel = read('src/features/audit/components/audit-history-panel.tsx')
assert.match(historyPanel, /comment: 'Comments'/, 'history feed labels the comment source')
assert.match(historyPanel, /'commented'/, 'history feed can filter to comments')
assert.match(read('src/features/audit/hooks/use-audit-events.ts'), /\| 'comment'/, 'source type includes comment')

const notificationHooks = read('src/features/notifications/hooks/use-notifications.ts')
assert.match(notificationHooks, /'mention',\s*'comment',/, 'notification categories include mention and comment')
const preferencesForm = read('src/features/settings/notifications/notifications-form.tsx')
assert.match(preferencesForm, /category: 'mention'/, 'preferences expose Mentions')
assert.match(preferencesForm, /category: 'comment'/, 'preferences expose Comments')
assert.match(preferencesForm, /comment: \{ inAppEnabled: true, emailEnabled: false \}/, 'comment emails default off')

// ── Backend contract ────────────────────────────────────────────────────
const service = read('../backend/src/services/comment.service.js')
assert.match(service, /assertProjectAccess\(/, 'mentions are limited to users with project access')
assert.match(service, /update: \{\},\s*\}\);/, 'automatic follows never un-mute an explicit unfollow')
assert.match(service, /registerAutoSubscriptions/, 'record events auto-subscribe creators and assignees')
const notifications = read('../backend/src/services/notification.service.js')
assert.match(notifications, /MENTION: "mention"/, 'mention category exists')
assert.match(notifications, /COMMENT: "comment"/, 'comment category exists')
assert.match(notifications, /recordWorkspacePath\(\{ projectId, recordType, recordId \}\)/, 'notification links open the record module')
const audit = read('../backend/src/services/audit.service.js')
assert.match(audit, /COMMENT: "comment"/, 'audit feed has a comment source')
const migration = read(
  '../backend/prisma/migrations/20260905230000_add_comments_and_subscriptions/migration.sql'
)
;['CREATE TABLE "Comment"', 'CREATE TABLE "CommentMention"', 'CREATE TABLE "RecordSubscription"'].forEach(
  (statement) => assert.ok(migration.includes(statement), `migration has ${statement}`)
)
assert.match(migration, /ON CONFLICT \("recordType", "recordId", "userId"\) DO NOTHING/, 'backfill is idempotent')
assert.match(read('../backend/src/routes/projects.js'), /\/:projectId\/comments/, 'comments router mounted')
assert.match(read('../backend/src/routes/projects.js'), /\/:projectId\/subscriptions/, 'subscriptions router mounted')
assert.match(read('../backend/src/index.js'), /registerAutoSubscriptions\(\)/, 'auto-subscriptions registered at boot')

console.log('comments-ui: ok')
