# Task 10 — Activities: Progress Slider & Real-Time EV Input (FR-301, FR-302)

## Gap Covered
- No interactive progress slider in project details
- pctComplete is display-only; users cannot update it from the schedule dashboard

## BRD Refs
- FR-301: Each non-milestone activity shall have a progress slider (0-100%) in the Progress tab
- FR-302: When progress updated, actualCost = (pct/100) * budget * 1.03 (default cost factor) unless explicitly overridden

## DB Schema Changes
`ActivityProgress` already exists:
```prisma
model ActivityProgress {
  id           String    @id @default(uuid())
  activityId   String
  pctComplete  Float     @default(0)
  actualCost   Float?
  actualStart  DateTime?
  actualFinish DateTime?
  notes        String?
  updatedBy    String?
  updatedAt    DateTime  @default(now())
  activity     Activity  @relation(...)
}
```
No new fields needed.

## Backend Changes

### File: `backend/src/routes/activities.js`
Add a progress update endpoint:
```js
// POST /projects/:projectId/activities/:id/progress
router.post(
  '/:id/progress',
  requireRoles('pm', 'planning_eng', 'site_engineer'),
  [
    param('id').isUUID(),
    body('pctComplete').isFloat({ min: 0, max: 100 }).toFloat(),
    body('actualCost').optional().isFloat({ min: 0 }).toFloat(),
    body('actualStart').optional().isISO8601(),
    body('actualFinish').optional().isISO8601(),
    body('notes').optional().isString().trim(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.updateProgress({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      activityId: req.params.id,
      userId: req.user.id,
      payload: req.body,
    });
    return sendSuccess(res, result);
  }),
);
```

### File: `backend/src/services/activity.service.js`
```js
const updateProgress = async ({ orgId, projectId, activityId, userId, payload }) => {
  // Verify project/activity belongs to org
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, projectId, project: { orgId } },
  });
  if (!activity) throw new HttpError(404, 'ACTIVITY_NOT_FOUND', 'Activity not found');

  const { pctComplete, actualCost, actualStart, actualFinish, notes } = payload;

  // BRD FR-302: auto-derive actualCost if not provided
  const derivedCost = actualCost != null
    ? actualCost
    : (pctComplete / 100) * (activity.budget || 0) * 1.03;

  // Upsert latest progress record (we keep only the most recent per activity for simplicity)
  const progress = await prisma.activityProgress.upsert({
    where: { activityId_latest: activityId }, // see note below
    update: { pctComplete, actualCost: derivedCost, actualStart, actualFinish, notes, updatedBy: userId, updatedAt: new Date() },
    create: { activityId, pctComplete, actualCost: derivedCost, actualStart, actualFinish, notes, updatedBy: userId },
  });

  // BRD: auto-status based on pctComplete
  // 0% = to_do, 1-99% = in_progress, 100% = complete
  // past end date <100% = delayed
  let status = 'to_do';
  if (pctComplete >= 100) status = 'complete';
  else if (pctComplete > 0) status = 'in_progress';
  else if (activity.endDate && new Date() > new Date(activity.endDate) && pctComplete < 100) status = 'delayed';

  await prisma.activity.update({ where: { id: activityId }, data: { status } });

  return progress;
};
```

**Note on upsert:** Add a unique index on `ActivityProgress` for latest record per activity, OR use `findFirst` + `update`/`create` pattern. Simpler approach: just `create` each time (audit trail) and return the latest via `findFirst({ orderBy: { updatedAt: 'desc' } })`.

### Also update `listActivities` in `activity.service.js`
Include latest progress in activity list:
```js
include: {
  progress: { orderBy: { updatedAt: 'desc' }, take: 1 },
}
```
Return `pctComplete` and `actualCost` from the latest progress record.

## Frontend Changes

### New file: `frontend/src/features/schedule/components/progress-tab.tsx`
A dedicated "Progress" tab on the schedule dashboard:

