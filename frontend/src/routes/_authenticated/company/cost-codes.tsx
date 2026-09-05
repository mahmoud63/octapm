import { createFileRoute } from '@tanstack/react-router'
import { CompanyCostCodes } from '@/features/company/cost-codes'

export const Route = createFileRoute('/_authenticated/company/cost-codes')({
  component: CompanyCostCodes,
})
