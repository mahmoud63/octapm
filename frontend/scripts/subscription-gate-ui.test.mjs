import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const errorHelper = read('src/lib/handle-server-error.ts')
const banner = read('src/features/billing/components/subscription-banner.tsx')

assert.ok(
  errorHelper.includes('SUBSCRIPTION_REQUIRED_MESSAGE'),
  'shared error helper defines subscription-required copy'
)
assert.ok(
  errorHelper.includes("errorData?.error?.code === 'SUBSCRIPTION_REQUIRED'"),
  'shared error helper checks the subscription-required error code'
)
assert.ok(
  errorHelper.includes('error.response?.status === 402'),
  'shared error helper treats HTTP 402 as a billing gate error'
)

for (const file of [
  'src/features/projects/components/project-create-dialog.tsx',
  'src/features/projects/components/project-edit-dialog.tsx',
  'src/features/projects/components/projects-list.tsx',
  'src/features/users/components/users-action-dialog.tsx',
  'src/features/users/components/users-dialogs.tsx',
  'src/features/users/components/data-table-row-actions.tsx',
  'src/features/users/components/users-send-reset-email-dialog.tsx',
]) {
  const source = read(file)
  assert.ok(
    source.includes('getServerErrorMessage'),
    `${file} surfaces backend subscription errors`
  )
}

for (const file of [
  'src/features/projects/components/projects-list.tsx',
  'src/features/users/components/users-primary-buttons.tsx',
  'src/features/users/components/data-table-row-actions.tsx',
  'src/features/users/index.tsx',
  'src/features/users/components/users-pending-invitations.tsx',
]) {
  const source = read(file)
  assert.ok(
    source.includes('subscriptionAllowsWrites'),
    `${file} hides or disables write actions when subscription access has ended`
  )
  assert.ok(
    source.includes('subscription?.hasAccess !== false'),
    `${file} follows the backend hasAccess decision for write controls`
  )
}

assert.ok(
  banner.includes('!sub.hasAccess'),
  'subscription banner follows the backend hasAccess decision'
)
assert.ok(
  banner.includes("navigate({ to: '/billing' })"),
  'subscription banner routes lapsed users to billing'
)

console.log('Subscription gate UI assertions passed')
