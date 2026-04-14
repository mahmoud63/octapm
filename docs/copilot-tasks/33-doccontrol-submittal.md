# Task 33 — Document Control: Submittal Register (FR-702)

## Gap Covered
- Submittal register with status workflow: Pending → Under Review → Approved / Revise & Resubmit

## BRD Refs
- FR-702: Submittal register with status workflow (Pending, Under Review, Approved, Revise & Resubmit, Rejected)

## DB Schema Changes

### Add `Submittal` model
```prisma
model Submittal {
  id              String    @id @default(uuid())
  projectId       String
  ref             String    // SUB-01
  title           String
  submittalType   String    // shop_drawing, material_sample, method_statement, O&M_manual, other
  discipline      String?
  revision        String    @default("A")
  submittedBy     String?   // contractor name
  submittedDate   DateTime?
  dueDate         DateTime?
  reviewedBy      String?
  reviewedDate    DateTime?
  status          String    @default("pending") // pending, under_review, approved, approved_as_noted, revise_resubmit, rejected
  comments        String?
  drawingRef      String?
  specRef         String?   // specification section reference
  activityId      String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  project  Project   @relation(fields: [projectId], references: [id])
  activity Activity? @relation(fields: [activityId], references: [id])

  @@index([projectId])
}
```

Add `submittals Submittal[]` to `Project` and `Activity`.

Run migration: `npx prisma migrate dev --name add_submittal`

## Backend Changes

### New file: `backend/src/routes/submittals.js`
```
GET    /projects/:projectId/submittals
POST   /projects/:projectId/submittals
PATCH  /projects/:projectId/submittals/:id
DELETE /projects/:projectId/submittals/:id
```
Roles: PM, planning_eng, site_engineer.

Auto-generate ref: `SUB-${count+1}` (zero-padded: SUB-01, SUB-02…).

```js
const { Router } = require('express');
const { body, param } = require('express-validator');
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
  const { status, type } = req.query;

  const where = { projectId };
  if (status) where.status = status;
  if (type) where.submittalType = type;

  const submittals = await prisma.submittal.findMany({
    where,
    include: { activity: { select: { id: true, name: true, activityId: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const stats = {
    total: submittals.length,
    pending: submittals.filter(s => s.status === 'pending').length,
    underReview: submittals.filter(s => s.status === 'under_review').length,
    approved: submittals.filter(s => ['approved', 'approved_as_noted'].includes(s.status)).length,
    reviseResubmit: submittals.filter(s => s.status === 'revise_resubmit').length,
    rejected: submittals.filter(s => s.status === 'rejected').length,
  };

  return sendSuccess(res, { submittals, stats });
}));

router.post('/', requireRoles('pm', 'planning_eng', 'site_engineer'), [
  body('title').notEmpty(),
  body('submittalType').notEmpty(),
], validate, asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const count = await prisma.submittal.count({ where: { projectId } });
  const ref = `SUB-${String(count + 1).padStart(2, '0')}`;

  const submittal = await prisma.submittal.create({
    data: { ...req.body, projectId, ref },
  });

  return sendSuccess(res, submittal, 201);
}));

router.patch('/:id', requireRoles('pm', 'planning_eng', 'site_engineer'), asyncHandler(async (req, res) => {
  const { projectId, id } = req.params;

  const existing = await prisma.submittal.findFirst({ where: { id, projectId } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Submittal not found');

  const submittal = await prisma.submittal.update({
    where: { id },
    data: req.body,
  });

  return sendSuccess(res, submittal);
}));

router.delete('/:id', requireRoles('pm'), asyncHandler(async (req, res) => {
  const { projectId, id } = req.params;

  const existing = await prisma.submittal.findFirst({ where: { id, projectId } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Submittal not found');

  await prisma.submittal.delete({ where: { id } });
  return sendSuccess(res, { deleted: true });
}));

module.exports = router;
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/submittals', require('./submittals'));`

## Frontend Changes

### New file: `frontend/src/features/doccontrol/components/submittal-register.tsx`

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SubmittalForm } from './submittal-form'

interface Props { projectId: string }

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  under_review: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  approved_as_noted: 'bg-teal-100 text-teal-800',
  revise_resubmit: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-800',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  under_review: 'Under Review',
  approved: 'Approved',
  approved_as_noted: 'Approved as Noted',
  revise_resubmit: 'Revise & Resubmit',
  rejected: 'Rejected',
}

