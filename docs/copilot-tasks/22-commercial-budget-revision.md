# Task 22 — Commercial: Budget Revision Register (FR-504)

## Gap Covered
- Budget revision register with cumulative tracking and VO references

## BRD Refs
- FR-504: Budget revision register with cumulative tracking and VO references

## DB Schema Changes

### Add `BudgetRevision` model
```prisma
model BudgetRevision {
  id            String   @id @default(uuid())
  projectId     String
  ref           String   // BR-01, BR-02
  description   String
  originalBudget Float   @default(0)
  changeAmount  Float    @default(0)   // positive = increase, negative = decrease
  revisedBudget Float    @default(0)   // cumulative
  changeOrderRef String?  // linked VO/CO ref
  approvedBy    String?
  effectiveDate DateTime?
  reason        String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
}
```

Add `budgetRevisions BudgetRevision[]` to `Project`.

Run migration: `npx prisma migrate dev --name add_budget_revision`

## Backend Changes

### New file: `backend/src/routes/budget-revisions.js`
```
GET    /projects/:projectId/budget-revisions
POST   /projects/:projectId/budget-revisions
PATCH  /projects/:projectId/budget-revisions/:id
DELETE /projects/:projectId/budget-revisions/:id
```
Roles: PM, QS, cost_controller.

### New file: `backend/src/services/budget-revision.service.js`

#### `listBudgetRevisions({ orgId, projectId })`
Return revisions ordered by `createdAt asc`. Compute running cumulative total:
```js
let running = project.contractValue || 0;
return revisions.map(r => {
  running += r.changeAmount;
  return { ...r, runningTotal: running };
});
```

#### `createBudgetRevision({ orgId, projectId, payload })`
- Auto-generate ref: `BR-${count+1}`
- Compute `revisedBudget`: originalBudget + changeAmount
- `originalBudget`: pull from project.contractValue or last revision's revisedBudget

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/budget-revisions', require('./budget-revisions'));`

## Frontend Changes

### New file: `frontend/src/features/commercial/components/budget-revision-register.tsx`

#### Summary cards
```tsx
<div className='grid grid-cols-3 gap-3 mb-4'>
  <card>Original Contract: {fmtUSD(originalBudget)}</card>
  <card>Total Revisions: {fmtUSD(totalChanges)} ({revisionCount} revisions)</card>
  <card>Current Budget: {fmtUSD(currentBudget)}</card>
</div>
```

#### Table columns
Ref | Description | Change Amount | Cumulative Budget | VO Reference | Approved By | Effective Date | Reason

- Change Amount: red if negative (budget reduction), green if positive
- Cumulative column shows running total after each revision

#### Visual budget waterfall
Simple horizontal bar showing: original budget → revisions as + or − segments → current budget total.

#### Add Revision form
Fields: Description (textarea), Change Amount (number, can be negative), VO Reference (text, optional), Approved By (text), Effective Date (date), Reason (textarea).

## Acceptance Criteria
- [ ] List shows all revisions with cumulative running total
- [ ] Change amounts colour-coded (red=decrease, green=increase)
- [ ] Original contract value shown as baseline
- [ ] Current budget = original + sum of all changeAmounts
- [ ] VO reference links to change order register (text display only, no hard FK)
- [ ] Ref auto-generated as BR-01, BR-02, …
