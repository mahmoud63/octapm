import { createFileRoute } from '@tanstack/react-router'
import { CompanySecurity } from '@/features/company/security'

export const Route = createFileRoute('/_authenticated/company/security')({
  component: CompanySecurity,
})
