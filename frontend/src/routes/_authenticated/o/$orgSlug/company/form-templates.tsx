import { createFileRoute } from '@tanstack/react-router'
import { CompanyFormTemplates } from '@/features/company/form-templates'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/company/form-templates')({
  component: CompanyFormTemplates,
})
