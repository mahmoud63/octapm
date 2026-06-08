# Task 08 — Gantt: Inline Bar Editor (RSK-01)

## Gap Covered
- Gantt is currently view-only; users cannot drag bars or edit predecessors
- BRD risk RSK-01 notes: "user can edit via Gantt Editor"

## BRD Refs
- RSK-01 mitigation: "validation rules flag zero-duration or orphan activities; user can edit via Gantt Editor"

## DB Schema Changes
None — all fields exist on `Activity`.

## Backend Changes

### File: `backend/src/routes/activities.js`
Already has `PATCH /:id`. Ensure it accepts `earlyStart`, `earlyFinish`, `duration`, `predecessors`, `lateStart`, `lateFinish`, `totalFloat`, `isCritical`:

Add to the patch validator:
```js
body('earlyStart').optional().isInt({ min: 0 }).toInt(),
body('earlyFinish').optional().isInt({ min: 0 }).toInt(),
body('lateStart').optional().isInt({ min: 0 }).toInt(),
body('lateFinish').optional().isInt({ min: 0 }).toInt(),
body('totalFloat').optional().isInt({ min: 0 }).toInt(),
body('duration').optional().isInt({ min: 0 }).toInt(),
body('predecessors').optional().isString().trim(),
body('isCritical').optional().isBoolean().toBoolean(),
```

### File: `backend/src/services/activity.service.js`
In `updateActivity`, include these new fields in the Prisma `update` payload.

After updating earlyStart/earlyFinish/predecessors, trigger a lightweight CPM recalculation for the project (forward pass + backward pass) and update all activities' float and isCritical. Add a `recalculateCpm(projectId, tx)` helper:

```js
async function recalculateCpm(projectId, tx) {
  const acts = await tx.activity.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } });
  // Simple forward pass: ES[0]=0, EF=ES+duration; for successors ES = max(predecessor EF)
  // Backward pass: LF[last] = max(EF), LS=LF-duration; for predecessors LF = min(successor LS)
  // TF = LF - EF; isCritical = TF === 0
  // ... implementation of CPM forward/backward pass ...
  for (const act of acts) {
    await tx.activity.update({
      where: { id: act.id },
      data: { earlyStart: act.earlyStart, earlyFinish: act.earlyFinish,
              lateStart: act.lateStart, lateFinish: act.lateFinish,
              totalFloat: act.totalFloat, isCritical: act.isCritical },
    });
  }
}
```

## Frontend Changes

### File: `frontend/src/features/schedule/components/gantt-chart.tsx`

#### 1. Add edit mode toggle
```tsx
const [editMode, setEditMode] = useState(false)
const [dragging, setDragging] = useState<{ id: string; startX: number; origStart: number } | null>(null)
```

Add Edit Mode toggle button above the Gantt:
```tsx
<Button size='sm' variant={editMode ? 'default' : 'outline'} onClick={() => setEditMode(e => !e)}>
  {editMode ? 'Done Editing' : 'Edit Gantt'}
</Button>
```

#### 2. Draggable bars (horizontal drag to change earlyStart)
In the bar `<g>` element, when `editMode`:
```tsx
onMouseDown={(e) => {
  if (!editMode) return
  setDragging({ id: a.id, startX: e.clientX, origStart: a.earlyStart ?? 0 })
}}
```

In the SVG container:
```tsx
onMouseMove={(e) => {
  if (!dragging) return
  const deltaX = e.clientX - dragging.startX
  const deltaDays = Math.round(deltaX / PX_PER_DAY)
  const newStart = Math.max(0, dragging.origStart + deltaDays)
  // Optimistically update local state for visual feedback
  setLocalOverrides(prev => ({ ...prev, [dragging.id]: { earlyStart: newStart } }))
}}
onMouseUp={async () => {
  if (!dragging) return
  const override = localOverrides[dragging.id]
  if (override) {
    await patchActivity(dragging.id, { earlyStart: override.earlyStart })
  }
  setDragging(null)
}}
```

#### 3. Props update
Add `onActivityUpdate` callback prop:
```tsx
interface Props {
  activities: ScheduleActivity[]
  onActivityUpdate?: (id: string, patch: Partial<ScheduleActivity>) => Promise<void>
}
```

#### 4. Right-click context menu on bar
When `editMode`, right-click opens a small popover with:
- "Edit details" → opens inline edit dialog (duration, predecessors, name)
- "Mark as milestone"
- "Delete activity"

### New file: `frontend/src/features/schedule/components/activity-inline-edit-dialog.tsx`
A Dialog with fields:
- Activity name (text)
- Duration (number, days)
- Predecessors (text, comma-separated WBS codes)
- Early Start (number, days from day 0)
- Is Milestone (checkbox)

On save: calls `PATCH /projects/:projectId/activities/:id`.

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
Pass `onActivityUpdate` to `GanttChart`:
```tsx
<GanttChart
  activities={activities}
  onActivityUpdate={async (id, patch) => {
    await apiClient.patch(`/projects/${projectId}/activities/${id}`, patch)
    queryClient.invalidateQueries(['schedule', projectId])
  }}
/>
```

## Acceptance Criteria
- [ ] "Edit Gantt" toggle button visible on schedule dashboard
- [ ] In edit mode, bars are draggable horizontally; earlyStart updates on mouse release
- [ ] Right-click context menu on bar shows edit/milestone/delete options
- [ ] Inline edit dialog allows updating name, duration, predecessors
- [ ] After any edit, CPM is recalculated on backend and critical path updates
- [ ] In view mode (default), bars are not draggable
