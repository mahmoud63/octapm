# Task 45 — Weekly Progress Report (FR-401)

## Gap Covered
- Weekly progress report: activities completed this week, planned vs actual, weather delays, issues

## BRD Refs
- FR-401: Weekly progress report with planned vs actual comparison and issues summary

## DB Schema Changes

### Add `WeeklyReport` model
```prisma
model WeeklyReport {
  id              String    @id @default(uuid())
  projectId       String
  ref             String    // WR-01
  weekStartDate   DateTime
  weekEndDate     DateTime
  preparedBy      String?
  weatherCondition String?  // good, fair, poor
  weatherDelayDays Int      @default(0)
  plannedProgress Float     @default(0)  // % planned for this week
  actualProgress  Float     @default(0)  // % achieved this week
  manpowerCount   Int       @default(0)
  activitiesCompleted Json  @default("[]")   // [activityId, ...]
  activitiesInProgress Json @default("[]")
  issuesSummary   String?
  nextWeekPlan    String?
  remarks         String?
  status          String    @default("draft") // draft, submitted, approved
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
  @@index([weekStartDate])
}
```

Add `weeklyReports WeeklyReport[]` to `Project`.

Run migration: `npx prisma migrate dev --name add_weekly_report`

## Backend Changes

### New file: `backend/src/routes/weekly-reports.js`
```
GET    /projects/:projectId/weekly-reports
POST   /projects/:projectId/weekly-reports
PATCH  /projects/:projectId/weekly-reports/:id
DELETE /projects/:projectId/weekly-reports/:id
GET    /projects/:projectId/weekly-reports/current   — returns current week's report (or creates draft)
```
Roles: PM, planning_eng, site_engineer.

```js
const { Router } = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { HttpError } = require('../utils/errors');

const router = Router({ mergeParams: true });
router.use(authenticate);

function getWeekBounds(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToSun = d.getDate() - day;
  const start = new Date(d.setDate(diffToSun));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

router.get('/', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const reports = await prisma.weeklyReport.findMany({
    where: { projectId },
    orderBy: { weekStartDate: 'desc' },
  });
  return sendSuccess(res, reports);
}));

router.get('/current', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { start, end } = getWeekBounds();

  let report = await prisma.weeklyReport.findFirst({
    where: { projectId, weekStartDate: { gte: start }, weekEndDate: { lte: end } },
  });

  if (!report) {
    // Auto-snapshot: count activities completed vs planned this week
    const allActivities = await prisma.activity.findMany({ where: { projectId } });
    const completed = allActivities.filter(a => a.status === 'complete').map(a => a.id);
    const inProgress = allActivities.filter(a => a.status === 'in_progress').map(a => a.id);
    const avgProgress = allActivities.length
      ? allActivities.reduce((s, a) => s + (a.percentComplete ?? 0), 0) / allActivities.length
      : 0;

    const count = await prisma.weeklyReport.count({ where: { projectId } });
    const ref = `WR-${String(count + 1).padStart(2, '0')}`;

    report = await prisma.weeklyReport.create({
      data: {
        projectId,
        ref,
        weekStartDate: start,
        weekEndDate: end,
        actualProgress: parseFloat(avgProgress.toFixed(1)),
        activitiesCompleted: completed,
        activitiesInProgress: inProgress,
        status: 'draft',
      },
    });
  }

  return sendSuccess(res, report);
}));

router.post('/', requireRoles('pm', 'planning_eng', 'site_engineer'), [
  body('weekStartDate').isISO8601(),
], validate, asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const count = await prisma.weeklyReport.count({ where: { projectId } });
  const ref = `WR-${String(count + 1).padStart(2, '0')}`;

  const report = await prisma.weeklyReport.create({
    data: { ...req.body, projectId, ref },
  });

  return sendSuccess(res, report, 201);
}));

router.patch('/:id', requireRoles('pm', 'planning_eng', 'site_engineer'), asyncHandler(async (req, res) => {
  const { projectId, id } = req.params;
  const existing = await prisma.weeklyReport.findFirst({ where: { id, projectId } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Report not found');

  const report = await prisma.weeklyReport.update({ where: { id }, data: req.body });
  return sendSuccess(res, report);
}));

router.delete('/:id', requireRoles('pm'), asyncHandler(async (req, res) => {
  const { projectId, id } = req.params;
  const existing = await prisma.weeklyReport.findFirst({ where: { id, projectId } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Report not found');

  await prisma.weeklyReport.delete({ where: { id } });
  return sendSuccess(res, { deleted: true });
}));

module.exports = router;
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/weekly-reports', require('./weekly-reports'));`

## Frontend Changes

