import { createFileRoute } from '@tanstack/react-router'
import { Settings } from '@/features/settings'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/settings')({
  component: Settings,
})
