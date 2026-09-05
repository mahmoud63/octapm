import { useState } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAssistantFeedback } from '../hooks/use-assistant'

/**
 * Thumbs up / down on one stored AI run (a draft, a suggestion, a summary).
 * The rating goes to the same feedback endpoint as Ask OctaPM answers.
 */
export function AiRunFeedback({
  projectId,
  messageId,
  initial = null,
  model,
  className,
}: {
  projectId: string | null
  messageId: string | null
  initial?: 'up' | 'down' | null
  model?: string | null
  className?: string
}) {
  const feedback = useAssistantFeedback(projectId)
  const [rating, setRating] = useState<'up' | 'down' | null>(initial)
  if (!messageId) return null
  const rate = (next: 'up' | 'down') => {
    const value = rating === next ? null : next
    setRating(value)
    feedback.mutate({ messageId, rating: value })
  }
  return (
    <div
      className={cn(
        'flex items-center gap-1 text-[10px] text-muted-foreground',
        className
      )}
      data-testid='uat-ai-run-feedback'
    >
      {model ? <span>{model}</span> : null}
      <span className='ml-auto flex gap-0.5'>
        <button
          type='button'
          aria-label='Helpful'
          className={cn(
            'rounded p-0.5 hover:bg-muted',
            rating === 'up' && 'text-green-600'
          )}
          onClick={() => rate('up')}
        >
          <ThumbsUp className='h-3 w-3' />
        </button>
        <button
          type='button'
          aria-label='Not helpful'
          className={cn(
            'rounded p-0.5 hover:bg-muted',
            rating === 'down' && 'text-red-600'
          )}
          onClick={() => rate('down')}
        >
          <ThumbsDown className='h-3 w-3' />
        </button>
      </span>
    </div>
  )
}
