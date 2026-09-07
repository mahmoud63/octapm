import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/dates'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  LIFECYCLE_TONE,
  usePoTransition,
  usePurchaseOrder,
  type PoTransition,
  type PurchaseOrder,
} from '../hooks/use-purchase-orders'

/**
 * One purchase order: what was ordered, where it is, what has turned up, and
 * what has been billed.
 *
 * The actions offered are only the ones legal from where the order is, so a
 * buyer never has to guess why a button did nothing.
 */

const money = (value: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value || 0)

type Action = {
  key: PoTransition
  label: string
  /** Actions that change what the supplier sees ask for a reason first. */
  needsReason?: boolean
  variant?: 'default' | 'outline' | 'destructive'
}

/** What may be done from where the order actually is. */
const actionsFor = (order: PurchaseOrder): Action[] => {
  switch (order.status) {
    case 'planned':
    case 'draft':
      return [{ key: 'submit', label: 'Send for approval' }]
    case 'pending_approval':
      return [
        { key: 'approve', label: 'Approve' },
        { key: 'reject', label: 'Send back', needsReason: true, variant: 'outline' },
      ]
    case 'approved':
      return [{ key: 'issue', label: 'Issue to supplier' }]
    case 'issued':
      return [
        { key: 'acknowledge', label: 'Supplier acknowledged' },
        { key: 'close', label: 'Close', variant: 'outline' },
      ]
    case 'acknowledged':
      return [{ key: 'close', label: 'Close', variant: 'outline' }]
    default:
      return []
  }
}

const PERMISSION: Record<PoTransition, [string, string]> = {
  submit: ['submit', 'po.submit'],
  approve: ['approve', 'po.approve'],
  reject: ['approve', 'po.approve'],
  issue: ['update', 'po.issue'],
  acknowledge: ['update', 'po.acknowledge'],
  cancel: ['delete', 'po.cancel'],
  close: ['update', 'po.close'],
}

