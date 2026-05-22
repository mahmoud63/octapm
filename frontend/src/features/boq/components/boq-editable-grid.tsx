import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Lock,
  MoreHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { BoqItemWithActivities, BoqFinancialSummary } from '../data/schema'
import {
  useUpdateBoqItem,
  useDeleteBoqItem,
  useUpdateBoqActivity,
  useDeleteBoqActivity,
} from '../hooks/use-boq'
import { BoqAddActivityDialog } from './boq-add-activity-dialog'
import { BoqAddRowDialog } from './boq-add-row-dialog'

interface Props {
  projectId: string
  items: BoqItemWithActivities[]
  financial: BoqFinancialSummary | null
  currency: string
  onDataChange: () => void
}

interface EditingCell {
  rowId: string
  field: string
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)

function EditableCell({
  rowId,
  field,
  value,
  type = 'text',
  readOnly = false,
  editingCell,
  setEditingCell,
  onSave,
  className,
}: {
  rowId: string
  field: string
  value: string | number
  type?: 'text' | 'number'
  readOnly?: boolean
  editingCell: EditingCell | null
  setEditingCell: (cell: EditingCell | null) => void
  onSave: (val: string | number) => void
  className?: string
}) {
  const isEditing = editingCell?.rowId === rowId && editingCell?.field === field
  const [localValue, setLocalValue] = useState<string | number>(value)

  if (readOnly) {
    return (
      <span className={cn('block truncate px-1 py-0.5 text-muted-foreground', className)}>
        {type === 'number' ? fmt(Number(value)) : value}
      </span>
    )
  }

  if (isEditing) {
    return (
      <input
        autoFocus
        type={type}
        value={localValue}
        onChange={(e) =>
          setLocalValue(type === 'number' ? Number(e.target.value) : e.target.value)
        }
        onBlur={() => {
          onSave(localValue)
          setEditingCell(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSave(localValue)
            setEditingCell(null)
          }
          if (e.key === 'Escape') setEditingCell(null)
        }}
        className={cn(
          'w-full rounded border border-primary bg-background px-2 py-1 text-sm outline-none',
          className,
        )}
      />
    )
  }

  return (
    <span
      className={cn(
        'block cursor-text truncate rounded px-1 py-0.5 hover:bg-muted/50',
        className,
      )}
      onClick={() => {
        setLocalValue(value)
        setEditingCell({ rowId, field })
      }}
    >
      {type === 'number' ? fmt(Number(value)) : value}
    </span>
  )
}

