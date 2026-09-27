import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
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
import type {
  ProjectSetupReadiness,
  ProjectSetupTarget,
} from '@/features/projects/data/schema'
import { useProjectSetupReadiness } from '@/features/projects/hooks/use-projects'
import { formatLongDate } from '@/lib/dates'
import { evCutoffNote, formatEvCutoff } from '@/lib/ev-cutoff'

interface Props {
  projectId: string
  readiness?: ProjectSetupReadiness
  onNavigate?: (target: ProjectSetupTarget) => void
}

type ReportingPeriod = {
  id: string | null
  code: string
  label: string
  cutoffDate: string
  /** The cutoff's calendar date in the project's reporting time zone. */
  cutoffLocalDate?: string | null
  status: string
  /** A locked period's stored EV figures (GET /reports/periods). */
  snapshot?: { ev?: number | string | null; lockedAt?: string | null } | null
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
    cutoffLocalDate?: string | null
    timeZone?: string | null
    timeZoneSource?: string | null
    timeZoneNote?: string | null
    isSnapshot?: boolean
  }
  sourceSummary?: {
    pv?: { approvedRows?: number }
    ac?: { officialActualActivities?: number }
  }
  basisWarnings?: string[]
  readinessGate?: ProjectSetupReadiness['gates']['reporting'] | null
  officialDataInputs?: Array<{
    key: string
    label: string
    source: string
    requiredStatus: string
    appliedAmount?: number
    appliedCount?: number
  }>
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

// The S-curve's months are labelled "Aug 26" (the server's month labels).
const monthLabel = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(value))

