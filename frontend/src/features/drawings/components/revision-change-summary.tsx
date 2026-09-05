import { useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AiRunFeedback } from '@/features/assistant/components/ai-run-feedback'
import {
  renderRevisionImage,
  useCompareRevisionsWithAi,
  useDrawingAiStatus,
  type RevisionCompareResult,
} from '../hooks/use-drawing-assistant'
import type { SheetRevision } from '../hooks/use-drawings'

const COMPARE_WIDTH = 1600

const IMPACT_CLASS: Record<string, string> = {
  high: 'border-rose-300 text-rose-700 dark:text-rose-300',
  medium: 'border-amber-300 text-amber-700 dark:text-amber-300',
  low: 'border-emerald-300 text-emerald-700 dark:text-emerald-300',
}
const KIND_LABEL: Record<string, string> = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Changed',
}

/**
 * "What changed" between two revisions in plain language: both pages are
 * rendered here, sent to the vision provider and the answer listed by area
 * with a site-impact rating — a reading aid next to the pixel diff, never a
 * substitute for checking the sheet.
 */
export function RevisionChangeSummary({
  projectId,
  sheetId,
  before,
  after,
}: {
  projectId: string
  sheetId: string
  before: SheetRevision | null
  after: SheetRevision | null
}) {
  const { data: status } = useDrawingAiStatus(projectId)
  const compare = useCompareRevisionsWithAi(projectId)
  const [result, setResult] = useState<{
    key: string
    value: RevisionCompareResult
  } | null>(null)
  const [rendering, setRendering] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  if (!status?.vision || !before || !after || before.id === after.id)
    return null
  const key = `${before.id}|${after.id}`
  const current = result?.key === key ? result.value : null
  const busy = rendering || compare.isPending

  const explain = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRendering(true)
    try {
      const [imageA, imageB] = await Promise.all([
        renderRevisionImage(before, COMPARE_WIDTH, controller.signal),
        renderRevisionImage(after, COMPARE_WIDTH, controller.signal),
      ])
      if (controller.signal.aborted) return
      if (!imageA || !imageB) {
        toast.error('One of the revisions could not be rendered')
        return
      }
      const value = await compare.mutateAsync({
        sheetId,
        a: { revisionId: before.id, image: imageA },
        b: { revisionId: after.id, image: imageB },
      })
      if (value.degraded)
        toast.error(value.reason || 'The assistant is not available')
      setResult({ key, value })
    } catch (error) {
      if (!controller.signal.aborted) toast.error(getServerErrorMessage(error))
    } finally {
      if (abortRef.current === controller) {
        setRendering(false)
        abortRef.current = null
      }
    }
  }

  return (
    <div className='space-y-2' data-testid='uat-revision-ai-summary'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          variant='outline'
          disabled={busy}
          onClick={explain}
          data-testid='uat-revision-ai-explain'
        >
          {busy ? (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          ) : (
            <Sparkles className='mr-2 h-4 w-4' />
          )}
          {current ? 'Explain again' : 'Explain the changes'}
        </Button>
        <span className='text-xs text-muted-foreground'>
          {busy
            ? rendering && !compare.isPending
              ? 'Rendering both revisions…'
              : 'Comparing…'
            : `A plain-language list of what changed from rev ${before.revision ?? '—'} to rev ${after.revision ?? '—'}, read from the drawings by the AI provider. Check against the sheet.`}
        </span>
      </div>
      {current?.comparison && (
        <div className='space-y-2 rounded-md border p-3 text-sm'>
          <div className='flex flex-wrap items-start gap-2'>
            <p className='min-w-0 flex-1'>{current.comparison.summary}</p>
            <Badge
              variant='outline'
              title='How sure the assistant is about this reading'
            >
              {current.comparison.confidence} confidence
            </Badge>
          </div>
          {current.comparison.changes.length > 0 ? (
            <ul className='space-y-1' data-testid='uat-revision-ai-changes'>
              {current.comparison.changes.map((change, index) => (
                <li
                  key={index}
                  className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5'
                >
                  <Badge
                    variant='outline'
                    className={cn('text-[10px]', IMPACT_CLASS[change.impact])}
                  >
                    {change.impact}
                  </Badge>
                  <span className='text-xs text-muted-foreground'>
                    {KIND_LABEL[change.kind]}
                    {change.area ? ` · ${change.area}` : ''}
                  </span>
                  <span className='min-w-0 flex-1'>{change.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-xs text-muted-foreground'>
              No specific change was identified.
            </p>
          )}
          {current.message && (
            <AiRunFeedback
              projectId={projectId}
              messageId={current.message.id}
              initial={current.message.feedback}
              model={current.message.model}
            />
          )}
        </div>
      )}
    </div>
  )
}
