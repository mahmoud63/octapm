import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import {
  CitedText,
  SourcesList,
} from '@/features/assistant/components/assistant-sheet'
import { useAssistantStatus } from '@/features/assistant/hooks/use-assistant'
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import {
  useDebouncedValue,
  useDraftRfiWithAi,
  useSimilarRfis,
  type RfiDraft,
  type RfiDraftResult,
  type SimilarRfi,
} from '../hooks/use-rfi-assistant'

/** Opens in a new tab so the form being filled is not lost. */
function SimilarRfiLink({ item }: { item: SimilarRfi }) {
  const link = workspaceLink(item.url)
  const label = `${item.ref ?? 'RFI'} · ${item.subject}${item.status ? ` (${item.status})` : ''}${!item.sameProject && item.projectName ? ` — ${item.projectName}` : ''}`
  if (!link) return <span>{label}</span>
  return (
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
  )
}

/**
 * Duplicate check while typing a subject: prior RFIs across the projects the
 * person can open, this project first. Search only — no model call.
 */
export function SimilarRfis({
  projectId,
  query,
  excludeRfiId = null,
}: {
  projectId: string
  query: string
  excludeRfiId?: string | null
}) {
  const debounced = useDebouncedValue(query, 500)
  const { data } = useSimilarRfis(projectId, debounced, { excludeRfiId })
  const items = (data?.items ?? []).filter((item) => item.id !== excludeRfiId)
  if (debounced.trim().length < 6 || items.length === 0) return null
  return (
    <div
      className='rounded border border-amber-500/40 bg-amber-50/40 p-2 text-xs dark:bg-amber-950/20'
      data-testid='uat-rfi-similar'
    >
      <p className='mb-1 flex items-center gap-1 font-medium'>
        <AlertTriangle className='h-3 w-3 text-amber-600' /> Possibly asked
        before
      </p>
      <ul className='space-y-0.5'>
        {items.slice(0, 3).map((item) => (
          <li key={item.id}>
            <SimilarRfiLink item={item} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function DraftPreview({
  projectId,
  result,
  draft,
  onApply,
  onDiscard,
}: {
  projectId: string
  result: RfiDraftResult
  draft: RfiDraft
  onApply: (draft: RfiDraft) => void
  onDiscard: () => void
}) {
  return (
    <div
      className='space-y-2 rounded border p-3'
      data-testid='uat-rfi-ai-result'
    >
      <p className='text-sm font-semibold'>{draft.subject}</p>
      <div className='flex flex-wrap gap-1'>
        {draft.discipline && (
          <Badge variant='outline'>{draft.discipline}</Badge>
        )}
        {draft.specSection && (
          <Badge variant='outline'>Spec {draft.specSection}</Badge>
        )}
        <Badge
          variant={draft.priority === 'urgent' ? 'destructive' : 'secondary'}
        >
          {draft.priority}
        </Badge>
        {draft.costImpact && <Badge variant='outline'>Cost impact</Badge>}
        {draft.scheduleImpactFlag && (
          <Badge variant='outline'>Schedule impact</Badge>
        )}
      </div>
      <CitedText content={draft.question} citations={draft.citations} />
      {draft.impactReason && (
        <p className='text-xs text-muted-foreground'>{draft.impactReason}</p>
      )}
      {draft.alreadyAnswered.length > 0 && (
        <Alert data-testid='uat-rfi-ai-answered'>
          <AlertTriangle className='h-4 w-4' />
          <AlertTitle>May already be answered</AlertTitle>
          <AlertDescription>
            <ul className='space-y-0.5 text-xs'>
              {draft.alreadyAnswered.map((item) => {
                const link = workspaceLink(item.url)
                const label = `${item.typeLabel}${item.ref ? ` ${item.ref}` : ''} · ${item.title}`
                return (
                  <li key={`${item.type}-${item.id}`}>
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
                    {item.why ? ` — ${item.why}` : ''}
                  </li>
                )
              })}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <SourcesList citations={draft.citations} />
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
          onClick={() => onApply(draft)}
          data-testid='uat-rfi-ai-apply'
        >
          Use this draft
        </Button>
      </div>
    </div>
  )
}

/**
 * "Draft with AI" on the New RFI form: a rough note becomes a proposed
 * subject, question (citing the documents), discipline, spec section,
 * priority and impact flags. Applying fills the form; nothing is created.
 */
export function RfiDraftAssistant({
  projectId,
  references,
  onApply,
}: {
  projectId: string
  references: {
    specSection?: string | null
    discipline?: string | null
    activityId?: string | null
    locationId?: string | null
  }
  onApply: (draft: RfiDraft) => void
}) {
  const { data: status } = useAssistantStatus(projectId)
  const draft = useDraftRfiWithAi(projectId)
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<RfiDraftResult | null>(null)
  const enabled = status?.enabled !== false

  const run = async () => {
    try {
      setResult(
        await draft.mutateAsync({
          prompt: prompt.trim(),
          specSection: references.specSection || null,
          discipline: references.discipline || null,
          activityId: references.activityId || null,
          locationId: references.locationId || null,
        })
      )
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className='rounded border'
      data-testid='uat-rfi-ai'
    >
      <CollapsibleTrigger asChild>
        <button
          type='button'
          className='flex w-full items-center gap-2 px-3 py-2 text-sm font-medium'
          data-testid='uat-rfi-ai-toggle'
        >
          <Sparkles className='h-4 w-4 text-primary' /> Draft with AI
          <span className='ml-auto text-xs font-normal text-muted-foreground'>
            {enabled
              ? 'From your specs, drawings and prior RFIs'
              : 'Not configured on this server'}
          </span>
          <ChevronDown
            className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className='space-y-3 border-t px-3 py-3'>
        {enabled ? (
          <>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={3}
              maxLength={4000}
              placeholder='In your own words: what is unclear, where it is, and what you think should happen'
              data-testid='uat-rfi-ai-prompt'
            />
            <div className='flex justify-end'>
              <Button
                size='sm'
                disabled={!prompt.trim() || draft.isPending}
                onClick={run}
                data-testid='uat-rfi-ai-draft'
              >
                {draft.isPending ? (
                  <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
                ) : (
                  <Wand2 className='mr-1.5 h-4 w-4' />
                )}
                Draft the RFI
              </Button>
            </div>
          </>
        ) : (
          <p className='text-sm text-muted-foreground'>
            AI drafting needs a provider key on the server (ANTHROPIC_API_KEY,
            OPENAI_API_KEY or GEMINI_API_KEY). The check for similar RFIs still
            runs while you type the subject.
          </p>
        )}
        {result?.degraded && (
          <Alert>
            <AlertTriangle className='h-4 w-4' />
            <AlertTitle>No draft this time</AlertTitle>
            <AlertDescription>{result.reason}</AlertDescription>
          </Alert>
        )}
        {result && !result.degraded && result.draft && (
          <DraftPreview
            projectId={projectId}
            result={result}
            draft={result.draft}
            onApply={(value) => {
              onApply(value)
              setResult(null)
              setOpen(false)
            }}
            onDiscard={() => setResult(null)}
          />
        )}
        {result && result.similar.length > 0 && (
          <div className='text-xs' data-testid='uat-rfi-ai-similar'>
            <p className='mb-1 font-medium text-muted-foreground'>
              Prior RFIs on this topic
            </p>
            <ul className='space-y-0.5'>
              {result.similar.map((item) => (
                <li key={item.id}>
                  <SimilarRfiLink item={item} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
