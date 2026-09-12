import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  type LongLeadItemRecord,
  type LongLeadPayload,
  useCreateLongLeadItem,
  useDeleteLongLeadItem,
  useLongLeadItems,
  useUpdateLongLeadItem,
} from '../hooks/use-long-lead'

type Props = {
  projectId: string
  activities: ScheduleActivity[]
  /** A package or delivery deep link: the items bought under it are selected. */
  initialTarget?: ProjectSetupTarget
}

type FormState = {
  item: string
  leadWeeks: number
  requiredTiming: 'activity_start' | 'activity_finish'
  needOffsetDays: number
  bufferDays: number
  orderBy: string
  expectedDeliveryDate: string
  criticality: string
  risk: string
  supplier: string
  status: 'not_ordered' | 'ordered' | 'delivered'
  warehouseStatus: 'not_received' | 'partial' | 'received' | 'issued'
  activityId: string
}

type RiskSeverity = NonNullable<
  LongLeadItemRecord['procurementRisk']
>['severity']

const defaultForm: FormState = {
  item: '',
  leadWeeks: 0,
  requiredTiming: 'activity_start',
  needOffsetDays: 0,
  bufferDays: 14,
  orderBy: '',
  expectedDeliveryDate: '',
  criticality: '',
  risk: '',
  supplier: '',
  status: 'not_ordered',
  warehouseStatus: 'not_received',
  activityId: '',
}

const severityRank: Record<RiskSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

const severityClassMap: Record<RiskSeverity, string> = {
  none: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300',
  low: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-300',
  medium:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300',
  high: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900/40 dark:bg-orange-950/20 dark:text-orange-300',
  critical:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300',
}

const rowRiskClassMap: Partial<Record<RiskSeverity, string>> = {
  medium: 'bg-amber-50/60 dark:bg-amber-950/15',
  high: 'bg-orange-50/70 dark:bg-orange-950/20',
  critical: 'bg-red-50/70 dark:bg-red-950/20',
}

const statusLabels: Record<FormState['status'], string> = {
  not_ordered: 'Not Ordered',
  ordered: 'Ordered',
  delivered: 'Delivered',
}

const warehouseLabels: Record<FormState['warehouseStatus'], string> = {
  not_received: 'Not Received',
  partial: 'Partial',
  received: 'Received',
  issued: 'Issued',
}

const formatDate = (value: string | null | undefined) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

const toDateInput = (value: string | null | undefined) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const riskLabel = (reason: string | undefined) =>
  reason ? reason.replace(/_/g, ' ') : 'on track'

