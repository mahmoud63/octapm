import { createFileRoute } from '@tanstack/react-router'
import { BillingSettings } from '@/features/billing/components/billing-settings'

export const Route = createFileRoute('/_authenticated/settings/billing')({
  component: BillingSettings,
})
