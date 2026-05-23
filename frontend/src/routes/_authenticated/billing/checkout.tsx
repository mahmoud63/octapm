import { createFileRoute } from '@tanstack/react-router'

type CheckoutSearch = { plan: 'individual' | 'business' }

export const Route = createFileRoute('/_authenticated/billing/checkout')({
  validateSearch: (search: Record<string, unknown>): CheckoutSearch => ({
    plan: search.plan === 'business' ? 'business' : 'individual',
  }),
  component: () => null,
})
