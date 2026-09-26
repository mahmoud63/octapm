import { createFileRoute } from '@tanstack/react-router'
import { BillingPlansPage } from '@/features/billing'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/billing/')({
  component: BillingPlansPage,
})
