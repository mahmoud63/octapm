# Task 25 — Commercial: Weather Delay Tracker (BRU-09)

## Gap Covered
- Weather delay days tracked against contractual allowance; 70% consumption triggers EOT warning

## BRD Refs
- BRU-09: Weather delay days tracked against contractual allowance (default 20 days). When 70%+ consumed, EOT warning triggered.

## DB Schema Changes

### Add `WeatherDelay` model
```prisma
model WeatherDelay {
  id                String   @id @default(uuid())
  projectId         String
  date              DateTime
  delayHours        Float    @default(0)
  delayDays         Float    @default(0)  // delayHours / 8
  weatherType       String   // rain, storm, heatwave, sandstorm, flood
  description       String?
  affectedActivities String? // comma-separated activity names/IDs
  isContractual     Boolean  @default(true) // qualifies for EOT allowance
  createdAt         DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId])
  @@index([date])
}
```

Add `weatherAllowanceDays Float @default(20)` to `Project` model (BRU-09 default 20 days).
Add `weatherDelays WeatherDelay[]` to `Project`.

Run migration: `npx prisma migrate dev --name add_weather_delay`

## Backend Changes

### New file: `backend/src/routes/weather.js`
```
GET    /projects/:projectId/weather           — list entries + summary stats
POST   /projects/:projectId/weather           — add delay record
PATCH  /projects/:projectId/weather/:id
DELETE /projects/:projectId/weather/:id
```
Roles: PM, site_engineer, planning_eng.

### New file: `backend/src/services/weather.service.js`

#### `listWeatherDelays({ orgId, projectId })`
Return entries + computed summary:
```js
const delays = await prisma.weatherDelay.findMany({ where: { projectId, project: { orgId } }, orderBy: { date: 'desc' } });
const contractual = delays.filter(d => d.isContractual);
const totalDays = contractual.reduce((s, d) => s + d.delayDays, 0);
const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
const allowance = project.weatherAllowanceDays || 20;
const pctConsumed = allowance > 0 ? (totalDays / allowance) * 100 : 0;
const warningThreshold = pctConsumed >= 70;   // BRU-09

return { delays, summary: { totalDays, allowance, pctConsumed, warningThreshold } };
```

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/weather', require('./weather'));`

## Frontend Changes

### New file: `frontend/src/features/commercial/components/weather-delay-tracker.tsx`

#### Consumption gauge
```tsx
// Gauge showing % of weather allowance consumed
const pct = summary.pctConsumed
const barColor = pct >= 70 ? '#EF4444' : pct >= 50 ? '#F97316' : '#22C55E'

<div className='mb-4 space-y-2'>
  <div className='flex justify-between text-sm'>
    <span>{summary.totalDays.toFixed(1)} days used of {summary.allowance} day allowance</span>
    <span className='font-bold' style={{ color: barColor }}>{pct.toFixed(0)}%</span>
  </div>
  <div className='h-3 rounded-full bg-muted overflow-hidden'>
    <div className='h-3 rounded-full transition-all' style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
  </div>
  {summary.warningThreshold && (
    <div className='rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800'>
      ⚠ Weather delay allowance is {pct.toFixed(0)}% consumed. Consider initiating EOT claim.
    </div>
  )}
</div>
```

#### Summary cards
```tsx
<div className='grid grid-cols-3 gap-3 mb-4'>
  <card>Total Delay Days: {summary.totalDays.toFixed(1)}d</card>
  <card>Allowance Remaining: {(summary.allowance - summary.totalDays).toFixed(1)}d</card>
  <card>EOT Risk: {pct >= 70 ? 'HIGH' : pct >= 50 ? 'MEDIUM' : 'LOW'}</card>
</div>
```

#### Weather delay log table
Columns: Date | Weather Type | Delay Hours | Delay Days | Description | Affected Activities | Contractual | Actions

#### Add delay form
Fields: Date (date picker), Weather Type (select: Rain, Storm, Heatwave, Sandstorm, Flood, Other), Delay Hours (number), Description (text), Affected Activities (multi-select from project activities), Contractual (checkbox — does it qualify for EOT allowance?).

Auto-compute: Delay Days = delayHours / 8.

#### Monthly chart
Bar chart showing weather delay days per month.

## Acceptance Criteria
- [ ] Gauge shows % of 20-day allowance consumed
- [ ] Warning shown when ≥70% consumed (BRU-09)
- [ ] Each delay record captures date, type, hours, affected activities
- [ ] Only `isContractual=true` records count toward allowance
- [ ] Total days = sum of (delayHours / 8) for contractual delays
- [ ] Monthly bar chart shows delay distribution
- [ ] Project-level `weatherAllowanceDays` editable (default 20)
