import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  type ChangeOrderRecord,
  useChangeOrders,
  useCreateChangeOrder,
  useDeleteChangeOrder,
  useUpdateChangeOrder,
} from '../hooks/use-commercial'
import { ChangeOrderForm } from './change-order-form'

const fmtUSD = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

function CoBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${map[status] ?? map.pending}`}
    >
      {status}
    </span>
  )
}

export function ChangeOrderRegister({
  projectId,
  activities,
}: {
  projectId: string
  activities: ScheduleActivity[]
}) {
  const { data, isLoading } = useChangeOrders(projectId)
  const createChangeOrder = useCreateChangeOrder(projectId)
  const updateChangeOrder = useUpdateChangeOrder(projectId)
  const deleteChangeOrder = useDeleteChangeOrder(projectId)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ChangeOrderRecord | null>(null)

  if (isLoading) {
    return (
      <p className='py-8 text-center text-muted-foreground'>
        Loading change orders…
      </p>
    )
  }

  const orders = data?.orders || []
  const summary = data?.summary || {
    totalApproved: 0,
    totalPending: 0,
    totalScheduleImpact: 0,
    approvedCount: 0,
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Approved VOs</p>
          <p className='text-xl font-bold text-green-600'>
            {fmtUSD(summary.totalApproved)}
          </p>
          <p className='text-xs text-muted-foreground'>
            {summary.approvedCount} orders
          </p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Pending VOs</p>
          <p className='text-xl font-bold text-amber-600'>
            {fmtUSD(summary.totalPending)}
          </p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-xs text-muted-foreground'>Schedule Impact</p>
          <p className='text-xl font-bold text-red-600'>
            +{summary.totalScheduleImpact}d
          </p>
        </div>
      </div>

      <div className='flex justify-end'>
        <Button
          size='sm'
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          Add Change Order
        </Button>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm whitespace-nowrap'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left font-medium'>Ref</th>
              <th className='p-2 text-left font-medium'>Description</th>
              <th className='p-2 text-left font-medium'>Category</th>
              <th className='p-2 text-right font-medium'>Value</th>
              <th className='p-2 text-center font-medium'>Status</th>
              <th className='p-2 text-right font-medium'>Schedule Impact</th>
              <th className='p-2 text-left font-medium'>Submitted</th>
              <th className='p-2 text-left font-medium'>Approved</th>
              <th className='p-2 text-left font-medium'>Raised By</th>
              <th className='p-2 text-right font-medium'>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className='p-6 text-center text-muted-foreground'
                >
                  No change orders available.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className='border-b hover:bg-muted/30'>
                  <td className='p-2 font-mono text-xs font-semibold text-blue-600'>
                    {order.ref}
                  </td>
                  <td
                    className='max-w-72 truncate p-2'
                    title={order.description}
                  >
                    {order.description}
                  </td>
                  <td className='p-2 text-muted-foreground'>
                    {order.category || '—'}
                  </td>
                  <td className='p-2 text-right font-medium'>
                    {fmtUSD(order.value)}
                  </td>
                  <td className='p-2 text-center'>
                    <CoBadge status={order.status} />
                    {order.status === 'rejected' && order.rejectedReason && (
                      <p
                        className='mt-1 max-w-36 truncate text-xs text-red-600'
                        title={order.rejectedReason}
                      >
                        {order.rejectedReason}
                      </p>
                    )}
                  </td>
                  <td className='p-2 text-right'>{order.scheduleImpact}d</td>
                  <td className='p-2 text-xs text-muted-foreground'>
                    {order.submittedDate
                      ? new Date(order.submittedDate).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className='p-2 text-xs text-muted-foreground'>
                    {order.approvedDate
                      ? new Date(order.approvedDate).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className='p-2 text-muted-foreground'>
                    {order.raisedBy || '—'}
                  </td>
                  <td className='p-2 text-right'>
                    <div className='flex justify-end gap-1'>
                      {order.status === 'pending' && (
                        <>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='text-green-600 hover:text-green-700'
                            onClick={async () => {
                              try {
                                await updateChangeOrder.mutateAsync({
                                  changeOrderId: order.id,
                                  payload: { status: 'approved' },
                                })
                                toast.success('Change order approved')
                              } catch {
                                toast.error('Failed to approve change order')
                              }
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='text-red-600 hover:text-red-700'
                            onClick={async () => {
                              const reason = window.prompt('Rejection reason:')
                              if (!reason || !reason.trim()) return

                              try {
                                await updateChangeOrder.mutateAsync({
                                  changeOrderId: order.id,
                                  payload: {
                                    status: 'rejected',
                                    rejectedReason: reason.trim(),
                                  },
                                })
                                toast.success('Change order rejected')
                              } catch {
                                toast.error('Failed to reject change order')
                              }
                            }}
                          >
                            Reject
                          </Button>
                        </>
                      )}

                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => {
                          setEditing(order)
                          setOpen(true)
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        className='text-red-600 hover:text-red-700'
                        onClick={async () => {
                          const confirmed = window.confirm(
                            'Delete this change order?'
                          )
                          if (!confirmed) return

                          try {
                            await deleteChangeOrder.mutateAsync(order.id)
                            toast.success('Change order deleted')
                          } catch {
                            toast.error('Failed to delete change order')
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ChangeOrderForm
        key={`${editing?.id ?? 'change-order-create'}-${open ? 'open' : 'closed'}`}
        open={open}
        onOpenChange={setOpen}
        activities={activities}
        initial={editing}
        isSaving={createChangeOrder.isPending || updateChangeOrder.isPending}
        onSubmit={async (payload) => {
          try {
            if (editing) {
              await updateChangeOrder.mutateAsync({
                changeOrderId: editing.id,
                payload,
              })
              toast.success('Change order updated')
            } else {
              await createChangeOrder.mutateAsync(payload)
              toast.success('Change order created')
            }

            setOpen(false)
            setEditing(null)
          } catch {
            toast.error('Failed to save change order')
          }
        }}
      />
    </div>
  )
}
