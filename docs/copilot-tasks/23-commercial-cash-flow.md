# Task 23 — Commercial: Cash Flow Projection (FR-505)

## Gap Covered
- Cash flow projection linked to actual IPC certification and subcontractor payment schedules

## BRD Refs
- FR-505: Cash flow projection linked to actual IPC certification and subcontractor payment schedules

## DB Schema Changes
No new model — cash flow is computed from IPC and SubValuation records. However, add a `CashFlowEntry` for manual overrides:

```prisma
model CashFlowEntry {
  id          String   @id @default(uuid())
  projectId   String
  period      String   // e.g. "Month 3"
  periodDate  DateTime // first day of period
  inflow      Float    @default(0)   // client payment received
  outflow     Float    @default(0)   // subcontractor payments made
  netFlow     Float    @default(0)   // inflow - outflow
  cumulative  Float    @default(0)   // running cumulative
  note        String?
  isManual    Boolean  @default(false) // manual vs auto-computed

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
  @@index([periodDate])
}
```

Add `cashFlowEntries CashFlowEntry[]` to `Project`.

Run migration: `npx prisma migrate dev --name add_cash_flow_entry`

## Backend Changes

### New file: `backend/src/routes/cash-flow.js`
```
GET    /projects/:projectId/cash-flow          — computed + manual entries
POST   /projects/:projectId/cash-flow/rebuild  — rebuild from IPC + SubValuation data
POST   /projects/:projectId/cash-flow/entry    — add manual entry
PATCH  /projects/:projectId/cash-flow/entry/:id
```

### New file: `backend/src/services/cash-flow.service.js`

#### `rebuildCashFlow({ orgId, projectId })`
1. Delete existing auto-computed entries (where `isManual = false`)
2. Load all `IpcCertificate` records (inflows) by period
3. Load all `SubValuation` records (outflows) by period
4. Group by period and create `CashFlowEntry` records
5. Compute cumulative running total

```js
const ipcs = await prisma.ipcCertificate.findMany({ where: { projectId }, orderBy: { issueDate: 'asc' } });
const subs = await prisma.subValuation.findMany({ where: { projectId }, orderBy: { certDate: 'asc' } });

// Group by period
const periodMap = {};
for (const ipc of ipcs) {
  const key = ipc.period;
  if (!periodMap[key]) periodMap[key] = { inflow: 0, outflow: 0, date: ipc.issueDate };
  periodMap[key].inflow += ipc.netPayable || 0;
}
for (const sub of subs) {
  const key = sub.period;
  if (!periodMap[key]) periodMap[key] = { inflow: 0, outflow: 0, date: sub.certDate };
  periodMap[key].outflow += sub.netPayable || 0;
}

let cumulative = 0;
const entries = Object.entries(periodMap)
  .sort(([, a], [, b]) => new Date(a.date) - new Date(b.date))
  .map(([period, data]) => {
    const netFlow = data.inflow - data.outflow;
    cumulative += netFlow;
    return { projectId, period, periodDate: data.date, inflow: data.inflow, outflow: data.outflow, netFlow, cumulative };
  });

await prisma.cashFlowEntry.createMany({ data: entries });
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/cash-flow', require('./cash-flow'));`

## Frontend Changes

### New file: `frontend/src/features/commercial/components/cash-flow-chart.tsx`
```tsx
import { BarChart, Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// Combo chart: bars for inflow/outflow, line for cumulative
<ResponsiveContainer width='100%' height={300}>
  <ComposedChart data={cashFlowData}>
    <CartesianGrid strokeDasharray='3 3' />
    <XAxis dataKey='period' />
    <YAxis yAxisId='left' tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
    <YAxis yAxisId='right' orientation='right' tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
    <Tooltip formatter={(v: number) => fmtUSD(v)} />
    <Legend />
    <Bar yAxisId='left' dataKey='inflow' fill='#22C55E' name='Client Inflow' />
    <Bar yAxisId='left' dataKey='outflow' fill='#EF4444' name='Sub Outflow' />
    <Line yAxisId='right' type='monotone' dataKey='cumulative' stroke='#3B82F6' name='Cumulative' strokeWidth={2} />
  </ComposedChart>
</ResponsiveContainer>
```

#### Cash flow table
Period | Client Payment (Inflow) | Sub Payments (Outflow) | Net Flow | Cumulative | Note

- Net flow: green if positive, red if negative
- "Rebuild from IPC/Sub data" button calls `/rebuild` endpoint

#### Manual entry form
Add entries for periods not covered by IPC data (e.g. "Retention Release" or "Advance Payment").

## Acceptance Criteria
- [ ] Cash flow chart shows inflow bars, outflow bars, cumulative line
- [ ] Data auto-populated from IPC certificates and sub valuations
- [ ] "Rebuild" button refreshes auto-computed entries
- [ ] Manual entries can be added for custom periods
- [ ] Net flow column colour-coded (green/red)
- [ ] Cumulative line shows running project cash position
