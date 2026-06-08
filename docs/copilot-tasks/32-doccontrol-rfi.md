# Task 32 — Document Control: RFI Register (FR-701)

## Gap Covered
- RFI register with status (Open, Answered, Overdue), priority, discipline, and schedule impact tracking

## BRD Refs
- FR-701: RFI register with status (Open, Answered, Overdue), priority, discipline, and schedule impact tracking

## DB Schema Changes
`Rfi` model already exists — extend it:
```prisma
model Rfi {
  id             String    @id @default(uuid())
  projectId      String
  ref            String
  subject        String
  discipline     String?
  priority       String    @default("normal")
  status         String    @default("open")
  scheduleImpact Int       @default(0)
  raisedDate     DateTime?
  dueDate        DateTime?
  answeredDate   DateTime?
}
```

Add missing fields:
```prisma
  description    String?
  raisedBy       String?
  assignedTo     String?   // person responsible for answering
  answer         String?   // the response/answer text
  contractualRef String?   // contract clause reference
  drawingRef     String?
  activityId     String?
  updatedAt      DateTime  @updatedAt
```

Add `activityLink Activity? @relation(...)` to Rfi. Add `rfis Rfi[]` to `Activity`.

Run migration: `npx prisma migrate dev --name add_rfi_fields`

## Backend Changes

### New file: `backend/src/routes/rfi.js`
```
GET    /projects/:projectId/rfi
POST   /projects/:projectId/rfi
PATCH  /projects/:projectId/rfi/:id
DELETE /projects/:projectId/rfi/:id
```
Roles: PM, planning_eng, site_engineer.

### New file: `backend/src/services/rfi.service.js`
Auto-generate ref: `RFI-${count+1}`.
Auto-compute `status`:
```js
// If dueDate is in the past and status is still 'open' → 'overdue'
const now = new Date();
const status = rfi.answeredDate ? 'answered'
  : (rfi.dueDate && new Date(rfi.dueDate) < now) ? 'overdue'
  : 'open';
```

Return with activity name included.

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/rfi', require('./rfi'));`

## Frontend Changes

### New file: `frontend/src/features/doccontrol/components/rfi-register.tsx`

#### Summary cards
```tsx
<div className='grid grid-cols-4 gap-3 mb-4'>
  <card>Total RFIs: {total}</card>
  <card color='amber'>Open: {open}</card>
  <card color='red'>Overdue: {overdue}</card>
  <card color='green'>Answered: {answered}</card>
</div>
```

#### Status badges
- `open`: `bg-blue-100 text-blue-800`
- `overdue`: `bg-red-100 text-red-800 font-bold` (auto-set when dueDate past)
- `answered`: `bg-green-100 text-green-800`

#### Priority badges
- `urgent`: red
- `high`: orange
- `normal`: blue
- `low`: grey

#### Table columns
Ref | Subject | Discipline | Priority | Raised By | Raised Date | Due Date | Answered Date | Schedule Impact | Activity | Status | Actions

Schedule Impact shown as `+Xd` in red if > 0.

#### Answer action
Clicking "Answer" opens a dialog with textarea for the response. Sets `answeredDate = now()` and `status = 'answered'`.

### New file: `frontend/src/features/doccontrol/components/rfi-form.tsx`
Fields: Subject, Description, Discipline (select: Civil/Structural/MEP/Architectural/Other), Priority (select), Raised By, Raised Date, Due Date, Drawing Ref, Contractual Ref, Schedule Impact (number, days), Activity (select).

### File: `frontend/src/features/projects/components/project-detail.tsx`
Add **Documents** tab containing: RFI | Submittals | Drawings | Transmittals | Correspondence

## Acceptance Criteria
- [ ] RFI status auto-computes: overdue if dueDate past and not answered
- [ ] Answer dialog sets answeredDate and status = answered
- [ ] Schedule impact shown as "+Xd" in red when > 0
- [ ] Priority badges: Urgent / High / Normal / Low
- [ ] Summary counts by status
- [ ] Ref auto-generated RFI-01, RFI-02, …