const mutationErrorMessage = (error: unknown, fallback: string) =>
  (error as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? fallback

export function LongLeadTable({ projectId, activities, initialTarget }: Props) {
  const targetPackageId =
    initialTarget?.source === 'procurement_package' ||
    initialTarget?.source === 'delivery_receipt'
      ? (initialTarget.recordId ?? null)
      : null
  const targetItemId =
    initialTarget?.source === 'long_lead' ? (initialTarget.recordId ?? null) : null
  const isTargeted = (item: { id: string; procurementPackage?: { id: string } | null }) =>
    item.id === targetItemId || (Boolean(targetPackageId) && item.procurementPackage?.id === targetPackageId)
  const { data: items = [], isLoading } = useLongLeadItems(projectId)
  const createItem = useCreateLongLeadItem(projectId)
  const updateItem = useUpdateLongLeadItem(projectId)
  const deleteItem = useDeleteLongLeadItem(projectId)

  const [formOpen, setFormOpen] = useState(false)
  useEffect(() => {
    if (!targetPackageId && !targetItemId) return
    const first = document.querySelector('[data-testid^="uat-record-row-"][data-selected="true"]')
    first?.scrollIntoView({ block: 'center' })
  }, [targetPackageId, targetItemId, formOpen])
  const [editingItem, setEditingItem] = useState<LongLeadItemRecord | null>(
    null
  )
  const [form, setForm] = useState<FormState>(defaultForm)

  const atRiskItems = useMemo(
    () => items.filter((item) => item.procurementRisk?.isAtRisk),
    [items]
  )
  const topRiskItems = useMemo(
    () =>
      [...atRiskItems].sort((a, b) => {
        const aRisk = a.procurementRisk
        const bRisk = b.procurementRisk
        const severityDelta =
          severityRank[bRisk?.severity ?? 'none'] -
          severityRank[aRisk?.severity ?? 'none']
        if (severityDelta !== 0) return severityDelta
        return (bRisk?.daysAtRisk ?? 0) - (aRisk?.daysAtRisk ?? 0)
      }),
    [atRiskItems]
  )

  const setFormFromItem = (item: LongLeadItemRecord | null) => {
    if (!item) {
      setForm(defaultForm)
      return
    }
    setForm({
      item: item.item,
      leadWeeks: item.leadWeeks,
      requiredTiming: item.requiredTiming || 'activity_start',
      needOffsetDays: item.needOffsetDays || 0,
      bufferDays: item.bufferDays ?? 14,
      orderBy: item.orderBy || '',
      expectedDeliveryDate: toDateInput(item.expectedDeliveryDate),
      criticality: item.criticality || '',
      risk: item.risk || '',
      supplier: item.supplier || '',
      status: item.status,
      warehouseStatus: item.warehouseStatus || 'not_received',
      activityId: item.activityId || '',
    })
  }

  const toPayload = (): LongLeadPayload => ({
    item: form.item,
    leadWeeks: Number(form.leadWeeks) || 0,
    requiredTiming: form.requiredTiming,
    needOffsetDays: Number(form.needOffsetDays) || 0,
    bufferDays: Number(form.bufferDays) || 0,
    orderBy: form.orderBy,
    expectedDeliveryDate: form.expectedDeliveryDate || null,
    criticality: form.criticality,
    risk: form.risk,
    supplier: form.supplier,
    status: form.status,
    warehouseStatus: form.warehouseStatus,
    activityId: form.activityId || null,
  })

  if (isLoading) {
    return (
      <p className='py-8 text-center text-muted-foreground'>
        Loading long lead items...
      </p>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h3 className='text-sm font-semibold'>Long Lead Register</h3>
          {atRiskItems.length > 0 && (
            <p className='text-xs text-muted-foreground'>
              {atRiskItems.length} schedule-linked procurement alert
              {atRiskItems.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <Button
          size='sm'
          onClick={() => {
            setEditingItem(null)
            setForm(defaultForm)
            setFormOpen(true)
          }}
        >
          <Plus className='mr-1.5 h-4 w-4' />
          Add Item
        </Button>
      </div>

      {topRiskItems.length > 0 && (
        <div className='rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200'>
          <div className='flex items-start gap-2'>
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
            <div className='min-w-0 space-y-1'>
              {topRiskItems.slice(0, 3).map((item) => {
                const risk = item.procurementRisk
                return (
                  <p key={item.id} className='text-xs'>
                    <span className='font-semibold'>{item.item}</span>
                    {' - '}
                    {riskLabel(risk?.reason)}
                    {risk?.daysAtRisk
                      ? ` (${risk.daysAtRisk}d at risk)`
                      : ''}
                    {risk?.impactedActivity
                      ? ` - ${risk.impactedActivity.wbsCode ? `${risk.impactedActivity.wbsCode} ` : ''}${risk.impactedActivity.name}`
                      : ''}
                  </p>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm whitespace-nowrap'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>Item</th>
              <th className='p-2 text-left font-medium'>Need Date</th>
              <th className='p-2 text-right font-medium'>Lead + Buffer</th>
              <th className='p-2 text-left font-medium'>Order By</th>
              <th className='p-2 text-left font-medium'>Delivery</th>
              <th className='p-2 text-left font-medium'>Warehouse</th>
              <th className='p-2 text-left font-medium'>Activity</th>
              <th className='p-2 text-left font-medium'>Risk</th>
              <th className='p-2 text-left font-medium'>Supplier</th>
              <th className='p-2 text-left font-medium'>Procurement</th>
              <th className='p-2 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className='p-6 text-center text-muted-foreground'
                >
                  No long lead items available.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const risk = item.procurementRisk
                const severity = risk?.severity ?? 'none'
                const computedOrderBy = risk?.orderByDate || item.orderBy
                return (
                  <tr
                    key={item.id}
                    id={`uat-record-row-${item.id}`}
                    data-testid={`uat-record-row-${item.id}`}
                    data-selected={isTargeted(item) ? 'true' : 'false'}
                    className={cn(
                      'border-b hover:bg-muted/25',
                      rowRiskClassMap[severity],
                      isTargeted(item) && 'bg-primary/5 ring-1 ring-primary/40'
                    )}
                  >
                    <td className='max-w-64 p-2'>
                      <div className='flex min-w-0 items-center gap-1.5'>
                        {risk?.isAtRisk && (
                          <AlertTriangle className='h-3.5 w-3.5 shrink-0 text-amber-600' />
                        )}
                        <div className='min-w-0'>
                          <p className='truncate font-medium'>{item.item}</p>
                          {item.criticality && (
                            <p className='text-xs text-muted-foreground'>
                              {item.criticality}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className='p-2'>
                      <p>{formatDate(risk?.needDate)}</p>
                      {risk?.needSlackDays !== null &&
                        risk?.needSlackDays !== undefined && (
                          <p className='text-xs text-muted-foreground'>
                            {risk.needSlackDays >= 0
                              ? `${risk.needSlackDays}d left`
                              : `${Math.abs(risk.needSlackDays)}d late`}
                          </p>
                        )}
                    </td>
                    <td className='p-2 text-right font-mono text-xs'>
                      {item.leadWeeks}w + {item.bufferDays ?? 14}d
                    </td>
                    <td className='p-2'>
                      <p>{formatDate(computedOrderBy)}</p>
                      {risk?.orderBySlackDays !== null &&
                        risk?.orderBySlackDays !== undefined && (
                          <p
                            className={cn(
                              'text-xs',
                              risk.orderBySlackDays < 0
                                ? 'font-semibold text-red-600'
                                : 'text-muted-foreground'
                            )}
                          >
                            {risk.orderBySlackDays >= 0
                              ? `${risk.orderBySlackDays}d left`
                              : `${Math.abs(risk.orderBySlackDays)}d late`}
                          </p>
                        )}
                    </td>
                    <td className='p-2'>
                      <select
                        className='h-8 rounded-md border bg-background px-2 text-xs'
                        value={item.status}
                        onChange={async (e) => {
                          try {
                            await updateItem.mutateAsync({
                              itemId: item.id,
                              payload: {
                                status: e.target
                                  .value as LongLeadPayload['status'],
                              },
                            })
                            toast.success('Delivery status updated')
                          } catch (error) {
                            toast.error(
                              mutationErrorMessage(
                                error,
                                'Failed to update status'
                              )
                            )
                          }
                        }}
                      >
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        ETA {formatDate(risk?.expectedDeliveryDate)}
                      </p>
                    </td>
                    <td className='p-2'>
                      <select
                        className='h-8 rounded-md border bg-background px-2 text-xs'
                        value={item.warehouseStatus}
                        onChange={async (e) => {
                          try {
                            await updateItem.mutateAsync({
                              itemId: item.id,
                              payload: {
                                warehouseStatus: e.target
                                  .value as LongLeadPayload['warehouseStatus'],
                              },
                            })
                            toast.success('Warehouse status updated')
                          } catch (error) {
                            toast.error(
                              mutationErrorMessage(
                                error,
                                'Failed to update warehouse status'
                              )
                            )
                          }
                        }}
                      >
                        {Object.entries(warehouseLabels).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          )
                        )}
                      </select>
                    </td>
                    <td className='max-w-72 p-2'>
                      {item.activity ? (
                        <button
                          className='max-w-64 truncate rounded-full border px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-50 dark:text-blue-300'
                          onClick={() => {
                            const encoded = encodeURIComponent(
                              item.activity?.id || ''
                            )
                            window.location.hash = `activity-${encoded}`
                          }}
                        >
                          {item.activity.wbsCode
                            ? `${item.activity.wbsCode} - `
                            : ''}
                          {item.activity.name}
                        </button>
                      ) : (
                        <span className='text-muted-foreground'>-</span>
                      )}
                    </td>
                    <td className='max-w-56 p-2'>
                      <Badge className={severityClassMap[severity]}>
                        {severity}
                      </Badge>
                      <p
                        className='mt-1 truncate text-xs text-muted-foreground'
                        title={item.risk || riskLabel(risk?.reason)}
                      >
                        {riskLabel(risk?.reason)}
                      </p>
                    </td>
                    <td className='p-2 text-muted-foreground'>
                      {item.supplier || '-'}
                    </td>
                    <td className='p-2'>
                      {/* Whether this is being bought under a package, and so
                          whether the dates beside it are the planner's own or
                          read from procurement. An unlinked item is still
                          theirs to maintain; a linked one is not, and the
                          system will refuse an edit rather than let the two
                          drift apart (OCTA-PROC-LONGLEAD-UI-091). */}
                      {item.procurementPackage ? (
                        <div
                          className='min-w-0'
                          data-testid={`uat-long-lead-package-${item.id}`}
                        >
                          <p className='truncate font-mono text-xs font-medium'>
                            {item.procurementPackage.packageNumber}
                          </p>
                          <p className='text-muted-foreground text-xs'>
                            {item.procurementPackage.orderCount === 0
                              ? 'not ordered yet'
                              : `${item.procurementPackage.orderCount} order${item.procurementPackage.orderCount === 1 ? '' : 's'}`}
                            {item.procurementPackage.receiptCount > 0 &&
                              ` · ${item.procurementPackage.receiptCount} delivered`}
                          </p>
                        </div>
                      ) : (
                        <p
                          className='text-muted-foreground text-xs'
                          data-testid={`uat-long-lead-unlinked-${item.id}`}
                        >
                          Tracked by hand
                        </p>
                      )}
                    </td>
                    <td className='p-2 text-right'>
                      <div className='flex justify-end gap-1'>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => {
                            setEditingItem(item)
                            setFormFromItem(item)
                            setFormOpen(true)
                          }}
                        >
                          <Pencil className='mr-1.5 h-3.5 w-3.5' />
                          Edit
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='text-red-600 hover:text-red-700'
                          onClick={async () => {
                            const confirmed = window.confirm(
                              'Delete this long lead item?'
                            )
                            if (!confirmed) return

                            try {
                              await deleteItem.mutateAsync(item.id)
                              toast.success('Item deleted')
                            } catch (error) {
                              toast.error(
                                mutationErrorMessage(
                                  error,
                                  'Failed to delete item'
                                )
                              )
                            }
                          }}
                        >
                          <Trash2 className='mr-1.5 h-3.5 w-3.5' />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {editingItem ? 'Edit Long Lead Item' : 'Add Long Lead Item'}
            </DialogTitle>
            <DialogDescription>
              Link procurement-critical items to schedule activities and track
              delivery status.
            </DialogDescription>
          </DialogHeader>

          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-item'>Item</Label>
              <Input
                id='ll-item'
                value={form.item}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, item: e.target.value }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-activity'>Linked Activity</Label>
              <select
                id='ll-activity'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.activityId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, activityId: e.target.value }))
                }
              >
                <option value=''>None</option>
                {activities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                    {activity.name}
                  </option>
                ))}
              </select>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-lead-weeks'>Lead Weeks</Label>
              <Input
                id='ll-lead-weeks'
                type='number'
                min={0}
                value={form.leadWeeks}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    leadWeeks: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-buffer-days'>Order Buffer Days</Label>
              <Input
                id='ll-buffer-days'
                type='number'
                min={0}
                value={form.bufferDays}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    bufferDays: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-required-timing'>Need Basis</Label>
              <select
                id='ll-required-timing'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.requiredTiming}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    requiredTiming: e.target
                      .value as FormState['requiredTiming'],
                  }))
                }
              >
                <option value='activity_start'>Activity Start</option>
                <option value='activity_finish'>Activity Finish</option>
              </select>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-need-offset'>Need Offset Days</Label>
              <Input
                id='ll-need-offset'
                type='number'
                min={0}
                value={form.needOffsetDays}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    needOffsetDays: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-expected-delivery'>Expected Delivery</Label>
              <Input
                id='ll-expected-delivery'
                type='date'
                value={form.expectedDeliveryDate}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    expectedDeliveryDate: e.target.value,
                  }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-order-by'>Order Note</Label>
              <Input
                id='ll-order-by'
                value={form.orderBy}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, orderBy: e.target.value }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-criticality'>Criticality</Label>
              <Input
                id='ll-criticality'
                value={form.criticality}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, criticality: e.target.value }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-supplier'>Supplier</Label>
              <Input
                id='ll-supplier'
                value={form.supplier}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, supplier: e.target.value }))
                }
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-status'>Delivery Status</Label>
              <select
                id='ll-status'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.status}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    status: e.target.value as FormState['status'],
                  }))
                }
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='ll-warehouse-status'>Warehouse Receipt</Label>
              <select
                id='ll-warehouse-status'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.warehouseStatus}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    warehouseStatus: e.target
                      .value as FormState['warehouseStatus'],
                  }))
                }
              >
                {Object.entries(warehouseLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className='grid gap-1.5 sm:col-span-2'>
              <Label htmlFor='ll-risk'>Risk Note</Label>
              <Input
                id='ll-risk'
                value={form.risk}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, risk: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                createItem.isPending ||
                updateItem.isPending ||
                !form.item.trim()
              }
              onClick={async () => {
                try {
                  if (editingItem) {
                    await updateItem.mutateAsync({
                      itemId: editingItem.id,
                      payload: toPayload(),
                    })
                    toast.success('Long lead item updated')
                  } else {
                    await createItem.mutateAsync(toPayload())
                    toast.success('Long lead item added')
                  }

                  setFormOpen(false)
                  setEditingItem(null)
                } catch (error) {
                  toast.error(
                    mutationErrorMessage(error, 'Failed to save long lead item')
                  )
                }
              }}
            >
              {editingItem ? 'Save Changes' : 'Add Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
