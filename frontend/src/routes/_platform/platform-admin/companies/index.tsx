import { createFileRoute } from '@tanstack/react-router'
import { PlatformCompaniesPage } from '@/features/platform-admin/pages/companies-page'

export const Route = createFileRoute('/_platform/platform-admin/companies/')({
  component: PlatformCompaniesPage,
})
