# Task 18 — Cost Control Module (FR-401–405)

## Gaps Covered
- Activity-linked 7-category cost breakdown (FR-401)
- Budget vs Committed vs Actual vs Forecast per activity (FR-402)
- 3-scenario EAC projection (FR-403)
- Daily burn rate chart (FR-404)
- Phase-level cost aggregation + variance analysis (FR-405)

## BRD Refs
- FR-401: Labour, Material, Equipment, Subcontract, Indirect, Overhead, Contingency per activity
- FR-402: Budget / Committed / Actual / Forecast comparison
- FR-403: Optimistic −10%, Most Likely, Pessimistic +15%
- FR-404: Daily burn rate with budget rate line
- FR-405: Phase-level rollup

## DB Schema Changes
`CostRecord` already exists with the 7 categories and Budget/Committed/Actual/Forecast:
```prisma
model CostRecord {
  id          String @id
  activityId  String
  projectId   String
  labour      Float
  material    Float
  equipment   Float
  subcontract Float
  indirect    Float
  overhead    Float
  contingency Float
  budget      Float
  committed   Float
  actual      Float
  forecast    Float
}
```
No new fields needed. However, add `updatedAt` for burn rate tracking:
```prisma
updatedAt DateTime @default(now()) @updatedAt
```
Run migration: `npx prisma migrate dev --name add_cost_record_updated_at`

Also add `BurnRateEntry` model for tracking daily cost entries:
```prisma
model BurnRateEntry {
  id        String   @id @default(uuid())
  projectId String
  date      DateTime
  amount    Float    @default(0)
  category  String?
  note      String?

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
  @@index([date])
}
```
Add `burnRateEntries BurnRateEntry[]` to `Project`. Run migration.

## Backend Changes

### New file: `backend/src/routes/cost.js`
```js
// GET    /projects/:projectId/cost                  — list all cost records
// GET    /projects/:projectId/cost/summary          — phase aggregation + EAC scenarios
// POST   /projects/:projectId/cost/:activityId      — upsert cost record for activity
// PATCH  /projects/:projectId/cost/:id              — update cost record
// GET    /projects/:projectId/cost/burn-rate        — daily burn rate data
// POST   /projects/:projectId/cost/burn-rate        — add burn rate entry
```

### New file: `backend/src/services/cost.service.js`

#### `getCostRecords({ orgId, projectId })`
Return all cost records with activity name, wbsCode, category:
```js
return prisma.costRecord.findMany({
  where: { projectId, project: { orgId } },
  include: { activity: { select: { name: true, wbsCode: true, category: true } } },
  orderBy: { activity: { sortOrder: 'asc' } },
});
```

#### `getCostSummary({ orgId, projectId })`
```js
const records = await getCostRecords({ orgId, projectId });

// Phase-level aggregation
const byPhase = {};
for (const r of records) {
  const phase = r.activity?.category || 'General';
  if (!byPhase[phase]) byPhase[phase] = { phase, budget: 0, committed: 0, actual: 0, forecast: 0 };
  byPhase[phase].budget += r.budget;
  byPhase[phase].committed += r.committed;
  byPhase[phase].actual += r.actual;
  byPhase[phase].forecast += r.forecast;
}

// Project totals
const totals = records.reduce((acc, r) => {
  acc.budget += r.budget; acc.committed += r.committed;
  acc.actual += r.actual; acc.forecast += r.forecast;
  return acc;
}, { budget: 0, committed: 0, actual: 0, forecast: 0 });

// 3-scenario EAC (FR-403)
const eac = {
  optimistic: totals.budget * 0.90,    // -10%
  mostLikely: totals.forecast || totals.budget,
  pessimistic: totals.budget * 1.15,   // +15%
};

return { records, byPhase: Object.values(byPhase), totals, eac };
```

#### `upsertCostRecord({ orgId, projectId, activityId, payload })`
Upsert by `activityId` + `projectId`. Compute `forecast` if not provided: `forecast = budget + (actual - budget) * 1.1` or use payload value.

