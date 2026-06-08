# BOQ Editable Grid Component

## Overview
The core UI deliverable. A grouped, two-level table where:
- **Level 1 (parent rows):** BOQ Items — Code, Description, Qty, Unit, Rate, Amount
- **Level 2 (child rows, indented):** Activities under each BOQ item — Activity Code, Activity Name, Unit, Qty, Rate, Budget, Dependency Type, Predecessor

All cells are inline-editable except:
- `Amount` (BOQ item) — read-only, server-computed
- `Budget` (activity) — read-only, server-computed
- Originally uploaded BOQ rows cannot be deleted (only manually added rows can)

---

## File: `src/features/boq/components/boq-editable-grid.tsx`

### Props
```typescript
interface BoqEditableGridProps {
  projectId: string
  items: BoqItemWithActivities[]
  financial: BoqFinancialSummary
  currency: string
  onDataChange: () => void  // called after any mutation to refresh parent
}
```

---

## Grid Structure

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Code   Description           Qty    Unit   Rate      Amount        Actions      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ▼ 1.1   Earthworks          100.0    m³    25.00    2,500.00         [+ Act] [⋯] │
│         ├── Act.Code  Activity Name      Unit  Qty   Rate   Budget  Dep  Pred    │
│         │   AC-7F2K9  Excavation         m³   60.0  25.00  1500.00  FS   —       │
│         │   AC-8B3MN  Backfill           m³   40.0  25.00  1000.00  FS   AC-7F2K9│
│         └─  [+ Add Activity]                                                      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ▼ 1.2   Concrete C30         50.0    m³   150.00    7,500.00         [+ Act] [⋯] │
│         │   AC-2D9QR  Formwork           m²   80.0  20.00  1600.00  SS   AC-7F2K9│
│         └─  [+ Add Activity]                                                      │
├──────────────────────────────────────────────────────────────────────────────────┤
│  [+ Add BOQ Row]                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Inline Edit Behaviour

Use a local `editingCell` state: `{ rowId: string, field: string } | null`

- Single click → set `editingCell` → render `<input>` / `<select>` in that cell
- On blur or Enter → call PATCH API → clear `editingCell`
- On Escape → clear `editingCell` without saving

```typescript
const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null)

function EditableCell({
  rowId,
  field,
  value,
  type = 'text',
  onSave,
}: {
  rowId: string
  field: string
  value: string | number
  type?: 'text' | 'number'
  onSave: (value: string | number) => void
}) {
  const isEditing = editingCell?.rowId === rowId && editingCell?.field === field
  const [localValue, setLocalValue] = useState(value)

  if (isEditing) {
    return (
      <input
        autoFocus
        type={type}
        value={localValue}
        onChange={e => setLocalValue(type === 'number' ? Number(e.target.value) : e.target.value)}
        onBlur={() => { onSave(localValue); setEditingCell(null) }}
        onKeyDown={e => {
          if (e.key === 'Enter') { onSave(localValue); setEditingCell(null) }
          if (e.key === 'Escape') setEditingCell(null)
        }}
        className='w-full rounded border border-primary bg-background px-2 py-1 text-sm outline-none'
      />
    )
  }

  return (
    <span
      className='block cursor-text truncate rounded px-1 py-0.5 hover:bg-muted/50'
      onClick={() => setEditingCell({ rowId, field })}
    >
      {value}
    </span>
  )
}
```

---

## Row Expand/Collapse

Each BOQ item row has a `▶ / ▼` toggle to show/hide its activities:

```typescript
const [expandedRows, setExpandedRows] = useState<Set<string>>(
  () => new Set(items.map(item => item.id))  // all expanded by default
)

const toggleRow = (id: string) => {
  setExpandedRows(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
}
```

---

## BOQ Item Row Actions

```tsx
// [+ Activity] button — opens BoqAddActivityDialog
<Button
  variant='ghost'
  size='sm'
  className='h-7 px-2 text-xs'
  onClick={() => setAddActivityForItem(item.id)}
>
  <Plus className='mr-1 h-3.5 w-3.5' />
  Activity
</Button>

// [⋯] overflow menu
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant='ghost' size='icon' className='size-7'>
      <MoreHorizontal className='h-4 w-4' />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align='end'>
    {item.isManual && (
      <DropdownMenuItem
        variant='destructive'
        onClick={() => handleDeleteBoqItem(item.id)}
      >
        <Trash2 className='h-4 w-4' />
        Delete Row
      </DropdownMenuItem>
    )}
    {!item.isManual && (
      <DropdownMenuItem disabled>
        <Lock className='h-4 w-4' />
        Cannot delete uploaded rows
      </DropdownMenuItem>
    )}
  </DropdownMenuContent>
</DropdownMenu>
```

---

## Activity Row Actions

```tsx
// Delete button — always available for activities
<Button
  variant='ghost'
  size='icon'
  className='size-7 text-muted-foreground hover:text-destructive'
  onClick={() => handleDeleteActivity(activity.id)}
>
  <Trash2 className='h-3.5 w-3.5' />
</Button>
```

---

