import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { cn } from '@/lib/utils'
import { formatLongDate } from '@/lib/dates'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * The project's activity cost-loading rows (GET …/reports/cost-loading, a
 * cost reader's), shown on Schedule › Earned Value when a link opens a cost
 * loading: the row it names selected and scrolled to. Planned value is the
 * approved rows' sum; each row states its activity, planned date, value and
 * workflow status.
 */

type CostLoadingRow = {
  id: string
  activityId: string
  plannedDate: string | null
  plannedValue: number | string
  source: string
  status: string
  notes: string | null
}

type ActivityName = {
  id: string
  name: string
  activityCode?: string | null
}

const fmtMoney = (value: number | string) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })

export function CostLoadingPanel({
  projectId,
  selectedId,
  activities,
}: {
  projectId: string
  selectedId?: string
  activities: ActivityName[]
}) {
  const { data, isLoading, error } = useQuery<CostLoadingRow[]>({
    queryKey: ['cost-loading', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/reports/cost-loading`)
        .then((response) => response.data.data),
  })
  const rows = useMemo(() => data ?? [], [data])
  const activityById = useMemo(
    () => new Map(activities.map((activity) => [activity.id, activity])),
    [activities]
  )
  const selectedRow = useRef<HTMLTableRowElement | null>(null)
  const selectedListed = Boolean(
    selectedId && rows.some((row) => row.id === selectedId)
  )
  useEffect(() => {
    if (selectedListed) selectedRow.current?.scrollIntoView({ block: 'center' })
  }, [selectedListed])

  const status = (error as { response?: { status?: number } } | null)?.response
    ?.status

  return (
    <section
      className='rounded-lg border bg-card'
      data-testid='uat-cost-loading-panel'
    >
      <div className='border-b p-3'>
        <p className='text-sm font-semibold'>Cost loading</p>
        <p className='text-xs text-muted-foreground'>
          Time-phased planned value per activity; the approved rows are the
          report&apos;s PV.
        </p>
      </div>
      {isLoading ? (
        <p className='p-3 text-sm text-muted-foreground'>Loading…</p>
      ) : error ? (
        <p className='p-3 text-sm text-muted-foreground'>
          {status === 403
            ? 'Cost loading is shown to people who can open the cost module.'
            : 'The cost loading could not be loaded.'}
        </p>
      ) : rows.length === 0 ? (
        <p className='p-3 text-sm text-muted-foreground'>
          No cost-loading rows yet.
        </p>
      ) : (
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='px-3'>Activity</TableHead>
                <TableHead className='px-3'>Planned date</TableHead>
                <TableHead className='px-3 text-right'>Planned value</TableHead>
                <TableHead className='px-3'>Source</TableHead>
                <TableHead className='px-3'>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const activity = activityById.get(row.activityId)
                const selected = row.id === selectedId
                return (
                  <TableRow
                    key={row.id}
                    ref={selected ? selectedRow : undefined}
                    className={cn(
                      selected &&
                        'bg-primary/10 ring-2 ring-primary/40 ring-inset'
                    )}
                    aria-selected={selected ? true : undefined}
                    data-selected={selected ? 'true' : undefined}
                    data-testid={`uat-cost-loading-row-${row.id}`}
                  >
                    <TableCell className='px-3'>
                      <div className='font-medium'>
                        {activity?.activityCode ?? '—'}
                      </div>
                      <div className='text-xs text-muted-foreground'>
                        {activity?.name ?? 'Activity not in the schedule'}
                      </div>
                    </TableCell>
                    <TableCell className='px-3 text-xs'>
                      {row.plannedDate ? formatLongDate(row.plannedDate) : '—'}
                    </TableCell>
                    <TableCell className='px-3 text-right tabular-nums'>
                      {fmtMoney(row.plannedValue)}
                    </TableCell>
                    <TableCell className='px-3 text-xs'>{row.source}</TableCell>
                    <TableCell className='px-3'>
                      <Badge variant='outline' className='text-xs'>
                        {row.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
