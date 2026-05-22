# BOQ Calculation Engine

## Overview
After successful validation, before calling AI, the server computes all financial values. This is pure server-side logic — the frontend only displays results.

---

## Calculation Rules (strict, non-negotiable)

```
Amount_i      = Quantity_i × Rate_i   (Excel Amount column is DISCARDED)
Subtotal1     = Σ Amount_i            (sum of all valid BOQ row amounts)
ExtraValue_k  = Subtotal1 × (Percentage_k / 100)   for each extra service k
Subtotal2     = Subtotal1 + Σ ExtraValue_k
TotalCost     = Subtotal2             (Total = Subtotal2, NOT Subtotal1)
```

---

## Extra Services Config

**Source:** Central JSON / DB table `extra_services_config` — same for ALL projects (system-wide)

**Default seed data** (populate on first migration):
```json
[
  { "label": "VAT",                  "percentage": 5.0,  "sortOrder": 1 },
  { "label": "Contractor Overhead",  "percentage": 10.0, "sortOrder": 2 },
  { "label": "Contingency",          "percentage": 3.0,  "sortOrder": 3 }
]
```

**Backend endpoint:** `GET /config/extra-services`
```json
{
  "success": true,
  "data": [
    { "label": "VAT",                 "percentage": 5.0 },
    { "label": "Contractor Overhead", "percentage": 10.0 },
    { "label": "Contingency",         "percentage": 3.0 }
  ]
}
```

Note: Customizing percentages per-project is out of scope (BRD explicit). The endpoint is read-only for now.

---

## Backend Calculation Service

```javascript
// services/boq-calculation.service.js

async function calculateBoqFinancials(projectId, boqItems) {
  // 1. Recalculate Amount for every row
  const itemsWithAmount = boqItems.map(item => ({
    ...item,
    amount: parseFloat((item.quantity * item.rate).toFixed(4)),
  }))

  // 2. Subtotal 1
  const subtotal1 = itemsWithAmount.reduce((sum, item) => sum + item.amount, 0)

  // 3. Load extra services from config
  const extraServices = await db.query(
    'SELECT label, percentage FROM extra_services_config ORDER BY sort_order'
  )

  // 4. Calculate each extra service value
  const extraServicesWithValues = extraServices.rows.map(svc => ({
    label: svc.label,
    percentage: parseFloat(svc.percentage),
    value: parseFloat((subtotal1 * (svc.percentage / 100)).toFixed(4)),
  }))

  // 5. Subtotal 2
  const subtotal2 = subtotal1 + extraServicesWithValues.reduce((s, e) => s + e.value, 0)

  // 6. Total = Subtotal2
  return {
    subtotal1: parseFloat(subtotal1.toFixed(4)),
    extraServices: extraServicesWithValues,
    subtotal2: parseFloat(subtotal2.toFixed(4)),
    totalProjectCost: parseFloat(subtotal2.toFixed(4)),
  }
}
```

---

## Component: `BoqFinancialSummary`
**File:** `src/features/boq/components/boq-financial-summary.tsx`

Renders below the editable grid. Read-only display of the calculation breakdown.

```tsx
interface BoqFinancialSummaryProps {
  financial: BoqFinancialSummary
  currency: string  // from project, e.g. "USD"
}

export function BoqFinancialSummary({ financial, currency }: BoqFinancialSummaryProps) {
  const fmt = (n: number) =>
    `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className='rounded-lg border bg-card p-4'>
      <h3 className='mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
        Financial Summary
      </h3>

      <div className='space-y-1.5 text-sm'>
        {/* Subtotal 1 */}
        <div className='flex justify-between'>
          <span className='text-muted-foreground'>Subtotal 1 (BOQ Total)</span>
          <span className='font-medium tabular-nums'>{fmt(financial.subtotal1)}</span>
        </div>

        <Separator className='my-2' />

        {/* Extra Services */}
        {financial.extraServices.map(svc => (
          <div key={svc.label} className='flex justify-between text-muted-foreground'>
            <span>{svc.label} ({svc.percentage}%)</span>
            <span className='tabular-nums'>+ {fmt(svc.value)}</span>
          </div>
        ))}

        <Separator className='my-2' />

        {/* Subtotal 2 */}
        <div className='flex justify-between font-medium'>
          <span>Subtotal 2 (incl. services)</span>
          <span className='tabular-nums'>{fmt(financial.subtotal2)}</span>
        </div>

        {/* Total Project Cost — highlighted */}
        <div className='mt-2 flex justify-between rounded-md bg-primary/10 px-3 py-2 text-base font-bold text-primary'>
          <span>Total Project Cost</span>
          <span className='tabular-nums'>{fmt(financial.totalProjectCost)}</span>
        </div>
      </div>
    </div>
  )
}
```

---

## Hook: `useExtraServicesConfig`

```typescript
// src/features/boq/hooks/use-boq.ts

export const useExtraServicesConfig = () =>
  useQuery<ExtraService[]>({
    queryKey: ['extra-services-config'],
    queryFn: () =>
      apiClient.get('/config/extra-services').then(r => r.data.data),
    staleTime: 1000 * 60 * 60, // 1 hour — rarely changes
  })
```

---

## When to Recalculate

The financial summary is **always server-computed** and returned in `GET /projects/:id/boq`. The frontend never calculates financial values client-side. When any BOQ item's quantity or rate changes (via inline edit), the server recomputes and returns updated `financial` in the response.

If the user edits a row:
```
PATCH /projects/:id/boq/items/:itemId
Body: { quantity: 120, rate: 30 }
Response: { item: BoqItem, financial: BoqFinancialSummary }
```

The component updates its local query cache with the new `financial` value via `queryClient.setQueryData`.
