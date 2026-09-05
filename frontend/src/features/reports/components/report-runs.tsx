import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { downloadRunFile, useReportRuns } from '../hooks/use-report-builder'

const statusVariant = (status: string) =>
  status === 'succeeded'
    ? 'default'
    : status === 'failed'
      ? 'destructive'
      : 'outline'

/** History of renders (manual and scheduled) with their stored files. */
export function ReportRuns({
  reportId,
  highlightRunId,
}: {
  reportId: string
  highlightRunId?: string | null
}) {
  const { data: runs = [], isLoading } = useReportRuns(reportId)
  if (isLoading)
    return <p className='text-xs text-muted-foreground'>Loading runs…</p>
  if (!runs.length)
    return (
      <p className='text-xs text-muted-foreground'>
        No runs yet. "Run & deliver" or a schedule creates one.
      </p>
    )
  const grab = (runId: string, format: 'pdf' | 'xlsx') =>
    downloadRunFile(runId, format).catch((error) =>
      toast.error(getServerErrorMessage(error))
    )
  return (
    <ul className='space-y-1' data-testid='uat-report-runs'>
      {runs.map((run) => (
        <li
          key={run.id}
          className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-xs ${run.id === highlightRunId ? 'border-primary' : ''}`}
          data-testid='uat-report-run'
        >
          <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
          <span className='text-muted-foreground'>
            {run.trigger === 'schedule' ? 'scheduled' : 'manual'}
          </span>
          <span>
            {run.createdAt ? new Date(run.createdAt).toLocaleString() : ''}
          </span>
          <span className='tabular-nums'>
            {run.rowCount} rows{run.truncated ? ' (truncated)' : ''}
          </span>
          {run.delivery && (
            <span className='text-muted-foreground'>
              {run.delivery.notified} notified · {run.delivery.emails.length}{' '}
              emailed
              {run.delivery.failedEmails.length
                ? ` · ${run.delivery.failedEmails.length} failed`
                : ''}
            </span>
          )}
          {run.error && <span className='text-destructive'>{run.error}</span>}
          <div className='ml-auto flex gap-1'>
            {run.hasPdf && (
              <Button
                size='sm'
                variant='outline'
                className='h-6 px-2'
                onClick={() => grab(run.id, 'pdf')}
              >
                <Download className='mr-1 h-3 w-3' /> PDF
              </Button>
            )}
            {run.hasXlsx && (
              <Button
                size='sm'
                variant='outline'
                className='h-6 px-2'
                onClick={() => grab(run.id, 'xlsx')}
              >
                <Download className='mr-1 h-3 w-3' /> XLSX
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
