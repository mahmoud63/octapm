import { createFileRoute } from '@tanstack/react-router'
import { CheckoutWizard } from '@/features/billing/components/checkout-wizard'

type CheckoutSearch = { plan: 'individual' | 'business' }

export const Route = createFileRoute('/_authenticated/o/$orgSlug/billing/checkout')({
  validateSearch: (search: Record<string, unknown>): CheckoutSearch => ({
    plan: search.plan === 'business' ? 'business' : 'individual',
  }),
  component: function CheckoutRoute() {
    const { plan } = Route.useSearch()
    return <CheckoutWizard plan={plan} />
  },
})
