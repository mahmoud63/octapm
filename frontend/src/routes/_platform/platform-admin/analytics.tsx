import { createFileRoute } from '@tanstack/react-router'
import { PlatformAnalyticsPage } from '@/features/platform-admin/pages/analytics-page'

export const Route = createFileRoute('/_platform/platform-admin/analytics')({
  component: PlatformAnalyticsPage,
})
