import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// ── Hooks ───────────────────────────────────────────────────────────────
const hooks = read('src/features/commercial/hooks/use-commitments.ts')
;[
  '/projects/${projectId}/commitments`',
  '/${commitmentId}/lines`',
  '/${commitmentId}/insurance`',
  '/${commitmentId}/${action}`',
  '/${commitmentId}/execute`',
  '/${commitmentId}/change-orders`',
  '/change-orders/${changeOrderId}/${action}`',
  '/change-orders/from-prime`',
  '/${commitmentId}/export.pdf`',
].forEach((fragment) => assert.ok(hooks.includes(fragment), `hooks call ${fragment}`))
assert.match(hooks, /'subcontract' \| 'purchase_order'/, 'two commitment types')
assert.match(hooks, /'draft'[\s\S]*'pending'[\s\S]*'approved'[\s\S]*'executed'[\s\S]*'closed'[\s\S]*'void'/, 'status lifecycle typed')
assert.match(hooks, /form\.append\('file', file\)/, 'execution uploads the signed agreement')

// ── Panel and dialogs ───────────────────────────────────────────────────
const panel = read('src/features/commercial/components/commitments-panel.tsx')
;['uat-commitments-panel', 'uat-commitment-new', 'uat-commitment-list', 'uat-commitment-row', 'uat-commitment-open'].forEach((id) =>
  assert.ok(panel.includes(id), `panel exposes ${id}`)
)
assert.match(panel, /useCanPerform\('commitment', 'create'\)/, 'creation gated by the commitment module')
assert.match(panel, /entityType='commitment'/, 'history on commitments')
const dialogs = read('src/features/commercial/components/commitment-dialogs.tsx')
;[
  'uat-commitment-create',
  'uat-commitment-type',
  'uat-commitment-title',
  'uat-commitment-vendor',
  'uat-commitment-sov',
  'uat-commitment-line-add',
  'uat-commitment-create-submit',
  'uat-commitment-detail',
  'uat-commitment-status',
  'uat-commitment-values',
  'uat-commitment-actions',
  'uat-commitment-submit',
  'uat-commitment-approve',
  'uat-commitment-execute',
  'uat-commitment-execute-form',
  'uat-commitment-execute-confirm',
  'uat-commitment-insurance',
  'uat-commitment-insurance-gate',
  'uat-commitment-lines-edit',
  'uat-commitment-lines-save',
  'uat-commitment-change-orders',
  'uat-commitment-co-new',
  'uat-commitment-export',
].forEach((id) => assert.ok(dialogs.includes(id), `dialogs expose ${id}`))
assert.match(dialogs, /useCanPerform\(\s*'commitment',\s*'approve',\s*'commitment\.execute'\s*\)/, 'execution gated by commitment.execute')
assert.match(dialogs, /useCanPerform\(\s*'commitment',\s*'delete',\s*'commitment\.void'\s*\)/, 'void and insurance override gated by commitment.void')
assert.match(dialogs, /useVendors\(/, 'vendors come from the company list')
assert.match(dialogs, /useProjectCostCodes\(projectId\)/, 'SOV lines pick project cost codes')
assert.match(dialogs, /raise a change order for changes/, 'lines lock after approval')
assert.match(dialogs, /<AttachmentPanel[\s\S]*?recordType='commitment'/, 'attachments on the commitment')
assert.match(dialogs, /<CommentThread[\s\S]*?recordType='commitment'/, 'notes on the commitment')
assert.match(read('src/features/commercial/components/commercial-dashboard.tsx'), /<TabsTrigger value='commitments'>Commitments<\/TabsTrigger>/, 'Commitments tab')
assert.match(read('src/features/projects/components/project-detail.tsx'), /\{ key: 'commitments', label: 'Commitments' \}/, 'Commitments sub-tab')
assert.match(read('src/lib/permissions.ts'), /\| 'commitment'/, 'commitment permission module typed')
assert.match(read('src/features/projects/lib/project-modules.ts'), /commercial: \['change_order', 'ipc', 'eot', 'commitment'(, '[a-z_]+')*\]/, 'commercial module backed by commitments')

// ── Backend contract ────────────────────────────────────────────────────
const service = read('../backend/src/services/commitment.service.js')
;['visibilityWhere', 'recomputeCommitted', 'createCommitment', 'replaceLines', 'setInsurance', 'submitCommitment', 'approveCommitment', 'executeCommitment', 'closeCommitment', 'voidCommitment', 'createChangeOrder', 'transitionChangeOrder', 'spawnFromPrimeChangeOrder', 'exportStatementPdf'].forEach((symbol) =>
  assert.ok(service.includes(symbol), `service implements ${symbol}`)
)
assert.match(service, /COMMITMENT_INSURANCE_MISSING/, 'execution gated on insurance')
assert.match(service, /committedFromCommitments: value/, 'committed cost posted to budget lines')
assert.match(service, /vendorCompanyId: \{ in: companyIds \}/, 'party users see their own commitments')
assert.match(read('../backend/src/services/budget.service.js'), /committedFromCommitments > 0 \? committedFromCommitments/, 'budget lines prefer posted committed cost')
assert.match(read('../backend/src/services/procurement.service.js'), /commitmentId: payload\.commitmentId \|\| null/, 'purchase orders link to commitments')
const permissions = read('../shared/permissions.json')
assert.match(permissions, /"commitment": \{\s*"label": "Commitments"/, 'commitment module in the policy')
;['commitment.submit', 'commitment.approve', 'commitment.execute', 'commitment.close', 'commitment.void', 'commitment_co.submit', 'commitment_co.approve'].forEach((transition) =>
  assert.ok(permissions.includes(`"${transition}"`), `transition ${transition}`)
)
const routes = read('../backend/src/routes/commitments.js')
;['"/:commitmentId/lines"', '"/:commitmentId/insurance"', '"/:commitmentId/submit"', '"/:commitmentId/approve"', '"/:commitmentId/return"', '"/:commitmentId/execute"', '"/:commitmentId/close"', '"/:commitmentId/change-orders"', '"/change-orders/from-prime"', '"/:commitmentId/export.pdf"'].forEach((path) =>
  assert.ok(routes.includes(path), `route ${path}`)
)
assert.match(read('../backend/src/routes/projects.js'), /"\/:projectId\/commitments"/, 'commitments router mounted')
const migration = read('../backend/prisma/migrations/20260906200000_add_commitments/migration.sql')
;['CREATE TABLE "Commitment"', 'CREATE TABLE "CommitmentSovLine"', 'CREATE TABLE "CommitmentChangeOrder"', 'ADD COLUMN "committedFromCommitments"', 'ADD COLUMN "commitmentId"'].forEach((statement) =>
  assert.ok(migration.includes(statement), `migration has ${statement}`)
)

console.log('commitments-ui: ok')
