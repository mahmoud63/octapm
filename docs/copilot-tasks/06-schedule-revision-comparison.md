# Task 06 — Schedule: Revision History & Comparison UI (FR-107)

## Gap Covered
- ScheduleRevision records are stored but no UI to list or compare revisions

## BRD Refs
- FR-107: Each generated schedule saved to revision history with timestamp, label, activity count, critical count, budget, full snapshot. Users can compare revisions.

## DB Schema Changes
None — `ScheduleRevision` already has all needed fields:
```prisma
model ScheduleRevision {
  id            String   @id
  projectId     String
  label         String?
  activityCount Int
  criticalCount Int
  totalBudget   Float
  snapshotJson  Json?
  createdAt     DateTime
}
```

## Backend Changes

### File: `backend/src/routes/schedule.js`
Add new endpoints:

```js
// GET /projects/:projectId/schedule/revisions — list all revisions (newest first)
router.get('/revisions', asyncHandler(async (req, res) => {
  const result = await scheduleService.listRevisions({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
  });
  return sendSuccess(res, result);
}));

// GET /projects/:projectId/schedule/revisions/:revisionId — get full snapshot of one revision
router.get('/revisions/:revisionId', asyncHandler(async (req, res) => {
  const result = await scheduleService.getRevision({
    orgId: req.user.orgId,
    projectId: req.params.projectId,
    revisionId: req.params.revisionId,
  });
  if (!result) throw new HttpError(404, 'REVISION_NOT_FOUND', 'Revision not found');
  return sendSuccess(res, result);
}));
```

### File: `backend/src/services/schedule.service.js`
```js
const listRevisions = async ({ orgId, projectId }) => {
  // Verify project belongs to org
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  return prisma.scheduleRevision.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, activityCount: true, criticalCount: true, totalBudget: true, createdAt: true },
    // Note: exclude snapshotJson from list for performance
  });
};

const getRevision = async ({ orgId, projectId, revisionId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return prisma.scheduleRevision.findFirst({ where: { id: revisionId, projectId } });
};
```

## Frontend Changes

### New file: `frontend/src/features/schedule/hooks/use-revisions.ts`
```ts
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

export function useScheduleRevisions(projectId: string) {
  return useQuery({
    queryKey: ['schedule-revisions', projectId],
    queryFn: () =>
      apiClient.get(`/projects/${projectId}/schedule/revisions`).then(r => r.data.data),
  })
}
```

### New file: `frontend/src/features/schedule/components/revision-history-panel.tsx`
A slide-out Sheet or inline panel showing:
- Table of revisions: Date, Label, Activities, Critical, Budget
- "Restore" button on each row (triggers new generate? Or just loads that snapshot for viewing)
- "Compare" button — shows side-by-side diff: activity count, critical count, budget delta, new/removed activities list

```tsx
// Comparison view: show two revisions side by side
// Left = selected revision, Right = current revision
// Diff: activities in selected but not current (removed), activities in current but not selected (added)
// Use activity name as key for matching
```

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
Add a **Revisions** tab to the inner Tabs component:
```tsx
<TabsTrigger value='revisions'>Revisions</TabsTrigger>
...
<TabsContent value='revisions'>
  <RevisionHistoryPanel projectId={projectId} currentRevision={revision} />
</TabsContent>
```

Also add revision label user-input: when regenerating, allow user to type a label (e.g. "Rev 2 - Updated Electrical") before uploading file. Add a text input above the file picker in `ScheduleUploadZone` that sends `label` as a form field with the multipart upload.

### File: `backend/src/routes/schedule.js`
In the `POST /generate` handler, read `req.body.label` and pass to `startGenerateJob`:
```js
const result = await scheduleService.startGenerateJob({
  orgId: req.user.orgId,
  projectId: req.params.projectId,
  file: req.file,
  label: req.body.label || null,
});
```

### File: `backend/src/services/schedule.service.js`
Pass label through to `runGeneratePipeline` and use it in `scheduleRevision.create`:
```js
label: label || 'AI Generated',
```

Also: stop deleting old revisions on regenerate — currently `await tx.scheduleRevision.deleteMany(...)` removes all history. Change to keep old revisions (only delete activities and BOQ items, create new revision). The current revision shown to user is always the latest one (by `createdAt desc`).

## Acceptance Criteria
- [ ] Revisions tab shows list of all past revisions with date, label, activity count
- [ ] Clicking a revision loads its snapshot for viewing (read-only)
- [ ] Comparison view shows activity count diff, budget diff, added/removed activities
- [ ] User can provide a label when regenerating
- [ ] Old revisions are preserved (not deleted) when regenerating
