import { createFileRoute } from '@tanstack/react-router'
import { CompanyVendors } from '@/features/company/vendors'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/company/vendors')({
  component: CompanyVendors,
})
