import { createFileRoute } from '@tanstack/react-router'
import { CompanyWorkspace } from '@/features/company'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/company')({
  component: CompanyWorkspace,
})
