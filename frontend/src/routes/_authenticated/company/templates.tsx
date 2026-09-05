import { createFileRoute } from '@tanstack/react-router'
import { CompanyProjectTemplates } from '@/features/company/templates'

export const Route = createFileRoute('/_authenticated/company/templates')({
  component: CompanyProjectTemplates,
})
