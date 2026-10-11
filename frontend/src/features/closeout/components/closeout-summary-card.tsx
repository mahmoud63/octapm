import { PackageCheck } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCloseoutOverview } from '../hooks/use-project-closeout'

const STATUS_LABEL = {
  in_progress: 'In progress',
  substantially_complete: 'Substantially complete',
  handed_over: 'Handed over',
  final_complete: 'Final completion',
} as const

/**
 * Closeout on the Project Overview, once a turnover list exists: status, the
 * next milestone, the turnover package and open readiness checks.
 */
export function CloseoutSummaryCard({ projectId, onOpen }: { projectId: string; onOpen: () => void }) {
  const canRead = useCanPerform('closeout', 'read')
  const { data, isError } = useCloseoutOverview(projectId, canRead)
  if (!canRead || isError || !data || !data.deliverables.total) return null
  const next = data.milestones.find((row) => !row.at)
  const gate = next && data.gates ? data.gates[next.key] : null
  const stats: Array<{ label: string; value: React.ReactNode; tone?: string; testId: string }> = [
    { label: 'Status', value: STATUS_LABEL[data.status], testId: 'status' },
    { label: 'Next milestone', value: next ? `${next.label}${gate ? (gate.ready ? ' · ready' : ` · ${gate.outstanding.length} outstanding`) : ''}` : 'All recorded', testId: 'next' },
    { label: 'Turnover package', value: `${data.deliverables.settledPct}% settled`, testId: 'package' },
    { label: 'Overdue deliverables', value: data.deliverables.overdue, tone: data.deliverables.overdue ? 'text-red-700 dark:text-red-400' : undefined, testId: 'overdue' },
    { label: 'Readiness checks open', value: data.readiness.open, tone: data.readiness.open ? 'text-amber-700 dark:text-amber-400' : undefined, testId: 'checks' },
    { label: 'Warranties expiring', value: data.warranties.expiring, tone: data.warranties.expiring ? 'text-amber-700 dark:text-amber-400' : undefined, testId: 'warranties' },
  ]
  return (
    <Card data-testid='uat-closeout-summary-card'>
      <CardHeader className='flex flex-row items-center justify-between gap-2 space-y-0 pb-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <PackageCheck className='h-4 w-4 text-muted-foreground' aria-hidden />
          Closeout / Turnover
        </CardTitle>
        <Button size='sm' variant='outline' onClick={onOpen} data-testid='uat-closeout-summary-open'>
          Open Closeout
        </Button>
      </CardHeader>
      <CardContent>
        <dl className='grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6'>
          {stats.map((stat) => (
            <div key={stat.label} className='min-w-0' data-testid={`uat-closeout-summary-${stat.testId}`}>
              <dt className='text-xs text-muted-foreground'>{stat.label}</dt>
              <dd className={cn('font-semibold tabular-nums break-words', stat.tone)}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
