import type { ReactNode } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  CitedText,
  SourcesList,
} from '@/features/assistant/components/assistant-sheet'
import type { AssistantCitation } from '@/features/assistant/hooks/use-assistant'
import type { BriefCitation, ProjectStatusReport } from '../hooks/use-project-ai'

const asCitation = (citation: BriefCitation): AssistantCitation => ({
  ...citation,
  projectId: null,
  projectName: null,
  snippet: null,
})

function Part({
  label,
  note,
  children,
  testId,
}: {
  label: string
  note: string
  children: ReactNode
  testId: string
}) {
  return (
    <section className='space-y-1.5' data-testid={testId}>
      <div className='flex items-baseline gap-2 border-b pb-1'>
        <h3 className='text-xs font-semibold tracking-wider uppercase'>{label}</h3>
        <span className='text-[11px] text-muted-foreground'>{note}</span>
      </div>
      {children}
    </section>
  )
}

/** Plain text of the report, with its three parts labelled, for pasting into an email or minutes. */
const asText = (report: ProjectStatusReport) =>
  [
    `${report.title} - cutoff ${report.cutoffDate}`,
    '',
    'FACT (OctaPM records)',
    ...report.facts.map((fact) => `- ${fact.label}: ${fact.value}`),
    ...report.attention.slice(0, 10).map((item) => `- ${item.typeLabel}: ${item.title}${item.dueDate ? ` (due ${item.dueDate.slice(0, 10)})` : ''}`),
    '',
    'AI INTERPRETATION',
    report.interpretation?.text ?? '(not available)',
    '',
    'AI RECOMMENDATION',
    ...(report.recommendations.length ? report.recommendations.map((item, index) => `${index + 1}. ${item.text}`) : ['(none)']),
    '',
    'Sources',
    ...report.sources.map((source) => `[${source.n}] ${source.typeLabel}: ${source.title}`),
  ].join('\n')

/**
 * The AI status report (AI-5). FACT is OctaPM's own figures and records;
 * the two AI parts are the model's, each statement citing its source.
 */
export function ProjectStatusReportDialog({
  open,
  onOpenChange,
  report,
  loading,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: ProjectStatusReport | null
  loading: boolean
}) {
  const copy = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(asText(report))
      toast.success('Report copied')
    } catch {
      toast.error('Copy is blocked in this browser; select the text instead')
    }
  }
  const sources = (report?.sources ?? []).map((source) => asCitation(source))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl' data-testid='uat-ai-status-report'>
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2'>
            {report?.title ?? 'Status report'}
            {report?.ai.mode === 'mock' && <Badge variant='outline'>Mock model</Badge>}
            {report?.ai.mode === 'disabled' && <Badge variant='secondary'>AI off</Badge>}
          </DialogTitle>
          <DialogDescription>
            {report ? `Figures at ${report.cutoffDate}, as you can see them in OctaPM.` : 'Building the report…'}
          </DialogDescription>
        </DialogHeader>
        {loading && !report ? (
          <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Reading the project…
          </p>
        ) : report ? (
          <div className='space-y-5'>
            <Part label='Fact' note='OctaPM figures and records; no AI' testId='uat-report-fact'>
              <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm tabular-nums'>
                {report.facts.map((fact) => (
                  <div key={fact.key} className='contents'>
                    <dt className='text-muted-foreground' title={fact.rule}>
                      {fact.label}
                    </dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
              {report.attention.length > 0 && (
                <ul className='mt-2 space-y-0.5 text-sm'>
                  {report.attention.slice(0, 10).map((item) => (
                    <li key={`${item.type}-${item.id}`}>
                      <span className='text-muted-foreground'>{item.typeLabel}:</span> {item.title}
                      {item.dueDate ? <span className='text-muted-foreground'> · due {item.dueDate.slice(0, 10)}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Part>
            <Part label='AI interpretation' note='The model’s reading of the facts' testId='uat-report-interpretation'>
              {report.interpretation ? (
                <CitedText content={report.interpretation.text} citations={report.interpretation.citations.map(asCitation)} />
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {report.degradedReason === 'AI_NOT_CONFIGURED'
                    ? 'AI is not configured on this server; the facts above are the report.'
                    : 'The AI provider did not answer; the facts above are the report.'}
                </p>
              )}
            </Part>
            <Part label='AI recommendation' note='Suggestions only; each cites what it rests on' testId='uat-report-recommendation'>
              {report.recommendations.length ? (
                <ol className='list-decimal space-y-1 pl-5'>
                  {report.recommendations.map((item, index) => (
                    <li key={index}>
                      <CitedText content={item.text} citations={item.citations.map(asCitation)} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className='text-sm text-muted-foreground'>No recommendation the sources support.</p>
              )}
            </Part>
            <div className='space-y-1'>
              <p className='text-xs font-medium text-muted-foreground'>Sources</p>
              <SourcesList citations={sources} />
            </div>
            <div className='flex justify-end'>
              <Button size='sm' variant='outline' onClick={copy}>
                <Copy className='me-1 h-3.5 w-3.5' /> Copy as text
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
