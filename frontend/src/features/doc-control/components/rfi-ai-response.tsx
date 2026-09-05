import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, FileText, Loader2, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import {
  CitedText,
  SourcesList,
} from '@/features/assistant/components/assistant-sheet'
import { useAssistantStatus } from '@/features/assistant/hooks/use-assistant'
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import type { RfiRecord } from '../hooks/use-doc-control'
import {
  useSuggestRfiResponse,
  useSummarizeRfi,
  type RfiSuggestionResult,
  type RfiSummaryResult,
  type SimilarRfi,
} from '../hooks/use-rfi-assistant'

const CONFIDENCE_LABEL = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
} as const

const confidenceVariant = (level: 'high' | 'medium' | 'low') =>
  level === 'high'
    ? 'default'
    : level === 'medium'
      ? 'secondary'
      : 'destructive'

function SimilarList({ items }: { items: SimilarRfi[] }) {
  if (items.length === 0) return null
  return (
    <div className='text-xs'>
      <p className='mb-0.5 font-medium text-muted-foreground'>
        Prior RFIs on this topic
      </p>
      <ul className='space-y-0.5'>
        {items.map((item) => {
          const link = workspaceLink(item.url)
          const label = `${item.ref ?? 'RFI'} · ${item.subject}${item.status ? ` (${item.status})` : ''}${!item.sameProject && item.projectName ? ` — ${item.projectName}` : ''}`
          return (
            <li key={item.id}>
              {link ? (
                <Link
                  to='/projects/$projectId'
                  params={{ projectId: link.projectId }}
                  search={link.search}
                  target='_blank'
                  rel='noreferrer'
                  className='underline-offset-2 hover:underline'
                >
                  {label}
                </Link>
              ) : (
                <span>{label}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SuggestionCard({
  projectId,
  result,
  onUse,
  onDiscard,
}: {
  projectId: string
  result: RfiSuggestionResult
  onUse: (text: string) => void
  onDiscard: () => void
}) {
  const suggestion = result.suggestion
  if (!suggestion) return null
  const impacts = suggestion.impacts
  return (
    <div
      className='space-y-2 rounded border p-3'
      data-testid='uat-rfi-ai-suggestion'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <p className='text-sm font-semibold'>Draft response</p>
        <Badge variant={confidenceVariant(suggestion.confidence)}>
          {CONFIDENCE_LABEL[suggestion.confidence]}
        </Badge>
        {(impacts.cost !== 'none' || impacts.schedule !== 'none') && (
          <span className='text-xs text-muted-foreground'>
            Cost impact {impacts.cost} · schedule impact {impacts.schedule}
            {impacts.reason ? ` — ${impacts.reason}` : ''}
          </span>
        )}
      </div>
      <CitedText
        content={suggestion.response}
        citations={suggestion.citations}
      />
      {suggestion.conflicts.length > 0 && (
        <Alert variant='destructive' data-testid='uat-rfi-ai-conflicts'>
          <AlertTriangle className='h-4 w-4' />
          <AlertTitle>The sources disagree</AlertTitle>
          <AlertDescription>
            <ul className='list-disc space-y-0.5 pl-4 text-xs'>
              {suggestion.conflicts.map((conflict, index) => (
                <li key={index}>
                  {conflict.description}
                  {conflict.sourceNs.length
                    ? ` [${conflict.sourceNs.join(', ')}]`
                    : ''}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {suggestion.openPoints.length > 0 && (
        <div className='text-xs'>
          <p className='font-medium text-muted-foreground'>
            Still needed to answer fully
          </p>
          <ul className='list-disc space-y-0.5 pl-4'>
            {suggestion.openPoints.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        </div>
      )}
      {suggestion.basis.length > 0 && (
        <div className='text-xs'>
          <p className='font-medium text-muted-foreground'>Based on</p>
          <ul className='list-disc space-y-0.5 pl-4'>
            {suggestion.basis.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <SourcesList citations={suggestion.citations} />
      <SimilarList items={result.similar} />
      <div className='flex flex-wrap items-center gap-2'>
        <AiRunFeedback
          projectId={projectId}
          messageId={result.message?.id ?? null}
          initial={result.message?.feedback ?? null}
          model={result.message?.model}
          className='mr-auto'
        />
        <Button size='sm' variant='ghost' onClick={onDiscard}>
          Discard
        </Button>
        <Button
          size='sm'
          onClick={() => onUse(suggestion.responsePlain)}
          data-testid='uat-rfi-ai-use'
        >
          Use this draft
        </Button>
      </div>
    </div>
  )
}

function SummaryCard({
  projectId,
  result,
  onClose,
}: {
  projectId: string
  result: RfiSummaryResult
  onClose: () => void
}) {
  const summary = result.summary
  return (
    <div
      className='space-y-2 rounded border p-3'
      data-testid='uat-rfi-ai-summary-result'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <p className='text-sm font-semibold'>Thread summary</p>
        {summary.suggestedStatus && (
          <Badge variant='outline'>suggested: {summary.suggestedStatus}</Badge>
        )}
        {result.degraded && (
          <span className='text-xs text-muted-foreground'>
            built from the record (no AI provider)
          </span>
        )}
      </div>
      <p className='text-sm whitespace-pre-wrap'>{summary.summary}</p>
      {summary.decisions.length > 0 && (
        <div className='text-xs'>
          <p className='font-medium text-muted-foreground'>Decisions</p>
          <ul className='list-disc space-y-0.5 pl-4'>
            {summary.decisions.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {summary.openPoints.length > 0 && (
        <div className='text-xs'>
          <p className='font-medium text-muted-foreground'>Open points</p>
          <ul className='list-disc space-y-0.5 pl-4'>
            {summary.openPoints.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {summary.suggestedNextStep && (
        <p className='text-xs'>
          <span className='font-medium text-muted-foreground'>Next: </span>
          {summary.suggestedNextStep}
        </p>
      )}
      <div className='flex items-center gap-2'>
        <AiRunFeedback
          projectId={projectId}
          messageId={result.message?.id ?? null}
          initial={result.message?.feedback ?? null}
          model={result.message?.model}
          className='mr-auto'
        />
        <Button size='sm' variant='ghost' onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}

/**
 * Sits above the reply box in the RFI workspace: summarise the thread, or
 * draft a response from the specs, drawings and prior RFIs the responder can
 * read. "Use this draft" only fills the reply box.
 */
export function RfiResponseAssistant({
  projectId,
  rfi,
  canDraft,
  onUseDraft,
}: {
  projectId: string
  rfi: RfiRecord
  canDraft: boolean
  onUseDraft: (text: string) => void
}) {
  const { data: status } = useAssistantStatus(projectId)
  const suggest = useSuggestRfiResponse(projectId)
  const summarize = useSummarizeRfi(projectId)
  const [instructions, setInstructions] = useState('')
  const [suggestion, setSuggestion] = useState<RfiSuggestionResult | null>(null)
  const [summary, setSummary] = useState<RfiSummaryResult | null>(null)
  const enabled = status?.enabled !== false

  const runSuggest = async () => {
    try {
      setSuggestion(
        await suggest.mutateAsync({
          rfiId: rfi.id,
          instructions: instructions.trim() || null,
        })
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }
  const runSummary = async () => {
    try {
      setSummary(await summarize.mutateAsync({ rfiId: rfi.id }))
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div
      className='space-y-2 rounded border border-dashed p-3'
      data-testid='uat-rfi-ai-response'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Sparkles className='h-4 w-4 text-primary' />
        <span className='text-sm font-medium'>Assistant</span>
        <span className='text-xs text-muted-foreground'>
          {enabled
            ? 'Drafts are yours to edit; nothing is posted until you do.'
            : 'AI drafting is not configured on this server; summaries are built from the record.'}
        </span>
        <div className='ml-auto flex flex-wrap gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={summarize.isPending}
            onClick={runSummary}
            data-testid='uat-rfi-ai-summary'
          >
            {summarize.isPending ? (
              <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
            ) : (
              <FileText className='mr-1.5 h-4 w-4' />
            )}
            Summarise thread
          </Button>
          {canDraft && enabled && (
            <Button
              size='sm'
              disabled={suggest.isPending}
              onClick={runSuggest}
              data-testid='uat-rfi-ai-suggest'
            >
              {suggest.isPending ? (
                <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
              ) : (
                <Wand2 className='mr-1.5 h-4 w-4' />
              )}
              Draft a response
            </Button>
          )}
        </div>
      </div>
      {canDraft && enabled && (
        <Input
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          maxLength={2000}
          placeholder='Optional: anything the answer must respect (e.g. "refer to rev C only")'
          data-testid='uat-rfi-ai-instructions'
        />
      )}
      {summary && (
        <SummaryCard
          projectId={projectId}
          result={summary}
          onClose={() => setSummary(null)}
        />
      )}
      {suggestion?.degraded && (
        <Alert>
          <AlertTriangle className='h-4 w-4' />
          <AlertTitle>No draft this time</AlertTitle>
          <AlertDescription>
            {suggestion.reason}
            <SimilarList items={suggestion.similar} />
          </AlertDescription>
        </Alert>
      )}
      {suggestion && !suggestion.degraded && (
        <SuggestionCard
          projectId={projectId}
          result={suggestion}
          onUse={(text) => {
            onUseDraft(text)
            setSuggestion(null)
            toast.success('Draft placed in the reply box — edit before sending')
          }}
          onDiscard={() => setSuggestion(null)}
        />
      )}
    </div>
  )
}
