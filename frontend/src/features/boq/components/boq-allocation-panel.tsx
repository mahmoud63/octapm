import { useMemo, useState } from 'react'
import {
  Check,
  CircleDollarSign,
  Link2,
  Pencil,
  Send,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useActivities } from '@/features/activities/hooks/use-activities'
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

export function BoqAllocationPanel({ projectId, items, currency }: Props) {
  const { data: activities = [] } = useActivities(projectId)
  const { data, isLoading } = useActivityBoqAllocations(projectId)
  const createAllocation = useCreateActivityBoqAllocation(projectId)
  const updateAllocation = useUpdateActivityBoqAllocation(projectId)
  const submitAllocation = useSubmitActivityBoqAllocation(projectId)
  const approveAllocation = useApproveActivityBoqAllocation(projectId)
  const rejectAllocation = useRejectActivityBoqAllocation(projectId)

  const [boqItemId, setBoqItemId] = useState('')
  const [activityId, setActivityId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')

  const selectedBoqItem = useMemo(
    () => items.find((item) => item.id === boqItemId) ?? null,
    [items, boqItemId]
  )

  const summary = data?.summary
  const allocations = data?.allocations ?? []
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

    const qty = Number(quantity)
    const resolvedAmount =
      amount.trim() !== ''
        ? Number(amount)
        : qty * Number(selectedBoqItem?.rate || 0)

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

  const handleEdit = (allocationId: string, currentQty: number, currentAmount: number) => {
    const nextQty = window.prompt('Quantity', String(currentQty))
    if (nextQty === null) return

    const nextAmount = window.prompt('Amount', String(currentAmount))
    if (nextAmount === null) return

    updateAllocation.mutate({
      allocationId,
      data: {
        quantity: Number(nextQty),
        amount: Number(nextAmount),
      },
    })
  }

  const handleReject = (allocationId: string) => {
    const reason = window.prompt('Rejection reason')
    if (!reason?.trim()) return
    rejectAllocation.mutate({ allocationId, reason: reason.trim() })
  }

  return (
    <div className='rounded-lg border bg-card'>
      <div className='flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-start lg:justify-between'>
        <div>
          <div className='flex items-center gap-2'>
            <Link2 className='h-4 w-4 text-primary' />
            <h3 className='text-base font-semibold'>Activity BOQ Allocation</h3>
          </div>
        </div>

        <div className='grid grid-cols-3 gap-2 text-right text-sm'>
          <div className='rounded-md border px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Approved</p>
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
            createAllocation.isPending
          }
        >
          <CircleDollarSign className='h-4 w-4' />
          Allocate
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
              {allocations.map((allocation) => (
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
                    {fmtNumber(allocation.quantity)}
                  </td>
                  <td className='px-3 py-2 text-right'>
                    {fmtMoney(currency, allocation.amount)}
                  </td>
                  <td className='px-3 py-2 text-right'>
                    {fmtNumber(allocation.weight)}%
                  </td>
                  <td className='px-3 py-2 text-center'>
                    <Badge variant={statusVariant[allocation.status]}>
                      {allocation.status}
                    </Badge>
                  </td>
                  <td className='px-3 py-2'>
                    <div className='flex justify-end gap-1'>
                      {allocation.status === 'draft' && (
                        <>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='size-8'
                            onClick={() =>
                              handleEdit(
                                allocation.id,
                                allocation.quantity,
                                allocation.amount
                              )
                            }
                          >
                            <Pencil className='h-4 w-4' />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='size-8'
                            onClick={() =>
                              submitAllocation.mutate(allocation.id)
                            }
                          >
                            <Send className='h-4 w-4' />
                          </Button>
                        </>
                      )}
                      {(allocation.status === 'draft' ||
                        allocation.status === 'submitted') && (
                        <>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='size-8 text-green-600'
                            onClick={() =>
                              approveAllocation.mutate(allocation.id)
                            }
                          >
                            <Check className='h-4 w-4' />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='size-8 text-destructive'
                            onClick={() => handleReject(allocation.id)}
                          >
                            <X className='h-4 w-4' />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
