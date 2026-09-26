import { createFileRoute } from '@tanstack/react-router'
import { legacyWorkspaceRedirect } from '@/lib/workspace/legacy'

/** Legacy path: the same page under the active workspace, `/o/{workspace}/cost-codes` (ENT-4). */
export const Route = createFileRoute('/_authenticated/cost-codes')({
  beforeLoad: legacyWorkspaceRedirect,
})
