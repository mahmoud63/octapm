# OctaPM — AI Agent Spec Files

## Purpose
These files are structured specifications for AI coding agents. Each file is self-contained enough that an agent can implement the described feature without needing to read the full codebase.

## Source BRD
`docs/missing featurs.pdf` — "BOQ Processing and Activity Code Generation System" (v1.0, May 3 2026)

## Read Order

| File | Read when you need to… |
|------|------------------------|
| `00-gap-analysis.md` | Understand what exists vs what to build; tech stack conventions |
| `01-boq-data-model.md` | Implement types, Zod schemas, DB tables |
| `02-boq-upload-validation.md` | Build upload component + validation dialog + Excel template |
| `03-boq-calculation-engine.md` | Implement financial calc (Subtotals, extra services) |
| `04-boq-editable-grid.md` | Build the main BOQ+activities editable grid UI |
| `05-boq-ai-integration.md` | Implement AI prompt, activity code generator, async job |
| `06-boq-backend-api.md` | Implement all Express.js endpoints |
| `07-boq-frontend-route-and-hooks.md` | Wire route, page, and TanStack Query hooks |

## Key Design Decisions

1. **BOQ is a separate module** from the existing Schedule. The existing `schedule-upload-zone.tsx` flow (upload → AI → schedule) remains unchanged. BOQ management is a new feature accessed from the project sidebar.

2. **Two-level grid**: BOQ Items (parent) → Activities (children). BOQ items cannot be deleted if `isManual = false`. Activities can always be deleted.

3. **Server owns financials**: Amount, Budget, Subtotal1, Subtotal2, TotalCost are never calculated on the frontend. Always read from API.

4. **Activity Code format**: `AC-XXXXX` (prefix + 5 uppercase alphanumeric chars, no 0/O/1/I). System-generated, user-editable after generation.

5. **Dependency types**: Only `FS` (Finish-to-Start) and `SS` (Start-to-Start) per BRD. `FF` and `SF` are in the schema for future use but not exposed in UI for now.

6. **No AI for manual rows**: When user adds a BOQ row or an activity from the UI, no AI call is made. User must supply Activity Name and Activity Code manually.

7. **Extra services are system-wide**: No per-project customization. Seeded once in DB. Read-only from frontend.

## File Locations to Create

```
Frontend:
  src/features/boq/
    components/
      boq-page.tsx
      boq-upload-zone.tsx          (replaces schedule-upload-zone for BOQ flow)
      boq-validation-dialog.tsx
      boq-editable-grid.tsx        (core deliverable)
      boq-financial-summary.tsx
      boq-add-row-dialog.tsx
      boq-add-activity-dialog.tsx
    hooks/
      use-boq.ts
    data/
      schema.ts
  src/routes/_authenticated/projects/$projectId/boq.tsx

Backend:
  routes/boq.routes.js
  controllers/boq.controller.js
  services/boq.service.js
  services/boq-calculation.service.js
  utils/activity-code.js
  migrations/YYYYMMDD_create_boq_tables.js
```
