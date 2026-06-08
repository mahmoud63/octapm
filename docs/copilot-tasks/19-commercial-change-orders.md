# Task 19 — Commercial: Change Order Register (FR-501)

## Gap Covered
- Change order register with status workflow (Pending → Approved → Rejected) and schedule impact tracking

## BRD Refs
- FR-501: Change order register with status workflow (Pending, Approved, Rejected) and schedule impact tracking

## DB Schema Changes
`ChangeOrder` already exists:
```prisma
model ChangeOrder {
  id             String    @id @default(uuid())
  projectId      String
  ref            String
  description    String
  value          Float     @default(0)
  status         String    @default("pending") // pending, approved, rejected
  scheduleImpact Int       @default(0)         // days impact on schedule
  submittedDate  DateTime?
  approvedDate   DateTime?
  raisedBy       String?
}
```

Add missing fields:
```prisma
  activityId     String?   // affected activity
  category       String?   // Variation, Claims, Provisional Sum, etc.
  rejectedReason String?
  updatedAt      DateTime  @updatedAt
```
Add `activity Activity? @relation(...)` and `activity Activity? @relation(...)` to ChangeOrder.
Add `changeOrders ChangeOrder[]` to `Activity`.

Run migration: `npx prisma migrate dev --name add_change_order_fields`

## Backend Changes

### New file: `backend/src/routes/change-orders.js`
```
GET    /projects/:projectId/change-orders
POST   /projects/:projectId/change-orders
PATCH  /projects/:projectId/change-orders/:id
DELETE /projects/:projectId/change-orders/:id
```
Roles: PM and QS can create/edit. PM only can delete.

### New file: `backend/src/services/change-order.service.js`

#### `listChangeOrders({ orgId, projectId })`
Return all COs with activity name. Auto-compute:
- `totalApproved`: sum of value where status = 'approved'
- `totalPending`: sum of value where status = 'pending'
- `totalScheduleImpact`: sum of scheduleImpact where status = 'approved'

#### `createChangeOrder({ orgId, projectId, payload })`
Auto-generate `ref`: `VO-${count+1}` (VO = Variation Order).

#### `updateChangeOrder({ orgId, projectId, coId, payload })`
On status change to 'approved': set `approvedDate = now()`.
On status change to 'rejected': require `rejectedReason` in payload.

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/change-orders', require('./change-orders'));`

## Frontend Changes

### New file: `frontend/src/features/commercial/components/change-order-register.tsx`

#### Summary bar
```tsx
<div className='grid grid-cols-3 gap-3 mb-4'>
  <div className='rounded-lg border p-3'>
    <p className='text-xs text-muted-foreground'>Approved VOs</p>
    <p className='text-xl font-bold text-green-600'>{fmtUSD(totalApproved)}</p>
    <p className='text-xs text-muted-foreground'>{approvedCount} orders</p>
  </div>
  <div className='rounded-lg border p-3'>
    <p className='text-xs text-muted-foreground'>Pending VOs</p>
    <p className='text-xl font-bold text-amber-600'>{fmtUSD(totalPending)}</p>
  </div>
  <div className='rounded-lg border p-3'>
    <p className='text-xs text-muted-foreground'>Schedule Impact</p>
    <p className='text-xl font-bold text-red-600'>+{totalScheduleImpact}d</p>
  </div>
</div>
```

#### Table columns
Ref | Description | Category | Value | Status | Schedule Impact | Submitted | Approved | Raised By | Actions

#### Status workflow badge + action buttons
- Pending: Show "Approve" (green) and "Reject" (red) buttons inline
- Approved: Green badge, no workflow buttons
- Rejected: Red badge, show rejection reason tooltip

#### Status badge component
```tsx
function CoBadge({ status }: { status: string }) {
  const map = {
    pending:  'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${map[status] ?? map.pending}`}>{status}</span>
}
```

### New file: `frontend/src/features/commercial/components/change-order-form.tsx`
Dialog with fields: Description (textarea), Category (select), Value (number), Schedule Impact in days (number), Activity (select from project activities), Submitted Date.

### File: `frontend/src/features/projects/components/project-detail.tsx`
Add **Commercial** tab (shared with other commercial sub-modules):
```tsx
<TabsTrigger value='commercial'>Commercial</TabsTrigger>
...
<TabsContent value='commercial'>
  <CommercialDashboard projectId={projectId} />
</TabsContent>
```

### New file: `frontend/src/features/commercial/components/commercial-dashboard.tsx`
Inner tabs: Change Orders | IPC | Sub Valuations | Budget Revisions | Cash Flow | EOT

## Acceptance Criteria
- [ ] Change order table shows all VOs with status
- [ ] "Approve" button sets status=approved, records approvedDate
- [ ] "Reject" button requires reason, sets status=rejected
- [ ] Summary shows total approved value, pending value, schedule impact days
- [ ] Ref auto-generated as VO-01, VO-02, …
- [ ] Activity linkage optional but functional when provided
