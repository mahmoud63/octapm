import { createFileRoute } from '@tanstack/react-router'
import { CompanyVendors } from '@/features/company/vendors'

export const Route = createFileRoute('/_authenticated/company/vendors')({
  component: CompanyVendors,
})
