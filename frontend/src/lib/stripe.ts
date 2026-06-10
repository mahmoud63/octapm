import { loadStripe } from '@stripe/stripe-js'

export const stripePublishableKey =
  (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? ''

export const isStripeConfigured = /^pk_(test|live)_[A-Za-z0-9]+$/.test(
  stripePublishableKey
)

export const stripePromise = isStripeConfigured
  ? loadStripe(stripePublishableKey)
  : Promise.resolve(null)
