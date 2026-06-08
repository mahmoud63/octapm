# Task 46 — Earned Value Report (FR-402)

## Gap Covered
- Dedicated EV report page: PV, EV, AC, SV, CV, SPI, CPI, EAC with S-curve chart

## BRD Refs
- FR-402: Earned Value report with PV/EV/AC metrics, indices, and S-curve
- BRU-02: SPI = EV / PV
- BRU-03: CPI = EV / AC
- BRU-04: EAC = Total Budget / CPI

## DB Schema Changes
None — computed from Activity records.

## Backend Changes

### New endpoint: `GET /projects/:projectId/reports/ev`

### New file: `backend/src/routes/reports.js`

```js
const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/response');
const prisma = require('../config/db');
const { HttpError } = require('../utils/errors');

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get('/ev', asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: req.user.orgId },
  });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const activities = await prisma.activity.findMany({
    where: { projectId },
    select: {
      id: true,
      name: true,
      activityId: true,
      budget: true,
      actualCost: true,
      percentComplete: true,
      earlyStart: true,
      earlyFinish: true,
      status: true,
      isCritical: true,
    },
  });

  const totalBudget = activities.reduce((s, a) => s + (a.budget || 0), 0);
  const ev = activities.reduce((s, a) => s + ((a.percentComplete || 0) / 100) * (a.budget || 0), 0);
  const ac = activities.reduce((s, a) => s + (a.actualCost || 0), 0);

  // Compute PV: budget of activities that should be complete by today
  const today = new Date();
  const pv = activities
    .filter(a => a.earlyFinish && new Date(a.earlyFinish) <= today)
    .reduce((s, a) => s + (a.budget || 0), 0);

  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const eac = cpi && cpi > 0 ? totalBudget / cpi : totalBudget;
  const sv = ev - pv;
  const cv = ev - ac;
  const etc = eac - ac; // Estimate to Complete

  // S-curve data: group activities by month, accumulate PV and EV
  const monthlyData = buildSCurveData(activities, project.startDate);

  // Per-activity EV breakdown (top 10 by budget for drill-down)
  const activityBreakdown = activities
    .sort((a, b) => (b.budget || 0) - (a.budget || 0))
    .slice(0, 20)
    .map(a => ({
      activityId: a.activityId,
      name: a.name,
      budget: a.budget || 0,
      ev: ((a.percentComplete || 0) / 100) * (a.budget || 0),
      ac: a.actualCost || 0,
      pct: a.percentComplete || 0,
      status: a.status,
      isCritical: a.isCritical,
    }));

  return sendSuccess(res, {
    totalBudget,
    pv,
    ev,
    ac,
    spi,
    cpi,
    eac,
    sv,
    cv,
    etc,
    sCurve: monthlyData,
    activityBreakdown,
    alerts: {
      spiAlert: spi !== null && spi < 0.9,
      cpiAlert: cpi !== null && cpi < 0.9,
    },
  });
}));

function buildSCurveData(activities, projectStart) {
  if (!projectStart || activities.length === 0) return [];

  const start = new Date(projectStart);
  const allDates = activities
    .filter(a => a.earlyFinish)
    .map(a => new Date(a.earlyFinish));

  if (allDates.length === 0) return [];
  const end = new Date(Math.max(...allDates.map(d => d.getTime())));
  const today = new Date();

  const months = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cur <= end) {
    const label = cur.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);

    // PV: budget of all activities planned to finish by this month
    const pvCum = activities
      .filter(a => a.earlyFinish && new Date(a.earlyFinish) <= monthEnd)
      .reduce((s, a) => s + (a.budget || 0), 0);

    // EV: only up to today
    const evCum = monthEnd <= today
      ? activities
          .filter(a => a.earlyFinish && new Date(a.earlyFinish) <= monthEnd)
          .reduce((s, a) => s + ((a.percentComplete || 0) / 100) * (a.budget || 0), 0)
      : null;

    months.push({ label, pv: pvCum, ev: evCum });
    cur.setMonth(cur.getMonth() + 1);
  }

  return months;
}

module.exports = router;
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/reports', require('./reports'));`

## Frontend Changes

### New file: `frontend/src/features/reports/components/ev-report.tsx`

