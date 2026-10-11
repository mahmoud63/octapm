import { Sparkles } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAiDrawer, type AiRecordContext } from '@/stores/ai-drawer-store'

/**
 * The one AI action button used across OctaPM screens (AI UX correction):
 * "Explain critical path", "Summarize", "Draft with AI"… It opens the Ask
 * OctaPM drawer over the current screen and asks `question` there, about
 * `record` when given. Hidden from someone without the assistant.
 */
export function AiAction({
  label,
  question,
  record = null,
  variant = 'outline',
  className,
  testId,
}: {
  label: string
  question?: string
  record?: AiRecordContext | null
  variant?: 'outline' | 'ghost' | 'default'
  className?: string
  testId?: string
}) {
  const canAsk = useCanPerform('assistant', 'read')
  const openDrawer = useAiDrawer((state) => state.openDrawer)
  if (!canAsk) return null
  return (
    <Button
      type='button'
      size='sm'
      variant={variant}
      className={cn('gap-1.5', className)}
      onClick={() => openDrawer({ record, question: question ?? null })}
      data-testid={testId ?? 'uat-ai-action'}
    >
      <Sparkles className='h-3.5 w-3.5 text-primary' aria-hidden />
      {label}
    </Button>
  )
}