### New file: `frontend/src/features/reports/components/weekly-progress-report.tsx`

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useState } from 'react'

interface Props { projectId: string }

const STATUS_BADGE = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
}

export function WeeklyProgressReport({ projectId }: Props) {
  const [editId, setEditId] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: reports } = useQuery({
    queryKey: ['weekly-reports', projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/weekly-reports`).then(r => r.data.data),
  })

  const { data: current } = useQuery({
    queryKey: ['weekly-reports', projectId, 'current'],
    queryFn: () => apiClient.get(`/projects/${projectId}/weekly-reports/current`).then(r => r.data.data),
  })

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/projects/${projectId}/weekly-reports/${id}`, { status: 'submitted' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['weekly-reports', projectId] }),
  })

  const list = reports ?? []

  return (
    <div className='space-y-4'>
      {/* Current week card */}
      {current && (
        <div className='rounded-lg border p-4 space-y-3 bg-muted/20'>
          <div className='flex items-center justify-between'>
            <h3 className='font-semibold'>Current Week — {current.ref}</h3>
            <Badge className={STATUS_BADGE[current.status as keyof typeof STATUS_BADGE] ?? ''}>
              {current.status}
            </Badge>
          </div>
          <div className='grid grid-cols-3 gap-3 text-sm'>
            <div>
              <p className='text-muted-foreground text-xs'>Planned Progress</p>
              <p className='text-lg font-bold'>{current.plannedProgress ?? 0}%</p>
            </div>
            <div>
              <p className='text-muted-foreground text-xs'>Actual Progress</p>
              <p className='text-lg font-bold text-green-600'>{current.actualProgress ?? 0}%</p>
            </div>
            <div>
              <p className='text-muted-foreground text-xs'>Variance</p>
              <p className={`text-lg font-bold ${(current.actualProgress - current.plannedProgress) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {((current.actualProgress ?? 0) - (current.plannedProgress ?? 0)).toFixed(1)}%
              </p>
            </div>
          </div>
          <div className='grid grid-cols-3 gap-3 text-sm'>
            <div>
              <p className='text-xs text-muted-foreground'>Completed Activities</p>
              <p className='font-bold'>{Array.isArray(current.activitiesCompleted) ? current.activitiesCompleted.length : 0}</p>
            </div>
            <div>
              <p className='text-xs text-muted-foreground'>In Progress</p>
              <p className='font-bold'>{Array.isArray(current.activitiesInProgress) ? current.activitiesInProgress.length : 0}</p>
            </div>
            <div>
              <p className='text-xs text-muted-foreground'>Weather Delay</p>
              <p className='font-bold'>{current.weatherDelayDays}d</p>
            </div>
          </div>
          {current.status === 'draft' && (
            <Button size='sm' onClick={() => submitMutation.mutate(current.id)}>Submit Report</Button>
          )}
        </div>
      )}

      {/* History table */}
      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              {['Ref', 'Week', 'Planned %', 'Actual %', 'Variance', 'Manpower', 'Weather Delay', 'Status'].map(h => (
                <th key={h} className='px-3 py-2 text-left font-medium'>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r: any) => {
              const variance = (r.actualProgress ?? 0) - (r.plannedProgress ?? 0)
              return (
                <tr key={r.id} className='border-t hover:bg-muted/30'>
                  <td className='px-3 py-2 font-mono text-xs'>{r.ref}</td>
                  <td className='px-3 py-2 text-xs'>
                    {new Date(r.weekStartDate).toLocaleDateString('en-GB')} – {new Date(r.weekEndDate).toLocaleDateString('en-GB')}
                  </td>
                  <td className='px-3 py-2'>{r.plannedProgress}%</td>
                  <td className='px-3 py-2'>{r.actualProgress}%</td>
                  <td className={`px-3 py-2 font-medium ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {variance >= 0 ? '+' : ''}{variance.toFixed(1)}%
                  </td>
                  <td className='px-3 py-2'>{r.manpowerCount}</td>
                  <td className='px-3 py-2'>{r.weatherDelayDays}d</td>
                  <td className='px-3 py-2'>
                    <Badge className={STATUS_BADGE[r.status as keyof typeof STATUS_BADGE] ?? ''}>{r.status}</Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

Add a **Reports** tab to `project-detail.tsx` containing `<WeeklyProgressReport projectId={projectId} />`.

## Acceptance Criteria
- [ ] Current week report auto-created as draft if none exists
- [ ] Planned vs actual progress variance shown with green/red colour
- [ ] Submit button advances status from draft → submitted
- [ ] Weekly history table shows all past reports
- [ ] Ref auto-generated WR-01, WR-02, …
- [ ] activitiesCompleted and activitiesInProgress auto-snapshotted from live activity data on creation
