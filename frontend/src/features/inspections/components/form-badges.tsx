import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  FORM_STATUS_LABEL,
  FORM_TYPE_LABEL,
  type FormStatus,
  type FormType,
} from '../hooks/use-forms'

export function FormStatusBadge({
  status,
  outcome,
  className,
}: {
  status: FormStatus
  outcome?: 'pass' | 'fail' | null
  className?: string
}) {
  const variant =
    status === 'in_progress'
      ? 'default'
      : status === 'complete'
        ? 'secondary'
        : 'outline'
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Badge
        variant={variant}
        className={cn(
          status === 'closed' &&
            'border-emerald-500/50 text-emerald-700 dark:text-emerald-300',
          status === 'void' && 'text-muted-foreground line-through'
        )}
        data-testid='uat-form-status-badge'
      >
        {FORM_STATUS_LABEL[status]}
      </Badge>
      {outcome && status !== 'void' && (
        <Badge variant={outcome === 'fail' ? 'destructive' : 'outline'}>
          {outcome === 'fail' ? 'Failed' : 'Passed'}
        </Badge>
      )}
    </span>
  )
}

export function FormTypeBadge({
  type,
  className,
}: {
  type: FormType
  className?: string
}) {
  return (
    <Badge
      variant='outline'
      className={cn(
        type === 'itp' && 'border-sky-500/50 text-sky-700 dark:text-sky-300',
        type === 'talk' &&
          'border-violet-500/50 text-violet-700 dark:text-violet-300',
        className
      )}
    >
      {FORM_TYPE_LABEL[type]}
    </Badge>
  )
}
