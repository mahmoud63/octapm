import { createFileRoute } from '@tanstack/react-router'
import { CompanySubmittalWorkflows } from '@/features/company/submittal-workflows'

export const Route = createFileRoute(
  '/_authenticated/company/submittal-workflows'
)({
  component: CompanySubmittalWorkflows,
})
