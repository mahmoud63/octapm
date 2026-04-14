# Task 35 — Document Control: Transmittal Log (FR-704)

## Gap Covered
- Transmittal log with sender, recipient, document listing, and acknowledgment tracking

## BRD Refs
- FR-704: Transmittal log with sender, recipient, document list, purpose, and acknowledgment date

## DB Schema Changes

### Add `Transmittal` model
```prisma
model Transmittal {
  id              String    @id @default(uuid())
  projectId       String
  ref             String    // TR-01
  date            DateTime  @default(now())
  sender          String
  recipient       String
  company         String?
  purpose         String    // for_approval, for_review, for_information, for_record, for_construction
  method          String?   // email, courier, hand_delivery
  trackingNo      String?   // courier tracking number
  acknowledgedDate DateTime?
  acknowledgedBy  String?
  remarks         String?
  documents       Json      @default("[]")  // [{ref, title, revision, copies}]
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
  @@index([date])
}
```

Add `transmittals Transmittal[]` to `Project`.

Run migration: `npx prisma migrate dev --name add_transmittal`

## Backend Changes

### New file: `backend/src/routes/transmittals.js`
```
GET    /projects/:projectId/transmittals
POST   /projects/:projectId/transmittals
PATCH  /projects/:projectId/transmittals/:id
DELETE /projects/:projectId/transmittals/:id
```
Roles: PM, planning_eng, site_engineer.

Auto-generate ref: `TR-${count+1}` zero-padded.

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

  const transmittals = await prisma.transmittal.findMany({
    where: { projectId },
    orderBy: { date: 'desc' },
  });

  const stats = {
    total: transmittals.length,
    pending: transmittals.filter(t => !t.acknowledgedDate).length,
    acknowledged: transmittals.filter(t => !!t.acknowledgedDate).length,
  };

  return sendSuccess(res, { transmittals, stats });
}));

router.post('/', requireRoles('pm', 'planning_eng', 'site_engineer'), [
  body('sender').notEmpty(),
  body('recipient').notEmpty(),
  body('purpose').notEmpty(),
], validate, asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const count = await prisma.transmittal.count({ where: { projectId } });
  const ref = `TR-${String(count + 1).padStart(2, '0')}`;

  const transmittal = await prisma.transmittal.create({
    data: {
      ...req.body,
      projectId,
      ref,
      documents: req.body.documents ?? [],
    },
  });

  return sendSuccess(res, transmittal, 201);
}));

