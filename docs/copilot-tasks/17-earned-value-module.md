# Task 17 — Earned Value Module: Full EV Metrics, S-Curve & Bulk Update (FR-301–306, FR-303, FR-304, FR-305, FR-306)

## Gaps Covered
- PV, EV, AC computation (FR-303)
- SPI / CPI calculation (BRU-02, BRU-03)
- EAC = Total Budget / CPI (BRU-04)
- S-curve chart (PV vs EV vs AC)
- Bulk progress update for multiple activities (FR-305)
- EV summary bar (SPI, CPI, Planned %, Actual %, Days Behind) (FR-306)

Note: Progress slider (FR-301) and actualCost derivation (FR-302) are covered in Task 10. This task builds the full EV metrics engine and S-curve on top of that.

## BRD Refs
- FR-303: PV = sum of budgets for activities planned complete by current day. EV = sum(pct × budget). AC = sum of actual costs.
- FR-304: Dashboard health scores, S-curve, alerts update within 1s of progress change
- FR-305: Bulk progress update
- FR-306: EV summary bar
- BRU-02: SPI = EV/PV
- BRU-03: CPI = EV/AC
- BRU-04: EAC = Total Budget / CPI

## DB Schema Changes
None new beyond what Task 10 establishes.

## Backend Changes

### New endpoint: `POST /projects/:projectId/activities/bulk-progress`

### File: `backend/src/routes/activities.js`
```js
router.post(
  '/bulk-progress',
  requireRoles('pm', 'planning_eng', 'site_engineer'),
  [
    body('updates').isArray({ min: 1 }),
    body('updates.*.activityId').isUUID(),
    body('updates.*.pctComplete').isFloat({ min: 0, max: 100 }).toFloat(),
    validate,
  ],
  asyncHandler(async (req, res) => {
    const result = await activityService.bulkUpdateProgress({
      orgId: req.user.orgId,
      projectId: req.params.projectId,
      userId: req.user.id,
      updates: req.body.updates,
    });
    return sendSuccess(res, result);
  }),
);
```

### File: `backend/src/services/activity.service.js`
```js
const bulkUpdateProgress = async ({ orgId, projectId, userId, updates }) => {
  // Verify project
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const activities = await prisma.activity.findMany({ where: { projectId } });
  const actMap = new Map(activities.map(a => [a.id, a]));

  await prisma.$transaction(
    updates.map(u => {
      const act = actMap.get(u.activityId);
      if (!act) return prisma.$queryRaw`SELECT 1`; // skip missing
      const derivedCost = (u.pctComplete / 100) * (act.budget || 0) * 1.03;
      return prisma.activityProgress.create({
        data: {
          activityId: u.activityId,
          pctComplete: u.pctComplete,
          actualCost: derivedCost,
          updatedBy: userId,
        },
      });
    }),
  );
  return { updated: updates.length };
};
```

## Frontend Changes

### New file: `frontend/src/features/schedule/components/ev-dashboard.tsx`
Full EV dashboard tab content:

