import { createFileRoute } from '@tanstack/react-router'
import { PlatformOverviewPage } from '@/features/platform-admin/pages/overview-page'

export const Route = createFileRoute('/_platform/platform-admin/')({
  component: PlatformOverviewPage,
})
