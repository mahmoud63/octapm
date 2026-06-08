import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Props {
  projectId: string
}

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  const abs = Math.abs(value)
  const prefix = value < 0 ? '-$' : '$'

  if (abs >= 1000000) return `${prefix}${(abs / 1000000).toFixed(2)}M`
  if (abs >= 1000) return `${prefix}${(abs / 1000).toFixed(1)}K`
  return `${prefix}${abs.toFixed(0)}`
}

function statusBadgeClass(status: string) {
  const normalized = status?.toLowerCase()

  if (normalized === 'complete') {
    return 'border-transparent bg-primary/15 text-primary'
  }

  if (normalized === 'in progress' || normalized === 'in_progress') {
    return 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300'
  }

  if (normalized === 'delayed') {
    return 'border-transparent bg-destructive/15 text-destructive'
  }

  return 'border-transparent bg-muted text-muted-foreground'
}

function MetricCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className='rounded-lg border p-3 text-center'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className={`mt-1 text-xl font-bold ${color || ''}`}>{value}</p>
      {sub && <p className='text-xs text-muted-foreground'>{sub}</p>}
    </div>
  )
}

export function EvReport({ projectId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['ev-report', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/reports/ev`)
        .then((r) => r.data.data),
    refetchInterval: 60000,
  })

  if (isLoading) {
    return <p className='text-sm text-muted-foreground'>Loading EV data...</p>
  }

  if (!data) return null

  const {
    pv,
    ev,
    ac,
    spi,
    cpi,
    eac,
    sv,
    cv,
    etc,
    totalBudget,
    sCurve,
    activityBreakdown,
    alerts,
  } = data

  return (
    <div className='space-y-6'>
      {(alerts.spiAlert || alerts.cpiAlert) && (
        <div className='rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700'>
          Alert:{' '}
          {alerts.spiAlert &&
            `SPI ${spi?.toFixed(2)} < 0.9 (schedule slippage). `}
          {alerts.cpiAlert && `CPI ${cpi?.toFixed(2)} < 0.9 (cost overrun).`}
        </div>
      )}

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <MetricCard label='Total Budget (BAC)' value={fmt(totalBudget)} />
        <MetricCard label='Planned Value (PV)' value={fmt(pv)} />
        <MetricCard
          label='Earned Value (EV)'
          value={fmt(ev)}
          color='text-blue-600'
        />
        <MetricCard
          label='Actual Cost (AC)'
          value={fmt(ac)}
          color='text-orange-600'
        />
      </div>

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <MetricCard
          label='SPI'
          value={spi !== null ? spi.toFixed(2) : '—'}
          sub='EV / PV'
          color={spi !== null && spi < 0.9 ? 'text-red-600' : 'text-green-600'}
        />
        <MetricCard
          label='CPI'
          value={cpi !== null ? cpi.toFixed(2) : '—'}
          sub='EV / AC'
          color={cpi !== null && cpi < 0.9 ? 'text-red-600' : 'text-green-600'}
        />
        <MetricCard label='EAC' value={fmt(eac)} sub='Budget / CPI' />
        <MetricCard label='ETC' value={fmt(etc)} sub='EAC - AC' />
      </div>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <MetricCard
          label='Schedule Variance (SV)'
          value={fmt(sv)}
          sub='EV - PV'
          color={sv >= 0 ? 'text-green-600' : 'text-red-600'}
        />
        <MetricCard
          label='Cost Variance (CV)'
          value={fmt(cv)}
          sub='EV - AC'
          color={cv >= 0 ? 'text-green-600' : 'text-red-600'}
        />
      </div>

      <div className='rounded-lg border p-4'>
        <h3 className='mb-3 font-semibold'>S-Curve (Cumulative)</h3>
        <ResponsiveContainer width='100%' height={300}>
          <ComposedChart data={sCurve || []}>
            <CartesianGrid strokeDasharray='3 3' />
            <XAxis dataKey='label' tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => fmt(Number(v))}
            />
            <Tooltip
              formatter={(value) =>
                fmt(typeof value === 'number' ? value : Number(value) || 0)
              }
            />
            <Legend />
            <Line
              type='monotone'
              dataKey='pv'
              name='PV (Planned)'
              stroke='#6366f1'
              strokeWidth={2}
              dot={false}
            />
            <Line
              type='monotone'
              dataKey='ev'
              name='EV (Earned)'
              stroke='#22c55e'
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className='mb-2 font-semibold'>Top Activities by Budget</h3>
        <div className='rounded-lg border'>
          <Table>
            <TableHeader className='bg-muted/50'>
              <TableRow>
                {[
                  'ID',
                  'Name',
                  'Budget',
                  'EV',
                  'AC',
                  '%',
                  'Status',
                  'Critical',
                ].map((h) => (
                  <TableHead key={h} className='px-3'>
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {(activityBreakdown || []).map((row: any) => (
                <TableRow
                  key={row.activityId}
                  className={
                    row.isCritical
                      ? 'bg-destructive/10 hover:bg-destructive/15'
                      : ''
                  }
                >
                  <TableCell className='px-3 font-mono text-xs'>
                    {row.activityId}
                  </TableCell>
                  <TableCell className='max-w-[220px] truncate px-3'>
                    {row.name}
                  </TableCell>
                  <TableCell className='px-3'>{fmt(row.budget)}</TableCell>
                  <TableCell className='px-3 text-primary'>
                    {fmt(row.ev)}
                  </TableCell>
                  <TableCell className='px-3 text-muted-foreground'>
                    {fmt(row.ac)}
                  </TableCell>
                  <TableCell className='px-3'>{row.pct}%</TableCell>
                  <TableCell className='px-3'>
                    <Badge
                      variant='outline'
                      className={statusBadgeClass(row.status)}
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className='px-3'>
                    {row.isCritical ? (
                      <Badge variant='destructive'>Yes</Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