export function BoqEditableGrid({
  projectId,
  items,
  onDataChange,
}: Props) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(
    () => new Set(items.map((item) => item.id)),
  )
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [addActivityForItem, setAddActivityForItem] = useState<string | null>(null)
  const [showAddRow, setShowAddRow] = useState(false)

  const updateItem = useUpdateBoqItem(projectId)
  const deleteItem = useDeleteBoqItem(projectId)
  const updateActivity = useUpdateBoqActivity(projectId)
  const deleteActivity = useDeleteBoqActivity(projectId)

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleUpdateItem = (itemId: string, field: string, value: string | number) => {
    updateItem.mutate({ itemId, data: { [field]: value } }, { onSuccess: onDataChange })
  }

  const handleUpdateActivity = (
    activityId: string,
    field: string,
    value: string | number,
  ) => {
    updateActivity.mutate(
      { activityId, data: { [field]: value } },
      { onSuccess: onDataChange },
    )
  }

  const allActivityCodes = items.flatMap((item) =>
    item.activities.map((a) => a.activityCode),
  )

  return (
    <div className='rounded-lg border bg-card'>
      {/* Header */}
      <div className='flex items-center border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        <div className='w-8' />
        <div className='w-24'>Code</div>
        <div className='flex-1 min-w-0'>Description</div>
        <div className='w-20 text-right'>Qty</div>
        <div className='w-16'>Unit</div>
        <div className='w-24 text-right'>Rate</div>
        <div className='w-28 text-right'>Amount</div>
        <div className='w-24' />
      </div>

      {/* Rows */}
      {items.map((item) => {
        const expanded = expandedRows.has(item.id)
        return (
          <div key={item.id} className='border-b last:border-b-0'>
            {/* BOQ Item row */}
            <div className='flex items-center gap-1 px-3 py-1.5 hover:bg-muted/20'>
              <button
                onClick={() => toggleRow(item.id)}
                className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground'
              >
                {expanded ? (
                  <ChevronDown className='h-3.5 w-3.5' />
                ) : (
                  <ChevronRight className='h-3.5 w-3.5' />
                )}
              </button>

              <div className='w-24 text-sm'>
                <EditableCell
                  rowId={item.id}
                  field='code'
                  value={item.code}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={(v) => handleUpdateItem(item.id, 'code', v)}
                />
              </div>
              <div className='flex-1 min-w-0 text-sm'>
                <EditableCell
                  rowId={item.id}
                  field='description'
                  value={item.description}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={(v) => handleUpdateItem(item.id, 'description', v)}
                />
              </div>
              <div className='w-20 text-sm text-right'>
                <EditableCell
                  rowId={item.id}
                  field='quantity'
                  value={item.quantity}
                  type='number'
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={(v) => handleUpdateItem(item.id, 'quantity', v)}
                />
              </div>
              <div className='w-16 text-sm'>
                <EditableCell
                  rowId={item.id}
                  field='unit'
                  value={item.unit ?? ''}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={(v) => handleUpdateItem(item.id, 'unit', v)}
                />
              </div>
              <div className='w-24 text-sm text-right'>
                <EditableCell
                  rowId={item.id}
                  field='rate'
                  value={item.rate}
                  type='number'
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={(v) => handleUpdateItem(item.id, 'rate', v)}
                />
              </div>
              <div className='w-28 text-sm text-right'>
                <EditableCell
                  rowId={item.id}
                  field='amount'
                  value={item.amount}
                  type='number'
                  readOnly
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={() => {}}
                />
              </div>

              {/* Row actions */}
              <div className='flex w-24 flex-shrink-0 items-center justify-end gap-1'>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-7 px-2 text-xs'
                  onClick={() => setAddActivityForItem(item.id)}
                >
                  <Plus className='mr-1 h-3.5 w-3.5' />
                  Activity
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='ghost' size='icon' className='size-7'>
                      <MoreHorizontal className='h-4 w-4' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    {item.isManual ? (
                      <DropdownMenuItem
                        className='text-destructive focus:text-destructive'
                        onClick={() =>
                          deleteItem.mutate(item.id, { onSuccess: onDataChange })
                        }
                      >
                        <Trash2 className='mr-2 h-4 w-4' />
                        Delete Row
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem disabled>
                        <Lock className='mr-2 h-4 w-4' />
                        Cannot delete uploaded rows
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Activity rows */}
            {expanded && (
              <div className='border-t bg-muted/5'>
                {/* Activity column header */}
                {item.activities.length > 0 && (
                  <div className='flex items-center border-b border-dashed px-3 py-1 text-xs font-medium text-muted-foreground'>
                    <div className='w-8' />
                    <div className='w-8 flex-shrink-0' />
                    <div className='w-24'>Act. Code</div>
                    <div className='flex-1 min-w-0'>Activity Name</div>
                    <div className='w-16'>Unit</div>
                    <div className='w-20 text-right'>Qty</div>
                    <div className='w-24 text-right'>Rate</div>
                    <div className='w-28 text-right'>Budget</div>
                    <div className='w-16'>Dep</div>
                    <div className='w-24'>Pred.</div>
                    <div className='w-10' />
                  </div>
                )}

                {item.activities.map((act) => (
                  <div
                    key={act.id}
                    className='flex items-center gap-1 px-3 py-1 text-sm hover:bg-muted/20'
                  >
                    <div className='w-8 flex-shrink-0' />
                    <div className='w-8 flex-shrink-0 text-muted-foreground/40 text-xs'>└</div>
                    <div className='w-24 font-mono text-xs'>
                      <EditableCell
                        rowId={act.id}
                        field='activityCode'
                        value={act.activityCode}
                        editingCell={editingCell}
                        setEditingCell={setEditingCell}
                        onSave={(v) =>
                          handleUpdateActivity(act.id, 'activityCode', v)
                        }
                      />
                    </div>
                    <div className='flex-1 min-w-0'>
                      <EditableCell
                        rowId={act.id}
                        field='activityName'
                        value={act.activityName}
                        editingCell={editingCell}
                        setEditingCell={setEditingCell}
                        onSave={(v) =>
                          handleUpdateActivity(act.id, 'activityName', v)
                        }
                      />
                    </div>
                    <div className='w-16'>
                      <EditableCell
                        rowId={act.id}
                        field='unit'
                        value={act.unit ?? ''}
                        editingCell={editingCell}
                        setEditingCell={setEditingCell}
                        onSave={(v) => handleUpdateActivity(act.id, 'unit', v)}
                      />
                    </div>
                    <div className='w-20 text-right'>
                      <EditableCell
                        rowId={act.id}
                        field='quantity'
                        value={act.quantity}
                        type='number'
                        editingCell={editingCell}
                        setEditingCell={setEditingCell}
                        onSave={(v) =>
                          handleUpdateActivity(act.id, 'quantity', v)
                        }
                      />
                    </div>
                    <div className='w-24 text-right'>
                      <EditableCell
                        rowId={act.id}
                        field='rate'
                        value={act.rate}
                        type='number'
                        editingCell={editingCell}
                        setEditingCell={setEditingCell}
                        onSave={(v) => handleUpdateActivity(act.id, 'rate', v)}
                      />
                    </div>
                    <div className='w-28 text-right'>
                      <EditableCell
                        rowId={act.id}
                        field='budget'
                        value={act.budget}
                        type='number'
                        readOnly
                        editingCell={editingCell}
                        setEditingCell={setEditingCell}
                        onSave={() => {}}
                      />
                    </div>
                    <div className='w-16 text-xs text-muted-foreground'>
                      {act.dependencyType ?? '—'}
                    </div>
                    <div className='w-24 font-mono text-xs text-muted-foreground truncate'>
                      {act.predecessorCode ?? '—'}
                    </div>
                    <div className='w-10 flex justify-end'>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='size-7 text-muted-foreground hover:text-destructive'
                        onClick={() =>
                          deleteActivity.mutate(act.id, { onSuccess: onDataChange })
                        }
                      >
                        <Trash2 className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  </div>
                ))}

                {/* Empty state for activities */}
                {item.activities.length === 0 && (
                  <div className='px-16 py-2 text-xs text-muted-foreground italic'>
                    No activities — click "+ Activity" to add one
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Add row button */}
      <div className='flex items-center border-t p-3'>
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground'
          onClick={() => setShowAddRow(true)}
        >
          <Plus className='mr-1.5 h-4 w-4' />
          Add BOQ Row
        </Button>
      </div>

      {/* Dialogs */}
      {addActivityForItem && (
        <BoqAddActivityDialog
          open={!!addActivityForItem}
          onOpenChange={(open) => !open && setAddActivityForItem(null)}
          boqItemId={addActivityForItem}
          projectId={projectId}
          existingActivityCodes={allActivityCodes}
        />
      )}

      <BoqAddRowDialog
        open={showAddRow}
        onOpenChange={setShowAddRow}
        projectId={projectId}
      />
    </div>
  )
}
