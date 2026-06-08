# Task 36 — Document Control: Correspondence Register (FR-705)

## Gap Covered
- Correspondence register with reference numbering, type classification, and contractual notice tracking

## BRD Refs
- FR-705: Correspondence register with reference numbering, type, and contractual notice tracking

## DB Schema Changes

### Add `Correspondence` model
```prisma
model Correspondence {
  id              String    @id @default(uuid())
  projectId       String
  ref             String    // COR-01
  direction       String    // incoming, outgoing
  date            DateTime
  subject         String
  body            String?
  fromParty       String
  toParty         String
  correspondenceType String  // letter, email, notice, instruction, claim, response, other
  isContractualNotice Boolean @default(false)
  contractClause  String?   // e.g. "Clause 20.1"
  priority        String    @default("normal") // low, normal, high, urgent
  responseRequired Boolean  @default(false)
  responseDeadline DateTime?
  responseRef     String?   // ref of the response correspondence
  status          String    @default("open") // open, responded, closed, no_action_required
  remarks         String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
  @@index([date])
}
```

Add `correspondences Correspondence[]` to `Project`.

Run migration: `npx prisma migrate dev --name add_correspondence`

## Backend Changes

### New file: `backend/src/routes/correspondence.js`
```
GET    /projects/:projectId/correspondence
POST   /projects/:projectId/correspondence
PATCH  /projects/:projectId/correspondence/:id
DELETE /projects/:projectId/correspondence/:id
```
Roles: PM, planning_eng, site_engineer.

Auto-generate ref: `COR-${count+1}` zero-padded.

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
  const { direction, status, contractualOnly } = req.query;

  const where = { projectId };
  if (direction) where.direction = direction;
  if (status) where.status = status;
  if (contractualOnly === 'true') where.isContractualNotice = true;

  const correspondences = await prisma.correspondence.findMany({
    where,
    orderBy: { date: 'desc' },
  });

  const now = new Date();
  const stats = {
    total: correspondences.length,
    incoming: correspondences.filter(c => c.direction === 'incoming').length,
    outgoing: correspondences.filter(c => c.direction === 'outgoing').length,
    contractualNotices: correspondences.filter(c => c.isContractualNotice).length,
    overdueResponse: correspondences.filter(c =>
      c.responseRequired && !c.responseRef && c.responseDeadline && new Date(c.responseDeadline) < now
    ).length,
    openItems: correspondences.filter(c => c.status === 'open').length,
  };

  return sendSuccess(res, { correspondences, stats });
}));

router.post('/', requireRoles('pm', 'planning_eng', 'site_engineer'), [
  body('subject').notEmpty(),
  body('fromParty').notEmpty(),
  body('toParty').notEmpty(),
  body('direction').isIn(['incoming', 'outgoing']),
  body('correspondenceType').notEmpty(),
], validate, asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const count = await prisma.correspondence.count({ where: { projectId } });
  const ref = `COR-${String(count + 1).padStart(2, '0')}`;

  const correspondence = await prisma.correspondence.create({
    data: { ...req.body, projectId, ref },
  });

  return sendSuccess(res, correspondence, 201);
}));

router.patch('/:id', requireRoles('pm', 'planning_eng', 'site_engineer'), asyncHandler(async (req, res) => {
  const { projectId, id } = req.params;
  const existing = await prisma.correspondence.findFirst({ where: { id, projectId } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Correspondence not found');

  const updated = await prisma.correspondence.update({ where: { id }, data: req.body });
  return sendSuccess(res, updated);
}));

router.delete('/:id', requireRoles('pm'), asyncHandler(async (req, res) => {
  const { projectId, id } = req.params;
  const existing = await prisma.correspondence.findFirst({ where: { id, projectId } });
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Correspondence not found');

  await prisma.correspondence.delete({ where: { id } });
  return sendSuccess(res, { deleted: true });
}));

module.exports = router;
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/correspondence', require('./correspondence'));`

## Frontend Changes

### New file: `frontend/src/features/doccontrol/components/correspondence-register.tsx`

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CorrespondenceForm } from './correspondence-form'

interface Props { projectId: string }

const TYPE_LABEL: Record<string, string> = {
  letter: 'Letter',
  email: 'Email',
  notice: 'Notice',
  instruction: 'Instruction',
  claim: 'Claim',
  response: 'Response',
  other: 'Other',
}

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800',
  responded: 'bg-blue-100 text-blue-800',
  closed: 'bg-green-100 text-green-800',
  no_action_required: 'bg-slate-100 text-slate-600',
}

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  normal: 'bg-blue-50 text-blue-700',
  low: 'bg-slate-100 text-slate-600',
}

