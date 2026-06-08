# BOQ Upload & Validation

## Overview
Replace the current `schedule-upload-zone.tsx` upload flow with a validated BOQ upload. The server parses the Excel file, validates every row, and returns structured errors before calling AI.

---

## Component: `BoqUploadZone`
**File:** `src/features/boq/components/boq-upload-zone.tsx`

### Props
```typescript
interface BoqUploadZoneProps {
  projectId: string
  project: {
    name?: string
    startDate?: string | null
    duration?: number | null
  }
  onUploadSuccess: () => void  // invalidates boq query
}
```

### Behaviour
1. Render drag-drop zone + "Choose File" button
2. Accept only `.xlsx` or `.xls` (not CSV — template is Excel only)
3. Show "Download Template" button (calls `GET /projects/:id/boq/template`)
4. On file select → call `POST /projects/:id/boq/upload`
5. If response is `400` with `{ errors: BoqValidationError[] }` → open `BoqValidationDialog`
6. If response is `200` → begin polling job via `useBoqGenerate` hook → show `GenerationProgress`
7. If AI job fails → show error state with retry button

### Download Template Button
```tsx
<Button
  variant='outline'
  size='sm'
  onClick={async () => {
    const res = await apiClient.get(`/projects/${projectId}/boq/template`, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = 'boq-template.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }}
>
  <Download className='mr-2 h-4 w-4' />
  Download Template
</Button>
```

### Upload Mutation (in `use-boq.ts`)
```typescript
export function useBoqUpload(projectId: string) {
  return useMutation({
    mutationFn: ({ file, label }: { file: File; label?: string }) => {
      const fd = new FormData()
      fd.append('file', file)
      if (label?.trim()) fd.append('label', label.trim())
      return apiClient
        .post(`/projects/${projectId}/boq/upload`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then(r => r.data.data as { jobId: string })
    },
  })
}
```

---

## Component: `BoqValidationDialog`
**File:** `src/features/boq/components/boq-validation-dialog.tsx`

### Purpose
Modal that shows ALL validation errors from the upload attempt. User must fix the Excel file and re-upload; dialog has no "ignore" option.

### Props
```typescript
interface BoqValidationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  errors: BoqValidationError[]
}
```

### UI Structure
```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className='max-w-lg'>
    <DialogHeader>
      <DialogTitle className='flex items-center gap-2 text-destructive'>
        <AlertCircle className='h-5 w-5' />
        BOQ Validation Failed
      </DialogTitle>
      <DialogDescription>
        {errors.length} error{errors.length !== 1 ? 's' : ''} found.
        Fix the Excel file and re-upload.
      </DialogDescription>
    </DialogHeader>

    <ScrollArea className='max-h-72'>
      <div className='space-y-2 pr-4'>
        {errors.map((err, i) => (
          <div key={i} className='flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm'>
            <span className='font-mono font-semibold text-destructive min-w-fit'>
              Code {err.code}
            </span>
            <span className='text-muted-foreground'>
              <span className='font-medium text-foreground capitalize'>{err.field}:</span>{' '}
              {err.message}
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>

    <DialogFooter>
      <Button onClick={() => onOpenChange(false)}>Close & Fix File</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## Server-Side Validation Rules

The backend must validate in this order and collect ALL errors before returning:

```javascript
// Backend validation logic (Express.js service)
function validateBoqRows(rows) {
  const REQUIRED_HEADERS = ['Code', 'Description', 'Quantity', 'Unit', 'Rate', 'Amount']
  const errors = []

  // 1. Header check — exact match, case-sensitive
  // If headers don't match → return single error immediately (cannot proceed)
  const actualHeaders = Object.keys(rows[0] || {})
  const headersMatch = REQUIRED_HEADERS.every((h, i) => actualHeaders[i] === h)
  if (!headersMatch) {
    return { valid: false, errors: [{
      code: 'HEADER',
      field: 'headers',
      message: `Headers must be exactly: ${REQUIRED_HEADERS.join(', ')}`
    }]}
  }

  // 2. Per-row validation — collect all errors
  rows.forEach(row => {
    const code = row.Code || `(row ${rows.indexOf(row) + 2})`

    if (!row.Description?.trim())
      errors.push({ code, field: 'description', message: 'Description is empty' })
    if (!row.Unit?.trim())
      errors.push({ code, field: 'unit', message: 'Unit is empty' })
    if (row.Quantity == null || row.Quantity === '')
      errors.push({ code, field: 'quantity', message: 'Quantity is empty' })
    else if (isNaN(Number(row.Quantity)) || Number(row.Quantity) <= 0)
      errors.push({ code, field: 'quantity', message: 'Quantity must be a positive number' })
    if (row.Rate == null || row.Rate === '')
      errors.push({ code, field: 'rate', message: 'Rate is empty' })
    else if (isNaN(Number(row.Rate)) || Number(row.Rate) <= 0)
      errors.push({ code, field: 'rate', message: 'Rate must be a positive number' })
  })

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, errors: [] }
}
```

### Response on failure
```json
HTTP 400
{
  "success": false,
  "error": {
    "code": "BOQ_VALIDATION_FAILED",
    "message": "BOQ file contains validation errors",
    "errors": [
      { "code": "1.2", "field": "quantity", "message": "Quantity must be a positive number" },
      { "code": "3.1", "field": "unit", "message": "Unit is empty" }
    ]
  }
}
```

### Frontend error handling
```typescript
// In upload mutation onError handler:
const err = error as AxiosError<{ error: { code: string; errors: BoqValidationError[] } }>
if (err.response?.status === 400 && err.response.data.error.code === 'BOQ_VALIDATION_FAILED') {
  setValidationErrors(err.response.data.error.errors)
  setShowValidationDialog(true)
} else {
  toast.error(err.response?.data?.error?.message ?? 'Upload failed')
}
```

---

## Excel Template Spec (backend generates this)

```javascript
// Backend: generates .xlsx using exceljs or xlsx library
const workbook = new ExcelJS.Workbook()
const sheet = workbook.addWorksheet('BOQ')

// Headers in row 1
sheet.columns = [
  { header: 'Code',        key: 'code',        width: 12 },
  { header: 'Description', key: 'description', width: 40 },
  { header: 'Quantity',    key: 'quantity',     width: 12 },
  { header: 'Unit',        key: 'unit',         width: 10 },
  { header: 'Rate',        key: 'rate',         width: 14 },
  { header: 'Amount',      key: 'amount',       width: 16 },
]

// Style header row
sheet.getRow(1).font = { bold: true }
sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } }

// Add 3 example rows
sheet.addRow({ code: '1.1', description: 'Example: Earthworks', quantity: 100, unit: 'm³', rate: 25, amount: 2500 })
sheet.addRow({ code: '1.2', description: 'Example: Concrete C30', quantity: 50, unit: 'm³', rate: 150, amount: 7500 })
sheet.addRow({ code: '2.1', description: 'Example: Steel Reinforcement', quantity: 5000, unit: 'kg', rate: 1.2, amount: 6000 })

// Note in row after examples
sheet.addRow({})
sheet.addRow({ code: '* Note:', description: 'Amount column is auto-calculated by system (Quantity × Rate). Your value is ignored.' })
```

---

## Readiness Checks (same as existing upload zone)

Before showing upload button, warn if:
- `project.name` is blank
- `project.startDate` is null
- `project.duration` is null or ≤ 0
