# Task 31 — Quality: Score Dashboard & Health Dimension (BRU-10)

## Gap Covered
- Quality Score calculated from live module data (BRU-10)
- Quality health dimension feeds into 7-dimension dashboard

## BRD Refs
- BRU-10: Quality Score = 100 − (majorNCRs × 20) − (minorNCRs × 8) − (failedITPs × 15)

## DB Schema Changes
None — computed from existing NCR and ITP records.

## Backend Changes

### New endpoint: `GET /projects/:projectId/quality/score`

### File: `backend/src/routes/quality.js` (new file, or add to existing quality routes)
```js
router.get('/score', asyncHandler(async (req, res) => {
  const result = await qualityService.getQualityScore({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
  });
  return sendSuccess(res, result);
}));
```

### New file: `backend/src/services/quality.service.js`
```js
const getQualityScore = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const [ncrs, itps] = await Promise.all([
    prisma.ncrRecord.findMany({ where: { projectId, status: { not: 'closed' } } }),
    prisma.itpRecord.findMany({ where: { projectId, status: 'failed' } }),
  ]);

  const majorNCRs = ncrs.filter(n => n.severity === 'major').length;
  const minorNCRs = ncrs.filter(n => n.severity === 'minor').length;
  const failedITPs = itps.length;

  // BRU-10
  const score = Math.max(0, 100 - (majorNCRs * 20) - (minorNCRs * 8) - (failedITPs * 15));

  return {
    score,
    breakdown: {
      majorNCRs,
      minorNCRs,
      failedITPs,
      deductions: {
        fromMajor: majorNCRs * 20,
        fromMinor: minorNCRs * 8,
        fromITPs: failedITPs * 15,
      },
    },
  };
};
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/quality', require('./quality'));`

## Frontend Changes

### New file: `frontend/src/features/quality/components/quality-score-card.tsx`
```tsx
export function QualityScoreCard({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ['quality-score', projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/quality/score`).then(r => r.data.data),
  })

  if (!data) return null

  const { score, breakdown } = data
  const color = score >= 80 ? '#22C55E' : score >= 60 ? '#F59E0B' : '#EF4444'
  const label = score >= 80 ? 'Good' : score >= 60 ? 'Fair' : 'Poor'

  return (
    <div className='rounded-lg border p-4 space-y-3'>
      <div className='flex items-center justify-between'>
        <h3 className='font-semibold'>Quality Score</h3>
        <span className='text-xs rounded-full px-2 py-0.5 font-semibold' style={{ background: `${color}20`, color }}>
          {label}
        </span>
      </div>

      {/* Score gauge */}
      <div className='relative flex items-center justify-center'>
        <svg viewBox='0 0 100 60' className='w-40'>
          {/* Background arc */}
          <path d='M 10 55 A 40 40 0 0 1 90 55' fill='none' stroke='#e2e8f0' strokeWidth='8' strokeLinecap='round' />
          {/* Score arc */}
          <path
            d='M 10 55 A 40 40 0 0 1 90 55'
            fill='none'
            stroke={color}
            strokeWidth='8'
            strokeLinecap='round'
            strokeDasharray={`${(score / 100) * 125.6} 125.6`}
          />
        </svg>
        <div className='absolute bottom-0 text-center'>
          <p className='text-3xl font-bold' style={{ color }}>{score}</p>
          <p className='text-xs text-muted-foreground'>/ 100</p>
        </div>
      </div>

      {/* Deduction breakdown */}
      <div className='space-y-1 text-xs'>
        <div className='flex justify-between'>
          <span>Major NCRs ({breakdown.majorNCRs} × 20)</span>
          <span className='text-red-600'>−{breakdown.deductions.fromMajor}</span>
        </div>
        <div className='flex justify-between'>
          <span>Minor NCRs ({breakdown.minorNCRs} × 8)</span>
          <span className='text-amber-600'>−{breakdown.deductions.fromMinor}</span>
        </div>
        <div className='flex justify-between'>
          <span>Failed ITPs ({breakdown.failedITPs} × 15)</span>
          <span className='text-red-600'>−{breakdown.deductions.fromITPs}</span>
        </div>
      </div>
    </div>
  )
}
```

### File: `frontend/src/features/quality/components/quality-dashboard.tsx` (new wrapper)
Combines: `<QualityScoreCard />` + inner tabs for ITP, NCR, Defects, Safety, Material Tests.

### File: `frontend/src/features/projects/components/project-detail.tsx`
Quality tab points to `<QualityDashboard projectId={projectId} />`.

## Acceptance Criteria
- [ ] Quality score computed via BRU-10 formula from live DB data
- [ ] Score gauge shows numerical score with colour (green ≥80, amber ≥60, red <60)
- [ ] Deduction breakdown shown (major, minor, failed ITPs)
- [ ] Score updates automatically when NCRs are closed or ITPs pass
- [ ] "Good" / "Fair" / "Poor" label shown
