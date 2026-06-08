# Task 41 — Import Physical Progress from P6 (FR-205)

## Gap Covered
- Import phys_complete_pct from P6 XER/XML to update activity progress without replacing the full schedule

## BRD Refs
- FR-205: Import progress updates from P6 (phys_complete_pct) without overwriting the full schedule

## DB Schema Changes
None.

## Backend Changes

### New endpoint: `POST /projects/:projectId/import/progress`

### File: `backend/src/routes/import.js`
Add progress-only import route:

```js
// POST /projects/:projectId/import/progress
// Accepts XER or P6 XML, updates percentComplete only — does NOT delete/recreate activities
router.post('/progress', requireRoles('pm', 'planning_eng', 'site_engineer'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new Error('No file uploaded');

  const { projectId } = req.params;
  const format = req.body.format; // 'xer' or 'p6xml'
  const content = req.file.buffer.toString('utf-8');

  const project = await prisma.project.findFirst({ where: { id: projectId, orgId: req.user.orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  // Extract (p6ActivityId → physComplete) map
  let progressMap = {};

  if (format === 'xer') {
    const { parseXer, extractActivities } = require('../parsers/xer-parser');
    const tables = parseXer(content);
    const acts = extractActivities(tables);
    acts.forEach(a => { progressMap[a.p6ActivityId] = a.physComplete; });
  } else if (format === 'p6xml') {
    const { parseP6Xml } = require('../parsers/p6xml-parser');
    const { activities } = parseP6Xml(content);
    activities.forEach(a => { progressMap[a.p6ActivityId] = a.physComplete; });
  } else {
    throw new HttpError(400, 'INVALID_FORMAT', 'format must be xer or p6xml');
  }

  // Match by p6ActivityId and update progress
  const dbActivities = await prisma.activity.findMany({
    where: { projectId, p6ActivityId: { not: null } },
    select: { id: true, p6ActivityId: true, duration: true, budget: true },
  });

  let updated = 0;
  const updates = [];

  for (const act of dbActivities) {
    const pct = progressMap[act.p6ActivityId];
    if (pct === undefined) continue;

    const status = pct >= 100 ? 'complete' : pct > 0 ? 'in_progress' : 'to_do';
    // BRU FR-302: actualCost = pct/100 × budget × 1.03 (3% overrun factor)
    const actualCost = act.budget ? (pct / 100) * act.budget * 1.03 : undefined;

    updates.push(prisma.activity.update({
      where: { id: act.id },
      data: {
        percentComplete: pct,
        physComplete: pct,
        status,
        ...(actualCost !== undefined && { actualCost }),
      },
    }));
    updated++;
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  // Re-run EV calculation after progress update
  const { recalcEV } = require('./ev.service');
  await recalcEV(projectId);

  return sendSuccess(res, {
    updated,
    notMatched: Object.keys(progressMap).length - updated,
    message: `Updated progress for ${updated} activities`,
  });
}));
```

Note: `recalcEV` service is defined in Task 17. If not yet implemented, omit that call and add a TODO comment.

### New file: `backend/src/services/ev.service.js` (stub if Task 17 not complete)
```js
// Recalculate EV metrics for a project from activity progress
async function recalcEV(projectId) {
  const activities = await prisma.activity.findMany({
    where: { projectId },
    select: { budget: true, percentComplete: true, actualCost: true },
  });

  const totalBudget = activities.reduce((s, a) => s + (a.budget || 0), 0);
  const ev = activities.reduce((s, a) => s + ((a.percentComplete || 0) / 100) * (a.budget || 0), 0);
  const ac = activities.reduce((s, a) => s + (a.actualCost || 0), 0);

  // Update project-level EV snapshot (store on project record if fields exist)
  // Fields: ev, pv, ac are on Project if added in Task 17; skip if not
  return { totalBudget, ev, ac };
}

module.exports = { recalcEV };
```

## Frontend Changes

### New file: `frontend/src/features/schedule/components/import-progress-dialog.tsx`

```tsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function ImportProgressDialog({ projectId, open, onOpenChange }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState<'xer' | 'p6xml'>('xer')
  const [result, setResult] = useState<any>(null)
  const qc = useQueryClient()

  const importMutation = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('file', file!)
      form.append('format', format)
      return apiClient
        .post(`/projects/${projectId}/import/progress`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then(r => r.data.data)
    },
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['activities', projectId] })
      qc.invalidateQueries({ queryKey: ['ev', projectId] })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Import Progress from P6</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className='space-y-3'>
            <div className='rounded-lg bg-green-50 border border-green-200 p-4'>
              <p className='font-semibold text-green-700'>Progress Updated</p>
              <p className='text-sm mt-1'>Updated: <strong>{result.updated}</strong> activities</p>
              {result.notMatched > 0 && (
                <p className='text-sm text-amber-600'>Not matched (no p6ActivityId): {result.notMatched}</p>
              )}
            </div>
            <Button className='w-full' onClick={() => { setResult(null); setFile(null); onOpenChange(false) }}>
              Close
            </Button>
          </div>
        ) : (
          <div className='space-y-4'>
            <p className='text-sm text-muted-foreground'>
              Updates percentComplete only. Does not delete or recreate activities.
              Activities must have been imported from P6 first (p6ActivityId must be set).
            </p>

            <div className='flex gap-4 text-sm'>
              {(['xer', 'p6xml'] as const).map(f => (
                <label key={f} className='flex items-center gap-2 cursor-pointer'>
                  <input type='radio' value={f} checked={format === f} onChange={() => setFormat(f)} />
                  {f === 'xer' ? 'P6 XER' : 'P6 XML'}
                </label>
              ))}
            </div>

            <div className='space-y-1'>
              <Label>File</Label>
              <input
                type='file'
                accept={format === 'xer' ? '.xer' : '.xml'}
                className='w-full text-sm'
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {importMutation.isError && (
              <p className='text-sm text-red-600'>
                {(importMutation.error as any)?.response?.data?.error?.message ?? 'Import failed'}
              </p>
            )}

            <div className='flex gap-2'>
              <Button variant='outline' className='flex-1' onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                className='flex-1'
                disabled={!file || importMutation.isPending}
                onClick={() => importMutation.mutate()}>
                {importMutation.isPending ? 'Importing…' : 'Update Progress'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

Add "Import Progress" button to the schedule dashboard toolbar alongside "Import Schedule".

## Acceptance Criteria
- [ ] Progress import matches activities by p6ActivityId (not name)
- [ ] Only percentComplete/physComplete/status/actualCost updated — no activity deletion
- [ ] Result shows count of updated vs. not-matched activities
- [ ] EV metrics recalculated after progress update
- [ ] Supports both XER and P6 XML formats
- [ ] Activities without p6ActivityId are skipped (not matched)