const monthOrder = (label: string) => {
  const parsed = Date.parse(`1 ${label.replace(/(\d{2})$/, '20$1')}`)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

type SCurvePoint = { label: string; pv: number | null; ev: number | null }

/**
 * The S-curve as it may be drawn (presentation only; PC-7a owns the
 * service's series). The report carries one earned value — the one at its
 * cutoff — and the service writes that figure into every month up to the
 * cutoff, which draws a history nobody measured. So EV is plotted only
 * where it was measured: at this report's cutoff, and at the cutoff of each
 * locked period whose snapshot stored its own EV. Planned value is drawn as
 * the service gives it.
 */
function shapeSCurve({
  sCurve,
  cutoffDate,
  cutoffLocalDate,
  ev,
  pv,
  periods,
}: {
  sCurve?: Record<string, string | number | null>[]
  cutoffDate?: string | null
  /** The cutoff's calendar date in the project's zone: its month is the point's. */
  cutoffLocalDate?: string | null
  ev: number | null
  pv: number | null
  periods: ReportingPeriod[]
}): { points: SCurvePoint[]; earlierMonthsWithoutEv: boolean } {
  const points: SCurvePoint[] = (sCurve || []).map((row) => ({
    label: String(row.label ?? ''),
    pv: row.pv === null || row.pv === undefined ? null : Number(row.pv),
    ev: null,
  }))
  const reportCutoff = cutoffDate ? new Date(cutoffDate).getTime() : Number.POSITIVE_INFINITY
  const measured = new Map<string, { at: number; ev: number }>()
  // A cutoff belongs to the month of its calendar date in the project's
  // zone (the instant may already be the next month in UTC).
  const record = (at: string, value: number, localDate?: string | null) => {
    const time = new Date(at).getTime()
    const label = monthLabel(localDate || at)
    const current = measured.get(label)
    if (!current || current.at <= time) measured.set(label, { at: time, ev: value })
  }
  for (const period of periods) {
    const stored = period.snapshot?.ev
    if (stored === null || stored === undefined || !period.cutoffDate) continue
    if (new Date(period.cutoffDate).getTime() > reportCutoff) continue
    record(period.cutoffDate, Number(stored), period.cutoffLocalDate)
  }
  if (cutoffDate && ev !== null && ev !== undefined) record(cutoffDate, ev, cutoffLocalDate)

  const cutoffLabel = cutoffDate ? monthLabel(cutoffLocalDate || cutoffDate) : null
  for (const [label, { ev: value }] of measured) {
    const row = points.find((point) => point.label === label)
    if (row) row.ev = value
    else points.push({ label, pv: label === cutoffLabel ? pv : null, ev: value })
  }
  points.sort((a, b) => monthOrder(a.label) - monthOrder(b.label))
  const cutoffIndex = cutoffLabel
    ? points.findIndex((point) => point.label === cutoffLabel)
    : points.length
  const earlierMonthsWithoutEv = points
    .slice(0, cutoffIndex < 0 ? points.length : cutoffIndex)
    .some((point) => point.ev === null)
  return { points, earlierMonthsWithoutEv }
}

function statusBadgeClass(status: string) {
  const normalized = status?.toLowerCase()

  if (normalized === 'complete') {
    return 'border-transparent bg-primary/15 text-primary'
  }

  if (normalized === 'in progress' || normalized === 'in_progress') {
    return 'border-transparent bg-warning-soft text-warning-foreground'
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

export function EvReport({ projectId, readiness, onNavigate }: Props) {
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const { data: fetchedReadiness } = useProjectSetupReadiness(projectId, {
    enabled: !readiness,
  })
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

  const { data, isLoading, error } = useQuery<EvReportResponse>({
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

  if (!data) {
    // A refused or failed report says so rather than leaving the tab blank.
    const status = (error as { response?: { status?: number } } | null)?.response?.status
    return (
      <p className='text-sm text-muted-foreground' data-testid='uat-ev-unavailable'>
        {status === 403
          ? 'The earned-value report is shown to people who can open the cost module.'
          : error
            ? 'The earned-value report could not be loaded.'
            : 'No earned-value data yet.'}
      </p>
    )
  }

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
    readinessGate: reportReadinessGate,
    officialDataInputs,
    estimates,
  } = data
  const selectedPeriod = reporting?.period
  const isSnapshot = Boolean(reporting?.isSnapshot)
  const readinessGate =
    reportReadinessGate ||
    readiness?.gates.reporting ||
    fetchedReadiness?.gates.reporting
  const readinessBlockers = readinessGate?.blockers ?? []
  // Shown beside the cutoff, so not repeated among the basis warnings.
  const cutoffNote = evCutoffNote(reporting)
  const otherBasisWarnings = (basisWarnings || []).filter(
    (warning: string) => warning !== cutoffNote
  )
  const curve = shapeSCurve({
    sCurve,
    cutoffDate: reporting?.cutoffDate,
    cutoffLocalDate: reporting?.cutoffLocalDate,
    ev,
    pv,
    periods,
  })

  return (
    <div className='space-y-6'>
      <div className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <p className='text-sm font-semibold'>Official EV Basis</p>
          <p className='text-xs text-muted-foreground'>
            {selectedPeriod?.label || 'Ad hoc current cutoff'} - cutoff{' '}
            {/* PV, EV and AC are all selected against this one instant: the
                end of the cutoff date in the project's time zone. */}
            <span data-testid='uat-ev-cutoff'>{formatEvCutoff(reporting)}</span>
          </p>
          {cutoffNote && (
            // The server's sentence when the project has no zone of its own.
            <p className='text-xs text-muted-foreground' data-testid='uat-ev-cutoff-zone-note'>
              {cutoffNote}
            </p>
          )}
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
                    <SelectItem
                      key={period.id || period.code}
                      value={period.id!}
                    >
                      {period.label || period.code}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {readinessGate && (
        <div
          className={[
            'rounded-lg border p-3 text-sm',
            readinessGate.ready
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200'
              : 'border-warning/40 bg-warning-soft text-warning-foreground',
          ].join(' ')}
        >
          <div className='flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'>
            <div className='min-w-0'>
              <div className='flex items-center gap-2 font-semibold'>
                {readinessGate.ready ? (
                  <CheckCircle2 className='h-4 w-4' />
                ) : (
                  <AlertTriangle className='h-4 w-4' />
                )}
                Official reporting readiness
              </div>
              <p className='mt-1 text-xs opacity-90'>{readinessGate.message}</p>
              {readinessBlockers.length > 0 && (
                <div className='mt-2 flex flex-wrap gap-2'>
                  {readinessBlockers.slice(0, 4).map((blocker) => (
                    <Button
                      key={`${blocker.stepKey}-${blocker.code}`}
                      type='button'
                      size='sm'
                      variant='outline'
                      className='h-auto min-h-8 max-w-full justify-start bg-background/70 px-2 py-1 text-xs'
                      onClick={() =>
                        blocker.target && onNavigate?.(blocker.target)
                      }
                      disabled={!blocker.target || !onNavigate}
                    >
                      <span className='truncate'>
                        {blocker.stepLabel}: {blocker.message}
                      </span>
                      {blocker.target && onNavigate && (
                        <ArrowRight className='h-3.5 w-3.5 shrink-0' />
                      )}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            {!readinessGate.ready && (
              <Badge variant='outline' className='w-fit shrink-0'>
                PM override reason required to lock
              </Badge>
            )}
          </div>
        </div>
      )}

      {otherBasisWarnings.length > 0 && (
        <div className='relative overflow-hidden rounded-lg border border-warning/40 bg-warning-soft p-3 ps-4 text-sm text-warning-foreground'>
          {otherBasisWarnings.map((warning: string) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      {(alerts.spiAlert || alerts.cpiAlert) && (
        <div className='relative overflow-hidden rounded-lg border border-error/30 bg-error-soft p-3 ps-4 text-sm text-error-foreground'>
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

      {(officialDataInputs || []).length > 0 && (
        <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
          {(officialDataInputs || []).map((input) => (
            <div key={input.key} className='rounded-lg border p-3'>
              <p className='text-xs tracking-wide text-muted-foreground uppercase'>
                {input.label}
              </p>
              <p className='mt-1 text-sm font-semibold'>{input.source}</p>
              <p className='mt-1 text-xs text-muted-foreground'>
                Status: {input.requiredStatus}
                {input.appliedAmount !== undefined
                  ? ` - ${fmt(input.appliedAmount)} applied`
                  : ''}
                {input.appliedCount !== undefined
                  ? ` - ${input.appliedCount.toLocaleString()} rows`
                  : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <MetricCard
          label='SPI'
          value={spi !== null ? spi.toFixed(2) : '—'}
          sub='EV / PV'
          color={spi !== null && spi < 0.9 ? 'text-error' : 'text-success'}
        />
        <MetricCard
          label='CPI'
          value={cpi !== null ? cpi.toFixed(2) : '—'}
          sub='EV / AC'
          color={cpi !== null && cpi < 0.9 ? 'text-error' : 'text-success'}
        />
        <MetricCard
          label='EAC'
          value={fmt(eac)}
          sub={cpi === null ? 'The budget — no cost performance yet' : 'Revised budget / CPI'}
        />
        <MetricCard label='ETC' value={fmt(etc)} sub='EAC - AC' />
      </div>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <MetricCard
          label='Schedule Variance (SV)'
          value={fmt(sv)}
          sub='EV - PV'
          color={sv >= 0 ? 'text-success' : 'text-error'}
        />
        <MetricCard
          label='Cost Variance (CV)'
          value={fmt(cv)}
          sub='EV - AC'
          color={cv >= 0 ? 'text-success' : 'text-error'}
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

      <div
        className='rounded-lg border p-4'
        data-testid='uat-ev-scurve'
        data-ev-points={JSON.stringify(
          curve.points
            .filter((point) => point.ev !== null)
            .map((point) => [point.label, point.ev])
        )}
      >
        <h3 className='mb-3 font-semibold'>S-Curve (Cumulative)</h3>
        {curve.earlierMonthsWithoutEv && (
          <p
            className='mb-2 text-xs text-muted-foreground'
            data-testid='uat-ev-scurve-history-note'
          >
            EV history is only available for locked periods; earlier months are
            not shown. EV is plotted at this report's cutoff and at each locked
            period's cutoff.
          </p>
        )}
        <ResponsiveContainer width='100%' height={300}>
          <ComposedChart data={curve.points}>
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
              // A measured point may stand alone (one cutoff): it is drawn.
              dot={{ r: 3 }}
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
                      ? formatLongDate(row.officialActualThroughDate)
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
