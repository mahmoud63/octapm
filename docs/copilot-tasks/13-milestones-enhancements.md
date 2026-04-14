# Task 13 — Milestones: Countdown & Completion Status

## Gaps Covered
- No countdown to next milestone
- No milestone completion status (tick/done)

## BRD Refs
- BR-006: Dashboard shows milestone timeline
- §15 PM Dashboard: milestone countdown

## DB Schema Changes
None required. Milestone completion status derives from `pctComplete` on the activity (already stored via `ActivityProgress`).

## Frontend Changes Only

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`

#### 1. Compute next milestone day and countdown
```tsx
const todayWorkingDay = /* same calculation as task 12 */

const nextMilestone = useMemo(() => {
  const upcoming = milestones
    .filter(m => {
      // Find the activity record for this milestone to check completion
      const act = activities.find(a => a.isMilestone && a.name === m.name)
      return act && act.pctComplete < 100 && (m.day ?? 0) >= todayWorkingDay
    })
    .sort((a, b) => (a.day ?? 0) - (b.day ?? 0))
  return upcoming[0] ?? null
}, [milestones, activities, todayWorkingDay])
```

#### 2. Add countdown banner above milestones grid
```tsx
{nextMilestone && (
  <div className='mb-4 rounded-lg border border-purple-300 bg-purple-50 p-3 dark:border-purple-900/40 dark:bg-purple-950/20'>
    <p className='text-sm font-semibold text-purple-800 dark:text-purple-300'>
      ◆ Next milestone: {nextMilestone.name}
    </p>
    <p className='text-xs text-purple-700 dark:text-purple-400 mt-0.5'>
      Day {nextMilestone.day} · {(nextMilestone.day ?? 0) - todayWorkingDay} working days away
      {nextMilestone.phase ? ` · ${nextMilestone.phase}` : ''}
    </p>
  </div>
)}
```

#### 3. Add completion status to milestone cards
For each milestone card, look up its corresponding activity to get `pctComplete`:
```tsx
{(revision.milestones || milestones).map((m, i) => {
  const act = activities.find(a => a.isMilestone && a.name === m.name)
  const isComplete = act && act.pctComplete >= 100
  const isPast = (m.day ?? 0) < todayWorkingDay
  const isOverdue = isPast && !isComplete

  return (
    <div
      key={i}
      className={[
        'rounded-lg border p-4 relative',
        isComplete ? 'border-green-300 bg-green-50 dark:border-green-900/40 dark:bg-green-950/20' :
        isOverdue ? 'border-red-300 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20' : '',
      ].join(' ')}
    >
      {/* Completion tick */}
      {isComplete && (
        <div className='absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white text-xs'>
          ✓
        </div>
      )}
      {isOverdue && (
        <div className='absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white text-xs'>
          !
        </div>
      )}

      <div className='flex items-start gap-2'>
        <span className={`font-semibold ${isOverdue ? 'text-red-600' : 'text-purple-600'}`}>◆</span>
        <div className='flex-1 min-w-0'>
          <p className='font-medium truncate'>{m.name}</p>
          <p className='text-xs text-muted-foreground'>
            {m.phase || '—'} · Day {m.day ?? '—'}
          </p>
          {m.description && (
            <p className='mt-1 text-xs text-muted-foreground'>{m.description}</p>
          )}

          {/* Status label */}
          <p className='mt-2 text-xs font-medium'>
            {isComplete ? (
              <span className='text-green-600'>Achieved</span>
            ) : isOverdue ? (
              <span className='text-red-600'>Overdue by {todayWorkingDay - (m.day ?? 0)}d</span>
            ) : (m.day ?? 0) - todayWorkingDay <= 14 ? (
              <span className='text-amber-600'>Due in {(m.day ?? 0) - todayWorkingDay}d</span>
            ) : (
              <span className='text-muted-foreground'>In {(m.day ?? 0) - todayWorkingDay}d</span>
            )}
          </p>
        </div>
      </div>

      {m.critical && !isComplete && (
        <Badge variant='destructive' className='text-xs mt-2'>CP</Badge>
      )}
    </div>
  )
})}
```

## Acceptance Criteria
- [ ] "Next milestone" countdown banner shows name, day, and working days remaining
- [ ] Completed milestones (pctComplete=100) show green background + checkmark
- [ ] Overdue milestones (day < today, pctComplete < 100) show red background + "!" icon + "Overdue by Xd"
- [ ] Upcoming milestones within 14 days show amber "Due in Xd"
- [ ] No next milestone → banner not shown
