import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-AI-CONTRACT-032 — contract intelligence wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/contract/hooks/use-contract.ts')
const panel = read('src/features/contract/components/contract-panel.tsx')
const card = read('src/features/contract/components/eot-assessment-card.tsx')
const eotPanel = read('src/features/commercial/components/eot-panel.tsx')
const dashboard = read('src/features/commercial/components/commercial-dashboard.tsx')
const detail = read('src/features/projects/components/project-detail.tsx')
const projectsRoutes = readFileSync(path.join(root, '..', 'backend', 'src', 'routes', 'projects.js'), 'utf8')
const eotRoutes = readFileSync(path.join(root, '..', 'backend', 'src', 'routes', 'eot.js'), 'utf8')
const service = readFileSync(path.join(root, '..', 'backend', 'src', 'services', 'contract.service.js'), 'utf8')

for (const name of ['useContractProfile', 'useUpdateContractProfile', 'useExtractContractClauses', 'useNoticeMonitor', 'useDraftNotice', 'useCreateNotice', 'useAssessEotClaim', 'useApplyEotAssessment']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /`\/projects\/\$\{projectId\}\/contract`/, 'contract endpoint')
assert.match(hooks, /\/extract`, payload, \{\s*timeout: 300_000/, 'extraction gets a long timeout')
assert.match(hooks, /\/notices\/draft`/, 'draft endpoint')
assert.match(hooks, /\/eot\/\$\{claimId\}\/ai\/assess`/, 'assess endpoint')
assert.match(hooks, /\/eot\/\$\{claimId\}\/ai\/apply`/, 'apply endpoint')

assert.match(panel, /export function ContractPanel/, 'contract panel')
assert.match(panel, /data-testid='uat-contract-form'/, 'form of contract select')
assert.match(panel, /applyPreset/, 'presets fill the periods')
assert.match(panel, /data-testid=\{`uat-contract-\$\{key\}`\}/, 'period inputs')
assert.match(panel, /useDocumentSearch\(projectId, query/, 'contract documents picked by search')
assert.match(panel, /data-testid='uat-contract-extract'/, 'read clauses button')
assert.match(panel, /data-testid='uat-contract-apply-periods'/, 'periods found in the documents can be applied')
assert.match(panel, /data-testid='uat-contract-clause-confirm'/, 'clauses are confirmed one by one')
assert.match(panel, /data-testid='uat-contract-confirm-all'/, 'confirm all drafts')
assert.match(panel, /data-testid='uat-contract-notices'/, 'notice monitor')
assert.match(panel, /data-testid='uat-contract-notice-open'/, 'draft notice from a row')
assert.match(panel, /data-testid='uat-contract-notice-create'/, 'notice created only on send')
assert.match(panel, /useCanPerform\('eot', 'update'\)/, 'profile edits gated')
assert.match(panel, /useCanPerform\('document_control', 'create'\)/, 'notice drafting gated')

assert.match(card, /export function EotAssessmentCard/, 'assessment card')
assert.match(card, /data-testid='uat-eot-assess'/, 'assess button')
assert.match(card, /data-testid='uat-eot-apply-analysis'/, 'apply analysis')
assert.match(card, /data-testid='uat-eot-apply-letter'/, 'apply claim letter')
assert.match(card, /claimStatus !== 'draft'/, 'applies to draft claims only')

assert.match(eotPanel, /<TabsTrigger value='entitlement'>/, 'entitlement tab on the claim')
assert.match(eotPanel, /<EotAssessmentCard/, 'card mounted on the claim')
assert.match(dashboard, /<TabsTrigger value='contract'>Contract<\/TabsTrigger>/, 'contract tab')
assert.match(dashboard, /<ContractPanel projectId=\{projectId\} \/>/, 'contract tab content')
assert.match(detail, /\{ key: 'contract', label: 'Contract' \}/, 'contract in the commercial menu')

assert.match(projectsRoutes, /"\/:projectId\/contract", nestedProjectAccess, require\("\.\/contract"\)/, 'contract routes mounted')
assert.match(eotRoutes, /require\("\.\/eot-assistant"\)/, 'EOT assistant routes mounted before the claim routes')
assert.match(service, /const heuristicClauses = /, 'text-scan fallback for extraction')
assert.match(service, /const templateNotice = /, 'template fallback for notices')
assert.match(service, /const deterministicAssessment = /, 'record-based fallback for assessments')

console.log('contract-ui: ok')
