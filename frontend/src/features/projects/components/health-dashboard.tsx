import { formatLongDate } from '@/lib/dates'
import { evCutoffNote, formatEvCutoff, formatEvCutoffDate, type EvCutoff } from '@/lib/ev-cutoff'
import { statusBadge } from '@/lib/status'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { useProjectHealth } from '../hooks/use-project-health'
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

interface Props {
  projectId: string
  /** The project's currency: the cards' money is stated in it. */
  currency?: string | null
}

type HealthRisk = {
  id: string
  item: string
  reason: string
  impactedActivity?: {
    wbsCode?: string | null
    name: string
  } | null
}

type HealthDimensionDetail = Record<string, unknown> & {
  topRisks?: HealthRisk[]
}

type HealthDimension = {
  key: string
  label: string
  score: number
  sourceRule?: {
    source?: string
    formula?: string
    officialOnly?: boolean
  }
  cutoffDate?: string | null
  /**
   * What the dimension is measured through: the EV cutoff (schedule, cost)
   * or the records as they stand today (every other dimension).
   */
  measuredThrough?: 'ev_cutoff' | 'today'
  detail?: HealthDimensionDetail
  target?: {
    module: string
    child?: string
    status?: string
    source?: string
  }
}

type HealthResponse = {
  generatedAt?: string
  dataFreshness?: {
    generatedAt?: string
    cutoffDate?: string | null
    cutoffLocalDate?: string | null
    cutoffTimeZone?: string | null
    cutoffTimeZoneSource?: string | null
    cutoffTimeZoneNote?: string | null
    /** Set when the EV cutoff is still ahead: EV and AC stop at today. */
    cutoffNotReachedNote?: string | null
    sourceUpdatedAt?: string | null
    note?: string
  }
  overallScore?: number
  dimensions?: HealthDimension[]
  pendingReview?: {
    total: number
    metrics: Array<{
      key: string
      label: string
      count: number
      source: string
      cutoffDate?: string | null
      measuredThrough?: 'ev_cutoff' | 'today'
    }>
  }
}

function scoreColor(score: number) {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#f59e0b'
  return '#ef4444'
}

/** A score the rule gave because its index does not exist yet (health.js). */
const NEUTRAL_COLOR = '#94a3b8'
const NEUTRAL_LABEL = 'No index yet (neutral 60)'

function scoreLabel(score: number) {
  if (score >= 80) return 'Good'
  if (score >= 60) return 'Fair'
  return 'Poor'
}

// A stored calendar date: render it in UTC so it does not shift a day for
// anyone west of it (lib/dates.ts). The EV cutoff is stated by
// lib/ev-cutoff.ts, in the project's time zone.
function formatDate(value?: string | null) {
  if (!value) return 'No cutoff'
  return formatLongDate(value)
}

/**
 * Metric labels written for the person reading them, not for the developer who
 * named the field. These cards previously printed raw keys — "spi: null",
 * "cpi: 0.74 · ac: 4161900" — straight at a project manager.
 */
const METRIC_LABELS: Record<string, string> = {
  spi: 'Schedule performance',
  cpi: 'Cost performance',
  ev: 'Earned value',
  pv: 'Planned value',
  ac: 'Actual cost',
  eac: 'Forecast at completion',
  unallocatedBoqAmount: 'Open BOQ value',
  // Counted today from the latest progress, not at the card's cutoff.
  delayedActivities: 'Delayed activities (as of today)',
  criticalActivities: 'Critical activities',
  approvedChangeOrders: 'Approved change orders',
  pendingChangeOrders: 'Pending change orders',
  approvedScheduleImpactDays: 'Approved delay',
  overduePOs: 'Overdue purchase orders',
  atRiskItems: 'At-risk items',
  majorNCRs: 'Major NCRs',
  minorNCRs: 'Minor NCRs',
  openNCRs: 'Open NCRs',
  failedITPs: 'Failed inspections',
  ltiCount: 'Lost-time injuries',
  fatalityCount: 'Fatalities',
  incidentCount: 'Incidents',
  overdueRfis: 'Overdue RFIs',
  pendingSubmittals: 'Pending submittals',
  overdueSubmittals: 'Overdue submittals',
}

const MONEY_KEYS = new Set([
  'ev',
  'pv',
  'ac',
  'eac',
  'budget',
  'actualCost',
  'forecast',
  'unallocatedBoqAmount',
])

