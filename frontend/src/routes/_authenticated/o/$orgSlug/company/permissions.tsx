import { createFileRoute } from '@tanstack/react-router'
import { CompanyPermissions } from '@/features/company/permissions'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/company/permissions')({
  component: CompanyPermissions,
})
