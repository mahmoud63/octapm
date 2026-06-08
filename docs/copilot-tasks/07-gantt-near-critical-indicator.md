# Task 07 — Gantt: Near-Critical Activity Orange Indicator (BRU-11)

## Gap Covered
- Activities with TF between 1 and 5 days displayed with orange indicators (near-critical)
- Currently: all non-critical activities look the same (blue), regardless of float value

## BRD Refs
- BRU-11: Activities with TF between 1 and 5 days are classified as Near-Critical and displayed with orange indicators

## DB Schema Changes
None — `Activity.totalFloat` already stored.

## Frontend Changes Only

### File: `frontend/src/features/schedule/components/gantt-chart.tsx`

#### 1. Add near-critical classification helper
```ts
const isNearCritical = (a: ScheduleActivity) =>
  !a.isCritical && !a.isMilestone && a.totalFloat != null && a.totalFloat >= 1 && a.totalFloat <= 5
```

#### 2. Update bar color logic
```ts
const barColor = a.isMilestone
  ? '#A855F7'
  : a.isCritical
  ? '#EF4444'
  : isNearCritical(a)
  ? '#F97316'   // orange-500
  : '#3B82F6'   // blue-500
```

#### 3. Update label column color
```tsx
a.isMilestone ? 'text-purple-600 dark:text-purple-400' :
a.isCritical  ? 'text-red-600 dark:text-red-400' :
isNearCritical(a) ? 'text-orange-600 dark:text-orange-400' :
'text-foreground'
```

#### 4. Update label column indicator dot
```tsx
{a.isCritical && !a.isMilestone && (
  <span className='h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500' />
)}
{isNearCritical(a) && (
  <span className='h-1.5 w-1.5 flex-shrink-0 rounded-full bg-orange-500' />
)}
```

#### 5. Update SVG dependency arrows
```ts
// Near-critical to near-critical arrows in orange
const arrowColor = (succ: ScheduleActivity, pred: ScheduleActivity) => {
  if (succ.isCritical && pred.isCritical) return '#EF4444'
  if (isNearCritical(succ) && isNearCritical(pred)) return '#F97316'
  return '#3B82F6'
}
```

Update the arrows `useMemo` to use this function.

#### 6. Add SVG marker for near-critical arrows
```svg
<marker id='arrow-near-crit' markerWidth='6' markerHeight='6' refX='5' refY='3' orient='auto'>
  <path d='M0,0 L0,6 L6,3 z' fill='#F97316' opacity='0.8' />
</marker>
```

#### 7. Update legend
Add orange entry:
```tsx
['#F97316', 'Near-Critical (TF 1-5d)'],
```

#### 8. Update hover tooltip
In the tooltip text:
```tsx
TF:{a.isCritical ? '0' : isNearCritical(a) ? `${a.totalFloat}d ⚠` : (a.totalFloat ?? '—')}d
```

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
In the Activities tab table, update the float cell:
```tsx
<td className='p-2 text-right text-xs'>
  {a.isMilestone ? <span className='text-purple-600'>MS</span> :
   a.isCritical  ? <span className='font-semibold text-red-600'>0d</span> :
   (a.totalFloat != null && a.totalFloat >= 1 && a.totalFloat <= 5)
     ? <span className='font-semibold text-orange-600'>{a.totalFloat}d ⚠</span> :
   a.totalFloat != null ? `${a.totalFloat}d` : '—'}
</td>
```

## Acceptance Criteria
- [ ] Activities with TF=1 through TF=5 render in orange on Gantt bars
- [ ] Activities with TF=0 remain red (critical)
- [ ] Activities with TF>5 remain blue (non-critical)
- [ ] Legend shows orange entry
- [ ] Activities table float column shows orange text + ⚠ for near-critical
