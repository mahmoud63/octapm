import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceSettings } from '@/features/company/workspace'

export const Route = createFileRoute(
  '/_authenticated/o/$orgSlug/company/workspace'
)({
  component: WorkspaceSettings,
})
