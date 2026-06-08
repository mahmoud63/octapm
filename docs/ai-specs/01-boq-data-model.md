# BOQ Data Model — Zod Schemas & TypeScript Types

## Overview
All frontend types and Zod schemas needed for the BOQ module. Place in `src/features/boq/data/schema.ts`.

---

## 1. Raw Upload Row (parsed from Excel before AI)

```typescript
// src/features/boq/data/schema.ts

import { z } from 'zod'

// Exactly 6 columns from the Excel template
export const boqRawRowSchema = z.object({
  code: z.string(),           // e.g. "1.1", "2.3.4"
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  rate: z.number(),
  amount: z.number(),         // Excel value — server IGNORES and recalculates
})
export type BoqRawRow = z.infer<typeof boqRawRowSchema>
```

---

## 2. Validation Error (returned by upload endpoint on failure)

```typescript
export const boqValidationErrorSchema = z.object({
  code: z.string(),           // BOQ Code from the row e.g. "1.2"
  field: z.string(),          // "quantity" | "rate" | "description" | "unit" | "code"
  message: z.string(),        // human-readable e.g. "Quantity must be greater than 0"
})
export type BoqValidationError = z.infer<typeof boqValidationErrorSchema>

export const boqUploadErrorResponseSchema = z.object({
  errors: z.array(boqValidationErrorSchema),
})
```

---

## 3. Extra Services Config (from central system config)

```typescript
export const extraServiceSchema = z.object({
  label: z.string(),          // e.g. "VAT", "Contractor Overhead", "Contingency"
  percentage: z.number(),     // e.g. 5 = 5%
})
export type ExtraService = z.infer<typeof extraServiceSchema>

// GET /config/extra-services → { data: ExtraService[] }
```

---

## 4. BOQ Item (server-calculated, stored in DB)

```typescript
export const boqItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  code: z.string(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  rate: z.number(),
  amount: z.number(),         // server-calculated: quantity * rate
  isManual: z.boolean(),      // true = added from UI, cannot be uploaded-row-deleted
  sortOrder: z.number().int(),
  createdAt: z.string(),
})
export type BoqItem = z.infer<typeof boqItemSchema>
```

---

## 5. Activity (extends existing schema with boq-specific fields)

```typescript
// New fields added to existing ScheduleActivity:
export const boqActivitySchema = z.object({
  id: z.string().uuid(),
  boqItemId: z.string().uuid(),       // FK to boq_items
  projectId: z.string().uuid(),
  activityCode: z.string(),           // random alphanumeric e.g. "AC-7F2K9"
  activityName: z.string().max(255),
  unit: z.string(),
  quantity: z.number(),
  rate: z.number(),
  budget: z.number(),                 // derived: quantity * rate
  dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).nullable(),
  predecessorCode: z.string().nullable(),  // activityCode of predecessor
  isManual: z.boolean(),             // true = added by user, no AI
  sortOrder: z.number().int(),
  createdAt: z.string(),
})
export type BoqActivity = z.infer<typeof boqActivitySchema>
```

---

## 6. BOQ Item with Activities (the grouped view)

```typescript
export const boqItemWithActivitiesSchema = boqItemSchema.extend({
  activities: z.array(boqActivitySchema),
})
export type BoqItemWithActivities = z.infer<typeof boqItemWithActivitiesSchema>
```

---

## 7. Financial Summary

```typescript
export const boqFinancialSummarySchema = z.object({
  subtotal1: z.number(),              // sum of all boq item amounts
  extraServices: z.array(
    z.object({
      label: z.string(),
      percentage: z.number(),
      value: z.number(),              // subtotal1 * percentage / 100
    })
  ),
  subtotal2: z.number(),              // subtotal1 + sum of all extraServices.value
  totalProjectCost: z.number(),       // == subtotal2
})
export type BoqFinancialSummary = z.infer<typeof boqFinancialSummarySchema>
```

---

## 8. Full BOQ Response (from GET /projects/:id/boq)

```typescript
export const projectBoqSchema = z.object({
  projectId: z.string().uuid(),
  items: z.array(boqItemWithActivitiesSchema),
  financial: boqFinancialSummarySchema,
  hasUploadedBoq: z.boolean(),        // false = never uploaded, show upload zone
  uploadedAt: z.string().nullable(),
})
export type ProjectBoq = z.infer<typeof projectBoqSchema>
```

---

## 9. Mutation Input Schemas

```typescript
// Add manual BOQ row
export const createBoqItemSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  description: z.string().min(1, 'Description is required').max(255),
  quantity: z.number().positive('Quantity must be > 0'),
  unit: z.string().min(1, 'Unit is required'),
  rate: z.number().positive('Rate must be > 0'),
  // activityName and activityCode are required for manual rows (no AI)
  activityName: z.string().min(1).max(255),
  activityCode: z.string().min(1).max(20),
})
export type CreateBoqItemInput = z.infer<typeof createBoqItemSchema>

// Add activity under existing BOQ item (no AI)
export const createBoqActivitySchema = z.object({
  activityName: z.string().min(1).max(255),
  unit: z.string().min(1),
  quantity: z.number().positive(),
  rate: z.number().positive(),
  dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).nullable().optional(),
  predecessorCode: z.string().nullable().optional(),
})
export type CreateBoqActivityInput = z.infer<typeof createBoqActivitySchema>

// Edit any cell in grid (partial)
export const updateBoqItemSchema = createBoqItemSchema.partial().omit({ activityName: true, activityCode: true })
export const updateBoqActivitySchema = z.object({
  activityCode: z.string().max(20).optional(),
  activityName: z.string().max(255).optional(),
  unit: z.string().optional(),
  quantity: z.number().positive().optional(),
  rate: z.number().positive().optional(),
  dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).nullable().optional(),
  predecessorCode: z.string().nullable().optional(),
})
```

---

## DB Shape (for backend agent)

```sql
-- boq_items
CREATE TABLE boq_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code        VARCHAR(50) NOT NULL,
  description VARCHAR(500) NOT NULL,
  quantity    DECIMAL(15,4) NOT NULL,
  unit        VARCHAR(50) NOT NULL,
  rate        DECIMAL(15,4) NOT NULL,
  amount      DECIMAL(15,4) NOT NULL,  -- quantity * rate, server-computed
  is_manual   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- boq_activities
CREATE TABLE boq_activities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_item_id      UUID NOT NULL REFERENCES boq_items(id) ON DELETE CASCADE,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  activity_code    VARCHAR(20) NOT NULL,   -- random alphanumeric, system-generated
  activity_name    VARCHAR(255) NOT NULL,
  unit             VARCHAR(50) NOT NULL,
  quantity         DECIMAL(15,4) NOT NULL,
  rate             DECIMAL(15,4) NOT NULL,
  budget           DECIMAL(15,4) NOT NULL, -- quantity * rate
  dependency_type  VARCHAR(2) CHECK (dependency_type IN ('FS','SS','FF','SF')),
  predecessor_code VARCHAR(20),
  is_manual        BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- extra_services_config (system-wide, seeded)
CREATE TABLE extra_services_config (
  id         SERIAL PRIMARY KEY,
  label      VARCHAR(100) NOT NULL,
  percentage DECIMAL(5,2) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);
```
