# Task 02 — Schedule Generation: BOQ Chunking for >60 Items

## Gap Covered
- BOQ chunking for datasets >60 items (FR-102, BR-005, BRU-07)
- Currently: single AI call with `rawText.slice(0, 6000)` truncates large BOQs

## BRD Refs
- FR-102: For BOQ datasets exceeding 60 items, group by section, batches of ≤60. Batch 2+ receives previous batch activity IDs for cross-batch predecessor linking. Merge with recalculated summary.
- BRU-07: Batch IDs prefixed B1-xxx, B2-xxx
- BR-005: Support up to 500 BOQ line items without truncation

## DB Schema Changes
`Activity.batchId` already exists (`String?`). No new fields needed.

## Backend Changes

### File: `backend/src/services/schedule.service.js`

#### 1. Replace `structureBoqRows` to remove the `rawText.slice(0, 6000)` truncation
Parse the full file text into rows first (before calling AI), then chunk.

#### 2. Add chunking utility function
```js
/**
 * Split BOQ rows into batches of ≤60 items grouped by section.
 * Returns array of arrays.
 */
function chunkBoqRows(rows, maxPerBatch = 60) {
  if (rows.length <= maxPerBatch) return [rows];

  // Group by section
  const bySection = {};
  for (const row of rows) {
    const sec = row.section || 'General';
    if (!bySection[sec]) bySection[sec] = [];
    bySection[sec].push(row);
  }

  const batches = [];
  let current = [];
  for (const sec of Object.keys(bySection)) {
    const items = bySection[sec];
    // If section alone exceeds maxPerBatch, split it
    for (let i = 0; i < items.length; i += maxPerBatch) {
      const slice = items.slice(i, i + maxPerBatch);
      if (current.length + slice.length > maxPerBatch && current.length > 0) {
        batches.push(current);
        current = [];
      }
      current.push(...slice);
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
```

#### 3. Replace `generateCpmSchedule` with `generateCpmScheduleChunked`
```js
async function generateCpmScheduleChunked(boqRows, project) {
  const batches = chunkBoqRows(boqRows, 60);

  if (batches.length === 1) {
    // No chunking needed — use existing single-pass logic
    return generateCpmSchedule(boqRows, project);
  }

  const allActivities = [];
  let lastBatchIds = [];
  let mergedSchedule = null;

  for (let i = 0; i < batches.length; i++) {
    const batchNum = i + 1;
    const batchRows = batches[i];
    const batchLabel = `B${batchNum}`;

    // Build prompt with previous batch context
    const prevContext = lastBatchIds.length > 0
      ? `\nPREVIOUS BATCH ACTIVITY IDs (use as predecessors where logical): ${lastBatchIds.join(', ')}`
      : '';

    const batchSchedule = await generateCpmScheduleBatch(batchRows, project, batchLabel, prevContext);

    // Tag activities with batchId
    const tagged = (batchSchedule.activities || []).map(a => ({
      ...a,
      id: `${batchLabel}-${a.id}`,
      batchId: batchLabel,
    }));

    allActivities.push(...tagged);
    lastBatchIds = tagged.map(a => a.id);

    if (!mergedSchedule) {
      mergedSchedule = batchSchedule;
    } else {
      // Merge: accumulate activities, risks, long lead, wbs
      mergedSchedule.activities = allActivities;
      mergedSchedule.risks = [...(mergedSchedule.risks || []), ...(batchSchedule.risks || [])];
      mergedSchedule.longLeadItems = [...(mergedSchedule.longLeadItems || []), ...(batchSchedule.longLeadItems || [])];
      mergedSchedule.assumptions = [...(mergedSchedule.assumptions || []), ...(batchSchedule.assumptions || [])];
      mergedSchedule.wbs = [...(mergedSchedule.wbs || []), ...(batchSchedule.wbs || [])];
    }
  }

  // Recalculate summary totals
  mergedSchedule.activities = allActivities;
  mergedSchedule.projectSummary = {
    ...mergedSchedule.projectSummary,
    totalActivities: allActivities.length,
    criticalActivities: allActivities.filter(a => a.critical).length,
    totalMilestones: allActivities.filter(a => a.isMilestone).length,
    totalBudget: allActivities.reduce((s, a) => s + (Number(a.budget) || 0), 0),
  };

  return mergedSchedule;
}
```

#### 4. New helper `generateCpmScheduleBatch(batchRows, project, batchLabel, prevContext)`
Same prompt structure as current `generateCpmSchedule` but:
- Adds `batchLabel` prefix instruction: `"All activity IDs must be prefixed with ${batchLabel}- (e.g. ${batchLabel}-ACT-01)"`
- Appends `prevContext` to the user message
- Uses `max_tokens: 8000` (smaller per batch)

#### 5. In `runGeneratePipeline`, replace `generateCpmSchedule` call with `generateCpmScheduleChunked`
Also update the step message: `'Generating CPM schedule (batch X of Y)…'` — update `setJob` inside the loop.

#### 6. Persist `batchId` on activities
In the `tx.activity.createMany` block, add:
```js
batchId: a.batchId || null,
```

## Frontend Changes

### File: `frontend/src/features/schedule/components/schedule-upload-zone.tsx`
No changes required. The existing step text from the job poller will show batch progress automatically if the backend updates the step message per batch.

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
In the Activities tab table, optionally add a **Batch** column (show `B1`, `B2`) so users can see which batch each activity came from. This helps with debugging chunked BOQs.

## Acceptance Criteria
- [ ] BOQ with 61–120 items generates 2 batches; activities from both appear in schedule
- [ ] Activity IDs from batch 1 appear as predecessors in batch 2 activities
- [ ] BOQ with ≤60 items uses single-pass (no regression)
- [ ] All activities saved with correct `batchId` in DB
- [ ] Step indicator shows `Batch 1 of 3…` etc during generation