router.patch('/:id', requireRoles('pm', 'planning_eng', 'site_engineer'), asyncHandler(async (req, res) => {
  const { projectId, id } = req.params;
  const existing = await prisma.transmittal.findFirst({ where: { id, projectId } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Transmittal not found');

  const transmittal = await prisma.transmittal.update({ where: { id }, data: req.body });
  return sendSuccess(res, transmittal);
}));

router.delete('/:id', requireRoles('pm'), asyncHandler(async (req, res) => {
  const { projectId, id } = req.params;
  const existing = await prisma.transmittal.findFirst({ where: { id, projectId } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Transmittal not found');

  await prisma.transmittal.delete({ where: { id } });
  return sendSuccess(res, { deleted: true });
}));

module.exports = router;
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/transmittals', require('./transmittals'));`

## Frontend Changes

### New file: `frontend/src/features/doccontrol/components/transmittal-log.tsx`

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TransmittalForm } from './transmittal-form'
import { TransmittalDetail } from './transmittal-detail'

interface Props { projectId: string }

const PURPOSE_LABEL: Record<string, string> = {
  for_approval: 'For Approval',
  for_review: 'For Review',
  for_information: 'For Information',
  for_record: 'For Record',
  for_construction: 'For Construction',
}

export function TransmittalLog({ projectId }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [viewItem, setViewItem] = useState<any>(null)
  const [editItem, setEditItem] = useState<any>(null)
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['transmittals', projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/transmittals`).then(r => r.data.data),
  })

  const ackMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/projects/${projectId}/transmittals/${id}`, {
        acknowledgedDate: new Date().toISOString(),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transmittals', projectId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/projects/${projectId}/transmittals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transmittals', projectId] }),
  })

  const transmittals = data?.transmittals ?? []
  const stats = data?.stats ?? {}

  return (
    <div className='space-y-4'>
      {/* Summary */}
      <div className='grid grid-cols-3 gap-3'>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-2xl font-bold'>{stats.total ?? 0}</p>
          <p className='text-xs text-muted-foreground'>Total</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-2xl font-bold text-amber-600'>{stats.pending ?? 0}</p>
          <p className='text-xs text-muted-foreground'>Pending Acknowledgment</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-2xl font-bold text-green-600'>{stats.acknowledged ?? 0}</p>
          <p className='text-xs text-muted-foreground'>Acknowledged</p>
        </div>
      </div>

      <div className='flex justify-end'>
        <Button onClick={() => { setEditItem(null); setShowForm(true) }}>+ New Transmittal</Button>
      </div>

      {/* Table */}
      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              {['Ref', 'Date', 'Sender', 'Recipient', 'Company', 'Purpose', 'Method', 'Docs', 'Acknowledged', 'Actions'].map(h => (
                <th key={h} className='px-3 py-2 text-left font-medium'>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transmittals.map((t: any) => (
              <tr key={t.id} className='border-t hover:bg-muted/30'>
                <td className='px-3 py-2 font-mono text-xs font-medium'>{t.ref}</td>
                <td className='px-3 py-2'>{new Date(t.date).toLocaleDateString()}</td>
                <td className='px-3 py-2'>{t.sender}</td>
                <td className='px-3 py-2'>{t.recipient}</td>
                <td className='px-3 py-2'>{t.company ?? '—'}</td>
                <td className='px-3 py-2'>
                  <Badge variant='outline'>{PURPOSE_LABEL[t.purpose] ?? t.purpose}</Badge>
                </td>
                <td className='px-3 py-2 capitalize'>{t.method?.replace(/_/g, ' ') ?? '—'}</td>
                <td className='px-3 py-2 text-center'>
                  <button
                    className='text-blue-600 hover:underline text-xs'
                    onClick={() => setViewItem(t)}>
                    {Array.isArray(t.documents) ? t.documents.length : 0} docs
                  </button>
                </td>
                <td className='px-3 py-2'>
                  {t.acknowledgedDate ? (
                    <span className='text-green-600 text-xs'>
                      ✓ {new Date(t.acknowledgedDate).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className='text-amber-600 text-xs'>Pending</span>
                  )}
                </td>
                <td className='px-3 py-2'>
                  <div className='flex gap-1'>
                    <Button size='sm' variant='ghost' onClick={() => { setEditItem(t); setShowForm(true) }}>Edit</Button>
                    {!t.acknowledgedDate && (
                      <Button size='sm' variant='outline' className='text-green-600'
                        onClick={() => ackMutation.mutate(t.id)}>
                        Acknowledge
                      </Button>
                    )}
                    <Button size='sm' variant='ghost' className='text-red-500'
                      onClick={() => deleteMutation.mutate(t.id)}>Del</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Transmittal' : 'New Transmittal'}</DialogTitle>
          </DialogHeader>
          <TransmittalForm
            projectId={projectId}
            initial={editItem}
            onSuccess={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['transmittals', projectId] }) }}
          />
        </DialogContent>
      </Dialog>

      {/* Document list view dialog */}
      {viewItem && (
        <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
          <DialogContent className='max-w-xl'>
            <DialogHeader>
              <DialogTitle>Documents — {viewItem.ref}</DialogTitle>
            </DialogHeader>
            <TransmittalDetail transmittal={viewItem} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
```

### New file: `frontend/src/features/doccontrol/components/transmittal-form.tsx`
Fields: Sender, Recipient, Company, Purpose (select), Method (select: email/courier/hand_delivery), Tracking No, Date, Remarks, Document List (dynamic rows: Ref, Title, Revision, Copies).

### New file: `frontend/src/features/doccontrol/components/transmittal-detail.tsx`
Show transmittal details + document list in a simple table (Ref, Title, Revision, Copies).

## Acceptance Criteria
- [ ] Transmittal ref auto-generated TR-01, TR-02, …
- [ ] Document list stored as JSON array per transmittal
- [ ] "X docs" link opens document list view
- [ ] "Acknowledge" button sets acknowledgedDate = today
- [ ] Pending acknowledgments shown with amber indicator
- [ ] Acknowledged entries show date in green
- [ ] Summary counts: total, pending, acknowledged
