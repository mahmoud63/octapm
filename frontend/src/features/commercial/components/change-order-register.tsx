import { useEffect, useState } from 'react'
import { CheckCircle2, History, RotateCcw, Send, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { handleServerError } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import {
  AuditHistoryPanel,
  HistoryPanel,
} from '@/features/audit/components/audit-history-panel'
import { CustomFieldsPanel } from '@/features/custom-fields/components/custom-fields-panel'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  WorkflowDecisionDialog,
  type WorkflowDecisionMode,
} from '@/features/workflows/components/workflow-decision-dialog'
import { WorkflowInstancePanel } from '@/features/workflows/components/workflow-instance-panel'
import {
  type ChangeOrderRecord,
  useApproveChangeOrder,
  useChangeOrders,
  useCreateChangeOrder,
  useArchiveChangeOrder,
  useReopenChangeOrder,
  useRejectChangeOrder,
  useSubmitChangeOrder,
  useUpdateChangeOrder,
} from '../hooks/use-commercial'
import { ChangeOrderForm } from './change-order-form'

const fmtUSD = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

const traceSummary = (order: ChangeOrderRecord) => {
  const activityCount =
    order.activityLinks?.length || (order.activityId || order.activity ? 1 : 0)
  const allocationCount = order.allocationLinks?.length || 0
  const evidenceCount =
    (order.correspondenceLinks?.length || 0) +
    (order.attachmentRefs?.length || 0)
  const historyCount = order.approvalHistory?.length || 0
  const criticalPathImpactDays =
    order.activityLinks?.reduce(
      (sum, link) => sum + (Number(link.criticalPathImpactDays) || 0),
      0
    ) || 0
  const costImpact =
    order.activityLinks?.reduce(
      (sum, link) => sum + (Number(link.costImpact) || 0),
      0
    ) || 0
  return {
    activityCount,
    allocationCount,
    evidenceCount,
    historyCount,
    criticalPathImpactDays,
    costImpact,
  }
}

const approvalReady = (order: ChangeOrderRecord) => {
  const trace = traceSummary(order)
  return (
    trace.activityCount > 0 &&
    trace.evidenceCount > 0 &&
    Boolean(order.scheduleImpactSummary?.trim()) &&
    Boolean(order.costImpactSummary?.trim())
  )
}

function CoBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-800',
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    archived: 'bg-zinc-100 text-zinc-800',
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${map[status] ?? map.pending}`}
    >
      {status}
    </span>
  )
}

type ChangeOrderDecisionTarget = {
  mode: WorkflowDecisionMode
  id: string
  label: string
}

export function ChangeOrderRegister({
  projectId,
  activities,
  initialStatus,
  initialRecordId,
  initialNew = false,
}: {
  projectId: string
  activities: ScheduleActivity[]
  initialStatus?: string
  initialRecordId?: string
  /** Arrive with the create form open (Phase 22A quick actions). */
  initialNew?: boolean
}) {
  const { data, isLoading } = useChangeOrders(projectId)
  const createChangeOrder = useCreateChangeOrder(projectId)
  const updateChangeOrder = useUpdateChangeOrder(projectId)
  const submitChangeOrder = useSubmitChangeOrder(projectId)
  const approveChangeOrder = useApproveChangeOrder(projectId)
  const rejectChangeOrder = useRejectChangeOrder(projectId)
  const reopenChangeOrder = useReopenChangeOrder(projectId)
  const archiveChangeOrder = useArchiveChangeOrder(projectId)
  const canSubmitChangeOrder = useCanPerform(
    'change_order',
    'submit',
    'change_order.submit'
  )
  const canApproveChangeOrder = useCanPerform(
    'change_order',
    'approve',
    'change_order.approve'
  )
  const canRejectChangeOrder = useCanPerform(
    'change_order',
    'approve',
    'change_order.reject'
  )
  const canReopenChangeOrder = useCanPerform(
    'change_order',
    'submit',
    'change_order.reopen'
  )

  const [open, setOpen] = useState(initialNew)
  const [editing, setEditing] = useState<ChangeOrderRecord | null>(null)
  // A quick action can land here while the register is already mounted, so
  // a fresh "new" request opens the blank form again (adjusting state during
  // render, as React documents for values derived from a prop change).
  const [seenNew, setSeenNew] = useState(initialNew)
  if (initialNew !== seenNew) {
    setSeenNew(initialNew)
    if (initialNew) {
      setEditing(null)
      setOpen(true)
    }
  }
  const [decisionTarget, setDecisionTarget] =
    useState<ChangeOrderDecisionTarget | null>(null)
  // A deep link's order is the one whose history and detail open first.
  const [historyOrderId, setHistoryOrderId] = useState<string | null>(
    initialRecordId ?? null
  )
  useEffect(() => {
    if (!initialRecordId) return
    document
      .getElementById(`uat-record-row-${initialRecordId}`)
      ?.scrollIntoView({ block: 'center' })
  }, [initialRecordId])
  const [statusFilter, setStatusFilter] = useState<
    ChangeOrderRecord['status'] | 'all'
  >(
    ['draft', 'pending', 'approved', 'rejected'].includes(initialStatus || '')
      ? (initialStatus as ChangeOrderRecord['status'])
      : 'all'
  )
  const decisionPending =
    approveChangeOrder.isPending || rejectChangeOrder.isPending
  const workflowPending =
    submitChangeOrder.isPending ||
    approveChangeOrder.isPending ||
    rejectChangeOrder.isPending ||
    reopenChangeOrder.isPending

  const handleDecision = async (note: string) => {
    if (!decisionTarget) return

    try {
      if (decisionTarget.mode === 'approve') {
        await approveChangeOrder.mutateAsync({
          changeOrderId: decisionTarget.id,
          comment: note,
        })
        toast.success('Change order approved')
      } else {
        await rejectChangeOrder.mutateAsync({
          changeOrderId: decisionTarget.id,
          reason: note,
        })
        toast.success('Change order disapproved')
      }
    } catch (error) {
      handleServerError(error)
    }
  }

  const handleSubmitForApproval = async (order: ChangeOrderRecord) => {
    try {
      await submitChangeOrder.mutateAsync({
        changeOrderId: order.id,
      })
      toast.success('Change order submitted')
    } catch (error) {
      handleServerError(error)
    }
  }

  const handleReopen = async (order: ChangeOrderRecord) => {
    try {
      await reopenChangeOrder.mutateAsync({
        changeOrderId: order.id,
      })
      toast.success('Change order reopened')
    } catch (error) {
      handleServerError(error)
    }
  }

  if (isLoading) {
    return (
      <p className='py-8 text-center text-muted-foreground'>
        Loading change orders...
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
  const approvalQueue = orders.filter((order) => order.status === 'pending')
  const filteredOrders = orders.filter((order) => {
    if (initialRecordId) return order.id === initialRecordId
    if (statusFilter === 'all') return true
    return order.status === statusFilter
  })
  const selectedHistoryOrder =
    orders.find((order) => order.id === historyOrderId) || orders[0] || null

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

      <AuditHistoryPanel
        projectId={projectId}
        entityType='change_order'
        title='Change Order Status History'
        limit={10}
      />

      {approvalQueue.length > 0 && (
        <div className='rounded-md border'>
          <div className='flex items-center justify-between border-b bg-muted/40 px-3 py-2'>
            <p className='text-sm font-semibold'>PM Approval Panel</p>
            <span className='text-xs text-muted-foreground'>
              {approvalQueue.length} pending
            </span>
          </div>
          <div className='divide-y'>
            {approvalQueue.map((order) => {
              const trace = traceSummary(order)
              const ready = approvalReady(order)
              return (
                <div
                  key={`approval-${order.id}`}
                  className='grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_220px]'
                >
                  <div className='min-w-0 space-y-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-mono text-xs font-semibold text-blue-600'>
                        {order.ref}
                      </span>
                      <CoBadge status={order.status} />
                      <span className='text-xs text-muted-foreground'>
                        {fmtUSD(order.value)} | +{order.scheduleImpact}d
                      </span>
                    </div>
                    <p className='truncate text-sm font-medium'>
                      {order.description}
                    </p>
                    <div className='grid gap-1 text-xs text-muted-foreground sm:grid-cols-2'>
                      <p
                        className='truncate'
                        title={order.scheduleImpactSummary || ''}
                      >
                        Schedule: {order.scheduleImpactSummary || 'Missing'}
                      </p>
                      <p
                        className='truncate'
                        title={order.costImpactSummary || ''}
                      >
                        Cost: {order.costImpactSummary || 'Missing'}
                      </p>
                    </div>
                    <p className='text-xs text-muted-foreground'>
                      {trace.activityCount} activities | {trace.allocationCount}{' '}
                      allocations | {trace.evidenceCount} docs | CP{' '}
                      {trace.criticalPathImpactDays}d
                    </p>
                  </div>
                  <div className='flex items-center justify-start gap-2 lg:justify-end'>
                    {ready && canApproveChangeOrder ? (
                      <Button
                        size='sm'
                        variant='ghost'
                        className='text-green-600 hover:text-green-700'
                        disabled={workflowPending}
                        onClick={() =>
                          setDecisionTarget({
                            mode: 'approve',
                            id: order.id,
                            label: order.ref,
                          })
                        }
                      >
                        <CheckCircle2 className='mr-2 h-4 w-4' />
                        Approve
                      </Button>
                    ) : ready ? (
                      <span className='text-xs text-muted-foreground'>
                        Awaiting PM
                      </span>
                    ) : (
                      <span className='text-xs text-amber-600'>
                        Needs proof
                      </span>
                    )}
                    {canRejectChangeOrder && (
                      <Button
                        size='sm'
                        variant='ghost'
                        className='text-red-600 hover:text-red-700'
                        disabled={workflowPending}
                        onClick={() =>
                          setDecisionTarget({
                            mode: 'reject',
                            id: order.id,
                            label: order.ref,
                          })
                        }
                      >
                        <XCircle className='mr-2 h-4 w-4' />
                        Disapprove
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {(initialRecordId || statusFilter !== 'all') && (
        <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm'>
          <span className='text-muted-foreground'>
            Showing{' '}
            {initialRecordId
              ? 'the selected dashboard record'
              : `${statusFilter} change orders`}
          </span>
          {!initialRecordId && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() => setStatusFilter('all')}
            >
              Clear
            </Button>
          )}
        </div>
      )}

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
              <th className='p-2 text-left font-medium'>Trace</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className='p-6 text-center text-muted-foreground'
                >
                  No change orders match the current dashboard filter.
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => (
                <tr
                  key={order.id}
                  id={`uat-record-row-${order.id}`}
                  data-testid={`uat-record-row-${order.id}`}
                  data-selected={
                    selectedHistoryOrder?.id === order.id ? 'true' : 'false'
                  }
                  className='border-b hover:bg-muted/30'
                >
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
                    {order.category || '-'}
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
                      : '-'}
                  </td>
                  <td className='p-2 text-xs text-muted-foreground'>
                    {order.approvedDate
                      ? new Date(order.approvedDate).toLocaleDateString()
                      : '-'}
                  </td>
                  <td className='p-2 text-muted-foreground'>
                    {order.raisedBy || '-'}
                  </td>
                  <td className='p-2 text-right'>
                    <div className='flex justify-end gap-1'>
                      {order.status === 'draft' && (
                        <>
                          {approvalReady(order) && canSubmitChangeOrder ? (
                            <Button
                              size='sm'
                              variant='ghost'
                              className='text-blue-600 hover:text-blue-700'
                              disabled={workflowPending}
                              onClick={() => handleSubmitForApproval(order)}
                            >
                              <Send className='mr-2 h-4 w-4' />
                              Submit
                            </Button>
                          ) : !approvalReady(order) ? (
                            <span className='self-center px-2 text-xs text-amber-600'>
                              Needs proof
                            </span>
                          ) : null}
                        </>
                      )}
                      {order.status === 'pending' && (
                        <>
                          {approvalReady(order) && canApproveChangeOrder ? (
                            <Button
                              size='sm'
                              variant='ghost'
                              className='text-green-600 hover:text-green-700'
                              disabled={workflowPending}
                              onClick={() =>
                                setDecisionTarget({
                                  mode: 'approve',
                                  id: order.id,
                                  label: order.ref,
                                })
                              }
                            >
                              <CheckCircle2 className='mr-2 h-4 w-4' />
                              Approve
                            </Button>
                          ) : !approvalReady(order) ? (
                            <span className='self-center px-2 text-xs text-amber-600'>
                              Needs proof
                            </span>
                          ) : null}
                          {canRejectChangeOrder && (
                            <Button
                              size='sm'
                              variant='ghost'
                              className='text-red-600 hover:text-red-700'
                              disabled={workflowPending}
                              onClick={() =>
                                setDecisionTarget({
                                  mode: 'reject',
                                  id: order.id,
                                  label: order.ref,
                                })
                              }
                            >
                              <XCircle className='mr-2 h-4 w-4' />
                              Disapprove
                            </Button>
                          )}
                        </>
                      )}

                      {order.status === 'rejected' && canReopenChangeOrder && (
                        <Button
                          size='sm'
                          variant='ghost'
                          className='text-blue-600 hover:text-blue-700'
                          disabled={workflowPending}
                          onClick={() => handleReopen(order)}
                        >
                          <RotateCcw className='mr-2 h-4 w-4' />
                          Reopen
                        </Button>
                      )}

                      {order.status !== 'approved' ? (
                        <>
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
                                'Archive this change order?'
                              )
                              if (!confirmed) return

                              try {
                                await archiveChangeOrder.mutateAsync(order.id)
                                toast.success('Change order archived')
                              } catch {
                                toast.error('Failed to archive change order')
                              }
                            }}
                          >
                            Archive
                          </Button>
                        </>
                      ) : (
                        <span className='self-center px-2 text-xs text-muted-foreground'>
                          Locked
                        </span>
                      )}
                      <Button
                        size='sm'
                        variant={
                          selectedHistoryOrder?.id === order.id
                            ? 'secondary'
                            : 'ghost'
                        }
                        onClick={() => setHistoryOrderId(order.id)}
                      >
                        <History className='mr-2 h-4 w-4' />
                        History
                      </Button>
                    </div>
                  </td>
                  <td className='p-2 text-xs'>
                    <div className='flex flex-col gap-1'>
                      <span className='max-w-44 truncate font-medium'>
                        {order.activityLinks?.[0]?.activity?.name ||
                          order.activity?.name ||
                          'No activity'}
                      </span>
                      {order.activityLinks?.slice(0, 2).map((link) => (
                        <span
                          key={link.id || link.activityId}
                          className='max-w-56 truncate text-muted-foreground'
                          title={link.activity?.name || link.activityId}
                        >
                          Activity: {link.activity?.wbsCode || link.activityId}{' '}
                          {link.scheduleImpactDays ?? 0}d /{' '}
                          {fmtUSD(link.costImpact || 0)}
                        </span>
                      ))}
                      {order.allocationLinks?.slice(0, 2).map((link) => (
                        <span
                          key={link.id || link.allocationId || link.boqItemId}
                          className='max-w-56 truncate text-muted-foreground'
                          title={
                            link.boqItem?.description ||
                            link.allocation?.boqItem?.description ||
                            ''
                          }
                        >
                          BOQ:{' '}
                          {link.boqItem?.code ||
                            link.allocation?.boqItem?.code ||
                            link.boqItemId ||
                            'Uncoded'}{' '}
                          / {fmtUSD(link.amount || 0)}
                        </span>
                      ))}
                      <span className='text-muted-foreground'>
                        {traceSummary(order).activityCount} act |{' '}
                        {traceSummary(order).allocationCount} alloc |{' '}
                        {traceSummary(order).evidenceCount} docs |{' '}
                        {traceSummary(order).historyCount} events
                      </span>
                      <span className='text-muted-foreground'>
                        CP {traceSummary(order).criticalPathImpactDays}d |{' '}
                        {fmtUSD(traceSummary(order).costImpact)} impact
                      </span>
                      <span
                        className={
                          approvalReady(order)
                            ? 'text-green-600'
                            : 'text-amber-600'
                        }
                      >
                        {approvalReady(order)
                          ? 'Approval ready'
                          : 'Needs proof'}
                      </span>
                      <span
                        className='max-w-56 truncate text-muted-foreground'
                        title={order.scheduleImpactSummary || ''}
                      >
                        Schedule: {order.scheduleImpactSummary || 'Missing'}
                      </span>
                      <span
                        className='max-w-56 truncate text-muted-foreground'
                        title={order.costImpactSummary || ''}
                      >
                        Cost: {order.costImpactSummary || 'Missing'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedHistoryOrder && (
        <>
          <WorkflowInstancePanel
            projectId={projectId}
            tool='change_order'
            recordId={selectedHistoryOrder.id}
            className='rounded-md border p-3'
          />
          <CustomFieldsPanel
            projectId={projectId}
            recordType='change_order'
            recordId={selectedHistoryOrder.id}
            context={selectedHistoryOrder as unknown as Record<string, unknown>}
            className='rounded-md border p-3'
          />
          <HistoryPanel
            projectId={projectId}
            entityType='change_order'
            entityId={selectedHistoryOrder.id}
            title={`${selectedHistoryOrder.ref} History`}
            limit={30}
          />
        </>
      )}

      <ChangeOrderForm
        key={`${editing?.id ?? 'change-order-create'}-${open ? 'open' : 'closed'}`}
        projectId={projectId}
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
      <WorkflowDecisionDialog
        open={!!decisionTarget}
        onOpenChange={(open) => {
          if (!open) setDecisionTarget(null)
        }}
        mode={decisionTarget?.mode ?? 'approve'}
        title={`${decisionTarget?.mode === 'reject' ? 'Disapprove' : 'Approve'} ${decisionTarget?.label ?? 'change order'}`}
        description={
          decisionTarget?.mode === 'reject'
            ? 'A reason is required.'
            : 'Add an optional comment.'
        }
        isPending={decisionPending}
        onConfirm={handleDecision}
      />
    </div>
  )
}
