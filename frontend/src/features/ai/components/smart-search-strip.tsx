import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CitedText } from '@/features/assistant/components/assistant-sheet'
import type { SmartSearchResponse } from '../hooks/use-smart-search'

const TYPE_LABELS: Record<string, string> = {
  rfi: 'RFIs',
  submittal: 'Submittals',
  drawing: 'Drawings',
  document: 'Documents',
  change_order: 'Change orders',
  ipc: 'IPCs',
  risk: 'Risks',
  procurement: 'Procurement',
  long_lead: 'Long-lead items',
  meeting: 'Meetings',
  task: 'Tasks',
  activity: 'Activities',
  boq: 'BOQ',
  project: 'Projects',
  ncr: 'NCRs',
  safety: 'Safety',
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className='rounded border bg-background px-1.5 py-0.5 text-[11px] text-foreground'>
      {children}
    </span>
  )
}

/**
 * What Smart Search understood the query as (AI-4), and an AI answer over the
 * results on request. The chips are the filters actually run.
 */
export function SmartSearchStrip({
  response,
  answer,
  explaining,
  onExplain,
}: {
  response: SmartSearchResponse
  answer: SmartSearchResponse | null
  explaining: boolean
  onExplain: () => void
}) {
  const intent = response.interpretation
  const chips = [
    ...intent.types.map((type) => TYPE_LABELS[type] ?? type),
    ...intent.statuses.map((status) => status.replace(/_/g, ' ')),
    ...(intent.overdue ? ['overdue'] : []),
    ...(intent.project ? [intent.project.name] : []),
    ...(intent.dateFrom ? [`since ${intent.dateFrom}`] : []),
    ...intent.keywords.map((keyword) => `“${keyword}”`),
  ]
  const citations = (answer?.answer?.citations ?? []).map((citation) => ({
    ...citation,
    projectId: null,
    snippet: null,
  }))
  return (
    <div className='space-y-1.5 pt-1' data-testid='uat-smart-search'>
      <div className='flex flex-wrap items-center gap-1 text-xs text-muted-foreground'>
        <Sparkles className='size-3.5 text-primary' aria-hidden />
        <span>Searched for</span>
        {chips.length ? chips.map((chip) => <Chip key={chip}>{chip}</Chip>) : <span>everything</span>}
        {response.overdue && (
          <span>
            · {response.overdue.shown} of {response.overdue.count} overdue on your dashboard
          </span>
        )}
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='ms-auto h-6 px-2 text-xs'
          disabled={explaining || response.items.length === 0}
          onClick={onExplain}
          data-testid='uat-smart-search-explain'
        >
          {explaining && <Loader2 className='me-1 size-3 animate-spin' />}
          Explain results
        </Button>
      </div>
      {answer && (
        <div className='rounded-md bg-muted/50 p-2' data-testid='uat-smart-search-answer'>
          <p className='mb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase'>
            AI interpretation{answer.answer?.mock ? ' · mock model' : ''}
          </p>
          {answer.answer ? (
            <CitedText content={answer.answer.text} citations={citations} className='text-xs' />
          ) : (
            <p className='text-xs text-muted-foreground'>
              AI is not available right now; the results below are unchanged.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
