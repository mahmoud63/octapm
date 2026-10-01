import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-COM-CE-038 — change events and RFQs wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const backend = (rel) => readFileSync(path.join(root, '..', 'backend', rel), 'utf8')

const hooks = read('src/features/change-events/hooks/use-change-events.ts')
const panel = read('src/features/change-events/components/change-events-panel.tsx')
const dialog = read('src/features/change-events/components/change-event-dialog.tsx')
const portalHooks = read('src/features/change-events/portal/use-rfq-portal.ts')
const portal = read('src/features/change-events/portal/rfq-portal.tsx')
const route = read('src/routes/rfq.$token.tsx')
const dashboard = read('src/features/commercial/components/commercial-dashboard.tsx')
const projectDetail = read('src/features/projects/components/project-detail.tsx')
const permissionsTs = read('src/lib/permissions.ts')
const permissions = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))
const projectsRoutes = backend('src/routes/projects.js')
const app = backend('src/app.js')
const service = backend('src/services/change-event.service.js')
const recordLinks = backend('src/utils/record-links.js')
const attachments = backend('src/services/attachment.service.js')
const schema = backend('prisma/schema.prisma')

for (const name of ['useChangeEvents', 'useChangeEvent', 'useCreateChangeEvent', 'useUpdateChangeEvent', 'useDeleteChangeEvent', 'useSendRfqs', 'useRfqAction', 'useChangeEventAction']) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /\/change-events`/, 'base path')
assert.match(hooks, /\/\$\{id\}\/rfqs`/, 'send RFQs endpoint')
assert.match(hooks, /\/rfqs\/\$\{rfqId\}\/\$\{action\}`/, 'RFQ actions')
assert.match(hooks, /\/\$\{id\}\/\$\{action\}`/, 'event actions')
for (const name of ['useRfqPortalView', 'useRfqPortalQuote', 'useRfqPortalDecline']) assert.match(portalHooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
assert.match(portalHooks, /\/public\/rfqs\//, 'public portal path')

assert.match(panel, /export function ChangeEventsPanel/, 'register')
assert.match(panel, /data-testid='uat-change-events-new'/, 'new button')
assert.match(panel, /data-testid='uat-change-events-rows'/, 'rows')
assert.match(panel, /data-testid='uat-change-event-create'/, 'create dialog')
assert.match(dialog, /export function ChangeEventDialog/, 'workspace')
assert.match(dialog, /data-testid='uat-change-event-lines'/, 'lines editor')
assert.match(dialog, /data-testid='uat-change-event-send-rfq'/, 'send RFQs')
assert.match(dialog, /data-testid='uat-rfq-send-submit'/, 'RFQ dialog submit')
assert.match(dialog, /data-testid='uat-rfq-accept'/, 'accept quote')
assert.match(dialog, /data-testid='uat-change-event-convert'/, 'convert')
assert.match(dialog, /useCanPerform\(\s*'change_event',\s*'approve',\s*'change_event\.convert'\s*\)/, 'conversion gated')
assert.match(dialog, /createCommitmentChangeOrder:\s*Boolean\(\s*rfq\.commitmentId\s*\)/, 'commitment quotes draft a commitment change order')
assert.match(dialog, /entityType='change_event'/, 'history')

assert.match(portal, /export function RfqPortal/, 'portal page')
assert.match(portal, /data-testid='uat-rfq-portal-submit'/, 'portal submit')
assert.match(portal, /data-testid='uat-rfq-portal-amount'/, 'portal amounts')
assert.match(portal, /Decline to quote/, 'portal decline')
assert.match(route, /createFileRoute\('\/rfq\/\$token'\)/, 'public route')

assert.match(dashboard, /<TabsTrigger value='change-events'>Change Events<\/TabsTrigger>/, 'tab')
assert.match(dashboard, /<ChangeEventsPanel/, 'panel mounted')
assert.match(projectDetail, /\{ key: 'change-events', label: 'Change Events' \}/, 'sidebar child')
assert.match(permissionsTs, /\| 'change_event'/, 'permission module typed')
assert.ok(permissions.modules.change_event, 'change_event module')
assert.deepEqual(permissions.modules.change_event.transitions['change_event.convert'], ['pm', 'qs'], 'conversion roles')
assert.ok(permissions.partyPermissions.contractor.modules.change_event.transitions.includes('change_event.rfq_send'), 'contractor sends RFQs')
assert.ok(!permissions.partyPermissions.subcontractor.modules.change_event, 'subcontractors answer through the portal, not the tool')

assert.match(projectsRoutes, /"\/:projectId\/change-events",\s*nestedProjectAccess,\s*require\("\.\/change-events"\)/, 'routes mounted')
assert.match(app, /app\.use\("\/api\/v1\/public\/rfqs", require\("\.\/routes\/rfq-portal"\)\)/, 'portal mounted')
assert.match(service, /tokenHash: hashToken\(token\)/, 'tokens are hashed')
assert.match(service, /changeOrderService\.createChangeOrder\(/, 'conversion goes through the change-order service')
assert.match(service, /commitmentService\.createChangeOrder\(/, 'commitment change orders through the commitment service')
assert.match(recordLinks, /change_event: \{ module: "commercial", child: "change-events" \}/, 'record link')
assert.match(attachments, /change_event: "change_event"/, 'attachments')
for (const model of ['ChangeEvent', 'ChangeEventLine', 'Rfq']) assert.match(schema, new RegExp(`^model ${model} \\{`, 'm'), `${model} model`)

// PC-7b integration M: every origin the API stores has a name on the web — an
// event raised from a project exception ('exception') never reads as unknown.
const serverOrigins = JSON.parse(service.match(/const ORIGINS = Object\.freeze\((\[[^\]]*\])\)/)[1])
assert.ok(serverOrigins.includes('exception'), "the API stores the 'exception' origin")
const originUnion = hooks.match(/export type ChangeEventOrigin =([^]*?)\n(?:export|\n)/)[1]
const webOrigins = [...originUnion.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
assert.deepEqual([...webOrigins].sort(), [...serverOrigins].sort(), "the web ChangeEventOrigin union is the API's ORIGINS")
const originLabels = hooks.match(/export const CHANGE_EVENT_ORIGIN_LABEL: Record<ChangeEventOrigin, string> = \{([^}]*)\}/)
assert.ok(originLabels, 'CHANGE_EVENT_ORIGIN_LABEL names every origin')
for (const origin of serverOrigins) assert.match(originLabels[1], new RegExp(`\\b${origin}: '[^']+'`), `origin ${origin} has a label`)
assert.match(originLabels[1], /exception: 'Project exception'/, "the 'exception' origin reads as a project exception")
const raiseDialog = read('src/features/controls/exceptions/raise-change-event-dialog.tsx')
assert.match(raiseDialog, /Origin \{changeEventOriginLabel\(proposedDraft\.origin\)\}/, 'the raise dialog names the origin by its label')

console.log('change-events-ui: ok')
