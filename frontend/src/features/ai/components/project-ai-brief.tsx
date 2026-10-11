import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CitedText,
  SourcesList,
} from '@/features/assistant/components/assistant-sheet'
import type { AssistantCitation } from '@/features/assistant/hooks/use-assistant'
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import { ProjectStatusReportDialog } from './project-status-report'
import {
  useExplainProject,
  useProjectBrief,
  useProjectStatusReport,
  type BriefCitation,
  type BriefItem,
  type BriefKind,
  type ProjectBrief,
} from '../hooks/use-project-ai'

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive',
  overdue: 'bg-destructive/15 text-destructive',
  attention: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

const asCitation = (citation: BriefCitation): AssistantCitation => ({
  ...citation,
  projectId: null,
  projectName: null,
  snippet: null,
})

function ItemRow({ item }: { item: BriefItem }) {
  const link = workspaceLink(item.url)
  const title = `${item.ref ? `${item.ref} · ` : ''}${item.title}`
  return (
    <li className='flex items-start gap-2 py-1.5' data-testid='uat-ai-attention-item'>
      <span
        className={cn(
          'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
          SEVERITY_TONE[item.severity] ?? 'bg-muted text-muted-foreground'
        )}
      >
        {item.severity}
      </span>
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-baseline gap-x-2 text-sm'>
          {link ? (
            <Link
              to='/projects/$projectId'
              params={{ projectId: link.projectId }}
              search={link.search}
              className='font-medium underline-offset-2 hover:underline'
            >
              {title}
            </Link>
          ) : (
            <span className='font-medium'>{title}</span>
          )}
          <span className='text-xs text-muted-foreground'>{item.typeLabel}</span>
        </div>
        <p className='truncate text-xs text-muted-foreground'>
          {[item.snippet, item.dueDate ? `due ${item.dueDate.slice(0, 10)}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </li>
  )
}

function Narrative({ brief }: { brief: ProjectBrief }) {
  if (!brief.narrative) {
    return (
      <p className='text-sm text-muted-foreground'>
        {brief.degradedReason === 'AI_NOT_CONFIGURED'
          ? 'AI is not configured on this server. The facts and the list are still current.'
          : brief.degradedReason === 'NO_SOURCES'
            ? 'There is nothing on this project yet for AI to explain.'
            : 'The AI provider did not answer. The facts and the list are still current; try again shortly.'}
      </p>
    )
  }
  const citations = brief.narrative.citations.map(asCitation)
  return (
    <div className='space-y-2' data-testid='uat-ai-narrative'>
      <CitedText content={brief.narrative.text} citations={citations} />
      <SourcesList citations={citations} />
    </div>
  )
}

/**
 * The project's "What needs attention" and summary (AI-3) on the Overview.
 * The list and the facts are OctaPM's own records and rules, loaded with no
 * model call; the brief is the model's reading of them, on request, and
 * never changes a figure, a status or an approval.
 */
export function ProjectAiBrief({ projectId }: { projectId: string }) {
  const canAsk = useCanPerform('assistant', 'read')
  const { data: brief, isLoading } = useProjectBrief(projectId, canAsk)
  const explain = useExplainProject(projectId)
  const [result, setResult] = useState<ProjectBrief | null>(null)
  const [showFacts, setShowFacts] = useState(false)
  const statusReport = useProjectStatusReport(projectId)
  const [reportOpen, setReportOpen] = useState(false)

  if (!canAsk) return null

  const openReport = () => {
    setReportOpen(true)
    statusReport.mutate(undefined, {
      onError: (error) => {
        setReportOpen(false)
        toast.error(getServerErrorMessage(error))
      },
    })
  }

  const run = async (kind: BriefKind) => {
    try {
      setResult(await explain.mutateAsync(kind))
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const mode = brief?.ai.mode
  const items = brief?.items ?? []
  const facts = brief?.facts ?? []

  return (
    <section
      className='mt-3 rounded-lg border bg-card p-4'
      data-testid='uat-ai-project-brief'
      aria-label='What needs attention'
    >
      <header className='flex flex-wrap items-center gap-2'>
        <Sparkles className='h-4 w-4 text-primary' aria-hidden />
        <h2 className='text-sm font-semibold'>What needs attention</h2>
        {mode === 'mock' && (
          <Badge variant='outline' title='No AI model is connected; answers restate OctaPM records'>
            Mock model
          </Badge>
        )}
        {mode === 'disabled' && <Badge variant='secondary'>AI off</Badge>}
        <div className='ms-auto flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={explain.isPending || !brief || mode === 'disabled'}
            onClick={() => run('attention')}
            data-testid='uat-ai-brief-attention'
          >
            {explain.isPending && explain.variables === 'attention' ? (
              <Loader2 className='me-1 h-3.5 w-3.5 animate-spin' />
            ) : null}
            Brief me
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={explain.isPending || !brief || mode === 'disabled'}
            onClick={() => run('summary')}
            data-testid='uat-ai-brief-summary'
          >
            {explain.isPending && explain.variables === 'summary' ? (
              <Loader2 className='me-1 h-3.5 w-3.5 animate-spin' />
            ) : null}
            Summarise project
          </Button>
          <Button
            size='sm'
            disabled={statusReport.isPending || !brief}
            onClick={openReport}
            data-testid='uat-ai-status-report-open'
          >
            {statusReport.isPending ? <Loader2 className='me-1 h-3.5 w-3.5 animate-spin' /> : null}
            Status report
          </Button>
        </div>
      </header>

      <div className='mt-3 grid gap-4 lg:grid-cols-2'>
        <div className='min-w-0'>
          <p className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
            From OctaPM records
          </p>
          {isLoading ? (
            <p className='py-2 text-sm text-muted-foreground'>Loading…</p>
          ) : items.length === 0 ? (
            <p className='py-2 text-sm text-muted-foreground'>
              Nothing on this project is waiting on you or flagged at today's cutoff.
            </p>
          ) : (
            <ul className='divide-y'>
              {items.slice(0, 8).map((item) => (
                <ItemRow key={`${item.type}-${item.id}`} item={item} />
              ))}
            </ul>
          )}
          {facts.length > 0 && (
            <div className='mt-2'>
              <button
                type='button'
                className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
                onClick={() => setShowFacts((value) => !value)}
                aria-expanded={showFacts}
              >
                {showFacts ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
                Facts at {brief?.cutoffDate} ({facts.length})
              </button>
              {showFacts && (
                <dl className='mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs tabular-nums'>
                  {facts.map((fact) => (
                    <div key={fact.key} className='contents'>
                      <dt className='text-muted-foreground' title={fact.rule}>
                        {fact.label}
                      </dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>

        <div className='min-w-0 rounded-md bg-muted/40 p-3'>
          <p className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
            AI interpretation
          </p>
          {result ? (
            <div className='mt-1'>
              <Narrative brief={result} />
            </div>
          ) : (
            <p className='mt-1 text-sm text-muted-foreground'>
              Ask for a brief to have AI explain these records and suggest where to focus. Every
              statement links to its record; figures stay OctaPM's own.
            </p>
          )}
        </div>
      </div>
      <ProjectStatusReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        report={statusReport.data ?? null}
        loading={statusReport.isPending}
      />
    </section>
  )
}
