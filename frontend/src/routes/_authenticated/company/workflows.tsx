import { createFileRoute } from '@tanstack/react-router'
import { CompanyWorkflows } from '@/features/company/workflows'

export const Route = createFileRoute('/_authenticated/company/workflows')({
  component: CompanyWorkflows,
})
