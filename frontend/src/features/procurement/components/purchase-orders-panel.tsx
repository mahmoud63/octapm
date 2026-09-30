import { BallInCourtBadge } from '@/components/ball-in-court'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import { FINANCIAL_TERMS } from '@/lib/financial-terms'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  LIFECYCLE,
  LIFECYCLE_LABEL,
  LIFECYCLE_TONE,
  usePurchaseOrders,
  type LifecycleStatus,
  type PurchaseOrder,
} from '../hooks/use-purchase-orders'
import { PurchaseOrderDialog } from './purchase-order-dialog'

/**
 * The purchase order register.
 *
 * One row per order, with the single lifecycle name derived from the three
 * states underneath it. The two counts at the top are the ones a buyer acts
 * on: what is waiting on an approver, and what has gone out and not been
 * confirmed.
 */

const money = (value: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0)

/** Orders a delivery can still arrive against. */
const RECEIVABLE = new Set(['issued', 'acknowledged', 'partial', 'received'])

export function StatusBadge({ order }: { order: PurchaseOrder }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        LIFECYCLE_TONE[order.lifecycleStatus] ?? 'bg-surface text-muted-foreground'
      )}
      data-testid={`uat-po-status-${order.lifecycleStatus}`}
    >
      {order.lifecycleLabel}
    </span>
  )
}

export function PurchaseOrdersPanel({
  projectId,
  initialOrderId,
}: {
  projectId: string
  initialOrderId?: string
}) {
  const [search, setSearch] = useState('')
  const [lifecycle, setLifecycle] = useState<LifecycleStatus | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(initialOrderId ?? null)

  const orders = usePurchaseOrders(projectId)

  if (orders.isPending) {
    return (
      <div className='flex justify-center py-16'>
        <Loader2 className='size-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  const data = orders.data
  const items = (data?.items ?? []).filter((order) => {
    if (lifecycle !== 'all' && order.lifecycleStatus !== lifecycle) return false
    if (!search.trim()) return true
    const needle = search.trim().toLowerCase()
    return (
      order.ref.toLowerCase().includes(needle) ||
      order.item.toLowerCase().includes(needle) ||
      (order.supplier ?? '').toLowerCase().includes(needle)
    )
  })

  const currency = data?.items[0]?.currency ?? 'USD'

  return (
    <div className='space-y-4' data-testid='uat-purchase-orders'>
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        {[
          ['Orders', String(data?.summary.total ?? 0)],
          [FINANCIAL_TERMS.poValue.label, money(data?.summary.orderValue ?? 0, currency)],
          ['Invoiced', money(data?.summary.invoiced ?? 0, currency)],
          [
            'Waiting on you',
            `${data?.summary.awaitingApproval ?? 0} to approve · ${
              data?.summary.awaitingAcknowledgement ?? 0
            } unconfirmed`,
          ],
        ].map(([label, value]) => (
          <div key={label} className='rounded-md border bg-card px-4 py-3'>
            <p className='text-[11px] tracking-wide text-muted-foreground uppercase'>{label}</p>
            <p className='font-display mt-1 text-lg font-bold tabular-nums'>{value}</p>
          </div>
        ))}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder='Search by reference, item or supplier'
          className='w-full sm:w-72'
          data-testid='uat-po-search'
        />
        <div className='flex flex-wrap gap-1'>
          <button
            type='button'
            onClick={() => setLifecycle('all')}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs transition-colors',
              lifecycle === 'all'
                ? 'bg-brand-accent text-white'
                : 'bg-surface text-muted-foreground hover:text-foreground'
            )}
          >
            All
          </button>
          {LIFECYCLE.filter((key) => (data?.summary.byLifecycle?.[key] ?? 0) > 0).map((key) => (
            <button
              key={key}
              type='button'
              onClick={() => setLifecycle(key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs transition-colors',
                lifecycle === key
                  ? 'bg-brand-accent text-white'
                  : 'bg-surface text-muted-foreground hover:text-foreground'
              )}
              data-testid={`uat-po-filter-${key}`}
            >
              {LIFECYCLE_LABEL[key]}
              <span className='ms-1.5 tabular-nums opacity-70'>
                {data?.summary.byLifecycle?.[key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full min-w-[900px] text-sm'>
          <thead className='bg-surface text-[11px] tracking-wide text-muted-foreground uppercase'>
            <tr>
              <th className='px-3 py-2 text-start'>Order</th>
              <th className='px-3 py-2 text-start'>Supplier</th>
              <th className='px-3 py-2 text-start'>Status</th>
              <th className='px-3 py-2 text-start'>Needed on site</th>
              <th className='px-3 py-2 text-end'>Value</th>
              <th className='px-3 py-2 text-end'>Invoiced</th>
              <th className='px-3 py-2 text-end'>Lines</th>
              <th className='px-3 py-2 text-end'></th>
            </tr>
          </thead>
          <tbody className='divide-y'>
            {items.map((order) => (
              <tr
                key={order.id}
                className='cursor-pointer hover:bg-surface/60'
                onClick={() => setOpenId(order.id)}
                data-testid={`uat-po-row-${order.ref}`}
              >
                <td className='px-3 py-2'>
                  <p className='font-mono font-medium'>{order.ref}</p>
                  <p className='truncate text-[11px] text-muted-foreground'>{order.item}</p>
                </td>
                <td className='px-3 py-2'>{order.supplier ?? '—'}</td>
                <td className='px-3 py-2'>
                  <div className='flex flex-col items-start gap-1'>
                    <StatusBadge order={order} />
                    <BallInCourtBadge
                      ballInCourt={order.ballInCourt}
                      testId={`uat-po-ball-${order.ref}`}
                    />
                  </div>
                </td>
                <td
                  className={cn(
                    'px-3 py-2 whitespace-nowrap',
                    // Needed before it has even been acknowledged is the thing
                    // a lead-time alert exists to shout about.
                    order.requiredBy &&
                      new Date(order.requiredBy) < new Date() &&
                      order.warehouseStatus !== 'received' &&
                      'font-medium text-error-foreground'
                  )}
                >
                  {order.requiredBy ? formatDate(order.requiredBy) : '—'}
                </td>
                <td className='px-3 py-2 text-end font-mono tabular-nums'>
                  {money(order.value, order.currency)}
                </td>
                <td className='px-3 py-2 text-end font-mono tabular-nums'>
                  {money(order.invoicedAmount, order.currency)}
                </td>
                <td className='px-3 py-2 text-end font-mono tabular-nums'>
                  {order.lines.length}
                </td>
                <td className='px-3 py-2 text-end'>
                  {/* An order out with the supplier is waiting for a lorry. The
                      receipt screen lives in Inventory and there is one of it,
                      so this points at it with the order already named rather
                      than making a storeman type the reference again
                      (OCTA-UX-RECEIPT-089). */}
                  {RECEIVABLE.has(order.status) && (
                    <a
                      href={`/inventory?tab=receive&orderRef=${encodeURIComponent(order.ref)}`}
                      className='text-primary text-xs font-medium hover:underline'
                      onClick={(event) => event.stopPropagation()}
                      data-testid={`uat-po-receive-${order.ref}`}
                    >
                      Receive delivery
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className='px-3 py-10 text-center text-muted-foreground'>
                  {data?.items.length
                    ? 'No order matches that filter.'
                    : 'No purchase orders have been raised on this project.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PurchaseOrderDialog
        projectId={projectId}
        orderId={openId}
        onClose={() => setOpenId(null)}
      />
    </div>
  )
}
