import { createFileRoute } from '@tanstack/react-router'
import { CompanySecurity } from '@/features/company/security'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/company/security')({
  component: CompanySecurity,
})
