# Task 47 — AI Schedule: 3rd Pass Resource Allocation (FR-101)

## Gap Covered
- Third AI pass in schedule generation pipeline: resource allocation per activity (labor, equipment, materials)

## BRD Refs
- FR-101: 3-pass AI schedule generation — Pass 3 allocates resources to each activity

## DB Schema Changes

### Add `ResourceAllocation` model
```prisma
model ResourceAllocation {
  id           String   @id @default(uuid())
  projectId    String
  activityId   String
  resourceType String   // labor, equipment, material
  resourceName String   // e.g. "Carpenter", "Tower Crane", "Concrete C30"
  quantity     Float    @default(1)
  unit         String?  // persons, hours, m3, tonnes
  dailyRate    Float?   // cost per day/unit
  totalCost    Float?
  notes        String?
  createdAt    DateTime @default(now())

  project  Project  @relation(fields: [projectId], references: [id])
  activity Activity @relation(fields: [activityId], references: [id])

  @@index([projectId])
  @@index([activityId])
}
```

Add `resourceAllocations ResourceAllocation[]` to `Project` and `Activity`.

Run migration: `npx prisma migrate dev --name add_resource_allocation`

## Backend Changes

### File: `backend/src/services/schedule.service.js`
Add Pass 3 to the generation pipeline after existing Pass 2 (CPM):

```js
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();

/**
 * Pass 3: Resource Allocation
 * Input: list of activities with names, durations, discipline
 * Output: per-activity resource requirements (labor, equipment, materials)
 */
async function allocateResources({ projectId, activities, projectName, boqSummary }) {
  const activityList = activities.slice(0, 80).map(a => ({
    id: a.id,
    activityId: a.activityId,
    name: a.name,
    duration: a.duration,
    discipline: a.discipline ?? 'General',
  }));

  const prompt = `You are a construction resource planner for ${projectName}.

Given these activities, allocate resources (labor, equipment, materials) for each.
BOQ summary: ${boqSummary ?? 'Not provided'}

Activities:
${JSON.stringify(activityList, null, 2)}

Return a JSON array of resource allocations. Each activity may have multiple resource rows.
Format:
[
  {
    "activityId": "A0001",
    "resources": [
      { "resourceType": "labor", "resourceName": "Carpenter", "quantity": 4, "unit": "persons", "dailyRate": 80 },
      { "resourceType": "material", "resourceName": "Formwork Timber", "quantity": 50, "unit": "m2", "dailyRate": 15 }
    ]
  }
]

Rules:
- Use realistic construction resources for the activity type
- Labor: specify trade and headcount
- Equipment: specify type and quantity
- Materials: specify material and quantity per duration
- Daily rates in USD
- Return ONLY the JSON array, no markdown`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;

  // Extract JSON array
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('AI did not return valid resource JSON');

  return JSON.parse(match[0]);
}

/**
 * Persist resource allocations to DB.
 */
async function saveResourceAllocations(projectId, allocations) {
  // Delete existing
  await prisma.resourceAllocation.deleteMany({ where: { projectId } });

  // Flatten and create
  const records = [];
  for (const actAlloc of allocations) {
    const activity = await prisma.activity.findFirst({
      where: { projectId, activityId: actAlloc.activityId },
    });
    if (!activity) continue;

    for (const r of actAlloc.resources ?? []) {
      records.push({
        projectId,
        activityId: activity.id,
        resourceType: r.resourceType,
        resourceName: r.resourceName,
        quantity: r.quantity ?? 1,
        unit: r.unit ?? null,
        dailyRate: r.dailyRate ?? null,
        totalCost: r.dailyRate && r.quantity ? r.dailyRate * r.quantity * activity.duration : null,
      });
    }
  }

  if (records.length > 0) {
    await prisma.resourceAllocation.createMany({ data: records });
  }

  return records.length;
}
```

### Update `runGeneratePipeline` in `schedule.service.js`
Add Pass 3 call after Pass 2 (CPM) and DB persist:

