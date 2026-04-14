# Task 28 — Quality: Defect & Snagging Register (FR-603)

## Gap Covered
- Defect/snagging register with location, trade, and closure workflow

## BRD Refs
- FR-603: Defect/snagging register with location, trade, and closure workflow

## DB Schema Changes

### Add `DefectRecord` model
```prisma
model DefectRecord {
  id          String    @id @default(uuid())
  projectId   String
  ref         String    // DEF-01
  description String
  location    String    // gridline, room, floor
  trade       String    // Civil, MEP, Electrical, Finishing, etc.
  severity    String    @default("minor") // minor, major, critical
  raisedBy    String?
  raisedDate  DateTime?
  assignedTo  String?
  dueDate     DateTime?
  closedDate  DateTime?
  closedBy    String?
  status      String    @default("open") // open, in-progress, closed, disputed
  photoUrls   Json?
  remarks     String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  project  Project  @relation(fields: [projectId], references: [id])

  @@index([projectId])
}
```

Add `defectRecords DefectRecord[]` to `Project`.

Run migration: `npx prisma migrate dev --name add_defect_record`

## Backend Changes

### New file: `backend/src/routes/defects.js`
```
GET    /projects/:projectId/defects
POST   /projects/:projectId/defects
PATCH  /projects/:projectId/defects/:id
DELETE /projects/:projectId/defects/:id
```
Roles: PM, site_engineer.

### New file: `backend/src/services/defect.service.js`
Auto-generate ref: `DEF-${count+1}`.
On close: require `closedBy` and `closedDate`.

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/defects', require('./defects'));`

## Frontend Changes

### New file: `frontend/src/features/quality/components/defect-register.tsx`

#### Filter bar
Filters: Status (All / Open / In Progress / Closed), Trade (dropdown), Severity (All / Minor / Major / Critical).

#### Summary cards
```tsx
<div className='grid grid-cols-4 gap-3 mb-4'>
  <card>Total Defects: {total}</card>
  <card color='red'>Open: {open}</card>
  <card color='amber'>In Progress: {inProgress}</card>
  <card color='green'>Closed: {closed}</card>
</div>
```

#### Table columns
Ref | Description | Location | Trade | Severity | Raised By | Due Date | Assigned To | Status | Actions

#### Severity badges
- Critical: `bg-red-200 text-red-900`
- Major: `bg-orange-100 text-orange-800`
- Minor: `bg-yellow-100 text-yellow-800`

#### Status workflow
- Open → In Progress: assign to person
- In Progress → Closed: requires closedDate, closedBy, optional remarks
- Open/In Progress → Disputed: add dispute note

#### Closure rate metric
Show "Closure Rate: X% (Y/Z defects closed)" as a progress bar.

### New file: `frontend/src/features/quality/components/defect-form.tsx`
Fields: Description (textarea), Location (text), Trade (select), Severity (select), Raised By, Raised Date, Assigned To, Due Date, Remarks.

## Acceptance Criteria
- [ ] Defect list with filters by status, trade, severity
- [ ] Severity: Critical / Major / Minor with colour coding
- [ ] Closure workflow: open → in-progress → closed
- [ ] Closure requires closedBy and closedDate
- [ ] Closure rate % shown as progress bar
- [ ] Ref auto-generated DEF-01, DEF-02, …
