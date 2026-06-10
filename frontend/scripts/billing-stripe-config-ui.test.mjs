import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const stripeLib = read('src/lib/stripe.ts')
const checkoutWizard = read('src/features/billing/components/checkout-wizard.tsx')
const startTrialCard = read('src/features/billing/components/start-trial-card.tsx')

assert.ok(
  stripeLib.includes('stripePublishableKey'),
  'Stripe library exposes the publishable-key value for configuration checks'
)
assert.ok(
  stripeLib.includes('isStripeConfigured'),
  'Stripe library exposes a billing configuration guard'
)
assert.ok(
  stripeLib.includes('Promise.resolve(null)'),
  'Stripe library avoids initializing Stripe.js when the publishable key is absent'
)

for (const [label, source] of [
  ['checkout wizard', checkoutWizard],
  ['trial card', startTrialCard],
]) {
  assert.ok(
    source.includes('isStripeConfigured'),
    `${label} checks whether Stripe is configured before payment setup`
  )
  assert.ok(
    source.includes('Billing setup is unavailable'),
    `${label} surfaces clear billing-unavailable feedback`
  )
}

console.log('Billing Stripe configuration UI assertions passed')
