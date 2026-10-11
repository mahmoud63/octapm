import { createFileRoute } from '@tanstack/react-router'
import { PlatformHealthPage } from '@/features/platform-admin/pages/health-page'

export const Route = createFileRoute('/_platform/platform-admin/health')({
  component: PlatformHealthPage,
})