export function SubmittalRegister({ projectId }: Props) {
  const [filterStatus, setFilterStatus] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['submittals', projectId, filterStatus],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/submittals`, {
          params: filterStatus !== 'all' ? { status: filterStatus } : {},
        })
        .then(r => r.data.data),
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: any }) =>
      apiClient.patch(`/projects/${projectId}/submittals/${id}`, updates).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['submittals', projectId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/projects/${projectId}/submittals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['submittals', projectId] }),
  })

  const submittals = data?.submittals ?? []
  const stats = data?.stats ?? {}

  const advanceStatus = (s: any) => {
    const next: Record<string, string> = {
      pending: 'under_review',
      under_review: 'approved',
    }
    if (next[s.status]) patchMutation.mutate({ id: s.id, updates: { status: next[s.status], reviewedDate: new Date().toISOString() } })
  }

  return (
    <div className='space-y-4'>
      {/* Summary cards */}
      <div className='grid grid-cols-5 gap-3'>
        {[
          { label: 'Total', value: stats.total, color: '' },
          { label: 'Pending', value: stats.pending, color: 'text-slate-600' },
          { label: 'Under Review', value: stats.underReview, color: 'text-blue-600' },
          { label: 'Approved', value: stats.approved, color: 'text-green-600' },
          { label: 'Revise & Resubmit', value: stats.reviseResubmit, color: 'text-amber-600' },
        ].map(c => (
          <div key={c.label} className='rounded-lg border p-3 text-center'>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value ?? 0}</p>
            <p className='text-xs text-muted-foreground'>{c.label}</p>
          </div>
        ))}
      </div>

      {/* Filter + Add */}
      <div className='flex items-center gap-3'>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className='w-44'>
            <SelectValue placeholder='Filter by status' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Statuses</SelectItem>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => { setEditItem(null); setShowForm(true) }}>+ Add Submittal</Button>
      </div>

      {/* Table */}
      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              {['Ref', 'Title', 'Type', 'Discipline', 'Rev', 'Submitted By', 'Due Date', 'Spec Ref', 'Activity', 'Status', 'Actions'].map(h => (
                <th key={h} className='px-3 py-2 text-left font-medium'>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {submittals.map((s: any) => (
              <tr key={s.id} className='border-t hover:bg-muted/30'>
                <td className='px-3 py-2 font-mono text-xs'>{s.ref}</td>
                <td className='px-3 py-2 max-w-[200px] truncate'>{s.title}</td>
                <td className='px-3 py-2 capitalize'>{s.submittalType?.replace(/_/g, ' ')}</td>
                <td className='px-3 py-2'>{s.discipline ?? '—'}</td>
                <td className='px-3 py-2'>{s.revision}</td>
                <td className='px-3 py-2'>{s.submittedBy ?? '—'}</td>
                <td className='px-3 py-2'>{s.dueDate ? new Date(s.dueDate).toLocaleDateString() : '—'}</td>
                <td className='px-3 py-2'>{s.specRef ?? '—'}</td>
                <td className='px-3 py-2 text-xs'>{s.activity?.activityId ?? '—'}</td>
                <td className='px-3 py-2'>
                  <Badge className={STATUS_BADGE[s.status] ?? ''}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </Badge>
                </td>
                <td className='px-3 py-2'>
                  <div className='flex gap-1'>
                    <Button size='sm' variant='ghost' onClick={() => { setEditItem(s); setShowForm(true) }}>Edit</Button>
                    {['pending', 'under_review'].includes(s.status) && (
                      <Button size='sm' variant='outline' onClick={() => advanceStatus(s)}>
                        {s.status === 'pending' ? 'Review' : 'Approve'}
                      </Button>
                    )}
                    {s.status === 'under_review' && (
                      <Button size='sm' variant='outline'
                        className='text-amber-600'
                        onClick={() => patchMutation.mutate({ id: s.id, updates: { status: 'revise_resubmit' } })}>
                        R&R
                      </Button>
                    )}
                    <Button size='sm' variant='ghost' className='text-red-500'
                      onClick={() => deleteMutation.mutate(s.id)}>Del</Button>
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
            <DialogTitle>{editItem ? 'Edit Submittal' : 'New Submittal'}</DialogTitle>
          </DialogHeader>
          <SubmittalForm
            projectId={projectId}
            initial={editItem}
            onSuccess={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['submittals', projectId] }) }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

### New file: `frontend/src/features/doccontrol/components/submittal-form.tsx`
Fields: Title, Submittal Type (select: shop_drawing/material_sample/method_statement/O&M_manual/other), Discipline, Revision, Submitted By, Submitted Date, Due Date, Spec Ref, Drawing Ref, Comments (textarea), Activity (select), Status (select).

## Acceptance Criteria
- [ ] Status workflow: Pending → Under Review → Approved / Approved as Noted / Revise & Resubmit / Rejected
- [ ] "Review" button advances pending → under_review; "Approve" advances under_review → approved
- [ ] "R&R" button sets status to revise_resubmit
- [ ] Summary counts per status
- [ ] Ref auto-generated SUB-01, SUB-02, …
- [ ] Filter by status
- [ ] Revision field visible (A, B, C…)
