import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { useProductivity } from '../hooks/use-timesheets'

const number = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString(undefined, { maximumFractionDigits: digits })

/** Approved hours and labour cost per activity against progress and the labour budget. */
export function ProductivityPanel({
  projectId,
  from,
  to,
}: {
  projectId: string
  from: string
  to: string
}) {
  const { data, isLoading } = useProductivity(projectId, from, to)
  if (isLoading || !data) {
    return (
      <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Computing…
      </div>
    )
  }
  return (
    <div className='space-y-2' data-testid='uat-timesheet-productivity'>
      <p className='text-xs text-muted-foreground'>
        Approved timesheets {from} → {to}: {number(data.totals.hours)} h across{' '}
        {data.totals.activities} activit
        {data.totals.activities === 1 ? 'y' : 'ies'}, labour cost{' '}
        {number(data.totals.cost, 2)}
        {data.totals.warnings
          ? ` · ${data.totals.warnings} ahead of progress`
          : ''}
        . Earned labour = labour budget × approved % complete.
      </p>
      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50 text-xs text-muted-foreground'>
            <tr>
              <th className='px-2 py-1 text-left'>Activity</th>
              <th className='px-2 py-1 text-right'>Hours</th>
              <th className='px-2 py-1 text-right'>OT</th>
              <th className='px-2 py-1 text-right'>Workers</th>
              <th className='px-2 py-1 text-right'>Days</th>
              <th className='px-2 py-1 text-right'>h / day</th>
              <th className='px-2 py-1 text-right'>% done</th>
              <th className='px-2 py-1 text-right'>h / %</th>
              <th className='px-2 py-1 text-right'>Cost</th>
              <th className='px-2 py-1 text-right'>Earned</th>
              <th className='px-2 py-1 text-right'>Burn</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr
                key={row.activityId}
                className={cn(
                  'border-t',
                  row.warning && 'bg-amber-50 dark:bg-amber-950/30'
                )}
              >
                <td className='px-2 py-1'>
                  {row.code && (
                    <span className='mr-1 font-mono text-xs'>{row.code}</span>
                  )}
                  {row.name}
                  {row.warning && (
                    <Badge
                      variant='outline'
                      className='ml-2 border-amber-300 px-1 py-0 text-[10px] text-amber-700 dark:text-amber-300'
                    >
                      {row.warning}
                    </Badge>
                  )}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {number(row.hours)}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {number(row.overtimeHours)}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {row.workers}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {row.days}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {number(row.hoursPerDay)}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {number(row.pctComplete)}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {number(row.hoursPerPct, 2)}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {number(row.cost, 2)}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {number(row.earnedLabour, 2)}
                </td>
                <td className='px-2 py-1 text-right tabular-nums'>
                  {row.labourBurnPct === null
                    ? '—'
                    : `${number(row.labourBurnPct)}%`}
                </td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr>
                <td
                  colSpan={11}
                  className='px-2 py-3 text-center text-muted-foreground'
                >
                  No approved hours in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
