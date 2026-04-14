# Task 20 — Commercial: IPC Client Invoice Workbook & Retention (FR-502, BRU-06)

## Gaps Covered
- Client invoice (IPC) workbook with line-item quantities, rates, previous/current certification, retention
- Retention calculation (default 5% of certified value per IPC period)

## BRD Refs
- FR-502: Client invoice workbook (IPC) with line-item quantities, rates, previous/current certification, and retention calculation
- BRU-06: Retention = Retention Rate (default 5%) × Certified Value per IPC period

## DB Schema Changes
`IpcItem` exists but is minimal. Extend it:

```prisma
model IpcItem {
  id              String @id @default(uuid())
  projectId       String
  boqItemId       String
  ipcPeriod       String @default("IPC-1")   // which IPC period
  qty             Float  @default(0)          // current period qty
  rate            Float  @default(0)
  previousCert    Float  @default(0)
  currentCert     Float  @default(0)
  cumulativeCert  Float  @default(0)
  retentionRate   Float  @default(5)          // BRU-06: default 5%
  retention       Float  @default(0)          // computed: retentionRate/100 * currentCert
  netPayable      Float  @default(0)
  status          String @default("draft")    // draft, submitted, certified, paid
  certDate        DateTime?
  updatedAt       DateTime @updatedAt
}
```

Add `IpcCertificate` model for grouping items into a single IPC submission:
```prisma
model IpcCertificate {
  id           String    @id @default(uuid())
  projectId    String
  period       String    // e.g. "IPC-1", "IPC-2"
  issueDate    DateTime?
  dueDate      DateTime?
  totalCert    Float     @default(0)
  totalRet     Float     @default(0)
  netPayable   Float     @default(0)
  status       String    @default("draft")   // draft, submitted, certified, paid
  submittedBy  String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  project Project   @relation(fields: [projectId], references: [id])
  items   IpcItem[]
}
```

Add `ipcCertificates IpcCertificate[]` to `Project`.

Run migration: `npx prisma migrate dev --name add_ipc_certificate`

## Backend Changes

### New file: `backend/src/routes/ipc.js`
```
GET    /projects/:projectId/ipc                    — list all IPC certificates
POST   /projects/:projectId/ipc                    — create new IPC period
GET    /projects/:projectId/ipc/:period            — get IPC with all items
PATCH  /projects/:projectId/ipc/:period/items/:id  — update IPC line item
POST   /projects/:projectId/ipc/:period/submit     — submit IPC
POST   /projects/:projectId/ipc/:period/certify    — mark as certified
```

### New file: `backend/src/services/ipc.service.js`

#### `createIpcPeriod({ orgId, projectId, period })`
1. Verify project exists and belongs to org.
2. Get all BOQ items for the project.
3. Get cumulative cert from previous IPC period (sum of `currentCert` for same `boqItemId`).
4. Create `IpcCertificate` record.
5. Create `IpcItem` for each BOQ item with:
   - `previousCert` = sum of all prior period certs for that BOQ item
   - `rate` = boqItem.rate
   - `qty` = 0 (user fills in)
   - `currentCert` = 0

#### `updateIpcItem({ ..., itemId, payload })`
On update, recompute:
```js
const currentCert = payload.qty * item.rate;
const retention = (item.retentionRate / 100) * currentCert;
const netPayable = currentCert - retention;
const cumulativeCert = item.previousCert + currentCert;
// Update IpcCertificate totals
```

#### BRU-06 enforcement
`retention = (retentionRate / 100) × currentCert` — enforced in service.

## Frontend Changes

### New file: `frontend/src/features/commercial/components/ipc-workbook.tsx`

#### Period selector + new period button
```tsx
// Select from existing IPC periods or create new one
<select value={selectedPeriod} onChange={...}>
  {periods.map(p => <option key={p.period} value={p.period}>{p.period} — {p.status}</option>)}
</select>
<Button onClick={createNewPeriod}>+ New IPC Period</Button>
```

#### IPC workbook table
Columns: BOQ Ref | Description | Unit | Total Qty | Rate | Previous Cert | Current Qty | Current Cert | Cumulative | Retention (5%) | Net Payable

- `currentCert` = currentQty × rate (auto-computed)
- `retention` = retentionRate% × currentCert (auto-computed, shown in amber)
- Net Payable = currentCert − retention (shown in green/bold)

#### Footer summary row
Total Current Cert | Total Retention | Total Net Payable

#### IPC summary cards
```tsx
<div className='grid grid-cols-3 gap-3'>
  <card>Total Certified: {fmtUSD(totalCert)}</card>
  <card>Retention Held: {fmtUSD(totalRet)}</card>
  <card>Net Payable: {fmtUSD(netPayable)}</card>
</div>
```

#### Submit / Certify buttons
- Draft → Submit: changes status to 'submitted', records submittedDate
- Submitted → Certify: changes status to 'certified', records certDate

## Acceptance Criteria
- [ ] "New IPC Period" creates IPC-1, IPC-2, etc. with all BOQ items pre-loaded
- [ ] User enters current qty; currentCert auto-computes as qty × rate
- [ ] Retention auto-computes as 5% of currentCert (editable rate)
- [ ] previousCert pulled from prior IPC periods automatically
- [ ] cumulativeCert = previousCert + currentCert
- [ ] Net Payable = currentCert − retention
- [ ] Status workflow: draft → submitted → certified → paid
- [ ] Summary row shows totals