/**
 * The figures a dimension states that the server leaves out for a member who
 * may read neither the BOQ nor the cost module (§12): shown as a dash with
 * the reason, never as 0.
 */
const WITHHELD_WHEN_ABSENT: Record<string, string[]> = {
  cost: ['ac', 'ev'],
}
const RATIO_KEYS = new Set(['spi', 'cpi'])

function labelForMetric(key: string) {
  if (METRIC_LABELS[key]) return METRIC_LABELS[key]
  // Fall back to a humanised version rather than the raw identifier.
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b([A-Z]{2,})\b/g, (match) => match)
    .replace(/^./, (char) => char.toUpperCase())
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/

function formatMetricValue(
  key: string,
  value: unknown,
  currency?: string | null
): string | null {
  if (value === null || value === undefined || value === '') return null
  // A list or a record (the AC source summary, the basis warnings) is not a
  // metric: printed as one it reads "[object Object]" or a run-on sentence.
  if (typeof value === 'object') return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  // A raw ISO timestamp is never something to show a project manager.
  if (typeof value === 'string' && ISO_DATE.test(value)) return formatDate(value)

  const numeric = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(numeric)) {
    if (MONEY_KEYS.has(key)) {
      // In the project's currency, as the controls strip states money; a
      // project without one gets the bare figure rather than a guessed "$".
      const amount = numeric.toLocaleString(undefined, { maximumFractionDigits: 0 })
      return currency ? `${currency} ${amount}` : amount
    }
    if (RATIO_KEYS.has(key)) return numeric.toFixed(2)
    if (/days$/i.test(key)) return `${numeric.toLocaleString()} ${numeric === 1 ? 'day' : 'days'}`
    return numeric.toLocaleString()
  }
  return String(value)
}

/**
 * The readable metrics for a dimension card, nulls dropped. The cutoff and
 * source are shown once in the provenance line, so they are not repeated here.
 */
const NON_METRIC_KEYS = new Set([
  'topRisks',
  'sourceRule',
  'cutoffDate',
  'generatedAt',
  'source',
  'sourceStatus',
  'acSource',
  'basisWarnings',
  // The server's sentences, shown as notes under the figures they explain.
  'spiNote',
  'cpiNote',
  'scoreBasis',
  'cutoffNotReachedNote',
])

type Metric = {
  key: string
  label: string
  value: string
  withheld?: boolean
  /** Why the figure is a dash, said beside it. */
  reason?: string
}

/** How many activities have official actual cost through the cutoff. */
const officialActualRows = (detail: HealthDimensionDetail) => {
  const source = detail.acSource as { officialActualActivities?: number } | null | undefined
  return typeof source?.officialActualActivities === 'number' ? source.officialActualActivities : null
}

const NO_COST_RECORDS = 'no official cost records through the cutoff'

function readableMetrics(
  dimensionKey: string,
  detail: HealthDimensionDetail,
  currency?: string | null
): Metric[] {
  const shown: Metric[] = []
  for (const [key, value] of Object.entries(detail)) {
    if (NON_METRIC_KEYS.has(key)) continue
    // A missing index is a dash with the server's reason, never a row that
    // silently disappears.
    if (RATIO_KEYS.has(key) && (value === null || value === undefined)) {
      const reason = detail[`${key}Note`]
      shown.push({
        key,
        label: labelForMetric(key),
        value: '—',
        reason: typeof reason === 'string' ? reason : undefined,
      })
      continue
    }
    // No official actual cost through the cutoff: AC is not "0 spent".
    if (key === 'ac' && officialActualRows(detail) === 0) {
      shown.push({ key, label: labelForMetric(key), value: '—', reason: NO_COST_RECORDS })
      continue
    }
    const formatted = formatMetricValue(key, value, currency)
    if (formatted) shown.push({ key, label: labelForMetric(key), value: formatted })
  }
  const withheld = (WITHHELD_WHEN_ABSENT[dimensionKey] ?? [])
    .filter((key) => !(key in detail))
    .map((key) => ({ key, label: labelForMetric(key), value: '—', withheld: true }))
  return [...shown, ...withheld].slice(0, 4)
}

const WITHHELD_REASON = 'Shown to people who can open the BOQ or the cost module'

