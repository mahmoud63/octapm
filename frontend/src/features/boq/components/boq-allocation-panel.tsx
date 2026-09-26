import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Check,
  CircleDollarSign,
  Grid3X3,
  History,
  Link2,
  Pencil,
  Send,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  hasMoneyPrecision,
  MONEY_INPUT_STEP,
  MONEY_PRECISION_MESSAGE,
  toMoneyNumber,
} from '@/lib/money'
import { useCanPerform } from '@/lib/permissions'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useActivities } from '@/features/activities/hooks/use-activities'
import { HistoryPanel } from '@/features/audit/components/audit-history-panel'
import type { BoqItemWithActivities } from '../data/schema'
import {
  useActivityBoqAllocations,
  useApproveActivityBoqAllocation,
  useCreateActivityBoqAllocation,
  useRejectActivityBoqAllocation,
  useSubmitActivityBoqAllocation,
  useUpdateActivityBoqAllocation,
} from '../hooks/use-boq'

type Props = {
  projectId: string
  items: BoqItemWithActivities[]
  currency: string
}

const fmtMoney = (currency: string, value: number) =>
  `${currency} ${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`

const fmtNumber = (value: number) =>
  Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })

const statusVariant: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  submitted: 'secondary',
  approved: 'default',
  rejected: 'destructive',
}

const statusLabel: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
}

type EditState = { id: string; quantity: string; amount: string }

/**
 * The allocation workflow on the BOQ page: create a draft, edit it inline,
 * submit, approve or reject with a reason. The matrix, coverage by structure
 * and the mapping-file import live under Project Controls › Mapping (PC-3).
 */
