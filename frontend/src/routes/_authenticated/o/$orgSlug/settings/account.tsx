import { createFileRoute } from '@tanstack/react-router'
import { SettingsAccount } from '@/features/settings/account'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/settings/account')({
  component: SettingsAccount,
})
