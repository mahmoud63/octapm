import { createFileRoute } from '@tanstack/react-router'
import { SettingsPermissions } from '@/features/settings/permissions'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/settings/permissions')({
  component: SettingsPermissions,
})
