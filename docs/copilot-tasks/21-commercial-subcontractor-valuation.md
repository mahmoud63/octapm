# Task 21 — Commercial: Subcontractor Valuation Register (FR-503)

## Gap Covered
- Subcontractor valuation register with certification status and payment tracking

## BRD Refs
- FR-503: Subcontractor valuation register with certification status and payment tracking

## DB Schema Changes
`SubValuation` already exists but needs enhancement:
```prisma
model SubValuation {
  id              String    @id @default(uuid())
  projectId       String
  subcontractor   String
  period          String
  workDone        Float     @default(0)
  materialsOnSite Float     @default(0)
  retention       Float     @default(0)
  backCharges     Float     @default(0)
  netPayable      Float     @default(0)
  status          String    @default("draft")
  certDate        DateTime?
  payDate         DateTime?
}
```

Add missing fields:
```prisma
  ref             String?   // SUB-001
  activityScope   String?   // description of work covered
  retentionRate   Float     @default(5)
  grossPayable    Float     @default(0)  // workDone + materialsOnSite
  submittedDate   DateTime?
  invoiceRef      String?
  paymentRef      String?
  updatedAt       DateTime  @updatedAt
```

Run migration: `npx prisma migrate dev --name add_sub_valuation_fields`

## Backend Changes

### New file: `backend/src/routes/sub-valuations.js`
```
GET    /projects/:projectId/sub-valuations
POST   /projects/:projectId/sub-valuations
PATCH  /projects/:projectId/sub-valuations/:id
DELETE /projects/:projectId/sub-valuations/:id
```
Roles: PM, QS, cost_controller.

### New file: `backend/src/services/sub-valuation.service.js`

#### `createSubValuation({ orgId, projectId, payload })`
Auto-compute on save:
```js
const grossPayable = payload.workDone + payload.materialsOnSite;
const retention = (payload.retentionRate / 100) * grossPayable;
const netPayable = grossPayable - retention - (payload.backCharges || 0);
```
Auto-generate `ref`: `SUB-${count+1}`.

#### `updateSubValuation({ ..., payload })`
Recompute `grossPayable`, `retention`, `netPayable` if financial fields change.
On `status` change to 'certified': set `certDate = now()`.
On `status` change to 'paid': require `payDate` and `paymentRef` in payload.

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/sub-valuations', require('./sub-valuations'));`

## Frontend Changes

### New file: `frontend/src/features/commercial/components/sub-valuation-register.tsx`

#### Summary cards
```tsx
<div className='grid grid-cols-4 gap-3 mb-4'>
  <card>Total Certified: {fmtUSD(totalCertified)}</card>
  <card>Total Paid: {fmtUSD(totalPaid)}</card>
  <card>Outstanding: {fmtUSD(totalCertified - totalPaid)}</card>
  <card>Retention Held: {fmtUSD(totalRetention)}</card>
</div>
```

#### Table columns
Ref | Subcontractor | Period | Work Done | Materials on Site | Gross | Retention | Back-charges | Net Payable | Status | Cert Date | Pay Date | Actions

#### Status badges
- `draft` — grey
- `submitted` — blue
- `certified` — amber
- `paid` — green

#### Workflow buttons per row
- Draft → Submit button
- Submitted → Certify button (records certDate)
- Certified → Mark Paid button (opens dialog for payDate + paymentRef)

### New file: `frontend/src/features/commercial/components/sub-valuation-form.tsx`
Form fields: Subcontractor name (text), Period (text e.g. "Month 3"), Work Done ($), Materials on Site ($), Retention Rate (number, default 5), Back-charges ($), Activity Scope (text), Invoice Ref (text).

Auto-displays computed Gross, Retention, Net Payable.

## Acceptance Criteria
- [ ] List shows all sub valuations with status badges
- [ ] Financial fields auto-compute (gross, retention, net) on save
- [ ] Status workflow: draft → submitted → certified → paid
- [ ] certDate set automatically when marking certified
- [ ] payDate and paymentRef required when marking paid
- [ ] Summary cards show totals (certified, paid, outstanding, retention)
- [ ] Back-charges deducted from net payable
