import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpDown, Download, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Main } from '@/components/layout/main'
import {
  downloadPortfolioXlsx,
  usePortfolio,
  useRefreshPortfolio,
  type PortfolioRow,
} from './hooks/use-report-builder'

type SortKey =
  | 'name'
  | 'health'
  | 'spi'
  | 'cpi'
  | 'cash'
  | 'open'
  | 'overdue'
  | 'contract'

const money = (value: number | null | undefined, currency?: string) =>
  value === null || value === undefined
    ? '—'
    : `${currency ? `${currency} ` : ''}${Math.round(value).toLocaleString()}`
const index = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toFixed(2)
const indexClass = (value: number | null | undefined) =>
  value === null || value === undefined
    ? 'text-muted-foreground'
    : value < 0.9
      ? 'text-destructive font-medium'
      : value < 1
        ? 'text-amber-600'
        : 'text-emerald-600'
const healthClass = (score: number | null | undefined) =>
  score === null || score === undefined
    ? 'bg-muted text-muted-foreground'
    : score >= 80
      ? 'bg-emerald-600 text-white'
      : score >= 60
        ? 'bg-amber-500 text-white'
        : 'bg-red-600 text-white'

const sortValue = (row: PortfolioRow, key: SortKey): number | string => {
  const snapshot = row.snapshot
  switch (key) {
    case 'name':
      return row.name.toLowerCase()
    case 'health':
      return snapshot?.overallScore ?? -1
    case 'spi':
      return snapshot?.spi ?? -1
    case 'cpi':
      return snapshot?.cpi ?? -1
    case 'cash':
      return snapshot?.cashNet90 ?? Number.NEGATIVE_INFINITY
    case 'open':
      return snapshot?.openItems ?? -1
    case 'overdue':
      return snapshot?.overdueItems ?? -1
    case 'contract':
      return row.contractValue
    default:
      return 0
  }
}

