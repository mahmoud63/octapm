# Task 27 — Quality: NCR Register (FR-602)

## Gap Covered
- NCR register with severity (Major/Minor), disposition workflow, and responsible party tracking

## BRD Refs
- FR-602: NCR register with severity (Major/Minor), disposition workflow, and responsible party tracking
- BRU-10: Quality Score = 100 − (majorNCRs × 20) − (minorNCRs × 8) − (failedITPs × 15)

## DB Schema Changes
`NcrRecord` already exists but needs extension:
```prisma
model NcrRecord {
  id          String  @id @default(uuid())
  projectId   String
  activityId  String?
  ref         String  // NCR-01
  severity    String  // major, minor
  description String?
  disposition String? // accept-as-is, rework, replace, waive
  status      String  @default("open") // open, under-review, closed, waived
  responsible String?
}
```

Add missing fields:
```prisma
  location     String?   // area/gridline where NCR was raised
  trade        String?
  raisedBy     String?
  raisedDate   DateTime?
  dueDate      DateTime?
  closedDate   DateTime?
  closedBy     String?
  rootCause    String?
  correctiveAction String?
  preventiveAction String?
  photoUrls    Json?     // array of photo URLs
  updatedAt    DateTime  @updatedAt
```

Run migration: `npx prisma migrate dev --name add_ncr_record_fields`

## Backend Changes

### New file: `backend/src/routes/ncr.js`
```
GET    /projects/:projectId/ncr
POST   /projects/:projectId/ncr
PATCH  /projects/:projectId/ncr/:id
DELETE /projects/:projectId/ncr/:id
```
Roles: PM, site_engineer, planning_eng.

### File: `backend/src/services/ncr.service.js` (extend existing or create)
Auto-generate ref: `NCR-${count+1}`.

#### Quality score computation (BRU-10)
```js
const computeQualityScore = (ncrs, failedItps) => {
  const major = ncrs.filter(n => n.severity === 'major' && n.status !== 'closed').length;
  const minor = ncrs.filter(n => n.severity === 'minor' && n.status !== 'closed').length;
  return Math.max(0, 100 - (major * 20) - (minor * 8) - (failedItps * 15));
};
```

Return this score in the NCR list response.

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/ncr', require('./ncr'));`

## Frontend Changes

### New file: `frontend/src/features/quality/components/ncr-register.tsx`

#### Quality score card
```tsx
<div className='mb-4 flex items-center gap-4 rounded-lg border p-4'>
  <div>
    <p className='text-xs text-muted-foreground'>Quality Score</p>
    <p className={`text-4xl font-bold ${score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
      {score}
    </p>
  </div>
  <div className='text-sm text-muted-foreground space-y-1'>
    <p>Major NCRs (open): {majorCount} × 20 pts = {majorCount * 20}</p>
    <p>Minor NCRs (open): {minorCount} × 8 pts = {minorCount * 8}</p>
    <p>Failed ITPs: {failedITPs} × 15 pts = {failedITPs * 15}</p>
  </div>
</div>
```

#### Table columns
Ref | Severity | Description | Location | Trade | Raised By | Raised Date | Due Date | Responsible | Disposition | Status | Actions

#### Severity badges
- Major: `bg-red-100 text-red-800 font-bold`
- Minor: `bg-amber-100 text-amber-800`

#### Status workflow
- Open → Under Review: sets `status='under-review'`
- Under Review → Closed: requires `closedBy`, `closedDate`, `disposition`, `correctiveAction`
- Open → Waived: PM only, requires reason

#### Disposition options
Select: Rework (most common), Replace, Accept-as-is (requires justification), Waive (PM sign-off).

### New file: `frontend/src/features/quality/components/ncr-form.tsx`
Fields: Severity (select Major/Minor), Description (textarea), Location (text), Trade (select), Raised By (text), Raised Date, Due Date, Responsible Party (text), Activity (select), Root Cause (textarea), Corrective Action (textarea), Preventive Action (textarea).

## Acceptance Criteria
- [ ] Quality score displayed using BRU-10 formula
- [ ] Major NCR = red badge; Minor = amber
- [ ] Disposition options available: Rework, Replace, Accept-as-is, Waive
- [ ] Closing NCR requires: closedBy, closedDate, disposition, corrective action
- [ ] Closed NCRs excluded from quality score calculation
- [ ] Ref auto-generated NCR-01, NCR-02, …
