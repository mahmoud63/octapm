import { createFileRoute } from '@tanstack/react-router'
import { PlatformCompanyDetailPage } from '@/features/platform-admin/pages/company-detail-page'

export const Route = createFileRoute(
  '/_platform/platform-admin/companies/$orgId'
)({
  component: PlatformCompanyDetailPage,
})
