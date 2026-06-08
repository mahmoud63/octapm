# Task 34 — Document Control: Drawing Register (FR-703)

## Gap Covered
- Drawing register with revision tracking and IFC (Issued for Construction) status

## BRD Refs
- FR-703: Drawing register with revision tracking, IFC status, discipline filtering

## DB Schema Changes

### Add `DrawingRecord` model
```prisma
model DrawingRecord {
  id            String    @id @default(uuid())
  projectId     String
  drawingNo     String    // e.g. S-101
  title         String
  discipline    String    // Civil, Structural, MEP, Architectural, Electrical, Other
  revision      String    @default("A")
  scale         String?
  preparedBy    String?
  checkedBy     String?
  approvedBy    String?
  issueDate     DateTime?
  status        String    @default("preliminary") // preliminary, for_review, for_approval, ifc, superseded, cancelled
  purpose       String?   // IFT=for_tender, IFC=for_construction, IFI=for_information, AFC=for_client
  transmittalRef String?  // reference to transmittal log
  filePath      String?   // uploaded file path
  remarks       String?
  activityId    String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  project  Project   @relation(fields: [projectId], references: [id])
  activity Activity? @relation(fields: [activityId], references: [id])

  @@index([projectId])
  @@index([discipline])
}
```

Add `drawingRecords DrawingRecord[]` to `Project` and `Activity`.

Run migration: `npx prisma migrate dev --name add_drawing_record`

## Backend Changes

### New file: `backend/src/routes/drawings.js`
```
GET    /projects/:projectId/drawings
POST   /projects/:projectId/drawings
PATCH  /projects/:projectId/drawings/:id
DELETE /projects/:projectId/drawings/:id
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

router.get('/', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { discipline, status } = req.query;

  const where = { projectId };
  if (discipline) where.discipline = discipline;
  if (status) where.status = status;

  const drawings = await prisma.drawingRecord.findMany({
    where,
    include: { activity: { select: { id: true, name: true, activityId: true } } },
    orderBy: [{ discipline: 'asc' }, { drawingNo: 'asc' }],
  });

  const stats = {
    total: drawings.length,
    ifc: drawings.filter(d => d.status === 'ifc').length,
    forReview: drawings.filter(d => d.status === 'for_review').length,
    superseded: drawings.filter(d => d.status === 'superseded').length,
  };

  // Group by discipline
  const byDiscipline = drawings.reduce((acc, d) => {
    acc[d.discipline] = (acc[d.discipline] || 0) + 1;
    return acc;
  }, {});

  return sendSuccess(res, { drawings, stats, byDiscipline });
}));

router.post('/', requireRoles('pm', 'planning_eng', 'site_engineer'), [
  body('drawingNo').notEmpty(),
  body('title').notEmpty(),
  body('discipline').notEmpty(),
], validate, asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const drawing = await prisma.drawingRecord.create({
    data: { ...req.body, projectId },
  });
  return sendSuccess(res, drawing, 201);
}));

router.patch('/:id', requireRoles('pm', 'planning_eng', 'site_engineer'), asyncHandler(async (req, res) => {
  const { projectId, id } = req.params;
  const existing = await prisma.drawingRecord.findFirst({ where: { id, projectId } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Drawing not found');

  const drawing = await prisma.drawingRecord.update({ where: { id }, data: req.body });
  return sendSuccess(res, drawing);
}));

router.delete('/:id', requireRoles('pm'), asyncHandler(async (req, res) => {
  const { projectId, id } = req.params;
  const existing = await prisma.drawingRecord.findFirst({ where: { id, projectId } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Drawing not found');

  await prisma.drawingRecord.delete({ where: { id } });
  return sendSuccess(res, { deleted: true });
}));

module.exports = router;
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/drawings', require('./drawings'));`

## Frontend Changes

### New file: `frontend/src/features/doccontrol/components/drawing-register.tsx`

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DrawingForm } from './drawing-form'

interface Props { projectId: string }

const STATUS_BADGE: Record<string, string> = {
  preliminary: 'bg-slate-100 text-slate-600',
  for_review: 'bg-blue-100 text-blue-800',
  for_approval: 'bg-amber-100 text-amber-800',
  ifc: 'bg-green-100 text-green-800 font-bold',
  superseded: 'bg-gray-100 text-gray-500 line-through',
  cancelled: 'bg-red-100 text-red-800',
}

const STATUS_LABEL: Record<string, string> = {
  preliminary: 'Preliminary',
  for_review: 'For Review',
  for_approval: 'For Approval',
  ifc: 'IFC',
  superseded: 'Superseded',
  cancelled: 'Cancelled',
}

const DISCIPLINES = ['Civil', 'Structural', 'MEP', 'Architectural', 'Electrical', 'Other']

