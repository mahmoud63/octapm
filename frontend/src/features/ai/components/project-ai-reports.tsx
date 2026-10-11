import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { useProjectStatusReport, type ReportKind } from '../hooks/use-project-ai'
import { ProjectStatusReportDialog } from './project-status-report'

const KINDS: Array<{ kind: ReportKind; label: string }> = [
  { kind: 'status', label: 'Generate AI Narrative' },
  { kind: 'executive', label: 'Executive Summary' },
  { kind: 'weekly', label: 'Weekly Summary' },
  { kind: 'monthly', label: 'Monthly Summary' },
  { kind: 'commercial', label: 'Commercial Summary' },
  { kind: 'quality', label: 'Quality Summary' },
  { kind: 'procurement', label: 'Procurement Summary' },
]

/**
 * AI summaries inside the existing Reports module (AI-7, Reports): each
 * opens the same three-part report - FACT from OctaPM's own figures, AI
 * INTERPRETATION and AI RECOMMENDATION citing them - focused on its subject.
 * The structured reports below stay the authority for every number.
 */
export function ProjectAiReports({ projectId }: { projectId: string }) {
  const canAsk = useCanPerform('assistant', 'read')
  const report = useProjectStatusReport(projectId)
  const [open, setOpen] = useState(false)
  if (!canAsk) return null

  const run = (kind: ReportKind) => {
    setOpen(true)
    report.reset()
    report.mutate(kind, {
      onError: (error) => {
        setOpen(false)
        toast.error(getServerErrorMessage(error))
      },
    })
  }

  return (
    <div className='rounded-md border p-4' data-testid='uat-ai-reports'>
      <div className='mb-3 flex items-center gap-2'>
        <Sparkles className='h-4 w-4 text-primary' aria-hidden />
        <h3 className='text-base font-semibold'>AI summaries</h3>
        <span className='text-xs text-muted-foreground'>
          Narrative over OctaPM&apos;s figures; the reports below stay authoritative.
        </span>
      </div>
      <div className='flex flex-wrap gap-2'>
        {KINDS.map(({ kind, label }) => (
          <Button
            key={kind}
            size='sm'
            variant={kind === 'status' ? 'default' : 'outline'}
            disabled={report.isPending}
            onClick={() => run(kind)}
            data-testid={`uat-ai-report-${kind}`}
          >
            {report.isPending && report.variables === kind ? (
              <Loader2 className='me-1 h-3.5 w-3.5 animate-spin' />
            ) : null}
            {label}
          </Button>
        ))}
      </div>
      <ProjectStatusReportDialog
        open={open}
        onOpenChange={setOpen}
        report={report.data ?? null}
        loading={report.isPending}
      />
    </div>
  )
}
