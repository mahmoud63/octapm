# Task 12 — Critical Path Tab: Slippage & Predictive Float Alert (BR-008)

## Gaps Covered
- Days slippage / days behind indicator not shown on critical path tab
- Float trending toward zero predictive alert not implemented

## BRD Refs
- BR-008: Warnings generated for activities trending toward critical path within 14 days
- §15 Critical Path Report: CP activities, % complete, days behind, near-critical items

## DB Schema Changes
None required.

## Backend Changes
None — slippage and near-critical data can be computed client-side from existing activity fields.

## Frontend Changes

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`

#### 1. Compute slippage for each critical activity
Slippage = how many days behind schedule the activity is.
- If `pctComplete < 100` and the activity should be complete by now (earlyFinish < today's working day), slippage = today's working day - earlyFinish.
- Working day from project start: `Math.floor((Date.now() - projectStartMs) / (1000 * 60 * 60 * 24))` approximation (adjust for non-working days if needed — use calendar days / 1.4 as approximation).

```tsx
// Add to schedule-dashboard.tsx
const todayWorkingDay = useMemo(() => {
  if (!revision.projectSummary?.startDate) return 0
  const start = new Date(revision.projectSummary.startDate).getTime()
  const now = Date.now()
  const calDays = Math.floor((now - start) / (1000 * 60 * 60 * 24))
  return Math.max(0, Math.floor(calDays * 5 / 7)) // rough working day conversion
}, [revision.projectSummary?.startDate])

const slippageOf = (a: ScheduleActivity): number => {
  if (a.pctComplete >= 100) return 0
  if ((a.earlyFinish ?? 0) >= todayWorkingDay) return 0
  return todayWorkingDay - (a.earlyFinish ?? 0)
}
```

#### 2. Update Critical Path tab render
```tsx
<TabsContent value='critical' className='mt-4'>
  {/* Near-critical alert: activities with TF 1-5 approaching critical */}
  {(() => {
    const nearCrit = activities.filter(a =>
      !a.isCritical && !a.isMilestone && a.totalFloat != null && a.totalFloat <= 5
    )
    return nearCrit.length > 0 ? (
      <div className='mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800'>
        <p className='font-semibold'>⚠ {nearCrit.length} near-critical {nearCrit.length === 1 ? 'activity' : 'activities'} (TF ≤ 5d)</p>
        <p className='mt-1 text-xs'>These activities may become critical if delayed further:</p>
        <ul className='mt-1 list-disc list-inside text-xs'>
          {nearCrit.map(a => (
            <li key={a.id}>{a.name} — TF: {a.totalFloat}d</li>
          ))}
        </ul>
      </div>
    ) : null
  })()}

  {critActs.length === 0 ? (
    <p className='py-8 text-center text-muted-foreground'>No critical path activities.</p>
  ) : (
    <div className='space-y-2'>
      {critActs.map((a, i) => {
        const slip = slippageOf(a)
        return (
          <div key={a.id} className='flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-950/20'>
            <span className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white'>{i + 1}</span>
            <div className='flex-1 min-w-0'>
              <p className='font-medium truncate'>{a.name}</p>
              <p className='text-xs text-muted-foreground'>
                {a.wbsCode} · {a.category} · {a.duration}d · d{a.earlyStart}→d{a.earlyFinish}
              </p>
              <div className='mt-1 flex items-center gap-2'>
                {/* Progress bar */}
                <div className='h-1.5 flex-1 rounded-full bg-red-200'>
                  <div
                    className='h-1.5 rounded-full bg-red-600'
                    style={{ width: `${a.pctComplete}%` }}
                  />
                </div>
                <span className='text-xs font-mono text-red-700'>{a.pctComplete}%</span>
              </div>
            </div>
            <div className='flex flex-col items-end gap-1'>
              <Badge variant='destructive' className='text-xs'>CRITICAL</Badge>
              {slip > 0 && (
                <span className='rounded-full bg-red-800 px-2 py-0.5 text-xs text-white font-semibold'>
                  {slip}d behind
                </span>
              )}
              {slip === 0 && a.pctComplete < 100 && (
                <span className='rounded-full bg-green-600 px-2 py-0.5 text-xs text-white'>
                  on schedule
                </span>
              )}
              {a.pctComplete >= 100 && (
                <span className='rounded-full bg-slate-400 px-2 py-0.5 text-xs text-white'>
                  complete
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )}
</TabsContent>
```

## Acceptance Criteria
- [ ] Each critical activity card shows a progress bar with % complete
- [ ] Activities past their earlyFinish day with pctComplete < 100% show "Xd behind" badge
- [ ] Activities on track show "on schedule" badge
- [ ] Completed activities show "complete" badge
- [ ] Near-critical warning panel appears at top when any activity has TF ≤ 5d
- [ ] Near-critical panel lists affected activities with their float values
