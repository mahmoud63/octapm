import { createFileRoute } from '@tanstack/react-router'
import { CompanyPermissions } from '@/features/company/permissions'

export const Route = createFileRoute('/_authenticated/company/permissions')({
  component: CompanyPermissions,
})
