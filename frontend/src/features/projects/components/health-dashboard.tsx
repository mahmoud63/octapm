import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
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

function formatDate(value?: string | null) {
  if (!value) return 'No cutoff'
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
  return (
    <div className='space-y-2 rounded-lg border p-3'>
      <div className='flex items-center justify-between'>
        <p className='text-sm font-medium'>{label}</p>
        <span
          className='rounded-full px-2 py-0.5 text-xs font-semibold'
          style={{ background: `${color}22`, color }}
        >
          {scoreLabel(score)}
        </span>
      </div>
      <div className='h-1.5 overflow-hidden rounded-full bg-muted'>
        <div
          className='h-1.5 rounded-full transition-all'
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-xs text-muted-foreground'>
          {Object.entries(detail)
            .filter(([key]) => key !== 'topRisks')
            .slice(0, 2)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ')}
        </p>
        <p className='text-lg font-bold' style={{ color }}>
          {score}
        </p>
      </div>
      <div className='rounded-md bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground'>
        <span className='font-medium text-foreground'>
          {sourceRule?.source || 'Official source'}
        </span>{' '}
        through {formatDate(cutoffDate)}
      </div>
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
              className='rounded-md border border-amber-500/30 bg-amber-500/5 p-3'
            >
              <p className='text-xs font-medium text-amber-700 dark:text-amber-300'>
                Pending review
              </p>
              <p className='mt-1 text-sm font-semibold'>{metric.label}</p>
              <p className='text-2xl font-bold tabular-nums'>{metric.count}</p>
              <p className='text-xs text-muted-foreground'>
                {metric.source} through {formatDate(metric.cutoffDate)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
