import { useState } from 'react'
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import {
  useAskReport,
  type ReportAskResult,
} from '../hooks/use-report-assistant'
import type { ReportDefinitionInput } from '../hooks/use-report-builder'

const ALL = '__all'
const EXAMPLES = [
  'Open RFIs raised in the last 30 days by status',
  'Overdue punch items by trade',
  'Total man-hours by trade this month',
  'Change orders over 50,000 pending approval',
]

/**
 * "Ask for a report": a question in plain words becomes a builder definition
 * with a 50-row preview; *Open in the builder* hands it over to refine and
 * save. Nothing is saved here.
 */
export function ReportAsk({
  projects,
  onUse,
}: {
  projects: Array<{ id: string; name: string }>
  onUse: (definition: ReportDefinitionInput) => void
}) {
  const ask = useAskReport()
  const [question, setQuestion] = useState('')
  const [projectId, setProjectId] = useState<string>(ALL)
  const [result, setResult] = useState<ReportAskResult | null>(null)

  const run = async (text = question) => {
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      setResult(
        await ask.mutateAsync({
          question: trimmed,
          projectId: projectId === ALL ? null : projectId,
        })
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <section
      className='space-y-3 rounded-md border border-dashed bg-card p-3'
      data-testid='uat-report-ask'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Sparkles className='h-4 w-4 text-primary' />
        <h4 className='text-sm font-semibold'>Ask for a report</h4>
        <span className='text-xs text-muted-foreground'>
          Say what you want to see; the builder opens with it filled in — you
          check it and save.
        </span>
      </div>
      <Textarea
        rows={2}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void run()
          }
        }}
        placeholder='e.g. open RFIs raised in the last 30 days by status'
        maxLength={1000}
        data-testid='uat-report-ask-question'
      />
      <div className='flex flex-wrap items-center gap-2'>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className='w-56' data-testid='uat-report-ask-scope'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every project I can open</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className='flex flex-wrap gap-1'>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type='button'
              className='rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted'
              onClick={() => {
                setQuestion(example)
                void run(example)
              }}
            >
              {example}
            </button>
          ))}
        </div>
        <Button
          size='sm'
          className='ml-auto'
          disabled={ask.isPending || !question.trim()}
          onClick={() => run()}
          data-testid='uat-report-ask-run'
        >
          {ask.isPending ? (
            <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
          ) : (
            <Sparkles className='mr-1.5 h-4 w-4' />
          )}
          Build it
        </Button>
      </div>

      {result && (
        <div
          className='space-y-2 rounded-md border p-3'
          data-testid='uat-report-ask-result'
        >
          <div className='flex flex-wrap items-center gap-2'>
            <p className='text-sm font-semibold'>{result.definition.name}</p>
            <Badge variant='outline'>{result.definition.source}</Badge>
            {result.definition.groupBy && (
              <Badge variant='outline'>by {result.definition.groupBy}</Badge>
            )}
            {result.definition.filters.length > 0 && (
              <Badge variant='outline'>
                {result.definition.filters.length} filter
                {result.definition.filters.length === 1 ? '' : 's'}
              </Badge>
            )}
            {result.preview && (
              <Badge variant='secondary'>
                {result.preview.total.toLocaleString()} rows
                {result.preview.projects.denied
                  ? ` · ${result.preview.projects.denied} project${result.preview.projects.denied === 1 ? '' : 's'} skipped`
                  : ''}
              </Badge>
            )}
          </div>
          {result.explanation && (
            <p className='text-sm text-muted-foreground'>
              {result.explanation}
            </p>
          )}
          {result.degraded && (
            <p className='flex items-start gap-1 text-xs text-muted-foreground'>
              <AlertTriangle className='mt-0.5 h-3 w-3 shrink-0' />
              {result.reason}
            </p>
          )}
          {result.assumptions.length > 0 && (
            <ul className='list-disc pl-4 text-xs text-muted-foreground'>
              {result.assumptions.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
          {result.warnings.length > 0 && (
            <ul
              className='list-disc pl-4 text-xs text-amber-700 dark:text-amber-300'
              data-testid='uat-report-ask-warnings'
            >
              {result.warnings.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
          {result.preview && result.preview.groups && (
            <p className='text-xs'>
              {result.preview.groups
                .slice(0, 6)
                .map((group) => `${group.label}: ${group.count}`)
                .join(' · ')}
              {result.preview.groups.length > 6 ? ' · …' : ''}
            </p>
          )}
          <div className='flex flex-wrap items-center gap-2'>
            <AiRunFeedback
              projectId={null}
              messageId={result.message?.id ?? null}
              initial={result.message?.feedback ?? null}
              model={result.message?.model}
              className='mr-auto'
            />
            <Button size='sm' variant='ghost' onClick={() => setResult(null)}>
              Discard
            </Button>
            <Button
              size='sm'
              onClick={() => onUse(result.definition)}
              data-testid='uat-report-ask-use'
            >
              Open in the builder
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
