import { UserCheck } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useIsExternalParty, useReviewSummary } from '../hooks/use-external-reviews'
import { formatDuration } from '../lib/duration'

/** Consultant reviews on the contractor's Project Overview: what is out with consultants and the oldest open request. */
export function ConsultantReviewsCard({ projectId, onOpen }: { projectId: string; onOpen: () => void }) {
  const canRead = useCanPerform('external_review', 'read')
  const external = useIsExternalParty()
  const { data, isError } = useReviewSummary(projectId, canRead && !external)
  if (!canRead || external || isError || !data) return null
  if (!data.awaitingConsultant && !data.returnedToContractor && !data.respondedThisWeek && !data.responseReceived) return null
  const stats = [
    { label: 'Awaiting consultant', value: data.awaitingConsultant },
    { label: 'Overdue', value: data.overdue, tone: data.overdue ? 'text-red-700 dark:text-red-400' : undefined },
    { label: 'Due today', value: data.dueToday, tone: data.dueToday ? 'text-amber-700 dark:text-amber-400' : undefined },
    { label: 'Returned to contractor', value: data.returnedToContractor, tone: data.returnedToContractor ? 'text-amber-700 dark:text-amber-400' : undefined },
  ]
  return (
    <Card data-testid='uat-consultant-reviews-card'>
      <CardHeader className='flex flex-row items-center justify-between gap-2 space-y-0 pb-2'>
        <CardTitle className='flex items-center gap-2 text-base'><UserCheck className='h-4 w-4 text-muted-foreground' aria-hidden /> Consultant Reviews</CardTitle>
        <Button size='sm' variant='outline' onClick={onOpen} data-testid='uat-consultant-reviews-card-open'>View Open Requests</Button>
      </CardHeader>
      <CardContent className='space-y-2'>
        <dl className='grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4'>
          {stats.map((stat) => (
            <div key={stat.label}><dt className='text-xs text-muted-foreground'>{stat.label}</dt><dd className={cn('text-lg font-semibold tabular-nums', stat.tone)}>{stat.value}</dd></div>
          ))}
        </dl>
        {data.oldestOpen && <p className='text-xs text-muted-foreground'>Oldest open: <span className='font-medium text-foreground'>{data.oldestOpen.ref}</span> — {formatDuration(data.oldestOpen.openMs)}</p>}
      </CardContent>
    </Card>
  )
}
