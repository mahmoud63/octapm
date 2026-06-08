# Task 40 — CPM Recalculation After Import (FR-204)

## Gap Covered
- After importing from P6/MSP, run forward/backward CPM pass to recompute earlyStart/earlyFinish/lateStart/lateFinish/totalFloat
- Auto-mark critical path (TF = 0)

## BRD Refs
- FR-204: CPM recalculation after import; BRU-01: TF = 0 → critical path

## DB Schema Changes
None.

## Backend Changes

### New file: `backend/src/services/cpm.service.js`

```js
/**
 * CPM engine — forward and backward pass.
 * Works on imported activities where earlyStart/earlyFinish may come from P6
 * but need to be recomputed from scratch if dates are missing or inconsistent.
 *
 * Input: array of activity objects from DB with predecessors string.
 * Output: map of activityId → { earlyStart, earlyFinish, lateStart, lateFinish, totalFloat, isCritical }
 */

/**
 * Parse the predecessors string stored on Activity.
 * Format: "dbId1:FS:0,dbId2:SS:2"
 * Returns: [{ predId, relType, lagDays }]
 */
function parsePredecessors(predsStr) {
  if (!predsStr) return [];
  return predsStr.split(',').map(part => {
    const [predId, relType = 'FS', lagStr = '0'] = part.split(':');
    return { predId: predId.trim(), relType, lagDays: parseInt(lagStr) || 0 };
  });
}

/**
 * Topological sort of activities using Kahn's algorithm.
 * Returns sorted array (activities with no predecessors first).
 */
function topoSort(activities) {
  const idMap = {};
  activities.forEach(a => { idMap[a.id] = a; });

  const inDegree = {};
  const adjList = {};
  activities.forEach(a => {
    inDegree[a.id] = 0;
    adjList[a.id] = [];
  });

  activities.forEach(a => {
    const preds = parsePredecessors(a.predecessors);
    preds.forEach(p => {
      if (idMap[p.predId]) {
        adjList[p.predId].push(a.id);
        inDegree[a.id]++;
      }
    });
  });

  const queue = activities.filter(a => inDegree[a.id] === 0).map(a => a.id);
  const sorted = [];

  while (queue.length) {
    const cur = queue.shift();
    sorted.push(cur);
    for (const succ of adjList[cur]) {
      inDegree[succ]--;
      if (inDegree[succ] === 0) queue.push(succ);
    }
  }

  return sorted.map(id => idMap[id]);
}

/**
 * Run full CPM: forward pass → backward pass → compute TF.
 * Uses project start date as day 0.
 * All dates stored as integer "day offsets" internally, then converted to Date.
 *
 * @param {Array} activities - DB activity records
 * @param {Date} projectStart - project start date
 * @returns {Map} id → { earlyStart, earlyFinish, lateStart, lateFinish, totalFloat, isCritical }
 */
function runCpm(activities, projectStart) {
  const sorted = topoSort(activities);
  const idMap = {};
  sorted.forEach(a => { idMap[a.id] = a; });

  // ES/EF in working days from project start
  const ES = {};
  const EF = {};
  const LS = {};
  const LF = {};

  // Forward pass
  for (const a of sorted) {
    const preds = parsePredecessors(a.predecessors);
    let maxES = 0;

    for (const p of preds) {
      if (!idMap[p.predId]) continue;
      const predEF = EF[p.predId] ?? 0;
      const predES = ES[p.predId] ?? 0;

      if (p.relType === 'FS') maxES = Math.max(maxES, predEF + p.lagDays);
      if (p.relType === 'SS') maxES = Math.max(maxES, predES + p.lagDays);
      if (p.relType === 'FF') maxES = Math.max(maxES, predEF + p.lagDays - a.duration);
      if (p.relType === 'SF') maxES = Math.max(maxES, predES + p.lagDays - a.duration);
    }

    ES[a.id] = maxES;
    EF[a.id] = maxES + a.duration;
  }

  // Project end = max EF
  const projectEnd = Math.max(...Object.values(EF));

  // Backward pass (reverse topological order)
  const reversed = [...sorted].reverse();
  for (const a of reversed) {
    // Find all successors
    const succs = sorted.filter(s => {
      const preds = parsePredecessors(s.predecessors);
      return preds.some(p => p.predId === a.id);
    });

    if (succs.length === 0) {
      LF[a.id] = projectEnd;
    } else {
      let minLF = Infinity;
      for (const succ of succs) {
        const succPreds = parsePredecessors(succ.predecessors);
        const rel = succPreds.find(p => p.predId === a.id);
        if (!rel) continue;

        if (rel.relType === 'FS') minLF = Math.min(minLF, LS[succ.id] - rel.lagDays);
        if (rel.relType === 'SS') minLF = Math.min(minLF, LS[succ.id] - rel.lagDays + a.duration);
        if (rel.relType === 'FF') minLF = Math.min(minLF, LF[succ.id] - rel.lagDays);
        if (rel.relType === 'SF') minLF = Math.min(minLF, LF[succ.id] - rel.lagDays + a.duration);
      }
      LF[a.id] = isFinite(minLF) ? minLF : projectEnd;
    }
    LS[a.id] = LF[a.id] - a.duration;
  }

  // Build result map with Date objects
  const result = {};
  const msPerDay = 24 * 60 * 60 * 1000;
  const startMs = projectStart.getTime();

  for (const a of sorted) {
    const tf = LS[a.id] - ES[a.id];
    result[a.id] = {
      earlyStart: new Date(startMs + ES[a.id] * msPerDay),
      earlyFinish: new Date(startMs + EF[a.id] * msPerDay),
      lateStart: new Date(startMs + LS[a.id] * msPerDay),
      lateFinish: new Date(startMs + LF[a.id] * msPerDay),
      totalFloat: tf,
      isCritical: tf <= 0,
    };
  }

  return result;
}

module.exports = { runCpm, parsePredecessors };
```

