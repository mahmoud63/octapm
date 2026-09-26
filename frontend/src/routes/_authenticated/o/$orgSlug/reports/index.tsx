import { createFileRoute } from '@tanstack/react-router'
import { ReportBuilderPage } from '@/features/reports/report-builder-page'

type ReportsSearch = { reportId?: string; runId?: string }

/** Report builder (OCTA-RPT-BUILDER-023): `/reports?reportId=&runId=`. */
export const Route = createFileRoute('/_authenticated/o/$orgSlug/reports/')({
  validateSearch: (search: Record<string, unknown>): ReportsSearch => ({
    reportId: typeof search.reportId === 'string' ? search.reportId : undefined,
    runId: typeof search.runId === 'string' ? search.runId : undefined,
  }),
  component: function ReportsRoute() {
    const { reportId, runId } = Route.useSearch()
    return (
      <ReportBuilderPage reportId={reportId ?? null} runId={runId ?? null} />
    )
  },
})
