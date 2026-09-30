import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  capitalise,
  eacBasisFrom,
  eacBasisLabel,
  eacIsBudgetFallback,
  type EacBasis,
} from '@/lib/eac-basis'
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
import { FINANCIAL_TERMS } from '@/lib/financial-terms'
import { TruthBadge } from '@/features/cost/components/truth-badge'

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
  snapshot?: {
    ev?: number | string | null
    pv?: number | string | null
    lockedAt?: string | null
  } | null
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

/**
 * One locked reporting period's EV point (PC-7a item 3): its snapshot as
 * stored at the lock — the figures, and the cutoff instant, date and zone
 * recorded then. Never recomputed; an open period has none.
 */
type EvHistoryPoint = {
  periodId: string
  code: string
  label: string
  cutoffDate: string
  cutoffLocalDate?: string | null
  timeZone?: string | null
  timeZoneSource?: string | null
  timeZoneNote?: string | null
  totalBudget?: number | null
  pv: number
  ev: number
  ac: number
  eac?: number | null
  spi?: number | null
  cpi?: number | null
  lockedAt?: string | null
}

type EvReportResponse = {
  pv: number | null
  ev: number | null
  ac: number | null
  spi: number | null
  cpi: number | null
  eac: number | null
  /** Which rule gave the EAC (backend utils/eac-basis); absent on old reports. */
  eacBasis?: EacBasis | null
  sv: number
  cv: number
  etc: number | null
  totalBudget: number | null
  /**
   * Source / derived / projection per figure (PC-7a three truths): PV, EV,
   * AC and the BAC are derived, the EAC a projection whose rule is eacBasis.
   * Labels only; absent on reports from before PC-7a.
   */
  truth?: {
    pv?: string
    ev?: string
    ac?: string
    totalBudget?: string
    eac?: string
    etc?: string
    labels?: { totalBudget?: string }
    derivedFrom?: Record<string, string>
  }
  sCurve?: Record<string, string | number | null>[]
  /**
   * The locked periods cut on or before this report's cutoff, earliest
   * first (GET /reports/ev only; absent from reports before PC-7a).
   */
  history?: EvHistoryPoint[]
  historyNote?: string
  historyTruth?: {
    pv?: string
    ev?: string
    ac?: string
    eac?: string
    derivedFrom?: Record<string, string>
  }
  activityBreakdown?: EvActivityBreakdownRow[]
  // Withheld by the server from a member who may not read the BOQ, cost
  // readers included (owner decision E1): each row's budget is the
  // activity's approved allocation and the rows are ordered by it.
  activityBreakdownWithheld?: true
  activityBreakdownReason?: string
  alerts: {
    spiAlert?: boolean
    cpiAlert?: boolean
  }
  reporting?: {
    period?:
      | (Pick<ReportingPeriod, 'label' | 'code'> & {
          id?: string | null
          isVirtual?: boolean
        })
      | null
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

/** The period picker's entry for the server's default basis (D4). */
const DEFAULT_PERIOD = '__default__'

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
 * the service gives it — the plan through each month's last date — except at
 * a measured point, where it is the PV measured at that same cutoff (the
 * locked snapshot's stored PV, or this report's PV): a period cut on the
 * 15th is never drawn against the plan through the 31st.
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
}): {
  points: SCurvePoint[]
  earlierMonthsWithoutEv: boolean
  /** The months whose PV is the PV at the measured cutoff. */
  measuredLabels: string[]
} {
  const points: SCurvePoint[] = (sCurve || []).map((row) => ({
    label: String(row.label ?? ''),
    pv: row.pv === null || row.pv === undefined ? null : Number(row.pv),
    ev: null,
  }))
  const reportCutoff = cutoffDate ? new Date(cutoffDate).getTime() : Number.POSITIVE_INFINITY
  const measured = new Map<string, { at: number; ev: number; pv: number | null }>()
  // A cutoff belongs to the month of its calendar date in the project's
  // zone (the instant may already be the next month in UTC).
  const record = (
    at: string,
    value: number,
    plannedAtCutoff: number | null,
    localDate?: string | null
  ) => {
    const time = new Date(at).getTime()
    const label = monthLabel(localDate || at)
    const current = measured.get(label)
    if (!current || current.at <= time) {
      measured.set(label, { at: time, ev: value, pv: plannedAtCutoff })
    }
  }
  for (const period of periods) {
    const stored = period.snapshot?.ev
    if (stored === null || stored === undefined || !period.cutoffDate) continue
    if (new Date(period.cutoffDate).getTime() > reportCutoff) continue
    const storedPv = period.snapshot?.pv
    record(
      period.cutoffDate,
      Number(stored),
      storedPv === null || storedPv === undefined ? null : Number(storedPv),
      period.cutoffLocalDate
    )
  }
  if (cutoffDate && ev !== null && ev !== undefined) {
    record(cutoffDate, ev, pv ?? null, cutoffLocalDate)
  }

  const measuredLabels: string[] = []
  for (const [label, { ev: value, pv: plannedAtCutoff }] of measured) {
    const row = points.find((point) => point.label === label)
    if (row) {
      row.ev = value
      // EV against the PV at the same cutoff, like for like.
      if (plannedAtCutoff !== null) {
        row.pv = plannedAtCutoff
        measuredLabels.push(label)
      }
    } else {
      points.push({ label, pv: plannedAtCutoff, ev: value })
      if (plannedAtCutoff !== null) measuredLabels.push(label)
    }
  }
  const cutoffLabel = cutoffDate ? monthLabel(cutoffLocalDate || cutoffDate) : null
  points.sort((a, b) => monthOrder(a.label) - monthOrder(b.label))
  const cutoffIndex = cutoffLabel
    ? points.findIndex((point) => point.label === cutoffLabel)
    : points.length
  const earlierMonthsWithoutEv = points
    .slice(0, cutoffIndex < 0 ? points.length : cutoffIndex)
    .some((point) => point.ev === null)
  return { points, earlierMonthsWithoutEv, measuredLabels }
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
  testId,
  truth,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  testId?: string
  /** The server's truth label: source, derived or projection:<basis> (PC-7a). */
  truth?: string
}) {
  return (
    <div className='rounded-lg border p-3 text-center' data-testid={testId}>
      <p className='text-xs text-muted-foreground'>
        {label}
        <TruthBadge truth={truth} />
      </p>
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

  // No period chosen: the server's default basis (owner decision D4) — the
  // latest period whose cutoff has passed, else an ad hoc report cut at
  // today — the same basis the Overview and the Forecast tab read. A period
  // whose cutoff is still ahead is only ever chosen here, explicitly.
  const { data, isLoading, error } = useQuery<EvReportResponse>({
    queryKey: ['ev-report', projectId, selectedPeriodId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/reports/ev`, {
          params: selectedPeriodId ? { periodId: selectedPeriodId } : {},
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
    eacBasis: reportedEacBasis,
    sv,
    cv,
    etc,
    totalBudget,
    truth,
    sCurve,
    history,
    historyNote,
    historyTruth,
    activityBreakdown,
    activityBreakdownWithheld,
    activityBreakdownReason,
    alerts,
    reporting,
    sourceSummary,
    basisWarnings,
    readinessGate: reportReadinessGate,
    officialDataInputs,
    estimates,
  } = data
  const selectedPeriod = reporting?.period
  // The picker shows the period the report was cut for: the one chosen, or
  // the stored period the server defaulted to; an ad hoc default reads as
  // the default entry.
  const periodSelectValue =
    selectedPeriodId ||
    (selectedPeriod && !selectedPeriod.isVirtual && selectedPeriod.id) ||
    DEFAULT_PERIOD
  const isSnapshot = Boolean(reporting?.isSnapshot)
  // The EAC's rule in the words the Overview and the Forecast tab use for the
  // same figure (lib/eac-basis): the server's basis, or for a report without
  // one the server's own rule — CPI > 0 is budget ÷ CPI, CPI 0 or none is
  // the budget handed back.
  const eacBasis = eacBasisFrom(reportedEacBasis, cpi, totalBudget)
  const eacSub = capitalise(eacBasisLabel(eacBasis) ?? 'no approved budget yet')
  // No approved budget: there is no EAC (the report's 0 is the formula's
  // fallback, not an estimate) and so no ETC — shown as dashes, as the
  // Overview and the Forecast tab show them.
  const noBudget = eacBasis === 'no_budget'
  // The EAC is the revised budget handed back (no CPI, or CPI 0): ETC would
  // be budget less spend — negative once spend passes the budget — not an
  // estimate to complete. Shown as a dash with the reason, as CV and SV are
  // when they mean nothing; the report's etc is unchanged.
  const etcNotProjected = eacIsBudgetFallback(eacBasis)
  const etcSub = noBudget
    ? 'No EAC without an approved budget'
    : eacBasis === 'budget_cpi_zero'
      ? 'Not projected — the EAC is the budget, nothing earned against the cost spent (CPI 0)'
      : etcNotProjected
        ? 'Not projected — the EAC is the budget, no cost performance yet'
        : 'EAC - AC'
  // A variance needs both sides: CV with no official actual cost is EV less
  // nothing, and SV with no planned value is EV less nothing.
  const officialActualRows = sourceSummary?.ac?.officialActualActivities
  const noActuals = officialActualRows === 0 || (officialActualRows === undefined && !ac)
  const noPlannedValue = !pv
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
  // The measured EV points come from the report's own history when the
  // server gives one (the locked snapshots through this cutoff, as stored);
  // an older server's report falls back to the period list's snapshots.
  const lockedHistory = history ?? null
  const measuredPeriods: ReportingPeriod[] = lockedHistory
    ? lockedHistory.map((point) => ({
        id: point.periodId,
        code: point.code,
        label: point.label,
        cutoffDate: point.cutoffDate,
        cutoffLocalDate: point.cutoffLocalDate,
        status: 'locked',
        snapshot: { ev: point.ev, pv: point.pv, lockedAt: point.lockedAt },
      }))
    : periods
  const curve = shapeSCurve({
    sCurve,
    cutoffDate: reporting?.cutoffDate,
    cutoffLocalDate: reporting?.cutoffLocalDate,
    ev,
    pv,
    periods: measuredPeriods,
  })
  // Each history point is labelled by its reporting date (the date recorded
  // at the lock), so two periods in one month stay two points.
  const historyRows = (lockedHistory || []).map((point) => ({
    ...point,
    at: point.cutoffLocalDate || point.cutoffDate.slice(0, 10),
  }))

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
              value={periodSelectValue}
              onValueChange={(value) =>
                setSelectedPeriodId(value === DEFAULT_PERIOD ? null : value)
              }
            >
              <SelectTrigger className='w-[220px]' data-testid='uat-ev-period-select'>
                <SelectValue placeholder='Select period' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_PERIOD}>
                  Default: latest cutoff passed
                </SelectItem>
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
        <MetricCard
          label={
            truth?.labels?.totalBudget ??
            FINANCIAL_TERMS.evBudgetAtCompletion.label
          }
          value={fmt(totalBudget)}
          sub={FINANCIAL_TERMS.evBudgetAtCompletion.hint}
          truth={truth?.totalBudget}
          testId='uat-ev-bac'
        />
        <MetricCard
          label='Planned Value (PV)'
          value={fmt(pv)}
          truth={truth?.pv}
          sub={`${sourceSummary?.pv?.approvedRows ?? 0} approved load rows`}
        />
        <MetricCard
          label='Earned Value (EV)'
          value={fmt(ev)}
          truth={truth?.ev}
          color='text-blue-600'
        />
        <MetricCard
          label='Actual Cost (AC)'
          value={fmt(ac)}
          truth={truth?.ac}
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
          color={spi === null ? '' : spi < 0.9 ? 'text-error' : 'text-success'}
          testId='uat-ev-spi'
        />
        <MetricCard
          label='CPI'
          value={cpi !== null ? cpi.toFixed(2) : '—'}
          sub='EV / AC'
          color={cpi === null ? '' : cpi < 0.9 ? 'text-error' : 'text-success'}
        />
        <MetricCard
          label='EAC'
          value={noBudget ? '—' : fmt(eac)}
          truth={truth?.eac}
          sub={eacSub}
          testId='uat-ev-eac'
        />
        <MetricCard
          label='ETC'
          value={noBudget || etcNotProjected ? '—' : fmt(etc)}
          truth={truth?.etc}
          sub={etcSub}
          testId='uat-ev-etc'
        />
      </div>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <MetricCard
          label='Schedule Variance (SV)'
          value={noPlannedValue ? '—' : fmt(sv)}
          sub={noPlannedValue ? 'No planned value through the cutoff — SV not meaningful' : 'EV - PV'}
          color={noPlannedValue ? '' : sv >= 0 ? 'text-success' : 'text-error'}
          testId='uat-ev-sv'
        />
        <MetricCard
          label='Cost Variance (CV)'
          value={noActuals ? '—' : fmt(cv)}
          sub={noActuals ? 'No actual cost recorded — CV not meaningful' : 'EV - AC'}
          color={noActuals ? '' : cv >= 0 ? 'text-success' : 'text-error'}
          testId='uat-ev-cv'
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
        data-pv-at-ev-points={JSON.stringify(
          curve.points
            .filter((point) => point.ev !== null)
            .map((point) => [point.label, point.pv])
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
        {curve.measuredLabels.length > 0 && (
          <p
            className='mb-2 text-xs text-muted-foreground'
            data-testid='uat-ev-scurve-pv-note'
          >
            Where EV is plotted, PV is the planned value at that same cutoff,
            so the two compare like for like; elsewhere PV is the plan through
            the month's last date.
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

      {lockedHistory && (
        // Beside the formula S-curve: what each locked period measured, as
        // stored at its lock. Only locked periods have a point — none is
        // drawn for an open month.
        <div
          className='rounded-lg border p-4'
          data-testid='uat-ev-history'
          data-history-points={JSON.stringify(
            historyRows.map((point) => [point.code, point.at, point.pv, point.ev, point.ac])
          )}
        >
          <h3 className='mb-1 font-semibold'>
            Locked-period history
            <TruthBadge truth={historyTruth?.ev ?? 'derived'} />
          </h3>
          <p className='mb-3 text-xs text-muted-foreground' data-testid='uat-ev-history-note'>
            {historyNote ??
              'Each point is a locked reporting period as stored at its lock; nothing is recomputed or filled in between periods.'}
          </p>
          {historyRows.length === 0 ? (
            <p className='text-sm text-muted-foreground' data-testid='uat-ev-history-empty'>
              No reporting period is locked on or before this cutoff yet. Lock a
              period (above) to record its PV, EV and AC as a history point.
            </p>
          ) : (
            <>
              <ResponsiveContainer width='100%' height={260}>
                <ComposedChart data={historyRows}>
                  <CartesianGrid strokeDasharray='3 3' />
                  <XAxis dataKey='at' tick={{ fontSize: 11 }} />
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
                  <Line type='linear' dataKey='pv' name='PV at lock' stroke='#6366f1' strokeWidth={2} dot={{ r: 3 }} />
                  <Line type='linear' dataKey='ev' name='EV at lock' stroke='#22c55e' strokeWidth={2} dot={{ r: 3 }} />
                  <Line type='linear' dataKey='ac' name='AC at lock' stroke='#f97316' strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className='mt-3 overflow-x-auto rounded-lg border'>
                <Table>
                  <TableHeader className='bg-muted/50'>
                    <TableRow>
                      {['Period', 'Cutoff', 'PV', 'EV', 'AC', 'EAC at lock', 'SPI', 'CPI'].map((h) => (
                        <TableHead key={h} className='px-3'>
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyRows.map((point) => (
                      <TableRow key={point.periodId}>
                        <TableCell className='px-3'>
                          {/* Opens that period's stored report in this tab. */}
                          <Button
                            variant='link'
                            size='sm'
                            className='h-auto p-0'
                            onClick={() => setSelectedPeriodId(point.periodId)}
                          >
                            {point.label}
                          </Button>
                        </TableCell>
                        <TableCell className='px-3 text-xs'>
                          {formatEvCutoff(point)}
                          {point.timeZoneNote && (
                            <span className='block text-muted-foreground'>{point.timeZoneNote}</span>
                          )}
                        </TableCell>
                        <TableCell className='px-3'>{fmt(point.pv)}</TableCell>
                        <TableCell className='px-3'>{fmt(point.ev)}</TableCell>
                        <TableCell className='px-3'>{fmt(point.ac)}</TableCell>
                        <TableCell className='px-3'>
                          {fmt(point.eac ?? null)}
                          <TruthBadge truth={historyTruth?.eac} />
                        </TableCell>
                        <TableCell className='px-3'>
                          {point.spi === null || point.spi === undefined ? '—' : point.spi.toFixed(2)}
                        </TableCell>
                        <TableCell className='px-3'>
                          {point.cpi === null || point.cpi === undefined ? '—' : point.cpi.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      )}

      <div>
        <h3 className='mb-2 font-semibold'>Top Activities by Budget</h3>
        {activityBreakdownWithheld ? (
          // Withheld by the server (owner decision E1): which activities
          // carry the budget is read off the BOQ mapping. A dash and the
          // reason — never an empty table that reads as "none".
          <p
            className='text-sm text-muted-foreground'
            data-testid='uat-ev-activity-breakdown-withheld'
          >
            — {activityBreakdownReason ?? 'Mapping details unavailable to you'}
          </p>
        ) : (
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
        )}
      </div>
    </div>
  )
}
