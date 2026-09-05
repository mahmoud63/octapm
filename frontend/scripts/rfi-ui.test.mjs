import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/doc-control/hooks/use-doc-control.ts')
;[
  '/projects/${projectId}/rfi/${rfiId}`',
  '/projects/${projectId}/rfi/${rfiId}/people',
  '/projects/${projectId}/rfi/${rfiId}/responses',
  '/projects/${projectId}/rfi/${rfiId}/responses/${responseId}',
  '/projects/${projectId}/rfi/${rfiId}/responses/${responseId}/official',
  '/projects/${projectId}/rfi/${rfiId}/convert-to-change',
  '/projects/${projectId}/rfi/${rfiId}/export.pdf',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
assert.match(hooks, /export type RfiStatus = 'draft' \| 'open' \| 'answered' \| 'closed'/, 'draft status typed')
;['managerUserId', 'assigneeUserIds', 'distributionUserIds', 'specSection', 'costImpactAmount', 'scheduleImpactFlag'].forEach((field) =>
  assert.ok(hooks.includes(field), `upgrade field ${field}`)
)
assert.match(hooks, /ballInCourtUserId\?: string \| null/, 'list can filter by ball in court')
assert.match(hooks, /\[\s*'rfi-detail',\s*projectId,\s*rfiId,?\s*\]/, 'detail key keeps projectId at index 1')

// ── Detail dialog ───────────────────────────────────────────────────────
const detail = read('src/features/doc-control/components/rfi-detail-dialog.tsx')
;[
  'uat-rfi-detail',
  'uat-rfi-status',
  'uat-rfi-actions',
  'uat-rfi-submit',
  'uat-rfi-approve',
  'uat-rfi-close',
  'uat-rfi-reopen',
  'uat-rfi-convert',
  'uat-rfi-export',
  'uat-rfi-edit',
  'uat-rfi-edit-form',
  'uat-rfi-save',
  'uat-rfi-people',
  'uat-rfi-people-edit',
  'uat-rfi-people-save',
  'uat-rfi-official',
  'uat-rfi-thread',
  'uat-rfi-response',
  'uat-rfi-make-official',
  'uat-rfi-reply',
  'uat-rfi-reply-submit',
  'uat-rfi-answer-official',
  'uat-rfi-decision',
  'uat-rfi-change-link',
].forEach((id) => assert.ok(detail.includes(id), `detail exposes ${id}`))
assert.match(detail, /useCanPerform\('rfi', 'submit', 'rfi\.answer'\)/, 'official answers gated by rfi.answer')
assert.match(detail, /useCanPerform\('change_order', 'create'\)/, 'conversion gated by change_order create')
assert.match(detail, /Reopen \(new revision\)/, 'reopen explained as a revision')
assert.match(detail, /<RecordPins[\s\S]*?recordType='rfi'/, 'pins on the RFI')
assert.match(detail, /<AttachmentPanel[\s\S]*?recordType='rfi'/, 'attachments on the RFI')
assert.match(detail, /<CommentThread[\s\S]*?recordType='rfi'/, 'internal notes on the RFI')
assert.match(detail, /<HistoryPanel[\s\S]*?entityType='rfi'/, 'history on the RFI')

// ── Create dialog, people list, saved views ─────────────────────────────
const create = read('src/features/doc-control/components/rfi-create-dialog.tsx')
;['uat-rfi-create', 'uat-rfi-subject', 'uat-rfi-question', 'uat-rfi-spec', 'uat-rfi-activity', 'uat-rfi-manager', 'uat-rfi-assignees', 'uat-rfi-distribution', 'uat-rfi-required-by', 'uat-rfi-cost-impact', 'uat-rfi-schedule-impact', 'uat-rfi-open-now', 'uat-rfi-create-submit'].forEach((id) =>
  assert.ok(create.includes(id), `create dialog exposes ${id}`)
)
assert.match(create, /status: openNow \? 'open' : 'draft'/, 'RFIs can be saved as drafts')
assert.match(read('src/features/doc-control/components/rfi-people-list.tsx'), /useProjectTeam\(projectId\)/, 'people come from the project team')
const views = read('src/features/doc-control/components/rfi-saved-views.tsx')
;['uat-rfi-views', 'uat-rfi-view-select', 'uat-rfi-view-save', 'uat-rfi-view-name'].forEach((id) => assert.ok(views.includes(id), `saved views expose ${id}`))
assert.match(views, /octapm\.rfi\.views\./, 'views persisted per project')
assert.match(views, /Waiting on me/, 'built-in "waiting on me" view')

// ── Dashboard wiring ────────────────────────────────────────────────────
const dashboard = read('src/features/doc-control/components/doc-control-dashboard.tsx')
;['<RfiCreateDialog', '<RfiDetailDialog', '<RfiSavedViews', 'uat-rfi-new', 'uat-rfi-open', 'uat-rfi-mine', 'uat-rfi-overdue', "<SelectItem value='draft'>Draft</SelectItem>"].forEach((token) =>
  assert.ok(dashboard.includes(token), `dashboard has ${token}`)
)
assert.match(dashboard, /initialTarget\?\.source === 'rfi' && initialTarget\.recordId/, 'deep link opens the RFI')

// ── Backend contract ────────────────────────────────────────────────────
const workflow = read('../backend/src/services/rfi-workflow.service.js')
;['syncPeople', 'ballInCourtFor', 'withDraftVisibility', 'addResponse', 'setOfficialResponse', 'applyScheduleImpact', 'convertToChangeEvent', 'exportRfiPdf'].forEach((symbol) =>
  assert.ok(workflow.includes(symbol), `workflow implements ${symbol}`)
)
const rfiService = read('../backend/src/services/rfi.service.js')
assert.match(rfiService, /RFI_STATUSES = \["draft", "open", "answered", "closed"/, 'draft is a status')
assert.match(rfiService, /bumpRevision: existing\.status !== "draft"/, 'reopen bumps the revision')
assert.match(rfiService, /recordOfficialResponse/, 'answers land in the thread as official')
assert.match(rfiService, /applyScheduleImpact/, 'closing writes the schedule impact link')
const routes = read('../backend/src/routes/rfi.js')
;['"/:rfiId/people"', '"/:rfiId/responses"', '"/:rfiId/responses/:responseId/official"', '"/:rfiId/convert-to-change"', '"/:rfiId/export.pdf"'].forEach((path) =>
  assert.ok(routes.includes(path), `route ${path}`)
)
assert.match(routes, /requirePermission\("change_order", "create"\)/, 'conversion needs change-order create')
const migration = read('../backend/prisma/migrations/20260906120000_upgrade_rfi/migration.sql')
;['CREATE TABLE "RfiAssignee"', 'CREATE TABLE "RfiResponse"', 'ADD COLUMN "managerUserId"', 'ADD COLUMN "revision"', '"officialResponseId"'].forEach((statement) =>
  assert.ok(migration.includes(statement), `migration has ${statement}`)
)
assert.match(read('../backend/src/services/notification.service.js'), /"managerUserId",\s*"ballInCourtUserId"/, 'overdue reminders reach the manager and ball in court')

console.log('rfi-ui: ok')