export function BoqAllocationPanel({ projectId, items, currency }: Props) {
  const { data: activities = [] } = useActivities(projectId)
  const { data, isLoading } = useActivityBoqAllocations(projectId)
  const createAllocation = useCreateActivityBoqAllocation(projectId)
  const updateAllocation = useUpdateActivityBoqAllocation(projectId)
  const submitAllocation = useSubmitActivityBoqAllocation(projectId)
  const approveAllocation = useApproveActivityBoqAllocation(projectId)
  const rejectAllocation = useRejectActivityBoqAllocation(projectId)
  const canCreateAllocation = useCanPerform(
    'boq',
    'create',
    'allocation.create'
  )
  const canUpdateAllocation = useCanPerform(
    'boq',
    'update',
    'allocation.update'
  )
  const canSubmitAllocation = useCanPerform(
    'boq',
    'submit',
    'allocation.submit'
  )
  const canApproveAllocation = useCanPerform(
    'boq',
    'approve',
    'allocation.approve'
  )
  const canRejectAllocation = useCanPerform(
    'boq',
    'approve',
    'allocation.reject'
  )

  const [boqItemId, setBoqItemId] = useState('')
  const [activityId, setActivityId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [historyAllocationId, setHistoryAllocationId] = useState<string | null>(
    null
  )
  const [editing, setEditing] = useState<EditState | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const selectedBoqItem = useMemo(
    () => items.find((item) => item.id === boqItemId) ?? null,
    [items, boqItemId]
  )

  const summary = data?.summary
  const allocations = data?.allocations ?? []
  const selectedHistoryAllocation =
    allocations.find((allocation) => allocation.id === historyAllocationId) ||
    allocations[0] ||
    null
  const hasActivities = activities.length > 0

  const resetForm = () => {
    setBoqItemId('')
    setActivityId('')
    setQuantity('')
    setAmount('')
    setNotes('')
  }

  const handleCreate = async () => {
    if (!boqItemId || !activityId || !quantity) return
    if (amount.trim() !== '' && !hasMoneyPrecision(amount)) {
      toast.error(MONEY_PRECISION_MESSAGE)
      return
    }

    const qty = Number(quantity)
    const resolvedAmount =
      amount.trim() !== ''
        ? toMoneyNumber(amount)
        : toMoneyNumber(qty * Number(selectedBoqItem?.rate || 0))

    await createAllocation.mutateAsync({
      boqItemId,
      activityId,
      quantity: qty,
      amount: resolvedAmount,
      source: 'manual',
      notes: notes.trim() || null,
    })
    resetForm()
  }

  // Inline edit of a draft: the figure that changed is what is sent, so the
  // service records it as the row's basis and derives the other from it.
  const saveEdit = async (current: { id: string; quantity: number; amount: number }) => {
    if (!editing || editing.id !== current.id) return
    const payload: { quantity?: number; amount?: number } = {}
    if (Number(editing.amount) !== current.amount) {
      if (!hasMoneyPrecision(editing.amount)) {
        toast.error(MONEY_PRECISION_MESSAGE)
        return
      }
      payload.amount = toMoneyNumber(editing.amount)
    } else if (Number(editing.quantity) !== current.quantity) {
      payload.quantity = Number(editing.quantity)
    }
    if (Object.keys(payload).length === 0) {
      setEditing(null)
      return
    }
    await updateAllocation.mutateAsync({ allocationId: current.id, data: payload })
    setEditing(null)
  }

  const submitReject = async () => {
    if (!rejectingId || !rejectReason.trim()) return
    await rejectAllocation.mutateAsync({
      allocationId: rejectingId,
      reason: rejectReason.trim(),
    })
    setRejectingId(null)
    setRejectReason('')
  }

  return (
    <div className='rounded-lg border bg-card'>
      <div className='flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-start lg:justify-between'>
        <div>
          <div className='flex items-center gap-2'>
            <Link2 className='h-4 w-4 text-primary' />
            <h3 className='text-base font-semibold'>
              BOQ Allocation Workflow
            </h3>
          </div>
          <Button asChild variant='link' size='sm' className='h-auto px-0 text-xs'>
            <Link
              to='/projects/$projectId/$module/$child'
              params={{ projectId, module: 'controls', child: 'mapping' }}
              data-testid='uat-boq-open-mapping'
            >
              <Grid3X3 className='h-3.5 w-3.5' />
              Open the mapping matrix
            </Link>
          </Button>
        </div>

        <div className='grid grid-cols-2 gap-2 text-right text-sm lg:grid-cols-5'>
          <div className='rounded-md border px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Allocated</p>
            <p className='font-semibold'>
              {fmtMoney(currency, summary?.activeAllocatedAmount ?? 0)}
            </p>
          </div>
          <div className='rounded-md border px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Approved EV/IPC</p>
            <p className='font-semibold'>
              {fmtMoney(currency, summary?.approvedAllocatedAmount ?? 0)}
            </p>
          </div>
          <div className='rounded-md border px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Pending</p>
            <p className='font-semibold'>
              {fmtMoney(currency, summary?.pendingAllocatedAmount ?? 0)}
            </p>
          </div>
          <div className='rounded-md border px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Unallocated</p>
            <p className='font-semibold text-amber-600'>
              {fmtMoney(currency, summary?.unallocatedAmount ?? 0)}
            </p>
          </div>
          <div className='rounded-md border px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Not applicable</p>
            <p className='font-semibold text-muted-foreground'>
              {fmtMoney(
                currency,
                (summary as { notApplicableAmount?: number } | undefined)
                  ?.notApplicableAmount ?? 0
              )}
            </p>
          </div>
        </div>
      </div>

      <div className='grid gap-3 border-b p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_120px_140px]'>
        <Select value={boqItemId} onValueChange={setBoqItemId}>
          <SelectTrigger>
            <SelectValue placeholder='BOQ item' />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.code} - {item.description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={activityId} onValueChange={setActivityId}>
          <SelectTrigger>
            <SelectValue placeholder='Schedule activity' />
          </SelectTrigger>
          <SelectContent>
            {activities.map((activity) => (
              <SelectItem key={activity.id} value={activity.id}>
                {activity.wbsCode || activity.id.slice(0, 8)} - {activity.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type='number'
          min='0'
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          placeholder='Qty'
        />

        <Input
          type='number'
          min='0'
          step={MONEY_INPUT_STEP}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder='Amount'
        />

        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder='Notes'
          className='min-h-9 lg:col-span-3'
        />

        <Button
          onClick={handleCreate}
          disabled={
            !boqItemId ||
            !activityId ||
            !quantity ||
            !hasActivities ||
            !canCreateAllocation ||
            createAllocation.isPending
          }
        >
          <CircleDollarSign className='h-4 w-4' />
          Create Draft
        </Button>
      </div>

      {!hasActivities ? (
        <div className='p-4 text-sm text-muted-foreground'>
          Create or import schedule activities before allocating BOQ value.
        </div>
      ) : isLoading ? (
        <div className='p-4 text-sm text-muted-foreground'>Loading...</div>
      ) : allocations.length === 0 ? (
        <div className='p-4 text-sm text-muted-foreground'>
          No BOQ value has been allocated to schedule activities yet.
        </div>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead className='border-b bg-muted/40 text-xs text-muted-foreground'>
              <tr>
                <th className='px-3 py-2 text-left font-medium'>BOQ</th>
                <th className='px-3 py-2 text-left font-medium'>Activity</th>
                <th className='px-3 py-2 text-right font-medium'>Qty</th>
                <th className='px-3 py-2 text-right font-medium'>Amount</th>
                <th className='px-3 py-2 text-right font-medium'>Weight</th>
                <th className='px-3 py-2 text-center font-medium'>Status</th>
                <th className='px-3 py-2 text-right font-medium'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((allocation) => {
                const isEditing = editing?.id === allocation.id
                return (
                  <tr key={allocation.id} className='border-b last:border-b-0'>
                    <td className='max-w-64 px-3 py-2'>
                      <div className='truncate font-medium'>
                        {allocation.boqItem?.code || 'BOQ'}
                      </div>
                      <div className='truncate text-xs text-muted-foreground'>
                        {allocation.boqItem?.description}
                      </div>
                    </td>
                    <td className='max-w-72 px-3 py-2'>
                      <div className='truncate font-medium'>
                        {allocation.activity?.activityId}
                      </div>
                      <div className='truncate text-xs text-muted-foreground'>
                        {allocation.activity?.name}
                      </div>
                    </td>
                    <td className='px-3 py-2 text-right'>
                      {isEditing ? (
                        <Input
                          type='number'
                          min='0'
                          step='0.001'
                          className='h-8 w-24 text-right'
                          value={editing.quantity}
                          onChange={(event) =>
                            setEditing({ ...editing, quantity: event.target.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveEdit(allocation)
                            if (event.key === 'Escape') setEditing(null)
                          }}
                          aria-label='Quantity'
                        />
                      ) : (
                        fmtNumber(allocation.quantity)
                      )}
                    </td>
                    <td className='px-3 py-2 text-right'>
                      {isEditing ? (
                        <Input
                          type='number'
                          min='0'
                          step={MONEY_INPUT_STEP}
                          className='h-8 w-28 text-right'
                          value={editing.amount}
                          onChange={(event) =>
                            setEditing({ ...editing, amount: event.target.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveEdit(allocation)
                            if (event.key === 'Escape') setEditing(null)
                          }}
                          aria-label='Amount'
                        />
                      ) : (
                        fmtMoney(currency, allocation.amount)
                      )}
                    </td>
                    <td className='px-3 py-2 text-right'>
                      {fmtNumber(allocation.weight)}%
                    </td>
                    <td className='px-3 py-2 text-center'>
                      <Badge variant={statusVariant[allocation.status]}>
                        {statusLabel[allocation.status] ?? allocation.status}
                      </Badge>
                    </td>
                    <td className='px-3 py-2'>
                      <div className='flex justify-end gap-1'>
                        {allocation.status === 'draft' && isEditing && (
                          <>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='size-8 text-green-600'
                              onClick={() => void saveEdit(allocation)}
                              disabled={updateAllocation.isPending}
                              title='Save'
                            >
                              <Check className='h-4 w-4' />
                            </Button>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='size-8'
                              onClick={() => setEditing(null)}
                              title='Cancel'
                            >
                              <X className='h-4 w-4' />
                            </Button>
                          </>
                        )}
                        {allocation.status === 'draft' && !isEditing && (
                          <>
                            {canUpdateAllocation && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='size-8'
                                onClick={() =>
                                  setEditing({
                                    id: allocation.id,
                                    quantity: String(allocation.quantity),
                                    amount: String(allocation.amount),
                                  })
                                }
                                title='Edit allocation'
                              >
                                <Pencil className='h-4 w-4' />
                              </Button>
                            )}
                            {canSubmitAllocation && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='size-8'
                                onClick={() =>
                                  submitAllocation.mutate(allocation.id)
                                }
                                title='Submit allocation'
                              >
                                <Send className='h-4 w-4' />
                              </Button>
                            )}
                          </>
                        )}
                        {allocation.status === 'submitted' && (
                          <>
                            {canApproveAllocation && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='size-8 text-green-600'
                                onClick={() =>
                                  approveAllocation.mutate(allocation.id)
                                }
                                title='Approve allocation'
                              >
                                <Check className='h-4 w-4' />
                              </Button>
                            )}
                            {canRejectAllocation && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='size-8 text-destructive'
                                onClick={() => setRejectingId(allocation.id)}
                                title='Reject allocation'
                              >
                                <X className='h-4 w-4' />
                              </Button>
                            )}
                          </>
                        )}
                        <Button
                          variant={
                            selectedHistoryAllocation?.id === allocation.id
                              ? 'secondary'
                              : 'ghost'
                          }
                          size='icon'
                          className='size-8'
                          onClick={() => setHistoryAllocationId(allocation.id)}
                          title='Allocation history'
                        >
                          <History className='h-4 w-4' />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {selectedHistoryAllocation && (
        <div className='border-t p-4'>
          <HistoryPanel
            projectId={projectId}
            entityType='activity_boq_allocation'
            entityId={selectedHistoryAllocation.id}
            title={`Allocation ${selectedHistoryAllocation.id.slice(0, 8)} History`}
            limit={30}
          />
        </div>
      )}

      <Dialog
        open={Boolean(rejectingId)}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingId(null)
            setRejectReason('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject allocation</DialogTitle>
            <DialogDescription>
              The row is retired and its value returns to the item's
              unallocated balance.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='boq-allocation-reject-reason'>Reason</Label>
            <Textarea
              id='boq-allocation-reject-reason'
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder='Why this allocation is wrong'
              className='min-h-20'
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRejectingId(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => void submitReject()}
              disabled={!rejectReason.trim() || rejectAllocation.isPending}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
