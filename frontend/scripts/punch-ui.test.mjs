import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/punch/hooks/use-punch.ts')
;[
  '/projects/${projectId}/punch',
  '/projects/${projectId}/punch/bulk',
  '/projects/${projectId}/punch/distribute',
  '/projects/${projectId}/punch/${itemId}',
  '/projects/${projectId}/punch/${itemId}/transition',
  '/projects/${projectId}/punch/export.${format}',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
assert.match(hooks, /\['punch', projectId, filters\]/, 'list key keeps projectId at index 1 for realtime invalidation')
assert.match(hooks, /close:\s*\{\s*action:\s*'approve',\s*transition:\s*'punch\.close'\s*\}/, 'close maps to the punch.close approve transition')
assert.match(hooks, /void:\s*\{\s*action:\s*'approve',\s*transition:\s*'punch\.void'\s*\}/, 'void maps to the punch.void approve transition')
assert.match(hooks, /closed:\s*\['reopen'\]/, 'closed items can only be reopened')
assert.match(hooks, /responseType:\s*'blob'/, 'exports download through the authenticated client')

// ── Form helpers ────────────────────────────────────────────────────────
const form = read('src/features/punch/lib/form.ts')
assert.match(form, /mode === 'update'/, 'update sends nulls, create omits them')
assert.match(form, /parseBulkTitles/, 'bulk titles parsed one per line')

// ── List ────────────────────────────────────────────────────────────────
const list = read('src/features/punch/components/punch-list.tsx')
;[
  'uat-punch-list',
  'uat-punch-search',
  'uat-punch-status',
  'uat-punch-company-filter',
  'uat-punch-mine',
  'uat-punch-overdue',
  'uat-punch-groupby',
  'uat-punch-row',
  'uat-punch-new',
  'uat-punch-export',
  'uat-punch-distribute',
  'uat-punch-summary-overdue',
].forEach((id) => assert.ok(list.includes(id), `list exposes ${id}`))
assert.match(list, /useCanPerform\('punch', 'export'\)/, 'export gated by permission')
assert.match(list, /useCanPerform\('punch',\s*'submit',\s*'punch\.distribute'\)/, 'distribute gated by transition')
assert.match(list, /ballInCourtUserId: mine \? 'me' : null/, '"waiting on me" filter uses the me alias')
;["'company'", "'location'", "'none'"].forEach((mode) => assert.ok(list.includes(mode), `list groups by ${mode}`))
assert.match(list, /includePhotos: true/, 'PDF with photos offered')

// ── Detail ──────────────────────────────────────────────────────────────
const detail = read('src/features/punch/components/punch-item-detail.tsx')
;['uat-punch-detail', 'uat-punch-actions', 'uat-punch-edit', 'uat-punch-reason', 'uat-punch-reason-submit', 'uat-punch-ledger', 'uat-punch-save'].forEach((id) =>
  assert.ok(detail.includes(id), `detail exposes ${id}`)
)
assert.ok(detail.includes('uat-punch-action-${action}'), 'action buttons carry test ids')
assert.match(detail, /ACTION_PERMISSION\[action\]/, 'each action checks its own permission')
assert.match(detail, /finalApproverUserId !== currentUser\?\.id/, 'close is held for the final approver')
assert.match(detail, /REASON_REQUIRED\.includes\(action\)/, 'reopen / dispute / void ask for a reason')
assert.match(detail, /<RecordPins/, 'detail shows where the item is pinned')
assert.match(detail, /<AttachmentPanel[\s\S]*?recordType='punch_item'/, 'evidence panel on punch_item')
assert.match(detail, /<CommentThread[\s\S]*?recordType='punch_item'/, 'discussion on punch_item')
assert.match(detail, /<HistoryPanel[\s\S]*?entityType='punch_item'/, 'audit history on punch_item')

// ── Create / distribute ─────────────────────────────────────────────────
const create = read('src/features/punch/components/punch-create-dialog.tsx')
;['uat-punch-create', 'uat-punch-bulk-tab', 'uat-punch-bulk-text', 'uat-punch-open-now', 'uat-punch-create-submit'].forEach((id) =>
  assert.ok(create.includes(id), `create dialog exposes ${id}`)
)
assert.match(create, /status: openNow \? 'open' : 'draft'/, 'items open now or stay draft')
const distribute = read('src/features/punch/components/punch-distribute-dialog.tsx')
;['uat-punch-distribute-dialog', 'uat-punch-distribute-company', 'uat-punch-distribute-send'].forEach((id) =>
  assert.ok(distribute.includes(id), `distribute dialog exposes ${id}`)
)
assert.match(distribute, /useProjectTeam\(projectId/, 'recipients come from the project team')

// ── Module and deep links ───────────────────────────────────────────────
const module_ = read('src/features/punch/components/punch-module.tsx')
assert.match(module_, /source === 'sheet_qr'/, 'sheet QR deep link opens quick-create')
assert.match(module_, /uat-punch-legacy-toggle/, 'legacy defect register stays reachable')
const quality = read('src/features/quality/components/quality-dashboard.tsx')
assert.match(quality, /<PunchModule/, 'quality dashboard hosts the punch module')
assert.match(quality, /Punch list/, 'tab renamed')
assert.match(read('src/features/projects/components/project-detail.tsx'), /label: 'Punch list'/, 'workspace child label')
assert.match(read('src/features/projects/components/project-detail.tsx'), /<QualityDashboard[\s\S]*?initialTarget=\{initialTarget\}/, 'quality receives deep-link target')

// ── Wiring ──────────────────────────────────────────────────────────────
assert.match(read('src/lib/permissions.ts'), /\| 'punch'/, 'punch permission module typed')
assert.match(read('src/features/projects/lib/project-modules.ts'), /quality: \['ncr', 'safety', 'punch'\]/, 'quality workspace backed by punch')
assert.match(read('src/features/attachments/components/attachment-panel.tsx'), /punch_item: 'punch'/, 'attachments guarded by punch')
assert.match(read('src/features/drawings/hooks/use-markups.ts'), /'punch_item'/, 'pins can target punch items')
const pinDialog = read('src/features/drawings/components/pin-dialog.tsx')
assert.match(pinDialog, /useCanPerform\('punch', 'create'\)/, 'raising a punch item from a pin is gated')
;["'new_punch'", "'link_punch'", 'uat-pin-punch-title', 'uat-pin-punch-select'].forEach((token) =>
  assert.ok(pinDialog.includes(token), `pin dialog has ${token}`)
)
assert.match(pinDialog, /recordType: 'punch_item',\s*sheetRevisionId,\s*create:/, 'pin can raise a punch item')
const grid = read('src/features/drawings/components/sheet-grid.tsx')
assert.match(grid, /uat-sheet-qr/, 'sheet cards offer a QR label')
assert.match(grid, /<SheetQrDialog/, 'QR dialog mounted')
const qr = read('src/features/drawings/components/sheet-qr-dialog.tsx')
assert.match(qr, /qr\.svg/, 'QR fetched from the sheet route')
assert.match(qr, /source=sheet_qr&recordId=/, 'QR link opens the punch list for the sheet')

// ── Backend contract ────────────────────────────────────────────────────
const service = read('../backend/src/services/punch.service.js')
;['createPunchItem', 'bulkCreatePunchItems', 'transitionPunchItem', 'distributePunchItems', 'exportPunchListPdf', 'exportPunchListCsv', 'visibilityWhere'].forEach((symbol) =>
  assert.ok(service.includes(symbol), `service implements ${symbol}`)
)
assert.match(service, /PUNCH_FINAL_APPROVER_ONLY/, 'final approver enforced server-side')
assert.match(service, /projectParty: \{ projectId, status: "active", companyId: \{ in: ids \} \}/, 'company members resolved through project parties')
const policy = JSON.parse(read('../shared/permissions.json'))
assert.ok(policy.modules.punch, 'punch module in the policy')
assert.deepEqual(policy.modules.punch.transitions['punch.close'], ['pm'], 'only PMs close by base policy')
assert.ok(policy.partyPermissions.subcontractor.modules.punch.transitions.includes('punch.ready_for_review'), 'subcontractors can submit for review')
assert.ok(!policy.partyPermissions.subcontractor.modules.punch.transitions.includes('punch.close'), 'subcontractors cannot close')
const migration = read('../backend/prisma/migrations/20260906060000_add_punch_list/migration.sql')
;['CREATE TABLE "PunchItem"', 'CREATE TABLE "PunchItemEvent"', 'INSERT INTO "PunchItem"', '"legacyDefectId"'].forEach((statement) =>
  assert.ok(migration.includes(statement), `migration has ${statement}`)
)
assert.match(read('../backend/src/routes/projects.js'), /\/:projectId\/punch/, 'punch router mounted')
assert.match(read('../backend/src/routes/sheets.js'), /qr\.svg/, 'sheet QR route')
;['../backend/src/utils/qr.js', '../backend/src/utils/pdf-writer.js'].forEach((file) => assert.ok(read(file).length > 1000, `${file} present`))

console.log('punch-ui: ok')
