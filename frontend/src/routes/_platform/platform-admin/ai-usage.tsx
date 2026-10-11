import { createFileRoute } from '@tanstack/react-router'
import { PlatformAiUsagePage } from '@/features/platform-admin/pages/ai-usage-page'

export const Route = createFileRoute('/_platform/platform-admin/ai-usage')({
  component: PlatformAiUsagePage,
})
