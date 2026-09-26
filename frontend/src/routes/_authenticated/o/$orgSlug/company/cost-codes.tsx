import { createFileRoute } from '@tanstack/react-router'
import { CompanyCostCodes } from '@/features/company/cost-codes'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/company/cost-codes')({
  component: CompanyCostCodes,
})
