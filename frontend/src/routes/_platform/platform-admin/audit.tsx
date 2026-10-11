import { createFileRoute } from '@tanstack/react-router'
import { PlatformAuditPage } from '@/features/platform-admin/pages/audit-page'

export const Route = createFileRoute('/_platform/platform-admin/audit')({
  component: PlatformAuditPage,
})