function DimensionCard({
  dimensionKey,
  label,
  score,
  detail,
  sourceRule,
  cutoffLabel,
  measuredThrough,
  currency,
}: {
  dimensionKey: string
  label: string
  score: number
  detail: HealthDimensionDetail
  sourceRule?: HealthDimension['sourceRule']
  /** The EV cutoff's calendar date, as the one formatter states it. */
  cutoffLabel: string
  measuredThrough: 'ev_cutoff' | 'today'
  currency?: string | null
}) {
  // No index: the rule's neutral 60, said to be one — not a "Fair" verdict.
  const neutral = detail.scoreBasis === 'neutral_no_index'
  const color = neutral ? NEUTRAL_COLOR : scoreColor(score)
  const band = neutral ? NEUTRAL_LABEL : scoreLabel(score)
  // The server's reasons beside the figures: why an index is missing or 0,
  // and that a cutoff still ahead compares a future plan with today's work.
  const notes = [detail.spiNote, detail.cpiNote, detail.cutoffNotReachedNote].filter(
    (note): note is string => typeof note === 'string' && note.length > 0
  )
  const topRisks = Array.isArray(detail.topRisks)
    ? detail.topRisks.slice(0, 2)
    : []
  const metrics = readableMetrics(dimensionKey, detail, currency)
  const anyWithheld = metrics.some((metric) => metric.withheld)
  // Schedule and cost are earned value through the EV cutoff; the other
  // dimensions are the records as they stand today.
  const provenance =
    measuredThrough === 'today'
      ? `${sourceRule?.source || 'Official source'} as of today`
      : `${sourceRule?.source || 'Official source'} through ${cutoffLabel}`

  return (
    <div
      className='flex flex-col rounded-lg border bg-card p-3.5 shadow-[var(--shadow-card)]'
      title={provenance}
      data-testid={`uat-health-dimension-${dimensionKey}`}
    >
      {/* Dimension, score and band on one line: the figure leads. */}
      <div className='flex items-baseline justify-between gap-2'>
        <p className='truncate text-sm font-semibold text-foreground'>{label}</p>
        <span className='font-display text-xl leading-none font-bold tabular-nums' style={{ color }}>
          {score}
        </span>
      </div>

      <div className='mt-2 flex items-center gap-2'>
        <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-muted'>
          <div
            className='h-1.5 rounded-full transition-all'
            style={{ width: `${score}%`, background: color }}
          />
        </div>
        <span
          className='shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold'
          style={{ background: `${color}1f`, color }}
          data-testid={`uat-health-band-${dimensionKey}`}
        >
          {band}
        </span>
      </div>

      {/* Named metrics, aligned as label/value pairs. */}
      {metrics.length > 0 && (
        <dl className='mt-3 space-y-1'>
          {metrics.map((metric) => (
            // Both sides must be able to shrink: a long value with shrink-0
            // pushed the whole page sideways on a phone.
            <div
              key={metric.key}
              className='flex min-w-0 items-baseline justify-between gap-2 text-xs'
              data-testid={`uat-health-metric-${dimensionKey}-${metric.key}`}
              title={metric.withheld ? WITHHELD_REASON : metric.reason}
            >
              <dt className='min-w-0 truncate text-muted-foreground'>{metric.label}</dt>
              <dd className='min-w-0 text-end font-medium tabular-nums text-foreground'>
                {metric.value}
                {metric.reason === NO_COST_RECORDS ? (
                  <span className='ms-1 text-[11px] font-normal text-muted-foreground'>
                    · {NO_COST_RECORDS}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {notes.length > 0 && (
        <ul
          className='mt-2 space-y-1 text-[11px] leading-snug text-muted-foreground'
          data-testid={`uat-health-notes-${dimensionKey}`}
        >
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {anyWithheld && (
        <p
          className='mt-1 text-[11px] text-muted-foreground'
          data-testid={`uat-health-withheld-${dimensionKey}`}
        >
          {WITHHELD_REASON}.
        </p>
      )}

      <p
        className='mt-3 truncate border-t pt-2 text-[11px] text-muted-foreground'
        data-testid={`uat-health-provenance-${dimensionKey}`}
      >
        {provenance}
      </p>
      {topRisks.length > 0 && (
        <div className='space-y-1 border-t pt-2'>
          {topRisks.map((risk) => (
            <p
              key={risk.id}
              className='truncate text-xs text-muted-foreground'
              title={`${risk.item} - ${risk.reason}`}
            >
              <span className='font-medium text-foreground'>{risk.item}</span>
              {risk.impactedActivity
                ? ` -> ${risk.impactedActivity.wbsCode ? `${risk.impactedActivity.wbsCode} ` : ''}${risk.impactedActivity.name}`
                : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export function HealthDashboard({ projectId, currency }: Props) {
  const { data, isLoading } = useProjectHealth<HealthResponse>(projectId)

  if (isLoading) {
    return (
      <p className='text-sm text-muted-foreground'>Loading health data...</p>
    )
  }

  if (!data) return null

  const overallScore = Number(data.overallScore || 0)
  const dimensions = data.dimensions || []
  const pendingReview = data.pendingReview?.metrics || []
  const freshness = data.dataFreshness
  // One cutoff for every card: the end of this date in the project's zone.
  const evCutoff: EvCutoff = {
    cutoffDate: freshness?.cutoffDate,
    cutoffLocalDate: freshness?.cutoffLocalDate,
    timeZone: freshness?.cutoffTimeZone,
    timeZoneSource: freshness?.cutoffTimeZoneSource,
    timeZoneNote: freshness?.cutoffTimeZoneNote,
  }
  const cutoffNote = evCutoffNote(evCutoff)
  // A card's cutoff is the report's; any other date is shown as a date.
  const cutoffLabel = (value?: string | null) =>
    !value || value === freshness?.cutoffDate ? formatEvCutoffDate(evCutoff) : formatDate(value)
  const radarData = dimensions.map((d) => ({
    subject: d.label,
    score: d.score,
  }))
  const overallColor = scoreColor(overallScore)

  return (
    <div className='space-y-4'>
      <div className='flex flex-col gap-4 rounded-lg border p-4 lg:flex-row lg:items-center'>
        <div className='text-center lg:w-48'>
          <p className='text-xs text-muted-foreground'>Overall Health</p>
          <p className='text-5xl font-bold' style={{ color: overallColor }}>
            {overallScore}
          </p>
          <p className='text-sm font-medium' style={{ color: overallColor }}>
            {scoreLabel(overallScore)}
          </p>
          <p className='mt-2 text-xs text-muted-foreground' data-testid='uat-health-cutoff'>
            EV cutoff {formatEvCutoff(evCutoff)}
          </p>
          {cutoffNote && (
            <p className='mt-1 text-xs text-muted-foreground' data-testid='uat-health-cutoff-zone-note'>
              {cutoffNote}
            </p>
          )}
          {freshness?.cutoffNotReachedNote && (
            <p className='mt-1 text-xs font-medium text-warning' data-testid='uat-health-cutoff-not-reached'>
              {freshness.cutoffNotReachedNote}
            </p>
          )}
        </div>

        <div className='flex-1'>
          <ResponsiveContainer width='100%' height={230}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey='subject' tick={{ fontSize: 11 }} />
              <Radar
                dataKey='score'
                stroke={overallColor}
                fill={overallColor}
                fillOpacity={0.25}
              />
              <Tooltip />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4'>
        {dimensions.map((d) => (
          <DimensionCard
            key={d.key}
            dimensionKey={d.key}
            currency={currency}
            label={d.label}
            score={d.score}
            detail={d.detail || {}}
            sourceRule={
              d.sourceRule ||
              (d.detail?.sourceRule as HealthDimension['sourceRule'])
            }
            cutoffLabel={cutoffLabel(d.cutoffDate || (d.detail?.cutoffDate as string | null))}
            measuredThrough={
              d.measuredThrough ?? (d.key === 'schedule' || d.key === 'cost' ? 'ev_cutoff' : 'today')
            }
          />
        ))}
      </div>

      {pendingReview.length > 0 && (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
          {pendingReview.map((metric) => (
            <div
              key={metric.key}
              title={`${labelForMetric(metric.source)} as of today`}
              className='relative overflow-hidden rounded-md border bg-card p-3 shadow-[var(--shadow-card)]'
            >
              <span aria-hidden className='absolute inset-y-0 left-0 w-[3px] bg-warning' />
              <div className='flex items-baseline justify-between gap-2'>
                <p className='truncate text-sm font-semibold text-foreground'>
                  {metric.label}
                </p>
                <span className='font-display text-xl leading-none font-bold tabular-nums text-foreground'>
                  {metric.count}
                </span>
              </div>
              <Badge
                variant='outline'
                className={cn('mt-2 px-1.5 py-0 text-[10px]', statusBadge('review'))}
              >
                Pending review
              </Badge>
              <p className='mt-2 truncate text-[11px] text-muted-foreground'>
                {labelForMetric(metric.source)} · as of today
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
