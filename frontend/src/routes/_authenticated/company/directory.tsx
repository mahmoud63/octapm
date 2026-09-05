import { createFileRoute } from '@tanstack/react-router'
import { CompanyDirectory } from '@/features/company/directory'

export const Route = createFileRoute('/_authenticated/company/directory')({
  component: CompanyDirectory,
})