export function CorrespondenceRegister({ projectId }: Props) {
  const [filterDirection, setFilterDirection] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [contractualOnly, setContractualOnly] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['correspondence', projectId, filterDirection, filterStatus, contractualOnly],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/correspondence`, {
          params: {
            ...(filterDirection !== 'all' && { direction: filterDirection }),
            ...(filterStatus !== 'all' && { status: filterStatus }),
            ...(contractualOnly && { contractualOnly: 'true' }),
          },
        })
        .then(r => r.data.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/projects/${projectId}/correspondence/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['correspondence', projectId] }),
  })

  const correspondences = data?.correspondences ?? []
  const stats = data?.stats ?? {}

  const isOverdue = (c: any) => {
    if (!c.responseRequired || c.responseRef || !c.responseDeadline) return false
    return new Date(c.responseDeadline) < new Date()
  }

  return (
    <div className='space-y-4'>
      {/* KPI cards */}
      <div className='grid grid-cols-6 gap-2'>
        {[
          { label: 'Total', value: stats.total, color: '' },
          { label: 'Incoming', value: stats.incoming, color: 'text-blue-600' },
          { label: 'Outgoing', value: stats.outgoing, color: 'text-purple-600' },
          { label: 'Contractual', value: stats.contractualNotices, color: 'text-red-600' },
          { label: 'Open', value: stats.openItems, color: 'text-amber-600' },
          { label: 'Overdue Response', value: stats.overdueResponse, color: 'text-red-700' },
        ].map(c => (
          <div key={c.label} className='rounded-lg border p-2 text-center'>
            <p className={`text-xl font-bold ${c.color}`}>{c.value ?? 0}</p>
            <p className='text-xs text-muted-foreground'>{c.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className='flex items-center gap-3 flex-wrap'>
        <Select value={filterDirection} onValueChange={setFilterDirection}>
          <SelectTrigger className='w-36'>
            <SelectValue placeholder='Direction' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All</SelectItem>
            <SelectItem value='incoming'>Incoming</SelectItem>
            <SelectItem value='outgoing'>Outgoing</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className='w-40'>
            <SelectValue placeholder='Status' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All Statuses</SelectItem>
            <SelectItem value='open'>Open</SelectItem>
            <SelectItem value='responded'>Responded</SelectItem>
            <SelectItem value='closed'>Closed</SelectItem>
            <SelectItem value='no_action_required'>No Action Required</SelectItem>
          </SelectContent>
        </Select>
        <label className='flex items-center gap-2 text-sm cursor-pointer'>
          <input
            type='checkbox'
            checked={contractualOnly}
            onChange={e => setContractualOnly(e.target.checked)}
          />
          Contractual Only
        </label>
        <Button onClick={() => { setEditItem(null); setShowForm(true) }}>+ Add</Button>
      </div>

      {/* Table */}
      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              {['Ref', 'Date', 'Dir', 'Subject', 'From', 'To', 'Type', 'Priority', 'Contract Clause', 'Response Due', 'Status', 'Actions'].map(h => (
                <th key={h} className='px-3 py-2 text-left font-medium'>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {correspondences.map((c: any) => (
              <tr key={c.id} className={`border-t hover:bg-muted/30 ${isOverdue(c) ? 'bg-red-50' : ''}`}>
                <td className='px-3 py-2 font-mono text-xs font-medium'>{c.ref}</td>
                <td className='px-3 py-2'>{new Date(c.date).toLocaleDateString()}</td>
                <td className='px-3 py-2'>
                  <Badge variant='outline' className={c.direction === 'incoming' ? 'text-blue-600' : 'text-purple-600'}>
                    {c.direction === 'incoming' ? '↓ In' : '↑ Out'}
                  </Badge>
                </td>
                <td className='px-3 py-2 max-w-[200px] truncate'>
                  {c.isContractualNotice && <span className='mr-1 text-red-600 font-bold'>⚖</span>}
                  {c.subject}
                </td>
                <td className='px-3 py-2'>{c.fromParty}</td>
                <td className='px-3 py-2'>{c.toParty}</td>
                <td className='px-3 py-2'>{TYPE_LABEL[c.correspondenceType] ?? c.correspondenceType}</td>
                <td className='px-3 py-2'>
                  <Badge className={PRIORITY_BADGE[c.priority] ?? ''}>{c.priority}</Badge>
                </td>
                <td className='px-3 py-2 text-xs'>{c.contractClause ?? '—'}</td>
                <td className='px-3 py-2 text-xs'>
                  {c.responseRequired && c.responseDeadline ? (
                    <span className={isOverdue(c) ? 'text-red-600 font-bold' : ''}>
                      {new Date(c.responseDeadline).toLocaleDateString()}
                    </span>
                  ) : '—'}
                </td>
                <td className='px-3 py-2'>
                  <Badge className={STATUS_BADGE[c.status] ?? ''}>{c.status.replace(/_/g, ' ')}</Badge>
                </td>
                <td className='px-3 py-2'>
                  <div className='flex gap-1'>
                    <Button size='sm' variant='ghost' onClick={() => { setEditItem(c); setShowForm(true) }}>Edit</Button>
                    <Button size='sm' variant='ghost' className='text-red-500'
                      onClick={() => deleteMutation.mutate(c.id)}>Del</Button>
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
            <DialogTitle>{editItem ? 'Edit Correspondence' : 'Add Correspondence'}</DialogTitle>
          </DialogHeader>
          <CorrespondenceForm
            projectId={projectId}
            initial={editItem}
            onSuccess={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['correspondence', projectId] }) }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

### New file: `frontend/src/features/doccontrol/components/correspondence-form.tsx`
Fields: Direction (select: incoming/outgoing), Date, Subject, Body (textarea), From Party, To Party, Type (select), Priority (select), Is Contractual Notice (checkbox), Contract Clause, Response Required (checkbox), Response Deadline, Response Ref, Status (select), Remarks.

## Acceptance Criteria
- [ ] Correspondence ref auto-generated COR-01, COR-02, …
- [ ] Contractual notices marked with ⚖ icon
- [ ] Overdue response rows highlighted in red
- [ ] Filter by direction (incoming/outgoing), status, contractual-only
- [ ] Contractual notice count shown in KPI cards
- [ ] Overdue response count shown in KPI cards
- [ ] Status: Open / Responded / Closed / No Action Required
