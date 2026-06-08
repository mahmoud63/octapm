import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import type { ScheduleActivity } from '../data/schema'

interface Props {
  activities: ScheduleActivity[]
  projectId: string
}

const fmtUSD = (n: number) =>
  '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function ProgressTab({ activities, projectId }: Props) {
  const queryClient = useQueryClient()
  const [localPct, setLocalPct] = useState<Record<string, number>>({})

  const updateProgress = useMutation({
    mutationFn: ({
      activityId,
      pctComplete,
    }: {
      activityId: string
      pctComplete: number
    }) =>
      apiClient
        .post(`/projects/${projectId}/activities/${activityId}/progress`, {
          pctComplete,
        })
        .then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule', projectId] })
      queryClient.invalidateQueries({ queryKey: ['activities', projectId] })
    },
  })

  const ev = useMemo(() => {
    const nonMilestones = activities.filter((a) => !a.isMilestone)

    const totalBudget = nonMilestones.reduce(
      (sum, a) => sum + (a.budget || 0),
      0
    )
    const evValue = nonMilestones.reduce(
      (sum, a) =>
        sum + ((localPct[a.id] ?? a.pctComplete ?? 0) / 100) * (a.budget || 0),
      0
    )

    const pv = nonMilestones.reduce((sum, a) => {
      if (a.status === 'todo') return sum
      return sum + (a.budget || 0)
    }, 0)

    const ac = nonMilestones.reduce((sum, a) => {
      if (a.actualCost != null) return sum + a.actualCost
      const pct = localPct[a.id] ?? a.pctComplete ?? 0
      return sum + (pct / 100) * (a.budget || 0) * 1.03
    }, 0)

    const spi = pv > 0 ? evValue / pv : 1
    const cpi = ac > 0 ? evValue / ac : 1

    return { totalBudget, ev: evValue, pv, ac, spi, cpi }
  }, [activities, localPct])

  const commitProgress = (activityId: string, value: number) => {
    const pctComplete = Math.max(0, Math.min(100, value))
    updateProgress.mutate({ activityId, pctComplete })
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-5'>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>SPI</p>
          <p
            className={`text-xl font-bold ${ev.spi < 0.9 ? 'text-red-600' : 'text-green-600'}`}
          >
            {ev.spi.toFixed(2)}
          </p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>CPI</p>
          <p
            className={`text-xl font-bold ${ev.cpi < 0.9 ? 'text-red-600' : 'text-green-600'}`}
          >
            {ev.cpi.toFixed(2)}
          </p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>EV</p>
          <p className='text-xl font-bold'>{fmtUSD(ev.ev)}</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>PV</p>
          <p className='text-xl font-bold'>{fmtUSD(ev.pv)}</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>AC</p>
          <p className='text-xl font-bold'>{fmtUSD(ev.ac)}</p>
        </div>
      </div>

      {(ev.spi < 0.9 || ev.cpi < 0.9) && (
        <div className='rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300'>
          {ev.spi < 0.9 && (
            <span>SPI {ev.spi.toFixed(2)} - project is behind schedule. </span>
          )}
          {ev.cpi < 0.9 && (
            <span>CPI {ev.cpi.toFixed(2)} - project is over budget.</span>
          )}
        </div>
      )}

      <div className='divide-y rounded-md border'>
        {activities
          .filter((a) => !a.isMilestone)
          .map((a) => {
            const val = localPct[a.id] ?? a.pctComplete
            return (
              <div key={a.id} className='flex items-center gap-4 p-3'>
                <div className='w-48 min-w-0'>
                  <p className='truncate text-sm font-medium'>{a.name}</p>
                  <p className='text-xs text-muted-foreground'>
                    {a.category || '—'} · {a.duration}d · Budget{' '}
                    {fmtUSD(a.budget)}
                  </p>
                </div>
                <input
                  type='range'
                  min={0}
                  max={100}
                  step={1}
                  value={val}
                  className='flex-1'
                  onChange={(e) => {
                    const next = Number(e.target.value)
                    setLocalPct((prev) => ({ ...prev, [a.id]: next }))
                  }}
                  onMouseUp={(e) => {
                    commitProgress(
                      a.id,
                      Number((e.target as HTMLInputElement).value)
                    )
                  }}
                  onTouchEnd={() => {
                    commitProgress(a.id, localPct[a.id] ?? a.pctComplete)
                  }}
                />
                <span className='w-10 text-right font-mono text-sm'>
                  {val}%
                </span>
              </div>
            )
          })}
      </div>

      <p className='text-xs text-muted-foreground'>
        Total budget considered: {fmtUSD(ev.totalBudget)} · AC uses submitted
        actual cost or default 1.03 factor.
      </p>
    </div>
  )
}
