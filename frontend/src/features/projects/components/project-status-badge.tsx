import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { Project } from '../data/schema'

const statusConfig: Record<
  Project['status'],
  { label: string; className: string }
> = {
  active: {
    label: 'Active',
    className:
      'bg-teal-100/30 text-teal-900 dark:text-teal-200 border-teal-200',
  },
  on_hold: {
    label: 'On Hold',
    className:
      'bg-yellow-100/60 text-yellow-900 dark:text-yellow-200 border-yellow-300',
  },
  completed: {
    label: 'Completed',
    className:
      'bg-blue-100/50 text-blue-900 dark:text-blue-200 border-blue-300',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-red-100/50 text-red-900 dark:text-red-200 border-red-300',
  },
}

export function ProjectStatusBadge({ status }: { status: Project['status'] }) {
  const config = statusConfig[status]

  return (
    <Badge variant='outline' className={cn(config.className)}>
      {config.label}
    </Badge>
  )
}