## Component: `BoqAddActivityDialog`
**File:** `src/features/boq/components/boq-add-activity-dialog.tsx`

Opens when user clicks "+ Activity" on a BOQ row.

```typescript
interface BoqAddActivityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  boqItemId: string
  projectId: string
  existingActivityCodes: string[]  // for predecessor select
}
```

Fields:
- **Activity Name** — text input, required, max 255 chars
- **Unit** — text input, required
- **Quantity** — number input, required, > 0
- **Rate** — number input, required, > 0
- **Dependency Type** — select: None / FS (Finish-to-Start) / SS (Start-to-Start)
- **Predecessor** — select from `existingActivityCodes`, only shown when Dependency Type ≠ None
- Activity Code is **auto-generated by server** — not shown in this dialog

---

## Component: `BoqAddRowDialog`
**File:** `src/features/boq/components/boq-add-row-dialog.tsx`

Opens when user clicks "+ Add BOQ Row" at the bottom of the grid.

```typescript
interface BoqAddRowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}
```

Fields:
- **Code** — text input, required (user sets their own code, e.g. "3.5")
- **Description** — text input, required, max 255 chars
- **Quantity** — number input, required, > 0
- **Unit** — text input, required
- **Rate** — number input, required, > 0
- **Activity Name** — text input, required, max 255 chars (NO AI — user types manually)
- **Activity Code** — text input, required, max 20 chars (user assigns own code — NO AI)

Note in dialog: _"This row will not be processed by AI. Enter the Activity Name and Activity Code manually."_

---

## Mutations in `use-boq.ts`

```typescript
// Update BOQ item fields
export function useUpdateBoqItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: Partial<UpdateBoqItemInput> }) =>
      apiClient.patch(`/projects/${projectId}/boq/items/${itemId}`, data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boq', projectId] }),
  })
}

// Update activity fields
export function useUpdateBoqActivity(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ activityId, data }: { activityId: string; data: Partial<UpdateBoqActivityInput> }) =>
      apiClient.patch(`/projects/${projectId}/boq/activities/${activityId}`, data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boq', projectId] }),
  })
}

// Create manual BOQ row
export function useCreateBoqItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateBoqItemInput) =>
      apiClient.post(`/projects/${projectId}/boq/items`, data).then(r => r.data.data),
    onSuccess: () => {
      toast.success('BOQ row added')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
  })
}

// Add activity under BOQ item
export function useCreateBoqActivity(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ boqItemId, data }: { boqItemId: string; data: CreateBoqActivityInput }) =>
      apiClient.post(`/projects/${projectId}/boq/items/${boqItemId}/activities`, data).then(r => r.data.data),
    onSuccess: () => {
      toast.success('Activity added')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
  })
}

// Delete activity
export function useDeleteBoqActivity(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (activityId: string) =>
      apiClient.delete(`/projects/${projectId}/boq/activities/${activityId}`).then(r => r.data.data),
    onSuccess: () => {
      toast.success('Activity deleted')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
  })
}

// Delete manual BOQ row (only isManual=true rows)
export function useDeleteBoqItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) =>
      apiClient.delete(`/projects/${projectId}/boq/items/${itemId}`).then(r => r.data.data),
    onSuccess: () => {
      toast.success('BOQ row deleted')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
    onError: (err: AxiosError) => {
      toast.error(err.response?.data?.error?.message ?? 'Cannot delete this row')
    },
  })
}
```

---

## Empty State

When `items.length === 0` (no BOQ uploaded yet), show `BoqUploadZone` instead of the grid.

When `items.length > 0`, show the grid + financial summary + "+ Add BOQ Row" button at bottom.

---

## Table Header

```tsx
// Column widths (approximate)
const columns = [
  { key: 'expand',       label: '',              width: 'w-8' },
  { key: 'code',         label: 'Code',          width: 'w-24' },
  { key: 'description',  label: 'Description',   width: 'flex-1 min-w-0' },
  { key: 'quantity',     label: 'Qty',           width: 'w-20 text-right' },
  { key: 'unit',         label: 'Unit',          width: 'w-16' },
  { key: 'rate',         label: 'Rate',          width: 'w-24 text-right' },
  { key: 'amount',       label: 'Amount',        width: 'w-28 text-right' },
  { key: 'actions',      label: '',              width: 'w-20' },
]

// Activity sub-columns (shown indented, different set)
const activityColumns = [
  { key: 'activityCode', label: 'Act. Code',     width: 'w-24' },
  { key: 'activityName', label: 'Activity Name', width: 'flex-1 min-w-0' },
  { key: 'unit',         label: 'Unit',          width: 'w-16' },
  { key: 'quantity',     label: 'Qty',           width: 'w-20 text-right' },
  { key: 'rate',         label: 'Rate',          width: 'w-24 text-right' },
  { key: 'budget',       label: 'Budget',        width: 'w-28 text-right' },
  { key: 'depType',      label: 'Dep',           width: 'w-16' },
  { key: 'predecessor',  label: 'Pred.',         width: 'w-24' },
  { key: 'actions',      label: '',              width: 'w-10' },
]
```
