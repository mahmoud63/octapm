import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Lock,
  MessageSquare,
  MoreHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  hasMoneyPrecision,
  MONEY_INPUT_STEP,
  MONEY_PRECISION_MESSAGE,
  toMoneyNumber,
} from '@/lib/money'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CommentThread } from '@/features/comments/components/comment-thread'
import { OpenDetailButton } from '@/features/controls/components/controls-detail-drawers'
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
  baselineLocked?: boolean
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

const moneyFields = new Set([
  'rate',
  'amount',
  'budget',
  'approvedAllocatedAmount',
  'pendingAllocatedAmount',
  'unallocatedAmount',
])

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
  const isMoneyField = moneyFields.has(field)
  const [localValue, setLocalValue] = useState<string | number>(value)

  const saveLocalValue = () => {
    if (type === 'number' && isMoneyField && !hasMoneyPrecision(localValue)) {
      toast.error(MONEY_PRECISION_MESSAGE)
      return
    }

    const nextValue =
      type === 'number'
        ? isMoneyField
          ? toMoneyNumber(localValue)
          : Number(localValue) || 0
        : localValue

    onSave(nextValue)
    setEditingCell(null)
  }

  if (readOnly) {
    return (
      <span
        className={cn(
          'block truncate px-1 py-0.5 text-muted-foreground',
          className
        )}
      >
        {type === 'number' ? fmt(Number(value)) : value}
      </span>
    )
  }

  if (isEditing) {
    return (
      <input
        autoFocus
        type={type}
        step={type === 'number' && isMoneyField ? MONEY_INPUT_STEP : undefined}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          saveLocalValue()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            saveLocalValue()
          }
          if (e.key === 'Escape') setEditingCell(null)
        }}
        className={cn(
          'w-full rounded border border-primary bg-background px-2 py-1 text-sm outline-none',
          className
        )}
      />
    )
  }

  return (
    <span
      className={cn(
        'block cursor-text truncate rounded px-1 py-0.5 hover:bg-muted/50',
        className
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
  baselineLocked = false,
  onDataChange,
}: Props) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(
    () => new Set(items.map((item) => item.id))
  )
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [addActivityForItem, setAddActivityForItem] = useState<string | null>(
    null
  )
  const [showAddRow, setShowAddRow] = useState(false)
  // The BOQ row whose discussion is open (comments and @mentions; only
  // readers of the BOQ are notified — the thread says who was not).
  const [discussItem, setDiscussItem] = useState<BoqItemWithActivities | null>(
    null
  )

  const updateItem = useUpdateBoqItem(projectId)
  const deleteItem = useDeleteBoqItem(projectId)
  const updateActivity = useUpdateBoqActivity(projectId)
  const deleteActivity = useDeleteBoqActivity(projectId)

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleUpdateItem = (
    itemId: string,
    field: string,
    value: string | number
  ) => {
    updateItem.mutate(
      { itemId, data: { [field]: value } },
      { onSuccess: onDataChange }
    )
  }

  const handleUpdateActivity = (
    activityId: string,
    allocationId: string | undefined,
    field: string,
    value: string | number
  ) => {
    updateActivity.mutate(
      {
        activityId,
        data: { [field]: value, ...(allocationId ? { allocationId } : {}) },
      },
      { onSuccess: onDataChange }
    )
  }

  const allActivityCodes = items.flatMap((item) =>
    item.activities.map((a) => a.activityCode)
  )

  return (
    <div className='rounded-lg border bg-card'>
      {baselineLocked && (
        <div className='flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground'>
          <Lock className='h-3.5 w-3.5' />
          Current BOQ baseline is locked. Upload a revised BOQ to save a
          comparison without changing these rows.
        </div>
      )}
      {/* Header */}
      <div className='flex items-center border-b bg-muted/30 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
        <div className='w-8' />
        <div className='w-24'>Code</div>
        <div className='min-w-0 flex-1'>Description</div>
        <div className='w-20 text-right'>Qty</div>
        <div className='w-16'>Unit</div>
        <div className='w-24 text-right'>Rate</div>
        <div className='w-28 text-right'>Amount</div>
        <div className='w-28 text-right'>Approved</div>
        <div className='w-28 text-right'>Pending</div>
        <div className='w-28 text-right'>Unalloc.</div>
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
              <OpenDetailButton
                kind='boq_item'
                id={item.id}
                label={`Open ${item.code} detail`}
                testId={`boq-row-open-detail-${item.id}`}
              />

              <div className='w-24 text-sm'>
                <EditableCell
                  rowId={item.id}
                  field='code'
                  value={item.code}
                  readOnly={baselineLocked}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={(v) => handleUpdateItem(item.id, 'code', v)}
                />
              </div>
              <div className='min-w-0 flex-1 text-sm'>
                <EditableCell
                  rowId={item.id}
                  field='description'
                  value={item.description}
                  readOnly={baselineLocked}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={(v) => handleUpdateItem(item.id, 'description', v)}
                />
              </div>
              <div className='w-20 text-right text-sm'>
                <EditableCell
                  rowId={item.id}
                  field='quantity'
                  value={item.quantity}
                  type='number'
                  readOnly={baselineLocked}
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
                  readOnly={baselineLocked}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={(v) => handleUpdateItem(item.id, 'unit', v)}
                />
              </div>
              <div className='w-24 text-right text-sm'>
                <EditableCell
                  rowId={item.id}
                  field='rate'
                  value={item.rate}
                  type='number'
                  readOnly={baselineLocked}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={(v) => handleUpdateItem(item.id, 'rate', v)}
                />
              </div>
              <div className='w-28 text-right text-sm'>
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
              <div className='w-28 text-right text-sm'>
                <EditableCell
                  rowId={item.id}
                  field='approvedAllocatedAmount'
                  value={
                    item.approvedAllocatedAmount ?? item.scheduledValue ?? 0
                  }
                  type='number'
                  readOnly
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={() => {}}
                  className='text-green-600'
                />
              </div>
              <div className='w-28 text-right text-sm'>
                <EditableCell
                  rowId={item.id}
                  field='pendingAllocatedAmount'
                  value={item.pendingAllocatedAmount ?? 0}
                  type='number'
                  readOnly
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={() => {}}
                  className={
                    (item.pendingAllocatedAmount ?? 0) > 0
                      ? 'font-medium text-sky-600'
                      : 'text-muted-foreground'
                  }
                />
              </div>
              <div className='w-28 text-right text-sm'>
                <EditableCell
                  rowId={item.id}
                  field='unallocatedAmount'
                  value={
                    item.unallocatedAmount ??
                    item.unscheduledValue ??
                    item.amount
                  }
                  type='number'
                  readOnly
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  onSave={() => {}}
                  className={
                    (item.unallocatedAmount ??
                      item.unscheduledValue ??
                      item.amount) > 0
                      ? 'font-medium text-amber-600'
                      : 'text-green-600'
                  }
                />
              </div>

              {/* Row actions */}
              <div className='flex w-24 flex-shrink-0 items-center justify-end gap-1'>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-7 px-2 text-xs'
                  disabled={baselineLocked}
                  onClick={() => setAddActivityForItem(item.id)}
                >
                  <Plus className='mr-1 h-3.5 w-3.5' />
                  Draft Link
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='size-7'
                      aria-label={`Row actions for ${item.code}`}
                      data-testid='boq-row-actions'
                    >
                      <MoreHorizontal className='h-4 w-4' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem
                      onClick={() => setDiscussItem(item)}
                      data-testid='boq-row-discussion'
                    >
                      <MessageSquare className='mr-2 h-4 w-4' />
                      Discussion
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {baselineLocked ? (
                      <DropdownMenuItem disabled>
                        <Lock className='mr-2 h-4 w-4' />
                        Baseline locked
                      </DropdownMenuItem>
                    ) : item.isManual ? (
                      <DropdownMenuItem
                        className='text-destructive focus:text-destructive'
                        onClick={() =>
                          deleteItem.mutate(item.id, {
                            onSuccess: onDataChange,
                          })
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
                    <div className='min-w-0 flex-1'>Activity Name</div>
                    <div className='w-16'>Unit</div>
                    <div className='w-20 text-right'>Qty</div>
                    <div className='w-24 text-right'>Rate</div>
                    <div className='w-28 text-right'>Budget</div>
                    <div className='w-16'>Dep</div>
                    <div className='w-24'>Pred.</div>
                    <div className='w-10' />
                  </div>
                )}

                {item.activities.map((act) => {
                  const isDraftAllocation =
                    (act.allocationStatus ?? 'draft') === 'draft'
                  const activityReadOnly = baselineLocked || !isDraftAllocation

                  return (
                    <div
                      key={act.id}
                      className='flex items-center gap-1 px-3 py-1 text-sm hover:bg-muted/20'
                    >
                      <div className='w-8 flex-shrink-0' />
                      <div className='w-8 flex-shrink-0 text-xs text-muted-foreground/40'>
                        └
                      </div>
                      <div className='w-24 font-mono text-xs'>
                        <EditableCell
                          rowId={act.id}
                          field='activityCode'
                          value={act.activityCode}
                          readOnly
                          editingCell={editingCell}
                          setEditingCell={setEditingCell}
                          onSave={() => {}}
                        />
                      </div>
                      <div className='min-w-0 flex-1'>
                        <EditableCell
                          rowId={act.id}
                          field='activityName'
                          value={act.activityName}
                          readOnly={activityReadOnly}
                          editingCell={editingCell}
                          setEditingCell={setEditingCell}
                          onSave={(v) =>
                            handleUpdateActivity(
                              act.id,
                              act.allocationId,
                              'activityName',
                              v
                            )
                          }
                        />
                        <div className='px-1 text-[11px] text-muted-foreground'>
                          Draft allocation link: {act.allocationStatus ?? 'draft'}
                        </div>
                      </div>
                      <div className='w-16'>
                        <EditableCell
                          rowId={act.id}
                          field='unit'
                          value={act.unit ?? ''}
                          readOnly={activityReadOnly}
                          editingCell={editingCell}
                          setEditingCell={setEditingCell}
                          onSave={(v) =>
                            handleUpdateActivity(
                              act.id,
                              act.allocationId,
                              'unit',
                              v
                            )
                          }
                        />
                      </div>
                      <div className='w-20 text-right'>
                        <EditableCell
                          rowId={act.id}
                          field='quantity'
                          value={act.quantity}
                          type='number'
                          readOnly={activityReadOnly}
                          editingCell={editingCell}
                          setEditingCell={setEditingCell}
                          onSave={(v) =>
                            handleUpdateActivity(
                              act.id,
                              act.allocationId,
                              'quantity',
                              v
                            )
                          }
                        />
                      </div>
                      <div className='w-24 text-right'>
                        <EditableCell
                          rowId={act.id}
                          field='rate'
                          value={act.rate}
                          type='number'
                          readOnly={activityReadOnly}
                          editingCell={editingCell}
                          setEditingCell={setEditingCell}
                          onSave={(v) =>
                            handleUpdateActivity(
                              act.id,
                              act.allocationId,
                              'rate',
                              v
                            )
                          }
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
                      <div className='w-24 truncate font-mono text-xs text-muted-foreground'>
                        {act.predecessorCode ?? '—'}
                      </div>
                      <div className='flex w-10 justify-end'>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='size-7 text-muted-foreground hover:text-destructive'
                          disabled={activityReadOnly}
                          onClick={() =>
                            deleteActivity.mutate(
                              {
                                activityId: act.id,
                                allocationId: act.allocationId,
                              },
                              { onSuccess: onDataChange }
                            )
                          }
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>
                  )
                })}

                {/* Empty state for activities */}
                {item.activities.length === 0 && (
                  <div className='px-16 py-2 text-xs text-muted-foreground italic'>
                    No draft allocation links. Use "Draft Link" to add one.
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
          disabled={baselineLocked}
          onClick={() => setShowAddRow(true)}
          data-testid='uat-boq-add-row'
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

      <Dialog
        open={!!discussItem}
        onOpenChange={(open) => !open && setDiscussItem(null)}
      >
        <DialogContent className='max-h-[85vh] max-w-2xl overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>
              BOQ row {discussItem?.code}
              {discussItem?.description ? ` – ${discussItem.description}` : ''}
            </DialogTitle>
            <DialogDescription>
              Only people who may read the BOQ are notified of comments and
              @mentions here.
            </DialogDescription>
          </DialogHeader>
          {discussItem && (
            <CommentThread
              projectId={projectId}
              recordType='boq_item'
              recordId={discussItem.id}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