```tsx
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Props { projectId: string }

function MetricCard({ label, value, sub, color = '' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className='rounded-lg border p-3 text-center'>
      <p className='text-xs text-muted-foreground mb-1'>{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className='text-xs text-muted-foreground mt-0.5'>{sub}</p>}
    </div>
  )
}

function fmt(n: number | null) {
  if (n === null || n === undefined) return '—'
  return n >= 1000000
    ? `$${(n / 1000000).toFixed(2)}M`
    : n >= 1000
    ? `$${(n / 1000).toFixed(1)}K`
    : `$${n.toFixed(0)}`
}

export function EvReport({ projectId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['ev-report', projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/reports/ev`).then(r => r.data.data),
    refetchInterval: 60000,
  })

  if (isLoading) return <p className='text-sm text-muted-foreground'>Loading EV data…</p>
  if (!data) return null

  const { pv, ev, ac, spi, cpi, eac, sv, cv, etc, totalBudget, sCurve, activityBreakdown, alerts } = data

  return (
    <div className='space-y-6'>
      {/* Alert banner */}
      {(alerts.spiAlert || alerts.cpiAlert) && (
        <div className='rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700'>
          ⚠ Alert:{' '}
          {alerts.spiAlert && `SPI ${spi?.toFixed(2)} < 0.9 (schedule slippage). `}
          {alerts.cpiAlert && `CPI ${cpi?.toFixed(2)} < 0.9 (cost overrun).`}
        </div>
      )}

      {/* Metric grid */}
      <div className='grid grid-cols-4 gap-3'>
        <MetricCard label='Total Budget (BAC)' value={fmt(totalBudget)} />
        <MetricCard label='Planned Value (PV)' value={fmt(pv)} />
        <MetricCard label='Earned Value (EV)' value={fmt(ev)} color='text-blue-600' />
        <MetricCard label='Actual Cost (AC)' value={fmt(ac)} color='text-orange-600' />
      </div>

      <div className='grid grid-cols-4 gap-3'>
        <MetricCard
          label='SPI'
          value={spi !== null ? spi.toFixed(2) : '—'}
          sub='EV / PV'
          color={spi !== null && spi < 0.9 ? 'text-red-600' : 'text-green-600'}
        />
        <MetricCard
          label='CPI'
          value={cpi !== null ? cpi.toFixed(2) : '—'}
          sub='EV / AC'
          color={cpi !== null && cpi < 0.9 ? 'text-red-600' : 'text-green-600'}
        />
        <MetricCard label='EAC' value={fmt(eac)} sub='Budget / CPI' />
        <MetricCard label='ETC' value={fmt(etc)} sub='EAC − AC' />
      </div>

      <div className='grid grid-cols-2 gap-3'>
        <MetricCard
          label='Schedule Variance (SV)'
          value={sv >= 0 ? `+${fmt(sv)}` : fmt(sv)}
          sub='EV − PV'
          color={sv >= 0 ? 'text-green-600' : 'text-red-600'}
        />
        <MetricCard
          label='Cost Variance (CV)'
          value={cv >= 0 ? `+${fmt(cv)}` : fmt(cv)}
          sub='EV − AC'
          color={cv >= 0 ? 'text-green-600' : 'text-red-600'}
        />
      </div>

      {/* S-Curve */}
      <div className='rounded-lg border p-4'>
        <h3 className='font-semibold mb-3'>S-Curve (Cumulative)</h3>
        <ResponsiveContainer width='100%' height={300}>
          <ComposedChart data={sCurve}>
            <CartesianGrid strokeDasharray='3 3' />
            <XAxis dataKey='label' tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: any) => fmt(v)} />
            <Legend />
            <Line type='monotone' dataKey='pv' name='PV (Planned)' stroke='#6366f1' strokeWidth={2} dot={false} />
            <Line type='monotone' dataKey='ev' name='EV (Earned)' stroke='#22c55e' strokeWidth={2} dot={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Activity breakdown table */}
      <div>
        <h3 className='font-semibold mb-2'>Top Activities by Budget</h3>
        <div className='overflow-x-auto rounded-lg border'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50'>
              <tr>
                {['ID', 'Name', 'Budget', 'EV', 'AC', '%', 'Status', 'Critical'].map(h => (
                  <th key={h} className='px-3 py-2 text-left font-medium'>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activityBreakdown.map((a: any) => (
                <tr key={a.activityId} className={`border-t ${a.isCritical ? 'bg-red-50' : 'hover:bg-muted/30'}`}>
                  <td className='px-3 py-2 font-mono text-xs'>{a.activityId}</td>
                  <td className='px-3 py-2 max-w-[200px] truncate'>{a.name}</td>
                  <td className='px-3 py-2'>{fmt(a.budget)}</td>
                  <td className='px-3 py-2 text-blue-600'>{fmt(a.ev)}</td>
                  <td className='px-3 py-2 text-orange-600'>{fmt(a.ac)}</td>
                  <td className='px-3 py-2'>{a.pct}%</td>
                  <td className='px-3 py-2'>{a.status}</td>
                  <td className='px-3 py-2'>{a.isCritical ? '🔴' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
```

Add `<EvReport projectId={projectId} />` inside the Reports tab in `project-detail.tsx` (alongside weekly progress report).

## Acceptance Criteria
- [ ] SPI = EV / PV shown (BRU-02)
- [ ] CPI = EV / AC shown (BRU-03)
- [ ] EAC = totalBudget / CPI (BRU-04)
- [ ] SV = EV − PV, CV = EV − AC shown with green/red colour
- [ ] Alert banner when SPI < 0.9 or CPI < 0.9
- [ ] S-curve shows PV (planned) and EV (earned) cumulative lines
- [ ] EV stops at today (null for future months, connectNulls=false)
- [ ] Top-20 activities by budget shown in breakdown table
- [ ] Metrics refresh every 60 seconds