export function PurchaseOrderDialog({
  projectId,
  orderId,
  onClose,
}: {
  projectId: string
  orderId: string | null
  onClose: () => void
}) {
  const order = usePurchaseOrder(projectId, orderId)

  return (
    <Dialog open={Boolean(orderId)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-4xl'>
        {order.isPending && (
          <div className='flex justify-center py-16'>
            <Loader2 className='size-6 animate-spin text-muted-foreground' />
          </div>
        )}
        {order.data && (
          <OrderBody projectId={projectId} order={order.data} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function OrderBody({
  projectId,
  order,
  onClose,
}: {
  projectId: string
  order: PurchaseOrder
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [acknowledgedRef, setAcknowledgedRef] = useState('')
  const [pending, setPending] = useState<PoTransition | null>(null)
  const move = usePoTransition(projectId)

  const run = async (action: Action) => {
    if (action.needsReason && !reason.trim()) {
      toast.error('Say what needs to change')
      return
    }
    setPending(action.key)
    try {
      await move.mutateAsync({
        orderId: order.id,
        action: action.key,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(action.key === 'acknowledge' && acknowledgedRef.trim()
          ? { acknowledgedRef: acknowledgedRef.trim() }
          : {}),
      })
      toast.success(`${order.ref} ${action.label.toLowerCase()}`)
      setReason('')
      if (action.key === 'close') onClose()
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    } finally {
      setPending(null)
    }
  }

  return (
    <div data-testid='uat-po-detail'>
      <DialogHeader>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <DialogTitle className='font-display flex items-center gap-2'>
              <span className='font-mono'>{order.ref}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  LIFECYCLE_TONE[order.lifecycleStatus]
                )}
                data-testid='uat-po-detail-status'
              >
                {order.lifecycleLabel}
              </span>
            </DialogTitle>
            <DialogDescription>
              {order.item}
              {order.supplier ? ` · ${order.supplier}` : ''}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {order.rejectedReason && order.status === 'draft' && (
        <p
          className='mt-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground'
          data-testid='uat-po-sent-back'
        >
          Sent back: {order.rejectedReason}
        </p>
      )}

      <div className='mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        {[
          ['Subtotal', money(order.subtotal, order.currency)],
          [
            order.taxRate ? `Tax (${order.taxRate}%)` : 'Tax',
            money(order.taxAmount, order.currency),
          ],
          ['Order value', money(order.value, order.currency)],
          ['Invoiced', money(order.invoicedAmount, order.currency)],
        ].map(([label, value]) => (
          <div key={label} className='rounded-md border px-3 py-2'>
            <p className='text-[11px] tracking-wide text-muted-foreground uppercase'>{label}</p>
            <p className='font-display mt-0.5 text-base font-bold tabular-nums'>{value}</p>
          </div>
        ))}
      </div>

      <dl className='mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2'>
        {[
          ['Needed on site', order.requiredBy ? formatDate(order.requiredBy) : '—'],
          ['Promised', order.promisedDate ? formatDate(order.promisedDate) : '—'],
          [
            'Deliver to',
            order.deliveryLocation?.name ?? order.deliveryAddress ?? 'Not stated',
          ],
          ['Delivery terms', order.deliveryTerms ?? '—'],
          ['Payment terms', order.paymentTerms ?? '—'],
          ['Buyer', order.buyer ?? '—'],
          [
            'Acknowledged',
            order.acknowledgedAt
              ? `${formatDate(order.acknowledgedAt)}${
                  order.acknowledgedRef ? ` · ${order.acknowledgedRef}` : ''
                }`
              : 'Not yet',
          ],
        ].map(([label, value]) => (
          <div key={label} className='flex justify-between gap-3 border-b py-1.5'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='text-end'>{value}</dd>
          </div>
        ))}
      </dl>

      <Separator className='my-4' />

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full min-w-[720px] text-sm'>
          <thead className='bg-surface text-[11px] tracking-wide text-muted-foreground uppercase'>
            <tr>
              <th className='px-3 py-2 text-start'>Line</th>
              <th className='px-3 py-2 text-start'>Activity</th>
              <th className='px-3 py-2 text-end'>Ordered</th>
              <th className='px-3 py-2 text-end'>Received</th>
              <th className='px-3 py-2 text-end'>Outstanding</th>
              <th className='px-3 py-2 text-end'>Rate</th>
              <th className='px-3 py-2 text-end'>Amount</th>
            </tr>
          </thead>
          <tbody className='divide-y'>
            {order.lines.map((line) => (
              <tr key={line.id}>
                <td className='px-3 py-2'>
                  <p className='font-medium'>{line.description}</p>
                  <p className='font-mono text-[11px] text-muted-foreground'>
                    {line.itemCode ? `${line.itemCode} · ` : ''}
                    {line.unit}
                  </p>
                </td>
                <td className='px-3 py-2 text-muted-foreground'>
                  {line.activity ? (
                    <>
                      <span className='font-mono text-[11px]'>{line.activity.code}</span>{' '}
                      {line.activity.name}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className='px-3 py-2 text-end font-mono tabular-nums'>{line.orderedQty}</td>
                <td className='px-3 py-2 text-end font-mono tabular-nums'>{line.receivedQty}</td>
                <td
                  className={cn(
                    'px-3 py-2 text-end font-mono tabular-nums',
                    line.outstandingQty > 0 && 'text-warning-foreground'
                  )}
                >
                  {line.outstandingQty}
                </td>
                <td className='px-3 py-2 text-end font-mono tabular-nums'>{line.unitCost}</td>
                <td className='px-3 py-2 text-end font-mono tabular-nums'>
                  {money(line.amount, order.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(order.receipts.length > 0 || order.invoices.length > 0) && (
        <div className='mt-4 grid gap-4 sm:grid-cols-2'>
          <div>
            <p className='mb-2 text-[11px] tracking-wide text-muted-foreground uppercase'>
              Deliveries
            </p>
            <ul className='space-y-1 text-sm'>
              {order.receipts.map((receipt) => (
                <li
                  key={receipt.id}
                  className='flex justify-between gap-2 rounded-md border px-3 py-1.5'
                >
                  <span className='font-mono'>{receipt.receiptNumber}</span>
                  <span className='text-muted-foreground'>
                    {receipt.receivedAt ? formatDate(receipt.receivedAt) : '—'}
                  </span>
                </li>
              ))}
              {order.receipts.length === 0 && (
                <li className='px-3 py-2 text-muted-foreground'>Nothing delivered yet.</li>
              )}
            </ul>
          </div>
          <div>
            <p className='mb-2 text-[11px] tracking-wide text-muted-foreground uppercase'>
              Supplier invoices
            </p>
            <ul className='space-y-1 text-sm'>
              {order.invoices.map((invoice) => (
                <li
                  key={invoice.id}
                  className='flex justify-between gap-2 rounded-md border px-3 py-1.5'
                >
                  <span className='font-mono'>{invoice.invoiceNumber ?? invoice.ref}</span>
                  <span className='font-mono tabular-nums'>
                    {money(invoice.total, order.currency)}
                  </span>
                </li>
              ))}
              {order.invoices.length === 0 && (
                <li className='px-3 py-2 text-muted-foreground'>Nothing invoiced yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      <Actions
        order={order}
        reason={reason}
        setReason={setReason}
        acknowledgedRef={acknowledgedRef}
        setAcknowledgedRef={setAcknowledgedRef}
        pending={pending}
        run={run}
      />
    </div>
  )
}

function Actions({
  order,
  reason,
  setReason,
  acknowledgedRef,
  setAcknowledgedRef,
  pending,
  run,
}: {
  order: PurchaseOrder
  reason: string
  setReason: (value: string) => void
  acknowledgedRef: string
  setAcknowledgedRef: (value: string) => void
  pending: PoTransition | null
  run: (action: Action) => void
}) {
  const available = actionsFor(order)
  const canCancel = useCanPerform('procurement', 'delete', 'po.cancel')
  const cancellable =
    order.warehouseStatus === 'not_received' &&
    !['closed', 'cancelled'].includes(order.status)

  if (!available.length && !cancellable) return null

  return (
    <div className='mt-5 space-y-3 rounded-md border p-3' data-testid='uat-po-actions'>
      {available.some((action) => action.needsReason) || cancellable ? (
        <div className='grid gap-1.5'>
          <Label htmlFor='po-reason' className='text-xs'>
            Reason
          </Label>
          <Input
            id='po-reason'
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder='Required when sending back or cancelling'
            data-testid='uat-po-reason'
          />
        </div>
      ) : null}

      {order.status === 'issued' && (
        <div className='grid gap-1.5'>
          <Label htmlFor='po-ack-ref' className='text-xs'>
            Supplier reference
          </Label>
          <Input
            id='po-ack-ref'
            value={acknowledgedRef}
            onChange={(event) => setAcknowledgedRef(event.target.value)}
            placeholder="The supplier's own order number"
            data-testid='uat-po-ack-ref'
          />
        </div>
      )}

      <div className='flex flex-wrap gap-2'>
        {available.map((action) => (
          <ActionButton key={action.key} action={action} pending={pending} run={run} />
        ))}
        {cancellable && canCancel && (
          <ActionButton
            action={{
              key: 'cancel',
              label: 'Cancel order',
              needsReason: true,
              variant: 'destructive',
            }}
            pending={pending}
            run={run}
          />
        )}
      </div>
    </div>
  )
}

function ActionButton({
  action,
  pending,
  run,
}: {
  action: Action
  pending: PoTransition | null
  run: (action: Action) => void
}) {
  const [permAction, transition] = PERMISSION[action.key]
  const allowed = useCanPerform(
    'procurement',
    permAction as 'read' | 'create' | 'update' | 'delete' | 'submit' | 'approve',
    transition
  )
  if (!allowed) return null

  return (
    <Button
      size='sm'
      variant={action.variant ?? 'default'}
      disabled={pending !== null}
      onClick={() => run(action)}
      data-testid={`uat-po-action-${action.key}`}
    >
      {pending === action.key && <Loader2 className='me-1.5 size-4 animate-spin' />}
      {action.label}
    </Button>
  )
}
