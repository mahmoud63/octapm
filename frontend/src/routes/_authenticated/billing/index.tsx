import { createFileRoute } from '@tanstack/react-router'
import { BillingPlansPage } from '@/features/billing'

export const Route = createFileRoute('/_authenticated/billing/')({
  component: BillingPlansPage,
})
