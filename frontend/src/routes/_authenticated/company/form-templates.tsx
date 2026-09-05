import { createFileRoute } from '@tanstack/react-router'
import { CompanyFormTemplates } from '@/features/company/form-templates'

export const Route = createFileRoute('/_authenticated/company/form-templates')({
  component: CompanyFormTemplates,
})
