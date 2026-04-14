# Task 26 — Quality: ITP Register (FR-601)

## Gap Covered
- Inspection and Test Plan (ITP) register with hold/witness/review points, linked to activities

## BRD Refs
- FR-601: ITP register with hold/witness/review points, linked to activities

## DB Schema Changes

### Add `ItpRecord` model
```prisma
model ItpRecord {
  id           String    @id @default(uuid())
  projectId    String
  activityId   String?
  ref          String    // ITP-01
  activity     String    // activity/work description
  inspectionStep String  // what is being inspected
  pointType    String    // H = Hold, W = Witness, R = Review
  trade        String?   // Civil, MEP, Structural, etc.
  plannedDate  DateTime?
  actualDate   DateTime?
  result       String?   // pass, fail, conditional
  inspector    String?
  remarks      String?
  status       String    @default("pending") // pending, passed, failed, waived
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  project      Project   @relation(fields: [projectId], references: [id])
  activityLink Activity? @relation(fields: [activityId], references: [id])

  @@index([projectId])
}
```

Add `itpRecords ItpRecord[]` to `Project` and `Activity`.

Run migration: `npx prisma migrate dev --name add_itp_record`

## Backend Changes

### New file: `backend/src/routes/itp.js`
```
GET    /projects/:projectId/itp
POST   /projects/:projectId/itp
PATCH  /projects/:projectId/itp/:id
DELETE /projects/:projectId/itp/:id
```
Roles: PM, site_engineer, planning_eng.

### New file: `backend/src/services/itp.service.js`
Standard CRUD with orgId scoping. Include `activityLink` (name, wbsCode) in list response.
Auto-generate ref: `ITP-${count+1}`.

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/itp', require('./itp'));`

## Frontend Changes

### New file: `frontend/src/features/quality/components/itp-register.tsx`

#### Summary cards
```tsx
<div className='grid grid-cols-4 gap-3 mb-4'>
  <card>Total ITPs: {total}</card>
  <card color='amber'>Pending: {pending}</card>
  <card color='green'>Passed: {passed}</card>
  <card color='red'>Failed: {failed}</card>
</div>
```

#### Table columns
Ref | Activity | Inspection Step | Point Type | Trade | Planned Date | Actual Date | Result | Inspector | Status | Actions

#### Point type badges
- **H** (Hold): red badge — work cannot proceed without sign-off
- **W** (Witness): amber badge — inspector must be present
- **R** (Review): blue badge — document review only

```tsx
const pointTypeBadge = { H: 'bg-red-100 text-red-800', W: 'bg-amber-100 text-amber-800', R: 'bg-blue-100 text-blue-800' }
```

#### Workflow
- Pending → Pass: sets status='passed', records actualDate, result='pass'
- Pending → Fail: sets status='failed', result='fail', requires remarks
- Fail → Waive: sets status='waived' (PM only)

### New file: `frontend/src/features/quality/components/itp-form.tsx`
Fields: Activity (select from project activities), Inspection Step (text), Point Type (select H/W/R), Trade (select), Planned Date, Inspector (text), Remarks.

### File: `frontend/src/features/projects/components/project-detail.tsx`
Add **Quality** tab containing inner tabs: ITP | NCR | Defects | Safety | Material Tests

## Acceptance Criteria
- [ ] ITP register shows all inspection points with H/W/R badges
- [ ] Pass/Fail actions record date and result
- [ ] Failed ITPs show clearly in red
- [ ] Activity linkage shows activity name
- [ ] Hold points cannot be waived without PM role
- [ ] Summary counts (total, pending, passed, failed)
