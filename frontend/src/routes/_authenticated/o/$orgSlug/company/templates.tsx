import { createFileRoute } from '@tanstack/react-router'
import { CompanyProjectTemplates } from '@/features/company/templates'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/company/templates')({
  component: CompanyProjectTemplates,
})
