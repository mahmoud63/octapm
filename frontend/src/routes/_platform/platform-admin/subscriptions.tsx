import { createFileRoute } from '@tanstack/react-router'
import { PlatformSubscriptionsPage } from '@/features/platform-admin/pages/subscriptions-page'

export const Route = createFileRoute('/_platform/platform-admin/subscriptions')(
  {
    component: PlatformSubscriptionsPage,
  }
)
