import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-FIN-SUBPAY-021 — subcontractor payment applications wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/commercial/hooks/use-pay-apps.ts')
const panel = read('src/features/commercial/components/pay-apps-panel.tsx')
const dialogs = read('src/features/commercial/components/pay-app-dialogs.tsx')
const dashboard = read('src/features/commercial/components/commercial-dashboard.tsx')
const detail = read('src/features/projects/components/project-detail.tsx')
const permissions = read('src/lib/permissions.ts')
const modules = read('src/features/projects/lib/project-modules.ts')
const policy = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))

// hooks cover the full lifecycle
for (const name of ['usePayApps', 'usePayApp', 'useCreatePayApp', 'useUpdatePayApp', 'usePayAppAction', 'useVoidPayApp', 'useRecordPayAppPayment', 'downloadPayAppPdf']) {
  assert.match(hooks, new RegExp(`export const ${name}`), `${name} exported`)
}
assert.match(hooks, /\/projects\/\$\{projectId\}\/pay-apps/, 'pay-app API base')
assert.match(hooks, /'submit' \| 'review' \| 'approve' \| 'reject' \| 'reopen'/, 'lifecycle actions typed')
assert.match(hooks, /OVER_APPROVED_PROGRESS/, 'rejection codes mirror the backend')
assert.match(hooks, /queryKey: \['commitments', projectId\]/, 'commitments refreshed after pay-app changes')
assert.match(hooks, /queryKey: \['cash-flow', projectId\]/, 'cash flow refreshed after payments')

// panel: summary, filter, list, create, detail
assert.match(panel, /data-testid='uat-payapps-panel'/)
assert.match(panel, /useCanPerform\('sub_pay_app', 'create'\)/, 'create gated by permission')
assert.match(panel, /Retention held/, 'retention held summary')
assert.match(panel, /data-testid='uat-payapp-row'/)
assert.match(panel, /entityType='sub_pay_app'/, 'audit history on the panel')
assert.match(panel, /PayAppDetailDialog/)

// dialogs: create from executed commitments, claims editor with cap, gates
assert.match(dialogs, /status: 'executed'/, 'only executed commitments are offered')
assert.match(dialogs, /Lien waiver required before approval/)
assert.match(dialogs, /line\.capAmount !== null && cumulative > line\.capAmount/, 'over-claim highlighted per line')
assert.match(dialogs, /thisPeriodAmount:\s*Number\(\s*drafts\[line\.sovLineId\]\?\.thisPeriod\s*\)/, 'claims saved per SOV line')
assert.match(dialogs, /materialsOnSite/, 'materials on site claimable')
assert.match(dialogs, /Back-charges/, 'back-charges editable')
for (const transition of ['sub_pay_app.submit', 'sub_pay_app.review', 'sub_pay_app.reject', 'sub_pay_app.approve', 'sub_pay_app.pay', 'sub_pay_app.void']) {
  assert.match(dialogs, new RegExp(transition.replace('.', '\\.')), `${transition} gated in the UI`)
}
assert.match(dialogs, /complianceOverrideReason/, 'compliance override reason sent')
assert.match(dialogs, /overClaimOverrideReason/, 'over-claim override reason sent')
assert.match(dialogs, /action: 'reject',\s*body: \{\s*code: rejectCode,\s*reason: rejectReason\.trim\(\),?\s*\}/, 'rejection carries a code and reason')
assert.match(dialogs, /data-testid='uat-payapp-pay-form'/, 'payments recorded from the detail')
assert.match(dialogs, /waiverDocumentId/, 'waiver document recorded')
assert.match(dialogs, /downloadPayAppPdf\(projectId, payApp\.id\)/, 'statement PDF export')
assert.match(dialogs, /recordType='sub_pay_app'/, 'attachments and comments on the record')
assert.match(dialogs, /entityType='sub_pay_app'/, 'history on the record')
assert.match(dialogs, /key=\{payApp\.updatedAt \?\? payApp\.id\}/, 'claims editor resets on server refresh')

// navigation and permissions plumbing
assert.match(dashboard, /TabsTrigger value='pay-apps'/, 'commercial tab')
assert.match(dashboard, /initialTarget\?\.source === 'sub_pay_app'/, 'deep link target')
assert.match(detail, /key: 'pay-apps', label: 'Pay Applications'/, 'project detail child')
assert.match(permissions, /'sub_pay_app'/, 'PermissionModule includes sub_pay_app')
assert.match(modules, /'sub_pay_app'/, 'commercial module lists sub_pay_app')
assert.ok(policy.modules.sub_pay_app, 'policy module exists')
assert.deepEqual(policy.modules.sub_pay_app.transitions['sub_pay_app.pay'], ['pm', 'finance'], 'finance records payments')
assert.deepEqual(policy.modules.sub_pay_app.transitions['sub_pay_app.approve'], ['pm'], 'PM approves')
for (const template of ['contractor', 'subcontractor']) {
  const grants = policy.partyPermissions[template].modules.sub_pay_app
  assert.ok(grants.actions.includes('submit'), `${template} party can submit`)
  assert.ok(!grants.actions.includes('approve'), `${template} party cannot approve`)
  assert.ok(grants.transitions.includes('sub_pay_app.submit'), `${template} party holds the submit transition`)
}
for (const template of ['owner', 'consultant']) {
  assert.deepEqual(policy.partyPermissions[template].modules.sub_pay_app.actions, ['read'], `${template} party is read-only`)
}

// eslint-disable-next-line no-console
console.log('pay-apps-ui checks passed')