### File: `backend/src/services/import.service.js`
Call `runCpm` and persist results after import:

```js
const { runCpm } = require('./cpm.service');

// Add this function to be called at end of importXer, importP6Xml, importMsp:
async function applyCpmToProject(projectId, projectStart) {
  const activities = await prisma.activity.findMany({ where: { projectId } });
  if (activities.length === 0) return;

  const cpmResults = runCpm(activities, projectStart);

  await prisma.$transaction(
    Object.entries(cpmResults).map(([id, vals]) =>
      prisma.activity.update({ where: { id }, data: vals })
    )
  );
}

// Call at end of each import transaction (after the tx closes):
// await applyCpmToProject(projectId, project.startDate ?? new Date());
```

Update each import function (`importXer`, `importP6Xml`, `importMsp`) to call after transaction:

```js
// After the prisma.$transaction(...) block:
await applyCpmToProject(projectId, project.startDate ?? new Date());
return { imported: activities.length, ... };
```

### New endpoint: `POST /projects/:projectId/import/recalculate-cpm`
Allow manual CPM recalculation trigger:

```js
// In backend/src/routes/import.js
router.post('/recalculate-cpm', requireRoles('pm', 'planning_eng'), asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId: req.user.orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const activities = await prisma.activity.findMany({ where: { projectId } });
  const cpmResults = runCpm(activities, project.startDate ?? new Date());

  await prisma.$transaction(
    Object.entries(cpmResults).map(([id, vals]) =>
      prisma.activity.update({ where: { id }, data: vals })
    )
  );

  const criticalCount = Object.values(cpmResults).filter(r => r.isCritical).length;
  return sendSuccess(res, { recalculated: activities.length, criticalActivities: criticalCount });
}));
```

## Frontend Changes

### File: `frontend/src/features/schedule/components/import-xer-dialog.tsx`
After successful import, show a "Recalculate CPM" option:

```tsx
// In result state panel, after showing imported count:
{result && (
  <Button variant='outline' size='sm'
    onClick={() => apiClient.post(`/projects/${projectId}/import/recalculate-cpm`)
      .then(() => qc.invalidateQueries({ queryKey: ['activities', projectId] }))}>
    Recalculate CPM
  </Button>
)}
```

Also add a "Recalculate CPM" button in the schedule dashboard toolbar for manual trigger.

## Acceptance Criteria
- [ ] Forward pass computes earlyStart/earlyFinish for all activities in topological order
- [ ] Backward pass computes lateStart/lateFinish starting from project end
- [ ] totalFloat = lateStart − earlyStart
- [ ] isCritical = true when totalFloat ≤ 0 (BRU-01)
- [ ] All four relationship types (FS/SS/FF/SF) handled with lag
- [ ] CPM auto-runs after every import
- [ ] Manual recalculate endpoint available
- [ ] Circular dependency handled gracefully (Kahn's algorithm drops unresolved nodes)
