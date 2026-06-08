# Task 01 — Project Header: Contract Value & Duration Display

## Gaps Covered
- Contract value not displayed in project detail (field exists in DB: `Project.contractValue`)
- Project duration not displayed (field exists in DB: `Project.duration` + `Project.durationUnit`)

## BRD Refs
- §14.1 Master Data — Project entity: Name, Type, Location, Start Date, Duration, Unit, Contract Value

## DB Schema Changes
**None required.** Both fields already exist on the `Project` model:
```prisma
contractValue Float?
duration      Int?
durationUnit  String @default("months")
```

## Backend Changes

### File: `backend/src/services/project.service.js`
Ensure `getProjectById` (or equivalent) returns `contractValue`, `duration`, `durationUnit` in its select/return. These are top-level Project fields so Prisma returns them by default — verify the select clause does not exclude them.

### File: `backend/src/routes/projects.js`
No changes needed if the service already returns all fields.

## Frontend Changes

### File: `frontend/src/features/projects/data/schema.ts`
Add to the project Zod schema:
```ts
contractValue: z.number().nullable().optional(),
duration: z.number().int().nullable().optional(),
durationUnit: z.string().default('months'),
```

### File: `frontend/src/features/projects/components/project-detail.tsx`
In the **Overview tab** `TabsContent value='overview'`, add two new rows below currency:
```tsx
<p className='mt-1 text-muted-foreground'>
  Contract Value:{' '}
  <span className='text-foreground'>
    {project.contractValue
      ? `${project.currency} ${Number(project.contractValue).toLocaleString()}`
      : '-'}
  </span>
</p>
<p className='mt-1 text-muted-foreground'>
  Duration:{' '}
  <span className='text-foreground'>
    {project.duration ? `${project.duration} ${project.durationUnit}` : '-'}
  </span>
</p>
```

Also add contract value to the **project header** (below dates line):
```tsx
{project.contractValue && (
  <p className='text-xs text-muted-foreground'>
    Contract Value: {project.currency} {Number(project.contractValue).toLocaleString()}
    {' · '}{project.duration} {project.durationUnit}
  </p>
)}
```

### File: `frontend/src/features/projects/components/project-edit-dialog.tsx`
Add form fields for `contractValue` and `duration`/`durationUnit` so users can set them. Use a number input for contract value and a paired number + select for duration unit.

## Acceptance Criteria
- [ ] Contract value shown in project header and overview tab
- [ ] Duration + unit shown in project header and overview tab
- [ ] Edit dialog allows updating both fields
- [ ] If `contractValue` is null, display `—` not `$0`
