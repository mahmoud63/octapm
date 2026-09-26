import { createFileRoute } from '@tanstack/react-router'
import { SettingsDisplay } from '@/features/settings/display'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/settings/display')({
  component: SettingsDisplay,
})
