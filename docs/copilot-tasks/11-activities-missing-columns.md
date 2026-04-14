# Task 11 — Activities Table: Missing Columns (LS/LF, Predecessors, Actual Dates)

## Gaps Covered
- Late Start / Late Finish columns not shown
- Predecessors column not shown
- Actual start / actual finish columns not shown

## BRD Refs
- FR-204: ES/EF/LS/LF/TF imported/calculated and displayed
- FR-205: Actual start/finish imported from P6 or entered by users

## DB Schema Changes
All fields exist:
- `Activity.lateStart`, `Activity.lateFinish` — already stored
- `Activity.predecessors` — stored as comma-separated string
- `ActivityProgress.actualStart`, `ActivityProgress.actualFinish` — already stored

No new fields needed.

## Backend Changes

### File: `backend/src/services/activity.service.js`
In `listActivities`, include latest progress with actual dates:
```js
const activities = await prisma.activity.findMany({
  where: { projectId, project: { orgId } },
  orderBy: { sortOrder: 'asc' },
  include: {
    progress: {
      orderBy: { updatedAt: 'desc' },
      take: 1,
      select: { pctComplete: true, actualCost: true, actualStart: true, actualFinish: true },
    },
  },
});

// Flatten latest progress onto each activity
return activities.map(a => ({
  ...a,
  pctComplete: a.progress[0]?.pctComplete ?? 0,
  actualCost: a.progress[0]?.actualCost ?? null,
  actualStart: a.progress[0]?.actualStart ?? null,
  actualFinish: a.progress[0]?.actualFinish ?? null,
  progress: undefined, // remove nested array from response
}));
```

Also ensure `getProjectSchedule` in `schedule.service.js` returns these fields. Currently the activities query in that function maps activity fields — verify `lateStart`, `lateFinish`, `predecessors`, and the progress flatten are all included.

## Frontend Changes

### File: `frontend/src/features/schedule/data/schema.ts`
Ensure these fields exist in `scheduleActivitySchema`:
```ts
lateStart: z.number().int().nullable().optional(),
lateFinish: z.number().int().nullable().optional(),
predecessors: z.string().nullable().optional(),
actualStart: z.string().nullable().optional(),   // ISO date string
actualFinish: z.string().nullable().optional(),
actualCost: z.number().nullable().optional(),
```

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`

In the **Activities tab** table, add new columns after the existing ones. Make the table horizontally scrollable:

```tsx
// Wrap table in overflow-x-auto div
<div className='rounded-md border overflow-x-auto'>
  <table className='w-full text-sm whitespace-nowrap'>
    <thead className='border-b bg-muted/50'>
      <tr>
        {/* existing columns */}
        <th className='p-2 text-left font-medium'>WBS</th>
        <th className='p-2 text-left font-medium'>Activity</th>
        <th className='p-2 text-left font-medium'>Phase</th>
        <th className='p-2 text-right font-medium'>Dur</th>
        <th className='p-2 text-right font-medium'>ES</th>
        <th className='p-2 text-right font-medium'>EF</th>
        {/* new columns */}
        <th className='p-2 text-right font-medium'>LS</th>
        <th className='p-2 text-right font-medium'>LF</th>
        <th className='p-2 text-right font-medium'>Float</th>
        <th className='p-2 text-left font-medium'>Predecessors</th>
        <th className='p-2 text-right font-medium'>Budget</th>
        <th className='p-2 text-center font-medium'>Status</th>
        <th className='p-2 text-right font-medium'>%</th>
        <th className='p-2 text-right font-medium'>Act. Start</th>
        <th className='p-2 text-right font-medium'>Act. Finish</th>
      </tr>
    </thead>
    <tbody>
      {activities.map(a => (
        <tr key={a.id} className={...}>
          {/* existing cells */}
          ...
          {/* new cells */}
          <td className='p-2 text-right text-xs font-mono'>{a.lateStart ?? '—'}</td>
          <td className='p-2 text-right text-xs font-mono'>{a.lateFinish ?? '—'}</td>
          {/* float cell — already exists, keep it */}
          <td className='p-2 max-w-[140px] text-xs text-muted-foreground truncate' title={a.predecessors ?? ''}>
            {a.predecessors || '—'}
          </td>
          {/* budget, status, % — existing */}
          ...
          <td className='p-2 text-right text-xs'>
            {a.actualStart ? new Date(a.actualStart).toLocaleDateString() : '—'}
          </td>
          <td className='p-2 text-right text-xs'>
            {a.actualFinish ? new Date(a.actualFinish).toLocaleDateString() : '—'}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

### Column visibility toggle (optional but recommended)
Add a column visibility dropdown (shadcn DropdownMenu) letting users show/hide optional columns. Store preference in `localStorage`.

## Acceptance Criteria
- [ ] LS and LF columns visible in Activities table
- [ ] Predecessors column shows comma-separated predecessor codes; truncated with tooltip for long strings
- [ ] Actual Start and Actual Finish columns show dates from latest `ActivityProgress` record
- [ ] Columns show `—` when null/empty (not `0` or blank)
- [ ] Table scrolls horizontally on narrow screens
