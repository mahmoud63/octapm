import { createFileRoute } from '@tanstack/react-router'
import { PlatformProjectsPage } from '@/features/platform-admin/pages/projects-page'

export const Route = createFileRoute('/_platform/platform-admin/projects')({
  component: PlatformProjectsPage,
})