```tsx
import { useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { ScheduleActivity } from '../data/schema'

interface Props {
  activities: ScheduleActivity[]
  totalBudget: number
  projectStartDay?: number  // working day 0 = project start
}

export function EvDashboard({ activities, totalBudget, projectStartDay = 0 }: Props) {
  const maxDay = useMemo(() => Math.max(...activities.map(a => a.earlyFinish ?? 0), 30), [activities])

  // Compute EV metrics
  const evMetrics = useMemo(() => {
    const ev = activities.reduce((s, a) => s + (a.pctComplete / 100) * (a.budget || 0), 0)
    const ac = activities.reduce((s, a) => s + (a.actualCost || (a.pctComplete / 100) * (a.budget || 0) * 1.03), 0)
    // PV: sum of budgets of activities that should be complete by "today" (earlyFinish ≤ todayWorkingDay)
    // Use earlyFinish as proxy for planned completion
    const todayDay = projectStartDay  // caller should pass current working day offset
    const pv = activities
      .filter(a => (a.earlyFinish ?? 0) <= todayDay)
      .reduce((s, a) => s + (a.budget || 0), 0)
    const spi = pv > 0 ? ev / pv : 1
    const cpi = ac > 0 ? ev / ac : 1
    const eac = cpi > 0 ? totalBudget / cpi : totalBudget
    const sv = ev - pv  // schedule variance ($)
    const cv = ev - ac  // cost variance ($)
    return { ev, ac, pv, spi, cpi, eac, sv, cv }
  }, [activities, totalBudget, projectStartDay])

  // S-Curve data: cumulative PV, EV, AC by working day
  const sCurveData = useMemo(() => {
    const points: { day: number; pv: number; ev: number; ac: number }[] = []
    for (let d = 0; d <= maxDay; d += Math.max(1, Math.floor(maxDay / 30))) {
      const pvAtD = activities
        .filter(a => (a.earlyFinish ?? 0) <= d)
        .reduce((s, a) => s + (a.budget || 0), 0)
      // EV at day d: only activities that should be done by d, weighted by actual %
      const evAtD = activities
        .filter(a => (a.earlyFinish ?? 0) <= d)
        .reduce((s, a) => s + (a.pctComplete / 100) * (a.budget || 0), 0)
      const acAtD = activities
        .filter(a => (a.earlyFinish ?? 0) <= d)
        .reduce((s, a) => s + (a.actualCost || (a.pctComplete / 100) * (a.budget || 0) * 1.03), 0)
      points.push({ day: d, pv: pvAtD, ev: evAtD, ac: acAtD })
    }
    return points
  }, [activities, maxDay])

  const fmtUSD = (n: number) => '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 })

  return (
    <div className='space-y-6'>
      {/* Metric cards */}
      <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
        {[
          { label: 'SPI', value: evMetrics.spi.toFixed(2), color: evMetrics.spi < 0.9 ? 'text-red-600' : 'text-green-600', sub: evMetrics.spi < 1 ? 'Behind schedule' : 'On schedule' },
          { label: 'CPI', value: evMetrics.cpi.toFixed(2), color: evMetrics.cpi < 0.9 ? 'text-red-600' : 'text-green-600', sub: evMetrics.cpi < 1 ? 'Over budget' : 'Under budget' },
          { label: 'EAC', value: fmtUSD(evMetrics.eac), color: 'text-amber-600', sub: 'Estimate at completion' },
          { label: 'SV', value: fmtUSD(evMetrics.sv), color: evMetrics.sv < 0 ? 'text-red-600' : 'text-green-600', sub: 'Schedule variance ($)' },
          { label: 'EV', value: fmtUSD(evMetrics.ev), sub: 'Earned value' },
          { label: 'PV', value: fmtUSD(evMetrics.pv), sub: 'Planned value' },
          { label: 'AC', value: fmtUSD(evMetrics.ac), sub: 'Actual cost' },
          { label: 'CV', value: fmtUSD(evMetrics.cv), color: evMetrics.cv < 0 ? 'text-red-600' : 'text-green-600', sub: 'Cost variance ($)' },
        ].map(c => (
          <div key={c.label} className='rounded-lg border bg-card p-3'>
            <p className='text-xs uppercase tracking-wide text-muted-foreground'>{c.label}</p>
            <p className={`mt-1 text-xl font-bold ${c.color ?? ''}`}>{c.value}</p>
            {c.sub && <p className='mt-0.5 text-xs text-muted-foreground'>{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* Alerts */}
      {(evMetrics.spi < 0.9 || evMetrics.cpi < 0.9) && (
        <div className='rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800'>
          ⚠ Performance alert:
          {evMetrics.spi < 0.9 && ` SPI ${evMetrics.spi.toFixed(2)} — schedule slippage detected.`}
          {evMetrics.cpi < 0.9 && ` CPI ${evMetrics.cpi.toFixed(2)} — cost overrun detected.`}
        </div>
      )}

      {/* S-Curve */}
      <div>
        <h3 className='mb-2 text-sm font-semibold'>S-Curve (PV vs EV vs AC)</h3>
        <ResponsiveContainer width='100%' height={280}>
          <LineChart data={sCurveData}>
            <CartesianGrid strokeDasharray='3 3' />
            <XAxis dataKey='day' label={{ value: 'Working Days', position: 'insideBottom', offset: -2 }} />
            <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmtUSD(v)} labelFormatter={d => `Day ${d}`} />
            <Legend />
            <Line type='monotone' dataKey='pv' stroke='#3B82F6' name='PV (Planned)' dot={false} strokeWidth={2} />
            <Line type='monotone' dataKey='ev' stroke='#22C55E' name='EV (Earned)' dot={false} strokeWidth={2} />
            <Line type='monotone' dataKey='ac' stroke='#EF4444' name='AC (Actual)' dot={false} strokeWidth={2} strokeDasharray='4 4' />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Bulk update section (FR-305) */}
      <BulkProgressUpdate activities={activities} projectId={/*passed as prop*/''} />
    </div>
  )
}
```

### New file: `frontend/src/features/schedule/components/bulk-progress-update.tsx`
```tsx
// Allows selecting multiple activities and setting all to same % value
// Uses checkbox selection + a shared slider/input
// On confirm: calls POST /projects/:projectId/activities/bulk-progress
```

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
Add new **Earned Value** tab:
```tsx
<TabsTrigger value='ev'>Earned Value</TabsTrigger>
...
<TabsContent value='ev'>
  <EvDashboard
    activities={activities}
    totalBudget={revision.totalBudget}
    projectStartDay={todayWorkingDay}
  />
</TabsContent>
```

## Acceptance Criteria
- [ ] EV tab shows 8 metric cards: SPI, CPI, EAC, EV, PV, AC, SV, CV
- [ ] S-curve chart renders PV, EV, AC lines over working days
- [ ] SPI < 0.9 or CPI < 0.9 shows red alert
- [ ] Bulk progress: selecting multiple activities + setting % calls bulk endpoint
- [ ] EAC = totalBudget / CPI (updates when any activity progress changes)
