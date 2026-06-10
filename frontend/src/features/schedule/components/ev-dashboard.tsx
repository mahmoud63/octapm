import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ScheduleActivity } from '../data/schema'
import { BulkProgressUpdate } from './bulk-progress-update'

type Props = {
  projectId: string
  activities: ScheduleActivity[]
  totalBudget: number
  todayWorkingDay: number
}

const fmtUSD = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function EvDashboard({
  projectId,
  activities,
  totalBudget,
  todayWorkingDay,
}: Props) {
  const maxDay = useMemo(
    () =>
      Math.max(...activities.map((activity) => activity.earlyFinish ?? 0), 30),
    [activities]
  )

  const metrics = useMemo(() => {
    const ev = activities.reduce(
      (sum, activity) =>
        sum + (activity.pctComplete / 100) * (activity.budget || 0),
      0
    )

    const ac = activities.reduce((sum, activity) => {
      const fallback =
        (activity.pctComplete / 100) * (activity.budget || 0) * 1.03
      return sum + (activity.actualCost ?? fallback)
    }, 0)

    const pv = activities
      .filter((activity) => (activity.earlyFinish ?? 0) <= todayWorkingDay)
      .reduce((sum, activity) => sum + (activity.budget || 0), 0)

    const spi = pv > 0 ? ev / pv : 1
    const cpi = ac > 0 ? ev / ac : 1
    const eac = cpi > 0 ? totalBudget / cpi : totalBudget
    const missingActualCount = activities.filter(
      (activity) => activity.actualCost == null
    ).length

    return {
      ev,
      ac,
      pv,
      spi,
      cpi,
      eac,
      sv: ev - pv,
      cv: ev - ac,
      missingActualCount,
    }
  }, [activities, todayWorkingDay, totalBudget])

  const sCurveData = useMemo(() => {
    const step = Math.max(1, Math.floor(maxDay / 30))
    const rows: Array<{ day: number; pv: number; ev: number; ac: number }> = []

    for (let day = 0; day <= maxDay; day += step) {
      const planned = activities.filter(
        (activity) => (activity.earlyFinish ?? 0) <= day
      )

      const pv = planned.reduce(
        (sum, activity) => sum + (activity.budget || 0),
        0
      )
      const ev = planned.reduce(
        (sum, activity) =>
          sum + (activity.pctComplete / 100) * (activity.budget || 0),
        0
      )
      const ac = planned.reduce((sum, activity) => {
        const fallback =
          (activity.pctComplete / 100) * (activity.budget || 0) * 1.03
        return sum + (activity.actualCost ?? fallback)
      }, 0)

      rows.push({ day, pv, ev, ac })
    }

    return rows
  }, [activities, maxDay])

  const cards = [
    {
      label: 'SPI Est.',
      value: metrics.spi.toFixed(2),
      color: metrics.spi < 0.9 ? 'text-red-600' : 'text-green-600',
      sub: metrics.spi < 1 ? 'Estimate: behind' : 'Estimate: on schedule',
    },
    {
      label: 'CPI Est.',
      value: metrics.cpi.toFixed(2),
      color: metrics.cpi < 0.9 ? 'text-red-600' : 'text-green-600',
      sub: metrics.cpi < 1 ? 'Estimate: over' : 'Estimate: under',
    },
    {
      label: 'EAC Est.',
      value: fmtUSD(metrics.eac),
      color: 'text-amber-600',
      sub: 'Estimate at completion',
    },
    {
      label: 'SV',
      value: fmtUSD(metrics.sv),
      color: metrics.sv < 0 ? 'text-red-600' : 'text-green-600',
      sub: 'Schedule variance',
    },
    { label: 'EV Est.', value: fmtUSD(metrics.ev), sub: 'Earned value' },
    { label: 'PV Est.', value: fmtUSD(metrics.pv), sub: 'Planned value' },
    { label: 'AC Est.', value: fmtUSD(metrics.ac), sub: 'Actual cost estimate' },
    {
      label: 'CV',
      value: fmtUSD(metrics.cv),
      color: metrics.cv < 0 ? 'text-red-600' : 'text-green-600',
      sub: 'Cost variance',
    },
  ]

  return (
    <div className='space-y-5'>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        {cards.map((card) => (
          <div key={card.label} className='rounded-lg border bg-card p-3'>
            <p className='text-xs tracking-wide text-muted-foreground uppercase'>
              {card.label}
            </p>
            <p className={`mt-1 text-xl font-bold ${card.color ?? ''}`}>
              {card.value}
            </p>
            <p className='mt-0.5 text-xs text-muted-foreground'>{card.sub}</p>
          </div>
        ))}
      </div>

      {(metrics.spi < 0.9 || metrics.cpi < 0.9) && (
        <div className='rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800'>
          Performance alert:
          {metrics.spi < 0.9 &&
            ` SPI ${metrics.spi.toFixed(2)} indicates schedule slippage.`}
          {metrics.cpi < 0.9 &&
            ` CPI ${metrics.cpi.toFixed(2)} indicates cost overrun.`}
        </div>
      )}

      <div className='rounded-md border p-3'>
        <p className='mb-2 text-sm font-semibold'>
          Estimate S-Curve (PV vs EV vs AC)
        </p>
        <ResponsiveContainer width='100%' height={280}>
          <LineChart data={sCurveData}>
            <CartesianGrid strokeDasharray='3 3' />
            <XAxis dataKey='day' />
            <YAxis
              tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(v) => fmtUSD(Number(v || 0))}
              labelFormatter={(day) => `Day ${String(day)}`}
            />
            <Legend />
            <Line
              type='monotone'
              dataKey='pv'
              stroke='#3B82F6'
              name='PV (Planned)'
              dot={false}
              strokeWidth={2}
            />
            <Line
              type='monotone'
              dataKey='ev'
              stroke='#22C55E'
              name='EV (Earned)'
              dot={false}
              strokeWidth={2}
            />
            <Line
              type='monotone'
              dataKey='ac'
              stroke='#EF4444'
              name='AC (Actual)'
              dot={false}
              strokeDasharray='4 4'
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className='text-xs text-muted-foreground'>
        Schedule EV is live estimate guidance. Missing actuals are estimated for{' '}
        {metrics.missingActualCount} activities; official EV is produced from
        reporting periods, approved cost loading, and cost records.
      </p>

      <BulkProgressUpdate projectId={projectId} activities={activities} />
    </div>
  )
}