```tsx
export function ProgressTab({ activities, projectId }: { activities: ScheduleActivity[], projectId: string }) {
  const queryClient = useQueryClient()
  const [localPct, setLocalPct] = useState<Record<string, number>>(() =>
    Object.fromEntries(activities.map(a => [a.id, a.pctComplete]))
  )

  const mutation = useMutation({
    mutationFn: ({ activityId, pctComplete }: { activityId: string; pctComplete: number }) =>
      apiClient.post(`/projects/${projectId}/activities/${activityId}/progress`, { pctComplete }),
    onSuccess: () => queryClient.invalidateQueries(['schedule', projectId]),
  })

  const handleSliderCommit = (activityId: string, value: number) => {
    mutation.mutate({ activityId, pctComplete: value })
  }

  // EV summary bar (FR-306) computed from localPct
  const ev = useMemo(() => {
    const totalBudget = activities.reduce((s, a) => s + (a.budget || 0), 0)
    const ev = activities.reduce((s, a) => s + (localPct[a.id] ?? a.pctComplete) / 100 * (a.budget || 0), 0)
    const planned = activities.filter(a => a.status !== 'to_do').reduce((s, a) => s + (a.budget || 0), 0)
    const ac = ev * 1.03  // FR-302 default cost factor
    const spi = planned > 0 ? ev / planned : 1
    const cpi = ac > 0 ? ev / ac : 1
    return { ev, planned, ac, spi, cpi, totalBudget }
  }, [activities, localPct])

  return (
    <div className='space-y-4'>
      {/* EV Summary Bar (FR-306) */}
      <div className='grid grid-cols-2 sm:grid-cols-5 gap-3'>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>SPI</p>
          <p className={`text-xl font-bold ${ev.spi < 0.9 ? 'text-red-600' : 'text-green-600'}`}>
            {ev.spi.toFixed(2)}
          </p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>CPI</p>
          <p className={`text-xl font-bold ${ev.cpi < 0.9 ? 'text-red-600' : 'text-green-600'}`}>
            {ev.cpi.toFixed(2)}
          </p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>EV</p>
          <p className='text-xl font-bold'>${ev.ev.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>PV</p>
          <p className='text-xl font-bold'>${ev.planned.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-xs text-muted-foreground'>AC</p>
          <p className='text-xl font-bold'>${ev.ac.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      {/* SPI/CPI alert (FR-304) */}
      {(ev.spi < 0.9 || ev.cpi < 0.9) && (
        <div className='rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800'>
          ⚠ {ev.spi < 0.9 && `SPI ${ev.spi.toFixed(2)} — project is behind schedule. `}
          {ev.cpi < 0.9 && `CPI ${ev.cpi.toFixed(2)} — project is over budget.`}
        </div>
      )}

      {/* Activity sliders */}
      <div className='rounded-md border divide-y'>
        {activities.filter(a => !a.isMilestone).map(a => (
          <div key={a.id} className='flex items-center gap-4 p-3'>
            <div className='w-48 min-w-0'>
              <p className='truncate text-sm font-medium'>{a.name}</p>
              <p className='text-xs text-muted-foreground'>{a.category} · {a.duration}d</p>
            </div>
            <input
              type='range'
              min={0} max={100} step={1}
              value={localPct[a.id] ?? a.pctComplete}
              className='flex-1'
              onChange={e => setLocalPct(p => ({ ...p, [a.id]: Number(e.target.value) }))}
              onMouseUp={e => handleSliderCommit(a.id, Number((e.target as HTMLInputElement).value))}
              onTouchEnd={e => handleSliderCommit(a.id, localPct[a.id] ?? a.pctComplete)}
            />
            <span className='w-10 text-right text-sm font-mono'>
              {localPct[a.id] ?? a.pctComplete}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
Add Progress tab:
```tsx
import { ProgressTab } from './progress-tab'

// In TabsList:
<TabsTrigger value='progress'>Progress</TabsTrigger>

// In TabsContent:
<TabsContent value='progress'>
  <ProgressTab activities={activities} projectId={projectId} />
</TabsContent>
```

Also update the `ScheduleActivity` type (schema.ts) to include `status` field if not already present.

## Acceptance Criteria
- [ ] Progress tab shows all non-milestone activities with sliders
- [ ] Dragging slider updates local value immediately (optimistic UI)
- [ ] On slider release, PATCH is sent to backend and progress saved
- [ ] EV summary bar (SPI, CPI, EV, PV, AC) updates as sliders change
- [ ] SPI < 0.9 or CPI < 0.9 shows red alert banner
- [ ] actualCost auto-derived as pctComplete/100 × budget × 1.03
- [ ] Milestone activities excluded from slider list
