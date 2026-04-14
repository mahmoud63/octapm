# Task 49 — PM Dashboard: 7-Dimension Health Score (BR-006)

## Gap Covered
- 7-dimension project health dashboard: Schedule, Cost, Commercial, Supply Chain, Quality, Safety, Document Control

## BRD Refs
- BR-006: 7-dimension health dashboard visible on project overview
- BRU-02/03: SPI/CPI thresholds feed Schedule/Cost dimensions
- BRU-10: Quality score feeds Quality dimension

## DB Schema Changes
None — computed from live module data.

## Backend Changes

### New endpoint: `GET /projects/:projectId/health`

### File: `backend/src/routes/projects.js` (or new `health.js`)
Add health endpoint:

```js
// New file: backend/src/routes/health.js
const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const prisma = require('../config/db');
const { HttpError } = require('../utils/errors');

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: req.user.orgId },
  });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const [activities, ncrs, itps, incidents, submittals, rfis, drawings, procOrders] = await Promise.all([
    prisma.activity.findMany({ where: { projectId } }),
    prisma.ncrRecord.findMany({ where: { projectId, status: { not: 'closed' } } }).catch(() => []),
    prisma.itpRecord.findMany({ where: { projectId, status: 'failed' } }).catch(() => []),
    prisma.safetyIncident.findMany({ where: { projectId } }).catch(() => []),
    prisma.submittal.findMany({ where: { projectId } }).catch(() => []),
    prisma.rfi.findMany({ where: { projectId } }).catch(() => []),
    prisma.drawingRecord.findMany({ where: { projectId } }).catch(() => []),
    prisma.procurementOrder.findMany({ where: { projectId } }).catch(() => []),
  ]);

  // ── 1. Schedule Health ────────────────────────────────────────────────
  const totalBudget = activities.reduce((s, a) => s + (a.budget || 0), 0);
  const ev = activities.reduce((s, a) => s + ((a.percentComplete || 0) / 100) * (a.budget || 0), 0);
  const today = new Date();
  const pv = activities
    .filter(a => a.earlyFinish && new Date(a.earlyFinish) <= today)
    .reduce((s, a) => s + (a.budget || 0), 0);
  const spi = pv > 0 ? ev / pv : 1;
  const delayedCount = activities.filter(a =>
    a.earlyFinish && new Date(a.earlyFinish) < today && (a.percentComplete ?? 0) < 100
  ).length;

  const scheduleScore = Math.max(0, Math.min(100,
    spi >= 1 ? 100 : spi >= 0.9 ? 80 : spi >= 0.75 ? 60 : 40
  ));

  // ── 2. Cost Health ────────────────────────────────────────────────────
  const ac = activities.reduce((s, a) => s + (a.actualCost || 0), 0);
  const cpi = ac > 0 && ev > 0 ? ev / ac : 1;

  const costScore = Math.max(0, Math.min(100,
    cpi >= 1 ? 100 : cpi >= 0.9 ? 80 : cpi >= 0.75 ? 60 : 40
  ));

  // ── 3. Commercial Health ──────────────────────────────────────────────
  const pendingCOs = await prisma.changeOrder.count({ where: { projectId, status: 'pending' } }).catch(() => 0);
  const commercialScore = Math.max(0, 100 - pendingCOs * 10);

  // ── 4. Supply Chain Health ────────────────────────────────────────────
  const overduePO = procOrders.filter(p =>
    p.expectedDelivery && new Date(p.expectedDelivery) < today && p.status !== 'delivered'
  ).length;
  const supplyScore = Math.max(0, 100 - overduePO * 15);

  // ── 5. Quality Health (BRU-10) ────────────────────────────────────────
  const majorNCRs = ncrs.filter(n => n.severity === 'major').length;
  const minorNCRs = ncrs.filter(n => n.severity === 'minor').length;
  const failedITPs = itps.length;
  const qualityScore = Math.max(0, 100 - (majorNCRs * 20) - (minorNCRs * 8) - (failedITPs * 15));

  // ── 6. Safety Health ──────────────────────────────────────────────────
  const ltiCount = incidents.filter(i => i.incidentType === 'lti').length;
  const fatalityCount = incidents.filter(i => i.incidentType === 'fatality').length;
  const openInv = incidents.filter(i => i.investigationStatus === 'open').length;
  const safetyScore = Math.max(0, 100 - (fatalityCount * 100) - (ltiCount * 20) - (openInv * 5));

  // ── 7. Document Control Health ────────────────────────────────────────
  const overdueRfis = rfis.filter(r =>
    r.dueDate && new Date(r.dueDate) < today && r.status === 'open'
  ).length;
  const pendingSubmittals = submittals.filter(s => s.status === 'pending' || s.status === 'revise_resubmit').length;
  const ifcCount = drawings.filter(d => d.status === 'ifc').length;
  const totalDrawings = drawings.length;
  const ifcRatio = totalDrawings > 0 ? ifcCount / totalDrawings : 1;

  const docScore = Math.max(0, Math.min(100,
    100 - (overdueRfis * 10) - (pendingSubmittals * 5) + (ifcRatio * 10)
  ));

  // ── Overall score (equal weights) ────────────────────────────────────
  const dimensions = [
    { key: 'schedule',      label: 'Schedule',         score: Math.round(scheduleScore),  detail: { spi: spi.toFixed(2), delayed: delayedCount } },
    { key: 'cost',          label: 'Cost',             score: Math.round(costScore),       detail: { cpi: cpi.toFixed(2) } },
    { key: 'commercial',    label: 'Commercial',       score: Math.round(commercialScore), detail: { pendingChangeOrders: pendingCOs } },
    { key: 'supplyChain',   label: 'Supply Chain',     score: Math.round(supplyScore),     detail: { overduePOs: overduePO } },
    { key: 'quality',       label: 'Quality',          score: Math.round(qualityScore),    detail: { majorNCRs, minorNCRs, failedITPs } },
    { key: 'safety',        label: 'Safety',           score: Math.round(safetyScore),     detail: { ltiCount, fatalityCount, openInvestigations: openInv } },
    { key: 'docControl',    label: 'Doc Control',      score: Math.round(Math.min(100, docScore)), detail: { overdueRfis, pendingSubmittals, ifcRatio: (ifcRatio * 100).toFixed(0) + '%' } },
  ];

  const overallScore = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);

  return sendSuccess(res, { overallScore, dimensions });
}));

module.exports = router;
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/health', require('./health'));`

