import { createFileRoute } from '@tanstack/react-router'
import { PlatformUsersPage } from '@/features/platform-admin/pages/users-page'

export const Route = createFileRoute('/_platform/platform-admin/users')({
  component: PlatformUsersPage,
})