export function DrawingRegister({ projectId }: Props) {
  const [filterDiscipline, setFilterDiscipline] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['drawings', projectId, filterDiscipline, filterStatus],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/drawings`, {
          params: {
            ...(filterDiscipline !== 'all' && { discipline: filterDiscipline }),
            ...(filterStatus !== 'all' && { status: filterStatus }),
          },
        })
        .then(r => r.data.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/projects/${projectId}/drawings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drawings', projectId] }),
  })

  const markIfc = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/projects/${projectId}/drawings/${id}`, { status: 'ifc', issueDate: new Date().toISOString() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drawings', projectId] }),
  })

  const drawings = data?.drawings ?? []
  const stats = data?.stats ?? {}
  const byDiscipline = data?.byDiscipline ?? {}

  return (
    <div className='space-y-4'>
      {/* Summary cards */}
      <div className='grid grid-cols-4 gap-3'>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-2xl font-bold'>{stats.total ?? 0}</p>
          <p className='text-xs text-muted-foreground'>Total Drawings</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-2xl font-bold text-green-600'>{stats.ifc ?? 0}</p>
          <p className='text-xs text-muted-foreground'>IFC</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-2xl font-bold text-blue-600'>{stats.forReview ?? 0}</p>
          <p className='text-xs text-muted-foreground'>For Review</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-2xl font-bold text-gray-500'>{stats.superseded ?? 0}</p>
          <p className='text-xs text-muted-foreground'>Superseded</p>
        </div>
      </div>

      {/* Discipline breakdown pills */}
      <div className='flex flex-wrap gap-2'>
        {Object.entries(byDiscipline).map(([disc, count]) => (
          <span key={disc} className='rounded-full bg-muted px-3 py-1 text-xs font-medium'>
            {disc}: {count as number}
          </span>
        ))}
      </div>

      {/* Filters + Add */}
      <div className='flex items-center gap-3'>
        <Select value={filterDiscipline} onValueChange={setFilterDiscipline}>
          <SelectTrigger className='w-40'>
            <SelectValue placeholder='Discipline' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Disciplines</SelectItem>
            {DISCIPLINES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className='w-40'>
            <SelectValue placeholder='Status' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Statuses</SelectItem>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => { setEditItem(null); setShowForm(true) }}>+ Add Drawing</Button>
      </div>

      {/* Table */}
      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              {['Drawing No', 'Title', 'Discipline', 'Rev', 'Scale', 'Prepared By', 'Issue Date', 'Purpose', 'Transmittal', 'Activity', 'Status', 'Actions'].map(h => (
                <th key={h} className='px-3 py-2 text-left font-medium'>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drawings.map((d: any) => (
              <tr key={d.id} className='border-t hover:bg-muted/30'>
                <td className='px-3 py-2 font-mono text-xs font-medium'>{d.drawingNo}</td>
                <td className='px-3 py-2 max-w-[180px] truncate'>{d.title}</td>
                <td className='px-3 py-2'>{d.discipline}</td>
                <td className='px-3 py-2'>{d.revision}</td>
                <td className='px-3 py-2'>{d.scale ?? '—'}</td>
                <td className='px-3 py-2'>{d.preparedBy ?? '—'}</td>
                <td className='px-3 py-2'>{d.issueDate ? new Date(d.issueDate).toLocaleDateString() : '—'}</td>
                <td className='px-3 py-2 uppercase text-xs'>{d.purpose ?? '—'}</td>
                <td className='px-3 py-2 text-xs'>{d.transmittalRef ?? '—'}</td>
                <td className='px-3 py-2 text-xs'>{d.activity?.activityId ?? '—'}</td>
                <td className='px-3 py-2'>
                  <Badge className={STATUS_BADGE[d.status] ?? ''}>
                    {STATUS_LABEL[d.status] ?? d.status}
                  </Badge>
                </td>
                <td className='px-3 py-2'>
                  <div className='flex gap-1'>
                    <Button size='sm' variant='ghost' onClick={() => { setEditItem(d); setShowForm(true) }}>Edit</Button>
                    {d.status !== 'ifc' && d.status !== 'superseded' && (
                      <Button size='sm' variant='outline' className='text-green-600'
                        onClick={() => markIfc.mutate(d.id)}>
                        Mark IFC
                      </Button>
                    )}
                    <Button size='sm' variant='ghost' className='text-red-500'
                      onClick={() => deleteMutation.mutate(d.id)}>Del</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Drawing' : 'Add Drawing'}</DialogTitle>
          </DialogHeader>
          <DrawingForm
            projectId={projectId}
            initial={editItem}
            onSuccess={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['drawings', projectId] }) }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

### New file: `frontend/src/features/doccontrol/components/drawing-form.tsx`
Fields: Drawing No (text), Title, Discipline (select), Revision (text), Scale, Prepared By, Checked By, Approved By, Issue Date, Status (select), Purpose (select: IFT/IFC/IFI/AFC), Transmittal Ref, Remarks (textarea), Activity (select).

## Acceptance Criteria
- [ ] Drawing register shows all drawings with revision and IFC status
- [ ] "Mark IFC" button sets status = ifc and records issueDate = today
- [ ] IFC drawings shown with bold green badge
- [ ] Superseded drawings shown with strikethrough style
- [ ] Filter by discipline and status
- [ ] Discipline breakdown pill counts visible
- [ ] Transmittal ref column visible
