import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { formatLongDate } from '@/lib/dates'
import { statusBadge } from '@/lib/status'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
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
    }>
  }
}

function scoreColor(score: number) {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#f59e0b'
  return '#ef4444'
}

function scoreLabel(score: number) {
  if (score >= 80) return 'Good'
  if (score >= 60) return 'Fair'
  return 'Poor'
}

// A reporting cutoff is a calendar date: render it in UTC so it does not shift
// a day for anyone west of it. See lib/dates.ts.
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
  delayedActivities: 'Delayed activities',
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

const MONEY_KEYS = new Set(['ev', 'pv', 'ac', 'eac', 'budget', 'actualCost', 'forecast'])
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

function formatMetricValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  // A raw ISO timestamp is never something to show a project manager.
  if (typeof value === 'string' && ISO_DATE.test(value)) return formatDate(value)

  const numeric = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(numeric)) {
    if (MONEY_KEYS.has(key)) {
      return numeric.toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      })
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
])

function readableMetrics(detail: HealthDimensionDetail) {
  return Object.entries(detail)
    .filter(([key]) => !NON_METRIC_KEYS.has(key))
    .map(([key, value]) => ({ key, label: labelForMetric(key), value: formatMetricValue(key, value) }))
    .filter((metric): metric is { key: string; label: string; value: string } =>
      Boolean(metric.value)
    )
    .slice(0, 4)
}

function DimensionCard({
  label,
  score,
  detail,
  sourceRule,
  cutoffDate,
}: {
  label: string
  score: number
  detail: HealthDimensionDetail
  sourceRule?: HealthDimension['sourceRule']
  cutoffDate?: string | null
}) {
  const color = scoreColor(score)
  const topRisks = Array.isArray(detail.topRisks)
    ? detail.topRisks.slice(0, 2)
    : []
  const metrics = readableMetrics(detail)
  const provenance = `${sourceRule?.source || 'Official source'} through ${formatDate(cutoffDate)}`

  return (
    <div
      className='flex flex-col rounded-lg border bg-card p-3.5 shadow-[var(--shadow-card)]'
      title={provenance}
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
        >
          {scoreLabel(score)}
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
            >
              <dt className='min-w-0 truncate text-muted-foreground'>{metric.label}</dt>
              <dd className='min-w-0 truncate text-end font-medium tabular-nums text-foreground'>
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <p className='mt-3 truncate border-t pt-2 text-[11px] text-muted-foreground'>
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

export function HealthDashboard({ projectId }: Props) {
  const { data, isLoading } = useQuery<HealthResponse>({
    queryKey: ['health', projectId],
    queryFn: () =>
      apiClient.get(`/projects/${projectId}/health`).then((r) => r.data.data),
    refetchInterval: 120000,
  })

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
          <p className='mt-2 text-xs text-muted-foreground'>
            Cutoff {formatDate(freshness?.cutoffDate)}
          </p>
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
            label={d.label}
            score={d.score}
            detail={d.detail || {}}
            sourceRule={
              d.sourceRule ||
              (d.detail?.sourceRule as HealthDimension['sourceRule'])
            }
            cutoffDate={d.cutoffDate || (d.detail?.cutoffDate as string | null)}
          />
        ))}
      </div>

      {pendingReview.length > 0 && (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
          {pendingReview.map((metric) => (
            <div
              key={metric.key}
              title={`${labelForMetric(metric.source)} through ${formatDate(metric.cutoffDate)}`}
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
                {labelForMetric(metric.source)} · {formatDate(metric.cutoffDate)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
