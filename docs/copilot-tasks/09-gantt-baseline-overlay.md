# Task 09 — Gantt: Baseline vs Actual Bar Overlay

## Gap Covered
- No baseline comparison — cannot see planned vs actual bar positions

## BRD Refs
- FR-107: Compare revisions. Implies visual diff between baseline and current schedule.

## DB Schema Changes

### Add `baselineStart` and `baselineFinish` to `Activity`
```prisma
// In Activity model, add:
baselineStart  Int? // working days from day 0 at time of baseline lock
baselineFinish Int? // working days from day 0 at time of baseline lock
```

Run migration: `npx prisma migrate dev --name add_activity_baseline`

## Backend Changes

### File: `backend/src/routes/schedule.js`
Add a baseline lock endpoint:
```js
// POST /projects/:projectId/schedule/baseline — snapshot current earlyStart/earlyFinish as baseline
router.post('/baseline', requireRoles('pm', 'planning_eng'), asyncHandler(async (req, res) => {
  const result = await scheduleService.lockBaseline({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
  });
  return sendSuccess(res, result);
}));
```

### File: `backend/src/services/schedule.service.js`
```js
const lockBaseline = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const activities = await prisma.activity.findMany({ where: { projectId } });
  await prisma.$transaction(
    activities.map(a =>
      prisma.activity.update({
        where: { id: a.id },
        data: { baselineStart: a.earlyStart, baselineFinish: a.earlyFinish },
      }),
    ),
  );
  return { locked: activities.length };
};
```

Also update `getProjectSchedule` to return `baselineStart` and `baselineFinish` in activity records.

## Frontend Changes

### File: `frontend/src/features/schedule/data/schema.ts`
Add to `scheduleActivitySchema`:
```ts
baselineStart: z.number().int().nullable().optional(),
baselineFinish: z.number().int().nullable().optional(),
```

### File: `frontend/src/features/schedule/components/gantt-chart.tsx`

#### 1. Add baseline toggle
```tsx
const [showBaseline, setShowBaseline] = useState(false)
```
Above the Gantt, add a checkbox:
```tsx
<label className='flex items-center gap-2 text-xs'>
  <input type='checkbox' checked={showBaseline} onChange={e => setShowBaseline(e.target.checked)} />
  Show baseline
</label>
```

#### 2. Render baseline bars (thin, grey, slightly above the main bar)
When `showBaseline && a.baselineStart != null`:
```tsx
<rect
  x={(a.baselineStart ?? 0) * PX_PER_DAY}
  y={by - 5}
  width={Math.max(4, ((a.baselineFinish ?? 0) - (a.baselineStart ?? 0)) * PX_PER_DAY)}
  height={4}
  fill='#94A3B8'   // slate-400
  opacity={0.6}
  rx={1}
/>
```

#### 3. Slippage arrow
If `a.earlyStart > (a.baselineStart ?? 0)` and `showBaseline`, draw a small right-pointing arrow in amber from baseline end to current start.

#### 4. Update legend when baseline visible
```tsx
{showBaseline && ['#94A3B8', 'Baseline'].map(...)}
```

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
Add a **Lock Baseline** button:
```tsx
<Button variant='outline' size='sm' onClick={handleLockBaseline}>
  Lock Baseline
</Button>
```

```tsx
const handleLockBaseline = async () => {
  if (!confirm('Lock current schedule as baseline? This overwrites the previous baseline.')) return
  await apiClient.post(`/projects/${projectId}/schedule/baseline`)
  toast.success('Baseline locked')
  queryClient.invalidateQueries(['schedule', projectId])
}
```

## Acceptance Criteria
- [ ] "Lock Baseline" button saves current earlyStart/earlyFinish to baselineStart/baselineFinish
- [ ] "Show baseline" checkbox toggles thin grey bars on Gantt
- [ ] Activities with no baseline (baselineStart is null) show no grey bar
- [ ] Slippage is visually clear when current start is later than baseline start
- [ ] Legend updates when baseline visible