/** Portfolio (OCTA-RPT-BUILDER-023): every project's health, EV, cash and open items on one page from snapshots. */
export function PortfolioPage() {
  const [sortKey, setSortKey] = useState<SortKey>('health')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const { data, isLoading, refetch } = usePortfolio()
  const refresh = useRefreshPortfolio()
  const canExport = useCanPerform('portfolio', 'export')
  const rows = useMemo(() => {
    const items = [...(data?.rows ?? [])]
    items.sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      const cmp =
        typeof av === 'string' && typeof bv === 'string'
          ? av.localeCompare(bv)
          : Number(av) - Number(bv)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return items
  }, [data, sortKey, sortDir])
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDir(
        key === 'name'
          ? 'asc'
          : key === 'health' || key === 'spi' || key === 'cpi'
            ? 'asc'
            : 'desc'
      )
    }
  }
  const summary = data?.summary
  const header = (
    key: SortKey,
    label: string,
    align: 'left' | 'right' = 'left'
  ) => (
    <th className={cn('p-2', align === 'right' ? 'text-right' : 'text-left')}>
      <button
        type='button'
        className='inline-flex items-center gap-1 font-medium hover:underline'
        onClick={() => toggleSort(key)}
      >
        {label}
        <ArrowUpDown
          className={cn(
            'h-3 w-3',
            sortKey === key ? 'opacity-100' : 'opacity-30'
          )}
        />
      </button>
    </th>
  )

  return (
    <Main>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            Portfolio
          </h1>
          <p className='text-muted-foreground'>
            Health, earned value, cash and open items for every project you can
            see — computed in the background so the page stays quick.
          </p>
        </div>
        <div className='flex gap-2'>
          {canExport && (
            <Button
              variant='outline'
              onClick={() =>
                downloadPortfolioXlsx().catch((error) =>
                  toast.error(getServerErrorMessage(error))
                )
              }
              data-testid='uat-portfolio-export'
            >
              <Download className='mr-1 h-4 w-4' /> XLSX
            </Button>
          )}
          <Button
            variant='outline'
            disabled={refresh.isPending || data?.refreshing}
            data-testid='uat-portfolio-refresh'
            onClick={async () => {
              try {
                const result = await refresh.mutateAsync()
                toast.success(
                  result.queued
                    ? 'Refresh queued — numbers update in a minute'
                    : 'A refresh is already running'
                )
                refetch()
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {refresh.isPending || data?.refreshing ? (
              <Loader2 className='mr-1 h-4 w-4 animate-spin' />
            ) : (
              <RefreshCw className='mr-1 h-4 w-4' />
            )}
            {data?.refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>
      <Separator className='my-4' />
      {summary && (
        <div
          className='mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8'
          data-testid='uat-portfolio-summary'
        >
          {[
            ['Projects', `${summary.active} active / ${summary.projects}`],
            ['Contract value', money(summary.contractValue)],
            [
              'Average health',
              summary.averageHealth === null
                ? '—'
                : String(summary.averageHealth),
            ],
            ['At risk (< 60)', String(summary.atRisk)],
            ['SPI watch', String(summary.spiWatch)],
            ['CPI watch', String(summary.cpiWatch)],
            ['Open items', summary.openItems.toLocaleString()],
            ['Overdue', summary.overdueItems.toLocaleString()],
          ].map(([label, value]) => (
            <div key={label} className='rounded-md border p-2'>
              <p className='text-[10px] tracking-wide text-muted-foreground uppercase'>
                {label}
              </p>
              <p className='text-lg font-semibold tabular-nums'>{value}</p>
            </div>
          ))}
        </div>
      )}
      <p className='mb-2 text-xs text-muted-foreground'>
        {data?.computedAt
          ? `Snapshots computed ${new Date(data.computedAt).toLocaleString()}`
          : 'No snapshots yet — press Refresh.'}
        {summary?.staleCount
          ? ` · ${summary.staleCount} project${summary.staleCount === 1 ? '' : 's'} older than two hours`
          : ''}
      </p>
      {isLoading ? (
        <p className='py-6 text-center text-sm text-muted-foreground'>
          Loading…
        </p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm' data-testid='uat-portfolio-table'>
            <thead className='bg-muted/40 text-xs'>
              <tr>
                {header('name', 'Project')}
                {header('health', 'Health')}
                <th className='p-2 text-left'>Weakest</th>
                {header('spi', 'SPI', 'right')}
                {header('cpi', 'CPI', 'right')}
                <th className='p-2 text-right'>EV / PV</th>
                <th className='p-2 text-right'>AC / EAC</th>
                {header('cash', 'Cash net 90d', 'right')}
                <th className='p-2 text-right'>RFIs</th>
                <th className='p-2 text-right'>Punch</th>
                <th className='p-2 text-right'>NCRs</th>
                <th className='p-2 text-right'>Submittals</th>
                <th className='p-2 text-right'>Tasks</th>
                {header('overdue', 'Overdue', 'right')}
                <th className='p-2 text-right'>COs pending</th>
                <th className='p-2 text-right'>Delayed</th>
                {header('contract', 'Contract', 'right')}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const s = row.snapshot
                return (
                  <tr
                    key={row.id}
                    className={cn('border-t', row.stale && 'opacity-80')}
                    data-testid='uat-portfolio-row'
                  >
                    <td className='p-2'>
                      <Link
                        to='/projects/$projectId/$module'
                        params={{ projectId: row.id, module: 'overview' }}
                        className='font-medium hover:underline'
                      >
                        {row.name}
                      </Link>
                      <div className='text-xs text-muted-foreground'>
                        {row.client ?? '—'} · {row.status}
                        {row.stale && ' · stale'}
                      </div>
                    </td>
                    <td className='p-2'>
                      <Badge className={healthClass(s?.overallScore)}>
                        {s?.overallScore ?? '—'}
                      </Badge>
                    </td>
                    <td className='p-2 text-xs'>
                      {s?.weakestDimension ?? '—'}
                    </td>
                    <td
                      className={cn(
                        'p-2 text-right tabular-nums',
                        indexClass(s?.spi)
                      )}
                    >
                      {index(s?.spi)}
                    </td>
                    <td
                      className={cn(
                        'p-2 text-right tabular-nums',
                        indexClass(s?.cpi)
                      )}
                    >
                      {index(s?.cpi)}
                    </td>
                    <td className='p-2 text-right text-xs tabular-nums'>
                      {money(s?.ev)} / {money(s?.pv)}
                    </td>
                    <td className='p-2 text-right text-xs tabular-nums'>
                      {money(s?.ac)} / {money(s?.eac)}
                    </td>
                    <td
                      className={cn(
                        'p-2 text-right tabular-nums',
                        (s?.cashNet90 ?? 0) < 0 && 'text-destructive'
                      )}
                    >
                      {money(s?.cashNet90, row.currency)}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {s?.openRfis ?? '—'}
                      {s?.overdueRfis ? (
                        <span className='text-destructive'>
                          {' '}
                          ({s.overdueRfis})
                        </span>
                      ) : null}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {s?.openPunch ?? '—'}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {s?.openNcrs ?? '—'}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {s?.pendingSubmittals ?? '—'}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {s?.openTasks ?? '—'}
                    </td>
                    <td
                      className={cn(
                        'p-2 text-right tabular-nums',
                        (s?.overdueItems ?? 0) > 0 &&
                          'font-medium text-destructive'
                      )}
                    >
                      {s?.overdueItems ?? '—'}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {s?.pendingChangeOrders ?? '—'}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {s?.delayedActivities ?? '—'}
                    </td>
                    <td className='p-2 text-right tabular-nums'>
                      {money(row.contractValue, row.currency)}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={17}
                    className='p-6 text-center text-sm text-muted-foreground'
                  >
                    No projects to show.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Main>
  )
}
