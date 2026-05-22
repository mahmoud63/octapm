# BOQ Module — Gap Analysis

## Source
BRD: `docs/missing featurs.pdf` — "BOQ Processing and Activity Code Generation System" (8 pages, v1.0, May 3 2026)

## Tech Stack (do not deviate)
- **Frontend:** React 19, Vite, TypeScript, shadcn/ui, Tailwind CSS v4, TanStack Query, TanStack Table, Zod, Recharts
- **API client:** `@/services/api/client` (axios wrapper, base `/api/v1/`)
- **Pattern:** feature folders at `src/features/<name>/`, each with `components/`, `hooks/`, `data/schema.ts`
- **State:** TanStack Query for server state; no extra stores needed
- **Routing:** TanStack Router file-based (`src/routes/_authenticated/`)
- **Notifications:** `sonner` (`toast.success` / `toast.error`)
- **Forms:** react-hook-form + zod resolver

## What Already Exists

| Area | Files | Status |
|------|-------|--------|
| BOQ file upload (drag-drop) | `src/features/schedule/components/schedule-upload-zone.tsx` | ✅ exists but sends directly to AI — no validation, no calculation engine |
| AI schedule generation | `src/features/schedule/hooks/use-schedule.ts` → `POST /projects/:id/schedule/generate` + job polling | ✅ exists |
| Activities CRUD | `src/features/activities/` (list, create, edit, delete, hooks, schema) | ✅ exists |
| Schedule dashboard | `src/features/schedule/components/schedule-dashboard.tsx` | ✅ exists |
| Activity schema | `wbsCode`, `name`, `category`, `duration`, `budget`, `pctComplete`, `status`, predecessors | ✅ exists — **missing** `activityCode` (random alphanumeric), `boqCode` FK |

## What Is Missing (all must be built)

### M-01 · BOQ Template Download
- No downloadable Excel template exists anywhere in the codebase
- Needed: `GET /projects/:id/boq/template` → returns `.xlsx` with 6 columns

### M-02 · BOQ Upload + Client-Side Validation
- Current upload sends file straight to AI; no validation layer
- Needed: parse Excel on backend, validate headers + fields, return structured errors before calling AI

### M-03 · Calculation Engine
- No concept of Subtotal 1 / Subtotal 2 / Total Project Cost in any frontend component or API
- Needed: server-side calc: `Amount = Qty × Rate` (override Excel), `Subtotal1 = Σ Amount`, `Subtotal2 = Subtotal1 × (1 + sum of extra service %)`, `Total = Subtotal2`

### M-04 · Extra Services Config
- No central config JSON for percentage add-ons
- Needed: `GET /config/extra-services` returns `[{label, pct}]`; used in Subtotal 2 calc

### M-05 · Activity Code Field
- `ScheduleActivity` schema has `wbsCode` but no `activityCode` (random alphanumeric like `AC-7F2K`)
- Needed: new field on activity, generated server-side on AI response

### M-06 · AI Dependency Type
- AI currently generates generic predecessors string. BRD requires typed dependency rows: `{from, to, type: 'FS'|'SS'}`
- Needed: new `dependencies` table / sub-schema, AI prompt updated

### M-07 · BOQ Editable Grid Component
- No component shows BOQ rows grouped with their child activities in an editable grid
- This is the **core deliverable** of the BRD — a grouped table where each BOQ row expands to show its activities, all cells inline-editable

### M-08 · Financial Summary Panel
- No component shows Subtotal 1, extra services breakdown, Subtotal 2, Total Project Cost
- Needed alongside the editable grid

### M-09 · BOQ CRUD Rules
- Add Activity under a BOQ row (no AI, user fills fields)
- Add manual BOQ Row (no AI, user fills all columns including Activity Name + Activity Code)
- Delete Activity ✅ (free)
- Delete BOQ Row ✗ (blocked for originally uploaded rows)

### M-10 · BOQ Management Route
- No dedicated `/projects/:id/boq` route or page
- Needed: new route + page that hosts the full BOQ module

---

## File Delivery Map

| Spec file | What it covers |
|-----------|---------------|
| `01-boq-data-model.md` | Zod schemas, TypeScript types, DB shape |
| `02-boq-upload-validation.md` | Upload component, validation rules, error dialog |
| `03-boq-calculation-engine.md` | Subtotal calc, extra-services config |
| `04-boq-editable-grid.md` | The grouped editable grid component |
| `05-boq-ai-integration.md` | AI prompt contract, dependency types |
| `06-boq-backend-api.md` | All backend endpoints an agent must implement |

---

## Coding Conventions to Follow
```
// API calls
apiClient.get('/path').then(r => r.data.data)
apiClient.post('/path', payload).then(r => r.data.data)

// Query keys: ['boq', projectId], ['boq-items', projectId]

// File structure
src/features/boq/
  components/
    boq-upload-zone.tsx      -- replaces / wraps existing schedule-upload-zone
    boq-validation-dialog.tsx
    boq-editable-grid.tsx
    boq-financial-summary.tsx
    boq-add-row-dialog.tsx
    boq-add-activity-dialog.tsx
  hooks/
    use-boq.ts
  data/
    schema.ts

// Route
src/routes/_authenticated/projects/$projectId/boq.tsx
  → createFileRoute('/_authenticated/projects/$projectId/boq')

// Sidebar entry
Add to sidebarData under Schedule group or as sub-item of Projects
```
