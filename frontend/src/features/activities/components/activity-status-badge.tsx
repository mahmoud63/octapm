import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { Activity } from '../data/schema'

const config: Record<Activity['status'], { label: string; className: string }> =
  {
    todo: {
      label: 'To Do',
      className: 'bg-gray-100 text-gray-700 border-gray-300 dark:text-gray-200',
    },
    in_progress: {
      label: 'In Progress',
      className: 'bg-blue-100 text-blue-700 border-blue-300 dark:text-blue-200',
    },
    complete: {
      label: 'Complete',
      className:
        'bg-green-100 text-green-700 border-green-300 dark:text-green-200',
    },
    delayed: {
      label: 'Delayed',
      className: 'bg-red-100 text-red-700 border-red-300 dark:text-red-200',
    },
  }

export function ActivityStatusBadge({
  status,
}: {
  status: Activity['status']
}) {
  const statusConfig = config[status]

  return (
    <Badge variant='outline' className={cn(statusConfig.className)}>
      {statusConfig.label}
    </Badge>
  )
}
