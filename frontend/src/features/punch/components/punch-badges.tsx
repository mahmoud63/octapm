import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  STATUS_LABEL,
  type PunchPriority,
  type PunchStatus,
} from '../hooks/use-punch'

export function PunchStatusBadge({
  status,
  className,
}: {
  status: PunchStatus
  className?: string
}) {
  const variant =
    status === 'open'
      ? 'default'
      : status === 'in_dispute'
        ? 'destructive'
        : status === 'ready_for_review'
          ? 'secondary'
          : 'outline'
  return (
    <Badge
      variant={variant}
      className={cn(
        status === 'ready_for_review' &&
          'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
        status === 'closed' &&
          'border-emerald-500/50 text-emerald-700 dark:text-emerald-300',
        status === 'void' && 'text-muted-foreground line-through',
        className
      )}
      data-testid='uat-punch-status-badge'
    >
      {STATUS_LABEL[status]}
    </Badge>
  )
}

export function PunchPriorityBadge({
  priority,
  className,
}: {
  priority: PunchPriority
  className?: string
}) {
  if (priority === 'normal') return null
  return (
    <Badge
      variant={
        priority === 'urgent'
          ? 'destructive'
          : priority === 'high'
            ? 'default'
            : 'outline'
      }
      className={cn(priority === 'low' && 'text-muted-foreground', className)}
    >
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  )
}
