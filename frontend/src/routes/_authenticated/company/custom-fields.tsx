import { createFileRoute } from '@tanstack/react-router'
import { CompanyCustomFields } from '@/features/company/custom-fields'

export const Route = createFileRoute('/_authenticated/company/custom-fields')({
  component: CompanyCustomFields,
})
