import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-PRE-BID-027 — bid packages, bidder portal, leveling and award wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/bids/hooks/use-bids.ts')
const portalHooks = read('src/features/bids/portal/use-bid-portal.ts')
const panel = read('src/features/bids/components/bid-packages-panel.tsx')
const dialog = read('src/features/bids/components/bid-package-dialog.tsx')
const leveling = read('src/features/bids/components/bid-leveling.tsx')
const portal = read('src/features/bids/portal/bidder-portal.tsx')
const portalRoute = read('src/routes/bid.$token.tsx')
const commercial = read('src/features/commercial/components/commercial-dashboard.tsx')
const projectDetail = read('src/features/projects/components/project-detail.tsx')
const attachments = read('src/features/attachments/components/attachment-panel.tsx')
const permissions = read('src/lib/permissions.ts')
const policy = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))

// internal hooks
for (const name of [
  'useBidBoqSections',
  'useBidPackages',
  'useBidPackage',
  'useCreateBidPackage',
  'useUpdateBidPackage',
  'useBidPackageAction',
  'useAddBidLinesFromBoq',
  'useInviteBidders',
  'useResendBidInvitation',
  'useIssueBidAddendum',
  'useAnswerBidQuestion',
  'useBidLeveling',
  'useAwardBid',
  'useConfirmBidAward',
  'downloadBidLeveling',
]) {
  assert.match(hooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(hooks, /\/projects\/\$\{projectId\}\/bids/, 'project bids endpoint')
assert.match(hooks, /\/leveling\.xlsx/, 'leveling export endpoint')
assert.match(hooks, /\/award\/confirm/, 'award confirmation endpoint')
assert.match(hooks, /invalidateQueries\(\{ queryKey: \['commitments', projectId\] \}\)/, 'commitments refresh after award')

// portal hooks (no login — token in the path)
for (const name of ['usePortalView', 'usePortalAsk', 'usePortalSaveBid', 'usePortalBidAction', 'usePortalUpload', 'portalDocumentHref']) {
  assert.match(portalHooks, new RegExp(`export const ${name}\\b`), `${name} exported`)
}
assert.match(portalHooks, /\/public\/bids\/\$\{encodeURIComponent\(token\)\}/, 'public portal endpoint')
assert.match(portalHooks, /multipart\/form-data/, 'priced form upload')

// packages panel + workspace
assert.match(panel, /data-testid='uat-bid-new'/, 'new package')
assert.match(panel, /data-testid='uat-bid-sections'/, 'BOQ section picker')
assert.match(panel, /useCanPerform\('bid', 'create'\)/, 'create permission')
assert.match(dialog, /data-testid='uat-bid-publish'/, 'publish & invite')
assert.match(dialog, /recordType='bid_package'/, 'package documents via attachments')
assert.match(dialog, /data-testid='uat-bid-invite-vendor'/, 'invite from the vendor directory')
assert.match(dialog, /data-testid='uat-bid-invite-email'/, 'invite by email')
assert.match(dialog, /Resend/, 'resend invitation')
assert.match(dialog, /data-testid='uat-bid-answer'/, 'answer questions')
assert.match(dialog, /Share with every bidder \(asker stays anonymous\)/, 'shared answers anonymous')
assert.match(dialog, /data-testid='uat-bid-addendum-title'/, 'addenda')
assert.match(dialog, /useCanPerform\('bid', 'submit', 'bid\.publish'\)/, 'publish permission')

// leveling + award
assert.match(leveling, /data-testid='uat-bid-leveling'/, 'leveling grid')
assert.match(leveling, /data-testid='uat-bid-leveling-export'/, 'XLSX export')
assert.match(leveling, /plug/, 'plugs shown for excluded lines')
assert.match(leveling, /data-testid='uat-bid-soft-award'/, 'soft award')
assert.match(leveling, /data-testid='uat-bid-confirm'/, 'confirm award creates the commitment')
assert.match(leveling, /useCanPerform\('bid', 'approve', 'bid\.award'\)/, 'award permission')

// bidder portal
assert.match(portalRoute, /'\/bid\/\$token'/, 'public route')
assert.match(portal, /data-testid='uat-portal'/, 'portal page')
assert.match(portal, /data-testid='uat-portal-documents'/, 'documents')
assert.match(portal, /data-testid='uat-portal-ask'/, 'ask a question')
assert.match(portal, /data-testid='uat-portal-line'/, 'priced lines')
assert.match(portal, /data-testid='uat-portal-submit'/, 'submit bid')
assert.match(portal, /data-testid='uat-portal-withdraw'/, 'withdraw to edit')
assert.match(portal, /Other bidders never see your prices\s+or questions/, 'confidentiality note')
assert.doesNotMatch(portal, /estimateRate|estimateAmount/, 'portal never renders the internal estimate')

// wiring
assert.match(commercial, /<TabsTrigger value='bids'>Bids<\/TabsTrigger>/, 'commercial tab')
assert.match(commercial, /initialTarget\?\.source === 'bid_package'/, 'deep link source')
assert.match(projectDetail, /\{ key: 'bids', label: 'Bids' \}/, 'project child')
assert.match(attachments, /bid_package: 'bid'/, 'attachment module for packages')
assert.match(permissions, /\| 'bid'/, 'bid permission module typed')
assert.ok(policy.modules.bid, 'bid module in policy')
assert.deepEqual(policy.modules.bid.transitions['bid.award'], ['pm'], 'award is a PM decision')
assert.ok(policy.modules.bid.transitions['bid.publish'].includes('procurement'), 'procurement can publish')

console.log('bids-ui: ok')
