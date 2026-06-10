import { useMemo, useState } from 'react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

type ReportingPeriod = {
  id: string | null
  code: string
  label: string
  cutoffDate: string
  status: string
}

type EvActivityBreakdownRow = {
  activityId: string
  name: string
  budget: number | null
  pv: number | null
  ev: number | null
  ac: number | null
  actualCostSource?: string | null
  officialActualThroughDate?: string | null
  pct: number
  status: string
  isCritical?: boolean
}

type EvReportResponse = {
  pv: number | null
  ev: number | null
  ac: number | null
  spi: number | null
  cpi: number | null
  eac: number | null
  sv: number
  cv: number
  etc: number | null
  totalBudget: number | null
  sCurve?: Record<string, string | number | null>[]
  activityBreakdown?: EvActivityBreakdownRow[]
  alerts: {
    spiAlert?: boolean
    cpiAlert?: boolean
  }
  reporting?: {
    period?: Pick<ReportingPeriod, 'label' | 'code'> | null
    cutoffDate?: string | null
    isSnapshot?: boolean
  }
  sourceSummary?: {
    pv?: { approvedRows?: number }
    ac?: { officialActualActivities?: number }
  }
  basisWarnings?: string[]
  estimates?: {
    estimatedPv?: number | null
    estimatedAc?: number | null
  }
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
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const { data: periodData } = useQuery<{ periods?: ReportingPeriod[] }>({
    queryKey: ['ev-report-periods', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/reports/periods`)
        .then((r) => r.data.data),
  })
  const periods: ReportingPeriod[] = useMemo(
    () => periodData?.periods || [],
    [periodData]
  )

  const effectivePeriodId = selectedPeriodId || periods[0]?.id || null

  const { data, isLoading } = useQuery<EvReportResponse>({
    queryKey: ['ev-report', projectId, effectivePeriodId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/reports/ev`, {
          params: effectivePeriodId ? { periodId: effectivePeriodId } : {},
        })
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
    reporting,
    sourceSummary,
    basisWarnings,
    estimates,
  } = data
  const selectedPeriod = reporting?.period
  const isSnapshot = Boolean(reporting?.isSnapshot)

  return (
    <div className='space-y-6'>
      <div className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <p className='text-sm font-semibold'>Official EV Basis</p>
          <p className='text-xs text-muted-foreground'>
            {selectedPeriod?.label || 'Ad hoc current cutoff'} - cutoff{' '}
            {reporting?.cutoffDate
              ? new Date(reporting.cutoffDate).toLocaleDateString()
              : '-'}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant={isSnapshot ? 'default' : 'secondary'}>
            {isSnapshot ? 'Locked snapshot' : 'Open calculation'}
          </Badge>
          {periods.length > 0 && (
            <Select
              value={effectivePeriodId || ''}
              onValueChange={(value) => setSelectedPeriodId(value)}
            >
              <SelectTrigger className='w-[220px]'>
                <SelectValue placeholder='Select period' />
              </SelectTrigger>
              <SelectContent>
                {periods
                  .filter((period) => period.id)
                  .map((period) => (
                    <SelectItem key={period.id || period.code} value={period.id!}>
                      {period.label || period.code}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {(basisWarnings || []).length > 0 && (
        <div className='rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300'>
          {(basisWarnings || []).map((warning: string) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

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
        <MetricCard
          label='Planned Value (PV)'
          value={fmt(pv)}
          sub={`${sourceSummary?.pv?.approvedRows ?? 0} approved load rows`}
        />
        <MetricCard
          label='Earned Value (EV)'
          value={fmt(ev)}
          color='text-blue-600'
        />
        <MetricCard
          label='Actual Cost (AC)'
          value={fmt(ac)}
          sub={`${sourceSummary?.ac?.officialActualActivities ?? 0} official actual rows`}
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

      {estimates && (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <MetricCard
            label='PV Estimate'
            value={fmt(estimates.estimatedPv)}
            sub='Prototype schedule guidance'
          />
          <MetricCard
            label='AC Estimate'
            value={fmt(estimates.estimatedAc)}
            sub='Excluded from official AC'
          />
        </div>
      )}

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
                  'PV',
                  'EV',
                  'AC',
                  'Actual Through',
                  'AC Source',
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
              {(activityBreakdown || []).map((row) => (
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
                  <TableCell className='px-3'>{fmt(row.pv)}</TableCell>
                  <TableCell className='px-3 text-primary'>
                    {fmt(row.ev)}
                  </TableCell>
                  <TableCell className='px-3 text-muted-foreground'>
                    {fmt(row.ac)}
                  </TableCell>
                  <TableCell className='px-3 text-xs text-muted-foreground'>
                    {row.officialActualThroughDate
                      ? new Date(
                          row.officialActualThroughDate
                        ).toLocaleDateString()
                      : '-'}
                  </TableCell>
                  <TableCell className='px-3'>
                    <Badge variant='outline' className='text-xs'>
                      {row.actualCostSource ===
                      'cost_record.actual_through_date'
                        ? 'official'
                        : 'missing'}
                    </Badge>
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
