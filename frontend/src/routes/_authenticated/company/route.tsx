import { createFileRoute } from '@tanstack/react-router'
import { CompanyWorkspace } from '@/features/company'

export const Route = createFileRoute('/_authenticated/company')({
  component: CompanyWorkspace,
})