#### `getBurnRate({ orgId, projectId })`
Return `BurnRateEntry` records grouped by week, plus the "budget rate" (totalBudget / projectDuration * 7).

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/cost', require('./cost'));`

### File: `backend/src/services/schedule.service.js`
After creating activities, seed `CostRecord` for each activity:
```js
// In runGeneratePipeline, after activity.createMany:
const createdActivities = await tx.activity.findMany({ where: { projectId } });
await tx.costRecord.deleteMany({ where: { projectId } });
await tx.costRecord.createMany({
  data: createdActivities.map(a => ({
    activityId: a.id,
    projectId,
    budget: a.budget,
    labour:     a.budget * 0.35,
    material:   a.budget * 0.30,
    equipment:  a.budget * 0.15,
    subcontract: a.budget * 0.10,
    indirect:   a.budget * 0.05,
    overhead:   a.budget * 0.03,
    contingency: a.budget * 0.02,
    committed: 0, actual: 0, forecast: a.budget,
  })),
});
```

## Frontend Changes

### New file: `frontend/src/features/cost/hooks/use-cost.ts`
TanStack Query hooks: `useCostRecords`, `useCostSummary`, `useBurnRate`, `useUpsertCostRecord`.

### New file: `frontend/src/features/cost/components/cost-dashboard.tsx`

#### Layout (tabs within the Cost tab):
1. **Overview** — totals + 3-scenario EAC cards
2. **By Activity** — table with 7-category columns + Budget/Committed/Actual/Forecast
3. **By Phase** — aggregated phase table with variance
4. **Burn Rate** — line chart (daily spend vs budget rate)

#### 3-Scenario EAC Cards (FR-403)
```tsx
<div className='grid grid-cols-3 gap-3'>
  <div className='rounded-lg border border-green-300 bg-green-50 p-4 text-center'>
    <p className='text-xs text-green-700'>Optimistic (-10%)</p>
    <p className='text-2xl font-bold text-green-700'>{fmtUSD(eac.optimistic)}</p>
  </div>
  <div className='rounded-lg border p-4 text-center'>
    <p className='text-xs text-muted-foreground'>Most Likely</p>
    <p className='text-2xl font-bold'>{fmtUSD(eac.mostLikely)}</p>
  </div>
  <div className='rounded-lg border border-red-300 bg-red-50 p-4 text-center'>
    <p className='text-xs text-red-700'>Pessimistic (+15%)</p>
    <p className='text-2xl font-bold text-red-700'>{fmtUSD(eac.pessimistic)}</p>
  </div>
</div>
```

#### By Activity Table (FR-401, FR-402)
Columns: Activity, Phase, Labour, Material, Equipment, Subcontract, Indirect, Overhead, Contingency, Budget, Committed, Actual, Forecast, Variance
- Variance = Budget − Forecast (red if negative)
- Inline edit: clicking a cell opens an input for that category

#### By Phase Table (FR-405)
Group activities by `category`, show phase subtotals. Columns: Phase, Budget, Committed, Actual, Forecast, Variance $, Variance %.

#### Burn Rate Chart (FR-404)
```tsx
<LineChart data={burnRateData}>
  <Line dataKey='actual' stroke='#EF4444' name='Daily Spend' />
  <Line dataKey='budget' stroke='#3B82F6' strokeDasharray='4 4' name='Budget Rate' />
</LineChart>
```

### File: `frontend/src/features/projects/components/project-detail.tsx`
Add **Cost** tab:
```tsx
<TabsTrigger value='cost'>Cost Control</TabsTrigger>
...
<TabsContent value='cost'>
  <CostDashboard projectId={projectId} />
</TabsContent>
```

## Acceptance Criteria
- [ ] Cost tab appears in project detail (only if schedule exists)
- [ ] 7-category cost breakdown shown per activity
- [ ] Budget / Committed / Actual / Forecast columns with variance
- [ ] 3-scenario EAC shows Optimistic / Most Likely / Pessimistic
- [ ] Phase-level aggregation table with variance %
- [ ] Burn rate chart shows daily spend line vs budget rate line
- [ ] CostRecord seeded for each activity on schedule generation
- [ ] Inline editing of cost values saves to backend
