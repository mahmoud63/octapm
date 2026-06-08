# Task 30 — Quality: Material Test Results Register (FR-605)

## Gap Covered
- Material test results register with pass/fail tracking and mill certificate references

## BRD Refs
- FR-605: Material test results register with pass/fail tracking and mill certificate references

## DB Schema Changes

### Add `MaterialTest` model
```prisma
model MaterialTest {
  id             String    @id @default(uuid())
  projectId      String
  ref            String    // MT-01
  material       String    // e.g. "Ready Mix Concrete C30"
  testType       String    // cube_test, slump_test, pull_out, tensile, etc.
  testDate       DateTime
  sampleRef      String?   // sample/coupon reference
  lotRef         String?   // material lot / batch ref
  millCertRef    String?   // mill certificate number
  location       String?   // where material was cast/installed
  activityId     String?
  specValue      String?   // specified value (e.g. "30 MPa")
  testValue      String?   // actual test result
  unit           String?   // MPa, mm, kN, etc.
  result         String    @default("pending") // pending, pass, fail, conditional
  testedBy       String?   // lab or person
  remarks        String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  project  Project   @relation(fields: [projectId], references: [id])
  activity Activity? @relation(fields: [activityId], references: [id])

  @@index([projectId])
}
```

Add `materialTests MaterialTest[]` to `Project` and `Activity`.

Run migration: `npx prisma migrate dev --name add_material_test`

## Backend Changes

### New file: `backend/src/routes/material-tests.js`
```
GET    /projects/:projectId/material-tests
POST   /projects/:projectId/material-tests
PATCH  /projects/:projectId/material-tests/:id
DELETE /projects/:projectId/material-tests/:id
```
Roles: PM, site_engineer, planning_eng.

Auto-generate ref: `MT-${count+1}`.

Return summary stats: total, pass, fail, pending.

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/material-tests', require('./material-tests'));`

## Frontend Changes

### New file: `frontend/src/features/quality/components/material-test-register.tsx`

#### Summary cards
```tsx
<div className='grid grid-cols-4 gap-3 mb-4'>
  <card>Total Tests: {total}</card>
  <card color='green'>Pass: {pass}</card>
  <card color='red'>Fail: {fail}</card>
  <card color='amber'>Pending: {pending}</card>
</div>
```

#### Pass rate metric
```tsx
<div className='mb-3'>
  <p className='text-sm'>Pass Rate: {passRate.toFixed(0)}%</p>
  <div className='h-2 rounded-full bg-muted'>
    <div className='h-2 rounded-full bg-green-500' style={{ width: `${passRate}%` }} />
  </div>
</div>
```

#### Table columns
Ref | Material | Test Type | Date | Sample Ref | Mill Cert | Location | Activity | Spec | Actual | Unit | Result | Tested By | Actions

#### Result badges
- `pass`: `bg-green-100 text-green-800` — ✓ Pass
- `fail`: `bg-red-100 text-red-800` — ✗ Fail
- `pending`: `bg-slate-100 text-slate-600` — Pending
- `conditional`: `bg-amber-100 text-amber-800` — Conditional

#### Filter by test type
Common test types: Cube Test, Slump Test, Pull-Out Test, Tensile Test, Compaction Test, Water Absorption.

### New file: `frontend/src/features/quality/components/material-test-form.tsx`
Fields: Material name (text), Test Type (select), Test Date, Sample Ref, Lot Ref, Mill Cert Ref, Location, Activity (select), Spec Value (text), Actual Value (text), Unit (text), Tested By, Remarks, Result (select).

## Acceptance Criteria
- [ ] Test register shows all tests with pass/fail result
- [ ] Mill certificate reference column visible
- [ ] Pass rate bar shown
- [ ] Filter by test type works
- [ ] Fail results shown in red; pass in green
- [ ] Activity linkage optional but functional
- [ ] Ref auto-generated MT-01, MT-02, …
