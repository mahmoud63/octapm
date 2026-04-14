# Task 15 — Long Lead Items: Activity Link & CRUD

## Gaps Covered
- Long lead items are read-only from AI output; no manual add/edit/delete
- `activity` field is text only; no navigation to the linked activity

## BRD Refs
- FR-503 context: Procurement linked to activities
- §6.1 Scope: Long-lead items with activity links

## DB Schema Changes

### Add `LongLeadItem` model
Long lead items currently only live in `ScheduleRevision.snapshotJson`. Move them to a proper table:

```prisma
model LongLeadItem {
  id          String   @id @default(uuid())
  projectId   String
  activityId  String?  // linked activity (optional)
  item        String
  leadWeeks   Int      @default(0)
  orderBy     String?  // target order date (text: "Month 2")
  criticality String?  // High, Medium, Low
  risk        String?  // risk note text
  status      String   @default("not_ordered") // not_ordered, ordered, delivered
  supplier    String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project  Project   @relation(fields: [projectId], references: [id])
  activity Activity? @relation(fields: [activityId], references: [id])

  @@index([projectId])
}
```

Add to `Project` model: `longLeadItems LongLeadItem[]`
Add to `Activity` model: `longLeadItems LongLeadItem[]`

Run migration: `npx prisma migrate dev --name add_long_lead_item`

## Backend Changes

### New file: `backend/src/routes/long-lead.js`
Standard REST CRUD: GET, POST, PATCH /:id, DELETE /:id — mounted at `/projects/:projectId/long-lead`.

### New file: `backend/src/services/long-lead.service.js`
CRUD with orgId scoping. On list, include `activity { id, name, wbsCode }`.

### File: `backend/src/routes/projects.js`
Mount: `router.use('/:projectId/long-lead', require('./long-lead'));`

### File: `backend/src/services/schedule.service.js`
Seed `LongLeadItem` table from AI output on generation:
```js
if (Array.isArray(scheduleJson.longLeadItems) && scheduleJson.longLeadItems.length > 0) {
  await tx.longLeadItem.deleteMany({ where: { projectId } });

  // Try to link each item to an activity by matching item name to activity name
  const activityList = await tx.activity.findMany({ where: { projectId }, select: { id: true, name: true } });
  const actMap = new Map(activityList.map(a => [a.name.toLowerCase(), a.id]));

  await tx.longLeadItem.createMany({
    data: scheduleJson.longLeadItems.map(ll => {
      const linkedId = ll.activity
        ? actMap.get(String(ll.activity).toLowerCase()) ?? null
        : null;
      return {
        projectId,
        activityId: linkedId,
        item: ll.item || '',
        leadWeeks: Number(ll.leadWeeks) || 0,
        orderBy: ll.orderBy || null,
        criticality: ll.criticality || null,
        risk: ll.risk || null,
      };
    }),
  });
}
```

## Frontend Changes

### New file: `frontend/src/features/long-lead/hooks/use-long-lead.ts`
TanStack Query hooks: `useLongLeadItems(projectId)`, `useCreateLongLeadItem`, `useUpdateLongLeadItem`, `useDeleteLongLeadItem`.

### New file: `frontend/src/features/long-lead/components/long-lead-table.tsx`
Enhanced table with:
- Columns: Item, Lead Weeks, Order By, Activity (link), Criticality, Risk Note, Status, Supplier, Actions
- Activity column: if `activityId` is set, render as a clickable badge that scrolls to the activity in the Gantt tab (or highlights it in the Activities table)
- Status column: select dropdown inline (not_ordered → ordered → delivered)
- Row actions: Edit, Delete

### File: `frontend/src/features/schedule/components/schedule-dashboard.tsx`
Replace the current read-only long lead cards in the Long Lead tab with `<LongLeadTable projectId={projectId} />`.

Add "Add Item" button that opens a form dialog with fields: Item name, Lead Weeks (number), Order By (text), Criticality (select), Risk note (text), Supplier (text), Activity (select from current project activities).

## Acceptance Criteria
- [ ] Long lead items loaded from DB (seeded from AI on generation)
- [ ] Activity column shows linked activity name; clicking it navigates to Gantt/Activities tab highlighting that activity
- [ ] Status can be updated inline (not_ordered → ordered → delivered)
- [ ] Manual add/edit/delete works
- [ ] Items with leadWeeks ≥ 12 show orange/urgent styling (existing behaviour preserved)
- [ ] Supplier field captured and displayed
