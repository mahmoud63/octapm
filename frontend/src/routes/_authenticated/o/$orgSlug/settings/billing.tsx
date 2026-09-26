import { createFileRoute } from '@tanstack/react-router'
import { BillingSettings } from '@/features/billing/components/billing-settings'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/settings/billing')({
  component: BillingSettings,
})