```js
// After Pass 2 activities are saved to DB:
jobs.set(jobId, { status: 'running', step: 'Pass 3: Resource allocation', progress: 80 });

const savedActivities = await prisma.activity.findMany({ where: { projectId } });

try {
  const resourceAllocations = await allocateResources({
    projectId,
    activities: savedActivities,
    projectName: project.name,
    boqSummary: req.body.boqSummary ?? null,
  });
  const resourceCount = await saveResourceAllocations(projectId, resourceAllocations);
  jobs.set(jobId, { status: 'running', step: `Resources allocated (${resourceCount} records)`, progress: 95 });
} catch (err) {
  // Pass 3 failure is non-fatal — schedule still works without resources
  console.warn('Pass 3 resource allocation failed (non-fatal):', err.message);
}

jobs.set(jobId, { status: 'done', activityCount: savedActivities.length });
```

### New endpoint: `GET /projects/:projectId/schedule/resources`

Add to `backend/src/routes/activities.js` or a new `resources.js`:

```js
// GET /projects/:projectId/schedule/resources
router.get('/resources', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const resources = await prisma.resourceAllocation.findMany({
    where: { projectId },
    include: { activity: { select: { activityId: true, name: true } } },
    orderBy: { activityId: 'asc' },
  });

  // Group by activity
  const grouped = resources.reduce((acc, r) => {
    const key = r.activityId;
    if (!acc[key]) acc[key] = { activity: r.activity, resources: [] };
    acc[key].resources.push(r);
    return acc;
  }, {});

  // Summary by type
  const summary = {
    totalLaborCost: resources.filter(r => r.resourceType === 'labor').reduce((s, r) => s + (r.totalCost || 0), 0),
    totalEquipmentCost: resources.filter(r => r.resourceType === 'equipment').reduce((s, r) => s + (r.totalCost || 0), 0),
    totalMaterialCost: resources.filter(r => r.resourceType === 'material').reduce((s, r) => s + (r.totalCost || 0), 0),
  };

  return sendSuccess(res, { resources: Object.values(grouped), summary });
}));
```

## Frontend Changes

### New file: `frontend/src/features/schedule/components/resource-plan.tsx`

```tsx
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

interface Props { projectId: string }

const TYPE_COLOR: Record<string, string> = {
  labor: 'bg-blue-100 text-blue-800',
  equipment: 'bg-orange-100 text-orange-800',
  material: 'bg-green-100 text-green-800',
}

export function ResourcePlan({ projectId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['resources', projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/schedule/resources`).then(r => r.data.data),
  })

  if (isLoading) return <p className='text-sm text-muted-foreground'>Loading resources…</p>
  if (!data) return null

  const { resources, summary } = data
  const fmt = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`

  return (
    <div className='space-y-4'>
      {/* Cost summary */}
      <div className='grid grid-cols-3 gap-3'>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-lg font-bold text-blue-600'>{fmt(summary.totalLaborCost)}</p>
          <p className='text-xs text-muted-foreground'>Labor Cost</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-lg font-bold text-orange-600'>{fmt(summary.totalEquipmentCost)}</p>
          <p className='text-xs text-muted-foreground'>Equipment Cost</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-lg font-bold text-green-600'>{fmt(summary.totalMaterialCost)}</p>
          <p className='text-xs text-muted-foreground'>Material Cost</p>
        </div>
      </div>

      {/* Activity resource list */}
      <div className='space-y-2'>
        {resources.map((g: any) => (
          <div key={g.activity.activityId} className='rounded-lg border p-3'>
            <p className='font-medium text-sm mb-2'>
              <span className='font-mono text-xs text-muted-foreground mr-2'>{g.activity.activityId}</span>
              {g.activity.name}
            </p>
            <div className='flex flex-wrap gap-2'>
              {g.resources.map((r: any, i: number) => (
                <div key={i} className={`rounded px-2 py-1 text-xs ${TYPE_COLOR[r.resourceType] ?? ''}`}>
                  {r.resourceName} × {r.quantity} {r.unit ?? ''}
                  {r.dailyRate ? ` @ $${r.dailyRate}/d` : ''}
                  {r.totalCost ? ` = ${fmt(r.totalCost)}` : ''}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

Add **Resources** tab to the schedule dashboard tabs alongside Gantt, Activities, etc.

## Acceptance Criteria
- [ ] Pass 3 AI call fires after Pass 2 in the generation pipeline
- [ ] Pass 3 failure is non-fatal (schedule still saved even if AI fails)
- [ ] ResourceAllocation records created per activity
- [ ] totalCost = dailyRate × quantity × duration
- [ ] Resource plan tab shows activities with their labor/equipment/material chips
- [ ] Cost summary shows total by type (Labor/Equipment/Material)
- [ ] Resources grouped by activity in the API response
