import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { cn } from '@/lib/utils'
import type { HistogramGroup } from '../lib/gantt-layouts'

/**
 * The resource histogram under the Gantt.
 *
 * Reads the project's resource allocations and spreads each one evenly across
 * the duration of the activity it belongs to — the same units-per-period
 * spreading P6 does for a linear assignment — then stacks the periods so
 * overlapping activities show as a peak. That peak is the reason to draw one:
 * it is where a schedule that looks fine on the bars turns out to need three
 * crews at once.
 *
 * Two things about the numbers, both deliberate:
 *
 * - **One unit at a time.** Man-days and square metres do not add up, so
 *   stacking them in one column would draw a shape that means nothing. The pane
 *   shows a single unit and offers the others beside it.
 * - **Spread across calendar days**, not a working calendar, so a period
 *   containing a weekend reads slightly lower than the crew actually works. The
 *   shape and the peaks are right; read the figure as a demand rate.
 */

export type HistogramActivity = {
  id: string
  start: Date | null
  finish: Date | null
}

type Allocation = {
  id: string
  resourceType: string
  resourceName: string
  quantity: number
  unit?: string | null
}

type ResourcePlanResponse = {
  resources?: Array<{
    activity: { id: string }
    resources: Allocation[]
  }>
}

type Series = {
  key: string
  label: string
  color: string
  values: number[]
  total: number
}

/** Type colours are fixed product-wide so a histogram always reads the same. */
const TYPE_COLOR: Record<string, string> = {
  labor: 'var(--octa-royal-blue)',
  labour: 'var(--octa-royal-blue)',
  equipment: 'var(--octa-warning)',
  material: 'var(--octa-success)',
  subcontract: 'var(--octa-purple)',
  other: 'var(--octa-charcoal-muted)',
}

/** A named resource takes a colour from the brand ramp, stable within a view. */
const NAME_RAMP = [
  'var(--octa-royal-blue)',
  'var(--octa-turquoise)',
  'var(--octa-warning)',
  'var(--octa-purple)',
  'var(--octa-success)',
  'var(--octa-azure)',
  'var(--octa-error)',
  'var(--octa-midnight-indigo)',
]

const DAY_MS = 24 * 60 * 60 * 1000
const UNKNOWN_UNIT = 'units'

const titleCase = (value: string) =>
  value.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const compact = (value: number) => {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
  if (value >= 100) return value.toFixed(0)
  return value.toFixed(value >= 10 ? 0 : 1)
}

