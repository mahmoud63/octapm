# Task 42 — Auto-Build Linked Modules After Import (FR-206)

## Gap Covered
- After P6/MSP import, auto-seed CostRecord per activity (zero budget baseline) and Long Lead items if activity names suggest procurement

## BRD Refs
- FR-206: Linked modules (cost, procurement) auto-initialized from imported schedule

## DB Schema Changes
None — uses existing CostRecord and LongLeadItem models (added in Tasks 18 and 15).

## Backend Changes

### New file: `backend/src/services/post-import.service.js`

```js
const prisma = require('../config/db');

/**
 * Detect if an activity name suggests it is a procurement/long-lead item.
 * Keywords that indicate supply/procurement activities.
 */
const PROCUREMENT_KEYWORDS = [
  'procure', 'procurement', 'purchase', 'order', 'supply', 'delivery',
  'fabrication', 'manufacture', 'vendor', 'equipment', 'material',
  'long lead', 'long-lead', 'submit', 'approval', 'shop drawing',
];

function isProcurementActivity(name) {
  const lower = name.toLowerCase();
  return PROCUREMENT_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Seed a zero-budget CostRecord for each activity that doesn't already have one.
 * This creates the cost baseline shell so QS can fill in budgets.
 */
async function seedCostRecords(projectId) {
  const activities = await prisma.activity.findMany({
    where: { projectId },
    select: { id: true, name: true, activityId: true },
  });

  const existingCosts = await prisma.costRecord.findMany({
    where: { projectId },
    select: { activityId: true },
  });

  const coveredActivityIds = new Set(existingCosts.map(c => c.activityId));
  const toCreate = activities.filter(a => !coveredActivityIds.has(a.id));

  if (toCreate.length === 0) return 0;

  await prisma.costRecord.createMany({
    data: toCreate.map(a => ({
      projectId,
      activityId: a.id,
      description: a.name,
      category: 'labor', // default — QS to update
      budget: 0,
      actual: 0,
      committed: 0,
      unit: 'LS',
      quantity: 1,
      unitRate: 0,
    })),
    skipDuplicates: true,
  });

  return toCreate.length;
}

/**
 * Seed LongLeadItem records for activities that look like procurement.
 * Only creates if not already seeded.
 */
async function seedLongLeadItems(projectId) {
  const activities = await prisma.activity.findMany({
    where: { projectId },
    select: { id: true, name: true, earlyStart: true, earlyFinish: true },
  });

  const procActivities = activities.filter(a => isProcurementActivity(a.name));
  if (procActivities.length === 0) return 0;

  const existingLL = await prisma.longLeadItem.findMany({
    where: { projectId },
    select: { activityId: true },
  });

  const coveredIds = new Set(existingLL.map(l => l.activityId));
  const toCreate = procActivities.filter(a => !coveredIds.has(a.id));

  if (toCreate.length === 0) return 0;

  const existingCount = await prisma.longLeadItem.count({ where: { projectId } });

  await prisma.longLeadItem.createMany({
    data: toCreate.map((a, i) => ({
      projectId,
      activityId: a.id,
      ref: `LL-${String(existingCount + i + 1).padStart(2, '0')}`,
      description: a.name,
      status: 'pending',
      requiredOnSite: a.earlyStart ?? null,
      expectedDelivery: null,
      leadWeeks: 0,
      supplier: null,
      remarks: 'Auto-seeded from import',
    })),
    skipDuplicates: true,
  });

  return toCreate.length;
}

/**
 * Run all post-import seeding tasks.
 */
async function runPostImportSeeding(projectId) {
  const costSeeded = await seedCostRecords(projectId);
  const longLeadSeeded = await seedLongLeadItems(projectId);
  return { costSeeded, longLeadSeeded };
}

module.exports = { runPostImportSeeding, seedCostRecords, seedLongLeadItems };
```

### File: `backend/src/services/import.service.js`
Call `runPostImportSeeding` at the end of each import function:

```js
const { runPostImportSeeding } = require('./post-import.service');

// At the end of importXer, importP6Xml, importMsp — after applyCpmToProject:
const seeding = await runPostImportSeeding(projectId);

return {
  imported: activities.length,
  wbsNodes: wbs?.length ?? 0,
  costRecordsSeeded: seeding.costSeeded,
  longLeadItemsSeeded: seeding.longLeadSeeded,
  message: `Imported ${activities.length} activities. Seeded ${seeding.costSeeded} cost records, ${seeding.longLeadSeeded} long-lead items.`,
};
```

### New endpoint: `POST /projects/:projectId/import/seed-linked-modules`
Allow manual re-seeding without re-importing:

```js
// In backend/src/routes/import.js
const { runPostImportSeeding } = require('../services/post-import.service');

router.post('/seed-linked-modules', requireRoles('pm', 'planning_eng'), asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId: req.user.orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const result = await runPostImportSeeding(projectId);
  return sendSuccess(res, result);
}));
```

## Frontend Changes

### File: `frontend/src/features/schedule/components/import-xer-dialog.tsx`
Show seeding results in the import success panel:

```tsx
// In result display section, extend to show seeding info:
{result && (
  <div className='rounded-lg bg-green-50 border border-green-200 p-4 space-y-1'>
    <p className='text-green-700 font-semibold'>Import Complete</p>
    <p className='text-sm'>Activities: <strong>{result.imported}</strong></p>
    {result.costRecordsSeeded > 0 && (
      <p className='text-sm text-blue-600'>Cost records seeded: {result.costRecordsSeeded}</p>
    )}
    {result.longLeadItemsSeeded > 0 && (
      <p className='text-sm text-purple-600'>Long-lead items seeded: {result.longLeadItemsSeeded}</p>
    )}
  </div>
)}
```

Add "Re-seed Linked Modules" button in the import dialog footer or schedule toolbar for manual trigger.

## Acceptance Criteria
- [ ] CostRecord seeded for every imported activity (zero budget baseline)
- [ ] Already-existing cost records not duplicated (skipDuplicates)
- [ ] Procurement activities detected by keyword matching in name
- [ ] LongLeadItem created for procurement activities only
- [ ] Already-existing long-lead items not duplicated
- [ ] Import result message shows counts of seeded records
- [ ] Manual re-seed endpoint available for post-import correction
