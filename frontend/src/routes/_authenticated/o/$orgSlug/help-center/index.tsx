import { createFileRoute } from '@tanstack/react-router'
import { HelpCenter } from '@/features/help-center'

export const Route = createFileRoute('/_authenticated/o/$orgSlug/help-center/')({
  component: HelpCenter,
})