export function useResourcePlan(projectId: string) {
  return useQuery<ResourcePlanResponse>({
    queryKey: ['schedule-resources', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/schedule/resources`)
        .then((response) => response.data.data),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  })
}

interface Props {
  projectId: string
  activities: HistogramActivity[]
  timelineStart: Date
  totalDays: number
  /** Width of the timeline, so the columns line up with the bars above. */
  width: number
  pxPerDay: number
  /** Width of one column, in days. Matches the timescale above it. */
  bucketDays: number
  /** Width of the label column, matched to the activity table. */
  legendWidth: number
  group: HistogramGroup
  onGroupChange: (group: HistogramGroup) => void
  /** Horizontal scroll of the chart above, so the two stay aligned. */
  scrollLeft: number
  height?: number
}

export function ResourcePane({
  projectId,
  activities,
  timelineStart,
  totalDays,
  width,
  pxPerDay,
  bucketDays,
  legendWidth,
  group,
  onGroupChange,
  scrollLeft,
  // Tall enough for the unit chips and three series without clipping the
  // "+N more" line underneath them.
  height = 152,
}: Props) {
  const { data, isLoading, isError } = useResourcePlan(projectId)
  const [unit, setUnit] = useState<string | null>(null)

  /** Every unit in the plan, biggest family first. */
  const units = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of data?.resources ?? []) {
      for (const allocation of entry.resources) {
        const key = (allocation.unit || UNKNOWN_UNIT).trim() || UNKNOWN_UNIT
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key]) => key)
  }, [data])

  // Open on the unit with the most assignments — on a construction schedule
  // that is the manpower curve, which is the one people come here for.
  useEffect(() => {
    if (!unit && units.length) setUnit(units[0])
  }, [unit, units])

  const activeUnit = unit && units.includes(unit) ? unit : (units[0] ?? null)

  const model = useMemo(() => {
    const bucketCount = Math.max(1, Math.ceil(totalDays / bucketDays))
    const byActivity = new Map(activities.map((item) => [item.id, item]))
    const series = new Map<string, Series>()

    for (const entry of data?.resources ?? []) {
      const activity = byActivity.get(entry.activity.id)
      if (!activity?.start || !activity.finish) continue

      const spanDays = Math.max(
        1,
        Math.round((activity.finish.getTime() - activity.start.getTime()) / DAY_MS) + 1
      )
      const offset = Math.round(
        (activity.start.getTime() - timelineStart.getTime()) / DAY_MS
      )

      for (const allocation of entry.resources) {
        const allocationUnit =
          (allocation.unit || UNKNOWN_UNIT).trim() || UNKNOWN_UNIT
        if (activeUnit && allocationUnit !== activeUnit) continue

        const quantity = Number(allocation.quantity) || 0
        if (quantity <= 0) continue

        const key =
          group === 'type'
            ? (allocation.resourceType || 'other').toLowerCase()
            : allocation.resourceName

        if (!series.has(key)) {
          series.set(key, {
            key,
            label: group === 'type' ? titleCase(key) : key,
            color:
              group === 'type'
                ? (TYPE_COLOR[key] ?? TYPE_COLOR.other)
                : NAME_RAMP[series.size % NAME_RAMP.length],
            values: new Array(bucketCount).fill(0),
            total: 0,
          })
        }
        const target = series.get(key)!
        const perDay = quantity / spanDays

        for (let day = 0; day < spanDays; day += 1) {
          const index = Math.floor((offset + day) / bucketDays)
          if (index < 0 || index >= bucketCount) continue
          target.values[index] += perDay
          target.total += perDay
        }
      }
    }

    const ordered = [...series.values()].sort((a, b) => b.total - a.total)
    const totals = new Array(bucketCount).fill(0)
    ordered.forEach((entry) => {
      entry.values.forEach((value, index) => {
        totals[index] += value
      })
    })

    return { series: ordered, totals, peak: Math.max(0, ...totals) }
  }, [activeUnit, activities, bucketDays, data, group, timelineStart, totalDays])

  const bucketWidth = bucketDays * pxPerDay
  const plotHeight = height - 22
  const empty = !isLoading && (isError || model.peak <= 0)

  return (
    <div
      data-testid='primavera-gantt-histogram'
      className='flex overflow-hidden rounded-md border bg-card shadow-sm'
      style={{ height }}
    >
      <div
        className='shrink-0 overflow-hidden border-r px-3 py-2'
        style={{ width: legendWidth }}
      >
        <div className='flex items-baseline justify-between gap-2'>
          <p className='text-[10px] font-semibold tracking-wide text-muted-foreground uppercase'>
            Resource demand
          </p>
          {activeUnit && (
            <span className='font-mono text-[10px] text-muted-foreground'>
              {activeUnit} / period
            </span>
          )}
        </div>

        {units.length > 1 && (
          <div className='mt-1.5 flex flex-wrap gap-1'>
            {units.map((option) => (
              <button
                key={option}
                type='button'
                onClick={() => setUnit(option)}
                data-testid={`primavera-gantt-histogram-unit-${option}`}
                className={cn(
                  'rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors',
                  option === activeUnit
                    ? 'border-transparent bg-selected text-selected-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <ul className='mt-1.5 space-y-1'>
          {model.series.slice(0, 3).map((entry) => (
            <li key={entry.key} className='flex items-center gap-2 text-[11px]'>
              <span
                className='size-2 shrink-0 rounded-[1px]'
                style={{ background: entry.color }}
              />
              <span className='min-w-0 flex-1 truncate' title={entry.label}>
                {entry.label}
              </span>
              <span className='shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums'>
                {compact(entry.total)}
              </span>
            </li>
          ))}
          {model.series.length > 3 && (
            <li className='text-[10px] text-muted-foreground'>
              +{model.series.length - 3} more
            </li>
          )}
        </ul>
      </div>

      <div className='relative min-w-0 flex-1 overflow-hidden'>
        {isLoading ? (
          <p className='px-3 py-4 text-xs text-muted-foreground'>
            Loading resources…
          </p>
        ) : empty ? (
          <p
            className='px-3 py-4 text-xs text-muted-foreground'
            data-testid='primavera-gantt-histogram-empty'
          >
            {isError
              ? 'Resource demand could not be loaded.'
              : 'No resources are assigned to these activities yet.'}
          </p>
        ) : (
          <div style={{ width, transform: `translateX(${-scrollLeft}px)` }}>
            <svg
              width={width}
              height={height}
              className='block'
              data-testid='primavera-gantt-histogram-canvas'
              role='img'
              aria-label={`Resource demand over time, peaking at ${compact(
                model.peak
              )} ${activeUnit ?? ''} per period.`}
            >
              {[0.25, 0.5, 0.75].map((fraction) => (
                <line
                  key={fraction}
                  x1={0}
                  x2={width}
                  y1={plotHeight - plotHeight * fraction}
                  y2={plotHeight - plotHeight * fraction}
                  stroke='var(--border)'
                  strokeWidth={0.5}
                  strokeDasharray='3 3'
                />
              ))}
              <line
                x1={0}
                x2={width}
                y1={plotHeight}
                y2={plotHeight}
                stroke='var(--border)'
                strokeWidth={1}
              />

              {model.totals.map((total, index) => {
                if (total <= 0) return null
                const x = index * bucketWidth
                let cursor = plotHeight

                return (
                  <g key={index}>
                    {model.series.map((entry) => {
                      const value = entry.values[index]
                      if (value <= 0) return null
                      const barHeight = (value / model.peak) * (plotHeight - 12)
                      cursor -= barHeight
                      return (
                        <rect
                          key={entry.key}
                          x={x + 0.5}
                          y={cursor}
                          width={Math.max(1, bucketWidth - 1)}
                          height={barHeight}
                          fill={entry.color}
                          opacity={0.9}
                        >
                          <title>{`${entry.label}: ${compact(value)} ${activeUnit ?? ''}`}</title>
                        </rect>
                      )
                    })}
                  </g>
                )
              })}

              {/* The peak, marked where a level line would be read. */}
              <line
                x1={0}
                x2={width}
                y1={12}
                y2={12}
                stroke='var(--octa-error)'
                strokeWidth={1}
                strokeDasharray='4 3'
              />
            </svg>
          </div>
        )}

        {!empty && !isLoading && (
          <span className='pointer-events-none absolute start-2 top-0.5 font-mono text-[10px] text-error'>
            peak {compact(model.peak)}
          </span>
        )}

        <div className='absolute end-2 top-2 flex gap-1'>
          {(['type', 'resource'] as HistogramGroup[]).map((option) => (
            <button
              key={option}
              type='button'
              onClick={() => onGroupChange(option)}
              data-testid={`primavera-gantt-histogram-group-${option}`}
              className={cn(
                'rounded-sm border px-2 py-0.5 text-[10px] font-medium transition-colors',
                group === option
                  ? 'border-transparent bg-selected text-selected-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              )}
            >
              {option === 'type' ? 'By type' : 'By resource'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