## Frontend Changes

### New file: `frontend/src/features/projects/components/health-dashboard.tsx`

```tsx
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'

interface Props { projectId: string }

function scoreColor(score: number) {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#f59e0b'
  return '#ef4444'
}

function scoreLabel(score: number) {
  if (score >= 80) return 'Good'
  if (score >= 60) return 'Fair'
  return 'Poor'
}

function DimensionCard({ label, score, detail }: { label: string; score: number; detail: Record<string, any> }) {
  const color = scoreColor(score)
  return (
    <div className='rounded-lg border p-3 space-y-2'>
      <div className='flex items-center justify-between'>
        <p className='text-sm font-medium'>{label}</p>
        <span
          className='text-xs rounded-full px-2 py-0.5 font-semibold'
          style={{ background: `${color}20`, color }}
        >
          {scoreLabel(score)}
        </span>
      </div>
      {/* Mini progress bar */}
      <div className='h-1.5 rounded-full bg-muted overflow-hidden'>
        <div
          className='h-1.5 rounded-full transition-all'
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <div className='flex items-center justify-between'>
        <p className='text-xs text-muted-foreground'>
          {Object.entries(detail).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </p>
        <p className='text-lg font-bold' style={{ color }}>{score}</p>
      </div>
    </div>
  )
}

export function HealthDashboard({ projectId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['health', projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/health`).then(r => r.data.data),
    refetchInterval: 120000,
  })

  if (isLoading) return <p className='text-sm text-muted-foreground'>Loading health data…</p>
  if (!data) return null

  const { overallScore, dimensions } = data
  const radarData = dimensions.map((d: any) => ({ subject: d.label, score: d.score }))
  const overallColor = scoreColor(overallScore)

  return (
    <div className='space-y-4'>
      {/* Overall score */}
      <div className='rounded-lg border p-4 flex items-center gap-6'>
        <div className='text-center'>
          <p className='text-xs text-muted-foreground'>Overall Health</p>
          <p className='text-5xl font-bold' style={{ color: overallColor }}>{overallScore}</p>
          <p className='text-sm font-medium mt-1' style={{ color: overallColor }}>{scoreLabel(overallScore)}</p>
        </div>

        {/* Radar chart */}
        <div className='flex-1'>
          <ResponsiveContainer width='100%' height={220}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey='subject' tick={{ fontSize: 11 }} />
              <Radar
                name='Health'
                dataKey='score'
                stroke={overallColor}
                fill={overallColor}
                fillOpacity={0.25}
              />
              <Tooltip />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 7 dimension cards */}
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        {dimensions.map((d: any) => (
          <DimensionCard key={d.key} label={d.label} score={d.score} detail={d.detail} />
        ))}
      </div>
    </div>
  )
}
```

### File: `frontend/src/features/projects/components/project-detail.tsx`
In the **Overview** tab (or add a dedicated **Health** tab), render `<HealthDashboard projectId={projectId} />` at the top.

Also wire to the 7-dimension health gauge that already exists in `schedule-dashboard.tsx` if present — replace placeholder mock data with live query.

## Acceptance Criteria
- [ ] 7 dimensions computed: Schedule, Cost, Commercial, Supply Chain, Quality, Safety, Doc Control
- [ ] Schedule score based on SPI thresholds (≥1→100, ≥0.9→80, ≥0.75→60, else 40)
- [ ] Cost score based on CPI thresholds
- [ ] Quality score uses BRU-10 formula (100 − major×20 − minor×8 − failedITP×15)
- [ ] Safety score penalises LTI (−20 each) and fatalities (−100)
- [ ] Overall score = average of 7 dimensions
- [ ] Radar chart shows all 7 dimensions
- [ ] Each dimension card shows mini progress bar, score, and key detail metrics
- [ ] Color: green ≥80, amber ≥60, red <60
- [ ] Data refreshes every 2 minutes
