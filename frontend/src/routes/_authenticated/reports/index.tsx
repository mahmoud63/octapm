import { createFileRoute } from '@tanstack/react-router'
import { legacyWorkspaceRedirect } from '@/lib/workspace/legacy'

type ReportsSearch = { reportId?: string; runId?: string }

/** Legacy path: `/reports?reportId=&runId=` opens under the active workspace, `/o/{workspace}/reports` (ENT-4). */
export const Route = createFileRoute('/_authenticated/reports/')({
  validateSearch: (search: Record<string, unknown>): ReportsSearch => ({
    reportId: typeof search.reportId === 'string' ? search.reportId : undefined,
    runId: typeof search.runId === 'string' ? search.runId : undefined,
  }),
  beforeLoad: legacyWorkspaceRedirect,
})
